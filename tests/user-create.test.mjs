// Direct user creation ("Add user") hierarchy test: each role tries to add each role, cross-company attempts,
// GM without the 'users.create' power, duplicates, forged sign-up metadata, active-at-once + forced password change,
// and the "only assign roles below your own" editing rule.
// SAFETY: runs ONLY against the separate TEST project (TEST_SUPABASE_URL in .secrets.env),
// refuses the live project, and refuses any project that has non-@example.com users. Never prints passwords.
import { createRequire } from 'module'
import fs from 'fs'
import crypto from 'crypto'
const require = createRequire(new URL('../package.json', import.meta.url))
const { createClient } = require('@supabase/supabase-js')
const LIVE_REF = 'gnepquxtwkyffjmoydnv'
const env = Object.fromEntries(fs.readFileSync(new URL('../.secrets.env', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const URL_ = env.TEST_SUPABASE_URL, ANON = env.TEST_ANON_KEY, SERVICE = env.TEST_SERVICE_ROLE_KEY
if (!URL_ || URL_.includes(LIVE_REF) || !URL_.includes(env.TEST_PROJECT_REF)) { console.error('ABORT: not the test project'); process.exit(1) }
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(URL_, SERVICE, opts)
{ const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 }); if (error) throw error
  if (data.users.some((u) => !/@example\.com$/.test(u.email || ''))) { console.error('ABORT: project has real users'); process.exit(1) } }

let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : extra) }
const pw = crypto.randomBytes(12).toString('hex'), stamp = Date.now()
const U = {}
const mkClient = () => createClient(URL_, ANON, opts)
async function mk(key) {
  const email = `fwc-${key}-${stamp}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: key.toUpperCase() } })
  if (error) throw error
  const c = mkClient(); const s = await c.auth.signInWithPassword({ email, password: pw }); if (s.error) throw s.error
  U[key] = { id: data.user.id, email, c }
  return U[key]
}
const prof = async (id) => (await admin.from('profiles').select('*').eq('id', id).maybeSingle()).data
const strip = (r) => { const { tempPassword, ...rest } = r; return JSON.stringify({ ...rest, tempPassword: tempPassword ? '(hidden)' : undefined }) }
const create = async (k, body) => {
  const tok = (await U[k].c.auth.getSession()).data.session?.access_token
  const r = await fetch(`${URL_}/functions/v1/user-admin`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create_user', ...body }) })
  return { status: r.status, ...(await r.json().catch(() => ({}))) }
}
const now = () => new Date().toISOString()
let n = 0
const newEmail = (tag) => `fwc-new${++n}-${tag}-${stamp}@example.com`

await admin.from('records').delete().neq('id', '__none__')
await admin.from('requests').delete().neq('type', '__none__')
{ const { data } = await admin.auth.admin.listUsers({ perPage: 1000 }); for (const u of data.users) await admin.auth.admin.deleteUser(u.id) }
await admin.from('profiles').delete().neq('id', '00000000-0000-0000-0000-000000000000')
await admin.from('app_config').upsert({ key: 'companies', value: { items: [{ id: 'main', name: 'Main company' }, { id: 'c2', name: 'Second Co' }] } })
await admin.from('app_config').upsert({ key: 'gm_powers', value: { powers: {} } })

try {
  const S = await mk('ceo')
  await S.c.rpc('push_records', { p_rows: [
    { entity: 'outlets', id: 'O1', client_ts: now(), data: { id: 'O1', name: 'Outlet One', companyId: 'main' } },
    { entity: 'outlets', id: 'O2', client_ts: now(), data: { id: 'O2', name: 'Outlet Two', companyId: 'c2' } }] })
  for (const k of ['gm', 'hra', 'hrm', 'om', 'v']) await mk(k)
  const ap = (k, role, cos = [], outs = []) => S.c.rpc('approve_user', { p_id: U[k].id, p_role: role, p_company_ids: cos, p_outlet_ids: outs })
  await ap('gm', 'general_manager'); await ap('hra', 'hr_admin', ['main']); await ap('hrm', 'hr_manager', ['main']); await ap('om', 'outlet_manager', [], ['O1']); await ap('v', 'viewer', ['main'])
  check('setup roles', (await prof(U.gm.id)).role === 'general_manager' && (await prof(U.hrm.id)).role === 'hr_manager')

  // ------------------------------------------------ matrix: each role tries to add each role
  const ROLES = ['super_admin', 'general_manager', 'hr_admin', 'hr_manager', 'outlet_manager', 'viewer']
  const OK = { ceo: ['general_manager', 'hr_admin', 'hr_manager', 'outlet_manager', 'viewer'], gm: ['hr_admin', 'hr_manager', 'outlet_manager', 'viewer'],
               hra: ['hr_manager', 'outlet_manager', 'viewer'], hrm: ['outlet_manager'], om: [], v: [] }
  const created = {}
  for (const actor of Object.keys(OK)) for (const role of ROLES) {
    const scope = role === 'outlet_manager' ? { companyIds: [], outletIds: ['O1'] } : role === 'general_manager' || role === 'super_admin' ? { companyIds: [], outletIds: [] } : { companyIds: ['main'], outletIds: [] }
    const r = await create(actor, { email: newEmail(actor + '-' + role), fullName: `New ${role} by ${actor}`, phone: '+60123456789', role, ...scope })
    const want = OK[actor].includes(role)
    check(`${actor} ${want ? 'can' : 'cannot'} add ${role}`, want ? r.status === 200 && r.ok && !!r.tempPassword : r.status === 403 && !r.userId, strip(r))
    if (want && r.userId) created[actor + ':' + role] = { ...r }
  }

  // ------------------------------------------------ a created user: active, forced change, "Added by", audit, can sign in
  const c1 = created['hrm:outlet_manager']
  const p1 = c1 && await prof(c1.userId)
  check('created user is active at once', p1?.status === 'active' && p1.role === 'outlet_manager' && p1.outlet_ids?.[0] === 'O1', JSON.stringify(p1))
  check('created user must change password', p1?.must_change_password === true)
  check('created user is marked Added by', p1?.added_by === U.hrm.id && p1.added_by_name === 'HRM' && p1.added_by_role === 'hr_manager' && p1.approved_by === U.hrm.id)
  check('phone saved in E.164', p1?.phone === '+60123456789')
  const au = (await admin.from('audit_log').select('*').eq('action', 'user.create').eq('entity_id', c1?.userId)).data || []
  check('audit says Added by HR Manager', au.length === 1 && /^Added by HR Manager HRM/.test(au[0].summary) && au[0].user_id === U.hrm.id, JSON.stringify(au))
  check('audit has no password', !JSON.stringify(au).includes(c1?.tempPassword || '§'))
  { const em = (await prof(c1.userId)).email; const c = mkClient(); const s = await c.auth.signInWithPassword({ email: em, password: c1.tempPassword })
    check('created user signs in with the temporary password', !s.error, s.error?.message) }
  check('CEO-added GM has no scope', (await prof(created['ceo:general_manager']?.userId))?.company_ids?.length === 0)

  // ------------------------------------------------ cross-company / scope
  let r = await create('hra', { email: newEmail('x1'), fullName: 'Cross HRM', role: 'hr_manager', companyIds: ['c2'] })
  check('HR Admin (main) cannot add HR Manager for c2', r.status === 403 && /manage/.test(r.error), strip(r))
  r = await create('hra', { email: newEmail('x2'), fullName: 'Cross OM', role: 'outlet_manager', outletIds: ['O2'] })
  check('HR Admin (main) cannot add Outlet Manager for O2', r.status === 403, strip(r))
  r = await create('hrm', { email: newEmail('x3'), fullName: 'Cross OM2', role: 'outlet_manager', outletIds: ['O2'] })
  check('HR Manager (main) cannot add Outlet Manager for O2 (other company)', r.status === 403 && /outlets in your companies/.test(r.error), strip(r))
  r = await create('hrm', { email: newEmail('x4'), fullName: 'Whole co', role: 'outlet_manager', companyIds: ['main'], outletIds: ['O1'] })
  check('HR Manager cannot hand out whole companies', r.status === 403, strip(r))
  r = await create('hrm', { email: newEmail('x5'), fullName: 'No outlet', role: 'outlet_manager', outletIds: [] })
  check('Outlet Manager needs an outlet', r.status === 403 && /outlet/.test(r.error), strip(r))
  r = await create('ceo', { email: newEmail('x6'), fullName: 'Ghost', role: 'hr_manager', companyIds: ['nope'] })
  check('unknown company refused', r.status === 403 && /Unknown company/.test(r.error), strip(r))

  // ------------------------------------------------ GM power off
  await S.c.rpc('set_gm_powers', { p_powers: { 'users.create': false } })
  r = await create('gm', { email: newEmail('gmoff'), fullName: 'GM off', role: 'hr_manager', companyIds: ['main'] })
  check('GM cannot add users when the CEO switched "users.create" off', r.status === 403 && /CEO has not allowed/.test(r.error), strip(r))
  await S.c.rpc('set_gm_powers', { p_powers: { 'users.create': true } })
  r = await create('gm', { email: newEmail('gmon'), fullName: 'GM on', role: 'hr_manager', companyIds: ['main'] })
  check('GM can add again when switched back on', r.status === 200, strip(r))

  // ------------------------------------------------ validation + duplicates
  r = await create('ceo', { email: 'not-an-email', fullName: 'Bad', role: 'viewer' })
  check('invalid email refused', r.status === 400)
  r = await create('ceo', { email: newEmail('ph'), fullName: 'Bad phone', role: 'viewer', phone: '0123456' })
  check('non-E.164 mobile refused', r.status === 400 && /international/.test(r.error))
  r = await create('ceo', { email: newEmail('pw'), fullName: 'Weak pw', role: 'viewer', tempPassword: 'short' })
  check('weak chosen temporary password refused', r.status === 400)
  const hrmEmail = (await prof(c1.userId)).email
  r = await create('ceo', { email: hrmEmail.toUpperCase(), fullName: 'Dup', role: 'viewer' })
  check('duplicate email: clear error + offer to edit (below the CEO)', r.status === 409 && /already exists/.test(r.error) && r.duplicate === c1.userId && r.editable === true, strip(r))
  r = await create('hrm', { email: U.hra.email, fullName: 'Dup2', role: 'outlet_manager', outletIds: ['O1'] })
  check('duplicate email of a higher user: error, not editable', r.status === 409 && !r.editable, strip(r))

  // ------------------------------------------------ forged metadata through normal sign-up stays pending
  { const em = newEmail('forge') // same trigger path as a public sign-up (no confirmation email sent)
    const s = await admin.auth.admin.createUser({ email: em, password: pw, email_confirm: true, user_metadata: { full_name: 'Forger', fwm_ticket: crypto.randomBytes(24).toString('hex'), fwm_added_by: U.ceo.id, fwm_role: 'general_manager' } })
    const id = s.data?.user?.id; const fp = id && await prof(id)
    check('self sign-up with forged metadata stays pending viewer', fp?.status === 'pending' && fp.role === 'viewer', JSON.stringify(fp)) }

  // ------------------------------------------------ editing: only roles below your own, only users below you
  let e = await S.c.from('profiles').update({ role: 'super_admin' }).eq('id', U.hra.id).select()
  check('CEO cannot make another CEO from the app', !!e.error && /CEO role/.test(e.error.message), JSON.stringify(e.error))
  e = await U.gm.c.from('profiles').update({ role: 'general_manager' }).eq('id', U.hra.id).select()
  check('GM cannot make a GM', !!e.error || !e.data?.length)
  e = await U.hra.c.from('profiles').update({ role: 'hr_admin' }).eq('id', U.hrm.id).select()
  check('HR Admin cannot make an HR Admin', !!e.error || !e.data?.length)
  e = await U.hrm.c.from('profiles').update({ role: 'viewer' }).eq('id', U.om.id).select()
  check('HR Manager cannot edit roles', !!e.error || !e.data?.length)
  e = await S.c.from('profiles').update({ role: 'hr_manager', company_ids: ['main'] }).eq('id', U.v.id).select()
  check('CEO can still change roles below CEO', !e.error && e.data?.[0]?.role === 'hr_manager', JSON.stringify(e.error))
  const cr = await U.hrm.c.rpc('creatable_roles', { p_actor: U.hrm.id })
  check('creatable_roles for HR Manager = Outlet Manager', JSON.stringify(cr.data) === '["outlet_manager"]', JSON.stringify(cr))
  const cr2 = await U.hrm.c.rpc('creatable_roles', { p_actor: U.ceo.id })
  check('cannot read another person\'s creatable roles', JSON.stringify(cr2.data) === '[]', JSON.stringify(cr2))
} catch (e) { console.error(e); fail++ }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
