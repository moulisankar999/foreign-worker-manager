// Server-side rules test (roles, outlet scoping, approvals, vault, passport).
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
const users = {}
async function mk(key) {
  const email = `fwm-${key}-${stamp}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: key.toUpperCase() } })
  if (error) throw error
  const c = createClient(URL_, ANON, opts)
  const s = await c.auth.signInWithPassword({ email, password: pw }); if (s.error) throw s.error
  users[key] = { id: data.user.id, c }
  return users[key]
}
// fresh project state (TEST project only; guarded above)
await admin.from('records').delete().neq('id', '__none__')
await admin.from('requests').delete().neq('type', '__none__')
await admin.from('documents').delete().neq('category', '__none__')
{ const { data } = await admin.auth.admin.listUsers({ perPage: 1000 }); for (const u of data.users) await admin.auth.admin.deleteUser(u.id) }
const seedRules = JSON.parse(/\('approval_rules', '(.+?)'::jsonb\)/.exec(fs.readFileSync(new URL('../supabase/migrations/003_roles_requests_vault.sql', import.meta.url), 'utf8'))[1].replace(/''/g, "'"))
await admin.from('app_config').update({ value: seedRules }).eq('key', 'approval_rules')
await admin.from('app_config').update({ value: { manageUsers: true, deleteWorkers: false, viewSalary: true, viewAudit: true } }).eq('key', 'hr_admin')

try {
  const S = await mk('super')
  const me = await S.c.from('profiles').select('*').eq('id', S.id).single()
  check('first user becomes active super_admin', me.data?.role === 'super_admin' && me.data?.status === 'active', JSON.stringify(me.data))
  for (const k of ['hra', 'hrm', 'om1', 'om2', 'view', 'pend']) await mk(k)
  const p0 = await S.c.from('profiles').select('role,status').eq('id', users.hra.id).single()
  check('later sign-ups are pending viewers', p0.data?.role === 'viewer' && p0.data?.status === 'pending')
  const setRole = (who, role, outlet_ids = []) => S.c.from('profiles').update({ role, status: 'active', outlet_ids }).eq('id', users[who].id).select().single()
  await setRole('hra', 'hr_admin'); await setRole('hrm', 'hr_manager'); await setRole('view', 'viewer')
  const o1 = await setRole('om1', 'outlet_manager', ['O1'])
  await setRole('om2', 'outlet_manager', ['O2'])
  check('super admin assigns outlet manager with outlets', o1.data?.outlet_ids?.[0] === 'O1', JSON.stringify(o1.error || o1.data))
  const hrmOut = await setRole('hrm', 'hr_manager', ['O1'])
  check('outlets cleared for non-outlet-manager roles', hrmOut.data?.outlet_ids?.length === 0)

  // user management limits
  const e1 = await users.hra.c.from('profiles').update({ role: 'viewer' }).eq('id', S.id).select()
  check('HR admin cannot change a super admin', !!e1.error || !e1.data?.length, JSON.stringify(e1))
  const e2 = await users.hra.c.from('profiles').update({ role: 'hr_admin' }).eq('id', users.view.id).select()
  check('HR admin cannot create HR admins', !!e2.error || !e2.data?.length)
  const e3 = await users.hra.c.from('profiles').update({ role: 'hr_manager', status: 'active' }).eq('id', users.pend.id).select().single()
  check('HR admin can activate a user as HR manager', e3.data?.role === 'hr_manager', JSON.stringify(e3.error))
  const e4 = await users.hrm.c.from('profiles').update({ status: 'disabled' }).eq('id', users.pend.id).select()
  check('HR manager cannot manage users', !!e4.error || !e4.data?.length)
  const e5 = await S.c.from('profiles').update({ role: 'viewer' }).eq('id', S.id).select()
  check('last super admin cannot demote himself', !!e5.error, JSON.stringify(e5.data))

  // data via push_records
  const now = () => new Date().toISOString()
  const W = (id, outletId, extra = {}) => ({ entity: 'workers', id, deleted: false, client_ts: now(), data: { id, workerNo: id, fullName: 'Worker ' + id, outletId, nationality: 'Nepal', initialBasicPay: 1700, bankAccount: '123', loans: [], documents: [], ...extra } })
  const r1 = await S.c.rpc('push_records', { p_rows: [{ entity: 'outlets', id: 'O1', client_ts: now(), data: { id: 'O1', name: 'Outlet 1' } }, { entity: 'outlets', id: 'O2', client_ts: now(), data: { id: 'O2', name: 'Outlet 2' } }, W('W1', 'O1'), W('W2', 'O2'), W('W3', 'O1')] })
  check('super admin push_records ok', r1.data?.ok === 5, JSON.stringify(r1))
  const pull = async (who) => { const r = await users[who].c.rpc('pull_records', { p_since: '1970-01-01', p_limit: 1000 }); if (r.error) throw r.error; return r.data }
  const om1Rows = await pull('om1')
  const w1 = om1Rows.find((r) => r.id === 'W1'), w2 = om1Rows.find((r) => r.id === 'W2')
  check('outlet manager sees his outlet worker', w1 && !w1.deleted && w1.data.fullName === 'Worker W1')
  check('outlet manager gets no salary/bank fields', w1 && w1.data.initialBasicPay === undefined && w1.data.bankAccount === undefined && w1.data.loans === undefined)
  check('other-outlet worker is hidden (tombstone, empty data)', w2 && w2.deleted && Object.keys(w2.data).length === 0)
  const dir = await users.om1.c.from('records').select('id').eq('entity', 'workers')
  check('outlet manager direct table read returns no workers', (dir.data || []).length === 0)
  const viewRows = await pull('view')
  check('viewer sees all workers without salary', viewRows.filter((r) => r.entity === 'workers' && !r.deleted).length === 3 && viewRows.find((r) => r.id === 'W2').data.initialBasicPay === undefined)
  const hrmRows = await pull('hrm')
  check('HR manager sees salary', hrmRows.find((r) => r.id === 'W2').data.initialBasicPay === 1700)

  const p1 = await users.om1.c.rpc('push_records', { p_rows: [W('W1', 'O1', { fullName: 'HACK' })] })
  check('outlet manager cannot edit worker master data', p1.data?.ok === 0 && p1.data?.rejected?.length === 1)
  const p2 = await users.view.c.rpc('push_records', { p_rows: [{ entity: 'remarks', id: 'R0', client_ts: now(), data: { workerId: 'W1', text: 'x' } }] })
  check('viewer cannot add remarks', p2.data?.ok === 0)
  const p3 = await users.om1.c.rpc('push_records', { p_rows: [{ entity: 'remarks', id: 'R1', client_ts: now(), data: { workerId: 'W1', text: 'Late today', byId: 'someone-else' } }, { entity: 'remarks', id: 'R2', client_ts: now(), data: { workerId: 'W2', text: 'x' } }] })
  check('outlet manager adds remark for his worker, not others', p3.data?.ok === 1 && p3.data.rejected[0]?.id === 'R2', JSON.stringify(p3))
  const rr = (await pull('om1')).find((r) => r.id === 'R1')
  check('remark author forced to caller', rr?.data?.byId === users.om1.id)
  const om2r = (await pull('om2')).find((r) => r.id === 'R1')
  check('other outlet manager cannot see the remark', !om2r || om2r.deleted)
  const p4 = await users.hrm.c.rpc('push_records', { p_rows: [{ ...W('W3', 'O1'), deleted: true }] })
  check('HR manager cannot delete workers (default)', p4.data?.ok === 0)

  // salary protection when HR admin is not allowed salary
  await S.c.from('app_config').update({ value: { manageUsers: true, deleteWorkers: false, viewSalary: false, viewAudit: true } }).eq('key', 'hr_admin')
  const hraRows = await pull('hra')
  check('HR admin without salary right gets no salary', hraRows.find((r) => r.id === 'W1').data.initialBasicPay === undefined)
  const hw = hraRows.find((r) => r.id === 'W1')
  const p5 = await users.hra.c.rpc('push_records', { p_rows: [{ entity: 'workers', id: 'W1', client_ts: now(), deleted: false, data: { ...hw.data, phone: '0123' } }] })
  const w1s = (await admin.from('records').select('data').eq('entity', 'workers').eq('id', 'W1').single()).data.data
  check('HR admin edit keeps hidden salary fields intact', p5.data?.ok === 1 && w1s.initialBasicPay === 1700 && w1s.bankAccount === '123' && w1s.phone === '0123', JSON.stringify(p5))
  const c1 = await users.hra.c.from('app_config').update({ value: {} }).eq('key', 'approval_rules').select()
  check('HR admin cannot edit approval rules', !!c1.error || !c1.data?.length)
  await S.c.from('app_config').update({ value: { manageUsers: true, deleteWorkers: false, viewSalary: true, viewAudit: true } }).eq('key', 'hr_admin')
  await S.c.rpc('push_records', { p_rows: [{ ...W('W3', 'O1'), data: { ...W('W3', 'O1').data, initialBasicPay: 1800 } }] })

  // requests workflow
  const create = (who, type, wid, amount, data = {}) => users[who].c.rpc('request_create', { p_type: type, p_worker_id: wid, p_title: type, p_data: data, p_amount: amount, p_priority: 'normal' })
  const act = (who, id, action, comment = null, patch = null) => users[who].c.rpc('request_act', { p_id: id, p_action: action, p_comment: comment, p_patch: patch })
  const a1 = await create('om1', 'salary_advance', 'W1', 300)
  check('advance within limit needs HR admin', a1.data?.required_level === 'hr_admin', JSON.stringify(a1.error))
  const a2 = await create('om1', 'salary_advance', 'W1', 800)
  check('advance above limit needs super admin', a2.data?.required_level === 'super_admin')
  const a3 = await create('om1', 'loan', 'W1', 100)
  check('loan always needs super admin', a3.data?.required_level === 'super_admin')
  const a4 = await create('om1', 'salary_advance', 'W2', 100)
  check('outlet manager cannot request for other outlet', !!a4.error)
  const a5 = await create('view', 'other', 'W1', null)
  check('viewer cannot create requests', !!a5.error)
  let x = await act('hra', a1.data.id, 'approve')
  check('HR admin cannot skip HR manager review', !!x.error)
  x = await act('om1', a1.data.id, 'approve')
  check('outlet manager cannot approve', !!x.error)
  x = await act('hrm', a1.data.id, 'return')
  check('return needs a reason', !!x.error)
  x = await act('hrm', a1.data.id, 'return', 'Which month?')
  check('HR manager returns for info', x.data?.status === 'returned')
  x = await act('om1', a1.data.id, 'resubmit', 'For October', { data: { month: '2026-10' }, amount: 300 })
  check('requester resubmits', x.data?.status === 'submitted')
  x = await act('hrm', a1.data.id, 'forward', 'OK')
  check('HR manager recommends', x.data?.status === 'recommended')
  x = await act('hra', a1.data.id, 'approve', 'Approved')
  check('HR admin approves within limit', x.data?.status === 'approved', JSON.stringify(x.error))
  x = await act('om1', a1.data.id, 'apply')
  check('outlet manager cannot apply', !!x.error)
  x = await act('hrm', a1.data.id, 'apply', null, { applied: 'advance' })
  check('HR manager applies → completed', x.data?.status === 'completed')
  await act('hrm', a2.data.id, 'forward')
  x = await act('hra', a2.data.id, 'approve')
  check('HR admin escalates above limit', x.data?.status === 'escalated', JSON.stringify(x))
  x = await act('hra', a2.data.id, 'approve')
  check('HR admin cannot approve escalated', !!x.error)
  x = await act('super', a2.data.id, 'approve')
  check('super admin approves escalated', x.data?.status === 'approved')
  const own = await create('hra', 'salary_advance', 'W1', 50)
  await act('hrm', own.data.id, 'forward')
  x = await act('hra', own.data.id, 'approve')
  check('no self-approval', !!x.error)
  const ev = await users.om1.c.from('request_events').select('*').eq('request_id', a1.data.id).order('id')
  check('requester sees full timeline', ev.data?.length === 6 && ev.data[1].comment === 'Which month?', JSON.stringify(ev.data?.map((e) => e.action)))
  const om2q = await users.om2.c.from('requests').select('id')
  check('other outlet manager sees none of these requests', om2q.data?.length === 0)
  const vq = await users.view.c.from('requests').select('id')
  check('viewer can see requests (read-only)', vq.data?.length >= 3)
  const ins = await users.om1.c.from('requests').insert({ type: 'x', worker_id: 'W1' })
  check('no direct inserts into requests', !!ins.error)
  // rules change by super admin applies
  const rules = (await S.c.from('app_config').select('value').eq('key', 'approval_rules').single()).data.value
  rules.types.salary_advance.limit = 1000
  await S.c.from('app_config').update({ value: rules }).eq('key', 'approval_rules')
  const a6 = await create('om1', 'salary_advance', 'W1', 800)
  check('edited limit takes effect', a6.data?.required_level === 'hr_admin')

  // emergency leave
  let em = await create('om1', 'emergency_leave', 'W1', null, { from: '2026-11-01', to: '2026-11-14' })
  check('emergency leave needs a reason', !!em.error)
  em = await create('om1', 'emergency_leave', 'W1', null, { reasonKey: 'death' })
  check('death reason needs relationship', !!em.error)
  em = await create('om1', 'emergency_leave', 'W1', null, { reasonKey: 'other', reasonDetail: 'short' })
  check('"Other" needs detailed explanation', !!em.error)
  em = await create('om1', 'emergency_leave', 'W1', null, { reasonKey: 'death', relationship: 'Father', from: '2026-11-01', to: '2026-11-14' })
  check('emergency leave with reason accepted', !!em.data?.id, JSON.stringify(em.error))
  await act('hrm', em.data.id, 'forward')
  x = await act('hra', em.data.id, 'approve')
  check('approval blocked without flight ticket', !!x.error && /flight ticket/i.test(x.error.message))

  // vault & storage
  const pdf = new Blob([Buffer.from('%PDF-1.4\n%%EOF')], { type: 'application/pdf' })
  const path = `vault/W1/${crypto.randomUUID()}.pdf`
  const up = await users.om1.c.storage.from('attachments').upload(path, pdf, { contentType: 'application/pdf' })
  check('outlet manager uploads to his worker vault', !up.error, JSON.stringify(up.error))
  const up2 = await users.om1.c.storage.from('attachments').upload(`vault/W2/${crypto.randomUUID()}.pdf`, pdf)
  check('outlet manager cannot upload for other outlet', !!up2.error)
  const d1 = await users.om1.c.from('documents').insert({ worker_id: 'W1', category: 'Flight ticket', title: 'MH ticket', file_path: path, mime: 'application/pdf', size_bytes: 14, request_id: em.data.id, uploaded_by: users.om1.id }).select().single()
  check('ticket document attached to request', !!d1.data?.id && d1.data.version === 1, JSON.stringify(d1.error))
  x = await act('hra', em.data.id, 'approve')
  check('emergency leave approved once ticket attached', x.data?.status === 'approved', JSON.stringify(x.error))
  const sg = await users.om1.c.storage.from('attachments').createSignedUrl(path, 60)
  check('outlet manager gets signed URL for own doc', !!sg.data?.signedUrl)
  const sg2 = await users.om2.c.storage.from('attachments').createSignedUrl(path, 60)
  check('other outlet manager cannot get signed URL', !!sg2.error || !sg2.data?.signedUrl)
  const restricted = await users.om1.c.from('documents').insert({ worker_id: 'W1', category: 'Payslip', file_path: path, uploaded_by: users.om1.id })
  check('outlet manager cannot upload restricted category', !!restricted.error)
  const pay = await users.hrm.c.from('documents').insert({ worker_id: 'W1', category: 'Payslip', title: 'Oct', file_path: `vault/W1/pay.pdf`, uploaded_by: users.hrm.id }).select().single()
  const seePay = await users.om1.c.from('documents').select('id').eq('id', pay.data?.id)
  check('restricted category hidden from outlet manager', !!pay.data && seePay.data?.length === 0)
  const v2 = await users.hrm.c.from('documents').insert({ worker_id: 'W1', category: 'Flight ticket', title: 'MH ticket (changed)', file_path: `vault/W1/t2.pdf`, group_id: d1.data.group_id, uploaded_by: users.hrm.id }).select().single()
  const old = await users.hrm.c.from('documents').select('is_current').eq('id', d1.data.id).single()
  check('new version increments and keeps history', v2.data?.version === 2 && old.data?.is_current === false, JSON.stringify(v2.error))
  const om2docs = await users.om2.c.from('documents').select('id')
  check('other outlet manager sees no documents', om2docs.data?.length === 0)

  // passport safekeeping
  const pf = await users.om1.c.rpc('passport_forms_issued', { p_worker_ids: ['W1', 'W2', 'W3'] })
  check('consent forms issued only for own workers', pf.data === 2, JSON.stringify(pf))
  let w = (await admin.from('records').select('data').eq('id', 'W1').eq('entity', 'workers').single()).data.data
  check('consent status pending signature', w.passportSafe?.consent === 'pending')
  const cpath = `vault/W1/${crypto.randomUUID()}.pdf`
  await users.om1.c.storage.from('attachments').upload(cpath, pdf, { contentType: 'application/pdf' })
  const cd = await users.om1.c.from('documents').insert({ worker_id: 'W1', category: 'Passport safekeeping consent', file_path: cpath, uploaded_by: users.om1.id }).select().single()
  w = (await admin.from('records').select('data').eq('id', 'W1').eq('entity', 'workers').single()).data.data
  check('signed consent upload → "uploaded, HR to verify"', w.passportSafe?.consent === 'uploaded' && w.passportSafe.consentDocId === cd.data?.id)
  check('salary untouched by consent hooks', w.initialBasicPay === 1700 && w.bankAccount === '123')
  const pr = await create('om1', 'passport', 'W1', null, { action: 'Release', reason: 'Renewal at embassy' })
  check('passport release request needs only HR manager', pr.data?.required_level === 'hr_manager')
  x = await act('hrm', pr.data.id, 'approve', 'Released at 3pm')
  check('HR manager approves passport release directly', x.data?.status === 'approved', JSON.stringify(x.error))

  // audit
  const au = await S.c.from('audit_log').select('action')
  const acts = new Set(au.data?.map((a) => a.action))
  check('audit log records users, config, salary, requests, documents', ['user.update', 'config.update', 'worker.salary_change', 'request.approve', 'document.upload', 'document.new_version'].every((a) => acts.has(a)), [...acts].join(','))
  const au2 = await users.hrm.c.from('audit_log').select('id')
  check('HR manager cannot read audit log', au2.data?.length === 0)
  const anon = createClient(URL_, ANON, opts)
  const an = await anon.rpc('pull_records', { p_since: '1970-01-01' })
  check('anonymous cannot call pull_records', !!an.error || an.data?.length === 0)
  const an2 = await anon.from('documents').select('id')
  check('anonymous cannot read documents', !!an2.error || an2.data?.length === 0)
} catch (e) { fail++; console.log('FAIL exception', e.message || e) }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
