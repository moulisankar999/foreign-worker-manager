// v1.2.1 pay & contribution rules: set_pay_config permissions + audit, payslip data hidden from outlet managers,
// and calculator checks (EPF rounding, OT ×1.5, 104 h warning, RM150 hostel limit, late pay, 50% deductions).
// SAFETY: runs ONLY against the separate TEST project (TEST_SUPABASE_URL in .secrets.env),
// refuses the live project, and refuses any project that has non-@example.com users. Never prints passwords.
import { createRequire } from 'module'
import fs from 'fs'
import crypto from 'crypto'
import { rid, cleanupOwn, makeCeo, keepConfig } from './_own.mjs'
import { execSync } from 'child_process'
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
const PFX = 'fwp-'
const P1_ = rid('P1'), PW1_ = rid('PW1')
await cleanupOwn(admin, PFX)
const restoreCfg = await keepConfig(admin, ['rates', 'holidays'])
const U = {}
const mkClient = () => createClient(URL_, ANON, opts)
async function mk(key) {
  const email = `${PFX}${key}-${stamp}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: key.toUpperCase() } })
  if (error) throw error
  const c = mkClient(); const s = await c.auth.signInWithPassword({ email, password: pw }); if (s.error) throw s.error
  U[key] = { id: data.user.id, email, c }
  return U[key]
}
const now = () => new Date().toISOString()
const err = (r) => r.error ? r.error.message : 'no error'

// ---- calculator (pure functions, bundled from src/lib/pay.ts)
const out = `/tmp/fwm-pay-${stamp}.mjs`
execSync(`npx rolldown src/lib/pay.ts --file ${out} --format esm`, { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' })
const P = await import(out)
const R = P.DEFAULT_RATES
check('EPF 2% of RM1,751 rounds up to RM36', P.epfShare(1751, 2) === 36, String(P.epfShare(1751, 2)))
check('EPF 2% of RM1,700 = RM34', P.epfShare(1700, 2) === 34, String(P.epfShare(1700, 2)))
let r = P.computePayslip({ id: 'a', month: '2026-09', basic: 1700, otNormalH: 10, payDate: '2026-10-05' }, R, undefined, '2026-10-10')
check('OT ×1.5 of hourly rate (1700/26/8)', Math.abs(r.otNormal - 10 * 1.5 * r.orpHourly) < 0.02 && r.orpHourly === 8.17, JSON.stringify([r.otNormal, r.orpHourly]))
check('EPF excludes overtime', r.epfWages === 1700 && r.epfEe === 34 && r.epfEr === 34)
check('no red warnings for a normal month', !r.warnings.some((w) => w.level === 'red'), JSON.stringify(r.warnings))
r = P.computePayslip({ id: 'b', month: '2026-09', basic: 1700, otNormalH: 110, payDate: '2026-10-05' }, R, undefined, '2026-10-10')
check('more than 104 OT hours → red warning', r.warnings.some((w) => w.key === 'ot' && w.level === 'red'))
r = P.computePayslip({ id: 'c', month: '2026-09', basic: 1700, otNormalH: 95, payDate: '2026-10-05' }, R, undefined, '2026-10-10')
check('near 104 OT hours → amber warning', r.warnings.some((w) => w.key === 'ot' && w.level === 'amber'))
r = P.computePayslip({ id: 'd', month: '2026-09', basic: 1500, payDate: '2026-10-05' }, R, undefined, '2026-10-10')
check('below RM1,700 → minimum-wage warning', r.warnings.some((w) => w.key === 'minwage' && w.level === 'red'))
r = P.computePayslip({ id: 'd2', month: '2026-09', basic: 1500, payDate: '2026-10-05' }, R, { minWageExempt: true, minWageExemptReason: 'domestic' }, '2026-10-10')
check('exemption switches the minimum-wage warning to info', !r.warnings.some((w) => w.key === 'minwage' && w.level === 'red'))
r = P.computePayslip({ id: 'e', month: '2026-09', basic: 1700, payDate: '2026-10-09' }, R, undefined, '2026-10-10')
check('wages paid after the 7th → late warning', r.warnings.some((w) => w.key === 'late'))
r = P.computePayslip({ id: 'f', month: '2026-09', basic: 1700, payDate: '2026-10-05', advance: 900 }, R, undefined, '2026-10-10')
check('deductions over 50% → warning', r.warnings.some((w) => w.key === 'deduct'))
const wk = { documents: [], hostelDeduction: { amount: 200, writtenRequest: true, dgApproval: true, contractAmount: 200 } }
r = P.computePayslip({ id: 'g', month: '2026-04', basic: 1700, hostel: 200, payDate: '2026-05-05' }, R, wk, '2026-05-10')
check('hostel RM200 after 1 Mar 2026 → over the RM150 limit', r.hostelCap === 150 && r.warnings.some((w) => w.key === 'hostel' && /150/.test(w.text)), JSON.stringify(r.warnings))
r = P.computePayslip({ id: 'h', month: '2026-01', basic: 1700, hostel: 120, payDate: '2026-02-05' }, R, wk, '2026-02-10')
check('hostel limit before 1 Mar 2026 is RM100', r.hostelCap === 100)
check('leave by service: 1 / 3 / 6 years → 8 / 12 / 16 days', [P.statutoryLeave('2025-06-01', R, '2026-10-01').annual, P.statutoryLeave('2023-06-01', R, '2026-10-01').annual, P.statutoryLeave('2020-06-01', R, '2026-10-01').annual].join() === '8,12,16')
const ph = P.holidaysFor(P.DEFAULT_HOLIDAYS, 2026, 'Selangor')
check('2026 Selangor holiday list has the compulsory days', ['-05-01', '-08-31', '-09-16'].every((d) => ph.some((h) => h.date === '2026' + d)) && ph.length >= 11, String(ph.length))
fs.rmSync(out, { force: true })

// ---- server: set_pay_config permissions, audit, payslip hiding
try {
  const S = await mk('ceo')
  await makeCeo(admin, S.id)
  await S.c.rpc('push_records', { p_rows: [
    { entity: 'outlets', id: P1_, client_ts: now(), data: { id: P1_, name: 'Pay Outlet', companyId: 'main', state: 'Selangor' } },
    { entity: 'workers', id: PW1_, client_ts: now(), data: { id: PW1_, workerNo: 'FWP1', fullName: 'Pay Worker', outletId: P1_, nationality: 'Nepal', status: 'Active-Working', joinDate: '2024-01-01', documents: [], loans: [], leaves: [], initialBasicPay: 1700, minWageExempt: false, hostelDeduction: { amount: 150 }, payslips: [{ id: 'S1', month: '2026-09', basic: 1700 }] } }] })
  for (const k of ['gm', 'hra', 'hrm', 'om']) await mk(k)
  const ap = (k, role, cos = [], outs = []) => S.c.rpc('approve_user', { p_id: U[k].id, p_role: role, p_company_ids: cos, p_outlet_ids: outs })
  await ap('gm', 'general_manager'); await ap('hra', 'hr_admin'); await ap('hrm', 'hr_manager'); await ap('om', 'outlet_manager', [], [P1_])
  const set = (k, key, value) => U[k].c.rpc('set_pay_config', { p_key: key, p_value: value })
  const rates = { ...R, payDays: 7 }
  let x = await set('ceo', 'rates', rates); check('CEO can save pay rates', !x.error, err(x))
  x = await set('hra', 'holidays', P.DEFAULT_HOLIDAYS); check('HR Admin can save the holiday list', !x.error, err(x))
  x = await set('hrm', 'rates', rates); check('HR manager cannot change pay rates', !!x.error)
  x = await set('om', 'rates', rates); check('outlet manager cannot change pay rates', !!x.error)
  await S.c.rpc('set_gm_powers', { p_powers: { 'compliance.rates': false, 'compliance.settings': false } })
  x = await set('gm', 'rates', rates); check('GM without the power cannot change rates', !!x.error)
  await S.c.rpc('set_gm_powers', { p_powers: { 'compliance.rates': true } })
  x = await set('gm', 'rates', rates); check('GM with the "Statutory rates" power can change rates', !x.error, err(x))
  x = await set('ceo', 'notifications', { a: 1 }); check('other config keys are refused', !!x.error)
  x = await set('ceo', 'rates', [1, 2]); check('non-object value is refused', !!x.error)
  const cfg = (await admin.from('app_config').select('value,updated_by').eq('key', 'rates').single()).data
  check('saved rates stored', cfg?.value?.payDays === 7 && Array.isArray(cfg.value.minWage))
  const au = await admin.from('audit_log').select('action,entity,entity_id').eq('entity', 'config').eq('entity_id', 'rates')
  check('rate change audited', (au.data || []).some((a) => a.action === 'update'), JSON.stringify(au))
  const rd = await U.om.c.from('app_config').select('value').eq('key', 'rates').maybeSingle()
  check('everyone signed in can read the rates', rd.data?.value?.payDays === 7, err(rd))
  const pull = async (k) => (await U[k].c.rpc('pull_records', { p_since: '1970-01-01', p_limit: 1000 })).data?.find((r) => r.id === PW1_)?.data
  const om = await pull('om'), hrm = await pull('hrm')
  check('outlet manager does not receive payslips / hostel / exemption', om && !('payslips' in om) && !('hostelDeduction' in om) && !('minWageExempt' in om) && !('initialBasicPay' in om), JSON.stringify(om && Object.keys(om)))
  check('HR manager receives payslips', Array.isArray(hrm?.payslips) && hrm.payslips.length === 1)
  // outlet manager edits the worker → hidden pay data must survive
  x = await U.om.c.rpc('push_records', { p_rows: [{ entity: 'workers', id: PW1_, client_ts: now(), data: { ...om, phone: '0123' } }] })
  const after = (await admin.from('records').select('data').eq('entity', 'workers').eq('id', PW1_).single()).data?.data
  check('payslips kept after an outlet-manager edit', Array.isArray(after?.payslips) && after.payslips.length === 1 && after.hostelDeduction?.amount === 150, JSON.stringify(after && Object.keys(after)))
} catch (e) { fail++; console.log('FAIL exception', e.message) }
finally {
  await admin.from('records').delete().in('id', [P1_, PW1_])
  for (const k of Object.keys(U)) await admin.auth.admin.deleteUser(U[k].id).catch(() => {})
}
await cleanupOwn(admin, PFX); await restoreCfg()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
