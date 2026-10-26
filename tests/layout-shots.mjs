// v1.5.1 layout pass: screenshots (viewport + full page) and page-length metrics for the main screens, CEO, desktop + phone.
// Usage: UI_URL=http://localhost:4195/ OUT=/workspace/screens-151/before/ node tests/layout-shots.mjs   (TEST build only)
import fs from 'node:fs'
import { createRequire } from 'node:module'
const { chromium } = createRequire((process.env.PW_PKG || '/workspace/tools/pw') + '/package.json')('playwright')
const UI = process.env.UI_URL, OUT = process.env.OUT, WHO = process.env.WHO || 'ceo'
if (!/localhost|127\.0\.0\.1/.test(UI || '')) { console.error('localhost TEST build only'); process.exit(1) }
const cred = JSON.parse(fs.readFileSync('/tmp/qseed-users.json', 'utf8'))
const browser = await chromium.launch(); const errs = []; const rows = []
const desk = { viewport: { width: 1440, height: 900 } }, phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }
const go = async (p, h) => { await p.goto(UI + '#' + h); await p.waitForTimeout(1500); await p.getByText('Loading…', { exact: true }).first().waitFor({ state: 'detached', timeout: 20000 }).catch(() => {}); await p.waitForTimeout(1500) }
for (const [tag, opt] of [['desktop', desk], ['phone', phone]]) {
  const ctx = await browser.newContext(opt); const p = await ctx.newPage()
  p.on('pageerror', (e) => errs.push(`${tag}: ${e.message}`))
  await p.goto(UI); await p.fill('#em', cred.users[WHO]); await p.fill('#pw', cred.pw); await p.locator('form button[type=submit]').first().click(); await p.waitForTimeout(7000)
  await go(p, '/quota?tab=pipeline')
  const rec = await p.locator('a[href*="/quota/recruit/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')))
  const recruit = (rec.find((h) => h) || '').replace(/^.*#/, '')
  await go(p, '/workers'); const wl = await p.locator('a[href*="/workers/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')).filter((h) => !/new|edit/.test(h)))
  const worker = (wl[0] || '').replace(/^.*#/, '')
  const pages = [['dashboard', '/'], ['workers', '/workers'], ['worker-detail', worker], ['requests', '/requests'], ['alerts', '/alerts'], ['compliance', '/compliance'], ['reports', '/reports'],
    ['ar-overview', '/quota?tab=overview'], ['ar-letters', '/quota?tab=letters'], ['ar-approvals', '/quota?tab=approvals'], ['ar-pipeline', '/quota?tab=pipeline'], ['recruit', recruit],
    ['ar-arrivals', '/quota?tab=arrivals'], ['ar-costs', '/quota?tab=costs'], ['ar-exits', '/quota?tab=exits'], ['ar-rules', '/quota?tab=rules'],
    ['settings', '/settings'], ['settings-users', '/settings/users'], ['settings-data', '/settings/data'], ['help', '/help'], ['assistant', '/assistant']]
  for (const [name, h] of pages) {
    if (!h) continue
    await go(p, h)
    const m = await p.evaluate(() => ({ h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth, vw: innerWidth, vh: innerHeight, path: location.hash }))
    rows.push({ tag, name, screens: +(m.h / m.vh).toFixed(1), hOverflow: m.w > m.vw + 2, path: m.path })
    await p.screenshot({ path: `${OUT}${name}-${tag}.png` })
    await p.screenshot({ path: `${OUT}${name}-${tag}-full.png`, fullPage: true })
  }
  await ctx.close()
}
await browser.close()
fs.writeFileSync(OUT + 'metrics.json', JSON.stringify(rows, null, 1))
console.table(rows); console.log('page errors:', errs.length ? errs : 'none')
