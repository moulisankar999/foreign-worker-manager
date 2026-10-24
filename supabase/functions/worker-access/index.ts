// worker-access: FW Manager "App access" actions for one worker's FW Worker login.
//   POST {action, workerId}   action: 'generate' | 'reset' | 'revoke' | 'restore' | 'unlock'
// Only CEO / General Manager / HR Admin / HR Manager (in scope) — decided in SQL (worker_access_can), never by the UI.
// generate / reset return the new 6-digit PIN ONCE; it is never stored or logged (only an HMAC-derived password in Auth).
// revoke: status → revoked + every session / refresh token deleted (immediate), then the Auth user is banned.
// Every action is audit-logged in SQL with the real actor (worker_access_apply).
import { createClient } from 'npm:@supabase/supabase-js@2'

const env = (k: string) => (Deno.env.get(k) || '').trim()
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const BAN = '876000h'
const ACTIONS = ['generate', 'reset', 'revoke', 'restore', 'unlock']

const enc = new TextEncoder()
const b64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
async function pinSecret(uid: string, pin: string) {
  const k = await crypto.subtle.importKey('raw', enc.encode(env('WORKER_PIN_PEPPER')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64url(await crypto.subtle.sign('HMAC', k, enc.encode(uid + ':' + pin)))
}
function weakPin(p: string) {
  if (/^(\d)\1{5}$/.test(p)) return true
  const d = p.split('').map(Number), step = d[1] - d[0]
  if ((step === 1 || step === -1) && d.every((x, i) => i === 0 || x - d[i - 1] === step)) return true
  return p.slice(0, 3) === p.slice(3) || p.slice(0, 2).repeat(3) === p
}
function newPin() {
  for (;;) {
    const x = crypto.getRandomValues(new Uint32Array(1))[0]
    if (x >= 4_294_000_000) continue // no modulo bias
    const p = String(x % 1_000_000).padStart(6, '0')
    if (!weakPin(p)) return p
  }
}
const randomPassword = () => b64url(crypto.getRandomValues(new Uint8Array(32)).buffer)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  if (env('WORKER_PIN_PEPPER').length < 32) return json({ error: 'Worker app is not configured on the server' }, 500)
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  const { data: u } = await db.auth.getUser(token)
  if (!u?.user) return json({ error: 'Please sign in again' }, 401)
  if (u.user.app_metadata?.fwm_worker === true) return json({ error: 'Not allowed' }, 403)
  const actor = u.user.id
  // deno-lint-ignore no-explicit-any
  let body: any = {}
  try { body = await req.json() } catch { return json({ error: 'bad request' }, 400) }
  const action = String(body.action || ''), workerId = String(body.workerId || '').slice(0, 80)
  if (!ACTIONS.includes(action) || !workerId) return json({ error: 'bad request' }, 400)

  const { data: chk, error: ce } = await db.rpc('worker_access_check', { p_actor: actor, p_worker: workerId })
  if (ce) return json({ error: 'Server error' }, 500)
  if (chk?.error) return json({ error: chk.error }, 403)
  const apply = async (userId?: string) => {
    const { error } = await db.rpc('worker_access_apply', { p_actor: actor, p_worker: workerId, p_action: action, p_user: userId ?? null })
    return error
  }

  if (action === 'generate') {
    if (chk.userId) return json({ error: 'PIN already set — use Reset PIN' }, 409)
    if (!chk.passport) return json({ error: 'Add the passport number to this worker first' }, 400)
    if (chk.duplicatePassport) return json({ error: 'Another worker with app access has the same passport number' }, 409)
    const domain = env('WORKER_EMAIL_DOMAIN') || 'worker.fw.sunrisebayumas.com'
    const { data: cu, error: ue } = await db.auth.admin.createUser({
      email: `worker-${crypto.randomUUID()}@${domain}`, password: randomPassword(), email_confirm: true,
      app_metadata: { fwm_worker: true, worker_id: workerId }, user_metadata: { fwm_worker: true },
    })
    if (ue || !cu?.user) return json({ error: 'Could not create the login' }, 500)
    const pin = newPin()
    const { error: pe } = await db.auth.admin.updateUserById(cu.user.id, { password: await pinSecret(cu.user.id, pin) })
    const ae = pe ? pe : await apply(cu.user.id)
    if (ae) { await db.auth.admin.deleteUser(cu.user.id); return json({ error: ae.message || 'Could not create the login' }, 400) }
    return json({ ok: true, pin })
  }
  if (!chk.userId) return json({ error: 'No app login for this worker yet' }, 400)

  if (action === 'reset') {
    if (chk.status === 'revoked') return json({ error: 'Access is revoked — restore it first' }, 409)
    const pin = newPin()
    const { error: pe } = await db.auth.admin.updateUserById(chk.userId, { password: await pinSecret(chk.userId, pin), ban_duration: 'none' })
    if (pe) return json({ error: 'Could not reset the PIN' }, 500)
    const ae = await apply()
    if (ae) return json({ error: ae.message }, 400)
    return json({ ok: true, pin })
  }
  if (action === 'revoke') {
    const ae = await apply() // status + sessions first: immediate
    if (ae) return json({ error: ae.message }, 400)
    await db.auth.admin.updateUserById(chk.userId, { ban_duration: BAN })
    return json({ ok: true })
  }
  if (action === 'restore') {
    const { error: be } = await db.auth.admin.updateUserById(chk.userId, { ban_duration: 'none' })
    if (be) return json({ error: 'Could not restore' }, 500)
    const ae = await apply()
    if (ae) return json({ error: ae.message }, 400)
    return json({ ok: true })
  }
  const ae = await apply() // unlock
  if (ae) return json({ error: ae.message }, 400)
  return json({ ok: true })
})
