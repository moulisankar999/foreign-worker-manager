// v1.4.2 screenshots on a TEST build: A&R overview, letter form with Add company, add-company panel, permission switches,
// company detail (CEO and HR Manager). Usage: UI_URL=http://localhost:4195/ node tests/co-shots.mjs
import fs from 'node:fs'
import { createRequire } from 'node:module'
const { chromium } = createRequire((process.env.PW_PKG || '/workspace/tools/pw') + '/package.json')('playwright')
const UI = process.env.UI_URL, OUT = process.env.OUT || '/workspace/screens-142/', CO = process.env.CO
const cred = JSON.parse(fs.readFileSync('/tmp/qseed-users.json', 'utf8'))
const browser = await chromium.launch(); const errs = []
async function login(who, opt) {
  const ctx = await browser.newContext(opt); const p = await ctx.newPage()
  p.on('pageerror', (e) => errs.push(`${who}: ${e.message}`))
  await p.goto(UI); await p.fill('#em', cred.users[who]); await p.fill('#pw', cred.pw); await p.locator('form button[type=submit]').first().click()
  await p.waitForTimeout(6000); return [ctx, p]
}
const go = async (p, h) => { await p.goto(UI + '#' + h); await p.waitForTimeout(1500); await p.getByText('Loading…', { exact: true }).first().waitFor({ state: 'detached', timeout: 20000 }).catch(() => {}); await p.waitForTimeout(1200) }
const desk = { viewport: { width: 1440, height: 900 } }, phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }
{
  const [ctx, p] = await login('ceo', desk)
  await go(p, '/quota?tab=overview'); await p.screenshot({ path: OUT + 'ar-overview-desktop.png', fullPage: true })
  await go(p, '/quota?tab=letters'); await p.getByRole('button', { name: 'Record a letter' }).click(); await p.waitForTimeout(1500)
  await p.locator('.modal').first().waitFor().catch(() => {}); const sel = p.locator('.modal select').first(); const opts = await sel.locator('option').allTextContents(); console.log('picker options (CEO):', opts.length, JSON.stringify(opts))
  await sel.selectOption('__add_company__').catch(() => {}); await p.waitForTimeout(1200); await p.screenshot({ path: OUT + 'letter-form-add-company.png' })
  await p.screenshot({ path: OUT + 'add-company-panel-from-picker.png' }); await p.locator('.qr-side').getByRole('button', { name: 'Cancel' }).click().catch(() => {}); await p.waitForTimeout(600)
  await p.getByTestId('add-company-btn').click(); await p.waitForTimeout(1200)
  await p.screenshot({ path: OUT + 'add-company-panel.png' })
  await ctx.close()
  const [c2, p2] = await login('ceo', desk)
  await go(p2, '/settings/users'); const hf = p2.locator('#s-hrflags'); if (await hf.count()) { await hf.scrollIntoViewIfNeeded(); await p2.waitForTimeout(600); await hf.screenshot({ path: OUT + 'permission-switches.png' }) } else console.log('no #s-hrflags')
  if (CO) { await go(p2, '/companies/' + CO); await p2.screenshot({ path: OUT + 'company-detail-ceo.png', fullPage: true })
    for (const t of ['SSM documents', 'Directors']) { const b = p2.getByRole('button', { name: t }).or(p2.getByRole('tab', { name: t })).first(); if (await b.count()) { await b.click(); await p2.waitForTimeout(1200); const r = p2.locator('tr.dt-click').first(); if (await r.count()) { await r.locator('td').first().click(); await p2.waitForTimeout(600) } await p2.screenshot({ path: OUT + `company-${t.split(' ')[0].toLowerCase()}-ceo.png`, fullPage: true }) } } }
  await c2.close()
}
for (const [who, opt, tag] of [['hrm', desk, 'desktop'], ['hrm', phone, 'phone']]) {
  const [ctx, p] = await login(who, opt)
  await go(p, '/quota?tab=letters'); const rb = p.getByRole('button', { name: 'Record a letter' }); if (await rb.count()) { await rb.click(); await p.waitForTimeout(1500); const opts = await p.locator('.modal select').first().locator('option').allTextContents(); console.log(`picker options (${who}):`, opts.length, JSON.stringify(opts)); await p.keyboard.press('Escape') }
  if (CO) { await go(p, '/companies/' + CO); const b = p.getByRole('button', { name: 'Directors' }).or(p.getByRole('tab', { name: 'Directors' })).first(); if (await b.count()) { await b.click(); await p.waitForTimeout(1200) } await p.screenshot({ path: OUT + `company-directors-hrm-${tag}.png`, fullPage: true }) }
  await ctx.close()
}
await browser.close(); console.log('page errors:', errs.length ? errs : 'none')
