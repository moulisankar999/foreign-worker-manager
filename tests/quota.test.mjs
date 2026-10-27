// Quota & Recruitment (036): RLS per role, ledger maths, Quota Use Request approvals (GM + CEO, CEO alone final),
// VDR gate, maker-checker, cost totals, CMO tally, double-claim guard, runaway tally, reconciliation.
// SAFETY: TEST project only (refuses live + any non-@example.com user). Never deletes users or other suites' data. Never prints secrets.
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
// TEST has shared users (incl. phone-only ones): this suite only creates, uses and touches its own fwq-*@example.com users and never deletes anyone.

let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : extra) }
const err = (r) => (r.error ? r.error.message : 'no error')
const pw = crypto.randomBytes(12).toString('hex'), stamp = Date.now()
const A = `qa-${stamp}`, B = `qb-${stamp}`
const U = {}
async function mk(key, role, companies = [], outlets = []) {
  const email = `fwq-${key}-${stamp}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: key.toUpperCase() } })
  if (error) throw error
  const up = await admin.from('profiles').update({ role, status: 'active', full_name: key.toUpperCase(), company_ids: companies, outlet_ids: outlets }).eq('id', data.user.id)
  if (up.error) throw up.error
  const c = createClient(URL_, ANON, opts); const s = await c.auth.signInWithPassword({ email, password: pw }); if (s.error) throw s.error
  U[key] = { id: data.user.id, c }
}
const tally = async (c, q, ctry) => ((await U.ceo.c.rpc('qr_tally', { p_company: c })).data || []).find((r) => r.quota_id === q && r.country === ctry) || {}
const fileRow = async (who, co, kind) => (await U[who].c.rpc('qr_add_file', { p_company: co, p_kind: kind, p_path: `${co}/${kind}/${crypto.randomUUID()}.pdf`, p_name: kind + '.pdf', p_mime: 'application/pdf', p_size: 1000, p_sha256: crypto.randomBytes(32).toString('hex') })).data

try {
  await mk('ceo', 'super_admin'); await mk('gm', 'general_manager'); await mk('gm2', 'general_manager')
  await mk('hra', 'hr_admin', [A]); await mk('hrm', 'hr_manager', [A]); await mk('hrmB', 'hr_manager', [B]); await mk('om', 'outlet_manager', [], ['O-none'])

  // ---- letters: HR records; HR Admin / HR Manager / GM / CEO open (t204u)
  let r = await U.hrm.c.rpc('qr_save_quota', { p: { company_id: A, ref_no: `KDN/${stamp}/1`, approval_date: '2026-09-01', expiry_date: '2027-09-01', sector: 'Services', breakdown: { India: 3, Nepal: 2 } } })
  check('HR Manager records a quota letter', !r.error, err(r)); const QA = r.data
  r = await U.om.c.rpc('qr_open_quota', { p_id: QA, p_ok: true }); check('Outlet manager cannot open (confirm) a letter', !!r.error)
  r = await U.hrm.c.rpc('qr_open_quota', { p_id: QA, p_ok: true, p_note: 'Checked against original' }); check('HR Manager opens the letter they recorded → ledger approved (t204u)', !r.error, err(r))
  let t = await tally(A, QA, 'India'); check('ledger: India approved 3, available 3', t.approved === 3 && t.available === 3, JSON.stringify(t))
  r = await U.hrmB.c.rpc('qr_save_quota', { p: { company_id: B, ref_no: `KDN/${stamp}/B`, approval_date: '2026-09-01', breakdown: { Bangladesh: 2 } } })
  const QB = r.data; await U.ceo.c.rpc('qr_open_quota', { p_id: QB, p_ok: true })

  // ---- RLS per role
  check('Outlet Manager sees no quota letters', ((await U.om.c.from('qr_quotas').select('id')).data || []).length === 0)
  check('Outlet Manager sees no ledger', ((await U.om.c.from('qr_ledger').select('id')).data || []).length === 0)
  check('HR Manager of company B cannot see company A letters', !((await U.hrmB.c.from('qr_quotas').select('id')).data || []).some((x) => x.id === QA))
  check('HR Manager of company A sees A letter', ((await U.hrm.c.from('qr_quotas').select('id').eq('id', QA)).data || []).length === 1)
  check('GM sees both companies', ((await U.gm.c.from('qr_quotas').select('id').in('id', [QA, QB])).data || []).length === 2)
  r = await U.hrmB.c.rpc('qr_request_use', { p: { quota_id: QA, country: 'India', slots: 1, purpose: 'x' } }); check('HR of company B cannot use company A quota', !!r.error)
  r = await U.om.c.rpc('qr_save_quota', { p: { company_id: A, ref_no: 'x', approval_date: '2026-01-01', breakdown: { India: 1 } } }); check('Outlet Manager cannot record letters', !!r.error)
  r = await U.ceo.c.from('qr_ledger').insert({ company_id: A, quota_id: QA, country: 'India', kind: 'approved', qty: 99 }); check('nobody inserts into the ledger directly (even CEO)', !!r.error)
  const anyEntry = (await admin.from('qr_ledger').select('id').eq('quota_id', QA).limit(1)).data[0].id
  r = await admin.from('qr_ledger').update({ qty: 50 }).eq('id', anyEntry); check('ledger rows can never be changed (even service role)', !!r.error)
  r = await admin.from('qr_ledger').delete().eq('id', anyEntry); check('ledger rows can never be deleted (even service role)', !!r.error)

  // ---- Quota Use Requests
  r = await U.ceo.c.rpc('qr_request_use', { p: { quota_id: QA, country: 'India', slots: 1, purpose: 'x' } }); check('CEO does not raise requests (would have no approver)', !!r.error)
  r = await U.hrm.c.rpc('qr_request_use', { p: { quota_id: QA, country: 'India', slots: 4, purpose: 'Too many' } }); check('request above the balance is refused', !!r.error && /Not enough quota/.test(err(r)), err(r))
  // recruits for the VDR gate
  const bt = await U.hrm.c.rpc('qr_save_batch', { p: { company_id: A, quota_id: QA, country: 'India', title: 'India batch 1', target_count: 2, budget_total: 20000 } })
  const R1 = (await U.hrm.c.rpc('qr_save_recruit', { p: { batch_id: bt.data, full_name: 'Ravi Kumar', passport_no: 'z1234567', ecr: 'ECR' } })).data
  const R2 = (await U.hrm.c.rpc('qr_save_recruit', { p: { batch_id: bt.data, full_name: 'Arjun Singh', passport_no: 'z7654321', ecr: 'ECNR' } })).data
  r = await U.hrm.c.rpc('qr_request_use', { p: { quota_id: QA, country: 'India', slots: 2, purpose: 'India batch 1 calling visa', batch_id: bt.data, recruit_ids: [R1, R2], est_cost_rm: 20000 } })
  check('HR Manager raises a Quota Use Request', !r.error, err(r)); const UR1 = r.data
  t = await tally(A, QA, 'India'); check('request reserves the slots (available 1, reserved 2)', t.available === 1 && t.reserved === 2, JSON.stringify(t))
  const notes = (await admin.from('notification_deliveries').select('user_id,title').like('dedupe_key', `qr|ur|${UR1}|%`)).data || []
  check('GM and CEO are notified in-app', notes.some((n) => n.user_id === U.gm.id) && notes.some((n) => n.user_id === U.ceo.id), JSON.stringify(notes.length))
  r = await U.hra.c.rpc('qr_decide_use', { p_id: UR1, p_action: 'approve' }); check('HR Admin cannot approve quota use', !!r.error)
  r = await U.hrm.c.rpc('qr_save_recruit', { p: { id: R1, vdr_applied: '2026-10-20', vdr_no: 'VDR1' } }); check('VDR blocked while request is pending', !!r.error && /Calling visa/.test(err(r)), err(r))
  r = await U.gm.c.rpc('qr_decide_use', { p_id: UR1, p_action: 'approve', p_note: 'OK from GM' })
  let ur = (await admin.from('qr_use_requests').select('*').eq('id', UR1).single()).data
  check('GM approval alone is not final (gm_approved)', r.data === 'gm_approved' && ur.status === 'gm_approved', err(r) + ur.status)
  r = await U.hrm.c.rpc('qr_save_recruit', { p: { id: R1, vdr_applied: '2026-10-20' } }); check('VDR still blocked after GM-only approval', !!r.error)
  r = await U.hrm.c.rpc('qr_save_recruit', { p: { id: R1, steps: { vdr_apply: { done: true } } } }); check('VDR checklist step also blocked by the database', !!r.error)
  r = await U.gm2.c.rpc('qr_decide_use', { p_id: UR1, p_action: 'approve' }); check('a second GM cannot complete it either', !!r.error)
  r = await U.ceo.c.rpc('qr_decide_use', { p_id: UR1, p_action: 'approve', p_note: 'Approved' })
  ur = (await admin.from('qr_use_requests').select('*').eq('id', UR1).single()).data
  check('CEO approval completes the request (GM step done)', ur.status === 'approved' && !ur.gm_skipped, JSON.stringify([ur.status, ur.gm_skipped]))
  r = await U.hrm.c.rpc('qr_save_recruit', { p: { id: R1, vdr_applied: '2026-10-21', vdr_no: 'VDR1' } }); check('VDR still blocked until recruitment and medical stages are done (no skipping)', !!r.error && /cannot start/.test(err(r)), err(r))
  const day = '2026-10-15', okStep = { done: true, date: day }
  r = await U.hrm.c.rpc('qr_save_recruit', { p: { id: R1, steps: { ra_check: okStep, selected: okStep, trade_test: okStep, offer: okStep } } }); check('HR completes the recruitment stage', !r.error, err(r))
  r = await U.hrm.c.rpc('qr_save_recruit', { p: { id: R1, steps: { medical: okStep } } }); check('medical step needs the result and report first', !!r.error, err(r))
  const medF = await fileRow('hrm', A, 'medical')
  r = await U.hrm.c.rpc('qr_recruit_docs', { p_id: R1, p: { medical_result: 'fit', medical_file: medF } }); check('medical result + report saved', !r.error, err(r))
  r = await U.hrm.c.rpc('qr_save_recruit', { p: { id: R1, steps: { medical: okStep, med_fit: okStep } } }); check('medical stages done once documents exist', !r.error, err(r))
  r = await U.hrm.c.rpc('qr_save_recruit', { p: { id: R1, vdr_applied: '2026-10-21', vdr_no: 'VDR1' } }); check('VDR allowed once approved and earlier stages done', !r.error, err(r))
  t = await tally(A, QA, 'India'); check('VDR application keeps the slot Reserved (used 0)', t.used === 0 && t.reserved === 2, JSON.stringify(t))
  const vdrF = await fileRow('hrm', A, 'vdr')
  r = await U.hrm.c.rpc('qr_set_vdr_copy', { p_recruit: R1, p_file: vdrF, p_approved: '2026-10-24' }); check('VDR approval copy uploaded', !r.error, err(r))
  t = await tally(A, QA, 'India'); check('VDR approval posts 1 used slot (reserved 1, used 1)', t.used === 1 && t.reserved === 1, JSON.stringify(t))
  r = await U.hrm.c.rpc('qr_save_recruit', { p: { id: R1, steps: { vdr_ok: { done: false } } } }); check('used step cannot be un-ticked', !!r.error, err(r))
  r = await U.hrm.c.rpc('qr_save_recruit', { p: { id: R1, vdr_no: 'VDR1b' } }); t = await tally(A, QA, 'India'); check('editing the recruit does not use a second slot', t.used === 1, JSON.stringify(t))

  // CEO-only approval
  r = await U.hra.c.rpc('qr_request_use', { p: { quota_id: QA, country: 'Nepal', slots: 1, purpose: 'Nepal replacement cook' } }); const UR2 = r.data
  r = await U.ceo.c.rpc('qr_decide_use', { p_id: UR2, p_action: 'approve' }); ur = (await admin.from('qr_use_requests').select('*').eq('id', UR2).single()).data
  check('CEO alone approves → approved, GM step skipped', ur.status === 'approved' && ur.gm_skipped && ur.timeline.some((x) => /GM step skipped/.test(x.action)), JSON.stringify([ur.status, ur.gm_skipped]))
  r = await U.gm.c.rpc('qr_decide_use', { p_id: UR2, p_action: 'approve' }); check('GM cannot act on a closed request', !!r.error)
  // 037: link a recruit to an existing request
  const btN = (await U.hrm.c.rpc('qr_save_batch', { p: { company_id: A, quota_id: QA, country: 'Nepal', title: 'Nepal batch 1', target_count: 2 } })).data
  const RN1 = (await U.hrm.c.rpc('qr_save_recruit', { p: { batch_id: btN, full_name: 'Bikash Gurung', passport_no: 'pa1111111' } })).data
  const RN2 = (await U.hrm.c.rpc('qr_save_recruit', { p: { batch_id: btN, full_name: 'Suman Rai', passport_no: 'pa2222222' } })).data
  r = await U.hrm.c.rpc('qr_link_recruit', { p_recruit: RN1, p_request: UR2 }); check('recruit linked to an approved request', !r.error, err(r))
  r = await U.hrm.c.rpc('qr_link_recruit', { p_recruit: RN2, p_request: UR2 }); check('link refused once all slots are covered', !!r.error && /all its slots/.test(err(r)), err(r))
  r = await U.hrm.c.rpc('qr_link_recruit', { p_recruit: R2, p_request: UR2 }); check('link refused for another country', !!r.error && /another company or country/.test(err(r)), err(r))
  r = await U.om?.c.rpc('qr_link_recruit', { p_recruit: RN2, p_request: UR2 }) ?? { error: { message: 'no om' } }; check('Outlet Manager cannot link recruits', !!r.error)

  // self-approval
  r = await U.gm.c.rpc('qr_request_use', { p: { quota_id: QA, country: 'Nepal', slots: 1, purpose: 'GM raised' } }); check('GM cannot raise requests (HR Admin / HR Manager only)', !!r.error, err(r))
  r = await U.hrm.c.rpc('qr_request_use', { p: { quota_id: QA, country: 'Nepal', slots: 1, purpose: 'Second cook' } }); const UR3 = r.data
  r = await U.hrm.c.rpc('qr_decide_use', { p_id: UR3, p_action: 'approve' }); check('requester cannot approve own request', !!r.error, err(r))
  // rejection releases
  t = await tally(A, QA, 'Nepal'); const before = t.available, beforeR = t.reserved
  r = await U.ceo.c.rpc('qr_decide_use', { p_id: UR3, p_action: 'reject' }); check('reject needs a note', !!r.error)
  r = await U.ceo.c.rpc('qr_decide_use', { p_id: UR3, p_action: 'reject', p_note: 'Not now' }); check('CEO rejects with note', r.data === 'rejected', err(r))
  t = await tally(A, QA, 'Nepal'); check('rejection releases the reserved slot', t.available === before + 1 && t.reserved === beforeR - 1, JSON.stringify(t))
  // return + resubmit
  r = await U.hrm.c.rpc('qr_request_use', { p: { quota_id: QA, country: 'Nepal', slots: 1, purpose: 'Kitchen helper' } }); const UR4 = r.data
  r = await U.gm.c.rpc('qr_decide_use', { p_id: UR4, p_action: 'return', p_note: 'Attach the job offer' }); check('GM returns with note', r.data === 'returned', err(r))
  r = await U.hrm.c.rpc('qr_decide_use', { p_id: UR4, p_action: 'resubmit', p_note: 'Attached' }); check('requester resubmits', r.data === 'pending', err(r))
  r = await U.hrm.c.rpc('qr_decide_use', { p_id: UR4, p_action: 'cancel', p_note: 'Not needed' }); t = await tally(A, QA, 'Nepal'); check('cancel releases the slot', r.data === 'cancelled' && t.reserved === beforeR - 1, err(r) + JSON.stringify(t))

  // ---- ledger maths invariant
  const all = (await U.ceo.c.rpc('qr_tally', { p_company: A })).data
  check('ledger maths: approved = available + reserved + used + lapsed (every country)', all.every((x) => x.approved === x.available + x.reserved + x.used + x.lapsed), JSON.stringify(all.map((x) => [x.country, x.approved, x.available, x.reserved, x.used])))
  r = await U.hrm.c.rpc('qr_move', { p_quota: QA, p_country: 'India', p_kind: 'expire', p_qty: 1, p_note: 'x' }); check('HR cannot expire / adjust quota (GM/CEO only)', !!r.error)
  r = await U.gm.c.rpc('qr_move', { p_quota: QA, p_country: 'India', p_kind: 'adjust_down', p_qty: 5, p_note: 'too many' }); check('balance can never go negative', !!r.error && /Not enough/.test(err(r)), err(r))

  // ---- payments + cost totals + maker-checker
  await admin.from('qr_rules').update({ payment_check_rm: 5000 }).eq('id', 1)
  const p1 = await U.hrm.c.rpc('qr_add_payment', { p: { company_id: A, batch_id: bt.data, recruit_id: R1, country: 'India', category: 'levy', amount_rm: 1850, paid_on: '2026-10-01' } })
  const p2 = await U.hrm.c.rpc('qr_add_payment', { p: { company_id: A, batch_id: bt.data, recruit_id: R1, country: 'India', category: 'agent_fee', amount_rm: 6000, paid_on: '2026-10-02' } })
  const p3 = await U.hra.c.rpc('qr_add_payment', { p: { company_id: A, batch_id: bt.data, recruit_id: R2, country: 'India', category: 'medical', amount_rm: 250.5, paid_on: '2026-10-03' } })
  check('payments recorded', !p1.error && !p2.error && !p3.error, err(p1) + err(p2) + err(p3))
  const pr = (await U.hrm.c.from('qr_payments').select('*').eq('batch_id', bt.data)).data
  check('big payment waits for a second check', pr.find((x) => x.id === p2.data)?.status === 'pending_check')
  r = await U.hrm.c.rpc('qr_check_payment', { p_id: p2.data }); check('recorder cannot verify own payment', !!r.error)
  r = await U.hra.c.rpc('qr_check_payment', { p_id: p2.data }); check('HR Admin verifies another person\'s payment', !r.error, err(r))
  r = await U.hra.c.rpc('qr_check_payment', { p_id: p1.data, p_void: true, p_reason: 'Duplicate' })
  const live = (await U.hrm.c.from('qr_payments').select('*').eq('batch_id', bt.data)).data.filter((x) => x.status !== 'void')
  const perRecruit = live.reduce((m, x) => ((m[x.recruit_id] = (m[x.recruit_id] || 0) + Number(x.amount_rm)), m), {})
  const total = live.reduce((s, x) => s + Number(x.amount_rm), 0)
  check('cost totals: batch RM 6,250.50 after void; per recruit 6000 / 250.50', Math.abs(total - 6250.5) < 0.001 && perRecruit[R1] === 6000 && perRecruit[R2] === 250.5, JSON.stringify({ total, perRecruit }))

  // ---- CMO register + tally + double claim
  // two workers already in Malaysia under this letter (imported: use_existing), one leaves with CMO
  r = await U.gm.c.rpc('qr_move', { p_quota: QA, p_country: 'Nepal', p_kind: 'use_existing', p_qty: 1, p_note: 'Existing worker import' }); check('GM imports an existing worker onto the letter', !r.error, err(r))
  await admin.from('records').upsert([
    { entity: 'workers', id: `QW1-${stamp}`, client_ts: new Date().toISOString(), data: { id: `QW1-${stamp}`, workerNo: 'FWQ1', fullName: 'Bikash Thapa', nationality: 'Nepal', status: 'Active-Working', quotaId: QA, companyId: A } }])
  t = await tally(A, QA, 'Nepal'); check('reconciliation OK: used 1 = active worker 1, mismatch 0', t.used === 1 && t.active_workers === 1 && t.mismatch === 0, JSON.stringify(t))
  let ti = await tally(A, QA, 'India'); check('reconciliation OK: India used 1 = 1 recruit in pipeline (VDR applied)', ti.used === 1 && ti.in_pipeline === 1 && ti.mismatch === 0, JSON.stringify(ti))
  await U.gm.c.rpc('qr_move', { p_quota: QA, p_country: 'India', p_kind: 'use_existing', p_qty: 1, p_note: 'Import with no worker record' })
  ti = await tally(A, QA, 'India'); check('reconciliation flags a used slot with no worker / recruit behind it', ti.mismatch === 1, JSON.stringify(ti))
  await admin.from('records').update({ data: { id: `QW1-${stamp}`, workerNo: 'FWQ1', fullName: 'Bikash Thapa', nationality: 'Nepal', status: 'Repatriated', quotaId: QA, companyId: A } }).eq('entity', 'workers').eq('id', `QW1-${stamp}`)
  t = await tally(A, QA, 'Nepal'); check('departed worker with no CMO shows as unrecorded exit', t.exited_unrecorded === 1, JSON.stringify(t))
  r = await U.hrm.c.rpc('qr_record_exit', { p: { company_id: A, quota_id: QA, country: 'Nepal', worker_id: `QW1-${stamp}`, worker_name: 'Bikash Thapa', cmo_ref: `COM-${stamp}` } })
  check('CMO needs the scanned copy', !!r.error)
  const f1 = await fileRow('hrm', A, 'cmo')
  r = await U.hrm.c.rpc('qr_record_exit', { p: { company_id: A, quota_id: QA, country: 'Nepal', worker_id: `QW1-${stamp}`, worker_no: 'FWQ1', worker_name: 'Bikash Thapa', passport_no: 'pa111', permit_no: 'PLKS1', cmo_ref: `COM-${stamp}`, cmo_date: '2026-10-10', departure_date: '2026-10-12', flight_no: 'MH114', exit_reason: 'Contract ended', file_id: f1 } })
  check('CMO recorded', !r.error, err(r)); const X1 = r.data
  t = await tally(A, QA, 'Nepal'); check('CMO tally: exited_cmo 1, eligible 1, unrecorded 0', t.exited_cmo === 1 && t.repl_eligible === 1 && t.exited_unrecorded === 0, JSON.stringify(t))
  r = await U.hrm.c.rpc('qr_record_exit', { p: { company_id: A, quota_id: QA, country: 'Nepal', worker_name: 'Someone', cmo_ref: `COM-${stamp}`, file_id: f1 } }); check('same CMO reference cannot be recorded twice', !!r.error)
  r = await admin.from('qr_files').delete().eq('id', f1); check('CMO copy record can never be deleted', !!r.error)
  r = await U.hrm.c.rpc('qr_claim_create', { p: { company_id: A, title: 'x', exit_ids: [X1] } }); check('HR Manager cannot build claims (HR Admin+)', !!r.error)
  r = await U.hra.c.rpc('qr_claim_create', { p: { company_id: A, title: 'Gantian 2026 round', exit_ids: [X1] } }); check('HR Admin builds a replacement claim', !r.error, err(r)); const C1 = r.data
  t = await tally(A, QA, 'Nepal'); check('claim moves CMO from eligible to applied', t.repl_eligible === 0 && t.repl_applied === 1, JSON.stringify(t))
  r = await U.hra.c.rpc('qr_claim_create', { p: { company_id: A, title: 'Again', exit_ids: [X1] } }); check('double claim of the same CMO refused', !!r.error && /twice/.test(err(r)), err(r))
  r = await admin.from('qr_claim_items').insert({ claim_id: C1, exit_id: X1 }); check('database index also refuses a second live claim item', !!r.error)
  r = await U.hra.c.rpc('qr_claim_status', { p_id: C1, p: { status: 'submitted', gov_ref: 'FWCMS-123' } }); check('claim submitted', !r.error, err(r))
  r = await U.gm.c.rpc('qr_void_exit', { p_id: X1, p_reason: 'x' }); check('a claimed CMO cannot be voided', !!r.error)
  r = await U.gm.c.rpc('qr_claim_status', { p_id: C1, p: { status: 'approved', gov_ref: `KDN/REPL/${stamp}`, expiry_date: '2027-10-01', breakdown: { Nepal: 1 } } }); check('GM records the approval', !r.error, err(r))
  t = await tally(A, QA, 'Nepal'); check('tally: replacement approved 1', t.repl_approved === 1 && t.repl_applied === 0, JSON.stringify(t))
  const cl = (await admin.from('qr_claims').select('*').eq('id', C1).single()).data
  const nt = await tally(A, cl.new_quota_id, 'Nepal'); check('approved window application posts an additional letter to the ledger, linked to the claim', nt.approved === 1 && nt.kind === 'additional', JSON.stringify(nt))
  check('CMO is now replaced (cannot be claimed again)', (await admin.from('qr_exits').select('status').eq('id', X1).single()).data.status === 'replaced')

  // ---- runaway
  await admin.from('records').upsert([{ entity: 'workers', id: `QW2-${stamp}`, client_ts: new Date().toISOString(), data: { id: `QW2-${stamp}`, workerNo: 'FWQ2', fullName: 'Ram Gurung', nationality: 'Nepal', status: 'Absconded', quotaId: cl.new_quota_id, companyId: A } }])
  t = await tally(A, cl.new_quota_id, 'Nepal'); check('Absconded worker without a case still counts as runaway', t.runaways === 1, JSON.stringify(t))
  r = await U.hrm.c.rpc('qr_save_runaway', { p: { company_id: A, quota_id: cl.new_quota_id, country: 'Nepal', worker_id: `QW2-${stamp}`, worker_name: 'Ram Gurung', last_seen: '2026-10-01', bond_rm: 1500 } })
  check('runaway case opened', !r.error, err(r)); const RN = r.data
  t = await tally(A, cl.new_quota_id, 'Nepal'); check('runaway counted once (case + status)', t.runaways === 1 && t.repl_eligible === 0, JSON.stringify(t))
  r = await U.hrm.c.rpc('qr_save_runaway', { p: { id: RN, outcome: 'found' } }); check('HR Manager cannot close a runaway case', !!r.error)
  r = await U.hra.c.rpc('qr_save_runaway', { p: { id: RN, police_report_no: 'RPT/1', outcome: 'returned', outcome_note: 'Came back' } }); check('HR Admin records the outcome', !r.error, err(r))
  await admin.from('records').update({ data: { id: `QW2-${stamp}`, workerNo: 'FWQ2', fullName: 'Ram Gurung', nationality: 'Nepal', status: 'Active-Working', quotaId: cl.new_quota_id, companyId: A } }).eq('entity', 'workers').eq('id', `QW2-${stamp}`)
  t = await tally(A, cl.new_quota_id, 'Nepal'); check('returned runaway leaves the runaway count', t.runaways === 0 && t.active_workers === 1, JSON.stringify(t))

  // ---- audit trail
  const au = (await admin.from('audit_log').select('action').like('action', 'qr_%').gte('at', new Date(stamp - 60000).toISOString())).data || []
  check('every step is audited', ['qr_quota_add', 'qr_quota_open', 'qr_use_requested', 'qr_use_approved', 'qr_use_rejected', 'qr_payment_check', 'qr_exit_add', 'qr_claim_add', 'qr_claim_approved', 'qr_runaway_add'].every((a) => au.some((x) => x.action === a)),
    JSON.stringify([...new Set(au.map((x) => x.action))]))
} catch (e) { fail++; console.log('FAIL exception', e.message) }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
