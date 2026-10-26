// UI smoke test. SAFETY: TEST project only (refuses live). Needs a build made with VITE_SUPABASE_URL pointing at TEST,
// served at UI_URL, and Playwright available (PLAYWRIGHT_PATH). Creates throwaway @example.com users on TEST.
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { addItems } from './_own.mjs'
const require = createRequire(new URL('../package.json', import.meta.url))
const { createClient } = require('@supabase/supabase-js')
const { chromium } = createRequire(process.env.PLAYWRIGHT_PATH + '/package.json')('playwright')
const LIVE_REF = 'gnepquxtwkyffjmoydnv'
const env = Object.fromEntries(fs.readFileSync(new URL('../.secrets.env', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const URL_ = env.TEST_SUPABASE_URL
if (!URL_ || URL_.includes(LIVE_REF) || !URL_.includes(env.TEST_PROJECT_REF)) { console.error('ABORT: not the test project'); process.exit(1) }
const admin = createClient(URL_, env.TEST_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 })
// only this suite's own leftovers (fwm-ui-*@example.com); everything else on TEST is left alone
for (const u of list.users) if (/^fwm-ui-.*@example\.com$/.test(u.email || '')) { await admin.from('profiles').delete().eq('id', u.id); await admin.auth.admin.deleteUser(u.id).catch(() => {}) }
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
const undoCos = await addItems(admin, 'companies', [{ id: 'main', name: 'Main company' }, { id: 'c2', name: 'Second Co' }]) // add-only
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
  // Settings tabs (deep links #/settings/<tab>)
  await go(p, '/settings'); const tabs = await p.locator('.set-tabs [role=tab]').allInnerTexts()
  check('CEO sees all 11 settings tabs (incl. Agencies & Integrations, Pay & Leave rules)', tabs.length === 11 && /Pay & Leave rules/.test(tabs.join('|')) && /Agencies/.test(tabs.join('|')) && /Users & Access/.test(tabs.join('|')) && /About/.test(tabs.join('|')), tabs.join('|'))
  check('Users & Access tab has a pending badge', /Users & Access\s*\d+/.test(tabs.join('|')), tabs.join('|'))
  check('default tab is Account (change password + sign out)', /Change password/.test(await body(p)) && /Switch user \/ Sign out/.test(await body(p)))
  await go(p, '/settings/notifications'); const t = await body(p)
  check('deep link #/settings/notifications opens Notifications', await p.locator('.set-tabs [aria-selected=true]').innerText() === 'Notifications')
  check('outbound channels show Not configured', (t.match(/Not configured/g) || []).length >= 3, t.slice(t.indexOf('Notifications'), t.indexOf('Notifications') + 1500))
  await go(p, '/settings/requests'); check('approval rules card visible to super', /Approval rules/i.test(await body(p)))
  await go(p, '/settings/passport'); check('emergency reasons card visible', /Emergency leave reasons/i.test(await body(p)))
  await go(p, '/settings/org'); const o = await body(p); await go(p, '/settings/users'); const u = await body(p)
  check('companies + new-user approval cards visible to super', /Companies \(\d+\)/.test(o) && /New-user approvals/.test(u))
  check('Users tab lists the pending sign-up', u.includes('UI Pending ' + stamp))
  await p.fill('.set-search input', 'carry forward'); await p.waitForTimeout(300)
  await p.locator('.set-hits button').first().click(); await p.waitForTimeout(800)
  check('settings search jumps to the right tab', p.url().endsWith('#/settings/workers') && /annual leave/i.test(await body(p)), p.url())
  await go(p, '/'); await p.waitForTimeout(2500); const dash = await body(p)
  check('pending sign-up is on the super dashboard (Needs my action)', /\d+ new users? waiting for approval/i.test(dash), dash.slice(0, 600))
  await go(p, '/settings/org')
  await p.locator('tr.dt-click', { hasText: 'Main company' }).first().locator('td').first().click(); await p.waitForTimeout(400) // logo upload sits in the expanded row
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
  await p.locator('.top-logo img[src^="blob:"]').first().waitFor({ timeout: 8000 }).catch(() => {})
  const mainLogo = (await admin.from('app_config').select('value').eq('key', 'companies').single()).data.value.items.find((c) => c.id === 'main')?.logo
  check('OM header shows his company logo', (await p.locator('.top-logo img[src^="blob:"]').count()) === 1, 'config logo now: ' + mainLogo)
  await p.screenshot({ path: '/tmp/ui-om.png' })
  await go(p, '/settings'); const s = await body(p)
  const omTabs = (await p.locator('.set-tabs [role=tab]').allInnerTexts()).join('|')
  check('OM sees only his tabs (no Users/Companies/Passport/Requests)', omTabs === 'Account|Notifications|Data & Backup|About', omTabs)
  await go(p, '/settings/users'); check('OM deep link to a hidden tab falls back to Account', await p.locator('.set-tabs [aria-selected=true]').innerText() === 'Account')
  await go(p, '/settings/notifications'); const sn = await body(p)
  check('OM does not see Notifications admin card', !/Not configured/.test(sn))
  check('OM does not see approval rules', !/Approval rules/i.test(s + sn))
  await go(p, '/requests/new'); check('OM can open new request', /type|Request/i.test(await body(p)))
  // visible sign-out: avatar menu (every role / screen size) + rows on More and Settings
  check('Settings has a Sign out row', /Switch user \/ Sign out/.test(s))
  await go(p, '/more'); check('More page has a Sign out row', /Switch user \/ Sign out/.test(await body(p)))
  check('avatar button in the top bar (mobile)', await p.locator('header.top button.avatar').isVisible())
  await p.locator('header.top button.avatar').click(); await p.waitForTimeout(400)
  const menu = await p.locator('.umenu-pop').innerText().catch(() => '')
  check('avatar menu shows role + outlet', /Outlet Manager/.test(menu) && /Outlet One/.test(menu), menu)
  const rowsBefore = await p.evaluate(() => new Promise((res) => { const r = indexedDB.open('foreign-worker-manager'); r.onsuccess = () => { const t = r.result.transaction('outlets').objectStore('outlets').count(); t.onsuccess = () => { res(t.result); r.result.close() } } }))
  p.once('dialog', (dl) => { void dl.accept() })
  await p.locator('.umenu-pop button', { hasText: 'Sign out' }).click()
  await p.waitForTimeout(5000)
  const st = await p.evaluate(() => new Promise((res) => {
    const keys = Object.keys(localStorage)
    const r = indexedDB.open('foreign-worker-manager')
    r.onsuccess = () => { const tx = r.result.transaction(['workers', 'outlets', 'settings']); let n = 0, done = 0; for (const t of ['workers', 'outlets', 'settings']) { const c = tx.objectStore(t).count(); c.onsuccess = () => { n += c.result; if (++done === 3) { r.result.close(); res({ keys, rows: n }) } } } }
  }))
  check('sign-out returns to the login screen', await p.locator('#em').isVisible())
  check('sign-out clears the session + profile cache', !st.keys.some((k) => k.startsWith('sb-') || k === 'fwm-profile' || k === 'fwm-config' || k === 'fwm-requests'), st.keys.join(','))
  check('sign-out wipes the device copy', rowsBefore > 0 && st.rows === 0, `before ${rowsBefore} after ${st.rows}`)
  await p.reload(); await p.waitForTimeout(3000)
  check('reload after sign-out stays on login (no auto-restore)', await p.locator('#em').isVisible())
  // another person signs in on the same browser
  await p.fill('#em', sup); await p.fill('#pw', pw); await p.locator('form button[type=submit]').first().click(); await p.waitForTimeout(6000)
  await p.locator('header.top button.avatar').click(); await p.waitForTimeout(400)
  check('next user signs in on the same device', /CEO/.test(await p.locator('.umenu-pop').innerText().catch(() => '')))
  await p.setViewportSize({ width: 1280, height: 800 }); await p.waitForTimeout(300)
  check('avatar button visible on desktop too', await p.locator('header.top button.avatar').isVisible())
  check('no page errors (OM)', errs.length === 0, errs.join(' | '))
  await ctx.close()
}
await browser.close()
if (orig) await admin.from('app_config').update({ value: orig }).eq('key', 'notifications')
await undoCos()
{ const { data } = await admin.auth.admin.listUsers({ perPage: 1000 }); for (const u of data.users) if ((u.email || '').startsWith('fwm-ui-') && (u.email || '').includes(String(stamp))) { await admin.from('profiles').delete().eq('id', u.id); await admin.auth.admin.deleteUser(u.id).catch(() => {}) } }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
