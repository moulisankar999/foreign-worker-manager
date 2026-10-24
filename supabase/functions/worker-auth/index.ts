// worker-auth: FW Worker sign-in (passport number + 6-digit PIN) and "change my PIN".
//   POST {action:'login', passport, pin}            → {session:{access_token, refresh_token, expires_in, expires_at}}
//   POST {action:'change_pin', currentPin, newPin}   (Authorization: Bearer <worker JWT>) → {ok:true, session} (Auth ends all sessions on a password change; a fresh one is returned)
// Security:
// * The Auth password is HMAC-SHA256(WORKER_PIN_PEPPER, user_id:pin). The pepper never leaves this function, so a PIN
//   cannot be tried directly against GoTrue — every attempt goes through the lockout in SQL (worker_login_begin/finish).
// * Lockout: 5 wrong PINs → locked 15 min (doubling), hard lock after 3 lockouts (HR unlocks). Per-IP limit too.
// * One generic error for every failure (wrong passport, wrong PIN, locked, revoked) + a minimum response time.
// * PINs, secrets and tokens are never logged.
import { createClient } from 'npm:@supabase/supabase-js@2'

const env = (k: string) => (Deno.env.get(k) || '').trim()
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const FAIL = 'wrong_or_locked' // the app shows one translated message: "Passport number or PIN is wrong, or the login is locked."
const MIN_MS = 900

const enc = new TextEncoder()
const b64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
async function hmac(key: string, msg: string) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64url(await crypto.subtle.sign('HMAC', k, enc.encode(msg)))
}
const pinSecret = (uid: string, pin: string) => hmac(env('WORKER_PIN_PEPPER'), uid + ':' + pin)
const tag = (what: string, v: string) => hmac(env('WORKER_PIN_PEPPER'), what + ':' + v) // keyed hash: IPs / passports are not stored in clear
const normPassport = (p: string) => p.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
export function weakPin(p: string) {
  if (!/^\d{6}$/.test(p)) return true
  if (/^(\d)\1{5}$/.test(p)) return true
  const d = p.split('').map(Number)
  const step = d[1] - d[0]
  if ((step === 1 || step === -1) && d.every((x, i) => i === 0 || x - d[i - 1] === step)) return true
  if (p.slice(0, 3) === p.slice(3) || p.slice(0, 2).repeat(3) === p) return true
  return ['121212', '112233', '123123', '696969', '159753', '147258', '000111'].includes(p)
}
function clientIp(req: Request) {
  return (req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || req.headers.get('x-real-ip') || 'unknown').trim()
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
function sessionIdOf(jwt: string): string | null {
  try {
    let b = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    while (b.length % 4) b += '='
    return JSON.parse(atob(b)).session_id || null
  } catch { return null }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  if (!env('WORKER_PIN_PEPPER') || env('WORKER_PIN_PEPPER').length < 32) return json({ error: 'not configured' }, 500)
  const t0 = Date.now()
  const slow = async (r: Response) => { const w = MIN_MS - (Date.now() - t0); if (w > 0) await sleep(w + Math.random() * 150); return r }
  // deno-lint-ignore no-explicit-any
  let body: any = {}
  try { body = await req.json() } catch { return json({ error: 'bad request' }, 400) }
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
  const ipHash = await tag('ip', clientIp(req))

  if (body.action === 'login') {
    const passport = normPassport(String(body.passport || '')).slice(0, 20)
    const pin = String(body.pin || '')
    const ppHash = await tag('pp', passport || '-')
    const okFormat = passport.length >= 5 && /^\d{6}$/.test(pin)
    const { data: b, error: be } = await db.rpc('worker_login_begin', { p_passport: okFormat ? passport : '', p_ip_hash: ipHash, p_passport_hash: ppHash })
    if (be) { console.error('login_begin failed'); return slow(json({ error: 'unavailable' }, 503)) }
    if (!b?.ok) return slow(json({ error: FAIL }, 401))
    const anon = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await anon.auth.signInWithPassword({ email: b.email, password: await pinSecret(b.userId, pin) })
    if (error && (error.status === 429 || (error.status ?? 0) >= 500)) {
      await db.rpc('worker_login_abort', { p_worker: b.workerId }) // GoTrue busy: not the worker's fault
      return slow(json({ error: 'busy' }, 503))
    }
    const ok = !error && !!data?.session && data.user?.id === b.userId && data.user?.app_metadata?.fwm_worker === true
    await db.rpc('worker_login_finish', { p_worker: b.workerId, p_ok: ok, p_ip_hash: ipHash, p_passport_hash: ppHash })
    if (!ok) {
      if (data?.session) await db.rpc('worker_kill_sessions', { p_user: data.user.id, p_keep: null })
      return slow(json({ error: FAIL }, 401))
    }
    const s = data.session!
    return slow(json({ session: { access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in, expires_at: s.expires_at } }))
  }

  if (body.action === 'change_pin') {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    const { data: u } = await db.auth.getUser(token)
    if (!u?.user || u.user.app_metadata?.fwm_worker !== true) return slow(json({ error: 'signed_out' }, 401))
    // the session must still be valid in SQL terms too (not revoked, session not ended)
    const userDb = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { auth: { persistSession: false }, global: { headers: { Authorization: 'Bearer ' + token } } })
    const { data: wid } = await userDb.rpc('my_worker_id')
    if (!wid) return slow(json({ error: 'signed_out' }, 401))
    const cur = String(body.currentPin || ''), next = String(body.newPin || '')
    if (!/^\d{6}$/.test(cur)) return slow(json({ error: 'wrong_pin' }, 400))
    if (weakPin(next)) return slow(json({ error: 'weak_pin' }, 400))
    if (cur === next) return slow(json({ error: 'same_pin' }, 400))
    const { data: ok } = await db.rpc('worker_pin_verify', { p_user: u.user.id, p_secret: await pinSecret(u.user.id, cur) })
    if (!ok) return slow(json({ error: 'wrong_pin' }, 400))
    const { error: ue } = await db.auth.admin.updateUserById(u.user.id, { password: await pinSecret(u.user.id, next) })
    if (ue) return slow(json({ error: 'unavailable' }, 503))
    // Supabase Auth ends every session when a password changes, so sign the worker straight back in with the new PIN
    // and hand the app a fresh session (other devices stay signed out).
    const anon = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: si } = await anon.auth.signInWithPassword({ email: u.user.email!, password: await pinSecret(u.user.id, next) })
    const s = si?.session
    await db.rpc('worker_pin_changed', { p_user: u.user.id, p_keep_session: s ? sessionIdOf(s.access_token) : null })
    return slow(json({ ok: true, session: s ? { access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in, expires_at: s.expires_at } : null }))
  }
  return json({ error: 'unknown action' }, 400)
})
