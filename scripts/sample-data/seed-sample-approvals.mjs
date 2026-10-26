// SAMPLE data for Approval & Recruitment (1.4.2). Additive only: adds companies "SAMPLE …" (ids sample-*), one sample hostel,
// one sample outlet per company, sample workers (ids sample-w-*), 4 sample staff logins (auth app_metadata fwm_sample=true,
// banned and set inactive after seeding) and the quota data they create through the normal RPCs, plus watermarked placeholder files.
// Everything is removed by Settings › Data › Remove sample data (remove_sample_data(), migration 044).
//   node scripts/sample-data/seed-sample-approvals.mjs --target=test
//   node scripts/sample-data/seed-sample-approvals.mjs --target=live --confirm=SEED-LIVE-SAMPLE
// Never prints secrets. Refuses to run twice (if sample companies already exist).
import fs from 'node:fs'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { samplePdf, avatarDataUrl } from './docs.mjs'
const require = createRequire(new URL('../../package.json', import.meta.url))
const { createClient } = require('@supabase/supabase-js')
const root = new URL('../../', import.meta.url)
const env = Object.fromEntries(fs.readFileSync(new URL('.secrets.env', root), 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1]
const target = arg('target') || 'test'
let URL_, SERVICE, ANON
if (target === 'test') {
  URL_ = env.TEST_SUPABASE_URL; SERVICE = env.TEST_SERVICE_ROLE_KEY; ANON = env.TEST_ANON_KEY
  if (!URL_ || URL_.includes('gnepquxtwkyffjmoydnv')) { console.error('ABORT: TEST url looks wrong'); process.exit(1) }
} else if (target === 'live') {
  if (arg('confirm') !== 'SEED-LIVE-SAMPLE') { console.error('ABORT: live needs --confirm=SEED-LIVE-SAMPLE'); process.exit(1) }
  URL_ = env.SUPABASE_URL; SERVICE = env.SUPABASE_SERVICE_ROLE_KEY
  ANON = /const LIVE_ANON = '([^']+)'/.exec(fs.readFileSync(new URL('src/lib/supabaseConfig.ts', root), 'utf8'))[1]
} else { console.error('ABORT: --target=test|live'); process.exit(1) }
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(URL_, SERVICE, opts)
const ok = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data }
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10)
const at = (n, h = 10) => `${day(n)}T${String(h).padStart(2, '0')}:30:00+08:00`
const log = (...a) => console.log(...a)
const warn = []
const soft = async (what, fn) => { try { return await fn() } catch (e) { warn.push(`${what}: ${e.message}`); log('  (skipped)', what, '-', e.message) } }
const out = { target, started: new Date().toISOString(), companies: [], files: 0, workers: 0, users: [] }

// ---- companies / hostel / outlets (additive)
const CO = [
  { id: 'sample-fnb', name: 'SAMPLE Seri Rasa Restaurant Sdn Bhd', sector: 'Services', sub: 'Restaurant', label: 'Services – F&B restaurant', outletType: 'Restaurant', code: 'FB' },
  { id: 'sample-mfg', name: 'SAMPLE Precision Moulding Sdn Bhd', sector: 'Manufacturing', sub: 'Plastic products', label: 'Manufacturing', outletType: 'Central Store', code: 'MF' },
  { id: 'sample-con', name: 'SAMPLE Bina Jaya Construction Sdn Bhd', sector: 'Construction', sub: 'Building works', label: 'Construction', outletType: 'Central Store', code: 'CN' },
  { id: 'sample-pla', name: 'SAMPLE Ladang Hijau Plantation Sdn Bhd', sector: 'Plantation', sub: 'Oil palm', label: 'Plantation', outletType: 'Central Store', code: 'PL' },
  { id: 'sample-agr', name: 'SAMPLE Tani Segar Agriculture Sdn Bhd', sector: 'Agriculture', sub: 'Vegetable farming', label: 'Agriculture', outletType: 'Central Store', code: 'AG' },
]
const HOSTEL = 'sample-hostel'
const cfgGet = async (k) => ok(await admin.from('app_config').select('value').eq('key', k).single(), k).value
const companies = await cfgGet('companies')
if (companies.items.some((c) => String(c.id).startsWith('sample-'))) { console.error('ABORT: sample companies already exist — remove the sample data first.'); process.exit(1) }
ok(await admin.from('app_config').update({ value: { ...companies, items: [...companies.items, ...CO.map((c) => ({ id: c.id, name: c.name, sector: c.label, demo: true, sample: true }))] } }).eq('key', 'companies'), 'companies')
const SAMPLE_HOSTEL = { id: HOSTEL, name: 'SAMPLE Hostel (fictitious address)', capacity: 60, certExpiry: '2027-12-31', companyId: 'sample-fnb' }
const hrow = ok(await admin.from('app_config').select('value').eq('key', 'hostels').maybeSingle(), 'hostels')
if (!hrow) ok(await admin.from('app_config').insert({ key: 'hostels', value: { items: [SAMPLE_HOSTEL] } }), 'hostels') // no hostels saved yet (the app default is an empty list)
else if (!(hrow.value?.items || []).some((h) => h.id === HOSTEL)) ok(await admin.from('app_config').update({ value: { ...hrow.value, items: [...(hrow.value?.items || []), SAMPLE_HOSTEL] } }).eq('key', 'hostels'), 'hostels')
const now = new Date().toISOString()
ok(await admin.from('records').upsert(CO.map((c) => ({ entity: 'outlets', id: `sample-o-${c.code.toLowerCase()}`, client_ts: now, data: { id: `sample-o-${c.code.toLowerCase()}`, name: `SAMPLE ${c.label} site`, type: c.outletType, companyId: c.id, address: 'Fictitious address (sample)' } }))), 'outlets')
log('companies, hostel and outlets added')

