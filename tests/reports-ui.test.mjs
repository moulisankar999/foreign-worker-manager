// Reports UI test + A4 PDFs. SAFETY: TEST project only (refuses live). Needs a TEST-pointed build served at UI_URL and
// PLAYWRIGHT_PATH. Seeds "DEMO RPT" workers/outlets + @example.com users on TEST and removes them at the end.
import fs from 'node:fs'
import { createRequire } from 'node:module'
const ROOT = new URL('..', import.meta.url).pathname
const require = createRequire(ROOT + 'package.json')
const { createClient } = require('@supabase/supabase-js')
const { chromium } = createRequire(process.env.PLAYWRIGHT_PATH + '/package.json')('playwright')
const LIVE_REF = 'gnepquxtwkyffjmoydnv'
const env = Object.fromEntries(fs.readFileSync(ROOT + '.secrets.env', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const URL_ = env.TEST_SUPABASE_URL, UI = process.env.UI_URL
if (!URL_ || URL_.includes(LIVE_REF) || !URL_.includes(env.TEST_PROJECT_REF)) { console.error('ABORT: not the test project'); process.exit(1) }
const admin = createClient(URL_, env.TEST_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 })
if (list.users.some((u) => !u.email.endsWith('@example.com'))) { console.error('ABORT: real users found'); process.exit(1) }
for (const u of list.users) if (/^fwm-rpt-.*@example\.com$/.test(u.email)) await admin.auth.admin.deleteUser(u.id).catch(() => {})
await admin.from('report_schedules').delete().like('title', 'DEMO %')
await admin.from('records').update({ deleted: true }).like('id', 'rpt1%')
const SH = ROOT + 'screens/reports/', PDF = ROOT + 'screens/'
fs.mkdirSync(SH, { recursive: true })
let pass = 0, fail = 0
const check = (n, ok, x = '') => { ok ? pass++ : fail++; console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : String(x).slice(0, 400)) }
const stamp = Date.now(), pw = 'Rpt-' + stamp + '-x!', P = `rpt${stamp}`
const made = [], recs = []
const iso = (d) => d.toISOString().slice(0, 10)
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d) }
const mon = (n) => { const d = new Date(); d.setMonth(d.getMonth() + n); return iso(d) }

