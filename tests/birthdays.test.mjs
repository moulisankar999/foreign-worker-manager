// v1.6.0 Birthdays: daily sweep (auto wish once per worker per year, morning list per staff scope), staff wishes (RLS + role checks,
// hidden superiors), settings (GM and above), the worker's birthday card in FW Worker, and the staff Birthdays page + screenshots.
// SAFETY: TEST project only. Creates its own stamped outlets/workers/users and removes only those (plus their wishes/notifications).
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
const UI = process.env.UI_URL || 'http://localhost:4221/', APP = process.env.WORKER_URL || 'http://localhost:4223/worker/'
const OUT = process.env.OUT || '/workspace/screens-160/birthdays/'
fs.mkdirSync(OUT, { recursive: true })
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(URL_, env.TEST_SERVICE_ROLE_KEY, opts)
let pass = 0, fail = 0
const check = (n, ok, x = '') => { ok ? pass++ : fail++; console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : x) }
const stamp = Date.now().toString(36), pw = crypto.randomBytes(12).toString('hex')
const O = 'bd-o-' + stamp, O2 = 'bd-o2-' + stamp, PP = 'B' + stamp.toUpperCase().slice(-7)
const staffIds = []
async function staff(key, role, outlets = [], name) {
  const email = `fwb-${key}-${stamp}@example.com`, full = name || 'Bday ' + key.toUpperCase()
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: full } })
  if (error) throw error
  staffIds.push(data.user.id)
  await admin.from('profiles').update({ role, status: 'active', outlet_ids: outlets, company_ids: [], full_name: full }).eq('id', data.user.id)
  const c = createClient(URL_, ANON, opts); const s = await c.auth.signInWithPassword({ email, password: pw }); if (s.error) throw s.error
  return { c, token: s.data.session.access_token, email, id: data.user.id }
}
// Malaysia date arithmetic
const myt = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date())
const TODAY = myt(), YEAR = +TODAY.slice(0, 4)
const shift = (d) => { const x = new Date(TODAY + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10) }
const dob = (d, born) => born + shift(d).slice(4)
const earlier = (() => { const day = +TODAY.slice(8); return day > 3 ? TODAY.slice(0, 8) + '02' : null })()
const W = (k) => 'bd-w' + k + '-' + stamp
const now = new Date().toISOString()
const workers = [
  { id: W(1), fullName: 'Murugan Selvam', primaryLanguage: 'ta', nationality: 'India', dob: dob(0, 1994), status: 'Active-Working', phoneMY: '012-345 6789', pp: PP },
  { id: W(2), fullName: 'Ram Bahadur Thapa', primaryLanguage: 'ne', nationality: 'Nepal', dob: dob(0, 1990), status: 'Active-Working', phoneMY: '011-2233 4455' },
  { id: W(3), fullName: 'Kumar Rajan', primaryLanguage: 'ta', nationality: 'India', dob: dob(0, 1993), status: 'Absconded' },
  { id: W(4), fullName: 'Aung Ko Ko', primaryLanguage: 'my', nationality: 'Myanmar', dob: dob(2, 1998), status: 'Active-Working', phoneMY: '016-778 9900' },
  { id: W(5), fullName: 'Rahim Uddin', primaryLanguage: 'bn', nationality: 'Bangladesh', dob: dob(5, 1992), status: 'Active-Working' },
  ...(earlier ? [{ id: W(6), fullName: 'Dewi Lestari', primaryLanguage: 'id', nationality: 'Indonesia', dob: '1996' + earlier.slice(4), status: 'Active-Working' }] : []),
]
const ids = workers.map((w) => w.id)
let browser, cfgBefore
try {
  const ins = await admin.from('records').insert([
    { entity: 'outlets', id: O, client_ts: now, data: { id: O, name: 'Bangsar Kitchen', companyId: 'main', phone: '03-2282 1234' } },
    { entity: 'outlets', id: O2, client_ts: now, data: { id: O2, name: 'Other Outlet', companyId: 'main' } },
    ...workers.map((w, i) => ({ entity: 'workers', id: w.id, client_ts: now, data: { id: w.id, workerNo: 'B' + i + stamp.slice(-3), fullName: w.fullName, outletId: O, nationality: w.nationality, status: w.status,
      joinDate: '2023-06-01', dob: w.dob, primaryLanguage: w.primaryLanguage, phoneMY: w.phoneMY, jobCategory: 'Kitchen helper', initialBasicPay: 1700,
      documents: w.pp ? [{ id: 'p', type: 'Passport', number: w.pp, expiryDate: shift(700) }] : [], increments: [], loans: [], deductions: [], leaves: [], memos: [] } })),
  ])
  if (ins.error) throw ins.error
  cfgBefore = (await admin.from('app_config').select('value').eq('key', 'birthdays').maybeSingle()).data
  const hrm = await staff('hrm', 'hr_manager', [O], 'Priya Nair'), hrm2 = await staff('hrm2', 'hr_manager', [O2]), om = await staff('om', 'outlet_manager', [O])
  const gm = await staff('gm', 'general_manager', [], 'Tan Wei Ming')

  // ---------- sweep (service role, narrowed to our workers and staff)
  const s1 = await admin.rpc('bday_sweep', { p_workers: ids, p_staff: staffIds })
  check('Sweep finds the 2 active birthdays today (absconded worker skipped)', s1.data?.birthdays === 2, JSON.stringify(s1.data || s1.error))
  check('Sweep creates 2 company auto wishes', s1.data?.autoWishes === 2)
  check('Sweep notifies the in-scope HR Manager and the GM only', s1.data?.staffNotified === 2, JSON.stringify(s1.data))
  const s2 = await admin.rpc('bday_sweep', { p_workers: ids, p_staff: staffIds })
  check('Second sweep the same day sends nothing again (once per worker per year)', s2.data?.autoWishes === 0 && s2.data?.staffNotified === 0, JSON.stringify(s2.data || s2.error))
  const ww = (await admin.from('worker_wishes').select('*').in('worker_id', ids)).data || []
  check('No auto wish for the absconded worker', !ww.some((w) => w.worker_id === W(3)))
  const dl = (await admin.from('notification_deliveries').select('user_id,event,link,title,body,channel').in('user_id', staffIds).eq('event', 'birthdays_today')).data || []
  const mine = dl.filter((d) => d.user_id === hrm.id && d.channel === 'in_app')
  check('HR Manager gets one in-app morning list linking to Birthdays', mine.length === 1 && /#\/birthdays$/.test(mine[0].link || ''), JSON.stringify(mine))
  check('Morning list names both workers', /Murugan/.test(mine[0]?.body || '') && /Ram Bahadur/.test(mine[0]?.body || '') && /2/.test(mine[0]?.title || ''), JSON.stringify(mine[0]))
  check('Out-of-scope HR Manager and the OM get no morning list', !dl.some((d) => d.user_id === hrm2.id || d.user_id === om.id))
  const deny = await admin.rpc('bday_sweep', {}).then(() => null)
  const hs = await hrm.c.rpc('bday_sweep', { p_workers: ids }); check('Staff cannot run the sweep', !!hs.error)
  void deny

  // ---------- staff wishes
  const v1 = await hrm.c.rpc('bday_wishes', { p_year: YEAR })
  check('HR Manager sees the company wishes for workers in scope', (v1.data || []).filter((w) => ids.includes(w.worker_id) && w.kind === 'auto').length === 2, JSON.stringify(v1.error))
  const v2 = await hrm2.c.rpc('bday_wishes', { p_year: YEAR })
  check('Out-of-scope HR Manager sees none of them', !(v2.data || []).some((w) => ids.includes(w.worker_id)))
  const sw = await hrm.c.rpc('bday_send_wish', { p_worker: W(1), p_message: 'Happy birthday Murugan! Enjoy your day — Priya' })
  check('HR Manager sends a personal wish, signed with name and role', !sw.error && /Priya Nair/.test(sw.data?.signedAs || '') && /HR Manager/.test(sw.data?.signedAs || ''), JSON.stringify(sw.data || sw.error))
  check('Out-of-scope HR Manager cannot wish', !!(await hrm2.c.rpc('bday_send_wish', { p_worker: W(1), p_message: 'Hello there' })).error)
  check('Outlet Manager cannot wish (role)', !!(await om.c.rpc('bday_send_wish', { p_worker: W(1), p_message: 'Hello there' })).error)
  check('No wish to a worker who has left', !!(await hrm.c.rpc('bday_send_wish', { p_worker: W(3), p_message: 'Hello there' })).error)
  check('Empty wish rejected', !!(await hrm.c.rpc('bday_send_wish', { p_worker: W(1), p_message: ' ' })).error)
  const g1 = await gm.c.rpc('bday_send_wish', { p_worker: W(1), p_message: 'Many happy returns, Murugan. Thank you for your hard work. — Tan' })
  check('GM sends a wish', !g1.error, JSON.stringify(g1.error))
  const v3 = ((await hrm.c.rpc('bday_wishes', { p_year: YEAR })).data || []).filter((w) => w.worker_id === W(1) && w.kind === 'personal')
  const gmRow = v3.find((w) => !w.mine), hrRow = v3.find((w) => w.mine)
  check('HR Manager sees own wish marked as theirs', !!hrRow)
  check('A superior\'s wish shows only as "Management" to the HR Manager (hidden superiors)', gmRow && gmRow.sender_name === '' && gmRow.sender_role === 'management', JSON.stringify(gmRow))
  const v4 = ((await gm.c.rpc('bday_wishes', { p_year: YEAR })).data || []).filter((w) => w.worker_id === W(1) && w.kind === 'personal' && !w.mine)
  check('GM sees the HR Manager\'s name on her wish', v4[0]?.sender_name === 'Priya Nair', JSON.stringify(v4))
  check('Rate limit: at most 3 wishes per sender per worker per day', await (async () => { for (let i = 0; i < 2; i++) await hrm.c.rpc('bday_send_wish', { p_worker: W(2), p_message: 'Wish ' + i }); return !!(await hrm.c.rpc('bday_send_wish', { p_worker: W(2), p_message: 'Wish 3' })).error === false && !!(await hrm.c.rpc('bday_send_wish', { p_worker: W(2), p_message: 'Wish 4' })).error })())
  await admin.from('worker_wishes').delete().eq('worker_id', W(2)).eq('kind', 'personal')

  // ---------- settings
  check('HR Manager cannot change birthday settings', !!(await hrm.c.rpc('bday_config_save', { p_cfg: { autoWish: false } })).error)
  const c0 = (await gm.c.rpc('bday_config')).data
  check('Settings have templates for all 10 languages', c0 && Object.keys(c0.templates || {}).length >= 10, JSON.stringify(Object.keys(c0?.templates || {})))
  const cs = await gm.c.rpc('bday_config_save', { p_cfg: { ...c0, templates: { ...c0.templates, en: 'Happy birthday {{name}}! From all of us at {{company}}.' } } })
  check('GM can change the English template', !cs.error && /all of us/.test((await gm.c.rpc('bday_config')).data?.templates?.en || ''), JSON.stringify(cs.error))
  check('Over-long template rejected', !!(await gm.c.rpc('bday_config_save', { p_cfg: { ...c0, templates: { en: 'x'.repeat(1200) } } })).error)

  // ---------- worker app: birthday card
  const gen = await (await fetch(`${URL_}/functions/v1/worker-access`, { method: 'POST', headers: { apikey: ANON, Authorization: 'Bearer ' + hrm.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'generate', workerId: W(1) }) })).json()
  check('HR generated a PIN for the birthday worker', /^\d{6}$/.test(gen.pin || ''))
  browser = await chromium.launch()
  const wc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  const wp = await wc.newPage()
  await wp.goto(APP); await wp.waitForSelector('[data-testid=login-submit]')
  await wp.fill('#pp', PP); await wp.fill('#pin', gen.pin); await wp.click('[data-testid=login-submit]')
  await wp.waitForSelector('[data-testid=bday-card]', { timeout: 20000 }).catch(() => {})
  check('Birthday card opens on its own on the worker\'s birthday', await wp.locator('[data-testid=bday-card]').count() === 1)
  await wp.waitForTimeout(1200)
  const m1 = await wp.locator('[data-testid=bday-msg]').innerText().catch(() => '')
  check('Company wish is in Tamil with the worker\'s first name', /Murugan/.test(m1) && /[\u0B80-\u0BFF]/.test(m1), m1)
  const sc = await wp.evaluate(() => ({ h: document.scrollingElement.scrollHeight, w: document.scrollingElement.scrollWidth, vh: innerHeight, vw: innerWidth }))
  check('Birthday card does not make the page scroll', sc.h <= sc.vh + 1 && sc.w <= sc.vw + 1, JSON.stringify(sc))
  await wp.screenshot({ path: OUT + 'worker-card-company-ta-390.png' })
  await wp.click('[data-testid=bday-next]').catch(() => {}); await wp.waitForTimeout(400)
  const card2 = await wp.locator('[data-testid=bday-card]').innerText()
  check('Next shows a personal wish signed with sender name and role', /Priya Nair/.test(card2) || /Management/.test(card2), card2)
  await wp.screenshot({ path: OUT + 'worker-card-personal-390.png' })
  await wp.click('[data-testid=bday-close]'); await wp.waitForTimeout(1500)
  const unread = (await admin.from('worker_wishes').select('id').eq('worker_id', W(1)).is('read_at', null)).data || []
  check('Closing the card marks the wishes as seen', unread.length === 0, JSON.stringify(unread))
  await wp.reload(); await wp.waitForSelector('[data-testid=worker-name]', { timeout: 20000 }); await wp.waitForTimeout(2000)
  check('Card does not pop up again once seen; the 🎉 chip reopens it', await wp.locator('[data-testid=bday-card]').count() === 0 && await wp.locator('[data-testid=bday-chip]').count() === 1)
  await wp.screenshot({ path: OUT + 'worker-home-chip-390.png' })
  await wp.click('[data-testid=bday-chip]'); await wp.waitForTimeout(500)
  check('Chip reopens the card', await wp.locator('[data-testid=bday-card]').count() === 1)
  await wc.close()

  // ---------- staff Birthdays page (GM)
  const login = async (ctxOpt, who) => {
    const ctx = await browser.newContext(ctxOpt); const p = await ctx.newPage()
    await p.goto(UI); await p.evaluate(() => localStorage.setItem('fwm-theme', 'light'))
    await p.fill('#em', who.email); await p.fill('#pw', pw); await p.locator('form button[type=submit]').first().click(); await p.waitForTimeout(7000)
    return { ctx, p }
  }
  const open = async (p) => { await p.goto(UI + '#/birthdays'); await p.waitForSelector('[data-testid=bd-row], .bd-empty', { timeout: 20000 }); await p.waitForTimeout(1500) }
  const desk = { viewport: { width: 1280, height: 800 } }, phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }
  let { ctx, p } = await login(desk, gm)
  await p.goto(UI + '#/'); await p.waitForTimeout(3000)
  check('Dashboard shows the "birthdays today" chip', /2 birthdays today/.test(await p.locator('[data-testid=bd-chip]').innerText().catch(() => '')))
  await open(p)
  const rowsToday = await p.locator('[data-testid=bd-row]').count()
  check('Birthdays → Today lists the 2 workers (not the absconded one)', rowsToday === 2, String(rowsToday))
  const txt = await p.locator('[data-testid=bd-list]').innerText()
  check('Rows show outlet, mobile and "Turning N"', /Bangsar Kitchen/.test(txt) && /12 345 6789/.test(txt) && new RegExp('Turning ' + (YEAR - 1994)).test(txt), txt.slice(0, 300))
  check('Rows show the company wish as sent', /Company wish/.test(txt))
  check('Call links are tel: links (worker and outlet)', (await p.locator('a[href^="tel:"]').count()) >= 3)
  await p.screenshot({ path: OUT + 'birthdays-today-desktop.png' })
  await p.locator('[data-testid=bd-row]', { hasText: 'Ram Bahadur' }).getByRole('button', { name: /Send wish/ }).click()
  await p.waitForSelector('[data-testid=bd-msg]')
  const pre = await p.locator('[data-testid=bd-msg]').inputValue()
  check('Wish sheet is pre-filled with the worker\'s first name', /Ram/.test(pre), pre)
  await p.screenshot({ path: OUT + 'birthdays-wish-sheet-desktop.png' })
  await p.getByRole('button', { name: 'English' }).click().catch(() => {})
  await p.locator('.modal').getByRole('button', { name: /Send wish/ }).click(); await p.waitForTimeout(2500)
  check('After sending, the row shows "✓ You"', /You/.test(await p.locator('[data-testid=bd-row]', { hasText: 'Ram Bahadur' }).innerText()))
  await p.click('[data-testid=bd-week]'); await p.waitForTimeout(600)
  check('This week adds the upcoming birthdays', (await p.locator('[data-testid=bd-row]').count()) === 4, String(await p.locator('[data-testid=bd-row]').count()))
  await p.screenshot({ path: OUT + 'birthdays-week-desktop.png' })
  await p.click('[data-testid=bd-month]'); await p.waitForTimeout(600)
  await p.screenshot({ path: OUT + 'birthdays-month-desktop.png' })
  const pl = await p.evaluate(() => ({ h: document.documentElement.scrollHeight, vh: innerHeight, w: document.documentElement.scrollWidth, vw: innerWidth }))
  check('Birthdays page desktop: one screen, no horizontal scroll', pl.h <= pl.vh * 1.05 && pl.w <= pl.vw + 2, JSON.stringify(pl))
  await p.evaluate(() => localStorage.setItem('fwm-theme', 'dark')); await p.reload(); await open(p)
  await p.screenshot({ path: OUT + 'birthdays-today-dark-desktop.png' })
  await p.evaluate(() => localStorage.setItem('fwm-theme', 'light'))
  await ctx.close();
  ({ ctx, p } = await login(phone, gm))
  await open(p)
  await p.screenshot({ path: OUT + 'birthdays-today-phone.png' })
  const pp2 = await p.evaluate(() => ({ h: document.documentElement.scrollHeight, vh: innerHeight, w: document.documentElement.scrollWidth, vw: innerWidth }))
  check('Birthdays page phone: no horizontal scroll', pp2.w <= pp2.vw + 2, JSON.stringify(pp2))
  await p.click('[data-testid=bd-week]'); await p.waitForTimeout(600)
  await p.screenshot({ path: OUT + 'birthdays-week-phone.png' })
  await ctx.close();
  ({ ctx, p } = await login(desk, om))
  await p.goto(UI + '#/'); await p.waitForTimeout(2500)
  check('Outlet Manager has no Birthdays menu entry', (await p.locator('a[href="#/birthdays"]').count()) === 0)
  await ctx.close()
} catch (e) {
  check('test ran without crashing', false, e.message)
} finally {
  if (browser) await browser.close()
  if (cfgBefore) await admin.from('app_config').update({ value: cfgBefore.value }).eq('key', 'birthdays')
  else await admin.from('app_config').delete().eq('key', 'birthdays')
  await admin.from('worker_wishes').delete().in('worker_id', ids)
  const evs = ((await admin.from('notification_deliveries').select('event_id').in('user_id', staffIds)).data || []).map((d) => d.event_id).filter(Boolean)
  await admin.from('notification_deliveries').delete().in('user_id', staffIds)
  if (evs.length) await admin.from('notification_events').delete().in('id', [...new Set(evs)])
  const acc = (await admin.from('worker_access').select('user_id').in('worker_id', ids)).data || []
  await admin.from('worker_access').delete().in('worker_id', ids)
  for (const a of acc) await admin.auth.admin.deleteUser(a.user_id)
  for (const id of staffIds) await admin.auth.admin.deleteUser(id)
  await admin.from('records').delete().in('id', [O, O2, ...ids])
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
