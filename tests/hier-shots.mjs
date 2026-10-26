// Hierarchy visibility screenshots on TEST: GM → Users, HR Admin → Users, Outlet Manager → dashboard.
// Usage: UI_URL=<TEST build> OUT=/workspace/screens-hier/ node tests/hier-shots.mjs   (own fwv-* users only; removed at the end)
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { rid, cleanupOwn } from './_own.mjs'
const ROOT = new URL('..', import.meta.url).pathname
const require = createRequire(ROOT + 'package.json')
const { createClient } = require('@supabase/supabase-js')
const { chromium } = createRequire(process.env.PW_PKG || ROOT + 'package.json')('playwright')
const env = Object.fromEntries(fs.readFileSync(ROOT + '.secrets.env', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const URL_ = env.TEST_SUPABASE_URL, UI = process.env.UI_URL, OUT = process.env.OUT || '/workspace/screens-hier/'
if (!URL_ || URL_.includes('gnepquxtwkyffjmoydnv') || !URL_.includes(env.TEST_PROJECT_REF)) { console.error('ABORT'); process.exit(1) }
fs.mkdirSync(OUT, { recursive: true })
const admin = createClient(URL_, env.TEST_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const PFX = 'fwv-', stamp = Date.now(), pw = 'Hv-' + stamp + '-x!', OID = rid('HO1')
const U = {}
const mk = async (k, name, role, extra = {}) => {
  const email = `${PFX}${k}-${stamp}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: name } })
  if (error) throw error
  await admin.from('profiles').update({ full_name: name, role, status: 'active', company_ids: [], outlet_ids: [], ...extra }).eq('id', data.user.id)
  U[k] = { id: data.user.id, email }
}
let ok = true
try {
  await admin.from('records').upsert({ entity: 'outlets', id: OID, deleted: false, client_ts: new Date().toISOString(), data: { id: OID, name: 'HV Outlet One', type: 'Restaurant', companyId: 'main' } })
  await mk('ceo', 'HV Chief Exec', 'super_admin'); await mk('gm', 'HV General Mgr', 'general_manager'); await mk('hra', 'HV HR Admin', 'hr_admin')
  await mk('hrm', 'HV HR Manager', 'hr_manager'); await mk('om', 'HV Outlet Mgr', 'outlet_manager', { outlet_ids: [OID] }); await mk('view', 'HV Viewer', 'viewer', { company_ids: ['main'] })
  const browser = await chromium.launch()
  const shot = async (who, path, file, check) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage()
    await p.goto(UI); await p.fill('#em', U[who].email); await p.fill('#pw', pw); await p.locator('form button[type=submit]').first().click()
    await p.waitForTimeout(6000); await p.goto(UI + path); await p.waitForTimeout(4500)
    await p.screenshot({ path: OUT + file, fullPage: true })
    const txt = await p.locator('body').innerText()
    const r = check(txt); ok = ok && r.ok; console.log(r.ok ? 'PASS' : 'FAIL', file, r.msg)
    await ctx.close()
  }
  const has = (t, s) => t.includes(s)
  await shot('gm', '#/settings/users', 'gm-users.png', (t) => ({ ok: !has(t, 'HV Chief Exec') && has(t, 'HV HR Admin') && has(t, 'HV Outlet Mgr'), msg: 'GM: no CEO row; HR Admin / OM rows listed' }))
  await shot('hra', '#/settings/users', 'hra-users.png', (t) => ({ ok: !has(t, 'HV Chief Exec') && !has(t, 'HV General Mgr') && has(t, 'HV HR Manager'), msg: 'HR Admin: no CEO / GM rows; HR Manager listed' }))
  await shot('om', '#/', 'om-dashboard.png', (t) => ({ ok: !['HV Chief Exec', 'HV General Mgr', 'HV HR Admin', 'HV HR Manager'].some((n) => has(t, n)), msg: 'OM dashboard: no superior names' }))
  await browser.close()
} catch (e) { ok = false; console.error('ERROR', e) }
finally { console.log('cleanup', await cleanupOwn(admin, PFX)) }
process.exit(ok ? 0 : 1)
