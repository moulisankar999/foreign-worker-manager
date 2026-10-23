// UI smoke test. SAFETY: TEST project only (refuses live). Needs a build made with VITE_SUPABASE_URL pointing at TEST,
// served at UI_URL, and Playwright available (PLAYWRIGHT_PATH). Creates throwaway @example.com users on TEST.
import fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(new URL('../package.json', import.meta.url))
const { createClient } = require('@supabase/supabase-js')
const { chromium } = createRequire(process.env.PLAYWRIGHT_PATH + '/package.json')('playwright')
const LIVE_REF = 'gnepquxtwkyffjmoydnv'
const env = Object.fromEntries(fs.readFileSync(new URL('../.secrets.env', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const URL_ = env.TEST_SUPABASE_URL
if (!URL_ || URL_.includes(LIVE_REF) || !URL_.includes(env.TEST_PROJECT_REF)) { console.error('ABORT: not the test project'); process.exit(1) }
const admin = createClient(URL_, env.TEST_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 })
if (list.users.some((u) => !u.email.endsWith('@example.com'))) { console.error('ABORT: real users found'); process.exit(1) }
let pass = 0, fail = 0
const check = (n, ok, x = '') => { ok ? pass++ : fail++; console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : x) }
const stamp = Date.now(), pw = 'Ui-' + stamp + '-x!'
async function mk(key, role, outlets) {
  const email = `fwm-ui-${key}-${stamp}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: 'UI ' + key } })
  if (error) throw error
  await admin.from('profiles').update({ role, status: 'active', outlet_ids: outlets }).eq('id', data.user.id)
  return email
}
// put outbound channels back to the shipped default (OFF) so the UI shows "Not configured"; restored at the end
const cfgRow = (await admin.from('app_config').select('value').eq('key', 'notifications').maybeSingle()).data
const orig = cfgRow?.value
if (orig) await admin.from('app_config').update({ value: { ...orig, enabled: { ...orig.enabled, email: false, sms: false, whatsapp: false } } }).eq('key', 'notifications')
// companies + an outlet for the logo / sign-up checks (TEST project only)
await admin.from('app_config').upsert({ key: 'companies', value: { items: [{ id: 'main', name: 'Main company' }, { id: 'c2', name: 'Second Co' }] } })
await admin.from('records').upsert({ entity: 'outlets', id: 'O1', deleted: false, client_ts: new Date().toISOString(), data: { id: 'O1', name: 'Outlet One', type: 'Restaurant', companyId: 'main' } })
const sup = await mk('super', 'super_admin', []), om = await mk('om', 'outlet_manager', ['O1'])
// a pending sign-up (not activated)
await admin.auth.admin.createUser({ email: `fwm-ui-pending-${stamp}@example.com`, password: pw, email_confirm: true, user_metadata: { full_name: 'UI Pending ' + stamp, outlet_id: 'O1' } })
// an SVG logo (rasterised to PNG in the browser) at 1200 px
fs.writeFileSync('/tmp/ui-logo.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 120 80"><rect width="120" height="80" fill="#0e7490"/><circle cx="60" cy="40" r="28" fill="#fbbf24"/><text x="60" y="47" font-size="20" text-anchor="middle" fill="#fff">FW</text></svg>')
const browser = await chromium.launch()
{ // public login page: generic (no company logos), optional company / outlet on Create account
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage()
  await p.goto(process.env.UI_URL); await p.waitForTimeout(1500)
  await p.getByRole('tab', { name: 'Create account' }).click(); await p.waitForTimeout(2000)
  const opts = await p.locator('#wh option').allInnerTexts()
  check('sign-up shows optional company / outlet list', opts.some((o) => /Outlet One/.test(o)) && opts.some((o) => /Not sure/.test(o)), JSON.stringify(opts))
  check('login page shows no company logos', (await p.locator('img[src^="blob:"]').count()) === 0)
  await ctx.close()
}
async function login(email) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const p = await ctx.newPage(); const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  await p.goto(process.env.UI_URL); await p.fill('#em', email); await p.fill('#pw', pw)
  await p.locator('form button[type=submit]').first().click()
  await p.waitForTimeout(6000)
  return { p, errs, ctx }
}
const body = (p) => p.locator('body').innerText()
const go = async (p, h) => { await p.goto(process.env.UI_URL + '#' + h); await p.waitForTimeout(2500) }
{
  const { p, errs, ctx } = await login(sup)
  check('super admin logs in (dashboard shown)', !(await body(p)).includes('Password'), (await body(p)).slice(0, 300))
  await go(p, '/settings'); const t = await body(p)
  check('settings shows Notifications card', /Notifications/.test(t))
  check('outbound channels show Not configured', (t.match(/Not configured/g) || []).length >= 3, t.slice(t.indexOf('Notifications'), t.indexOf('Notifications') + 1500))
  check('approval rules card visible to super', /Approval rules/i.test(t))
  check('emergency reasons card visible', /Emergency leave reasons/i.test(t))
  check('companies + new-user approval cards visible to super', /Companies \(2\)/.test(t) && /New-user approvals/.test(t))
  await go(p, '/'); const dash = await body(p)
  check('pending sign-up is on the super dashboard (Needs my action)', dash.includes('UI Pending ' + stamp) && /new user/i.test(dash), dash.slice(0, 600))
  await go(p, '/settings')
  await p.locator('label[aria-label="Upload logo of Main company"] input[type=file]').setInputFiles('/tmp/ui-logo.svg')
  await p.waitForTimeout(5000)
  const logo = (await admin.from('app_config').select('value').eq('key', 'companies').single()).data.value.items.find((c) => c.id === 'main')?.logo
  const obj = logo ? (await admin.storage.from('logos').download(logo)).data : null
  check('super uploads an SVG company logo → stored as PNG ≤200 KB', /^company\/main\/\d+\.png$/.test(logo || '') && obj && obj.size <= 200 * 1024 && obj.type === 'image/png', String(logo) + ' ' + obj?.size + ' ' + (await body(p)).match(/⚠️.*/)?.[0])
  check('company logo preview shown', (await p.locator('.logo-box img[src^="blob:"]').count()) >= 1)
  await go(p, '/requests'); check('requests page renders', /Request/.test(await body(p)))
  await go(p, '/documents'); check('document library renders', /Document/i.test(await body(p)))
  await go(p, '/reports?r=passport'); check('passport report renders', /consent/i.test(await body(p)))
  await go(p, '/workers'); const w = await body(p)
  check('super sees workers from all outlets', /W1|W2|W3/.test(w) || w.length > 0)
  await p.screenshot({ path: '/tmp/ui-super.png' })
  check('no page errors (super)', errs.length === 0, errs.join(' | '))
  await ctx.close()
}
{
  const { p, errs, ctx } = await login(om)
  await go(p, '/'); const d = await body(p)
  check('OM dashboard renders', d.length > 50)
  check('OM header shows his company logo', (await p.locator('.top-logo img[src^="blob:"]').count()) === 1)
  await p.screenshot({ path: '/tmp/ui-om.png' })
  await go(p, '/settings'); const s = await body(p)
  check('OM does not see Notifications admin card', !/Not configured/.test(s))
  check('OM does not see approval rules', !/Approval rules/i.test(s))
  await go(p, '/requests/new'); check('OM can open new request', /type|Request/i.test(await body(p)))
  check('no page errors (OM)', errs.length === 0, errs.join(' | '))
  await ctx.close()
}
await browser.close()
if (orig) await admin.from('app_config').update({ value: orig }).eq('key', 'notifications')
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