// ---- company records (1.4.2): details, watermarked SSM copies, directors with placeholder ICs 000000-00-xxxx
const DIRS = [['Ahmad Faiz bin Osman', 'director_shareholder'], ['Lim Wei Ling', 'director'], ['Priya a/p Ramasamy', 'shareholder']]
let icSeq = 0
for (const [ci, c] of CO.entries()) {
  const ssmNew = `2019010${String(10000 + ci * 1111).slice(-5)}`.padEnd(12, '0')
  ok(await admin.from('company_details').upsert({ company_id: c.id, ssm_new: ssmNew, ssm_old: `${1000000 + ci}-X`, incorporated_on: `201${ci + 2}-0${ci + 2}-15`, sector: c.label,
    reg_address: `No. ${ci + 1}, Jalan Contoh ${ci + 1}, 50000 Kuala Lumpur (fictitious)`, biz_address: `Lot ${ci + 10}, Kawasan Sampel, 40000 Shah Alam (fictitious)`,
    phone: `+6031234${String(5000 + ci).padStart(4, '0')}`, email: `office@${c.id}.sample.invalid`, notes: 'SAMPLE data', created_by_name: 'Sample data' }), 'company_details ' + c.id)
  for (const [k, t] of [['form9', 'Form 9 – certificate of incorporation'], ['form49', 'Form 49 – directors & officers'], ['einfo', 'SSM e-Info company profile']]) {
    const buf = await samplePdf('ssm', [['Company', c.name], ['Registration no. (fictitious)', ssmNew], ['Old format (fictitious)', `${1000000 + ci}-X`], ['Record', `${t} (sample)`], ['Sector', c.label], ['Incorporated', `201${ci + 2}-0${ci + 2}-15 (sample)`]],
      { note: 'This sample page shows where an SSM copy is stored. It is not a copy of any real SSM form or record.' })
    const path = `${c.id}/ssm/${crypto.randomUUID()}-SAMPLE-${k}.pdf`
    ok(await admin.storage.from('company-docs').upload(path, buf, { contentType: 'application/pdf', upsert: false }), 'upload ssm'); out.files++
    ok(await admin.from('company_docs').insert({ company_id: c.id, doc_type: k, title: `${t} (SAMPLE)`, path, name: `SAMPLE-${k}.pdf`, mime: 'application/pdf', size: buf.length, uploaded_by_name: 'Sample data',
      expiry_date: k === 'einfo' ? day(300 - ci * 80) : null }), 'company_docs')
  }
  for (const [di, [nm, des]] of DIRS.slice(0, ci % 2 ? 2 : 3).entries()) {
    const ic = `000000-00-${String(++icSeq).padStart(4, '0')}`
    let idFile = null
    if (di === 0) {
      const buf = await samplePdf('director_id', [['Name', `${nm} (sample)`], ['ID no. (placeholder)', ic], ['Company', c.name], ['Designation', des.replace('_', ' & ')]], { photoSeed: 50 + ci, note: 'Placeholder only – not a copy of any identity card.' })
      idFile = `${c.id}/directors/${crypto.randomUUID()}-SAMPLE-ic.pdf`
      ok(await admin.storage.from('company-docs').upload(idFile, buf, { contentType: 'application/pdf', upsert: false }), 'upload director id'); out.files++
    }
    ok(await admin.from('company_directors').insert({ company_id: c.id, full_name: `${nm} (SAMPLE)`, id_type: 'ic', id_no: ic, nationality: 'Malaysia', designation: des,
      email: `director${di + 1}@${c.id}.sample.invalid`, mobile: `+60123${String(400000 + icSeq).slice(-6)}`, id_file: idFile }), 'company_directors')
  }
}
log('company details, SSM copies and directors added')

