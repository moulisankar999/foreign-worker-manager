// No-scroll check of the FW Worker Help sheet (every FAQ page/answer and every guide) in every worker-app language (te, ml, kn, my fall back to English help), at 360x640.
// TEST only: uses the seeded test worker from scripts/manuals/test-env.mjs state.
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { STATE } from './test-env.mjs'
const { chromium } = createRequire('/workspace/tools/pw/node_modules/playwright/package.json')('playwright')
const WUI = process.env.WORKER_URL || 'http://localhost:4190/worker/'
const S = JSON.parse(fs.readFileSync(STATE, 'utf8'))
const src = fs.readFileSync(new URL('../../tests/worker-ui.test.mjs', import.meta.url), 'utf8')
const NO_SCROLL = new Function('return (' + src.slice(src.indexOf('const NO_SCROLL = ') + 18, src.indexOf('\n}\n', src.indexOf('const NO_SCROLL')) + 2) + ')')()
const b = await chromium.launch(); let fails = 0, checks = 0
const chk = async (p, what) => { checks++; const bad = await p.evaluate(NO_SCROLL); if (bad.length) { fails++; console.log('FAIL', what, JSON.stringify(bad)); await p.screenshot({ path: `/tmp/hc-${what.replace(/\W+/g, '_')}.png` }) } }
for (const vp of [{ width: 360, height: 640 }, { width: 390, height: 844 }]) for (const lang of (process.env.LANGS || 'ta,en,hi,ms,ne,bn,te,ml,kn,my').split(',')) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); await ctx.addInitScript((l) => localStorage.setItem('fww-lang', l), lang)
  const p = await ctx.newPage(); const tag = `${lang}@${vp.width}x${vp.height}`
  await p.goto(WUI); await p.waitForSelector('[data-testid=login-submit]')
  await p.click('[data-testid=login-help]'); await p.waitForTimeout(300); await chk(p, `login help ${tag}`); await p.goto(WUI); await p.waitForSelector('#pp')
  await p.fill('#pp', S.pp); await p.fill('#pin', S.pin); await p.click('[data-testid=login-submit]'); await p.waitForSelector('[data-testid=worker-name]', { timeout: 30000 })
  await p.click('[data-testid=help]'); await p.waitForTimeout(400)
  for (const t of ['help-faq', 'help-how']) {
    await p.click(`[data-testid=${t}]`); await p.waitForTimeout(250)
    for (let page = 0; page < 10; page++) {
      await chk(p, `${t} list p${page + 1} ${tag}`)
      const n = await p.locator('[data-testid=help-row]').count()
      for (let i = 0; i < n; i++) { await p.locator('[data-testid=help-row]').nth(i).click(); await p.waitForTimeout(120); await chk(p, `${t} p${page + 1} item ${i + 1} ${tag}`); await p.click('[data-testid=help-back]'); await p.waitForTimeout(120) }
      const next = p.locator('[data-testid=help-next]'); if (!(await next.count()) || await next.isDisabled()) break
      await next.click(); await p.waitForTimeout(150)
    }
  }
  await ctx.close()
}
await b.close(); console.log(`worker help no-scroll: ${checks - fails}/${checks} passed`); process.exit(fails ? 1 : 0)