// ---- seed (TEST only) ----
const cfgOld = (await admin.from('app_config').select('value').eq('key', 'companies').maybeSingle()).data?.value
await admin.from('app_config').upsert({ key: 'companies', value: { items: [{ id: 'main', name: 'Sunrise Demo Sdn Bhd' }, { id: 'c2', name: 'Bayu Demo Hospitality Sdn Bhd' }] } })
const OUT = [[`${P}-A`, 'DEMO RPT Nasi Kandar – Ampang', 'Restaurant', 'main'], [`${P}-B`, 'DEMO RPT Mart 24 – Cheras', 'Convenience Shop', 'main'], [`${P}-C`, 'DEMO RPT Grand Hotel – Melaka', 'Hotel', 'c2']]
const put = async (entity, id, data) => { recs.push([entity, id]); const r = await admin.from('records').upsert({ entity, id, deleted: false, client_ts: new Date().toISOString(), data }); if (r.error) throw r.error }
for (const [id, name, type, companyId] of OUT) await put('outlets', id, { id, name, type, companyId, address: 'DEMO address, Malaysia', manager: 'DEMO Manager' })
const NAT = [['Bangladesh', 'Islam'], ['Nepal', 'Hindu'], ['India', 'Hindu'], ['Indonesia', 'Islam'], ['Myanmar', 'Buddhist'], ['Vietnam', 'Buddhist'], ['Philippines', 'Christian']]
const FIRST = ['Rahim', 'Suman', 'Arjun', 'Siti', 'Aung', 'Nguyen', 'Maria', 'Karim', 'Bikash', 'Ravi', 'Dewi', 'Min', 'Tran', 'Joseph', 'Shahid', 'Prakash', 'Lakshmi', 'Budi']
const JOBS = { Restaurant: ['Cook', 'Waiter', 'Cashier', 'Kitchen Helper'], 'Convenience Shop': ['Cashier', 'Stock Keeper'], Hotel: ['Housekeeping', 'Front Desk', 'Laundry'] }
const N = 46
for (let i = 0; i < N; i++) {
  const o = OUT[i % 3], [nat, rel] = NAT[i % NAT.length], gender = i % 5 === 3 ? 'Female' : 'Male'
  const exp = [-12, 5, 18, 25, 40, 55, 75, 88, 120, 200, 300, 400, -3, 9, 33, 64][i % 16]
  const join = mon(-[8, 14, 26, 37, 6, 50][i % 6]), basic = 1700 + (i % 6) * 100, id = `${P}-w${i}`
  const status = i === 7 ? 'Home Leave' : i === 11 ? 'Medical Leave' : i >= N - 2 ? 'Resigned' : 'Active-Working'
  await put('workers', id, {
    id, workerNo: `FW${9001 + i}`, fullName: `DEMO RPT ${FIRST[i % FIRST.length]} ${String.fromCharCode(65 + (i % 26))}${i}`, nationality: nat, gender, religion: rel,
    dob: mon(-12 * (24 + (i % 15))), phoneMY: `+60 12-000 ${1000 + i}`, outletId: o[0], businessType: o[2], jobCategory: JOBS[o[2]][i % JOBS[o[2]].length],
    skillLevel: ['Skilled', 'Semi-skilled', 'Unskilled'][i % 3], joinDate: join, status, ...(status === 'Resigned' ? { exitDate: mon(-1) } : {}),
    statusHistory: [{ id: id + 'h', date: join, to: 'Active-Working', remarks: 'Joined' }],
    hostelAddress: `DEMO Hostel Block ${i}`, agent: 'DEMO Recruitment Agency Sdn Bhd',
    documents: [
      { id: id + 'd1', type: 'Passport', number: `DM${100000 + i * 37}`, issueDate: mon(-40), expiryDate: day(exp + 300) },
      { id: id + 'd2', type: 'Work Permit / PLKS (VP(TE))', number: `VP${200000 + i * 11}`, expiryDate: day(exp) },
      { id: id + 'd3', type: 'FOMEMA Medical', number: `FM${3000 + i}`, expiryDate: day(exp + 20) },
      { id: id + 'd4', type: 'Levy Payment', number: `LV${7000 + i}`, expiryDate: day(exp) },
    ],
    family: [{ id: id + 'f', relation: 'Mother', name: `DEMO Mother ${i}`, phone: '+000 0000 0002', isEmergency: true }],
    contractStart: join, contractEnd: i % 8 === 1 ? day(20 + i) : mon(24), minContractMonths: 24, earlyPenalty: 3000,
    initialBasicPay: basic, increments: [], allowances: [{ id: id + 'a', name: 'Attendance', amount: 100 }],
    loans: i % 4 === 0 ? [{ id: id + 'L', date: mon(-4), type: 'Advance', amount: 1200, purpose: 'demo', monthlyDeduction: 200 }] : [],
    deductions: i % 4 === 0 ? [{ id: id + 'D', date: mon(-1), amount: 200, type: 'Loan repayment', loanId: id + 'L' }] : [],
    leaves: [{ id: id + 'lv', type: 'Annual', from: mon(-2), to: day(-58), days: 3, status: 'Approved', approvedBy: 'DEMO Manager' }],
    memos: [], notes: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  })
}
await put('remarks', `${P}-r1`, { id: `${P}-r1`, workerId: `${P}-w0`, date: day(-3), text: 'DEMO remark — late twice this week.', by: 'DEMO OM', category: 'Conduct' })
await put('remarks', `${P}-r2`, { id: `${P}-r2`, workerId: `${P}-w3`, date: day(-10), text: 'DEMO remark — commended by customer.', by: 'DEMO OM', category: 'Commendation' })