// ---- sample staff logins (no notification: profile inserted already active; fwm_agent marker stops the signup trigger)
const stamp = Date.now(), pw = 'Sm-' + crypto.randomBytes(12).toString('hex') + '!'
const U = {}
const ALL = CO.map((c) => c.id)
async function mk(key, role, name) {
  const email = `sample-${key}-${stamp}@sample.invalid`
  const meta = { fwm_agent: 'true', fwm_sample: 'true' }
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, app_metadata: meta, user_metadata: { ...meta, full_name: name } })
  if (error) throw new Error('create user: ' + error.message)
  ok(await admin.from('profiles').insert({ id: data.user.id, email, full_name: name, role, status: 'active', company_ids: role === 'super_admin' ? [] : ALL }), 'profile')
  const c = createClient(URL_, ANON, opts); const s = await c.auth.signInWithPassword({ email, password: pw }); if (s.error) throw new Error('sign in: ' + s.error.message)
  U[key] = { id: data.user.id, c, name }; out.users.push(data.user.id)
}
await mk('ceo', 'super_admin', 'Sample CEO (SAMPLE)'); await mk('gm', 'general_manager', 'Sample GM (SAMPLE)')
await mk('hra', 'hr_admin', 'Sample HR Admin (SAMPLE)'); await mk('hrm', 'hr_manager', 'Sample HR Manager (SAMPLE)')
log('sample staff logins ready')
const rpc = async (who, fn, args) => ok(await U[who].c.rpc(fn, args), fn)

// ---- files
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')
async function qfile(company, kind, fields, o = {}) {
  const buf = await samplePdf(kind === 'letter' ? 'letter' : kind, fields, o)
  const name = `SAMPLE-${kind}.pdf`
  const path = `${company}/${kind}/${crypto.randomUUID()}-${name}`
  ok(await admin.storage.from('quota-docs').upload(path, buf, { contentType: 'application/pdf', upsert: false }), 'upload ' + kind)
  out.files++
  return rpc('hrm', 'qr_add_file', { p_company: company, p_kind: kind === 'stamped' ? 'stamped' : kind, p_path: path, p_name: name, p_mime: 'application/pdf', p_size: buf.length, p_sha256: sha(buf) })
}
let seq = 0
const pno = () => `SMP${String(100000 + ++seq).slice(1)}X` // clearly fictitious passport numbers

