// 1.6.3: the worker's COMPANY (display name, from his outlet) is shown wherever his outlet is: Workers list (expanded row + column),
// Company filter, worker profile header, worker edit form (read-only), Birthdays rows, Settings outlet list, FW Worker "Me" tab.
// SAFETY: TEST project only. Creates its own stamped outlets / workers / users and removes only those.
// Needs: staff TEST build at UI_URL, worker TEST build at WORKER_URL. Never prints PINs, passwords or tokens.
import fs from 'node:fs'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
const require = createRequire(new URL('../package.json', import.meta.url))
const { createClient } = require('@supabase/supabase-js')
const { chromium } = createRequire((process.env.PW_PKG || '/workspace/tools/pw') + '/package.json')('playwright')
const LIVE_REF = 'gnepquxtwkyffjmoydnv'
const env = Object.fromEntries(fs.readFileSync(new URL('../.secrets.env', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const URL_ = env.TEST_SUPABASE_URL, ANON = env.TEST_ANON_KEY
if (!URL_ || URL_.includes(LIVE_REF) || !URL_.includes(env.TEST_PROJECT_REF)) { console.error('ABORT: not the test project'); process.exit(1) }
const UI = process.env.UI_URL, APP = process.env.WORKER_URL
if (!UI || !APP) { console.error('Set UI_URL and WORKER_URL'); process.exit(1) }
const OUT = process.env.OUT || '/workspace/screens-163/'
fs.mkdirSync(OUT, { recursive: true })
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(URL_, env.TEST_SERVICE_ROLE_KEY, opts)
let pass = 0, fail = 0
const check = (n, ok, x = '') => { ok ? pass++ : fail++; console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : String(x).slice(0, 400)) }
const stamp = Date.now().toString(36), pw = crypto.randomBytes(12).toString('hex')
const O = 'u163-o-' + stamp, O2 = 'u163-o2-' + stamp, PP = 'C' + stamp.toUpperCase().slice(-7)
const W1 = 'u163-w1-' + stamp, W2 = 'u163-w2-' + stamp
const NAME1 = 'Muthu Company ' + stamp, NAME2 = 'Ravi Other ' + stamp
const ONAME = 'Nilla Test Outlet ' + stamp
const staffIds = []
async function staff(key, role, outlets = []) {
  const email = `fw163-${key}-${stamp}@example.com`, full = 'UI163 ' + key.toUpperCase()
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: full } })
  if (error) throw error
  staffIds.push(data.user.id)
  for (let i = 0; i < 10; i++) {
    const u = await admin.from('profiles').update({ role, status: 'active', outlet_ids: outlets, company_ids: [], full_name: full }).eq('id', data.user.id).select('role,status')
    if (!u.error && u.data?.[0]?.role === role && u.data[0].status === 'active') break
    await new Promise((r) => setTimeout(r, 500))
  }
  const c = createClient(URL_, ANON, opts); const s = await c.auth.signInWithPassword({ email, password: pw }); if (s.error) throw s.error
  return { c, token: s.data.session.access_token, email, id: data.user.id }
}
const myt = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date())
const TODAY = myt()
const now = new Date().toISOString()
let browser
try {
  const cos = ((await admin.from('app_config').select('value').eq('key', 'companies').single()).data.value.items || [])
  const C1 = cos.find((c) => c.id === 'c2') || cos[1], C2 = cos.find((c) => c.id === 'main') || cos[0]
  const wk = (id, no, name, outletId, extra = {}) => ({ entity: 'workers', id, client_ts: now, data: { id, workerNo: no, fullName: name, outletId, nationality: 'India', status: 'Active-Working', joinDate: '2023-11-03',
    dob: '1990' + TODAY.slice(4), primaryLanguage: 'ta', phoneMY: '012-345 6789', jobCategory: 'Assistant Cook', initialBasicPay: 1700, documents: [], increments: [], loans: [], deductions: [], leaves: [], memos: [], ...extra } })
  const ins = await admin.from('records').insert([
    { entity: 'outlets', id: O, client_ts: now, data: { id: O, name: ONAME, type: 'Restaurant', companyId: C1.id } },
    { entity: 'outlets', id: O2, client_ts: now, data: { id: O2, name: 'Other Test Outlet ' + stamp, type: 'Restaurant', companyId: C2.id } },
    wk(W1, 'U1' + stamp.slice(-4), NAME1, O, { documents: [{ id: 'p', type: 'Passport', number: PP, expiryDate: '2029-01-01' }] }),
    wk(W2, 'U2' + stamp.slice(-4), NAME2, O2),
  ])
  if (ins.error) throw ins.error
  const ceo = await staff('ceo', 'super_admin'), hrm = await staff('hrm', 'hr_manager', [O])
  browser = await chromium.launch()
  for (const [vp, tag] of [[{ width: 1366, height: 860 }, 'desktop'], [{ width: 390, height: 844 }, 'phone']]) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: vp.width < 500 ? 2 : 1, ...(vp.width < 500 ? { isMobile: true, hasTouch: true } : {}) })
    const p = await ctx.newPage(); const errs = []
    p.on('pageerror', (e) => errs.push(e.message))
    await p.goto(UI); await p.fill('#em', ceo.email); await p.fill('#pw', pw)
    await p.locator('form button[type=submit]').first().click(); await p.waitForTimeout(7000)
    // Workers list
    await p.goto(UI + '#/workers?q=' + encodeURIComponent(stamp)); await p.waitForTimeout(3000)
    const row = p.getByTestId('worker-row').filter({ hasText: NAME1 }).first()
    check(`[${tag}] worker row found`, await row.count() === 1)
    if (tag === 'desktop') { const cell = await row.innerText(); check(`[${tag}] Company / outlet column shows the company`, cell.includes(C1.name) && cell.includes(ONAME), cell) }
    await row.locator('.dt-xbtn').click(); await p.waitForTimeout(500)
    const det = row.locator('xpath=following-sibling::tr[1]')
    const dt = (await det.innerText()).replace(/\s+/g, ' ')
    check(`[${tag}] expanded row: COMPANY shown above OUTLET`, /company/i.test(dt) && dt.includes(C1.name) && dt.search(/company/i) < dt.search(/outlet/i) && dt.indexOf(C1.name) < dt.indexOf(ONAME), dt)
    await det.scrollIntoViewIfNeeded(); await p.evaluate(() => window.scrollBy(0, -160)); await p.screenshot({ path: `${OUT}workers-expanded-${tag}.png` })
    if (tag === 'phone') { const sub = await row.innerText(); check('[phone] worker card sub-line names the company', sub.includes(C1.name), sub) }
    // Company filter
    const coSel = p.locator('select[aria-label="Company"], label:has-text("Company") select').first()
    check(`[${tag}] Company filter present`, await coSel.count() === 1)
    if (await coSel.count()) {
      await coSel.selectOption(C1.id); await p.waitForTimeout(800)
      const names = await p.getByTestId('worker-row').allInnerTexts()
      check(`[${tag}] Company filter keeps only that company's workers`, names.some((t) => t.includes(NAME1)) && !names.some((t) => t.includes(NAME2)), names.join('|'))
      await coSel.selectOption(C2.id); await p.waitForTimeout(800)
      const n2 = await p.getByTestId('worker-row').allInnerTexts()
      check(`[${tag}] other company shows the other worker`, n2.some((t) => t.includes(NAME2)) && !n2.some((t) => t.includes(NAME1)), n2.join('|'))
      if (tag === 'desktop') await p.screenshot({ path: `${OUT}workers-company-filter-${tag}.png` })
    }
    // Profile header
    await p.goto(UI + '#/workers/' + W1); await p.waitForTimeout(3000)
    const hd = await p.getByTestId('wd-company').innerText().catch(() => '')
    check(`[${tag}] profile header shows company · outlet`, hd.startsWith(C1.name) && hd.includes(ONAME), hd)
    await p.screenshot({ path: `${OUT}worker-profile-${tag}.png` })
    // Edit form (read-only company)
    await p.goto(UI + '#/workers/' + W1 + '/edit'); await p.waitForTimeout(3000)
    let fx = p.locator('input[name=_company]')
    for (let i = 0; i < 3 && !(await fx.isVisible().catch(() => false)); i++) { await p.locator('.wf-stepper li:nth-child(2) button').click(); await p.waitForTimeout(700) }
    check(`[${tag}] edit form: Company read-only, from the outlet`, await fx.count() === 1 && (await fx.inputValue()) === C1.name && await fx.evaluate((e) => e.readOnly), await fx.count() && await fx.inputValue())
    if (await fx.count()) {
      await fx.scrollIntoViewIfNeeded(); await p.screenshot({ path: `${OUT}worker-edit-company-${tag}.png` })
      await p.locator('select[name=outletId]').selectOption(O2); await p.waitForTimeout(400)
      check(`[${tag}] edit form: changing the outlet changes the company`, (await fx.inputValue()) === C2.name, await fx.inputValue())
    }
    // Birthdays
    await p.goto(UI + '#/birthdays'); await p.waitForTimeout(3500)
    const bd = p.getByTestId('bd-row').filter({ hasText: NAME1 }).first()
    const bdt = await bd.innerText().catch(() => '')
    check(`[${tag}] Birthdays row shows company · outlet`, bdt.includes(C1.name) && bdt.includes(ONAME) && bdt.indexOf(C1.name) < bdt.indexOf(ONAME), bdt)
    if (await bd.count()) { await bd.scrollIntoViewIfNeeded(); await p.screenshot({ path: `${OUT}birthdays-${tag}.png` }) }
    // Settings outlets
    await p.goto(UI + '#/settings/org'); await p.waitForTimeout(3000)
    const fold = p.locator('#s-outlets .card-fold.is-closed .fold-btn'); if (await fold.count()) await fold.first().click()
    const orow = p.getByTestId('outlet-' + O)
    const ot = await orow.innerText().catch(() => '')
    check(`[${tag}] outlet list shows the company under the outlet name`, ot.includes(C1.name), ot)
    if (await orow.count()) { await orow.scrollIntoViewIfNeeded(); await p.screenshot({ path: `${OUT}outlets-${tag}.png` }) }
    check(`[${tag}] no page errors`, errs.length === 0, errs.join(' | '))
    await ctx.close()
  }
  // FW Worker: Me tab
  const gen = await (await fetch(`${URL_}/functions/v1/worker-access`, { method: 'POST', headers: { apikey: ANON, Authorization: 'Bearer ' + hrm.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'generate', workerId: W1 }) })).json()
  check('HR generated a PIN for the worker', /^\d{6}$/.test(gen.pin || ''))
  const wc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  const wp = await wc.newPage(); const werrs = []; wp.on('pageerror', (e) => werrs.push(e.message))
  await wp.goto(APP); await wp.waitForSelector('[data-testid=login-submit]')
  await wp.fill('#pp', PP); await wp.fill('#pin', gen.pin || ''); await wp.click('[data-testid=login-submit]')
  await wp.waitForSelector('[data-testid=nav-me]', { timeout: 20000 }).catch(() => {})
  await wp.click('[data-testid=nav-me]').catch(() => {}); await wp.waitForTimeout(1500)
  const mc = await wp.getByTestId('me-company').innerText().catch(() => '')
  check('FW Worker Me tab shows the company', mc === C1.name, mc)
  await wp.screenshot({ path: `${OUT}worker-app-me-phone.png` })
  check('FW Worker no page errors', werrs.length === 0, werrs.join(' | '))
} catch (e) { check('suite ran', false, e.stack || e.message) } finally {
  if (browser) await browser.close().catch(() => {})
  const ids = [W1, W2]
  const acc = (await admin.from('worker_access').select('user_id').in('worker_id', ids)).data || []
  await admin.from('worker_access').delete().in('worker_id', ids)
  for (const a of acc) await admin.auth.admin.deleteUser(a.user_id)
  await admin.from('worker_wishes').delete().in('worker_id', ids)
  const evs = ((await admin.from('notification_deliveries').select('event_id').in('user_id', staffIds)).data || []).map((d) => d.event_id).filter(Boolean)
  await admin.from('notification_deliveries').delete().in('user_id', staffIds)
  if (evs.length) await admin.from('notification_events').delete().in('id', [...new Set(evs)])
  for (const id of staffIds) await admin.auth.admin.deleteUser(id)
  await admin.from('records').delete().in('id', [O, O2, ...ids])
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
