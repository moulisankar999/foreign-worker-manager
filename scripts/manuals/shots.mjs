// Screenshots for the user manuals, with red numbered markers that match the guide steps.
// SAFETY: TEST project only — uses scripts/manuals/test-env.mjs (refuses live, refuses real users, stamped data, cleanup).
// Needs: manager build at UI_URL (default http://localhost:4190/) and worker build at WORKER_URL (…/worker/), both built against TEST.
// Run: node --experimental-websocket scripts/manuals/shots.mjs   → /workspace/manuals/shots/*.png
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { seed, cleanup, STATE } from './test-env.mjs'
const { chromium } = createRequire(process.env.PLAYWRIGHT_PKG || '/workspace/tools/pw/node_modules/playwright/package.json')('playwright')
const UI = process.env.UI_URL || 'http://localhost:4190/'
const WUI = process.env.WORKER_URL || UI + 'worker/'
const OUT = process.env.SHOTS_DIR || '/workspace/manuals/shots/'
fs.mkdirSync(OUT, { recursive: true })
const KEEP = process.env.KEEP_DATA === '1'
const S = fs.existsSync(STATE) && process.env.RESEED !== '1' ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : await seed()
const plus = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10)
const made = [], warn = [], errs = []

// ---------- markers
async function mark(p, marks) {
  const boxes = []
  for (const [sel, n] of marks) {
    const loc = p.locator(sel + ' >> visible=true').first()
    if (!(await loc.count())) { warn.push(`marker ${n} not found: ${sel}`); continue }
    if (!boxes.length) await loc.scrollIntoViewIfNeeded().catch(() => {})
    const b = await loc.boundingBox(); if (!b) { warn.push(`marker ${n} hidden: ${sel}`); continue }
    boxes.push({ ...b, n })
  }
  await p.evaluate((bs) => {
    document.querySelectorAll('.zz-mark').forEach((e) => e.remove())
    for (const b of bs) {
      const o = document.createElement('div'); o.className = 'zz-mark'
      Object.assign(o.style, { position: 'fixed', left: b.x - 4 + 'px', top: b.y - 4 + 'px', width: b.width + 8 + 'px', height: b.height + 8 + 'px', border: '3px solid #dc2626', borderRadius: '10px', zIndex: 2147483646, pointerEvents: 'none', boxShadow: '0 0 0 2px rgba(255,255,255,.8)' })
      const c = document.createElement('div'); c.className = 'zz-mark'; c.textContent = String(b.n)
      const cx = Math.max(2, b.x - 16), cy = Math.max(2, b.y - 16)
      Object.assign(c.style, { position: 'fixed', left: cx + 'px', top: cy + 'px', width: '28px', height: '28px', borderRadius: '50%', background: '#dc2626', color: '#fff', font: '700 16px/28px system-ui, sans-serif', textAlign: 'center', zIndex: 2147483647, pointerEvents: 'none', boxShadow: '0 1px 4px rgba(0,0,0,.4)', border: '2px solid #fff' })
      document.body.append(o, c)
    }
  }, boxes)
  return boxes.length
}
const unmark = (p) => p.evaluate(() => document.querySelectorAll('.zz-mark').forEach((e) => e.remove()))
async function snap(p, name, marks = [], mode = 'main') {
  await p.evaluate(() => document.querySelectorAll('p.banner').forEach((el) => { if (/^TEST BUILD/.test((el.textContent || '').trim())) el.style.display = 'none' }))
  await mark(p, marks); await p.waitForTimeout(150)
  const vp = p.viewportSize(); let clip
  if (mode === 'main') { const m = await p.locator('main').first().boundingBox(); if (m) { const x = Math.max(0, m.x); clip = { x, y: 0, width: Math.min(vp.width, m.x + m.width) - x, height: vp.height } } }
  await p.screenshot({ path: OUT + name + '.png', clip })
  await unmark(p); made.push(name); console.log('saved', name)
}

