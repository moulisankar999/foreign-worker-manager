// New-user approvals + companies test.
// SAFETY: runs ONLY against the separate TEST project (TEST_SUPABASE_URL in .secrets.env),
// refuses the live project, and refuses any project that has non-@example.com users.
import { createRequire } from 'module'
import fs from 'fs'
import crypto from 'crypto'
import { rid, cleanupOwn, makeCeo, keepConfig, addItems } from './_own.mjs'
const require = createRequire(new URL('../package.json', import.meta.url))
const { createClient } = require('@supabase/supabase-js')
const LIVE_REF = 'gnepquxtwkyffjmoydnv'
const env = Object.fromEntries(fs.readFileSync(new URL('../.secrets.env', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const URL_ = env.TEST_SUPABASE_URL, ANON = env.TEST_ANON_KEY, SERVICE = env.TEST_SERVICE_ROLE_KEY
if (!URL_ || URL_.includes(LIVE_REF) || !URL_.includes(env.TEST_PROJECT_REF)) { console.error('ABORT: not the test project'); process.exit(1) }
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(URL_, SERVICE, opts)
// suites only create/remove their own prefixed @example.com users, so other (real or other-work) users are left alone

let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : extra) }
const pw = crypto.randomBytes(12).toString('hex'), stamp = Date.now()
const U = {}
async function mk(key, meta = {}) {
  const email = `${PFX}${key}-${stamp}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: key.toUpperCase(), ...meta } })
  if (error) throw error
  const c = createClient(URL_, ANON, opts)
  const s = await c.auth.signInWithPassword({ email, password: pw }); if (s.error) throw s.error
  U[key] = { id: data.user.id, email, c }
  return U[key]
}
const prof = async (k) => (await admin.from('profiles').select('*').eq('id', U[k].id).single()).data
const inApp = async (uid, prefix) => (await admin.from('notification_deliveries').select('*').eq('user_id', uid).eq('channel', 'in_app').like('dedupe_key', prefix + '%')).data || []
const now = () => new Date().toISOString()
const W = (id, outletId) => ({ entity: 'workers', id, deleted: false, client_ts: now(), data: { id, workerNo: id, fullName: 'Worker ' + id, outletId, nationality: 'Nepal', initialBasicPay: 1700, loans: [], documents: [] } })

// fresh project state (TEST project only; guarded above)
const PFX = 'fwa-'
await cleanupOwn(admin, PFX) // only this suite's own leftovers; never other work on TEST
const O1_ = rid('O1'), O2_ = rid('O2'), O3_ = rid('O3'), O9_ = rid('O9'), W1_ = rid('W1'), W2_ = rid('W2'), W8_ = rid('W8'), W9_ = rid('W9')
const restoreCfg = await keepConfig(admin, ['hr_admin', 'notifications', 'user_approvals'])
{ for (const d of ['company', 'outlet']) { const { data: ds } = await admin.storage.from('logos').list(d); for (const f of ds || []) { const { data: fs_ } = await admin.storage.from('logos').list(`${d}/${f.name}`); if (fs_?.length) await admin.storage.from('logos').remove(fs_.map((x) => `${d}/${f.name}/${x.name}`)) } } }
const undoCos = await addItems(admin, 'companies', [{ id: 'main', name: 'Main company' }, { id: 'c2', name: 'Second Co' }]) // add-only: never replaces the TEST companies list
await admin.from('app_config').upsert({ key: 'user_approvals', value: { hrAdmins: {} } })
await admin.from('app_config').update({ value: { manageUsers: true, deleteWorkers: false, viewSalary: true, viewAudit: true } }).eq('key', 'hr_admin')
{ // make sure the notification events used here are on, in-app only (providers stay off)
  const n = (await admin.from('app_config').select('value').eq('key', 'notifications').single()).data.value
  // another suite may have reset the config to an older seed: re-add the event exactly as migration 007 does
  n.events.user_approved_by_hr ||= { label: 'New user approved by an HR Admin', group: 'Users', critical: false, enabled: true, recipients: ['super_admin'], channels: { in_app: true, push: true }, worker: {}, title: '{{title}}', sms: '' }
  for (const k of ['user_awaiting_approval', 'user_approved_by_hr', 'request_submitted']) if (n.events[k]) n.events[k].enabled = true
  await admin.from('app_config').update({ value: n }).eq('key', 'notifications')
}

try {
  const S = await mk('super')
  await makeCeo(admin, S.id)
  check('first user is super admin', (await prof('super')).role === 'super_admin')
  const r0 = await S.c.rpc('push_records', { p_rows: [
    { entity: 'outlets', id: O1_, client_ts: now(), data: { id: O1_, name: 'Outlet One', companyId: 'main' } },
    { entity: 'outlets', id: O2_, client_ts: now(), data: { id: O2_, name: 'Outlet Two', companyId: 'c2' } },
    { entity: 'outlets', id: O3_, client_ts: now(), data: { id: O3_, name: 'Outlet Three' } },
    W(W1_, O1_), W(W2_, O2_)] })
  check('seed outlets + workers', r0.data?.ok === 5, JSON.stringify(r0))
  const o3 = (await admin.from('records').select('data').eq('entity', 'outlets').eq('id', O3_).single()).data.data
  check('outlet without company defaults to main', o3.companyId === 'main')

  // public sign-up options: names only
  const anon = createClient(URL_, ANON, opts)
  const so = await anon.rpc('signup_options')
  check('anon can load company/outlet names', ['main', 'c2'].every((c) => so.data?.companies?.some((x) => x.id === c)) && [O1_, O2_, O3_].every((o) => so.data?.outlets?.some((x) => x.id === o)), JSON.stringify(so))
  check('sign-up options expose names only', so.data && so.data.outlets.every((o) => Object.keys(o).sort().join() === 'companyId,id,name') && so.data.companies.every((c) => Object.keys(c).sort().join() === 'id,name'))
  const an2 = await anon.from('records').select('id').limit(1)
  check('anon still cannot read records', !an2.data?.length)
  const an3 = await anon.rpc('approve_user', { p_id: S.id, p_role: 'viewer' })
  check('anon cannot call approve_user', !!an3.error)

  // staff
  const HRA = await mk('hra'); const HRM0 = await mk('hrm0')
  await S.c.rpc('approve_user', { p_id: HRA.id, p_role: 'hr_admin', p_company_ids: ['main'], p_outlet_ids: [] })
  await S.c.rpc('approve_user', { p_id: HRM0.id, p_role: 'hr_manager', p_company_ids: [], p_outlet_ids: [] })
  const hraP = await prof('hra')
  check('super approves HR admin scoped to company main', hraP.status === 'active' && hraP.company_ids[0] === 'main' && hraP.approved_by_role === 'super_admin', JSON.stringify(hraP))

  // sign-ups
  await mk('p1', { outlet_id: O1_ }); await mk('p2', { company_id: 'c2' }); await mk('p3'); await mk('p4', { outlet_id: 'nope', company_id: 'zzz' })
  const p1 = await prof('p1'), p2 = await prof('p2'), p4 = await prof('p4')
  check('sign-up with outlet records outlet + its company', p1.requested_outlet_id === O1_ && p1.requested_company_id === 'main' && p1.status === 'pending')
  check('sign-up with company only', p2.requested_company_id === 'c2' && !p2.requested_outlet_id)
  check('unknown outlet/company → unassigned', !p4.requested_company_id && !p4.requested_outlet_id)
  check('super admin is notified of every sign-up', (await inApp(S.id, 'newuser:' + U.p3.id)).length === 1)
  check('HR admin (not allowed) gets no sign-up notification', (await inApp(HRA.id, 'newuser:' + U.p1.id)).length === 0)

  // HR admin not allowed yet
  let pend = (await HRA.c.from('profiles').select('id').eq('status', 'pending')).data || []
  check('HR admin sees no pending users before being allowed', pend.length === 0, JSON.stringify(pend))
  let x = await HRA.c.rpc('approve_user', { p_id: U.p1.id, p_role: 'viewer', p_company_ids: ['main'] })
  check('HR admin cannot approve before being allowed', !!x.error)

  // super admin allows HR admin for company main
  const ua = await S.c.from('app_config').update({ value: { hrAdmins: { [HRA.id]: { enabled: true, companies: ['main'], roles: ['outlet_manager', 'viewer'] } } } }).eq('key', 'user_approvals').select()
  check('super admin saves approval rules', ua.data?.length === 1, JSON.stringify(ua.error))
  const ub = await HRA.c.from('app_config').update({ value: { hrAdmins: { [HRA.id]: { enabled: true, companies: ['*'], roles: ['hr_admin'] } } } }).eq('key', 'user_approvals').select()
  check('HR admin cannot change approval rules', !!ub.error || !ub.data?.length)
  await mk('p5', { outlet_id: O3_ })
  check('allowed HR admin is notified of sign-ups for his company', (await inApp(HRA.id, 'newuser:' + U.p5.id)).length === 1)
  pend = ((await HRA.c.from('profiles').select('id').eq('status', 'pending')).data || []).map((r) => r.id).sort()
  check('HR admin sees only pending users of his companies', pend.join() === [U.p1.id, U.p5.id].sort().join(), JSON.stringify(pend))
  pend = (await S.c.from('profiles').select('id').eq('status', 'pending')).data || []
  check('super admin sees ALL pending users', pend.length === 5)

  x = await HRA.c.rpc('approve_user', { p_id: U.p2.id, p_role: 'viewer', p_company_ids: ['c2'] })
  check('HR admin cannot approve sign-up of another company', !!x.error)
  x = await HRA.c.rpc('approve_user', { p_id: U.p3.id, p_role: 'viewer', p_company_ids: ['main'] })
  check('HR admin cannot approve unassigned sign-up', !!x.error)
  x = await HRA.c.rpc('approve_user', { p_id: U.p1.id, p_role: 'hr_manager', p_company_ids: ['main'] })
  check('HR admin cannot grant a role he is not allowed to', !!x.error)
  x = await HRA.c.rpc('approve_user', { p_id: U.p1.id, p_role: 'super_admin' })
  check('HR admin cannot grant super admin', !!x.error)
  x = await HRA.c.rpc('approve_user', { p_id: U.p1.id, p_role: 'outlet_manager', p_company_ids: [], p_outlet_ids: [O2_] })
  check('HR admin cannot give outlets of another company', !!x.error)
  x = await HRA.c.rpc('approve_user', { p_id: U.p1.id, p_role: 'outlet_manager', p_company_ids: [], p_outlet_ids: [] })
  check('HR admin must choose a company/outlet', !!x.error)
  x = await HRA.c.from('profiles').update({ role: 'hr_admin', status: 'active' }).eq('id', U.p5.id).select('id, role, status, outlet_ids, company_ids, must_change_password')
  check('direct table update cannot bypass the rules', !!x.error || !x.data?.length)
  x = await HRA.c.rpc('approve_user', { p_id: U.p1.id, p_role: 'outlet_manager', p_company_ids: [], p_outlet_ids: [O1_] })
  check('HR admin approves sign-up as outlet manager of O1', x.data?.status === 'active' && x.data?.approved_by === HRA.id, JSON.stringify(x.error))
  const ap = await prof('p1')
  check('approved_by / approved_at / name + role recorded', ap.approved_by_name === 'HRA' && ap.approved_by_role === 'hr_admin' && !!ap.approved_at)
  const sn = await inApp(S.id, 'userapproved:' + U.p1.id)
  check('super admin notified "User X approved by HR Admin Y"', sn.length === 1 && /User P1 approved by HR Admin HRA/.test(sn[0].title), JSON.stringify(sn.map((d) => d.title)))
  const old = await inApp(S.id, 'newuser:' + U.p1.id)
  check('the waiting item is cleared once handled', old.length === 1 && !!old[0].read_at)
  const au = (await admin.from('audit_log').select('*').eq('action', 'user.approve').eq('entity_id', U.p1.id)).data || []
  check('audit log entry for the approval', au.length === 1 && /by HRA \(HR Admin\)/.test(au[0].summary), JSON.stringify(au))
  x = await HRA.c.rpc('approve_user', { p_id: U.p1.id, p_role: 'viewer', p_company_ids: ['main'] })
  check('cannot approve twice', !!x.error)

  x = await HRA.c.rpc('reject_user', { p_id: U.p5.id, p_reason: 'Not our staff' })
  const rj = await prof('p5')
  check('HR admin rejects with reason', rj.status === 'inactive' && rj.rejected_by_role === 'hr_admin' && rj.reject_reason === 'Not our staff', JSON.stringify(x.error || rj))
  check('audit log entry for the rejection', ((await admin.from('audit_log').select('id').eq('action', 'user.reject').eq('entity_id', U.p5.id)).data || []).length === 1)
  x = await U.p2.c.rpc('approve_user', { p_id: U.p2.id, p_role: 'super_admin' })
  check('pending user cannot approve himself', !!x.error)

  x = await S.c.rpc('approve_user', { p_id: U.p3.id, p_role: 'hr_manager', p_company_ids: ['c2'] })
  check('super admin approves unassigned sign-up into company c2', x.data?.status === 'active' && x.data?.approved_by_role === 'super_admin', JSON.stringify(x.error))
  check('no "approved by HR" notification for super admin approvals', (await inApp(S.id, 'userapproved:' + U.p3.id)).length === 0)
  x = await S.c.from('profiles').update({ approved_by_name: 'Forged' }).eq('id', U.p2.id).select('id').single()
  check('approval stamps cannot be forged', !(await prof('p2')).approved_by_name)

  // company data scoping
  const mine = (ids) => ids.split(',').filter((w) => [W1_, W2_].includes(w)).sort().join()
  const pull = async (k) => { const r = await U[k].c.rpc('pull_records', { p_since: '1970-01-01', p_limit: 1000 }); if (r.error) throw r.error; return r.data.filter((r) => r.entity === 'workers' && !r.deleted).map((r) => r.id).sort().join() }
  check('HR manager scoped to c2 sees only c2 workers', mine(await pull('p3')) === W2_)
  check('HR admin scoped to main sees only main workers', mine(await pull('hra')) === W1_)
  check('unscoped HR manager sees all workers', (await pull('hrm0')).split(',').filter((w) => [W1_, W2_].includes(w)).sort().join() === [W1_, W2_].sort().join())
  check('outlet manager approved by HR admin sees his outlet', (await pull('p1')) === W1_)
  const dr = (await U.p3.c.from('records').select('id').eq('entity', 'workers')).data || []
  check('direct table read is scoped too', dr.map((r) => r.id).join() === W2_, JSON.stringify(dr))
  x = await HRA.c.rpc('push_records', { p_rows: [W(W2_, O2_), W(W9_, O2_), W(W8_, O1_)] })
  check('scoped HR admin cannot write workers of other companies', x.data?.ok === 1 && x.data.rejected.length === 2, JSON.stringify(x.data))
  x = await HRA.c.rpc('push_records', { p_rows: [{ entity: 'outlets', id: O1_, client_ts: now(), data: { id: O1_, name: 'Outlet One', companyId: 'c2' } }] })
  check('only super admin can move an outlet to another company', x.data?.ok === 0, JSON.stringify(x.data))
  x = await HRA.c.rpc('push_records', { p_rows: [{ entity: 'outlets', id: O9_, client_ts: now(), data: { id: O9_, name: 'New', companyId: 'c2' } }] })
  check('scoped HR admin cannot add outlets to other companies', x.data?.ok === 0)

  // user management scope
  const seen = ((await HRA.c.from('profiles').select('id')).data || []).map((r) => r.id)
  check('HR admin user list: his company users, not other companies', seen.includes(U.p1.id) && !seen.includes(U.p3.id) && !seen.includes(U.p2.id), JSON.stringify(seen.length))
  x = await HRA.c.from('profiles').update({ role: 'viewer' }).eq('id', U.p3.id).select('id, role, status, outlet_ids, company_ids, must_change_password')
  check('HR admin cannot change users of other companies', !!x.error || !x.data?.length)

  // requests + notifications follow the scope
  const rq = await U.p1.c.rpc('request_create', { p_type: 'other', p_worker_id: W1_, p_title: 'Test', p_data: {}, p_amount: null, p_priority: 'normal' })
  check('outlet manager creates request', !!rq.data?.id, JSON.stringify(rq.error))
  const vis3 = (await U.p3.c.from('requests').select('id')).data || []
  const vis0 = (await HRM0.c.from('requests').select('id')).data || []
  check('other-company HR manager cannot see the request', !vis3.some((x) => x.id === rq.data?.id) && vis0.some((x) => x.id === rq.data?.id))
  await new Promise((r) => setTimeout(r, 500))
  const nd = (await admin.from('notification_deliveries').select('user_id').eq('event', 'request_submitted').eq('channel', 'in_app')).data || []
  check('request notification goes to in-scope HR managers only', nd.some((d) => d.user_id === HRM0.id) && !nd.some((d) => d.user_id === U.p3.id), JSON.stringify(nd))

  // ---------- logos: private bucket, scoped read, scoped write ----------
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
  const up = (k, path, type = 'image/png') => (k === 'anon' ? anon : U[k].c).storage.from('logos').upload(path, new Blob([PNG], { type }), { contentType: type })
  const dl = async (k, path) => { const r = await (k === 'anon' ? anon : U[k].c).storage.from('logos').download(path); return !r.error && !!r.data }
  const ts = Date.now()
  const cMain = `company/main/${ts}.png`, cC2 = `company/c2/${ts}.png`, oO2 = `outlet/${O2_}/${ts}.png`, oO1 = `outlet/${O1_}/${ts}.png`
  const bucket = (await admin.storage.getBucket('logos')).data
  check('logos bucket is private and limited to PNG/JPEG ≤256 KB', bucket && bucket.public === false && bucket.file_size_limit === 262144 && bucket.allowed_mime_types?.join() === 'image/png,image/jpeg', JSON.stringify(bucket))
  check('HR admin (company main) uploads his company logo', !(await up('hra', cMain)).error)
  check('HR admin cannot upload another company logo', !!(await up('hra', cC2)).error)
  check('HR manager (c2) uploads an outlet logo in his company', !(await up('p3', oO2)).error)
  check('HR manager (c2) cannot upload an outlet logo of another company', !!(await up('p3', oO1)).error)
  check('outlet manager cannot upload logos', !!(await up('p1', `outlet/${O1_}/${ts + 1}.png`)).error)
  check('viewer cannot upload logos', !!(await up('p2', `company/c2/${ts + 2}.png`)).error)
  check('anon cannot upload logos', !!(await up('anon', `company/main/${ts + 3}.png`)).error)
  check('super admin uploads any logo', !(await up('super', cC2)).error && !(await up('super', oO1)).error)
  check('only versioned png/jpg names are accepted', !!(await up('super', 'company/main/logo.svg', 'image/png')).error && !!(await up('super', 'other/x/1.png')).error)
  check('SVG files are refused by the bucket', !!(await up('super', `company/main/${ts + 4}.png`, 'image/svg+xml')).error)
  check('outlet manager (O1) sees his outlet + company logos', (await dl('p1', oO1)) && (await dl('p1', cMain)))
  check('outlet manager does not see other companies\' logos', !(await dl('p1', oO2)) && !(await dl('p1', cC2)))
  check('HR manager (c2) sees c2 logos, not main', (await dl('p3', cC2)) && (await dl('p3', oO2)) && !(await dl('p3', cMain)))
  check('unscoped HR manager sees all logos', (await dl('hrm0', cMain)) && (await dl('hrm0', oO2)))
  check('anonymous visitors see no logos', !(await dl('anon', cMain)))
  { const a = await U.p1.c.storage.from('logos').createSignedUrl(cMain, 600), b = await U.p1.c.storage.from('logos').createSignedUrl(oO2, 600)
    check('signed URLs only for logos in scope', !!a.data?.signedUrl && !b.data?.signedUrl, JSON.stringify([a.error, b.error])) }
  x = await HRA.c.rpc('set_company_logo', { p_company: 'main', p_path: cMain })
  let cos = (await admin.from('app_config').select('value').eq('key', 'companies').single()).data.value.items
  check('HR admin sets his company logo (RPC)', !x.error && cos.find((c) => c.id === 'main')?.logo === cMain, JSON.stringify(x.error))
  check('HR admin cannot set another company logo', !!(await HRA.c.rpc('set_company_logo', { p_company: 'c2', p_path: cC2 })).error)
  check('logo path must belong to that company', !!(await HRA.c.rpc('set_company_logo', { p_company: 'main', p_path: cC2 })).error)
  check('outlet manager / viewer cannot set company logos', !!(await U.p1.c.rpc('set_company_logo', { p_company: 'main', p_path: null })).error && !!(await U.p2.c.rpc('set_company_logo', { p_company: 'c2', p_path: null })).error)
  check('anon cannot set company logos', !!(await anon.rpc('set_company_logo', { p_company: 'main', p_path: null })).error)
  check('company logo change is audited', ((await admin.from('audit_log').select('id').eq('action', 'company.logo').eq('entity_id', 'main')).data || []).length >= 1)
  const outletRow = async (id) => (await admin.from('records').select('data').eq('entity', 'outlets').eq('id', id).single()).data.data
  const O2 = await outletRow(O2_)
  x = await U.p3.c.rpc('push_records', { p_rows: [{ entity: 'outlets', id: O2_, client_ts: now(), data: { ...O2, logo: oO2 } }] })
  check('HR manager sets an outlet logo in scope', x.data?.ok === 1 && (await outletRow(O2_)).logo === oO2, JSON.stringify(x))
  x = await U.p3.c.rpc('push_records', { p_rows: [{ entity: 'outlets', id: O2_, client_ts: now(), data: { ...O2, logo: oO1 } }] })
  check('outlet logo must be that outlet\'s file', x.data?.ok !== 1 && (await outletRow(O2_)).logo === oO2, JSON.stringify(x))
  const O1 = await outletRow(O1_)
  x = await U.p1.c.rpc('push_records', { p_rows: [{ entity: 'outlets', id: O1_, client_ts: now(), data: { ...O1, logo: oO1 } }] })
  check('outlet manager cannot set an outlet logo', x.data?.ok !== 1 && !(await outletRow(O1_)).logo, JSON.stringify(x))
  check('outlet manager cannot delete logos', !((await U.p1.c.storage.from('logos').remove([cMain])).data || []).length && (await dl('hrm0', cMain)))
  x = await HRA.c.rpc('set_company_logo', { p_company: 'main', p_path: null })
  cos = (await admin.from('app_config').select('value').eq('key', 'companies').single()).data.value.items
  const rm = await HRA.c.storage.from('logos').remove([cMain])
  check('HR admin removes his company logo', !x.error && !cos.find((c) => c.id === 'main')?.logo && (rm.data || []).length === 1, JSON.stringify([x.error, rm.error]))
} catch (e) { fail++; console.error('ERROR', e) }
await cleanupOwn(admin, PFX); await restoreCfg(); await undoCos()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
