// notify-dispatch: sends queued notifications (push / email / SMS) from public.notification_deliveries.
// Woken by a DB trigger (pg_net) whenever something is queued, and by pg_cron every 5 minutes as a safety net.
// Providers are plugged in ONLY through function secrets — nothing is hard-coded:
//   SMS (Malaysia):  ONEWAYSMS_MT_URL, ONEWAYSMS_USER, ONEWAYSMS_PASS [, ONEWAYSMS_SENDER]   ← primary
//                    TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM                         ← fallback
//                    SMS_HTTP_URL [, SMS_HTTP_TOKEN]  (generic JSON POST {to, message})          ← fallback
//   Email:           BREVO_API_KEY [, BREVO_API_URL]                                             ← primary
//                    RESEND_API_KEY [, RESEND_API_URL]                                           ← alternative
//                    EMAIL_FROM, EMAIL_FROM_NAME (or Settings → Notifications → sender)
//   Push:            VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (already used by daily-alerts)
//   Optional:        SMS_PROVIDER / EMAIL_PROVIDER to force one adapter.
// A channel without a configured provider is marked 'skipped: provider not configured' (not a failure).
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const env = (k: string) => (Deno.env.get(k) || '').trim()
const SUPABASE_URL = env('SUPABASE_URL')
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')
const CRON_SECRET = env('CRON_SECRET')
const MAX_ATTEMPTS = 5
const pushReady = !!(env('VAPID_PUBLIC_KEY') && env('VAPID_PRIVATE_KEY'))
if (pushReady) webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:admin@example.com', env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'))

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

type Delivery = { id: number; event: string; user_id: string | null; channel: string; address: string | null; title: string | null; body: string | null; link: string | null; critical: boolean; attempts: number }
type Result = { status: 'sent' | 'failed' | 'skipped' | 'retry'; provider?: string; providerId?: string; error?: string; cost?: number; deferUntil?: Date }
type Cfg = { appUrl?: string; smsSender?: string; email?: { fromName?: string; fromEmail?: string }; quietHours?: { enabled?: boolean; start?: string; end?: string }; rateLimitPerHour?: Record<string, number>; costs?: Record<string, number> }

const NOT_CONFIGURED: Result = { status: 'skipped', error: 'provider not configured' }

/* ---------------- SMS adapters ---------------- */
interface SmsAdapter { name: string; ready(): boolean; send(to: string, text: string): Promise<Result> }
const segments = (t: string) => (t.length <= 160 ? 1 : Math.ceil(t.length / 153))
// Malaysian carriers block SMS with links / phone numbers: last line of defence before sending
const smsSafe = (t: string) => t.replace(/(https?:\/\/\S+|www\.\S+)/gi, '').replace(/\+?\d[\d\s-]{7,}\d/g, '').replace(/[^\x20-\x7E]/g, '').replace(/\s{2,}/g, ' ').trim()

