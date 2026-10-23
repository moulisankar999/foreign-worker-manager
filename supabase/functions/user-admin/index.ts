// user-admin: CEO / HR Admin account actions that need the Auth admin API.
//   POST {action, userId, note?, sendEmail?, redirectTo?}
//   action: 'pause' | 'resume' | 'delete' | 'reset_password' | 'reject_pending' | 'delete_pending'
//   POST {action:'create_user', email, fullName, phone?, role, companyIds[], outletIds[], tempPassword?, sendEmail?, channels[]}
//     adds an ACTIVE user directly; who may add which role is decided in SQL (user_create_check / creatable_roles)
// The caller's JWT is verified here; who-may-do-what is decided in SQL (public.user_admin_check) with the same
// rules as the approvals feature. History is never deleted: 'delete' removes the LOGIN (soft-deletes the auth user)
// and leaves a 'deleted' profile tombstone; requests / remarks / documents keep their rows as "deleted user <name>".
// The temporary password is returned once to the admin and never stored or logged.
import { createClient } from 'npm:@supabase/supabase-js@2'

const env = (k: string) => (Deno.env.get(k) || '').trim()
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const ACTIONS = ['pause', 'resume', 'delete', 'reset_password', 'reject_pending', 'delete_pending']
const OK_REDIRECT = /^(https:\/\/fw\.sunrisebayumas\.com\/|https:\/\/moulisankar999\.github\.io\/foreign-worker-manager\/|http:\/\/localhost:\d+\/)/
const BAN = '876000h' // ~100 years; lifted on resume

function tempPassword() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ', a = 'abcdefghijkmnpqrstuvwxyz', d = '23456789', all = A + a + d
  const r = crypto.getRandomValues(new Uint32Array(12))
  const ch = Array.from(r, (x, i) => (i === 0 ? A : i === 1 ? a : i === 2 ? d : all)[x % (i === 0 ? A.length : i === 1 ? a.length : i === 2 ? d.length : all.length)])
  // shuffle so the classes are not always first
  const s = crypto.getRandomValues(new Uint32Array(12))
  for (let i = ch.length - 1; i > 0; i--) { const j = s[i] % (i + 1); [ch[i], ch[j]] = [ch[j], ch[i]] }
  return ch.slice(0, 4).join('') + '-' + ch.slice(4, 8).join('') + '-' + ch.slice(8).join('')
}

const strArr = (v: unknown) => Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.length < 80).slice(0, 200) as string[] : []
const pwBad = (p: string) => p.length < 10 || p.length > 64 || !/[A-Za-z]/.test(p) || !/\d/.test(p) || /\s/.test(p)

