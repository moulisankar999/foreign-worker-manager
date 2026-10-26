// Demo data for Quota & Recruitment screenshots. TEST project only (refuses live). Additive: never deletes users or data.
// Adds 3 "Demo" companies + 1 demo hostel to app_config (only if missing), 4 @example.com users, letters, requests, recruits,
// payments, CMOs, runaways and a claim. Credentials go to /tmp/qseed-users.json (never printed).
import fs from 'node:fs'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
const require = createRequire(new URL('../package.json', import.meta.url))
const { createClient } = require('@supabase/supabase-js')
const env = Object.fromEntries(fs.readFileSync(new URL('../.secrets.env', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const URL_ = env.TEST_SUPABASE_URL
if (!URL_ || URL_.includes('gnepquxtwkyffjmoydnv') || !URL_.includes(env.TEST_PROJECT_REF)) { console.error('ABORT: not the test project'); process.exit(1) }
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(URL_, env.TEST_SERVICE_ROLE_KEY, opts)
const stamp = Date.now(), pw = 'Qs-' + crypto.randomBytes(9).toString('hex') + '!'
const CAFE = 'qdemo-cafe', FOODS = 'qdemo-foods', RESORT = 'qdemo-resort', HOSTEL = 'qdemo-hostel'
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10)
const at = (n, h = 10) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10) + `T${String(h).padStart(2, '0')}:30:00+08:00`
const U = {}
const ok = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data }

// ---- config (additive)
const cfgGet = async (k) => (await admin.from('app_config').select('value').eq('key', k).single()).data.value
const co = await cfgGet('companies')
const want = [{ id: CAFE, name: 'Demo Sunrise Café Sdn Bhd' }, { id: FOODS, name: 'Demo Sunrise Foods Sdn Bhd' }, { id: RESORT, name: 'Demo Sunrise Bay Resort Sdn Bhd' }]
const addCo = want.filter((w) => !co.items.some((c) => c.id === w.id))
if (addCo.length) ok(await admin.from('app_config').update({ value: { ...co, items: [...co.items, ...addCo] } }).eq('key', 'companies'), 'companies')
const ho = await cfgGet('hostels')
if (!ho.items.some((h) => h.id === HOSTEL)) ok(await admin.from('app_config').update({ value: { ...ho, items: [...ho.items, { id: HOSTEL, name: 'Demo Hostel Jalan Klang Lama', capacity: 40, certExpiry: '2027-06-30', companyId: RESORT }] } }).eq('key', 'hostels'), 'hostels')