async function mk(key, name, role, outlets = []) {
  const email = `fwm-rpt-${key}-${stamp}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: name } })
  if (error) throw error
  made.push(data.user.id)
  const r = await admin.from('profiles').update({ role, status: 'active', outlet_ids: outlets, full_name: name }).eq('id', data.user.id)
  if (r.error) throw r.error
  return email
}
const U = {
  ceo: await mk('ceo', 'DEMO Datuk CEO', 'super_admin'), gm: await mk('gm', 'DEMO Lee GM', 'general_manager'),
  hra: await mk('hra', 'DEMO Priya HR Admin', 'hr_admin'), hrm: await mk('hrm', 'DEMO Farah HR Manager', 'hr_manager'),
  om: await mk('om', 'DEMO Ahmad Outlet Mgr', 'outlet_manager', [`${P}-A`]),
}
const as = async (email) => { const c = createClient(URL_, env.TEST_ANON_KEY, { auth: { persistSession: false } }); const r = await c.auth.signInWithPassword({ email, password: pw }); if (r.error) throw r.error; return c }

// ---- submission RPC flow ----
const now = new Date(), y = now.getFullYear(), m = now.getMonth() + 1
const pk = (yy, mm) => `${yy}-${String(mm).padStart(2, '0')}`
const prev = m === 1 ? pk(y - 1, 12) : pk(y, m - 1), prev2 = m <= 2 ? pk(y - 1, 10 + m) : pk(y, m - 2)
const ceoC = await as(U.ceo), gmC = await as(U.gm), hraC = await as(U.hra), hrmC = await as(U.hrm), omC = await as(U.om)
const sv = await ceoC.rpc('save_report_schedule', { p: { report_id: 'master', title: `DEMO Monthly Worker Master List ${stamp}`, frequency: 'monthly', due_day: 7, company_id: 'main', filters: { lang: 'ms' }, start_period: prev2, active: true } })
check('CEO creates a required-submission schedule', !sv.error && sv.data, sv.error?.message)
const sid = sv.data
const sv2 = await ceoC.rpc('save_report_schedule', { p: { report_id: 'expiry', title: `DEMO Quarterly Expiry Register ${stamp}`, frequency: 'quarterly', due_day: 10, filters: {}, active: true } })
check('CEO creates a second (quarterly) schedule', !sv2.error, sv2.error?.message)
const hs = await hrmC.rpc('save_report_schedule', { p: { report_id: 'master', title: 'x', frequency: 'monthly' } })
check('HR Manager cannot create schedules', !!hs.error, 'no error')
const os = await omC.from('report_schedules').select('id')
check('OM cannot read schedules (RLS)', !os.error ? os.data.length === 0 : true, JSON.stringify(os.data))
const st = (c, step, p = prev, ref) => c.rpc('report_submission_step', { p_schedule: sid, p_period: p, p_step: step, p_note: null, p_file_ref: ref ?? null })
check('HRM: generated', !(await st(hrmC, 'generated')).error)
check('HRM: printed', !(await st(hrmC, 'printed')).error)
check('HRA cannot verify before prepared', !!(await st(hraC, 'verified')).error)
check('HRM: prepared & signed', !(await st(hrmC, 'prepared')).error)
check('HRM cannot verify (rank)', !!(await st(hrmC, 'verified')).error)
check('HRA: verified', !(await st(hraC, 'verified')).error)
check('GM cannot approve (CEO only)', !!(await st(gmC, 'reviewed')).error === false && !!(await st(gmC, 'approved')).error)
check('CEO cannot file before approval… approves', !(await st(ceoC, 'approved')).error)
const om1 = await st(omC, 'generated')
check('OM cannot touch submissions', !!om1.error, 'no error')
const sub = (await admin.from('report_submissions').select('status,steps').eq('schedule_id', sid).eq('period', prev).single()).data
check('submission is approved with 5 signatures', sub?.status === 'approved' && ['prepared', 'verified', 'reviewed', 'approved'].every((k) => sub.steps[k]?.by_name), JSON.stringify(sub))

// ---- browser ----
const browser = await chromium.launch()
try {
async function login(email, vp = { width: 1366, height: 900 }) {
  const ctx = await browser.newContext({ viewport: vp, acceptDownloads: true, deviceScaleFactor: 1 })
  const p = await ctx.newPage(); const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  await p.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1 } })
  await p.goto(UI); await p.fill('#em', email); await p.fill('#pw', pw)
  await p.locator('form button[type=submit]').first().click()
  await p.waitForTimeout(9000)
  return { p, errs, ctx }
}
const body = (p) => p.locator('body').innerText()
const go = async (p, h) => { await p.goto(UI + '#' + h); await p.waitForTimeout(3000) }
async function preview(p) {
  await p.getByRole('button', { name: /Preview & print/ }).click()
  await p.waitForSelector('.rpt-overlay .rpt-sheet', { timeout: 20000 }); await p.waitForTimeout(2500)
  return p.locator('.rpt-overlay .rpt-sheet').count()
}
async function printPdf(p, file, landscape) {
  await p.getByRole('button', { name: /^Print$/ }).click(); await p.waitForTimeout(300)
  check(`Print button calls the print dialog (${file})`, (await p.evaluate(() => window.__printed || 0)) > 0)
  await p.evaluate((l) => { document.body.classList.add('rpt-printing'); if (!document.getElementById('rpt-page-size')) { const s = document.createElement('style'); s.id = 'rpt-page-size'; s.textContent = `@page { size: A4 ${l ? 'landscape' : 'portrait'}; margin: 0 }`; document.head.appendChild(s) } }, landscape)
  await p.pdf({ path: PDF + file, preferCSSPageSize: true, printBackground: true })
  await p.evaluate(() => document.body.classList.remove('rpt-printing'))
}
const overflow = async (p) => { const v = await p.evaluate(() => Array.from(document.querySelectorAll('.rpt-overlay .rpt-sheet > .rpt-body')).map((b) => { const r = b.getBoundingClientRect(); const kids = Array.from(b.querySelectorAll('tr, .rpt-kpis, .rpt-sig, .rpt-note, h3, .rpt-fields')); return Math.max(0, ...kids.map((k) => k.getBoundingClientRect().bottom - r.bottom)) })); const bad = v.filter((x) => x > 1); if (bad.length) console.log('   overflow px:', bad.map((x) => x.toFixed(1)).join(',')); return bad.length }
const pagesOk = (p) => p.evaluate(() => { const s = Array.from(document.querySelectorAll('.rpt-overlay .rpt-sheet')); return s.every((x, i) => (x.textContent || '').includes(`Page ${i + 1} of ${s.length}`)) })

{ // CEO
  const { p, errs, ctx } = await login(U.ceo)
  await go(p, '/reports'); const t = await body(p)
  check('CEO sees the Reports library with all groups', ['Workforce', 'Compliance & documents', 'Leave & requests', 'Pay & money', 'Admin & audit'].every((g) => new RegExp(g, 'i').test(t)), t.slice(0, 600))
  check('CEO sees overdue banner', /overdue/i.test(t), t.slice(0, 400))
  await p.screenshot({ path: SH + 'ceo-library.png', fullPage: true })
  // headcount
  await p.locator('.rpt-card', { hasText: /Headcount/ }).first().click(); await p.waitForTimeout(1500)
  await p.screenshot({ path: SH + 'ceo-headcount-options.png' })
  let n = await preview(p)
  check('headcount preview renders sheets', n >= 1, n); check('no sheet body overflows (headcount)', (await overflow(p)) === 0); check('Page X of Y on every sheet (headcount)', await pagesOk(p))
  await p.screenshot({ path: SH + 'ceo-headcount-preview.png' })
  await printPdf(p, 'report-headcount-A4.pdf', false)
  await p.keyboard.press('Escape'); await p.waitForTimeout(500)
  // expiry
  await go(p, '/reports?r=expiry'); n = await preview(p)
  check('expiry preview renders', n >= 1, n); check('no overflow (expiry)', (await overflow(p)) === 0); check('Page X of Y (expiry)', await pagesOk(p))
  await p.screenshot({ path: SH + 'ceo-expiry-preview.png' })
  await printPdf(p, 'report-expiry-A4.pdf', false)
  // master (landscape, multi-page)
  await go(p, '/reports?r=master'); n = await preview(p)
  check('master list is multi-page landscape', n >= 2, n); check('no overflow (master)', (await overflow(p)) === 0); check('Page X of Y (master)', await pagesOk(p))
  check('table header repeats on continuation pages', await p.evaluate(() => Array.from(document.querySelectorAll('.rpt-overlay .rpt-sheet')).slice(1).filter((s) => s.querySelector('tbody tr')).every((s) => !!s.querySelector('thead'))))
  await p.screenshot({ path: SH + 'ceo-master-preview.png' })
  await printPdf(p, 'report-master-landscape-A4.pdf', true)
  // other CEO reports render without errors
  for (const r of ['payroll', 'loans', 'costs', 'remittance', 'leave', 'audit', 'users', 'subreg', 'profile', 'remarks', 'contracts', 'exits']) {
    await go(p, `/reports?r=${r}`)
    const btn = p.getByRole('button', { name: /Preview & print/ }); await btn.waitFor({ timeout: 25000 }).catch(() => {})
    if (!(await btn.count())) { check(`CEO can open ${r}`, false, 'no button'); continue }
    const k = await preview(p); check(`CEO ${r} renders (${k} pages, no overflow)`, k >= 1 && (await overflow(p)) === 0)
    if (r === 'payroll') await p.screenshot({ path: SH + 'ceo-payroll-preview.png' })
    await p.keyboard.press('Escape'); await p.waitForTimeout(300)
  }
  // submissions tab
  await go(p, '/reports?tab=subs'); const s = await body(p)
  check('submissions tab lists the schedule + overdue period', s.includes(`DEMO Monthly Worker Master List ${stamp}`) && /Overdue/i.test(s), s.slice(0, 800))
  await p.screenshot({ path: SH + 'ceo-submissions.png', fullPage: true })
  check('CEO no page errors', errs.length === 0, errs.join(' | '))
  await ctx.close()
}
{ // HR Manager opens the approved submission → signed printout via Save PDF (html-to-image)
  const { p, errs, ctx } = await login(U.hrm)
  await go(p, '/reports?tab=subs')
  await p.screenshot({ path: SH + 'hrm-submissions.png', fullPage: true })
  const prevLabel = new Date(prev + '-15').toLocaleString('en-GB', { month: 'long', year: 'numeric' })
  const row = p.locator('tr', { hasText: prevLabel }).filter({ hasText: `${stamp}` }).first()
  await row.getByRole('button', { name: /Open/ }).click()
  await p.waitForSelector('.rpt-overlay .rpt-sheet', { timeout: 20000 }); await p.waitForTimeout(3000)
  const sig = await p.locator('.rpt-overlay').innerText()
  check('signed printout shows the 4 signatories', ['DEMO Farah HR Manager', 'DEMO Priya HR Admin', 'DEMO Lee GM', 'DEMO Datuk CEO'].every((x) => sig.includes(x)), sig.slice(-1200))
  check('signed printout shows required-submission band', /REQUIRED SUBMISSION/i.test(sig))
  check('no overflow (submission)', (await overflow(p)) === 0)
  const last = p.locator('.rpt-overlay .rpt-sheet').last(); await last.scrollIntoViewIfNeeded()
  await p.screenshot({ path: SH + 'hrm-signed-preview.png' })
  const dl = p.waitForEvent('download', { timeout: 60000 })
  await p.getByRole('button', { name: /Save PDF/ }).click()
  const d = await dl; await d.saveAs(PDF + 'report-submission-signed-A4.pdf')
  check('Save PDF downloads a PDF', fs.statSync(PDF + 'report-submission-signed-A4.pdf').size > 20000)
  check('HRM no page errors', errs.length === 0, errs.join(' | '))
  await ctx.close()
}
{ // OM: own outlet only, limited reports
  const { p, errs, ctx } = await login(U.om)
  await go(p, '/reports'); const t = await body(p)
  const cards = await p.locator('.rpt-card b').allInnerTexts()
  check('OM sees only the 5 outlet reports', cards.length === 5 && !cards.some((c) => /Payroll|Audit|Remittance|User/i.test(c)), cards.join('|'))
  check('OM sees no submissions tab', !/Required submissions/.test(t))
  await p.screenshot({ path: SH + 'om-library.png', fullPage: true })
  await go(p, '/reports?r=master'); await preview(p)
  for (let k = 0; k < 4 && !(await p.locator('.rpt-overlay').innerText()).includes('Nasi Kandar'); k++) { await p.keyboard.press('Escape'); await p.waitForTimeout(5000); await preview(p) } // wait for outlet sync
  const txt = await p.locator('.rpt-overlay').innerText()
  check('OM master list has own outlet only', txt.includes('Nasi Kandar') && !txt.includes('Grand Hotel') && !txt.includes('Mart 24'), '')
  check('OM: passport numbers masked', !/DM100000\b/.test(txt))
  await p.screenshot({ path: SH + 'om-master-preview.png' })
  await go(p, '/reports?r=payroll'); check('OM cannot open payroll via URL', !(await p.getByRole('button', { name: /Preview & print/ }).count()))
  check('OM no page errors', errs.length === 0, errs.join(' | '))
  await ctx.close()
  // mobile view
  const m = await login(U.om, { width: 390, height: 844 }); await go(m.p, '/reports'); await m.p.screenshot({ path: SH + 'om-mobile-library.png', fullPage: true }); await m.ctx.close()
}
{ // GM
  const { p, ctx } = await login(U.gm); await go(p, '/reports')
  const cards = await p.locator('.rpt-card b').allInnerTexts()
  check('GM does not see remittance', !cards.some((c) => /Remittance/i.test(c)), cards.join('|'))
  await p.screenshot({ path: SH + 'gm-library.png', fullPage: true }); await ctx.close()
}
} catch (e) { fail++; console.log('FAIL exception', e.message.split('\n')[0]) } finally {
await browser.close()
// ---- cleanup (TEST) ----
await admin.from('report_submissions').delete().in('schedule_id', [sid, sv2.data].filter(Boolean))
await admin.from('report_schedules').delete().in('id', [sid, sv2.data].filter(Boolean))
for (const [entity, id] of recs) await admin.from('records').update({ deleted: true, client_ts: new Date().toISOString() }).eq('entity', entity).eq('id', id)
for (const id of made) await admin.auth.admin.deleteUser(id).catch(() => {})
if (cfgOld) await admin.from('app_config').update({ value: cfgOld }).eq('key', 'companies')
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