const browser = await chromium.launch()
async function ctxFor(vp, mobile = false) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: mobile ? 2 : 1.5, isMobile: mobile, hasTouch: mobile })
  await ctx.addInitScript(() => localStorage.setItem('fwm-theme', 'light'))
  return ctx
}
async function login(role, vp = { width: 1366, height: 860 }, mobile = false) {
  const ctx = await ctxFor(vp, mobile); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(role + ': ' + e.message))
  await p.goto(UI); await p.fill('#em', S.users[role].email); await p.fill('#pw', S.pw)
  await p.locator('form button[type=submit]').first().click(); await p.waitForSelector('main', { timeout: 30000 }); await p.waitForTimeout(6000)
  return { p, ctx }
}
const go = async (p, h, w = 2500) => { await p.goto(UI + '#' + h); await p.waitForTimeout(w) }
const click = async (p, sel, w = 900) => { const l = p.locator(sel + ' >> visible=true').first(); if (await l.count()) { await l.click(); await p.waitForTimeout(w); return true } warn.push('click not found: ' + sel); return false }
const btn = (t) => `main button:has-text("${t}")`
const tab = (t) => `main [role=tab]:has-text("${t}"), main button:has-text("${t}")`

const ONLY = (process.env.ONLY || '').split(',').filter(Boolean); const want = (ph) => !ONLY.length || ONLY.includes(ph)
try {
  // ================= FW Worker (phone) — Tamil and English; also raises the leave request the outlet manager will decide
  for (const lang of want('worker') ? ['ta', 'en'] : []) {
    const ctx = await ctxFor({ width: 390, height: 780 }, true)
    await ctx.addInitScript((l) => localStorage.setItem('fww-lang', l), lang)
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push('worker: ' + e.message))
    await p.goto(WUI); await p.waitForSelector('[data-testid=login-submit]')
    await p.fill('#pp', S.pp)
    await snap(p, `w-login-${lang}`, [['#pp', 2], ['#pin', 3], ['[data-testid=login-submit]', 4]], 'full')
    await p.click('[data-testid=login-help]'); await p.waitForTimeout(500); await snap(p, `w-login-help-${lang}`, [], 'full'); await p.keyboard.press('Escape')
    await p.goto(WUI); await p.waitForSelector('[data-testid=login-submit]')
    await p.fill('#pp', S.pp); await p.fill('#pin', S.pin); await p.click('[data-testid=login-submit]')
    await p.waitForSelector('[data-testid=worker-name]', { timeout: 30000 }); await p.waitForTimeout(1500)
    await snap(p, `w-home-${lang}`, [['[data-testid=help]', 1]], 'full')
    await p.click('[data-testid=nav-docs]'); await p.waitForTimeout(700)
    await snap(p, `w-docs-${lang}`, [['[data-testid=nav-docs]', 1], ['[data-testid=doc-tile] >> nth=1', 2]], 'full')
    await p.click('[data-testid=nav-new]'); await p.waitForTimeout(600)
    await snap(p, `w-new-${lang}`, [['[data-testid=nav-new]', 1], ['[data-testid=type-leave]', 2]], 'full')
    await p.click('[data-testid=type-leave]'); await p.waitForTimeout(400); await p.click('[data-testid=opt-annual]')
    await p.fill('#from', plus(14)); await p.fill('#to', plus(16)); await p.fill('#reason', lang === 'ta' ? 'கோவில் திருவிழா' : 'Temple festival in my village')
    await snap(p, `w-leave-dates-${lang}`, [['#from', 3], ['#to', 3]], 'full')
    await p.click('[data-testid=wiz-next]'); await p.waitForTimeout(500)
    await snap(p, `w-leave-confirm-${lang}`, [['[data-testid=wiz-send]', 4]], 'full')
    if (lang === 'ta') { await p.click('[data-testid=wiz-send]'); await p.waitForSelector('[data-testid=new-done]', { timeout: 15000 }); await snap(p, 'w-leave-sent-ta', [], 'full') }
    await p.click('[data-testid=nav-home]'); await p.waitForTimeout(400); await p.click('[data-testid=refresh]').catch(() => {}); await p.waitForTimeout(2500)
    await p.click('[data-testid=nav-req]'); await p.waitForTimeout(1200)
    await snap(p, `w-req-${lang}`, [['[data-testid=nav-req]', 1], ['[data-testid=req-row]', 2]], 'full')
    if (await p.locator('[data-testid=req-row]').count()) { await p.click('[data-testid=req-row] >> nth=0'); await p.waitForTimeout(700); await snap(p, `w-req-detail-${lang}`, [['[data-testid=req-cancel]', 4]], 'full'); await p.keyboard.press('Escape'); await p.goto(WUI); await p.waitForSelector('[data-testid=worker-name]'); }
    await p.click('[data-testid=nav-me]'); await p.waitForTimeout(600)
    await snap(p, `w-me-${lang}`, [['[data-testid=nav-me]', 1], ['[data-testid=me-pin]', 2], ['[data-testid=me-lang]', 2]], 'full')
    await p.click('[data-testid=me-help]'); await p.waitForTimeout(600)
    await snap(p, `w-help-faq-${lang}`, [], 'full')
    await p.click('[data-testid=help-row] >> nth=2'); await p.waitForTimeout(300); await snap(p, `w-help-answer-${lang}`, [], 'full')
    await p.click('[data-testid=help-how]'); await p.waitForTimeout(300); await snap(p, `w-help-how-${lang}`, [], 'full')
    await p.click('[data-testid=help-row] >> nth=3'); await p.waitForTimeout(300); await snap(p, `w-help-steps-${lang}`, [], 'full')
    await ctx.close()
  }

  // ================= FW Manager — logged out
  if (want('out')) { const ctx = await ctxFor({ width: 390, height: 780 }, true); const p = await ctx.newPage()
    await p.goto(UI); await p.waitForSelector('#em'); await p.waitForTimeout(800)
    await snap(p, 'login', [['#em', 1], ['#pw', 2], ['form button[type=submit]', 3]], 'full'); await ctx.close() }

  // ================= CEO desktop
  if (want('ceo')) { const { p, ctx } = await login('ceo')
    await go(p, '/', 3500)
    await snap(p, 'dashboard', [['main button:has-text("Total workers")', 1], ['main button:has-text("Expired docs")', 2], ['nav[aria-label=Main]', 3]], 'full')
    await go(p, '/help'); await snap(p, 'help-role-ceo', [], 'full')
    await go(p, '/help/faq'); await snap(p, 'help-faq-ceo', [], 'full')
    await go(p, '/help/manual'); await snap(p, 'help', [['nav >> text=Help', 1], [tab('FAQ'), 2], [btn('Download PDF manual'), 3]], 'full')
    await click(p, '.avatar', 600)
    await snap(p, 'usermenu-signout', [['.avatar', 1], ['.umenu-item:has-text("Switch user")', 2]], 'full')
    await snap(p, 'usermenu-password', [['.avatar', 1], ['.umenu-item:has-text("Change password")', 2]], 'full')
    await snap(p, 'usermenu-demo', [['.avatar', 1], ['text=Show demo data', 2]], 'full')
    await click(p, '.umenu-item:has-text("Change password")', 700)
    await snap(p, 'changepw', [['.modal input >> nth=0', 3]], 'full'); await p.keyboard.press('Escape')
    await go(p, '/settings/about'); await snap(p, 'about', [['text=Download Android app', 1]])
    await go(p, '/workers'); await snap(p, 'workers', [['nav >> text=Workers', 1], ['main input >> nth=0', 2], ['main select >> nth=0', 3], ['main a:has-text("Muthu Kumar")', 4]], 'full')
    await go(p, '/workers/new'); await snap(p, 'worker-add', [['main button:has-text("Take photo")', 2], ['main .wf-stepper li:nth-child(2) button', 3], ['main .wf-stepper li:nth-child(3) button', 4], ['main .wf-stepper li:nth-child(4) button', 5], ['main .wf-stepper li:nth-child(5) button', 6], ['main .wf-stepper li:nth-child(6) button', 7]])
    await go(p, '/workers/hlp-W1', 3000)
    await snap(p, 'worker-edit', [['main button:has-text("Edit")', 2]])
    await snap(p, 'worker-status', [[tab('Check status'), 1], ['main button:has-text("Active-Working")', 2]])
    await snap(p, 'worker-remarks', [[tab('Remarks'), 1]])
    await snap(p, 'worker-passport', [[tab('Passport'), 1]])
    await snap(p, 'worker-expiry', [[tab('Expiry docs'), 2]])
    await click(p, tab('Vault')); await snap(p, 'vault', [[tab('Vault'), 1], [btn('Add / scan'), 2]])
    if (await click(p, btn('Add / scan'))) { await snap(p, 'vault-add', [['.modal button:has-text("Scan page")', 3], ['.modal select >> nth=0', 4]], 'full'); await p.keyboard.press('Escape') }
    await go(p, '/alerts'); await snap(p, 'alerts', [[btn('Critical'), 1], ['main select >> nth=0', 2], ['main a >> nth=0', 3]])
    await go(p, '/requests'); await snap(p, 'requests', [[btn('New request'), 1], [btn('Needs my action'), 2]])
    await go(p, '/requests/new'); await p.locator('main select').nth(1).selectOption({ index: 1 }).catch(() => {}); await p.waitForTimeout(600)
    await snap(p, 'request-new', [['main label:has-text("Request type")', 2], ['main label:has-text("Worker")', 3]])
    await go(p, '/requests/' + S.R.loanGm); await snap(p, 'request-ceo', [[btn('Overrule / amend / recall'), 1]])
    await snap(p, 'request-cancel', [[btn('Cancel request'), 2]])
    await snap(p, 'request-assign', [[btn('Assign…'), 2]])
    if (await click(p, btn('Assign…'), 2500)) {
      await p.selectOption('#as-r', { index: 1 }).catch(() => warn.push('assign: no roles')); await p.waitForTimeout(300)
      await p.selectOption('#as-u', { index: 1 }).catch(() => {}); await p.fill('#as-n', 'Farah is on leave this week — please decide.').catch(() => {})
      await snap(p, 'request-assign-modal', [['#as-r', 3], ['#as-u', 3], ['.modal button:has-text("Assign") >> nth=-1', 4]], 'full'); await p.keyboard.press('Escape') }
    await go(p, '/ceo-review', 3000); await snap(p, 'ceo-review', [[tab('To review'), 1], [btn('Mark reviewed'), 3], [btn('Overrule…'), 4], [btn('Recall'), 6]])
    if (await click(p, btn('Overrule…'), 1200)) { await p.locator('.modal label:has-text("Amend") input').first().check().catch(() => {}); await p.waitForTimeout(300)
      await snap(p, 'ceo-overrule', [['.modal fieldset', 4], ['.modal label:has-text("keep it moving")', 5], ['#ceo-why', 4]], 'full'); await p.keyboard.press('Escape') }
    await go(p, '/compliance'); await snap(p, 'compliance', [[tab('Outlet risk'), 2], [tab('Hostels'), 3], [tab('Hiring'), 4], [tab('PDPA'), 5]])
    await go(p, '/reports'); await snap(p, 'reports', [[tab('Report library'), 1], ['main button:has-text("Document expiry report")', 2]])
    await click(p, tab('Required submissions'), 1500); await snap(p, 'submissions', [[tab('Required submissions'), 1]])
    await go(p, '/settings/users', 3000)
    await snap(p, 'users', [[btn('Add user'), 1]])
    await snap(p, 'users-manage', [[btn('Reset password'), 2], [btn('Pause'), 3], [btn('Delete'), 5]])
    await snap(p, 'users-approve', [[btn('Approve'), 2]])
    await snap(p, 'users-gm', [['main h2:has-text("General Manager powers"), main h3:has-text("General Manager powers")', 1]])
    await snap(p, 'users-hra', [['main h2:has-text("HR Admin permissions"), main h3:has-text("HR Admin permissions")', 3]])
    await go(p, '/settings'); await snap(p, 'settings', [[tab('Account'), 1], [tab('Users & Access'), 2], [tab('Agencies'), 3], [tab('Requests & Approvals'), 4], [tab('Notifications'), 5], [tab('Data & Backup'), 6]])
    await go(p, '/settings/notifications'); await snap(p, 'notifications', [[tab('Notifications'), 1], [btn('Enable notifications'), 2]])
    await go(p, '/settings/data'); await snap(p, 'backup', [[tab('Data & Backup'), 1], [btn('Download backup (JSON)'), 3], [btn('Restore / import backup'), 4], [btn('Sync now'), 4]])
    await go(p, '/control', 3500); await snap(p, 'control', [[tab('Control Center'), 2], [tab('Errors'), 3], [tab('Know-how'), 4]])
    await ctx.close() }
  if (want('ceo')) { const { p, ctx } = await login('ceo', { width: 390, height: 780 }, true)
    await go(p, '/', 3500); await snap(p, 'dashboard-phone', [], 'full')
    await go(p, '/more'); await snap(p, 'more-phone', [['main a:has-text("Help"), main button:has-text("Help")', 1]], 'full')
    await go(p, '/help'); await snap(p, 'help-phone-ceo', [], 'full'); await ctx.close() }

  // ================= Outlet manager: decide the worker's leave
  if (want('om')) { const { p, ctx } = await login('om')
    await go(p, '/help'); await snap(p, 'help-role-om', [], 'full')
    await go(p, '/help/manual'); await snap(p, 'help-manual-om', [], 'full')
    await go(p, '/requests', 3000)
    const row = p.locator('main a:has-text("Muthu Kumar"):has-text("Annual leave")').first()
    if (await row.count()) { await snap(p, 'request-om-list', [[btn('Needs my action'), 1], ['main a:has-text("Muthu Kumar"):has-text("Annual leave")', 1]]); await row.click(); await p.waitForTimeout(2500)
      await snap(p, 'request-om', [['main :text("Raised by worker (app)")', 1], ['main :text("Reason / details")', 2], [btn('Approve → send to HR'), 3], [btn('Reject'), 3]]) } else warn.push('OM: worker request not found')
    await ctx.close() }
  if (want('om')) { const { p, ctx } = await login('om', { width: 390, height: 780 }, true)
    await go(p, '/help'); await snap(p, 'help-phone-om', [], 'full'); await go(p, '/help/faq'); await snap(p, 'help-faq-phone-om', [], 'full'); await ctx.close() }

  // ================= HR manager: decide, apply, App access
  if (want('hrm')) { const { p, ctx } = await login('hrm')
    await go(p, '/requests', 3000); await snap(p, 'requests-hrm', [[btn('Needs my action'), 1]])
    await go(p, '/requests/' + S.R.leaveHrm); await snap(p, 'request-detail', [['main h2:has-text("Timeline"), main h3:has-text("Timeline")', 2], [btn('Recommend & send up'), 3], [btn('Return for info'), 3], [btn('Reject'), 3]])
    await go(p, '/requests/' + S.R.loanDone); await snap(p, 'request-apply', [[btn('Apply to worker record'), 2]])
    await go(p, '/workers/hlp-W2', 3000); await click(p, tab('App access'), 1500); await snap(p, 'app-access', [[tab('App access'), 1], [btn('Generate PIN'), 2]])
    await go(p, '/workers/hlp-W1', 3000); await click(p, tab('App access'), 1500); await snap(p, 'app-access-manage', [[btn('Reset PIN'), 2], [btn('Revoke'), 4]])
    await go(p, '/help'); await snap(p, 'help-role-hrm', [], 'full')
    await ctx.close() }
  for (const r of want('other') ? ['gm', 'hra'] : []) { const { p, ctx } = await login(r); await go(p, '/help'); await snap(p, 'help-role-' + r, [], 'full'); await go(p, '/'); await snap(p, 'dashboard-' + r, [], 'full'); await ctx.close() }
} catch (e) { console.log('FAIL', e.stack) }
await browser.close()
const prev = ONLY.length && fs.existsSync(OUT + 'index.json') ? JSON.parse(fs.readFileSync(OUT + 'index.json', 'utf8')).made : []
fs.writeFileSync(OUT + 'index.json', JSON.stringify({ made: [...new Set([...prev, ...made])], warn, errs, at: new Date().toISOString() }, null, 1))
console.log('warnings:\n ' + warn.join('\n ')); console.log('page errors:', errs.length ? errs.join(' | ') : 'none')
if (!KEEP) { await cleanup(); console.log('TEST data cleaned up') }