// ---- worker records (existing workers on the letters)
async function workers(c, quotaId, nat, names, statusOf = () => 'Active-Working', extra = () => ({}), tag = '') {
  const rows = []
  for (const [i, n] of names.entries()) {
    const id = `sample-w-${c.code.toLowerCase()}-${nat.toLowerCase()}${i}${tag}`, no = `${c.code}${nat.slice(0, 1)}${String(i + 1).padStart(3, '0')}`
    const passport = pno(), docId = `sample-d-${id.slice(9)}`
    const buf = await samplePdf('passport', [['Name', `${n} (sample)`], ['Passport no.', passport], ['Nationality', `${nat} (sample)`], ['Date of birth', '01 Jan 1995 (sample)'], ['Valid until', '31 Dec 2031 (sample)'], ['Employer', c.name]], { photoSeed: seq })
    const path = `workers/${id}/${docId}/${Date.now()}-SAMPLE-passport.pdf`
    ok(await admin.storage.from('attachments').upload(path, buf, { contentType: 'application/pdf', upsert: true }), 'upload passport'); out.files++
    const st = statusOf(i)
    rows.push({ entity: 'workers', id, client_ts: new Date().toISOString(), data: { id, workerNo: no, fullName: `${n} (SAMPLE)`, nationality: nat, status: st, quotaId, companyId: c.id,
      outletId: `sample-o-${c.code.toLowerCase()}`, hostelId: st === 'Active-Working' ? HOSTEL : undefined, gender: 'Male', joinDate: '2025-03-01', photo: await avatarDataUrl(seq),
      documents: [{ id: docId, type: 'Passport', label: 'Sample passport (fictitious)', number: passport, issueDate: '2022-01-01', expiryDate: '2031-12-31', remarks: 'SAMPLE – NOT A REAL DOCUMENT', attachment: { name: 'SAMPLE-passport.pdf', type: 'application/pdf', path } }],
      family: [], statusHistory: [], increments: [], allowances: [], loans: [], deductions: [], leaves: [], memos: [], notes: [], remittance: [], initialBasicPay: 1700,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...extra(i) } })
  }
  ok(await admin.from('records').upsert(rows), 'workers'); out.workers += rows.length
  return rows.map((r) => r.data)
}

// ---- letters
async function letter(c, n, approval, breakdown, open = true) {
  const ref = `SAMPLE/KDN/${c.code}/${String(n).padStart(2, '0')}/${stamp % 10000}`
  const total = Object.values(breakdown).reduce((a, b) => a + b, 0)
  const file = await qfile(c.id, 'letter', [['Reference (fictitious)', ref], ['Employer', c.name], ['Sector', `${c.sector} – ${c.sub}`], ['Approved', approval], ['Slots', `${total} (${Object.entries(breakdown).map(([k, v]) => `${k} ${v}`).join(', ')})`], ['Valid for', '12 months (sample)']],
    { note: 'This sample letter shows how an approval letter is stored. It is not a copy of any real letter and has no legal meaning.' })
  const id = await rpc('hrm', 'qr_save_quota', { p: { company_id: c.id, ref_no: ref, approval_date: approval, expiry_date: new Date(new Date(approval).getTime() + 365 * 864e5).toISOString().slice(0, 10), sector: c.sector, subsector: c.sub, breakdown, letter_file: file, notes: 'SAMPLE data' } })
  if (open) await rpc('gm', 'qr_open_quota', { p_id: id, p_ok: true, p_note: 'Sample: checked against the sample letter' })
  return id
}

