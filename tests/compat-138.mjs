// v1.3.8 compatibility on TEST: load the CURRENT LIVE client (origin/main build, UI_URL) as every staff role against the
// TEST database WITH migration 034, and fail on any 4xx/5xx from the REST API, any page error, or a missing dashboard.
// Own fwx-* users only; removed at the end.
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { rid, cleanupOwn } from './_own.mjs'
const LBL = process.env.LABEL || 'v1.3.8'
const ROOT = new URL('..', import.meta.url).pathname
const require = createRequire(ROOT + 'package.json')
const { createClient } = require('@supabase/supabase-js')
const { chromium } = createRequire(process.env.PW_PKG || ROOT + 'package.json')('playwright')
const env = Object.fromEntries(fs.readFileSync(ROOT + '.secrets.env', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const URL_ = env.TEST_SUPABASE_URL, UI = process.env.UI_URL, OUT = process.env.OUT || '/workspace/screens-hier/'
if (!URL_ || URL_.includes('gnepquxtwkyffjmoydnv') || !URL_.includes(env.TEST_PROJECT_REF)) { console.error('ABORT'); process.exit(1) }
const admin = createClient(URL_, env.TEST_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const PFX = 'fwx-', stamp = Date.now(), pw = 'Cx-' + stamp + '-x!', OID = rid('XO1')
let pass = 0, fail = 0
const check = (n, ok, x = '') => { ok ? pass++ : fail++; console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : String(x).slice(0, 400)) }
const U = {}
const mk = async (k, name, role, extra = {}) => {
  const email = `${PFX}${k}-${stamp}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: name } })
  if (error) throw error
  await admin.from('profiles').update({ full_name: name, role, status: 'active', company_ids: [], outlet_ids: [], ...extra }).eq('id', data.user.id)
  U[k] = { id: data.user.id, email }
}
try {
  await admin.from('records').upsert({ entity: 'outlets', id: OID, deleted: false, client_ts: new Date().toISOString(), data: { id: OID, name: 'CX Outlet', type: 'Restaurant', companyId: 'main' } })
  await mk('ceo', 'CX Chief', 'super_admin'); await mk('gm', 'CX GM', 'general_manager'); await mk('hra', 'CX HRA', 'hr_admin')
  await mk('hrm', 'CX HRM', 'hr_manager'); await mk('om', 'CX OM', 'outlet_manager', { outlet_ids: [OID] }); await mk('view', 'CX Viewer', 'viewer', { company_ids: ['main'] })
  const browser = await chromium.launch()
  for (const k of ['ceo', 'gm', 'hra', 'hrm', 'om', 'view']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } }); const p = await ctx.newPage()
    const bad = [], errs = []
    p.on('response', (r) => { if (r.url().includes('/rest/v1/') && r.status() >= 400) bad.push(r.status() + ' ' + r.url().split('/rest/v1/')[1].split('?')[0]) })
    p.on('pageerror', (e) => errs.push(e.message))
    await p.goto(UI); await p.fill('#em', U[k].email); await p.fill('#pw', pw); await p.locator('form button[type=submit]').first().click()
    await p.waitForTimeout(7000)
    const dash = await p.locator('body').innerText()
    check(`${LBL} ${k}: signs in and sees the dashboard (not locked out)`, !(await p.locator('#em').isVisible().catch(() => false)) && /Good (morning|afternoon|evening)/.test(dash), dash.slice(0, 300))
    for (const path of ['#/requests', '#/workers', '#/settings/users']) { await p.goto(UI + path); await p.waitForTimeout(3000) }
    if (k === 'gm' || k === 'hra') {
      const t = await p.locator('body').innerText()
      check(`${LBL} ${k}: Users list has no superior rows (rows hidden by 034 even on the old app)`, !t.includes('CX Chief') && (k === 'gm' || !t.includes('CX GM')), t.slice(0, 300))
    }
    await p.goto(UI + '#/'); await p.waitForTimeout(2000)
    if (k === 'om') await p.screenshot({ path: OUT + LBL.replace(/[^0-9a-z]/gi, '') + '-om-dashboard.png' })
    check(`${LBL} ${k}: no REST errors (403 etc.) on dashboard / requests / workers / users`, bad.length === 0, bad.join(', '))
    check(`${LBL} ${k}: no page errors`, errs.length === 0, errs.join(' | '))
    await ctx.close()
  }
  await browser.close()
} catch (e) { fail++; console.error('ERROR', e) }
finally { console.log('cleanup', await cleanupOwn(admin, PFX)) }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
