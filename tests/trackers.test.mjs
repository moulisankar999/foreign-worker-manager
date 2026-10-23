// v1.2.2 trackers & risk: tracker config permissions, zero-cost translations, grievance channel (anon submit,
// anonymity, status code, HR-only read, rate limit, link off/rotate), PDPA breach log, medical file limits,
// cost tracker hidden as pay data, 2027 minimum wage + SME exemption (pure functions).
// SAFETY: runs ONLY against the separate TEST project (TEST_SUPABASE_URL in .secrets.env),
// refuses the live project, and refuses any project that has non-@example.com users. Never prints passwords.
import { createRequire } from 'module'
import fs from 'fs'
import crypto from 'crypto'
import { execSync } from 'child_process'
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
  const email = `fwt-${key}-${stamp}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: key.toUpperCase() } })
  if (error) throw error
  const c = mkClient(); const s = await c.auth.signInWithPassword({ email, password: pw }); if (s.error) throw s.error
  U[key] = { id: data.user.id, email, c }
  return U[key]
}
const now = () => new Date().toISOString()
const err = (r) => r.error ? r.error.message : 'no error'
// clean TEST
await admin.from('records').delete().neq('id', '__none__')
await admin.from('grievances').delete().neq('ref_no', '__none__')
await admin.from('grievance_links').delete().neq('company_id', '__none__')
await admin.from('pdpa_breaches').delete().neq('title', '__none__')
{ const { data } = await admin.auth.admin.listUsers({ perPage: 1000 }); for (const u of data.users) await admin.auth.admin.deleteUser(u.id) }
await admin.from('profiles').delete().neq('id', '00000000-0000-0000-0000-000000000000')
await admin.from('app_config').upsert({ key: 'companies', value: { items: [{ id: 'main', name: 'Main company' }, { id: 'c2', name: 'Second Sdn Bhd' }] } })
await admin.from('app_config').upsert({ key: 'gm_powers', value: { powers: {} } })
const anon = mkClient()

try {
  const S = await mk('ceo')
  const p = await S.c.rpc('push_records', { p_rows: [
    { entity: 'outlets', id: 'O1', client_ts: now(), data: { id: 'O1', name: 'Outlet One', companyId: 'main' } },
    { entity: 'outlets', id: 'O2', client_ts: now(), data: { id: 'O2', name: 'Outlet Two', companyId: 'c2' } },
    { entity: 'workers', id: 'W1', client_ts: now(), data: { id: 'W1', workerNo: 'FW1', fullName: 'Test Worker One', outletId: 'O1', nationality: 'Nepal', status: 'Active-Working', joinDate: '2024-01-01',
      documents: [{ id: 'D1', type: 'FOMEMA Medical', expiryDate: '2027-01-01' }, { id: 'D2', type: 'Passport', expiryDate: '2030-01-01' }], loans: [], leaves: [],
      costs: [{ id: 'C1', date: '2026-01-05', type: 'Levy', amount: 1850, paidBy: 'Company' }], initialBasicPay: 1700, hostelId: 'H1', zeroCost: { status: 'signed' } } }] })
  check('seed records', p.data?.ok === 3, JSON.stringify(p))
  for (const k of ['gm', 'hra', 'hrm', 'om', 'viewer']) await mk(k)
  const ap = (k, role, cos = [], outs = []) => S.c.rpc('approve_user', { p_id: U[k].id, p_role: role, p_company_ids: cos, p_outlet_ids: outs })
  await ap('gm', 'general_manager'); await ap('hra', 'hr_admin'); await ap('hrm', 'hr_manager'); await ap('om', 'outlet_manager', [], ['O1']); await ap('viewer', 'viewer')

  // ---- tracker config permissions
  const cfgv = async (k) => (await admin.from('app_config').select('value').eq('key', k).maybeSingle()).data?.value
  let r = await U.hrm.c.rpc('set_tracker_config', { p_key: 'hostels', p_value: { items: [{ id: 'H1', name: 'Hostel A', capacity: 4, inspections: [] }] } })
  check('HR Manager can update the hostel register', !r.error && (await cfgv('hostels'))?.items?.[0]?.name === 'Hostel A', err(r))
  r = await U.hrm.c.rpc('set_tracker_config', { p_key: 'hiring', p_value: { items: [] } }); check('HR Manager can update the hiring tracker', !r.error, err(r))
  r = await U.om.c.rpc('set_tracker_config', { p_key: 'hostels', p_value: { items: [] } }); check('Outlet manager cannot change the hostel register', !!r.error && (await cfgv('hostels'))?.items?.length === 1)
  r = await U.viewer.c.rpc('set_tracker_config', { p_key: 'hiring', p_value: { items: [] } }); check('Viewer cannot change the hiring tracker', !!r.error)
  r = await U.hrm.c.rpc('set_tracker_config', { p_key: 'trackers', p_value: { stayCapYears: 10 } }); check('HR Manager cannot change tracker rules', !!r.error)
  r = await U.hra.c.rpc('set_tracker_config', { p_key: 'trackers', p_value: { stayCapYears: 10, costDefaults: { Levy: 1850 } } }); check('HR Admin can change tracker rules', !r.error, err(r))
  r = await S.c.rpc('set_tracker_config', { p_key: 'records', p_value: {} }); check('unknown setting key refused', !!r.error)
  r = await S.c.rpc('set_tracker_config', { p_key: 'hiring', p_value: [] }); check('non-object value refused', !!r.error)
  await admin.from('app_config').upsert({ key: 'gm_powers', value: { powers: { 'compliance.settings': false } } })
  r = await U.gm.c.rpc('set_tracker_config', { p_key: 'trackers', p_value: { stayCapYears: 10 } }); check('GM without the settings power cannot change tracker rules', !!r.error)
  await admin.from('app_config').upsert({ key: 'gm_powers', value: { powers: {} } })
  r = await U.gm.c.rpc('set_tracker_config', { p_key: 'trackers', p_value: { stayCapYears: 10 } }); check('GM with the settings power can change tracker rules', !r.error, err(r))

  // ---- zero-cost translations
  r = await U.hra.c.rpc('set_form_translation', { p_form: 'zerocost', p_lang: 'ne', p_text: { text: { title: 'X' }, checked: true } })
  check('HR Admin saves a zero-cost translation', !r.error && (await cfgv('zerocost_translations'))?.items?.ne?.text?.title === 'X', err(r))
  r = await U.hrm.c.rpc('set_form_translation', { p_form: 'zerocost', p_lang: 'ne', p_text: { text: {} } }); check('HR Manager cannot edit translations', !!r.error)
  r = await U.hra.c.rpc('set_form_translation', { p_form: 'consent', p_lang: 'ne', p_text: null }); check('unknown form refused', !!r.error)
  r = await U.hra.c.rpc('set_form_translation', { p_form: 'zerocost', p_lang: 'ne', p_text: null }); check('reset removes the language', !r.error && !(await cfgv('zerocost_translations'))?.items?.ne)

  // ---- grievance link
  r = await U.om.c.rpc('get_grievance_link', { p_company: 'main', p_rotate: false, p_enabled: null }); check('Outlet manager cannot get the grievance link', !!r.error)
  r = await U.hra.c.rpc('get_grievance_link', { p_company: 'main', p_rotate: false, p_enabled: null })
  const tok = r.data?.token
  check('HR Admin gets a link (created, enabled, can manage)', r.data?.ok && tok?.length >= 16 && r.data.enabled && r.data.canManage, JSON.stringify({ ...r.data, token: tok ? '(set)' : null }))
  r = await U.hrm.c.rpc('get_grievance_link', { p_company: 'main', p_rotate: true, p_enabled: null })
  check('HR Manager sees the link but cannot rotate it', r.data?.token === tok && r.data?.canManage === false, JSON.stringify(r.data && { ...r.data, token: '(x)' }))
  r = await anon.rpc('grievance_link_info', { p_token: tok })
  check('public link info: company + its outlets only', r.data?.ok && r.data.company === 'Main company' && r.data.outlets.length === 1 && r.data.outlets[0].id === 'O1', JSON.stringify(r.data))
  r = await anon.rpc('grievance_link_info', { p_token: 'nope' }); check('unknown token → not ok', r.data?.ok === false)
  // ---- anonymous submit
  r = await anon.rpc('submit_grievance', { p_token: tok, p: { message: 'My salary is late by two months', category: 'pay', outletId: 'O1', anonymous: true, name: 'Should Drop', contact: '0123', workerNo: 'FW1', language: 'ne' } })
  const g1 = r.data
  check('anonymous submission returns ref and code', /^G-\d{6}-/.test(g1?.ref || '') && g1?.code?.length === 10, err(r))
  let row = (await admin.from('grievances').select('*').eq('ref_no', g1.ref).single()).data
  check('anonymous: name/contact/worker no. dropped', row.anonymous && row.name === null && row.contact === null && row.worker_no === null && row.outlet_id === 'O1' && row.language === 'ne')
  check('tracking code stored only as a hash', row.track_hash && row.track_hash !== g1.code && !JSON.stringify(row).includes(g1.code))
  r = await anon.rpc('submit_grievance', { p_token: tok, p: { message: 'Hostel has no water for days', category: 'housing', outletId: 'O2', anonymous: false, name: 'Ram', contact: '0199', workerNo: 'FW1' } })
  const g2 = r.data
  row = (await admin.from('grievances').select('*').eq('ref_no', g2.ref).single()).data
  check('named submission keeps name; other-company outlet dropped', row.name === 'Ram' && row.contact === '0199' && row.outlet_id === null)
  r = await anon.rpc('submit_grievance', { p_token: tok, p: { message: 'short' } }); check('too-short message refused', !!r.error)
  r = await anon.rpc('submit_grievance', { p_token: 'nope', p: { message: 'long enough message here' } }); check('bad token refused', !!r.error)
  r = await anon.rpc('submit_grievance', { p_token: tok, p: { message: 'odd category message', category: 'xyz' } })
  check('unknown category becomes other', (await admin.from('grievances').select('category').eq('ref_no', r.data?.ref).single()).data?.category === 'other')
  r = await anon.from('grievances').select('*'); check('anon cannot read grievances', !!r.error || (r.data || []).length === 0)
  r = await anon.rpc('grievance_status', { p_code: g1.code.toLowerCase() })
  check('status by code (case-insensitive): new, no message text', r.data?.ok && r.data.status === 'new' && r.data.ref === g1.ref && !JSON.stringify(r.data).includes('salary'), JSON.stringify(r.data))
  r = await anon.rpc('grievance_status', { p_code: 'WRONGCODE1' }); check('wrong code → not ok', r.data?.ok === false)
  // ---- who reads
  r = await U.om.c.from('grievances').select('id'); check('Outlet manager sees no grievances', !r.error && r.data.length === 0, err(r))
  r = await U.viewer.c.from('grievances').select('id'); check('Viewer sees no grievances', !r.error && r.data.length === 0)
  r = await U.hrm.c.from('grievances').select('id,track_hash'); check('HR Manager sees grievances', !r.error && r.data.length === 3, err(r))
  r = await U.gm.c.from('grievances').select('id'); check('GM sees grievances', r.data?.length === 3)
  // ---- HR update
  const gid = (await admin.from('grievances').select('id').eq('ref_no', g1.ref).single()).data.id
  r = await U.om.c.rpc('update_grievance', { p_id: gid, p_status: 'closed', p_note: null, p_reply: null }); check('Outlet manager cannot update a grievance', !!r.error)
  r = await U.hrm.c.rpc('update_grievance', { p_id: gid, p_status: 'in_review', p_note: 'called payroll', p_reply: 'We are checking your pay.' }); check('HR Manager updates status + reply', !r.error, err(r))
  r = await U.hrm.c.rpc('update_grievance', { p_id: gid, p_status: 'bogus', p_note: null, p_reply: null }); check('invalid status refused', !!r.error)
  row = (await admin.from('grievances').select('*').eq('id', gid).single()).data
  check('history records the change', row.status === 'in_review' && row.history.length === 2 && row.history[1].note === 'called payroll')
  r = await anon.rpc('grievance_status', { p_code: g1.code }); check('worker sees status + reply, not the internal note', r.data?.status === 'in_review' && r.data.reply === 'We are checking your pay.' && !JSON.stringify(r.data).includes('payroll'))
  r = await U.hrm.c.rpc('update_grievance', { p_id: gid, p_status: 'action_taken', p_note: null, p_reply: null })
  r = await anon.rpc('grievance_status', { p_code: g1.code }); check('reply kept when not changed', r.data?.status === 'action_taken' && r.data.reply === 'We are checking your pay.')
  const audits = (await admin.from('audit_log').select('*').eq('entity', 'grievance')).data || []
  check('grievance updates are audited', audits.length >= 2)
  // ---- link off / rotate
  r = await U.hra.c.rpc('get_grievance_link', { p_company: 'main', p_rotate: false, p_enabled: false }); check('HR Admin turns the link off', r.data?.enabled === false)
  r = await anon.rpc('submit_grievance', { p_token: tok, p: { message: 'link is off now really' } }); check('submit refused while off', !!r.error)
  r = await anon.rpc('grievance_link_info', { p_token: tok }); check('info not ok while off', r.data?.ok === false)
  r = await U.hra.c.rpc('get_grievance_link', { p_company: 'main', p_rotate: true, p_enabled: true }); const tok2 = r.data?.token
  check('rotate gives a new token, old stops', tok2 && tok2 !== tok && (await anon.rpc('grievance_link_info', { p_token: tok })).data?.ok === false && (await anon.rpc('grievance_link_info', { p_token: tok2 })).data?.ok === true)
  // ---- rate limit (20 per company per hour)
  let n = (await admin.from('grievances').select('id', { count: 'exact', head: true }).eq('company_id', 'main')).count, blocked = false
  for (let i = n; i < 25 && !blocked; i++) { const x = await anon.rpc('submit_grievance', { p_token: tok2, p: { message: 'rate limit test message ' + i } }); if (x.error) blocked = true }
  n = (await admin.from('grievances').select('id', { count: 'exact', head: true }).eq('company_id', 'main')).count
  check('rate limit stops at 20 per hour per company', blocked && n === 20, `n=${n}`)

  // ---- PDPA breach log
  r = await U.hra.c.rpc('save_breach', { p: { title: 'Lost laptop', found_at: '2026-10-20', severity: 'high', people_affected: 12, status: 'open' } })
  const bid = r.data; check('HR Admin logs a breach', !r.error && typeof bid === 'string', err(r))
  r = await U.hra.c.rpc('save_breach', { p: { id: bid, title: 'Lost laptop', found_at: '2026-10-20', severity: 'high', commissioner_notified: true, commissioner_notified_at: '2026-10-21', status: 'contained' } })
  const b = (await admin.from('pdpa_breaches').select('*').eq('id', bid).single()).data
  check('breach update', !r.error && b.commissioner_notified && b.status === 'contained' && b.people_affected === null)
  r = await U.hrm.c.rpc('save_breach', { p: { title: 'x' } }); check('HR Manager cannot log breaches', !!r.error)
  r = await U.om.c.from('pdpa_breaches').select('id'); check('Outlet manager cannot read the breach log', (r.data || []).length === 0)
  r = await U.hrm.c.from('pdpa_breaches').select('id'); check('HR Manager cannot read the breach log', (r.data || []).length === 0)
  r = await U.hra.c.from('pdpa_breaches').select('id'); check('HR Admin reads the breach log', r.data?.length === 1)
  r = await U.hra.c.rpc('save_breach', { p: { title: '' } }); check('breach title required', !!r.error)
  r = await U.hra.c.rpc('save_breach', { p: { title: 't', severity: 'extreme' } }); check('invalid severity refused', !!r.error)

  // ---- medical files restricted
  const up = async (path) => admin.storage.from('attachments').upload(path, new Blob(['%PDF-1.4 test']), { upsert: true, contentType: 'application/pdf' })
  await up('workers/W1/D1/fomema.pdf'); await up('workers/W1/D2/passport.pdf')
  const can = async (k, path) => !(await U[k].c.storage.from('attachments').download(path)).error
  check('Outlet manager cannot open the FOMEMA file', !(await can('om', 'workers/W1/D1/fomema.pdf')))
  check('Outlet manager can open the passport file', await can('om', 'workers/W1/D2/passport.pdf'))
  check('HR Manager can open the FOMEMA file', await can('hrm', 'workers/W1/D1/fomema.pdf'))
  check('Viewer cannot open the FOMEMA file', !(await can('viewer', 'workers/W1/D1/fomema.pdf')))
  await admin.storage.from('attachments').remove(['workers/W1/D1/fomema.pdf', 'workers/W1/D2/passport.pdf'])

  // ---- costs are pay data
  const pull = async (k) => (await U[k].c.rpc('pull_records', { p_since: '1970-01-01', p_limit: 1000 })).data
  const omW = (await pull('om')).find((x) => x.id === 'W1'), hrW = (await pull('hrm')).find((x) => x.id === 'W1')
  check('cost tracker hidden from outlet manager', omW && omW.data.costs === undefined && omW.data.hostelId === 'H1')
  check('cost tracker visible to HR Manager', hrW?.data?.costs?.[0]?.amount === 1850)
  r = await U.om.c.rpc('push_records', { p_rows: [{ entity: 'workers', id: 'W1', client_ts: now(), data: { ...omW.data, permitEmployer: 'Main company' } }] })
  const after = (await admin.from('records').select('data').eq('id', 'W1').single()).data.data
  check('outlet manager cannot overwrite the worker (costs kept)', r.data?.ok === 0 && after.costs?.length === 1 && !after.permitEmployer, JSON.stringify(r.data))

  // ---- 2027 minimum wage (pure)
  const out = '/tmp/pay-trk.mjs'
  execSync(`npx rolldown src/lib/pay.ts --file ${out} --format esm`, { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' })
  const P = await import(out + '?t=' + stamp)
  const rates = P.DEFAULT_RATES
  check('Oct 2026: RM1,700', P.minWageFor(rates, '2026-10-23', 'main')?.monthly === 1700)
  check('June 2027: RM2,000 for a normal company', P.minWageFor(rates, '2027-06-01', 'main')?.monthly === 2000)
  check('31 May 2027: still RM1,700', P.minWageFor(rates, '2027-05-31', 'main')?.monthly === 1700)
  const sme = { ...rates, smeCompanies: ['main'] }
  check('June 2027: small business (<RM50m) stays RM1,700', P.minWageFor(sme, '2027-06-01', 'main')?.monthly === 1700)
  check('next rate announced for the normal company', P.nextMinWage(rates, '2026-10-23', 'main')?.monthly === 2000)
  check('no next rate for the exempt company', !P.nextMinWage(sme, '2026-10-23', 'main'))
  const r27 = P.minWageFor(rates, '2027-06-01', 'main')
  check('2027 rate labelled announced / to confirm', /announced/i.test(JSON.stringify(r27)), JSON.stringify(r27))
} catch (e) { fail++; console.log('FAIL exception', e.message) }
finally {
  await admin.from('grievances').delete().neq('ref_no', '__none__')
  await admin.from('grievance_links').delete().neq('company_id', '__none__')
  await admin.from('pdpa_breaches').delete().neq('title', '__none__')
  await admin.from('app_config').upsert({ key: 'companies', value: { items: [{ id: 'main', name: 'Main company' }] } })
  for (const k of ['hostels', 'hiring']) await admin.from('app_config').upsert({ key: k, value: { items: [] } })
  await admin.from('app_config').delete().in('key', ['trackers', 'zerocost_translations'])
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
