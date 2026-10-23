// wa-admin (Super Admin only): submit our WhatsApp utility templates to Meta and refresh their approval status.
//   POST {action:'status'}  → GET  /{WABA_ID}/message_templates  → app_config 'wa_templates'
//   POST {action:'submit'}  → POST /{WABA_ID}/message_templates for every template not yet on the account
// Secrets: WA_BUSINESS_ACCOUNT_ID, WA_ACCESS_TOKEN [, WA_GRAPH_VERSION, WA_GRAPH_URL]
import { createClient } from 'npm:@supabase/supabase-js@2'
import WA from '../_shared/wa-templates.json' with { type: 'json' }

const env = (k: string) => (Deno.env.get(k) || '').trim()
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const base = () => `${env('WA_GRAPH_URL') || 'https://graph.facebook.com'}/${env('WA_GRAPH_VERSION') || 'v26.0'}/${env('WA_BUSINESS_ACCOUNT_ID')}/message_templates`
const auth = () => ({ Authorization: 'Bearer ' + env('WA_ACCESS_TOKEN'), 'Content-Type': 'application/json' })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const { data: u } = token ? await db.auth.getUser(token) : { data: null }
  if (!u?.user) return json({ error: 'Not allowed' }, 401)
  const { data: p } = await db.from('profiles').select('role,status').eq('id', u.user.id).maybeSingle()
  if (p?.status !== 'active' || !['super_admin', 'admin'].includes(p?.role)) return json({ error: 'Super Admin only' }, 403)
  if (!env('WA_BUSINESS_ACCOUNT_ID') || !env('WA_ACCESS_TOKEN')) return json({ error: 'WhatsApp not configured: set WA_BUSINESS_ACCOUNT_ID and WA_ACCESS_TOKEN' }, 400)
  const { action } = await req.json().catch(() => ({ action: 'status' }))

  async function status() {
    const items: Record<string, unknown> = {}
    let next: string | null = `${base()}?fields=name,language,status,category,rejected_reason,id&limit=200`
    while (next) {
      const r = await fetch(next, { headers: auth() })
      const j = await r.json()
      if (!r.ok) throw new Error(`Meta ${r.status}: ${j.error?.message || ''}`)
      for (const t of j.data || []) items[`${t.name}:${t.language}`] = { id: t.id, status: t.status, category: t.category, reason: t.rejected_reason || null }
      next = j.paging?.next || null
    }
    const value = { items, syncedAt: new Date().toISOString() }
    await db.from('app_config').upsert({ key: 'wa_templates', value })
    return value
  }
  try {
    if (action === 'submit') {
      const { data: cfg } = await db.from('app_config').select('value').eq('key', 'notifications').maybeSingle()
      const app = (cfg?.value?.appUrl || Deno.env.get('APP_PUBLIC_URL') || 'https://fw.sunrisebayumas.com/').replace(/\/?$/, '/')
      const have = (await status()).items
      const results: Record<string, string> = {}
      for (const t of (WA as any).templates) {
        const key = `${t.name}:${t.language}`
        if (have[key]) { results[key] = 'already on account'; continue }
        const { fwm: _m, ...payload } = JSON.parse(JSON.stringify(t).replaceAll('__APP_URL__', app))
        const r = await fetch(base(), { method: 'POST', headers: auth(), body: JSON.stringify(payload) })
        const j = await r.json().catch(() => ({}))
        results[key] = r.ok ? `submitted (${j.status || 'PENDING'})` : `error ${r.status}: ${j.error?.error_user_msg || j.error?.message || ''}`
      }
      return json({ results, ...(await status()) })
    }
    return json(await status())
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 502)
  }
})
