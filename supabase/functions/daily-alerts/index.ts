// Daily phone alerts: computes the same alerts as the app and sends ONE summary Web Push per user.
// Called by pg_cron every day at 00:00 UTC (08:00 Malaysia) with the x-cron-secret header,
// or by a signed-in user (Settings → "Send me a test alert"), which only sends to that user.
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import { buildAlerts, type Alert } from './lib/calc.ts'
import { DEFAULT_SETTINGS, type Settings, type Worker } from './lib/types.ts'
import { todayISO } from './lib/util.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CRON_SECRET = Deno.env.get('CRON_SECRET') || ''
const HAS_VAPID = !!(Deno.env.get('VAPID_SUBJECT') && Deno.env.get('VAPID_PUBLIC_KEY') && Deno.env.get('VAPID_PRIVATE_KEY'))
if (HAS_VAPID) webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

async function sha(s: string) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(h)).slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function summary(urgent: Alert[]) {
  if (!urgent.length) return { title: 'FW Manager: no urgent alerts ✅', body: 'Nothing urgent today. Open the app for upcoming items.' }
  const expired = urgent.filter((a) => a.days !== null && a.days < 0).length
  const lines = urgent.slice(0, 4).map((a) => `• ${a.workerName.replace(/^DEMO /, '')}: ${a.title}`)
  return {
    title: `${urgent.length} urgent worker alert(s)${expired ? ` · ${expired} overdue/expired` : ''}`,
    body: lines.join('\n') + (urgent.length > 4 ? `\n+${urgent.length - 4} more — tap to open` : ''),
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (!HAS_VAPID) return json({ skipped: 'push not configured (VAPID keys missing)' })
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // --- who is calling? ---
  const isCron = !!CRON_SECRET && req.headers.get('x-cron-secret') === CRON_SECRET
  let onlyUser: string | null = null
  if (!isCron) {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    const { data: u } = await db.auth.getUser(token)
    if (!u?.user) return json({ error: 'Not signed in' }, 401)
    const { data: p } = await db.from('profiles').select('status').eq('id', u.user.id).maybeSingle()
    if (p?.status !== 'active') return json({ error: 'Account not active' }, 403)
    onlyUser = u.user.id
  }
  const test = !isCron // user-triggered = test: always send, only to the caller

  // --- load data (service role bypasses RLS) ---
  const workers: Worker[] = []
  let settings: Settings = DEFAULT_SETTINGS
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('records').select('entity,data').eq('deleted', false).in('entity', ['workers', 'settings']).range(from, from + 999)
    if (error) return json({ error: error.message }, 500)
    for (const r of data) {
      if (r.entity === 'workers') workers.push(r.data as Worker)
      else if ((r.data as Settings).id === 'app') settings = { ...DEFAULT_SETTINGS, ...(r.data as Settings) }
    }
    if (data.length < 1000) break
  }
  for (const w of workers) { // tolerate partially filled records
    w.documents ||= []; w.leaves ||= []; w.loans ||= []; w.deductions ||= []; w.memos ||= []; w.increments ||= []; w.family ||= []
  }
  const day = todayISO()
  // alerts are scoped per user: an outlet manager only hears about workers in his outlets
  const cache = new Map<string, { urgent: ReturnType<typeof buildAlerts>; digest: string; msg: ReturnType<typeof summary> }>()
  const forUser = async (role: string, outlets: string[] | null) => {
    const key = role === 'outlet_manager' ? 'om:' + [...(outlets || [])].sort().join(',') : 'all'
    let c = cache.get(key)
    if (!c) {
      const ws = role === 'outlet_manager' ? workers.filter((w) => (outlets || []).includes(w.outletId)) : workers
      const urgent = buildAlerts(ws, settings).filter((a) => a.severity === 'critical' || a.severity === 'high')
      c = { urgent, digest: await sha(urgent.map((a) => a.id).sort().join('|')), msg: summary(urgent) }
      cache.set(key, c)
    }
    return c
  }

  // --- recipients: active users with a subscription ---
  let pq = db.from('profiles').select('id,role,outlet_ids').eq('status', 'active')
  if (onlyUser) pq = pq.eq('id', onlyUser)
  const { data: users } = await pq
  const ids = (users || []).map((u) => u.id)
  const { data: subs } = ids.length ? await db.from('push_subscriptions').select('*').in('user_id', ids) : { data: [] }

  let sent = 0, skipped = 0, failed = 0, removed = 0
  for (const u of users || []) {
    const uid = u.id
    const mine = (subs || []).filter((s) => s.user_id === uid)
    if (!mine.length) continue
    const { urgent, digest, msg } = await forUser(u.role, u.outlet_ids)
    if (!test) {
      if (!urgent.length) { skipped++; continue } // nothing urgent: stay quiet
      const { data: already } = await db.from('alert_log').select('user_id').eq('user_id', uid).eq('day', day).eq('digest', digest).maybeSingle()
      if (already) { skipped++; continue } // identical summary already sent today
    }
    let ok = false
    for (const s of mine) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ ...msg, tag: 'fwm-daily', path: '#/alerts', ...(test ? { title: '🔔 Test: ' + msg.title } : {}) }), { TTL: 60 * 60 * 12 })
        sent++; ok = true
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode
        if (code === 404 || code === 410) { await db.from('push_subscriptions').delete().eq('id', s.id); removed++ } else failed++
        console.error('push failed', code, (e as Error).message)
      }
    }
    if (ok && !test) await db.from('alert_log').insert({ user_id: uid, day, digest })
  }
  return json({ day, workers: workers.length, scopes: cache.size, recipients: ids.length, subscriptions: subs?.length || 0, sent, skipped, failed, removed, test })
})