// deno-lint-ignore no-explicit-any
async function createUser(db: any, actor: string, body: Record<string, unknown>) {
  const email = String(body.email || '').trim().toLowerCase()
  const fullName = String(body.fullName || '').trim().slice(0, 120)
  const phone = String(body.phone || '').replace(/[\s-]/g, '')
  const role = String(body.role || '')
  const companyIds = strArr(body.companyIds), outletIds = strArr(body.outletIds)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return json({ error: 'Enter a valid email address' }, 400)
  if (fullName.length < 2) return json({ error: 'Enter the full name' }, 400)
  if (phone && !/^\+[1-9]\d{7,14}$/.test(phone)) return json({ error: 'Mobile number must be in international format, e.g. +60123456789' }, 400)
  const { data: chk, error: ce } = await db.rpc('user_create_check', { p_actor: actor, p_email: email, p_role: role, p_companies: companyIds, p_outlets: outletIds })
  if (ce) return json({ error: ce.message }, 500)
  if (chk?.error) return json({ error: chk.error, duplicate: chk.duplicate || undefined, editable: chk.editable || undefined }, chk.duplicate !== undefined ? 409 : 403)
  const chosen = typeof body.tempPassword === 'string' ? body.tempPassword : ''
  if (chosen && pwBad(chosen)) return json({ error: 'Temporary password: 10–64 characters, letters and numbers, no spaces.' }, 400)
  const pw = chosen || tempPassword()
  // one-time ticket: the sign-up trigger turns it into an ACTIVE profile (re-checking the creator's rights)
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('')
  const { error: te } = await db.from('user_create_tickets').insert({ nonce, email, actor, role, company_ids: companyIds, outlet_ids: outletIds, phone: phone || null })
  if (te) return json({ error: 'Could not add the user: ' + te.message }, 500)
  const { data: cu, error: ue } = await db.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: fullName, fwm_ticket: nonce } })
  if (cu?.user) await db.auth.admin.updateUserById(cu.user.id, { user_metadata: { full_name: fullName, fwm_ticket: null } })
  else await db.from('user_create_tickets').delete().eq('nonce', nonce)
  if (ue || !cu?.user) {
    const m = ue?.message || 'unknown error'
    return json({ error: /already|registered|exists/i.test(m) ? 'A user with this email already exists' : 'Could not add the user: ' + m }, /already|registered|exists/i.test(m) ? 409 : 500)
  }
  const channels = strArr(body.channels).filter((c) => ['email', 'whatsapp', 'sms'].includes(c))
  const { error: ae } = await db.rpc('user_create_audit', { p_actor: actor, p_target: cu.user.id, p_channels: channels })
  if (ae) return json({ error: 'User added, but the audit entry failed: ' + ae.message, userId: cu.user.id, tempPassword: pw }, 200)
  let emailed = false, emailNote: string | undefined
  if (body.sendEmail) {
    const redirectTo = OK_REDIRECT.test(String(body.redirectTo || '')) ? String(body.redirectTo) : 'https://fw.sunrisebayumas.com/'
    const anon = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
    const { error: me } = await anon.auth.resetPasswordForEmail(email, { redirectTo })
    if (me) emailNote = 'Email not sent: ' + me.message; else emailed = true
  }
  return json({ ok: true, userId: cu.user.id, tempPassword: pw, emailed, emailNote })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const { data: u } = token ? await db.auth.getUser(token) : { data: null }
  if (!u?.user) return json({ error: 'Please sign in again' }, 401)
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || ''), userId = String(body.userId || ''), note = body.note ? String(body.note).slice(0, 300) : null
  if (action === 'create_user') return await createUser(db, u.user.id, body)
  if (!ACTIONS.includes(action) || !/^[0-9a-f-]{36}$/i.test(userId)) return json({ error: 'Bad request' }, 400)

  const { data: why, error: ce } = await db.rpc('user_admin_check', { p_actor: u.user.id, p_target: userId, p_action: action })
  if (ce) return json({ error: ce.message }, 500)
  if (why) return json({ error: why }, 403)
  const apply = async () => {
    const { data, error } = await db.rpc('user_admin_apply', { p_actor: u.user.id, p_target: userId, p_action: action, p_note: note })
    if (error) throw new Error(error.message)
    return data as { email?: string; name?: string }
  }

  try {
    if (action === 'pause') {
      const { error } = await db.auth.admin.updateUserById(userId, { ban_duration: BAN })
      if (error) return json({ error: 'Could not block sign-in: ' + error.message }, 500)
      try { await apply() } catch (e) { await db.auth.admin.updateUserById(userId, { ban_duration: 'none' }); throw e }
      return json({ ok: true })
    }
    if (action === 'resume') {
      const { error } = await db.auth.admin.updateUserById(userId, { ban_duration: 'none' })
      if (error) return json({ error: 'Could not lift the sign-in block: ' + error.message }, 500)
      await apply()
      return json({ ok: true })
    }
    if (action === 'reset_password') {
      // the CEO / admin may type the temporary password; otherwise a strong one is generated. Never stored or logged.
      const chosen = typeof body.tempPassword === 'string' ? body.tempPassword : ''
      if (chosen && (chosen.length < 10 || chosen.length > 64 || !/[A-Za-z]/.test(chosen) || !/\d/.test(chosen) || /\s/.test(chosen)))
        return json({ error: 'Temporary password: 10–64 characters, letters and numbers, no spaces.' }, 400)
      const pw = chosen || tempPassword()
      const { data: au, error } = await db.auth.admin.updateUserById(userId, { password: pw })
      if (error) return json({ error: 'Could not set the password: ' + error.message }, 500)
      await apply()
      let emailed: string | null = null
      if (body.sendEmail && au?.user?.email) {
        const redirectTo = OK_REDIRECT.test(String(body.redirectTo || '')) ? String(body.redirectTo) : 'https://fw.sunrisebayumas.com/'
        const anon = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
        const { error: me } = await anon.auth.resetPasswordForEmail(au.user.email, { redirectTo })
        emailed = me ? 'Reset email not sent: ' + me.message : 'sent'
      }
      return json({ ok: true, tempPassword: pw, emailed: emailed === 'sent', emailNote: emailed && emailed !== 'sent' ? emailed : undefined })
    }
    if (action === 'delete') {
      const r = await apply() // tombstone + "deleted user <name>" attribution first, so history is safe
      const { error } = await db.auth.admin.deleteUser(userId, true) // soft delete: the profile row (and history) stays
      if (error) return json({ ok: true, warning: 'Access removed, but the login could not be deleted: ' + error.message, ...r })
      return json({ ok: true, ...r })
    }
    // reject_pending / delete_pending: the sign-up never had access — remove it and its login completely (audited first)
    await apply()
    const { error } = await db.auth.admin.deleteUser(userId, false)
    if (error) return json({ error: 'Sign-up rejected, but its login could not be removed: ' + error.message }, 500)
    return json({ ok: true })
  } catch (e) {
    return json({ error: (e as Error).message }, 400)
  }
})
