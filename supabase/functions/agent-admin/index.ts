// agent-admin: HR Admin / GM / CEO create or reset the login of an external recruitment agent (Quota & Recruitment).
//   POST {action:'create_login', agentId, email?, tempPassword?}  -> {ok, email, tempPassword}
//   POST {action:'reset_password', agentId}                        -> {ok, email, tempPassword}
// Agent logins are auth users WITHOUT a staff profile (app_metadata.fwm_agent = true): handle_new_user skips them, so every
// staff table stays invisible; the agent portal reads only agent_me / agent_recruits. Who may act is decided in SQL
// (qr_agent_login_check); revoking an agent is done in SQL (qr_agent_revoke) and takes effect at once.
// The temporary password is returned once to the admin and never stored or logged.
import { createClient } from 'npm:@supabase/supabase-js@2'

const env = (k: string) => (Deno.env.get(k) || '').trim()
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const pwBad = (p: string) => p.length < 10 || p.length > 64 || !/[A-Za-z]/.test(p) || !/\d/.test(p) || /\s/.test(p)

function tempPassword() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ', a = 'abcdefghijkmnpqrstuvwxyz', d = '23456789', all = A + a + d
  const r = crypto.getRandomValues(new Uint32Array(12))
  const ch = Array.from(r, (x, i) => (i === 0 ? A : i === 1 ? a : i === 2 ? d : all)[x % (i === 0 ? A.length : i === 1 ? a.length : i === 2 ? d.length : all.length)])
  const s = crypto.getRandomValues(new Uint32Array(12))
  for (let i = ch.length - 1; i > 0; i--) { const j = s[i] % (i + 1); [ch[i], ch[j]] = [ch[j], ch[i]] }
  return ch.slice(0, 4).join('') + '-' + ch.slice(4, 8).join('') + '-' + ch.slice(8).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const { data: who } = await db.auth.getUser(token)
  if (!who?.user) return json({ error: 'Sign in again' }, 401)
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'Bad request' }, 400) }
  const action = String(body.action || ''), agentId = String(body.agentId || '')
  if (!['create_login', 'reset_password'].includes(action) || !/^[0-9a-f-]{36}$/.test(agentId)) return json({ error: 'Bad request' }, 400)
  const { data: chk, error: ce } = await db.rpc('qr_agent_login_check', { p_actor: who.user.id, p_agent: agentId })
  if (ce) return json({ error: ce.message }, 500)
  if (chk?.error) return json({ error: chk.error }, 403)
  const chosen = typeof body.tempPassword === 'string' ? body.tempPassword : ''
  if (chosen && pwBad(chosen)) return json({ error: 'Temporary password: 10–64 characters, letters and numbers, no spaces.' }, 400)
  const pw = chosen || tempPassword()

  if (action === 'reset_password') {
    if (!chk.user_id) return json({ error: 'This agent has no login yet — create it first.' }, 400)
    const { error } = await db.auth.admin.updateUserById(chk.user_id, { password: pw })
    if (error) return json({ error: 'Could not reset: ' + error.message }, 500)
    await db.rpc('qr_agent_login_set', { p_actor: who.user.id, p_agent: agentId, p_user: null, p_action: 'password_reset' })
    return json({ ok: true, email: chk.email, tempPassword: pw })
  }
  if (chk.user_id) return json({ error: 'This agent already has a login — use Reset password.' }, 409)
  const email = String(body.email || chk.email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return json({ error: 'Enter the agent\'s email address' }, 400)
  const { data: cu, error: ue } = await db.auth.admin.createUser({
    email, password: pw, email_confirm: true,
    app_metadata: { fwm_agent: 'true', agent_id: agentId },
    user_metadata: { full_name: String(chk.contact || chk.agency || '').slice(0, 120), fwm_agent: 'true' },
  })
  if (ue || !cu?.user) {
    const m = ue?.message || 'unknown error'
    return json({ error: /already|registered|exists/i.test(m) ? 'A login with this email already exists' : 'Could not create the login: ' + m }, /already|registered|exists/i.test(m) ? 409 : 500)
  }
  const { error: se } = await db.rpc('qr_agent_login_set', { p_actor: who.user.id, p_agent: agentId, p_user: cu.user.id, p_action: 'login_created' })
  if (se) { await db.auth.admin.deleteUser(cu.user.id); return json({ error: 'Could not link the login: ' + se.message }, 500) }
  return json({ ok: true, email, tempPassword: pw })
})