// ---- pipeline
const defs = {}
const ACCOM = 'SAMPLE Hostel, Lot 1 Jalan Contoh, 40000 Shah Alam (fictitious)'
async function stages(country, ecr) {
  const k = country + ecr
  if (!defs[k]) { const st = []; for (const d of ok(await admin.rpc('qr_pipeline_def', { p_country: country, p_ecr: ecr || null }), 'pipeline_def')) if (!st.includes(d.stage)) st.push(d.stage); defs[k] = st }
  return defs[k]
}
async function advance(c, rid, country, ecr, name, targetStage, o = {}) {
  const st = await stages(country, ecr)
  const ti = targetStage === 'converted' ? st.length : st.indexOf(targetStage)
  if (ti < 0) { warn.push(`stage ${targetStage} not in ${country} pipeline`); return }
  const past = (s) => st.indexOf(s) >= 0 && st.indexOf(s) < ti
  for (const s of st) { if (st.indexOf(s) >= ti || s === 'onboard') break; const r = await U.ceo.c.rpc('qr_stage_override', { p_id: rid, p_stage: s, p_note: 'Sample data: earlier stage completed' }); if (r.error && !/Nothing to mark|cannot be marked/.test(r.error.message)) warn.push(`override ${s}: ${r.error.message}`) }
  const docs = {}
  const fx = (k, f, oo) => soft(`${k} file`, () => qfile(c.id, k, f, oo))
  if (past('medical')) { docs.medical_result = 'fit'; docs.medical_file = await fx('medical', [['Candidate', `${name} (sample)`], ['Result', 'FIT (sample)'], ['Clinic', 'SAMPLE Medical Centre (fictitious)'], ['Examined', day(-60)]]) }
  if (past('vdr')) await soft('vdr apply', () => rpc('hrm', 'qr_save_recruit', { p: { id: rid, vdr_applied: day(-50), vdr_no: `SAMPLE-VDR-${String(seq).padStart(4, '0')}` } }))
  if (past('vdr_gate')) {
    const f = await fx('vdr', [['Applicant', `${name} (sample)`], ['Calling visa ref. (fictitious)', `SAMPLE-VDR-${String(seq).padStart(4, '0')}`], ['Employer', c.name], ['Approved', day(-40)], ['Enter before', day(50)]], { photoSeed: seq })
    if (f) await soft('vdr copy', () => rpc('hrm', 'qr_set_vdr_copy', { p_recruit: rid, p_file: f, p_approved: day(-40) }))
    await soft('vdr expiry', () => rpc('hrm', 'qr_save_recruit', { p: { id: rid, vdr_expiry: day(o.vdrExpiry ?? 50) } }))
  }
  if (past('stamping')) { docs.stamped_on = day(-30); docs.stamped_file = await fx('stamped', [['Name', `${name} (sample)`], ['Passport no.', pno()], ['Nationality', `${country} (sample)`], ['Visa page', `Entry visa – SAMPLE-VDR-${String(seq).padStart(4, '0')}`]], { photoSeed: seq, note: `Visa page area: SAMPLE ENTRY VISA for ${c.name}. Fictitious.` }) }
  if (past('ticket')) { docs.flight_no = 'SX123'; docs.flight_at = at(o.flightIn ?? -20, 7); docs.ticket_file = await fx('ticket', [['Passenger', `${name} (sample)`], ['Flight', 'SX123 (fictitious)'], ['Departs', day(o.flightIn ?? -20)], ['Booking ref.', 'SAMPLE1']]) }
  if (past('klia') || past('pickup')) { docs.arrived_at = at(o.arrived ?? -15, 14); docs.pickup_by = 'Sample driver (fictitious)'; docs.klia_person = 'Sample HR officer (fictitious)' }
  if (past('hq')) docs.outlet_id = `sample-o-${c.code.toLowerCase()}`
  if (past('hr_brief')) docs.hr_ack_file = await fx('hr_ack', [['Worker', `${name} (sample)`], ['Briefed on', day(-12)], ['Topics', 'Rules, pay, leave, safety (sample)']])
  for (const k of Object.keys(docs)) if (docs[k] === undefined || docs[k] === null) delete docs[k]
  if (Object.keys(docs).length) await soft('recruit docs', () => rpc('hrm', 'qr_recruit_docs', { p_id: rid, p: docs }))
  if (o.hostel) await soft('hostel', () => rpc('hrm', 'qr_save_recruit', { p: { id: rid, hostel_id: HOSTEL } }))
  if (targetStage === 'converted') {
    await soft('accommodation', () => rpc('hrm', 'qr_recruit_arrival', { p_id: rid, p: { accom_address: ACCOM } }))
    const ff = await fx('fomema', [['Worker', `${name} (sample)`], ['Result', 'FIT (sample)'], ['Examined', day(-8)]])
    await soft('fomema fit', () => rpc('hrm', 'qr_recruit_fomema', { p_id: rid, p_on: day(-8), p_result: 'fit', p_file: ff || null, p_note: 'Sample: fit' }))
    const [w] = await workers(c, o.quota || null, country, [name], () => 'Active-Working', () => ({ joinDate: day(-5) }), `-new${seq}`)
    await soft('convert', () => rpc('hrm', 'qr_mark_converted', { p_id: rid, p_worker: w.id }))
  }
}
async function batch(c, quota, country, title, people, req) {
  const b = await rpc('hrm', 'qr_save_batch', { p: { company_id: c.id, quota_id: quota, country, title: `${title} (SAMPLE)`, target_count: people.length, budget_total: people.length * 9000, agent_name: 'SAMPLE Overseas Manpower (fictitious)', expected_arrival: day(30), hostel_id: HOSTEL } })
  const ids = []
  for (const p of people) ids.push(await rpc('hrm', 'qr_save_recruit', { p: { batch_id: b, full_name: `${p.name} (SAMPLE)`, passport_no: pno(), ecr: p.ecr || null, gender: 'Male', job: p.job || 'General worker', passport_expiry: '2032-03-01' } }))
  const u = await rpc(req.by || 'hrm', 'qr_request_use', { p: { quota_id: quota, country, slots: people.length, purpose: `${title} (SAMPLE)`, batch_id: b, recruit_ids: ids, est_cost_rm: people.length * 9000 } })
  await decide(u, req.flow)
  if (req.flow === 'gm+ceo' || req.flow === 'ceo') for (const [i, p] of people.entries()) { log('   ', p.name, '→', p.to); await advance(c, ids[i], country, p.ecr, p.name, p.to, { ...p, quota }) }
  return { b, ids, u }
}
async function decide(u, flow) {
  if (flow === 'gm' || flow === 'gm+ceo') await rpc('gm', 'qr_decide_use', { p_id: u, p_action: 'approve', p_note: 'Sample: headcount matches the plan' })
  if (flow === 'ceo' || flow === 'gm+ceo') await rpc('ceo', 'qr_decide_use', { p_id: u, p_action: 'approve', p_note: 'Sample: approved' })
}
const request = async (c, quota, country, slots, purpose, flow, by = 'hrm') => { const u = await rpc(by, 'qr_request_use', { p: { quota_id: quota, country, slots, purpose: `${purpose} (SAMPLE)`, est_cost_rm: slots * 9000 } }); await decide(u, flow); return u }
const move = (q, country, n) => rpc('gm', 'qr_move', { p_quota: q, p_country: country, p_kind: 'use_existing', p_qty: n, p_note: 'Sample: existing workers imported' })
const pay = (c, p) => soft('payment', () => rpc('hrm', 'qr_add_payment', { p: { company_id: c.id, method: 'Bank transfer', ...p, note: 'SAMPLE payment' } }))
async function com(c, quota, country, w, i) {
  const ref = `SAMPLE-COM-${c.code}-${i + 1}`
  const f = await qfile(c.id, 'cmo', [['Worker', w.fullName], ['Worker no.', w.workerNo], ['Passport no.', w.documents[0].number], ['Check Out Memo ref. (fictitious)', ref], ['Departure', day(-40 + i * 5)], ['Reason', 'Contract ended (sample)']])
  return rpc('hrm', 'qr_record_exit', { p: { company_id: c.id, quota_id: quota, country, worker_id: w.id, worker_no: w.workerNo, worker_name: w.fullName, passport_no: w.documents[0].number, permit_no: `SAMPLE-PLKS-${i}`, cmo_ref: ref, cmo_date: day(-42 + i * 5), departure_date: day(-40 + i * 5), flight_no: 'SX456', exit_reason: 'Contract ended', file_id: f } })
}
const [FNB, MFG, CON, PLA, AGR] = CO

