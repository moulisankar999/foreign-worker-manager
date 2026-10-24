// FW Worker UI test: login, every tab, wizard, request detail, PIN sheet, 10 languages — and NO SCROLLING on any screen.
// SAFETY: TEST project only (refuses live and any project with non-@example.com users). Creates its own stamped rows and removes them.
// Needs: a worker build pointed at TEST served at WORKER_URL (see tests/README), PLAYWRIGHT_PATH. Never prints PINs or tokens.
import fs from 'node:fs'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
const require = createRequire(new URL('../package.json', import.meta.url))
const { createClient } = require('@supabase/supabase-js')
const { chromium } = createRequire(process.env.PLAYWRIGHT_PATH + '/package.json')('playwright')
const LIVE_REF = 'gnepquxtwkyffjmoydnv'
const env = Object.fromEntries(fs.readFileSync(new URL('../.secrets.env', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const URL_ = env.TEST_SUPABASE_URL, ANON = env.TEST_ANON_KEY
if (!URL_ || URL_.includes(LIVE_REF) || !URL_.includes(env.TEST_PROJECT_REF)) { console.error('ABORT: not the test project'); process.exit(1) }
const APP = process.env.WORKER_URL || 'http://localhost:4181/worker/'
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(URL_, env.TEST_SERVICE_ROLE_KEY, opts)
{ const { data } = await admin.auth.admin.listUsers({ perPage: 1000 }); if (data.users.some((u) => !/@example\.com$/.test(u.email || ''))) { console.error('ABORT: real users'); process.exit(1) } }
const SHOTS = new URL('../screens/worker/', import.meta.url).pathname
fs.mkdirSync(SHOTS, { recursive: true })

let pass = 0, fail = 0
const results = []
const check = (n, ok, x = '') => { ok ? pass++ : fail++; results.push({ name: n, ok }); console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : x) }
const stamp = Date.now().toString(36), t0 = new Date().toISOString(), pw = crypto.randomBytes(12).toString('hex')
const O = 'wu-o-' + stamp, W = 'wu-w-' + stamp, PP = 'U' + stamp.toUpperCase().slice(-7)
const staffIds = []
const plus = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10)
async function staff(key, role, outlets = []) {
  const email = `fwu-${key}-${stamp}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: 'UI ' + key.toUpperCase() } })
  if (error) throw error
  staffIds.push(data.user.id)
  await admin.from('profiles').update({ role, status: 'active', outlet_ids: outlets, company_ids: [], full_name: 'UI ' + key.toUpperCase() }).eq('id', data.user.id)
  const c = createClient(URL_, ANON, opts); const s = await c.auth.signInWithPassword({ email, password: pw }); if (s.error) throw s.error
  return { c, token: s.data.session.access_token }
}

const VIEWPORTS = [
  { name: '360x640', width: 360, height: 640, lang: 'ta', mobile: true },
  { name: '375x667-iphoneSE', width: 375, height: 667, lang: 'ta', mobile: true },
  { name: '393x852-iphone15-16', width: 393, height: 852, lang: 'ta', mobile: true },
  { name: '430x932-iphone15-16-plus-pro-max', width: 430, height: 932, lang: 'en', mobile: true },
  { name: '820x1180-ipad', width: 820, height: 1180, lang: 'en', mobile: true },
  { name: '1440x900-desktop', width: 1440, height: 900, lang: 'en', mobile: false },
]
const TABS = ['home', 'docs', 'new', 'req', 'me']

// page must not scroll; no element may scroll inside; nothing may stick out of the screen; layout boxes must not clip content
const NO_SCROLL = () => {
  const bad = []
  const se = document.scrollingElement
  if (se.scrollHeight > innerHeight + 1) bad.push(`page scrollHeight ${se.scrollHeight} > ${innerHeight}`)
  if (se.scrollWidth > innerWidth + 1) bad.push(`page scrollWidth ${se.scrollWidth} > ${innerWidth}`)
  const name = (el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '') + (el.dataset.testid ? `[${el.dataset.testid}]` : '')
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) bad.push('inner scroll Y: ' + name(el))
    if (/(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) bad.push('inner scroll X: ' + name(el))
    const r = el.getBoundingClientRect()
    if (r.width && r.height && (r.bottom > innerHeight + 1 || r.right > innerWidth + 1 || r.top < -1 || r.left < -1)) {
      // allowed only when an ancestor clips it on purpose (text ellipsis / clamp)
      let p = el.parentElement, clipped = false
      while (p && p !== document.body) { const pr = p.getBoundingClientRect(); if (getComputedStyle(p).overflow !== 'visible' && pr.bottom <= innerHeight + 1 && pr.right <= innerWidth + 1) { clipped = true; break } p = p.parentElement }
      if (!clipped) bad.push('off screen: ' + name(el))
    }
  }
  for (const el of document.querySelectorAll('.main, .tiles, .docs, .list, .wiz .body, .panel, .pick, .card.grow')) {
    if (el.scrollHeight > el.clientHeight + 2) bad.push(`content cut off in ${name(el)} (${el.scrollHeight} > ${el.clientHeight})`)
  }
  return [...new Set(bad)].slice(0, 8)
}

let browser
try {
  // ---------- data (TEST only)
  const now = new Date().toISOString()
  const ins = await admin.from('records').insert([
    { entity: 'outlets', id: O, client_ts: now, data: { id: O, name: 'Ui Test Outlet', companyId: 'main' } },
    { entity: 'workers', id: W, client_ts: now, data: { id: W, workerNo: 'U' + stamp.slice(-4), fullName: 'Murugan Selvam', outletId: O, nationality: 'India', status: 'Active-Working', joinDate: '2023-06-01',
      primaryLanguage: 'ta', jobCategory: 'Kitchen helper', initialBasicPay: 1700, increments: [{ id: 'i1', date: '2025-01-01', oldPay: 1700, newPay: 1850 }],
      loans: [{ id: 'l1', date: '2025-02-01', type: 'Loan', amount: 1200 }], deductions: [{ id: 'd1', date: '2025-03-01', amount: 300, type: 'Loan', loanId: 'l1' }],
      documents: [{ id: 'p', type: 'Passport', number: PP, expiryDate: plus(700) }, { id: 'k', type: 'Work Permit / PLKS (VP(TE))', number: 'K1', expiryDate: plus(60) },
        { id: 'v', type: 'Visa / VDR', expiryDate: plus(20) }, { id: 'f', type: 'FOMEMA Medical', expiryDate: plus(-4) }], leaves: [], memos: [] } }])
  if (ins.error) throw ins.error
  const hr = await staff('hr', 'hr_manager'); const om = await staff('om', 'outlet_manager', [O])
  const gen = await (await fetch(`${URL_}/functions/v1/worker-access`, { method: 'POST', headers: { apikey: ANON, Authorization: 'Bearer ' + hr.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'generate', workerId: W }) })).json()
  const PIN = gen.pin
  check('HR generated a PIN for the UI worker', /^\d{6}$/.test(PIN || ''))
  // manager-raised requests (visible to the worker, marked "raised by manager") so the list has to page
  for (let i = 0; i < 7; i++) {
    const r = await om.c.rpc('request_create', { p_type: i % 2 ? 'salary_advance' : 'annual_leave', p_worker_id: W, p_title: 'UI ' + i, p_data: i % 2 ? { amount: 100 + i, reason: 'ui' } : { from: plus(30 + i), to: plus(31 + i), reason: 'ui' }, p_amount: i % 2 ? 100 + i : null, p_priority: 'normal' })
    if (r.error) { check('manager can raise requests for the worker', false, r.error.message); break }
  }

  browser = await chromium.launch()
  // ---------- login (Tamil first) at the smallest phone
  const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  const p = await ctx.newPage()
  await p.goto(APP); await p.waitForSelector('[data-testid=login-submit]')
  check('Login screen is Tamil first', (await p.locator('h1').innerText()) === 'FW Worker' && (await p.getByText('பாஸ்போர்ட் எண்').count()) > 0)
  let ns = await p.evaluate(NO_SCROLL); check('No scroll: login 360x640', ns.length === 0, JSON.stringify(ns))
  await p.screenshot({ path: SHOTS + 'login-ta-360x640.png' })
  // negative control: the detector must catch a page that scrolls
  await p.evaluate(() => { const d = document.createElement('div'); d.id = 'probe'; d.style.height = '2000px'; document.body.appendChild(d) })
  check('No-scroll detector catches an overflowing page (control)', (await p.evaluate(NO_SCROLL)).length > 0)
  await p.evaluate(() => document.getElementById('probe').remove())
  await p.fill('#pp', PP); await p.fill('#pin', String((Number(PIN) + 1) % 1000000).padStart(6, '0'))
  await p.click('[data-testid=login-submit]'); await p.waitForSelector('[data-testid=login-error]', { timeout: 15000 })
  check('Wrong PIN shows the generic error', (await p.locator('[data-testid=login-error]').innerText()).length > 10)
  await p.screenshot({ path: SHOTS + 'login-error-ta-360x640.png' })
  await p.fill('#pp', PP.toLowerCase()); await p.fill('#pin', PIN)
  await p.click('[data-testid=login-submit]'); await p.waitForSelector('[data-testid=worker-name]', { timeout: 20000 })
  check('Worker signs in with passport + PIN and sees his name', (await p.locator('[data-testid=worker-name]').innerText()) === 'Murugan Selvam')
  check('Home shows pay RM 1,850 and loan RM 900', /1,850/.test(await p.locator('[data-testid=home-pay]').innerText()) && /900/.test(await p.locator('[data-testid=home-loan]').innerText()))
  await p.click('[data-testid=nav-docs]'); await p.waitForSelector('[data-testid=doc-tile]')
  const tones = await p.locator('[data-testid=doc-tile]').evaluateAll((els) => els.map((e) => e.dataset.tone))
  check('Expiry tiles: passport green, PLKS amber, visa red, FOMEMA red (expired), insurance grey', JSON.stringify(tones) === JSON.stringify(['green', 'amber', 'red', 'red', 'grey']), JSON.stringify(tones))
  check('Passport number is masked on screen', !(await p.locator('main').innerText()).includes(PP.slice(0, 4)))
  // remember the signed-in browser state for the other screen sizes (no extra logins)
  const state = await ctx.storageState()

  // ---------- wizard: leave → goes to the outlet manager
  await p.click('[data-testid=nav-new]'); await p.waitForSelector('[data-testid=new-types]')
  ns = await p.evaluate(NO_SCROLL); check('No scroll: request type picker 360x640', ns.length === 0, JSON.stringify(ns))
  await p.click('[data-testid=type-leave]'); await p.screenshot({ path: SHOTS + 'new-leave-step1-ta-360x640.png' })
  await p.click('[data-testid=opt-annual]')
  await p.fill('#from', plus(14)); await p.fill('#to', plus(16)); await p.fill('#reason', 'Temple festival')
  ns = await p.evaluate(NO_SCROLL); check('No scroll: leave dates step 360x640', ns.length === 0, JSON.stringify(ns))
  await p.screenshot({ path: SHOTS + 'new-leave-step2-ta-360x640.png' })
  await p.click('[data-testid=wiz-next]')
  ns = await p.evaluate(NO_SCROLL); check('No scroll: confirm step 360x640', ns.length === 0, JSON.stringify(ns))
  await p.screenshot({ path: SHOTS + 'new-leave-confirm-ta-360x640.png' })
  await p.click('[data-testid=wiz-send]'); await p.waitForSelector('[data-testid=new-done]', { timeout: 15000 })
  check('Leave sent → "sent to your outlet manager"', (await p.locator('[data-testid=new-done]').innerText()).includes('மேலாளருக்கு'))
  await p.screenshot({ path: SHOTS + 'new-sent-ta-360x640.png' })
  const mine = (await admin.from('requests').select('id,status,source,type').eq('worker_id', W).eq('source', 'worker')).data || []
  check('Database: annual_leave, source=worker, status=manager_review', mine.length === 1 && mine[0].status === 'manager_review' && mine[0].type === 'annual_leave', JSON.stringify(mine))
  await p.click('[data-testid=new-done] button'); await p.waitForSelector('[data-testid=req-list]')
  ns = await p.evaluate(NO_SCROLL); check('No scroll: requests list with 8 requests at 360x640 (pages instead)', ns.length === 0, JSON.stringify(ns))
  check('Requests list pages instead of scrolling', (await p.locator('.pager').count()) === 1)
  await p.screenshot({ path: SHOTS + 'requests-ta-360x640.png' })
  // outlet manager rejects with a reason → worker sees it after refresh
  await om.c.rpc('request_manager_act', { p_id: mine[0].id, p_action: 'reject', p_comment: 'Short staff that week, choose another date' })
  await p.click('[data-testid=refresh]'); await p.waitForTimeout(2500)
  await p.locator('[data-testid=req-row]').first().click(); await p.waitForSelector('[data-testid=req-status]')
  check('Worker sees the manager\'s rejection and reason', (await p.locator('[data-testid=req-status]').innerText()) === 'நிராகரிப்பு' && (await p.locator('[data-testid=req-reason]').innerText()).includes('Short staff'))
  ns = await p.evaluate(NO_SCROLL); check('No scroll: request detail 360x640', ns.length === 0, JSON.stringify(ns))
  await p.screenshot({ path: SHOTS + 'request-detail-rejected-ta-360x640.png' })
  await p.locator('.sheet .ph button').click()
  // complaint about the manager → private, straight to HR
  await p.click('[data-testid=nav-new]'); await p.click('[data-testid=type-complaint]'); await p.click('[data-testid=opt-Hostel]')
  await p.fill('#reason', 'Manager shouts at us'); await p.check('[data-testid=about-manager]')
  ns = await p.evaluate(NO_SCROLL); check('No scroll: complaint step 360x640', ns.length === 0, JSON.stringify(ns))
  await p.screenshot({ path: SHOTS + 'new-complaint-ta-360x640.png' })
  await p.click('[data-testid=wiz-next]'); await p.click('[data-testid=wiz-send]'); await p.waitForSelector('[data-testid=new-done]', { timeout: 15000 })
  const comp = (await admin.from('requests').select('status,confidential').eq('worker_id', W).eq('type', 'complaint').single()).data
  check('Complaint about the manager → HR directly, confidential', comp?.status === 'submitted' && comp?.confidential === true, JSON.stringify(comp))
  await p.click('[data-testid=new-done] button')
  // Me: language sheet + change PIN sheet
  await p.click('[data-testid=nav-me]'); await p.click('[data-testid=me-lang]')
  ns = await p.evaluate(NO_SCROLL); check('No scroll: language sheet 360x640', ns.length === 0, JSON.stringify(ns))
  await p.screenshot({ path: SHOTS + 'language-ta-360x640.png' }); await p.locator('.sheet .ph button').click()
  await p.click('[data-testid=me-pin]')
  ns = await p.evaluate(NO_SCROLL); check('No scroll: change-PIN sheet 360x640', ns.length === 0, JSON.stringify(ns))
  await p.screenshot({ path: SHOTS + 'change-pin-ta-360x640.png' }); await p.locator('.sheet .ph button').click()
  await ctx.close()

  // ---------- every tab × every screen size
  for (const v of VIEWPORTS) {
    const c = await browser.newContext({ viewport: { width: v.width, height: v.height }, isMobile: v.mobile, hasTouch: v.mobile, deviceScaleFactor: v.mobile ? 2 : 1, storageState: state })
    await c.addInitScript((l) => localStorage.setItem('fww-lang', l), v.lang)
    const pg = await c.newPage()
    await pg.goto(APP); await pg.waitForSelector('[data-testid=worker-name]', { timeout: 20000 })
    for (const tab of TABS) {
      await pg.click(`[data-testid=nav-${tab}]`); await pg.waitForTimeout(400)
      const bad = await pg.evaluate(NO_SCROLL)
      check(`No scroll: ${tab} @ ${v.name} (${v.lang})`, bad.length === 0, JSON.stringify(bad))
      await pg.screenshot({ path: `${SHOTS}${tab}-${v.lang}-${v.name}.png` })
    }
    await c.close()
  }

  // ---------- every language at the smallest screen (long words must still fit)
  for (const l of ['ta', 'en', 'hi', 'te', 'ml', 'kn', 'bn', 'ne', 'ms', 'my']) {
    const c = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true, storageState: state })
    await c.addInitScript((x) => localStorage.setItem('fww-lang', x), l)
    const pg = await c.newPage(); await pg.goto(APP); await pg.waitForSelector('[data-testid=worker-name]', { timeout: 20000 })
    const bad = []
    for (const tab of TABS) { await pg.click(`[data-testid=nav-${tab}]`); await pg.waitForTimeout(250); bad.push(...(await pg.evaluate(NO_SCROLL)).map((b) => tab + ': ' + b)) }
    await pg.click('[data-testid=nav-new]'); await pg.click('[data-testid=type-loan]'); bad.push(...(await pg.evaluate(NO_SCROLL)).map((b) => 'loan: ' + b))
    check(`No scroll in language ${l} (all tabs + loan step) @ 360x640`, bad.length === 0, JSON.stringify(bad.slice(0, 6)))
    if (['en', 'hi', 'my'].includes(l)) { await pg.click('[data-testid=nav-home]'); await pg.screenshot({ path: `${SHOTS}home-${l}-360x640.png` }) }
    await c.close()
  }

  // ---------- revoke from FW Manager → the app signs out on next refresh
  const c = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, storageState: state })
  const pg = await c.newPage(); await pg.goto(APP); await pg.waitForSelector('[data-testid=worker-name]', { timeout: 20000 })
  await fetch(`${URL_}/functions/v1/worker-access`, { method: 'POST', headers: { apikey: ANON, Authorization: 'Bearer ' + hr.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'revoke', workerId: W }) })
  await pg.click('[data-testid=refresh]'); await pg.waitForSelector('[data-testid=login-submit]', { timeout: 15000 })
  check('After HR revokes access the open app goes back to the login screen', (await pg.locator('.note').count()) === 1)
  await pg.screenshot({ path: SHOTS + 'revoked-signed-out-ta-375x667.png' })
  await c.close()
} catch (e) {
  check('test ran without crashing', false, e.message)
} finally {
  if (browser) await browser.close()
  const acc = (await admin.from('worker_access').select('user_id').eq('worker_id', W)).data || []
  const rq = (await admin.from('requests').select('id').eq('worker_id', W)).data || []
  if (rq.length) { await admin.from('ceo_reviews').delete().in('request_id', rq.map((x) => x.id)); await admin.from('requests').delete().in('id', rq.map((x) => x.id)) }
  await admin.from('worker_access').delete().eq('worker_id', W)
  await admin.from('worker_login_attempts').delete().gte('at', t0)
  for (const a of acc) await admin.auth.admin.deleteUser(a.user_id)
  for (const id of staffIds) await admin.auth.admin.deleteUser(id)
  await admin.from('records').delete().in('id', [O, W])
  console.log(`\n${pass} passed, ${fail} failed`)
  fs.writeFileSync(SHOTS + 'ui-results.json', JSON.stringify({ at: new Date().toISOString(), pass, fail, results }, null, 1))
  process.exit(fail ? 1 : 0)
}
