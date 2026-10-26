// v1.4 DataTable + IconAction UI test on TEST only.
// Usage: UI_URL=<TEST build> PW_PKG=<playwright package.json> node tests/table-ui.mjs
// Checks: expand / collapse (aria-expanded), sort cycle (aria-sort), search, tooltip on hover and on long-press,
// aria-label + title on every icon action, destructive confirm (dismiss = nothing happens), phone layout (no sideways scroll).
import fs from 'node:fs'
import { createRequire } from 'node:module'
const ROOT = new URL('..', import.meta.url).pathname
const require = createRequire(ROOT + 'package.json')
const { createClient } = require('@supabase/supabase-js')
const { chromium } = createRequire(process.env.PW_PKG || ROOT + 'package.json')('playwright')
const env = Object.fromEntries(fs.readFileSync(ROOT + '.secrets.env', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const URL_ = env.TEST_SUPABASE_URL, UI = process.env.UI_URL
if (!UI || !URL_ || URL_.includes('gnepquxtwkyffjmoydnv') || !URL_.includes(env.TEST_PROJECT_REF)) { console.error('ABORT: TEST only'); process.exit(1) }
const admin = createClient(URL_, env.TEST_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const stamp = Date.now(), pw = 'Tbl-' + stamp + '-x!'
let pass = 0, failN = 0
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log('  ✓', name) } else { failN++; console.log('  ✗', name, extra) } }
const made = []
const mk = async (tag, name, patch) => {
  const email = `fwm-tbl-${tag}-${stamp}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: name } })
  if (error) throw error
  made.push(data.user.id)
  if (patch) await admin.from('profiles').update({ full_name: name, ...patch }).eq('id', data.user.id)
  return { id: data.user.id, email, name }
}
const login = async (p, u) => {
  await p.goto(UI); await p.fill('#em', u.email); await p.fill('#pw', pw); await p.locator('form button[type=submit]').first().click()
  await p.waitForTimeout(5000)
}
try {
  const ceo = await mk('ceo', 'Tbl CEO', { role: 'super_admin', status: 'active' })
  const pend = await mk('pend', `Tbl Pending ${stamp}`)
  const users = []
  for (let i = 0; i < 8; i++) users.push(await mk('u' + i, `Tbl ${String.fromCharCode(65 + i)}user ${stamp}`, { role: 'outlet_manager', status: 'active' }))
  const browser = await chromium.launch()

  console.log('desktop 1440')
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const p = await ctx.newPage()
    await login(p, ceo)
    await p.goto(UI + '#/settings/users'); await p.waitForTimeout(4000)
    const wrap = p.locator('.dt', { has: p.locator('table[aria-label="Users"]') })
    const row = p.getByTestId(`user-${users[0].email}`)
    check('user row rendered', await row.count() === 1)
    const xbtn = row.locator('.dt-xbtn')
    check('row starts collapsed', (await xbtn.getAttribute('aria-expanded')) === 'false')
    await row.locator('td').first().click(); await p.waitForTimeout(300)
    check('click expands (aria-expanded=true)', (await xbtn.getAttribute('aria-expanded')) === 'true')
    const detail = row.locator('xpath=following-sibling::tr[1]')
    check('details row visible', await detail.isVisible())
    await xbtn.click(); await p.waitForTimeout(300)
    check('chevron collapses', (await xbtn.getAttribute('aria-expanded')) === 'false' && !(await detail.isVisible()))
    await row.locator('td').first().focus().catch(() => {})
    // sort cycle on the first sortable column
    const ths = wrap.locator('table[aria-label="Users"] thead th')
    const idx = await ths.evaluateAll((els) => els.findIndex((e) => !e.hasAttribute('aria-sort') && e.querySelector('button.dt-sort')))
    const th = ths.nth(idx)
    const sb = th.locator('button.dt-sort')
    const s0 = await th.getAttribute('aria-sort')
    await sb.click(); const s1 = await th.getAttribute('aria-sort')
    await sb.click(); const s2 = await th.getAttribute('aria-sort')
    await sb.click(); const s3 = await th.getAttribute('aria-sort')
    check('sort cycles ascending → descending → off', s0 === null && s1 === 'ascending' && s2 === 'descending' && s3 === null, [s0, s1, s2, s3].join(','))
    // search
    const search = wrap.locator('input[type=search]')
    check('search box shown on a long list', await search.count() === 1)
    await search.fill(users[1].name); await p.waitForTimeout(300)
    check('search keeps the match', await p.getByTestId(`user-${users[1].email}`).isVisible())
    check('search hides the others', await p.getByTestId(`user-${users[0].email}`).count() === 0)
    await search.fill(''); await p.waitForTimeout(300)
    // tooltip on hover
    const ia = row.locator('td.dt-act .ia').first()
    const lbl = await ia.getAttribute('aria-label')
    await ia.hover(); await p.waitForTimeout(600)
    const tip = p.locator('[role=tooltip]')
    check('tooltip appears on hover', await tip.isVisible() && (await tip.textContent()) === lbl, lbl)
    check('tooltip linked by aria-describedby', (await ia.getAttribute('aria-describedby')) === (await tip.getAttribute('id')))
    await p.mouse.move(1, 1); await p.waitForTimeout(300)
    check('tooltip hides on mouse out', await tip.count() === 0 || !(await tip.isVisible()))
    // every icon action is named
    const named = await p.locator('.ia').evaluateAll((els) => els.every((e) => (e.getAttribute('aria-label') || '').trim() && (e.getAttribute('title') || '').trim()))
    check('every icon action has aria-label and title', named)
    const danger = await p.locator('.ia[data-action=delete], .ia[data-action=reject], .ia[data-action=revoke]').evaluateAll((els) => els.length > 0 && els.every((e) => e.classList.contains('ia-danger')))
    check('destructive icons are tinted red', danger)
    // destructive confirm: dismiss → nothing happens
    const prow = p.getByTestId(`pending-${pend.email}`)
    check('pending sign-up row rendered', await prow.count() === 1)
    let dlg = null
    p.once('dialog', async (d) => { dlg = { type: d.type(), msg: d.message() }; await d.dismiss() })
    await prow.locator('td.dt-act .ia[data-action=delete]').click(); await p.waitForTimeout(800)
    check('delete asks for confirmation', dlg?.type === 'confirm' && /Delete the sign-up/.test(dlg.msg))
    const still = await admin.from('profiles').select('id').eq('id', pend.id).maybeSingle()
    check('cancelled delete changes nothing', !!still.data && await prow.count() === 1)
    await ctx.close()
  }

  console.log('phone 390 (touch)')
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const p = await ctx.newPage()
    await login(p, ceo)
    await p.goto(UI + '#/settings/users'); await p.waitForTimeout(4000)
    const sideways = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check('no sideways scroll on phone', sideways <= 1, String(sideways))
    const row = p.getByTestId(`user-${users[2].email}`)
    check('action column hidden on phone', !(await row.locator('td.dt-act').isVisible()))
    await row.locator('td').first().tap(); await p.waitForTimeout(400)
    check('tap expands', (await row.locator('.dt-xbtn').getAttribute('aria-expanded')) === 'true')
    const ia = row.locator('xpath=following-sibling::tr[1]').locator('.dt-x-act .ia').first()
    check('actions shown inside the expanded row', await ia.isVisible())
    const lbl = await ia.getAttribute('aria-label')
    check('expanded-row actions show their words on phone', ((await ia.innerText()) || '').trim() === lbl, lbl)
    await ctx.close()
  }

  console.log('iPad landscape 1366 (touch)')
  {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 1024 }, hasTouch: true })
    const p = await ctx.newPage()
    await login(p, ceo)
    await p.goto(UI + '#/settings/users'); await p.waitForTimeout(4000)
    const row = p.getByTestId(`user-${users[3].email}`)
    const ia = row.locator('td.dt-act .ia').first()
    check('icon actions in the row on iPad', await ia.isVisible())
    const lbl = await ia.getAttribute('aria-label')
    await ia.scrollIntoViewIfNeeded()
    const box = await ia.boundingBox()
    const cdp = await ctx.newCDPSession(p)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] })
    await p.waitForTimeout(700)
    const tip = p.locator('[role=tooltip]')
    const tipTxt = await tip.count() ? await tip.textContent() : null
    check('long-press shows the tooltip', await tip.isVisible().catch(() => false) && tipTxt === lbl, `${lbl} / ${tipTxt}`)
    let acted = false
    p.once('dialog', async (d) => { acted = true; await d.dismiss() })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await p.waitForTimeout(600)
    check('long-press only names the button (no action)', !acted && await p.locator('[role=dialog]').count() === 0)
    await ctx.close()
  }
  await browser.close()
} finally {
  for (const id of made) await admin.auth.admin.deleteUser(id).catch(() => {})
}
console.log(`\n${pass} passed, ${failN} failed`)
process.exit(failN ? 1 : 0)
