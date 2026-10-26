// v1.4 table / icon-action screenshots on TEST (phone, iPad, desktop). Usage: UI_URL=<TEST build> ROUTES=users,workers node tests/table-shots.mjs
import fs from 'node:fs'
import { createRequire } from 'node:module'
const ROOT = new URL('..', import.meta.url).pathname
const require = createRequire(ROOT + 'package.json')
const { createClient } = require('@supabase/supabase-js')
const { chromium, devices } = createRequire(process.env.PW_PKG || ROOT + 'package.json')('playwright')
const env = Object.fromEntries(fs.readFileSync(ROOT + '.secrets.env', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const URL_ = env.TEST_SUPABASE_URL, UI = process.env.UI_URL, OUT = process.env.OUT || '/workspace/screens-tables/'
if (!URL_ || URL_.includes('gnepquxtwkyffjmoydnv') || !URL_.includes(env.TEST_PROJECT_REF)) { console.error('ABORT'); process.exit(1) }
const admin = createClient(URL_, env.TEST_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const stamp = Date.now(), pw = 'Shot-' + stamp + '-x!'
const mk = async (tag, name, patch) => {
  const email = `fwm-shot-${tag}-${stamp}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: name } })
  if (error) throw error
  if (patch) await admin.from('profiles').update({ full_name: name, ...patch }).eq('id', data.user.id)
  return { id: data.user.id, email }
}
const made = []
const ROUTES = (process.env.ROUTES || 'users').split(',')
const PATHS = { users: '#/settings/users', workers: '#/workers', requests: '#/requests', errors: '#/control/errors', audit: '#/settings/users', compliance: '#/compliance', complaints: '#/compliance?tab=grievances', companies: '#/settings/org', pay: '#/settings/pay', reports: '#/reports?tab=subs', ceo: '#/ceo-review', documents: '#/documents', translations: '#/settings/passport', inbox: '#/inbox', dashboard: '#/' }
const VIEWS = [
  ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }],
  ['ipad', { viewport: { width: 1024, height: 1366 }, hasTouch: true, deviceScaleFactor: 1 }],
  ['desktop', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }],
]
try {
  const ceo = await mk('ceo', 'Shot CEO', { role: 'super_admin', status: 'active' }); made.push(ceo)
  if (ROUTES.includes('users')) {
    made.push(await mk('p1', 'Aisyah Pending'), await mk('p2', 'Ravi Pending'))
    made.push(await mk('om', 'Lim Outlet Mgr', { role: 'outlet_manager', status: 'active' }))
    made.push(await mk('hr', 'Siti HR Admin', { role: 'hr_admin', status: 'paused', pause_reason: 'On leave' }))
  }
  const browser = await chromium.launch()
  for (const [vn, opt] of VIEWS) {
    const ctx = await browser.newContext(opt)
    const p = await ctx.newPage()
    await p.goto(UI); await p.fill('#em', ceo.email); await p.fill('#pw', pw); await p.locator('form button[type=submit]').first().click()
    await p.waitForTimeout(6000)
    let wid = null
    for (const r of ROUTES) {
      if (r.startsWith('w-') && !wid) {
        await p.goto(UI + '#/workers'); await p.waitForTimeout(3500)
        const href = await p.locator('a[href*="#/workers/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')).find((h) => /#\/workers\/[^/?]+$/.test(h) && !h.endsWith('/new')))
        wid = href ? href.split('#/workers/')[1] : null
      }
      const path = r.startsWith('w-') ? `#/workers/${wid}?tab=${r.slice(2)}` : PATHS[r]
      await p.goto(UI + path); await p.waitForTimeout(3500)
      if (r === 'audit') await p.locator('h2, h3', { hasText: 'Audit log' }).first().scrollIntoViewIfNeeded().catch(() => {})
      if (r === 'audit') { const show = p.getByRole('button', { name: 'Show', exact: true }).first(); if (await show.count()) { await show.click(); await p.waitForTimeout(3000) } }
      await p.screenshot({ path: `${OUT}${r}-${vn}.png`, fullPage: true })
      const row = r === 'audit' ? p.locator('table[aria-label*="udit"] tr.dt-click').first() : p.locator('tr.dt-click').first()
      if (await row.count()) {
        await row.locator('td').first().click(); await p.waitForTimeout(600)
        await row.scrollIntoViewIfNeeded()
        await p.screenshot({ path: `${OUT}${r}-${vn}-expanded.png`, fullPage: false })
      }
      const ia = (await p.locator('.dt-act .ia:visible').count()) ? p.locator('.dt-act .ia:visible').first() : p.locator('.ia:visible').first()
      if (await ia.count()) {
        await ia.scrollIntoViewIfNeeded()
        if (opt.hasTouch) { await ia.dispatchEvent('touchstart'); await p.waitForTimeout(650); await ia.dispatchEvent('touchend') }
        else { await ia.hover(); await p.waitForTimeout(500) }
        await p.screenshot({ path: `${OUT}${r}-${vn}-tooltip.png` })
        await p.mouse.move(1, 1)
      }
      console.log('shot', r, vn)
    }
    await ctx.close()
  }
  await browser.close()
} finally {
  for (const u of made) await admin.auth.admin.deleteUser(u.id).catch(() => {})
}
