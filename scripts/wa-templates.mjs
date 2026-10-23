#!/usr/bin/env node
// Submit / check the FW Manager WhatsApp utility templates from your own computer (alternative to the in-app button).
// Usage:  WA_BUSINESS_ACCOUNT_ID=... WA_ACCESS_TOKEN=... node scripts/wa-templates.mjs [status|submit] [appUrl]
// The token is read from the environment only — never put it in a file in this repo.
import { readFileSync } from 'node:fs'
const [action = 'status', appUrl = 'https://moulisankar999.github.io/foreign-worker-manager/'] = process.argv.slice(2)
const { WA_BUSINESS_ACCOUNT_ID: waba, WA_ACCESS_TOKEN: token, WA_GRAPH_VERSION: ver = 'v26.0', WA_GRAPH_URL: host = 'https://graph.facebook.com' } = process.env
if (!waba || !token) { console.error('Set WA_BUSINESS_ACCOUNT_ID and WA_ACCESS_TOKEN'); process.exit(1) }
const url = `${host}/${ver}/${waba}/message_templates`
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
const { templates } = JSON.parse(readFileSync(new URL('../supabase/functions/_shared/wa-templates.json', import.meta.url)))
const r = await fetch(`${url}?fields=name,language,status,rejected_reason&limit=200`, { headers: H })
const j = await r.json()
if (!r.ok) { console.error('Meta error', r.status, j.error?.message); process.exit(1) }
const have = new Map((j.data || []).map((t) => [`${t.name}:${t.language}`, t]))
for (const t of templates) {
  const key = `${t.name}:${t.language}`
  if (have.has(key)) { const h = have.get(key); console.log(key.padEnd(42), h.status, h.rejected_reason && h.rejected_reason !== 'NONE' ? h.rejected_reason : ''); continue }
  if (action !== 'submit') { console.log(key.padEnd(42), 'NOT SUBMITTED'); continue }
  const { fwm, ...payload } = JSON.parse(JSON.stringify(t).replaceAll('__APP_URL__', appUrl.replace(/\/?$/, '/')))
  const s = await fetch(url, { method: 'POST', headers: H, body: JSON.stringify(payload) })
  const sj = await s.json()
  console.log(key.padEnd(42), s.ok ? `submitted → ${sj.status}` : `ERROR ${s.status} ${sj.error?.error_user_msg || sj.error?.message}`)
}