// ===== Services – F&B restaurant: letters of 5 and 20
log('F&B restaurant')
const fnb5 = await letter(FNB, 1, '2026-02-10', { India: 5 })
const fnb20 = await letter(FNB, 2, '2026-10-05', { India: 12, Nepal: 8 }) // levy not paid yet → overdue HR follow-up
await move(fnb5, 'India', 3)
await workers(FNB, fnb5, 'India', ['Arun Mahesh', 'Balaji Iyer', 'Chandran Pillai'], (i) => (i === 2 ? 'Contract Ended' : 'Active-Working'), (i) => (i === 2 ? { exitDate: day(-25) } : {})) // no COM yet → overdue
await batch(FNB, fnb20, 'India', 'India cooks Nov 2026', [
  { name: 'Dev Anand Rao', ecr: 'ECR', to: 'medical', job: 'Cook' }, { name: 'Elango Murthy', ecr: 'ECNR', to: 'sent', job: 'Cook' },
  { name: 'Faizal Ahmed', ecr: 'ECR', to: 'stamping', job: 'Cook' }, { name: 'Gokul Varma', ecr: 'ECR', to: 'emigration', job: 'Kitchen helper' }], { flow: 'gm+ceo' })
await request(FNB, fnb20, 'Nepal', 3, 'Nepal waiters for the new outlet', 'none')
await pay(FNB, { category: 'agent_fee', amount_rm: 12000, paid_on: day(-45), payee: 'SAMPLE Overseas Manpower (fictitious)', country: 'India' })

