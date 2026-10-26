// v1.5.1: screenshots of the recruit Documents tab / per-step file links and the "Show sample & demo data" switch (TEST build only)
import fs from 'node:fs'
import { createRequire } from 'node:module'
const { chromium } = createRequire('/workspace/tools/pw/package.json')('playwright')
const UI = process.env.UI_URL, OUT = process.env.OUT, RID = process.env.RID
if (!/localhost/.test(UI || '')) process.exit(1)
const cred = JSON.parse(fs.readFileSync('/tmp/qseed-users.json', 'utf8'))
const browser = await chromium.launch(); const errs = []
const desk = { viewport: { width: 1440, height: 900 } }, phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }
const go = async (p, h) => { await p.goto(UI + '#' + h); await p.waitForTimeout(1500); await p.getByText('Loading…', { exact: true }).first().waitFor({ state: 'detached', timeout: 20000 }).catch(() => {}); await p.waitForTimeout(2500) }
const res = {}
for (const [tag, opt] of [['desktop', desk], ['phone', phone]]) {
  const ctx = await browser.newContext(opt); const p = await ctx.newPage()
  p.on('pageerror', (e) => errs.push(`${tag}: ${e.message}`))
  await p.goto(UI); await p.evaluate(() => localStorage.removeItem('fwm-show-demo'))
  await p.fill('#em', cred.users.ceo); await p.fill('#pw', cred.pw); await p.locator('form button[type=submit]').first().click(); await p.waitForTimeout(7000)
  await go(p, '/workers')
  res[tag + '-hint'] = await p.locator('.sample-hint').innerText().catch(() => null)
  res[tag + '-countOff'] = await p.locator('.page-h .muted').first().innerText()
  await p.screenshot({ path: `${OUT}workers-hidden-${tag}.png` })
  await p.locator('button.avatar').click(); await p.waitForTimeout(500)
  res[tag + '-menu'] = await p.locator('.umenu-check').innerText().catch(() => null)
  await p.screenshot({ path: `${OUT}usermenu-${tag}.png` })
  await p.keyboard.press('Escape'); await p.locator('button.avatar').click().catch(() => {}); await p.waitForTimeout(300)
  if (await p.locator('.umenu-pop').count()) await p.mouse.click(5, 400)
  await p.locator('.sample-hint button').click(); await p.waitForTimeout(3000)
  res[tag + '-countOn'] = await p.locator('.page-h .muted').first().innerText()
  res[tag + '-sampleRows'] = await p.getByText('(SAMPLE)').count()
  await p.screenshot({ path: `${OUT}workers-shown-${tag}.png` })
  await go(p, '/quota/recruit/' + RID)
  res[tag + '-stepLinks'] = await p.locator('.qs-doc').count()
  await p.screenshot({ path: `${OUT}recruit-steps-${tag}.png` })
  await p.screenshot({ path: `${OUT}recruit-steps-${tag}-full.png`, fullPage: true })
  await p.getByRole('tab', { name: /Documents/ }).first().click().catch(async () => p.getByText(/^Documents/).first().click())
  await p.waitForTimeout(1000)
  res[tag + '-docTab'] = await p.locator('main').innerText().then((t) => (t.match(/(Medical|VDR|FOMEMA|Ticket|Stamped|HR)[^\n]*/g) || []).slice(0, 8))
  await p.screenshot({ path: `${OUT}recruit-documents-${tag}.png` })
  // open one file link (signed URL popup / new tab)
  const pop = p.waitForEvent('popup', { timeout: 8000 }).catch(() => null)
  await p.locator('main a, main button').filter({ hasText: /FOMEMA|Medical|📎/ }).first().click().catch(() => {})
  const w = await pop; res[tag + '-open'] = w ? w.url().replace(/\?.*$/, '?…').slice(0, 120) : 'no popup'
  if (w) await w.close()
  await p.evaluate(() => localStorage.removeItem('fwm-show-demo'))
  await ctx.close()
}
await browser.close(); console.log(JSON.stringify(res, null, 1)); console.log('page errors:', errs.length ? errs : 'none')
