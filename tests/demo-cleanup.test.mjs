// Remove sample (DEMO) data test: preview, permissions, only DEMO removed, users reassigned, real data untouched.
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
const T0 = new Date(Date.now() - 5000).toISOString()
const audit = async (action, id) => (await admin.from('audit_log').select('*').eq('action', action).eq('entity_id', id).gte('at', T0)).data || []
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


const rec = async (entity, id) => (await admin.from('records').select('*').eq('entity', entity).eq('id', id).maybeSingle()).data
try {
  const S = await mk('super')
  const O = (id, name) => ({ entity: 'outlets', id, client_ts: now(), data: { id, name, companyId: 'main', type: 'Restaurant' } })
  const Wn = (id, name, outletId) => { const w = W(id, outletId); w.data.fullName = name; return w }
  const p = await S.c.rpc('push_records', { p_rows: [
    O('D1', 'DEMO Mart 24 – Cheras'), O('D2', 'DEMO Banana Leaf – Brickfields'), O('D3', 'DEMO Shared Outlet'), O('R1', 'NILLA VAANAVIL SDN BHD'), O('R2', 'DEMOGRAPHIC Cafe'),
    Wn('WD1', 'DEMO Rahim Uddin', 'D1'), Wn('WD2', 'DEMO Siti Rahayu', 'D2'), Wn('WR1', 'MUTHTHALAGU VANNIYAPPAN', 'R1'), Wn('WR2', 'Real In Demo Outlet', 'D3'), Wn('WR3', 'Demo Lowercase Person', 'R2'),
    { entity: 'jobs', id: 'J1', client_ts: now(), data: { id: 'J1', name: 'Cook', businessType: 'Restaurant' } },
    { entity: 'remarks', id: 'RM1', client_ts: now(), data: { id: 'RM1', workerId: 'WD1', text: 'demo remark' } },
    { entity: 'remarks', id: 'RM2', client_ts: now(), data: { id: 'RM2', workerId: 'WR1', text: 'real remark' } }] })
  check('setup: records pushed', !p.error && !(p.data?.rejected || []).length, JSON.stringify(p))
  for (const k of ['om', 'hrm', 'hra']) await mk(k)
  const ap = (k, role, cos = [], outs = []) => S.c.rpc('approve_user', { p_id: U[k].id, p_role: role, p_company_ids: cos, p_outlet_ids: outs })
  await ap('om', 'outlet_manager', [], ['D1']); await ap('hrm', 'hr_manager', ['main'], ['D2']); await ap('hra', 'hr_admin', [], ['D1', 'R1'])
  check('setup: om on D1', JSON.stringify((await prof('om')).outlet_ids) === '["D1"]', JSON.stringify(await prof('om')))
  const rq = async (wid, status) => (await admin.from('requests').insert({ type: 'annual_leave', worker_id: wid, title: 't', status, created_by: S.id }).select('id').single()).data.id
  const q1 = await rq('WD1', 'submitted'), q2 = await rq('WD2', 'approved'), q3 = await rq('WR1', 'submitted')
  const dk = async (wid) => (await admin.from('documents').insert({ worker_id: wid, category: 'Other', title: 'x', file_path: `${wid}/x.pdf`, uploaded_by: S.id }).select('id').single())
  const d1 = await dk('WD1'), d2 = await dk('WR1')
  check('setup: documents', !d1.error && !d2.error, JSON.stringify(d1.error || d2.error))
  const before = { WR1: await rec('workers', 'WR1'), WR2: await rec('workers', 'WR2'), R1: await rec('outlets', 'R1'), J1: await rec('jobs', 'J1') }

  // ---------- permissions ----------
  for (const k of ['hra', 'hrm', 'om']) {
    const r = await U[k].c.rpc('demo_data_preview')
    check(`${k} cannot preview`, !!r.error, JSON.stringify(r.data))
    const x = await U[k].c.rpc('remove_demo_data', { p_reassign: {}, p_confirm: 'REMOVE' })
    check(`${k} cannot remove`, !!x.error)
  }
  check('anon cannot remove', !!(await mkClient().rpc('remove_demo_data', { p_reassign: {}, p_confirm: 'REMOVE' })).error)

  // ---------- preview ----------
  const pv = (await S.c.rpc('demo_data_preview')).data
  console.log('preview', JSON.stringify(pv))
  check('preview: 2 DEMO workers, 2 DEMO outlets', pv?.workers === 2 && pv?.outlets === 2)
  check('preview: DEMO outlet with a real worker is kept', JSON.stringify(pv?.outletsKept) === '["DEMO Shared Outlet"]')
  check('preview: remarks/documents/requests', pv.remarks === 1 && pv.documents === 1 && pv.requests === 2 && pv.requestsOpen === 1)
  check('preview: real outlets listed', pv.realOutlets.map((o) => o.id).sort().join() === 'R1,R2')
  check('preview: 3 users on DEMO outlets', pv.users.map((u) => u.id).sort().join() === [U.om.id, U.hrm.id, U.hra.id].sort().join())
  check('preview: hra has 1 other real outlet', pv.users.find((u) => u.id === U.hra.id)?.otherOutlets === 1)
  check('preview changes nothing', !(await rec('workers', 'WD1')).deleted)

  // ---------- guards ----------
  let r = await S.c.rpc('remove_demo_data', { p_reassign: {}, p_confirm: 'remove' })
  check('wrong confirmation word refused', !!r.error && /REMOVE/.test(r.error.message))
  r = await S.c.rpc('remove_demo_data', { p_reassign: { [U.om.id]: 'D2' }, p_confirm: 'REMOVE' })
  check('reassign to a DEMO outlet refused', !!r.error)
  check('refused run changed nothing', !(await rec('workers', 'WD1')).deleted && JSON.stringify((await prof('om')).outlet_ids) === '["D1"]')

  // ---------- remove ----------
  r = await S.c.rpc('remove_demo_data', { p_reassign: { [U.om.id]: 'R1', [U.hrm.id]: null }, p_confirm: 'REMOVE' })
  console.log('result', JSON.stringify(r.data || r.error))
  check('remove ok', !r.error && r.data.workers === 2 && r.data.outlets === 2 && r.data.requestsCancelled === 1 && r.data.usersMoved === 3)
  check('DEMO workers soft-deleted', (await rec('workers', 'WD1')).deleted && (await rec('workers', 'WD2')).deleted)
  check('DEMO outlets soft-deleted', (await rec('outlets', 'D1')).deleted && (await rec('outlets', 'D2')).deleted)
  check('DEMO outlet with real worker kept', !(await rec('outlets', 'D3')).deleted)
  for (const [k, e] of [['WR1', 'workers'], ['WR2', 'workers'], ['R1', 'outlets'], ['J1', 'jobs']]) {
    const a = await rec(e, k)
    check(`real ${e} ${k} untouched`, !a.deleted && a.client_ts === before[k].client_ts && a.server_ts === before[k].server_ts && JSON.stringify(a.data) === JSON.stringify(before[k].data))
  }
  const wr3 = await rec('workers', 'WR3'), r2 = await rec('outlets', 'R2')
  check("names like 'Demo …' / 'DEMOGRAPHIC' are not sample data", !wr3.deleted && !r2.deleted)
  check('DEMO remark deleted, real remark kept', (await rec('remarks', 'RM1')).deleted && !(await rec('remarks', 'RM2')).deleted)
  const docs = (await admin.from('documents').select('id,deleted').in('id', [d1.data.id, d2.data.id])).data
  check('DEMO document deleted, real kept', docs.find((d) => d.id === d1.data.id).deleted && !docs.find((d) => d.id === d2.data.id).deleted)
  const qs = Object.fromEntries((await admin.from('requests').select('id,status').in('id', [q1, q2, q3])).data.map((x) => [x.id, x.status]))
  check('open DEMO request cancelled, decided kept, real untouched', qs[q1] === 'cancelled' && qs[q2] === 'approved' && qs[q3] === 'submitted', JSON.stringify(qs))
  const ev = (await admin.from('request_events').select('*').eq('request_id', q1)).data
  check('cleanup event written', ev.some((e) => e.action === 'cleanup' && e.to_status === 'cancelled'))
  const nq = (await admin.from('notification_events').select('id').eq('request_id', q1)).data
  check('no notification for the cancelled DEMO request', nq.length === 0, JSON.stringify(nq))
  check('om moved to the real outlet', JSON.stringify((await prof('om')).outlet_ids) === '["R1"]')
  check('hrm left unassigned', JSON.stringify((await prof('hrm')).outlet_ids) === '[]')
  check('hra keeps only real outlet', JSON.stringify((await prof('hra')).outlet_ids) === '["R1"]')
  const au = await audit('demo.remove', 'demo-data')
  check('audit log entry', au.length === 1 && au[0].details?.workers === 2, JSON.stringify(au))
  check('om now sees the real worker', (await pullIds(U.om.c)) === 'WR1')
  const sup = (await S.c.rpc('pull_records', { p_since: '1970-01-01', p_limit: 1000 })).data
  check('deleted DEMO rows reach devices as deletions', sup.some((x) => x.id === 'WD1' && x.deleted))
  const pv2 = (await S.c.rpc('demo_data_preview')).data
  check('second preview: nothing left', pv2.workers === 0 && pv2.outlets === 0 && pv2.users.length === 0)
} catch (e) {
  fail++; console.log('FAIL exception', e)
}
// leave nothing behind (TEST project)
await admin.from('records').delete().neq('id', '__none__')
await admin.from('requests').delete().neq('type', '__none__')
await admin.from('documents').delete().neq('category', '__none__')
{ const { data } = await admin.auth.admin.listUsers({ perPage: 1000 }); for (const u of data.users) await admin.auth.admin.deleteUser(u.id) }
await admin.from('profiles').delete().neq('id', '00000000-0000-0000-0000-000000000000')
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