// ===== Manufacturing: letters of 100 and 40 (the 40 waits to be opened)
log('Manufacturing')
const mfg100 = await letter(MFG, 1, '2026-03-02', { Nepal: 50, Bangladesh: 30, Myanmar: 20 })
await letter(MFG, 2, '2026-09-20', { Indonesia: 40 }, false)
await move(mfg100, 'Nepal', 10)
const mw = await workers(MFG, mfg100, 'Nepal', ['Hem Bahadur', 'Ishwor Pandey', 'Janak Bhatt', 'Kamal Oli', 'Laxman Rana', 'Madan Shahi', 'Nirmal Basnet', 'Om Prakash Joshi', 'Pawan Khadka', 'Rajan Bista'],
  (i) => (i < 2 ? 'Contract Ended' : i === 9 ? 'Absconded' : 'Active-Working'), (i) => (i < 2 ? { exitDate: day(-40 + i * 5) } : {}))
const mx = [await com(MFG, mfg100, 'Nepal', mw[0], 0), await com(MFG, mfg100, 'Nepal', mw[1], 1)]
await soft('runaway', () => rpc('hrm', 'qr_save_runaway', { p: { company_id: MFG.id, quota_id: mfg100, country: 'Nepal', worker_id: mw[9].id, worker_no: mw[9].workerNo, worker_name: mw[9].fullName, last_seen: day(-25), bond_rm: 1500, sita_rm: 0, wages_owed_rm: 600, money_owed_note: 'SAMPLE: advance outstanding' } }))
const cl = await soft('claim', () => rpc('hra', 'qr_claim_create', { p: { company_id: MFG.id, title: 'Replacement window 2026 – contract-end (SAMPLE)', announcement: 'Sample announcement (fictitious)', exit_ids: mx } }))
if (cl) await soft('claim submit', () => rpc('hra', 'qr_claim_status', { p_id: cl, p: { status: 'submitted', gov_ref: `SAMPLE-RPL-${stamp % 10000}`, submitted_at: day(-5) } }))
await batch(MFG, mfg100, 'Bangladesh', 'Bangladesh machine operators', [
  { name: 'Abul Hossain', to: 'converted', job: 'Machine operator', arrived: -30, hostel: true }, { name: 'Babul Mia', to: 'hq', job: 'Machine operator', arrived: -2, hostel: true },
  { name: 'Delwar Karim', to: 'ticket', job: 'Machine operator', flightIn: 6 }, { name: 'Emdadul Haque', to: 'vdr', job: 'Machine operator' },
  { name: 'Farhad Uddin', to: 'medical', job: 'Machine operator' }], { flow: 'gm+ceo' })
await request(MFG, mfg100, 'Myanmar', 5, 'Myanmar packers', 'gm')
await pay(MFG, { category: 'levy', amount_rm: 9250, paid_on: day(-50), payee: 'Levy (sample payee)', country: 'Bangladesh', ref: 'SAMPLE-LV-1' })

// ===== Construction: letter of 60
log('Construction')
const con60 = await letter(CON, 1, '2026-04-15', { Bangladesh: 40, Indonesia: 20 })
await move(con60, 'Bangladesh', 6)
const cw = await workers(CON, con60, 'Bangladesh', ['Golam Rabbani', 'Habib Rahman', 'Jahid Hasan', 'Kawsar Ali', 'Liton Das', 'Mamun Sarkar'], (i) => (i === 0 ? 'Contract Ended' : 'Active-Working'), (i) => (i === 0 ? { exitDate: day(-30) } : {}))
await com(CON, con60, 'Bangladesh', cw[0], 2)
await batch(CON, con60, 'Indonesia', 'Indonesia site crew', [
  { name: 'Agus Santoso', to: 'sent', job: 'General worker' }, { name: 'Budi Hartono', to: 'stamping', job: 'Bar bender' },
  { name: 'Cahyo Wibowo', to: 'hq', job: 'Carpenter', arrived: -40, hostel: true }, { name: 'Dedi Kurniawan', to: 'converted', job: 'Mason', arrived: -35, hostel: true }], { flow: 'ceo', by: 'hra' })
await request(CON, con60, 'Bangladesh', 8, 'Bangladesh general workers', 'none', 'hra')
await pay(CON, { category: 'agent_fee', amount_rm: 16000, paid_on: day(-55), payee: 'SAMPLE Overseas Manpower (fictitious)', country: 'Indonesia' })

