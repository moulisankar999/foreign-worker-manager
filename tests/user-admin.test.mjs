// User account management test: pause/resume, admin password reset, delete (tombstone), pending reject/delete.
// SAFETY: runs ONLY against the separate TEST project (TEST_SUPABASE_URL in .secrets.env),
// refuses the live project, and refuses any project that has non-@example.com users.
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
async function mk(key, meta = {}) {
  const email = `fwu-${key}-${stamp}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: key.toUpperCase(), ...meta } })
  if (error) throw error
  const c = mkClient()
  const s = await c.auth.signInWithPassword({ email, password: pw }); if (s.error) throw s.error
  U[key] = { id: data.user.id, email, c, session: s.data.session }
  return U[key]
}
const prof = async (k) => (await admin.from('profiles').select('*').eq('id', U[k].id).maybeSingle()).data
const fn = async (k, action, target, extra = {}) => {
  const tok = k === 'anon' ? ANON : (await U[k].c.auth.getSession()).data.session?.access_token
  const r = await fetch(`${URL_}/functions/v1/user-admin`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, userId: U[target]?.id || target, ...extra }) })
  return { status: r.status, ...(await r.json().catch(() => ({}))) }
}
const audit = async (action, id) => (await admin.from('audit_log').select('*').eq('action', action).eq('entity_id', id)).data || []
const now = () => new Date().toISOString()
const W = (id, outletId) => ({ entity: 'workers', id, deleted: false, client_ts: now(), data: { id, workerNo: id, fullName: 'Worker ' + id, outletId, nationality: 'Nepal', initialBasicPay: 1700, loans: [], documents: [] } })
const pullIds = async (c) => { const r = await c.rpc('pull_records', { p_since: '1970-01-01', p_limit: 1000 }); return r.error ? 'ERR' : r.data.filter((x) => x.entity === 'workers' && !x.deleted).map((x) => x.id).sort().join() }

// fresh project state (TEST project only; guarded above)
await admin.from('records').delete().neq('id', '__none__')
await admin.from('requests').delete().neq('type', '__none__')
{ const { data } = await admin.auth.admin.listUsers({ perPage: 1000 }); for (const u of data.users) await admin.auth.admin.deleteUser(u.id) }
await admin.from('profiles').delete().neq('id', '00000000-0000-0000-0000-000000000000') // leftovers of soft-deleted test users
await admin.from('app_config').upsert({ key: 'companies', value: { items: [{ id: 'main', name: 'Main company' }, { id: 'c2', name: 'Second Co' }] } })
await admin.from('app_config').upsert({ key: 'user_approvals', value: { hrAdmins: {} } })
await admin.from('app_config').update({ value: { manageUsers: true, deleteWorkers: false, viewSalary: true, viewAudit: true, resetPasswords: false } }).eq('key', 'hr_admin')

try {
  const S = await mk('super')
  await S.c.rpc('push_records', { p_rows: [
    { entity: 'outlets', id: 'O1', client_ts: now(), data: { id: 'O1', name: 'Outlet One', companyId: 'main' } },
    { entity: 'outlets', id: 'O2', client_ts: now(), data: { id: 'O2', name: 'Outlet Two', companyId: 'c2' } },
    W('W1', 'O1'), W('W2', 'O2')] })
  for (const k of ['s2', 'hra', 'hrb', 'om', 'v2']) await mk(k)
  const ap = (k, role, cos = [], outs = []) => S.c.rpc('approve_user', { p_id: U[k].id, p_role: role, p_company_ids: cos, p_outlet_ids: outs })
  await ap('s2', 'super_admin'); await ap('hra', 'hr_admin', ['main']); await ap('hrb', 'hr_admin', ['c2']); await ap('om', 'outlet_manager', [], ['O1']); await ap('v2', 'viewer', ['c2'])
  check('setup: om sees W1', (await pullIds(U.om.c)) === 'W1')

  // ---------- who may call ----------
  check('anon cannot call user-admin', (await fn('anon', 'pause', 'om')).status === 401)
  let r = await fn('v2', 'pause', 'om')
  check('viewer cannot pause anyone', r.status === 403, JSON.stringify(r))
  r = await fn('om', 'reset_password', 'v2')
  check('outlet manager cannot reset passwords', r.status === 403, JSON.stringify(r))
  r = await fn('super', 'nuke', 'om')
  check('unknown action refused', r.status === 400)

  // ---------- pause / resume ----------
  r = await fn('hra', 'pause', 'super')
  check('HR admin cannot pause a Super Admin', r.status === 403 && /Super Admin/.test(r.error), JSON.stringify(r))
  r = await fn('hra', 'pause', 'hrb')
  check('HR admin cannot pause another HR Admin', r.status === 403, JSON.stringify(r))
  r = await fn('hra', 'pause', 'v2')
  check('HR admin cannot pause users outside his companies', r.status === 403 && /outside/.test(r.error), JSON.stringify(r))
  r = await fn('super', 'pause', 'super')
  check('nobody can pause himself', r.status === 403 && /own account/.test(r.error), JSON.stringify(r))
  let x = await U.hra.c.from('profiles').update({ status: 'paused' }).eq('id', U.om.id).select()
  check('status "paused" cannot be set by a direct table update', !!x.error || !x.data?.length || x.data[0].status !== 'paused', JSON.stringify(x))
  r = await fn('hra', 'pause', 'om', { note: 'Investigation' })
  const pp = await prof('om')
  check('HR admin pauses an outlet manager of his company', r.ok && pp.status === 'paused', JSON.stringify(r))
  check('pause records who / when / why', pp.paused_by_name === 'HRA' && !!pp.paused_at && pp.pause_reason === 'Investigation', JSON.stringify(pp))
  check('paused: data access blocked at once (same token)', (await pullIds(U.om.c)) !== 'W1')
  const dr = (await U.om.c.from('records').select('id').eq('entity', 'workers')).data || []
  check('paused: direct table read returns nothing', dr.length === 0)
  const rf = await U.om.c.auth.refreshSession()
  check('paused: session cannot be refreshed', !!rf.error)
  const si = await mkClient().auth.signInWithPassword({ email: U.om.email, password: pw })
  check('paused: cannot sign in ("banned")', !!si.error && /banned/i.test(si.error.message), JSON.stringify(si.error))
  check('paused: audit log entry', (await audit('user.pause', U.om.id)).length === 1)
  r = await fn('hra', 'pause', 'om')
  check('cannot pause twice', r.status === 403)
  r = await fn('hra', 'resume', 'om')
  const pr = await prof('om')
  check('resume restores status and records who', r.ok && pr.status === 'active' && pr.resumed_by_name === 'HRA', JSON.stringify(r))
  const si2 = await U.om.c.auth.signInWithPassword({ email: U.om.email, password: pw })
  check('resumed: can sign in again and sees data', !si2.error && (await pullIds(U.om.c)) === 'W1', JSON.stringify(si2.error))
  r = await fn('super', 'pause', 's2')
  check('Super Admin can pause another Super Admin (not the last)', r.ok, JSON.stringify(r))
  r = await fn('super', 'resume', 's2')
  check('…and resume', r.ok && (await prof('s2')).status === 'active')
  check('pause ended the old sessions (must sign in again)', (await fn('s2', 'reset_password', 'super')).status === 401)
  await U.s2.c.auth.signInWithPassword({ email: U.s2.email, password: pw })

  // ---------- password reset ----------
  r = await fn('hra', 'reset_password', 'om')
  check('HR admin cannot reset passwords while the toggle is off', r.status === 403 && /not allowed/.test(r.error), JSON.stringify(r))
  await S.c.from('app_config').update({ value: { manageUsers: true, deleteWorkers: false, viewSalary: true, viewAudit: true, resetPasswords: true } }).eq('key', 'hr_admin')
  r = await fn('hra', 'reset_password', 'v2')
  check('HR admin cannot reset users outside his companies', r.status === 403, JSON.stringify(r))
  r = await fn('hra', 'reset_password', 'hrb')
  check('HR admin cannot reset an HR Admin', r.status === 403, JSON.stringify(r))
  r = await fn('hra', 'reset_password', 'super')
  check('HR admin cannot reset a Super Admin', r.status === 403, JSON.stringify(r))
  r = await fn('s2', 'reset_password', 'super')
  check('another Super Admin cannot reset a Super Admin', r.status === 403 && /Only that Super Admin/.test(r.error), JSON.stringify(r))
  r = await fn('hra', 'reset_password', 'om')
  const tmp = r.tempPassword
  check('HR admin (allowed) resets an in-scope user → temporary password', r.ok && typeof tmp === 'string' && tmp.length >= 10, JSON.stringify({ ...r, tempPassword: tmp ? '***' : tmp }))
  const pm = await prof('om')
  check('must_change_password set + who/when recorded', pm.must_change_password === true && pm.pw_reset_by_name === 'HRA' && !!pm.pw_reset_at)
  check('reset: audit entry (no password in it)', (await audit('user.password_reset', U.om.id)).every((a) => !a.summary.includes(tmp)) && (await audit('user.password_reset', U.om.id)).length === 1)
  check('old password no longer works', !!(await mkClient().auth.signInWithPassword({ email: U.om.email, password: pw })).error)
  const omc = mkClient()
  check('temporary password works', !(await omc.auth.signInWithPassword({ email: U.om.email, password: tmp })).error)
  x = await omc.from('profiles').update({ must_change_password: true }).eq('id', U.hra.id).select()
  check('user cannot set must_change_password on others', !!x.error || !x.data?.length)
  const newPw = crypto.randomBytes(10).toString('hex') + 'A1'
  const up = await omc.auth.updateUser({ password: newPw })
  x = await omc.rpc('password_changed')
  check('user sets his own password and clears the flag', !up.error && !x.error && (await prof('om')).must_change_password === false, JSON.stringify(up.error || x.error))
  x = await omc.from('profiles').update({ pw_reset_by_name: 'Forged' }).eq('id', U.om.id).select().single()
  check('reset stamps cannot be forged', x.error || x.data?.pw_reset_by_name === 'HRA', JSON.stringify(x))
  check('new password works', !(await mkClient().auth.signInWithPassword({ email: U.om.email, password: newPw })).error)
  U.om.c = omc
  r = await fn('super', 'reset_password', 'super')
  check('a Super Admin may reset his own password', r.ok, JSON.stringify(r))
  await admin.auth.admin.updateUserById(S.id, { password: pw }); await admin.from('profiles').update({ must_change_password: false }).eq('id', S.id)
  await S.c.auth.signInWithPassword({ email: S.email, password: pw })
  await S.c.from('app_config').update({ value: { manageUsers: true, deleteWorkers: false, viewSalary: true, viewAudit: true, resetPasswords: false } }).eq('key', 'hr_admin')

  // ---------- delete (login removed, history kept) ----------
  const rq = await U.om.c.rpc('request_create', { p_type: 'other', p_worker_id: 'W1', p_title: 'Before delete', p_data: {}, p_amount: null, p_priority: 'normal' })
  check('setup: request by the user to be deleted', !!rq.data?.id, JSON.stringify(rq.error))
  await U.om.c.rpc('push_records', { p_rows: [{ entity: 'remarks', id: 'RM1', client_ts: now(), data: { id: 'RM1', workerId: 'W1', text: 'note', by: 'OM', byId: U.om.id } }] })
  r = await fn('super', 'delete', 'super')
  check('nobody can delete himself', r.status === 403 && /own account/.test(r.error), JSON.stringify(r))
  r = await fn('hra', 'delete', 's2')
  check('HR admin cannot delete a Super Admin', r.status === 403)
  r = await fn('hra', 'delete', 'om')
  check('HR admin deletes an in-scope user', r.ok, JSON.stringify(r))
  const pd = await prof('om')
  check('profile kept as a tombstone (status deleted, who/when)', pd?.status === 'deleted' && pd.deleted_by_name === 'HRA' && !!pd.deleted_at, JSON.stringify(pd))
  const rqd = (await admin.from('requests').select('created_by_name').eq('id', rq.data.id).single()).data
  check('history kept, attributed to "deleted user OM"', rqd?.created_by_name === 'deleted user OM', JSON.stringify(rqd))
  const rm = (await admin.from('records').select('data').eq('entity', 'remarks').eq('id', 'RM1').maybeSingle()).data
  check('remarks attributed to "deleted user OM"', !rm || rm.data.by === 'deleted user OM', JSON.stringify(rm))
  const wk = (await admin.from('records').select('id').eq('entity', 'workers')).data || []
  check('no workers / business data deleted', wk.length === 2)
  check('deleted: cannot sign in', !!(await mkClient().auth.signInWithPassword({ email: U.om.email, password: newPw })).error)
  check('deleted: old session has no data', (await pullIds(U.om.c)) !== 'W1')
  check('delete: audit entry', (await audit('user.delete', U.om.id)).length === 1)
  r = await fn('super', 'resume', 'om')
  check('a deleted user cannot be resumed', r.status === 403, JSON.stringify(r))
  x = await S.c.from('profiles').update({ status: 'active' }).eq('id', U.om.id).select()
  check('a deleted user cannot be re-activated by table update', !!x.error || !x.data?.length || x.data[0].status === 'deleted', JSON.stringify(x))
  r = await fn('super', 'delete', 's2')
  check('Super Admin deletes another Super Admin (not the last)', r.ok, JSON.stringify(r))
  check('the last Super Admin is protected (DB guard)', !!(await S.c.from('profiles').update({ status: 'inactive' }).eq('id', S.id).select()).error)

  // ---------- pending sign-ups: reject / delete remove the request and its login ----------
  await mk('p1', { outlet_id: 'O1' }); await mk('p2', { company_id: 'c2' }); await mk('p3')
  r = await fn('hra', 'reject_pending', 'p1')
  check('HR admin not allowed to approve → cannot reject', r.status === 403, JSON.stringify(r))
  await S.c.from('app_config').update({ value: { hrAdmins: { [U.hra.id]: { enabled: true, companies: ['main'], roles: ['viewer', 'outlet_manager'] } } } }).eq('key', 'user_approvals')
  r = await fn('hra', 'reject_pending', 'p2')
  check('allowed HR admin cannot reject another company\'s sign-up', r.status === 403, JSON.stringify(r))
  r = await fn('hra', 'reject_pending', 'p1', { note: 'Not our staff' })
  check('allowed HR admin rejects his company\'s sign-up', r.ok, JSON.stringify(r))
  check('rejected: profile removed', !(await prof('p1')))
  check('rejected: login removed', !!(await admin.auth.admin.getUserById(U.p1.id)).error)
  check('rejected: audit entry kept', (await audit('user.reject_delete', U.p1.id)).length === 1)
  r = await fn('super', 'delete_pending', 'p2')
  check('Super Admin deletes a pending sign-up', r.ok && !(await prof('p2')) && !!(await admin.auth.admin.getUserById(U.p2.id)).error, JSON.stringify(r))
  r = await fn('super', 'delete_pending', 'hra')
  check('delete_pending refuses active users', r.status === 403, JSON.stringify(r))
  r = await fn('super', 'pause', 'p3')
  check('pending users: approve / reject first (no pause)', r.status === 403)
  const again = await admin.auth.admin.createUser({ email: U.p1.email, password: pw, email_confirm: true })
  check('a rejected email can sign up again', !again.error, JSON.stringify(again.error))
} catch (e) {
  fail++; console.log('FAIL exception', e)
}
// leave nothing behind: test users only (TEST project)
{ const { data } = await admin.auth.admin.listUsers({ perPage: 1000 }); for (const u of data.users) await admin.auth.admin.deleteUser(u.id) }
await admin.from('profiles').delete().neq('id', '00000000-0000-0000-0000-000000000000')
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