async function mk(key, role, name, companies = []) {
  const email = `qseed-${key}-${stamp}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: name } })
  if (error) throw error
  ok(await admin.from('profiles').update({ role, status: 'active', full_name: name, company_ids: companies }).eq('id', data.user.id), 'profile')
  const c = createClient(URL_, env.TEST_ANON_KEY, opts); const s = await c.auth.signInWithPassword({ email, password: pw }); if (s.error) throw s.error
  U[key] = { id: data.user.id, c, email }
}
const ALL = [CAFE, FOODS, RESORT]
await mk('ceo', 'super_admin', 'Mouli (Demo CEO)'); await mk('gm', 'general_manager', 'Farid (Demo GM)', ALL)
await mk('hra', 'hr_admin', 'Siti (Demo HR Admin)', ALL); await mk('hrm', 'hr_manager', 'Kavitha (Demo HR Manager)', ALL)
fs.writeFileSync('/tmp/qseed-users.json', JSON.stringify({ pw, users: Object.fromEntries(Object.entries(U).map(([k, v]) => [k, v.email])) }), { mode: 0o600 })
const rpc = async (who, fn, args) => ok(await U[who].c.rpc(fn, args), fn)

// ---- letters
const letter = async (company, ref, approval, expiry, breakdown, open = true) => {
  const id = await rpc('hrm', 'qr_save_quota', { p: { company_id: company, ref_no: ref, approval_date: approval, expiry_date: expiry, sector: 'Services', subsector: 'Restaurant / hotel', breakdown } })
  if (open) await rpc('gm', 'qr_open_quota', { p_id: id, p_ok: true, p_note: 'Checked against the original KDN letter' })
  return id
}
const QC = await letter(CAFE, `KDN/PKA/${stamp % 100000}/C1`, '2026-01-12', day(70), { India: 2 })
const QF = await letter(FOODS, `KDN/PKA/${stamp % 100000}/F1`, '2026-04-20', '2027-04-20', { Nepal: 60, India: 40 })
const QR = await letter(RESORT, `KDN/PKA/${stamp % 100000}/R1`, '2026-05-15', '2027-05-15', { India: 200, Nepal: 150, Bangladesh: 100, Indonesia: 50 })
await letter(RESORT, `KDN/PKA/${stamp % 100000}/R2`, '2026-10-20', '2027-10-20', { Myanmar: 30 }, false)

// ---- existing workers already in Malaysia (imported onto the letters)
const W = (id, no, name, nat, status, quotaId, companyId, extra = {}) => ({ entity: 'workers', id, client_ts: new Date().toISOString(),
  data: { id, workerNo: no, fullName: name, nationality: nat, status, quotaId, companyId, gender: 'Male', joinDate: '2026-06-01', documents: [], family: [], statusHistory: [], increments: [], allowances: [], loans: [], deductions: [], leaves: [], memos: [], notes: [], remittance: [], initialBasicPay: 1700, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...extra } })
const IN = ['Ravi Kumar', 'Arjun Singh', 'Manoj Yadav', 'Suresh Babu', 'Vijay Pal', 'Anil Sharma', 'Deepak Verma', 'Rakesh Gowda', 'Ramesh Nair', 'Prakash Rao', 'Sanjay Das', 'Mohan Lal']
const NP = ['Bikash Thapa', 'Ram Gurung', 'Suman Rai', 'Hari Magar', 'Dipesh Tamang', 'Kiran Shrestha', 'Gopal Karki', 'Nabin Lama']
const rows = []
await rpc('gm', 'qr_move', { p_quota: QR, p_country: 'India', p_kind: 'use_existing', p_qty: 12, p_note: 'Existing workers imported' })
IN.forEach((n, i) => rows.push(W(`qdw-ri${i}-${stamp}`, `RS${100 + i}`, n, 'India', i === 11 ? 'Absconded' : 'Active-Working', QR, RESORT, { hostelId: HOSTEL })))
await rpc('gm', 'qr_move', { p_quota: QR, p_country: 'Nepal', p_kind: 'use_existing', p_qty: 8, p_note: 'Existing workers imported' })
NP.forEach((n, i) => rows.push(W(`qdw-rn${i}-${stamp}`, `RS${200 + i}`, n, 'Nepal', i < 3 ? 'Contract Ended' : 'Active-Working', QR, RESORT, { hostelId: i < 3 ? undefined : HOSTEL })))
await rpc('gm', 'qr_move', { p_quota: QF, p_country: 'Nepal', p_kind: 'use_existing', p_qty: 6, p_note: 'Existing workers imported' })
NP.slice(0, 5).forEach((n, i) => rows.push(W(`qdw-fn${i}-${stamp}`, `SF${300 + i}`, n.replace(/ .*/, ' B.'), 'Nepal', i === 4 ? 'Absconded' : 'Active-Working', QF, FOODS)))
await rpc('gm', 'qr_move', { p_quota: QC, p_country: 'India', p_kind: 'use_existing', p_qty: 1, p_note: 'Existing cook' })
rows.push(W(`qdw-c0-${stamp}`, 'SC001', 'Joseph Mathew', 'India', 'Active-Working', QC, CAFE))
ok(await admin.from('records').upsert(rows), 'workers')

// ---- India batch (Resort): approved GM → CEO, recruits moving through the stages
const bI = await rpc('hrm', 'qr_save_batch', { p: { company_id: RESORT, quota_id: QR, country: 'India', title: 'India batch Nov 2026 — kitchen & housekeeping', target_count: 6, budget_total: 54000, agent_name: 'Demo Overseas Manpower, Chennai', agent_licence: 'B-0123/TN/PER/1000+/5/9999/2020', expected_arrival: day(10), hostel_id: HOSTEL } })
const ri = []
const people = [['Karthik Selvam', 'ECR'], ['Imran Khan', 'ECNR'], ['Dinesh Kumar', 'ECR'], ['Santosh Patil', 'ECR'], ['Ajay Thakur', 'ECNR'], ['Naveen Reddy', 'ECR']]
for (const [i, [n, e]] of people.entries()) ri.push(await rpc('hrm', 'qr_save_recruit', { p: { batch_id: bI, full_name: n, passport_no: `V${7000000 + i}${stamp % 10}`, ecr: e, gender: 'Male', job: i < 3 ? 'Kitchen helper' : 'Housekeeping', passport_expiry: '2032-03-01' } }))
const uI = await rpc('hrm', 'qr_request_use', { p: { quota_id: QR, country: 'India', slots: 6, purpose: 'India batch Nov 2026 — calling visa for 6', batch_id: bI, recruit_ids: ri, est_cost_rm: 54000 } })
await rpc('gm', 'qr_decide_use', { p_id: uI, p_action: 'approve', p_note: 'Headcount matches the outlet plan' })
await rpc('ceo', 'qr_decide_use', { p_id: uI, p_action: 'approve', p_note: 'Approved' })
const S = (o) => o
await rpc('hrm', 'qr_save_recruit', { p: { id: ri[0], stage: 'onboarding', vdr_applied: day(-40), vdr_no: 'VDR-IN-0001', vdr_approved: day(-30), vdr_expiry: day(60), flight_no: 'MH181', flight_at: at(-10), airport: 'KLIA T1', pickup_by: 'Azman (driver)', arrived_at: at(-10, 14), hostel_id: HOSTEL, steps: S({ airport_letter: { done: true }, fomema: { done: true }, emigrate: { done: true } }) } })
await rpc('hrm', 'qr_save_recruit', { p: { id: ri[1], stage: 'arrival', vdr_applied: day(-40), vdr_no: 'VDR-IN-0002', vdr_approved: day(-30), vdr_expiry: day(60), flight_no: 'MH181', flight_at: at(-35), airport: 'KLIA T1', pickup_by: 'Azman (driver)', arrived_at: at(-35, 14), hostel_id: HOSTEL, steps: S({ airport_letter: { done: true } }) } })
await rpc('hrm', 'qr_save_recruit', { p: { id: ri[2], stage: 'travel', vdr_applied: day(-25), vdr_no: 'VDR-IN-0003', vdr_approved: day(-12), vdr_expiry: day(78), flight_no: 'AK12', flight_at: at(2, 7), airport: 'KLIA T2', steps: S({ airport_letter: { done: true } }) } })
await rpc('hrm', 'qr_save_recruit', { p: { id: ri[3], stage: 'travel', vdr_applied: day(-25), vdr_no: 'VDR-IN-0004', vdr_approved: day(-12), vdr_expiry: day(78), flight_no: 'AK12', flight_at: at(9, 7), airport: 'KLIA T2', pickup_by: 'Azman (driver)' } })
await rpc('hrm', 'qr_save_recruit', { p: { id: ri[4], stage: 'vdr', vdr_applied: day(-6), vdr_no: 'VDR-IN-0005' } })
await rpc('hrm', 'qr_save_recruit', { p: { id: ri[5], stage: 'medical' } })

// ---- Nepal batch (Resort): request waiting for the GM
const bN = await rpc('hrm', 'qr_save_batch', { p: { company_id: RESORT, quota_id: QR, country: 'Nepal', title: 'Nepal batch Dec 2026 — waiters', target_count: 4, budget_total: 30000, agent_name: 'Demo Himalayan Manpower, Kathmandu', expected_arrival: day(45), hostel_id: HOSTEL } })
const rn = []
for (const [i, n] of ['Prem Bahadur', 'Sujan Thapa', 'Bishal Gurung', 'Roshan Karki'].entries()) rn.push(await rpc('hrm', 'qr_save_recruit', { p: { batch_id: bN, full_name: n, passport_no: `PA${8000000 + i}`, gender: 'Male', job: 'Waiter', stage: i < 2 ? 'offer' : 'interview' } }))
await rpc('hrm', 'qr_request_use', { p: { quota_id: QR, country: 'Nepal', slots: 4, purpose: 'Nepal batch Dec 2026 — 4 waiters for the new outlet', batch_id: bN, recruit_ids: rn, est_cost_rm: 30000 } })

// ---- Foods: GM-approved (waiting for CEO), CEO-only approval, a returned one
await rpc('hrm', 'qr_request_use', { p: { quota_id: QF, country: 'Nepal', slots: 3, purpose: 'Replacement for 3 contract-end cooks', est_cost_rm: 22500 } }).then((id) => rpc('gm', 'qr_decide_use', { p_id: id, p_action: 'approve', p_note: 'OK — replacements' }))
const bF = await rpc('hra', 'qr_save_batch', { p: { company_id: FOODS, quota_id: QF, country: 'India', title: 'India — 2 bakers', target_count: 2, budget_total: 18000 } })
const rf = [await rpc('hra', 'qr_save_recruit', { p: { batch_id: bF, full_name: 'Abdul Rahman', passport_no: 'W1234567', ecr: 'ECNR', job: 'Baker', stage: 'passport' } }),
  await rpc('hra', 'qr_save_recruit', { p: { batch_id: bF, full_name: 'Sathish Kumar', passport_no: 'W7654321', ecr: 'ECR', job: 'Baker', stage: 'offer' } })]
const uF = await rpc('hra', 'qr_request_use', { p: { quota_id: QF, country: 'India', slots: 2, purpose: 'Two bakers for the central kitchen', batch_id: bF, recruit_ids: rf, est_cost_rm: 18000 } })
await rpc('ceo', 'qr_decide_use', { p_id: uF, p_action: 'approve', p_note: 'Urgent — approved directly' })
const uR = await rpc('hrm', 'qr_request_use', { p: { quota_id: QF, country: 'India', slots: 1, purpose: 'Dishwasher' } })
await rpc('gm', 'qr_decide_use', { p_id: uR, p_action: 'return', p_note: 'Attach the outlet manager’s headcount request' })
// ---- Café: last slot request rejected
const uC = await rpc('hrm', 'qr_request_use', { p: { quota_id: QC, country: 'India', slots: 1, purpose: 'Second cook' } })
await rpc('ceo', 'qr_decide_use', { p_id: uC, p_action: 'reject', p_note: 'Keep the last slot for a replacement' })

// ---- payments
const pay = (who, p) => rpc(who, 'qr_add_payment', { p: { company_id: RESORT, batch_id: bI, country: 'India', method: 'Bank transfer', ...p } })
await pay('hrm', { category: 'levy', amount_rm: 11100, paid_on: day(-38), payee: 'Jabatan Imigresen Malaysia', ref: 'FWCMS-LV-88121', note: 'Levy 6 × RM 1,850' })
await pay('hrm', { category: 'agent_fee', amount_rm: 18000, paid_on: day(-36), payee: 'Demo Overseas Manpower', ref: 'TT-55120' })
await pay('hra', { category: 'vdr', amount_rm: 1200, paid_on: day(-35), payee: 'Jabatan Imigresen Malaysia', ref: 'VDR-BATCH-1' })
await pay('hrm', { category: 'medical', amount_rm: 1500, paid_on: day(-33), payee: 'Demo Medical Centre, Chennai', recruit_id: null })
await pay('hrm', { category: 'ticket', amount_rm: 3960, paid_on: day(-14), payee: 'Malaysia Airlines', ref: 'PNR K7Q2LM' })
await pay('hrm', { category: 'emigrate', amount_rm: 420, paid_on: day(-20), payee: 'eMigrate / PBBY' })
await rpc('hrm', 'qr_add_payment', { p: { company_id: FOODS, batch_id: bF, country: 'India', category: 'processing', amount_rm: 780, paid_on: day(-3), payee: 'FWCMS', method: 'FPX' } })

// ---- CMOs, claim, runaways
const fileRow = async (who, company, kind) => rpc(who, 'qr_add_file', { p_company: company, p_kind: kind, p_path: `${company}/${kind}/${crypto.randomUUID()}.pdf`, p_name: `${kind}-scan.pdf`, p_mime: 'application/pdf', p_size: 182000, p_sha256: crypto.randomBytes(32).toString('hex') })
const X = []
for (let i = 0; i < 3; i++) X.push(await rpc('hrm', 'qr_record_exit', { p: { company_id: RESORT, quota_id: QR, country: 'Nepal', worker_id: `qdw-rn${i}-${stamp}`, worker_no: `RS${200 + i}`, worker_name: NP[i], passport_no: `PA55${i}000`, permit_no: `PLKS-${i}44`, cmo_ref: `COM/${stamp % 100000}/${i}`, cmo_date: day(-50 + i * 7), departure_date: day(-48 + i * 7), flight_no: 'MH114', exit_reason: 'Contract ended', file_id: await fileRow('hrm', RESORT, 'cmo') } }))
const C = await rpc('hra', 'qr_claim_create', { p: { company_id: RESORT, title: 'Gantian 2026 — Nepal contract-end', announcement: 'KDN replacement window (per MPMA circular)', exit_ids: X.slice(0, 2) } })
await rpc('hra', 'qr_claim_status', { p_id: C, p: { status: 'submitted', gov_ref: `FWCMS-RPL-${stamp % 100000}`, submitted_at: day(-5) } })
await rpc('hrm', 'qr_save_runaway', { p: { company_id: RESORT, quota_id: QR, country: 'India', worker_id: `qdw-ri11-${stamp}`, worker_no: 'RS111', worker_name: IN[11], last_seen: day(-20), bond_rm: 1500, sita_rm: 0, wages_owed_rm: 850, money_owed_note: 'Advance RM 300 outstanding' } })

console.log('seeded OK', { companies: addCo.length, letters: 4, workers: rows.length, recruits: ri.length + rn.length + rf.length, cmos: X.length })