// ===== Plantation: letter of 80
log('Plantation')
const pla80 = await letter(PLA, 1, '2026-05-20', { Indonesia: 50, India: 30 })
await move(pla80, 'Indonesia', 8)
const pw8 = await workers(PLA, pla80, 'Indonesia', ['Eko Prasetyo', 'Fajar Nugroho', 'Gilang Saputra', 'Hendra Wijaya', 'Imam Fauzi', 'Joko Susilo', 'Kurnia Putra', 'Lukman Hakim'], (i) => (i === 0 ? 'Contract Ended' : 'Active-Working'), (i) => (i === 0 ? { exitDate: day(-35) } : {}))
await com(PLA, pla80, 'Indonesia', pw8[0], 3)
const plb = await batch(PLA, pla80, 'India', 'India harvesters', [
  { name: 'Harish Gowda', ecr: 'ECR', to: 'emigration', job: 'Harvester' }, { name: 'Irfan Shaikh', ecr: 'ECNR', to: 'ticket', job: 'Harvester', flightIn: 4 },
  { name: 'Jagan Mohan', ecr: 'ECR', to: 'hq', job: 'Harvester', arrived: -20, hostel: true }, { name: 'Kishore Naidu', ecr: 'ECR', to: 'medical', job: 'Harvester' },
  { name: 'Lokesh Reddy', ecr: 'ECNR', to: 'converted', job: 'Harvester', arrived: -45, hostel: true }], { flow: 'gm+ceo' })
// replacement in progress: FOMEMA unfit after arrival → replacement application sent to Immigration
const fom = await soft('fomema file', () => qfile(PLA.id, 'fomema', [['Worker', 'Jagan Mohan (sample)'], ['Result', 'UNFIT (sample)'], ['Examined', day(-10)]]))
await soft('accommodation', () => rpc('hrm', 'qr_recruit_arrival', { p_id: plb.ids[2], p: { accom_address: ACCOM } }))
await soft('fomema unfit', () => rpc('hrm', 'qr_recruit_fomema', { p_id: plb.ids[2], p_on: day(-10), p_result: 'unfit', p_file: fom || null, p_note: 'Sample: unfit result' }))
const rep = await soft('replacement', () => rpc('hrm', 'qr_repl_create', { p: { recruit_id: plb.ids[2], kind: 'fomema_fail', reason: 'Sample: FOMEMA unfit', trigger_date: day(0), fomema_file: fom || null } }))
if (rep) await soft('replacement applied', () => rpc('hrm', 'qr_repl_step', { p_id: rep, p_step: 'applied', p: { applied_on: day(-6), imm_ref: `SAMPLE-IMM-${stamp % 10000}` } }))
await request(PLA, pla80, 'Indonesia', 10, 'Indonesia field workers', 'gm')
await pay(PLA, { category: 'levy', amount_rm: 3200, paid_on: day(-40), payee: 'Levy (sample payee)', country: 'India', ref: 'SAMPLE-LV-2' })

// ===== Agriculture: letter of 10
log('Agriculture')
const agr10 = await letter(AGR, 1, '2026-06-12', { Nepal: 6, Myanmar: 4 })
await move(agr10, 'Nepal', 2)
await workers(AGR, agr10, 'Nepal', ['Sagar Adhikari', 'Tek Bahadur'])
await batch(AGR, agr10, 'Myanmar', 'Myanmar farm hands', [{ name: 'Aung Ko', to: 'medical', job: 'Farm hand' }, { name: 'Min Thu', to: 'sent', job: 'Farm hand' }], { flow: 'ceo' })
await request(AGR, agr10, 'Nepal', 3, 'Nepal farm hands', 'none')

// ---- sample logins: sign out, block and set inactive (the data keeps their names; Remove sample data deletes them)
for (const k of Object.keys(U)) {
  await U[k].c.auth.signOut().catch(() => {})
  await soft('ban ' + k, async () => ok(await admin.auth.admin.updateUserById(U[k].id, { ban_duration: '876000h' }), 'ban'))
}
ok(await admin.from('profiles').update({ status: 'inactive' }).in('id', out.users), 'deactivate sample users')
out.finished = new Date().toISOString(); out.warnings = warn
fs.writeFileSync(`/tmp/sample-seed-${target}.json`, JSON.stringify(out, null, 1))
log('seeded OK', { target, files: out.files, workers: out.workers, warnings: warn.length })
for (const w of warn) log('  warning:', w)
