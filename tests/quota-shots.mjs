// Quota & Recruitment screenshots on a TEST build. Usage: UI_URL=http://localhost:4183/ node tests/quota-shots.mjs (after quota-seed.mjs)
import fs from 'node:fs'
import { createRequire } from 'node:module'
const { chromium } = createRequire((process.env.PW_PKG || '/workspace/tools/pw') + '/package.json')('playwright')
const UI = process.env.UI_URL, OUT = process.env.OUT || '/workspace/screens-quota/', CO = process.env.CO || ''
const cred = JSON.parse(fs.readFileSync('/tmp/qseed-users.json', 'utf8'))
const WHO = process.env.WHO || 'ceo', VIEWS_ON = (process.env.VIEWS || 'phone,ipad,desktop').split(',')
const TABS = (process.env.TABS || 'overview,letters,approvals,pipeline,arrivals,costs,exits,runaways,recon,claims,rules').split(',')
const VIEWS = [
  ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }],
  ['ipad', { viewport: { width: 1024, height: 1366 }, hasTouch: true, deviceScaleFactor: 1 }],
  ['desktop', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }],
].filter(([n]) => VIEWS_ON.includes(n))
const DEMO_CO = [{ id: 'qdemo-cafe', name: 'Demo Sunrise Café Sdn Bhd' }, { id: 'qdemo-foods', name: 'Demo Sunrise Foods Sdn Bhd' }, { id: 'qdemo-resort', name: 'Demo Sunrise Bay Resort Sdn Bhd' }]
const browser = await chromium.launch()
const errs = []
for (const [vn, opt] of VIEWS) {
  const ctx = await browser.newContext(opt); const p = await ctx.newPage()
  p.on('pageerror', (e) => errs.push(`${vn}: ${e.message}`))
  // TEST is shared: show the demo companies in this browser only (nothing is written to the server)
  await p.route('**/rest/v1/app_config*', async (route) => {
    const res = await route.fetch(); let body = await res.text()
    try { const rows = JSON.parse(body); const c = rows.find((r) => r.key === 'companies'); if (c) { for (const x of DEMO_CO) if (!c.value.items.some((i) => i.id === x.id)) c.value.items.push(x) } body = JSON.stringify(rows) } catch { /* leave as is */ }
    await route.fulfill({ response: res, body })
  })
  await p.goto(UI); await p.fill('#em', cred.users[WHO]); await p.fill('#pw', cred.pw); await p.locator('form button[type=submit]').first().click()
  await p.waitForTimeout(6000)
  for (const t of TABS) {
    const path = t === 'runaways' ? '#/quota?tab=exits&run=1' : `#/quota?tab=${t}`
    await p.goto(UI + path); await p.waitForTimeout(1500); await p.getByText('Loading…', { exact: true }).first().waitFor({ state: 'detached', timeout: 20000 }).catch(() => {}); await p.waitForTimeout(1200)
    if (CO) { const sel = p.locator('select').filter({ has: p.locator(`option[value="${CO}"]`) }).first(); if (await sel.count()) { await sel.selectOption(CO); await p.waitForTimeout(800) } }
    const tag = `${WHO === 'ceo' ? '' : WHO + '-'}${t}-${vn}`
    await p.screenshot({ path: `${OUT}${tag}.png`, fullPage: true })
    if (vn === 'desktop' && process.env.EXPAND !== '0') {
      const row = p.locator('tr.dt-click').first()
      if (await row.count()) { await row.locator('td').first().click(); await p.waitForTimeout(700); await p.screenshot({ path: `${OUT}${tag}-expanded.png`, fullPage: true }) }
    }
  }
  await ctx.close()
}
await browser.close()
console.log('done', errs.length ? errs : 'no page errors')
