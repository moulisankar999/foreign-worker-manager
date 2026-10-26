// Quota Rules & regulations (040/041) + replacement + follow-ups + CEO override.
// Effective-date behaviour, sector violation flag/block, template change that keeps in-progress recruits on their version,
// rule maker-checker (HR Admin → CEO), India ECR woman under 30 blocked, replacement flow with a second HR Admin verifying.
// SAFETY: TEST project only. Creates only its own fwq-*@example.com users and its own scopes (sector QT<stamp>, country QTLand<stamp>).
// Never deletes users. Never prints secrets. Its own rule rows are withdrawn at the end.
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
let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : extra) }
const err = (r) => (r.error ? r.error.message : 'no error')
const pw = crypto.randomBytes(12).toString('hex'), stamp = Date.now()
const A = `qr-${stamp}`, SEC = `QT${stamp}`, LAND = `QTLand${stamp}`
const U = {}; const myRules = []
async function mk(key, role, companies = []) {
  const email = `fwq-${key}-${stamp}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: key.toUpperCase() } })
  if (error) throw error
  const up = await admin.from('profiles').update({ role, status: 'active', full_name: key.toUpperCase(), company_ids: companies }).eq('id', data.user.id); if (up.error) throw up.error
  const c = createClient(URL_, ANON, opts); const s = await c.auth.signInWithPassword({ email, password: pw }); if (s.error) throw s.error
  U[key] = { id: data.user.id, c }
}
const fileRow = async (who, kind) => (await U[who].c.rpc('qr_add_file', { p_company: A, p_kind: kind, p_path: `${A}/${kind}/${crypto.randomUUID()}.pdf`, p_name: kind + '.pdf', p_mime: 'application/pdf', p_size: 1000, p_sha256: crypto.randomBytes(32).toString('hex') })).data
const propose = async (who, p) => { const r = await U[who].c.rpc('qr_reg_propose', { p }); if (r.data) myRules.push(r.data); return r }
const ymd = (y) => { const d = new Date(); d.setFullYear(d.getFullYear() - y); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 10) }
const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
const ok = { done: true, date: today }

try {
  await mk('ceo', 'super_admin'); await mk('gm', 'general_manager'); await mk('hra', 'hr_admin', [A]); await mk('hra2', 'hr_admin', [A]); await mk('hrm', 'hr_manager', [A])

  // ---- sector rule versions: effective-date behaviour + violation flag / block
  let r = await propose('ceo', { key: 'sector_rules', scope: SEC, value: { mode: 'warn', jobs: ['Cook'], countries: [LAND, 'India'] }, effective_from: '2020-01-01', source_ref: `Test circular ${stamp}/1` })
  check('CEO sets a sector rule (active at once)', !r.error, err(r))
  r = await propose('ceo', { key: 'sector_rules', scope: SEC, value: { mode: 'block', jobs: ['Cook'], countries: [LAND, 'India'] }, effective_from: '2026-10-01', source_ref: `Test circular ${stamp}/2` })
  check('CEO schedules version 2 (block) from 1 Oct 2026', !r.error, err(r))
  r = await propose('ceo', { key: 'sector_rules', scope: SEC, value: { mode: 'block' }, effective_from: '2026-10-01' }); check('a rule change needs its source reference', !!r.error && /source/.test(err(r)), err(r))
  r = await U.hrm.c.rpc('qr_save_quota', { p: { company_id: A, ref_no: `KDN/${stamp}/old`, approval_date: '2026-09-15', expiry_date: '2027-09-15', sector: SEC, breakdown: { [LAND]: 2, Nepal: 1 } } })
  check('letter dated before v2: version 1 (warn) applies — saved', !r.error, err(r))
  const flags = (await admin.from('qr_quotas').select('rule_flags').eq('id', r.data).single()).data?.rule_flags || []
  check('sector violation is flagged on the letter (Nepal not allowed)', flags.some((f) => /Nepal/.test(f)), JSON.stringify(flags))
  r = await U.hrm.c.rpc('qr_save_quota', { p: { company_id: A, ref_no: `KDN/${stamp}/new`, approval_date: '2026-10-10', expiry_date: '2027-10-10', sector: SEC, breakdown: { [LAND]: 2, Nepal: 1 } } })
  check('letter dated after v2: version 2 (block) refuses the violation', !!r.error && /Sector rule/.test(err(r)), err(r))
  r = await U.hrm.c.rpc('qr_save_quota', { p: { company_id: A, ref_no: `KDN/${stamp}/1`, approval_date: '2026-10-10', expiry_date: '2027-10-10', sector: SEC, breakdown: { [LAND]: 5, India: 3 } } })
  check('compliant letter under v2 is accepted', !r.error, err(r)); const Q = r.data
  await U.gm.c.rpc('qr_open_quota', { p_id: Q, p_ok: true, p_note: 'checked' })

  // ---- maker-checker on rules
  r = await propose('hra', { key: 'sector_rules', scope: SEC + 'b', value: { mode: 'warn' }, effective_from: today, source_ref: 'HR proposal' }); const P1 = r.data
  check('HR Admin proposes a rule change → waiting for the CEO', !r.error && (await admin.from('qr_reg_rules').select('status').eq('id', P1).single()).data?.status === 'pending', err(r))
  r = await propose('hrm', { key: 'sector_rules', scope: SEC + 'c', value: { mode: 'warn' }, effective_from: today, source_ref: 'x' }); check('HR Manager cannot change rules', !!r.error)
  r = await U.hra.c.rpc('qr_reg_decide', { p_id: P1, p_approve: true }); check('HR Admin cannot approve own change', !!r.error)
  r = await U.gm.c.rpc('qr_reg_decide', { p_id: P1, p_approve: true }); check('GM cannot approve rule changes', !!r.error)
  r = await U.ceo.c.rpc('qr_reg_decide', { p_id: P1, p_approve: false }); check('CEO rejection needs a reason', !!r.error)
  r = await U.ceo.c.rpc('qr_reg_decide', { p_id: P1, p_approve: true, p_note: 'OK' }); check('CEO approves → active', r.data === 'active', err(r))
  r = await propose('hra', { key: 'sector_rules', scope: SEC + 'd', value: { mode: 'warn' }, effective_from: today, source_ref: 'HR proposal 2' })
  r = await U.hra.c.rpc('qr_reg_decide', { p_id: r.data, p_approve: false, p_note: 'typo' }); check('proposer can withdraw', r.data === 'withdrawn', err(r))
  r = await U.ceo.c.rpc('qr_reg_impact', { p: { key: 'sector_rules', scope: SEC, value: { mode: 'block', jobs: ['Chef'] }, effective_from: today } })
  check('impact preview runs before saving', !r.error && Array.isArray(r.data), err(r))
  r = await U.ceo.c.rpc('qr_reg_catalog'); check('rule catalogue lists all six groups', !r.error && ['Quota', 'Deadlines', 'Levy & fees', 'Sector rules', 'Country pipelines', 'Replacement'].every((g) => r.data.some((x) => x.grp === g)), err(r))

  // ---- pipeline template: change does not break in-progress recruits
  const T1 = { use_step: 'vdr_ok', stages: [
    { key: 'quota', label: 'Quota approval', steps: [{ key: '_quota', label: 'Quota Use Request approved' }] },
    { key: 'recruit', label: 'Recruitment', steps: [{ key: 'selected', label: 'Selected' }] },
    { key: 'vdr', label: 'Calling visa application', steps: [{ key: 'vdr_apply', label: 'VDR applied' }] },
    { key: 'vdr_gate', label: 'Calling visa approved', steps: [{ key: 'vdr_ok', label: 'VDR approved', requires: ['vdr_file'] }] },
    { key: 'hq', label: 'Arrived', steps: [{ key: 'arrived_hq', label: 'Arrived at HQ', requires: ['arrived_at'] }] },
    { key: 'onboard', label: 'Onboard', steps: [{ key: 'onboard', label: 'Worker record created' }] }] }
  r = await propose('ceo', { key: 'pipeline', scope: LAND, value: T1, effective_from: '2026-01-01', source_ref: 'Test template v1' }); check('CEO sets a country pipeline', !r.error, err(r)); const TV1 = r.data
  const bt = (await U.hrm.c.rpc('qr_save_batch', { p: { company_id: A, quota_id: Q, country: LAND, title: 'QT batch', target_count: 3 } })).data
  const RA = (await U.hrm.c.rpc('qr_save_recruit', { p: { batch_id: bt, full_name: 'In Progress', passport_no: 'q1' + stamp % 1e6 } })).data
  check('recruit pinned to the template in force', (await admin.from('qr_recruits').select('template_id').eq('id', RA).single()).data?.template_id === TV1)
  const T2 = JSON.parse(JSON.stringify(T1)); T2.stages[1].steps.push({ key: 'police_check', label: 'Police clearance' })
  r = await U.ceo.c.rpc('qr_reg_impact', { p: { key: 'pipeline', scope: LAND, value: T2, effective_from: today } })
  check('impact preview of a template change reports recruits staying on their version', !r.error && (r.data || []).some((x) => x.n >= 1), JSON.stringify(r.data || err(r)))
  r = await propose('ceo', { key: 'pipeline', scope: LAND, value: T2, effective_from: today, source_ref: 'Test template v2' }); const TV2 = r.data
  const RB = (await U.hrm.c.rpc('qr_save_recruit', { p: { batch_id: bt, full_name: 'New Version', passport_no: 'q2' + stamp % 1e6 } })).data
  check('new recruit gets the new template version', (await admin.from('qr_recruits').select('template_id').eq('id', RB).single()).data?.template_id === TV2)
  r = await U.hrm.c.rpc('qr_request_use', { p: { quota_id: Q, country: LAND, slots: 2, purpose: 'QT', batch_id: bt, recruit_ids: [RA, RB] } }); const UR = r.data
  await U.ceo.c.rpc('qr_decide_use', { p_id: UR, p_action: 'approve', p_note: 'ok' })
  r = await U.hrm.c.rpc('qr_save_recruit', { p: { id: RA, steps: { selected: ok, vdr_apply: ok }, vdr_applied: today, vdr_no: 'VA' } }); check('in-progress recruit continues on its old version (no new police step)', !r.error, err(r))
  r = await U.hrm.c.rpc('qr_save_recruit', { p: { id: RB, steps: { selected: ok, vdr_apply: ok }, vdr_applied: today, vdr_no: 'VB' } }); check('recruit on the new version needs the new step first', !!r.error && /cannot start/.test(err(r)), err(r))

  // ---- CEO stage override with a note
  r = await U.hrm.c.rpc('qr_stage_override', { p_id: RB, p_stage: 'recruit', p_note: 'x' }); check('only the CEO can override a stage', !!r.error)
  r = await U.ceo.c.rpc('qr_stage_override', { p_id: RB, p_stage: 'recruit', p_note: '' }); check('CEO override needs a note', !!r.error)
  r = await U.ceo.c.rpc('qr_stage_override', { p_id: RB, p_stage: 'recruit', p_note: 'Police clearance seen on paper' }); check('CEO overrides the stage with a note', !r.error, err(r))
  const rb = (await admin.from('qr_recruits').select('steps,stage').eq('id', RB).single()).data
  check('override is recorded on the step', rb.steps?.police_check?.override === true && rb.stage === 'vdr', JSON.stringify([rb.stage, rb.steps?.police_check]))

  // ---- India eligibility: ECR woman under 30, age range
  const btI = (await U.hrm.c.rpc('qr_save_batch', { p: { company_id: A, quota_id: Q, country: 'India', title: 'QT India', target_count: 3 } })).data
  r = await U.hrm.c.rpc('qr_save_recruit', { p: { batch_id: btI, full_name: 'Priya', passport_no: 'q3' + stamp % 1e6, ecr: 'ECR', gender: 'Female', dob: ymd(25), job: 'Cook' } })
  check('India ECR woman under 30 is blocked', !!r.error && /Not eligible/.test(err(r)), err(r))
  r = await U.hrm.c.rpc('qr_save_recruit', { p: { batch_id: btI, full_name: 'Meena', passport_no: 'q4' + stamp % 1e6, ecr: 'ECNR', gender: 'Female', dob: ymd(25), job: 'Cook' } })
  check('India ECNR woman under 30 is allowed', !r.error, err(r))
  r = await U.hrm.c.rpc('qr_save_recruit', { p: { batch_id: btI, full_name: 'Old', passport_no: 'q5' + stamp % 1e6, ecr: 'ECNR', gender: 'Male', dob: ymd(50), job: 'Cook' } })
  check('India first entry above 45 is blocked', !!r.error && /Not eligible/.test(err(r)), err(r))

  // ---- replacement: VDR approved but did not arrive
  const vf = await fileRow('hrm', 'vdr')
  r = await U.hrm.c.rpc('qr_set_vdr_copy', { p_recruit: RA, p_file: vf, p_approved: today }); check('VDR approved → slot Used', !r.error, err(r))
  let t = ((await U.ceo.c.rpc('qr_tally', { p_company: A })).data || []).find((x) => x.quota_id === Q && x.country === LAND) || {}
  check('tally: used 1', t.used === 1, JSON.stringify(t))
  r = await U.hrm.c.rpc('qr_repl_create', { p: { kind: 'runaway', recruit_id: RA, trigger_date: today, reason: 'x' } }); check('runaways are not replaceable', !!r.error, err(r))
  r = await U.hrm.c.rpc('qr_repl_create', { p: { kind: 'death', recruit_id: RA, trigger_date: today, reason: 'x' } }); check('deaths are not replaceable', !!r.error, err(r))
  r = await U.hrm.c.rpc('qr_repl_create', { p: { kind: 'not_arrived', recruit_id: RA, trigger_date: today, reason: 'x' } }); check('did-not-arrive needs the recruit ended first', !!r.error, err(r))
  r = await U.hrm.c.rpc('qr_recruit_out', { p_id: RA, p_kind: 'did_not_travel', p_reason: 'Family emergency' }); check('HR ends the recruit after VDR approval', !r.error, err(r))
  r = await U.hrm.c.rpc('qr_repl_create', { p: { kind: 'not_arrived', recruit_id: RA, trigger_date: today, reason: 'Did not travel', owner_id: U.hrm.id } }); check('HR opens a replacement application', !r.error, err(r)); const RP = r.data
  t = ((await U.ceo.c.rpc('qr_tally', { p_company: A })).data || []).find((x) => x.quota_id === Q && x.country === LAND) || {}
  check('slot shows Pending cancellation meanwhile', t.pending_cancel === 1, JSON.stringify(t))
  r = await U.gm.c.rpc('qr_followups'); check('GM sees HR follow-ups', !r.error && (r.data || []).some((x) => x.ref && x.company_id === A), err(r) + JSON.stringify((r.data || []).length))
  const fu = (r.data || []).find((x) => x.company_id === A && x.kind === 'replacement') || (r.data || []).find((x) => x.company_id === A)
  if (fu) {
    r = await U.gm.c.rpc('qr_task_nudge', { p_kind: fu.kind, p_ref: fu.ref, p_note: 'Please apply this week' }); check('GM nudges the owner', !r.error, err(r))
    r = await U.gm.c.rpc('qr_task_reassign', { p_kind: fu.kind, p_ref: fu.ref, p_owner: U.hra.id }); check('GM reassigns the task', !r.error, err(r))
    r = await U.hrm.c.rpc('qr_task_nudge', { p_kind: fu.kind, p_ref: fu.ref, p_note: 'x' }); check('HR Manager cannot nudge (GM / CEO panel)', !!r.error)
  }
  r = await U.hrm.c.rpc('qr_repl_step', { p_id: RP, p_step: 'applied', p: { applied_on: today, imm_ref: `IMM/${stamp}` } }); check('HR records the Immigration application', r.data === 'applied', err(r))
  const af = await fileRow('hra', 'imm_approval')
  r = await U.hra.c.rpc('qr_repl_step', { p_id: RP, p_step: 'upload', p: { approval_file: af, approval_date: today } }); check('HR Admin uploads Immigration approval', r.data === 'approval_uploaded', err(r))
  r = await U.hra.c.rpc('qr_repl_step', { p_id: RP, p_step: 'verify' }); check('uploader cannot verify', !!r.error)
  r = await U.gm.c.rpc('qr_repl_step', { p_id: RP, p_step: 'verify' }); check('GM cannot verify (HR Admin task)', !!r.error)
  r = await U.hra2.c.rpc('qr_repl_step', { p_id: RP, p_step: 'verify' }); check('a different HR Admin verifies → restored', r.data === 'restored', err(r))
  t = ((await U.ceo.c.rpc('qr_tally', { p_company: A })).data || []).find((x) => x.quota_id === Q && x.country === LAND) || {}
  check('slot restored as Replacement approved by Immigration', t.imm_restored === 1 && t.pending_cancel === 0, JSON.stringify(t))

  const au = (await admin.from('audit_log').select('action').like('action', 'qr_%').gte('at', new Date(stamp - 60000).toISOString())).data || []
  check('rule and replacement steps are audited', ['qr_reg_set', 'qr_reg_proposed', 'qr_reg_approved', 'qr_reg_withdrawn', 'qr_stage_override', 'qr_repl_add', 'qr_repl_verify'].every((a) => au.some((x) => x.action === a)), JSON.stringify([...new Set(au.map((x) => x.action))]))
} catch (e) { fail++; console.log('FAIL exception', e.message) }
finally {
  // withdraw this suite's own rule rows so they never affect anyone else on TEST
  if (myRules.length) await admin.from('qr_reg_rules').update({ status: 'withdrawn', decide_note: 'test cleanup' }).in('id', myRules)
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