const oneWaySms: SmsAdapter = {
  name: 'onewaysms',
  ready: () => !!(env('ONEWAYSMS_MT_URL') && env('ONEWAYSMS_USER') && env('ONEWAYSMS_PASS')),
  async send(to, text) {
    const u = new URL(env('ONEWAYSMS_MT_URL'))
    u.searchParams.set('apiusername', env('ONEWAYSMS_USER'))
    u.searchParams.set('apipassword', env('ONEWAYSMS_PASS'))
    u.searchParams.set('mobileno', to.replace(/[^0-9]/g, '')) // 60123456789 (no '+')
    u.searchParams.set('senderid', env('ONEWAYSMS_SENDER') || 'onewaysms')
    u.searchParams.set('languagetype', '1') // 1 = normal text (English/Malay)
    u.searchParams.set('message', text)
    const r = await fetch(u, { method: 'GET' })
    const body = (await r.text()).trim()
    const code = Number(body.split(/[\s,]/)[0])
    if (r.ok && Number.isFinite(code) && code > 0) return { status: 'sent', provider: 'onewaysms', providerId: String(code) }
    const why: Record<string, string> = { '-100': 'invalid API username/password', '-200': 'invalid sender ID', '-300': 'invalid mobile number', '-400': 'invalid language type', '-500': 'invalid characters in message', '-600': 'insufficient credit' }
    const permanent = ['-100', '-200', '-300', '-400', '-500'].includes(String(code))
    return { status: permanent ? 'failed' : 'retry', provider: 'onewaysms', error: `OneWaySMS ${body.slice(0, 60)}${why[String(code)] ? ' (' + why[String(code)] + ')' : ''}` }
  },
}
const twilio: SmsAdapter = {
  name: 'twilio',
  ready: () => !!(env('TWILIO_ACCOUNT_SID') && env('TWILIO_AUTH_TOKEN') && env('TWILIO_FROM')),
  async send(to, text) {
    const base = env('TWILIO_API_URL') || 'https://api.twilio.com'
    const r = await fetch(`${base}/2010-04-01/Accounts/${env('TWILIO_ACCOUNT_SID')}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + btoa(`${env('TWILIO_ACCOUNT_SID')}:${env('TWILIO_AUTH_TOKEN')}`), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: env('TWILIO_FROM'), Body: text }),
    })
    const j = await r.json().catch(() => ({}))
    if (r.ok) return { status: 'sent', provider: 'twilio', providerId: j.sid }
    return { status: r.status >= 500 || r.status === 429 ? 'retry' : 'failed', provider: 'twilio', error: `Twilio ${r.status} ${j.message || ''}`.slice(0, 200) }
  },
}
const genericSms: SmsAdapter = {
  name: 'http',
  ready: () => !!env('SMS_HTTP_URL'),
  async send(to, text) {
    const r = await fetch(env('SMS_HTTP_URL'), { method: 'POST', headers: { 'Content-Type': 'application/json', ...(env('SMS_HTTP_TOKEN') ? { Authorization: 'Bearer ' + env('SMS_HTTP_TOKEN') } : {}) }, body: JSON.stringify({ to, message: text }) })
    const t = await r.text()
    if (r.ok) return { status: 'sent', provider: 'http', providerId: t.slice(0, 60) }
    return { status: r.status >= 500 || r.status === 429 ? 'retry' : 'failed', provider: 'http', error: `HTTP ${r.status} ${t}`.slice(0, 200) }
  },
}
const SMS: SmsAdapter[] = [oneWaySms, twilio, genericSms]

/* ---------------- Email adapters ---------------- */
interface Mail { to: string; subject: string; text: string; html: string; fromEmail: string; fromName: string }
interface EmailAdapter { name: string; ready(): boolean; send(m: Mail): Promise<Result> }
const brevo: EmailAdapter = {
  name: 'brevo',
  ready: () => !!env('BREVO_API_KEY'),
  async send(m) {
    const r = await fetch(env('BREVO_API_URL') || 'https://api.brevo.com/v3/smtp/email', {
      method: 'POST', headers: { 'api-key': env('BREVO_API_KEY'), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ sender: { email: m.fromEmail, name: m.fromName }, to: [{ email: m.to }], subject: m.subject, htmlContent: m.html, textContent: m.text }),
    })
    const j = await r.json().catch(() => ({}))
    if (r.ok) return { status: 'sent', provider: 'brevo', providerId: j.messageId }
    return { status: r.status >= 500 || r.status === 429 ? 'retry' : 'failed', provider: 'brevo', error: `Brevo ${r.status} ${j.message || ''}`.slice(0, 200) }
  },
}
const resend: EmailAdapter = {
  name: 'resend',
  ready: () => !!env('RESEND_API_KEY'),
  async send(m) {
    const r = await fetch(env('RESEND_API_URL') || 'https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: 'Bearer ' + env('RESEND_API_KEY'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `${m.fromName} <${m.fromEmail}>`, to: [m.to], subject: m.subject, html: m.html, text: m.text }),
    })
    const j = await r.json().catch(() => ({}))
    if (r.ok) return { status: 'sent', provider: 'resend', providerId: j.id }
    return { status: r.status >= 500 || r.status === 429 ? 'retry' : 'failed', provider: 'resend', error: `Resend ${r.status} ${j.message || ''}`.slice(0, 200) }
  },
}
const EMAIL: EmailAdapter[] = [brevo, resend]

const pick = <T extends { name: string; ready(): boolean }>(list: T[], forced: string) => (forced ? list.filter((a) => a.name === forced && a.ready()) : list.filter((a) => a.ready()))[0]
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

/* ---------------- time helpers (Malaysia, UTC+8, no DST) ---------------- */
const MY = 8 * 60
function myMinutes(d = new Date()) { return (d.getUTCHours() * 60 + d.getUTCMinutes() + MY) % 1440 }
const hm = (s: string | undefined, dflt: number) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? +m[1] * 60 + +m[2] : dflt }
function quietUntil(cfg: Cfg): Date | null {
  const q = cfg.quietHours
  if (!q?.enabled) return null
  const start = hm(q.start, 22 * 60), end = hm(q.end, 7 * 60), now = myMinutes()
  const inQuiet = start > end ? now >= start || now < end : now >= start && now < end
  if (!inQuiet) return null
  const wait = (end - now + 1440) % 1440
  return new Date(Date.now() + wait * 60000)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const isCron = !!CRON_SECRET && req.headers.get('x-cron-secret') === CRON_SECRET
  if (!isCron) {
    // a signed-in Super Admin may trigger a run (e.g. right after "Send test")
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    const { data: u } = token ? await db.auth.getUser(token) : { data: null }
    if (!u?.user) return json({ error: 'Not allowed' }, 401)
    const { data: p } = await db.from('profiles').select('role,status').eq('id', u.user.id).maybeSingle()
    if (p?.status !== 'active' || !['super_admin', 'admin'].includes(p?.role)) return json({ error: 'Super Admin only' }, 403)
  }

  const { data: cfgRow } = await db.from('app_config').select('value').eq('key', 'notifications').maybeSingle()
  const cfg: Cfg = (cfgRow?.value as Cfg) || {}
  const costs = { sms: 0.115, email: 0, whatsapp: 0, push: 0, ...(cfg.costs || {}) }
  const limits: Record<string, number> = { sms: 6, email: 30, whatsapp: 6, push: 60, ...(cfg.rateLimitPerHour || {}) }
  const fromEmail = env('EMAIL_FROM') || cfg.email?.fromEmail || ''
  const fromName = env('EMAIL_FROM_NAME') || cfg.email?.fromName || 'FW Manager'
  const quiet = quietUntil(cfg)
  const smsAdapter = pick(SMS, env('SMS_PROVIDER'))
  const emailAdapter = pick(EMAIL, env('EMAIL_PROVIDER'))

  const tally: Record<string, number> = { sent: 0, failed: 0, skipped: 0, deferred: 0, retry: 0 }
  const sentThisRun = new Map<string, number>()
  const started = Date.now()
  while (Date.now() - started < 50_000) {
    const { data: rows, error } = await db.rpc('notify_claim', { p_limit: 50 })
    if (error) return json({ error: error.message }, 500)
    if (!rows?.length) break
    for (const d of rows as Delivery[]) {
      let res: Result
      try {
        // quiet hours: non-critical outside-app messages wait until the end of quiet hours
        if (quiet && !d.critical && d.channel !== 'push') { res = { status: 'retry', deferUntil: quiet, error: 'deferred: quiet hours' }; tally.deferred++ }
        else if (d.channel !== 'push' && d.address && (await overLimit(db, d, limits, sentThisRun))) {
          res = { status: 'retry', deferUntil: new Date(Date.now() + 60 * 60000), error: 'deferred: rate limit' }; tally.deferred++
        } else res = await deliver(db, d)
      } catch (e) {
        res = { status: 'retry', error: String((e as Error).message || e).slice(0, 200) }
      }
      if (res.status === 'sent' && d.address) sentThisRun.set(d.channel + d.address, (sentThisRun.get(d.channel + d.address) || 0) + 1)
      const isDefer = !!res.deferUntil
      const final = res.status === 'retry' && !isDefer && d.attempts >= MAX_ATTEMPTS ? 'failed' : res.status
      const patch: Record<string, unknown> = { provider: res.provider ?? null, last_error: res.error ?? null }
      if (final === 'retry') {
        patch.status = 'queued'
        patch.next_attempt_at = (res.deferUntil || new Date(Date.now() + Math.min(2 ** d.attempts, 60) * 60000)).toISOString()
        if (isDefer) patch.attempts = Math.max(0, d.attempts - 1) // waiting is not an attempt
        else tally.retry++
      } else {
        patch.status = final
        if (final === 'sent') { patch.sent_at = new Date().toISOString(); patch.provider_id = res.providerId ?? null; patch.cost = res.cost ?? 0 }
        tally[final]++
      }
      await db.from('notification_deliveries').update(patch).eq('id', d.id)
    }
  }
  return json({ ...tally, sms: smsAdapter?.name || 'not configured', email: emailAdapter?.name || 'not configured', push: pushReady ? 'vapid' : 'not configured', quiet: !!quiet })

  async function deliver(db: ReturnType<typeof createClient>, d: Delivery): Promise<Result> {
    switch (d.channel) {
      case 'whatsapp':
        return { status: 'skipped', error: 'WhatsApp coming later' }
      case 'sms': {
        if (!d.address) return { status: 'skipped', error: 'no mobile number' }
        if (!smsAdapter) return NOT_CONFIGURED
        const text = smsSafe(d.body || '')
        if (!text.startsWith('RM0 ')) return { status: 'failed', error: 'SMS must start with "RM0 " (Malaysian carrier rule)' }
        const r = await smsAdapter.send(d.address, text)
        return { ...r, cost: r.status === 'sent' ? +(costs.sms * segments(text)).toFixed(4) : undefined }
      }
      case 'email': {
        if (!d.address) return { status: 'skipped', error: 'no email address' }
        if (!emailAdapter) return NOT_CONFIGURED
        if (!fromEmail) return { status: 'skipped', error: 'provider not configured: sender email missing' }
        const text = (d.body || '') + (d.link ? `\n\nOpen in FW Manager: ${d.link}` : '')
        const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222"><p style="font-size:16px;font-weight:bold">${esc(d.title || '')}</p>`
          + `<p style="white-space:pre-line">${esc(d.body || '')}</p>`
          + (d.link ? `<p><a href="${esc(d.link)}" style="background:#0f766e;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Open in FW Manager</a></p>` : '')
          + `<p style="color:#888;font-size:12px">Automatic message from FW Manager. Notification settings: Settings → Notifications.</p></div>`
        const r = await emailAdapter.send({ to: d.address, subject: d.title || 'FW Manager', text, html, fromEmail, fromName })
        return { ...r, cost: r.status === 'sent' ? costs.email : undefined }
      }
      case 'push': {
        if (!pushReady) return NOT_CONFIGURED
        if (!d.user_id) return { status: 'skipped', error: 'no user' }
        const { data: subs } = await db.from('push_subscriptions').select('*').eq('user_id', d.user_id)
        if (!subs?.length) return { status: 'skipped', provider: 'webpush', error: 'no device subscribed to push' }
        let ok = 0, err = ''
        const path = d.link && d.link.includes('#') ? d.link.slice(d.link.indexOf('#')) : '#/'
        for (const s of subs) {
          try {
            await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              JSON.stringify({ title: d.title, body: d.body, tag: 'fwm-' + d.event + '-' + d.id, path }), { TTL: 60 * 60 * 24 })
            ok++
          } catch (e) {
            const code = (e as { statusCode?: number }).statusCode
            if (code === 404 || code === 410) await db.from('push_subscriptions').delete().eq('id', s.id)
            else err = `push ${code || ''} ${(e as Error).message}`.slice(0, 200)
          }
        }
        return ok ? { status: 'sent', provider: 'webpush', providerId: `${ok} device(s)` } : err ? { status: 'retry', provider: 'webpush', error: err } : { status: 'skipped', provider: 'webpush', error: 'no active push subscription' }
      }
      default:
        return { status: 'skipped', error: 'unknown channel' }
    }
  }
})

async function overLimit(db: ReturnType<typeof createClient>, d: Delivery, limits: Record<string, number>, run: Map<string, number>) {
  const lim = (limits[d.channel] || 30) * (d.critical ? 2 : 1)
  const { count } = await db.from('notification_deliveries').select('id', { count: 'exact', head: true })
    .eq('channel', d.channel).eq('address', d.address!).eq('status', 'sent').gte('sent_at', new Date(Date.now() - 3600_000).toISOString())
  return (count || 0) >= lim
}
