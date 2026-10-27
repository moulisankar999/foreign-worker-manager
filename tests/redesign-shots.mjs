// v1.6.0 redesign: before/after screenshots + page-length metrics (CEO, desktop 1280 + phone 390), command palette and dark mode. TEST build only.
// Usage: UI_URL=http://localhost:PORT/ OUT=/workspace/screens-160/after/ node tests/redesign-shots.mjs
import fs from 'node:fs'
import { createRequire } from 'node:module'
const { chromium } = createRequire((process.env.PW_PKG || '/workspace/tools/pw') + '/package.json')('playwright')
const UI = process.env.UI_URL, OUT = process.env.OUT, WHO = process.env.WHO || 'ceo'
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null // e.g. ONLY=dashboard,ar-overview,recruit (preview mode)
if (!/localhost|127\.0\.0\.1/.test(UI || '')) { console.error('localhost TEST build only'); process.exit(1) }
const cred = JSON.parse(fs.readFileSync('/tmp/qseed-users.json', 'utf8'))
const browser = await chromium.launch(); const errs = []; const rows = []
const desk = { viewport: { width: 1280, height: 800 } }, phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }
const go = async (p, h) => { await p.goto(UI + '#' + h); await p.waitForTimeout(1500); await p.getByText('Loading…', { exact: true }).first().waitFor({ state: 'detached', timeout: 20000 }).catch(() => {}); await p.waitForTimeout(2500) }
const measure = async (p, tag, name) => {
  const m = await p.evaluate(() => ({ h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth, vw: innerWidth, vh: innerHeight, path: location.hash }))
  rows.push({ tag, name, screens: +(m.h / m.vh).toFixed(1), exact: +(m.h / m.vh).toFixed(2), hOverflow: m.w > m.vw + 2, path: m.path })
}
for (const [tag, opt] of [['desktop', desk], ['phone', phone]]) {
  const ctx = await browser.newContext(opt); const p = await ctx.newPage()
  p.on('pageerror', (e) => errs.push(`${tag}: ${e.message}`))
  await p.goto(UI); await p.evaluate(() => { localStorage.setItem('fwm-theme', 'light') })
  await p.fill('#em', cred.users[WHO]); await p.fill('#pw', cred.pw); await p.locator('form button[type=submit]').first().click(); await p.waitForTimeout(7000)
  await go(p, '/quota?tab=pipeline')
  const rec = await p.locator('a[href*="/quota/recruit/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')))
  const recruit = (rec.find((h) => h) || '').replace(/^.*#/, '')
  const pages = [['dashboard', '/'], ['workers', '/workers'], ['ar-overview', '/quota?tab=overview'], ['recruit', recruit], ['alerts', '/alerts'], ['settings', '/settings'], ['assistant', '/assistant'], ['more', '/more']]
  for (const [name, h] of pages) {
    if (!h || (name === 'more' && tag === 'desktop') || (ONLY && !ONLY.includes(name))) continue
    await go(p, h); await measure(p, tag, name)
    await p.screenshot({ path: `${OUT}${name}-${tag}.png` })
  }
  if (ONLY) { await p.evaluate(() => localStorage.setItem('fwm-theme', 'dark')); await p.reload(); await p.waitForTimeout(3000)
    for (const [name, h] of pages) { if (!h || !ONLY.includes(name)) continue; await go(p, h); await p.screenshot({ path: `${OUT}dark-${name}-${tag}.png` }) }
    await ctx.close(); continue }
  // scrolled (collapsed large title) on phone
  if (tag === 'phone') { await go(p, '/workers'); await p.mouse.wheel(0, 600); await p.evaluate(() => window.scrollBy(0, 600)); await p.waitForTimeout(800); await p.screenshot({ path: `${OUT}workers-scrolled-${tag}.png` }) }
  // command palette (if this build has one)
  await go(p, '/')
  await p.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k'); await p.waitForTimeout(600)
  if (tag === 'phone' && !(await p.locator('.cmdk').count())) await p.locator('.gsearch, [aria-label="Search"], .top-search').first().click().catch(() => {})
  await p.waitForTimeout(400)
  if (await p.locator('.cmdk').count()) {
    await p.keyboard.type('sa', { delay: 60 }); await p.waitForTimeout(1200)
    rows.push({ tag, name: 'palette', results: await p.locator('.cmdk-item').count() })
    await p.screenshot({ path: `${OUT}palette-${tag}.png` }); await p.keyboard.press('Escape')
  }
  // dark mode
  await p.evaluate(() => localStorage.setItem('fwm-theme', 'dark')); await p.reload(); await p.waitForTimeout(3000)
  for (const [name, h] of [['dashboard', '/'], ['workers', '/workers'], ['ar-overview', '/quota?tab=overview'], ['recruit', recruit]]) { if (!h) continue; await go(p, h); await p.screenshot({ path: `${OUT}dark-${name}-${tag}.png` }) }
  await p.evaluate(() => localStorage.setItem('fwm-theme', 'light'))
  await ctx.close()
}
await browser.close()
fs.writeFileSync(OUT + 'metrics.json', JSON.stringify(rows, null, 1))
console.table(rows); console.log('page errors:', errs.length ? errs : 'none')
