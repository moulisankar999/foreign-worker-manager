// v1.3.3 UI e2e on TEST: Assign button, "Assigned to" header, timeline wording, GM/CEO/HR visibility, CEO amend (keep moving).
import fs from 'node:fs'
import { createRequire } from 'node:module'
const ROOT = new URL('..', import.meta.url).pathname
const require = createRequire(ROOT + 'package.json')
const { createClient } = require('@supabase/supabase-js')
const { chromium } = createRequire(process.env.PW_PKG || ROOT + 'package.json')('playwright')
const env = Object.fromEntries(fs.readFileSync(ROOT + '.secrets.env', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const URL_ = env.TEST_SUPABASE_URL, UI = process.env.UI_URL
if (!URL_ || URL_.includes('gnepquxtwkyffjmoydnv') || !URL_.includes(env.TEST_PROJECT_REF)) { console.error('ABORT'); process.exit(1) }
const admin = createClient(URL_, env.TEST_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
let pass = 0, fail = 0
const check = (n, ok, info = '') => { if (ok) { pass++; console.log('PASS', n) } else { fail++; console.log('FAIL', n, String(info).slice(0, 500)) } }
const stamp = Date.now(), pw = 'Asg-' + stamp + '-x!'
const users = {}
for (const [k, role, name] of [['ceo', 'super_admin', 'UI CEO'], ['gm', 'general_manager', 'UI GM'], ['hra', 'hr_admin', 'UI HRA'], ['hrm', 'hr_manager', 'UI HRM']]) {
  const email = `fwm-asgui-${k}-${stamp}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: name } })
  if (error) throw error
  await admin.from('profiles').update({ role, status: 'active', full_name: name }).eq('id', data.user.id)
  users[k] = { id: data.user.id, email, name }
}
const ids = Object.values(users).map((u) => u.id)
let reqId = null
const browser = await chromium.launch()
const login = async (u) => {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 1400 } }); const p = await ctx.newPage()
  await p.goto(UI); await p.fill('#em', u.email); await p.fill('#pw', pw); await p.locator('form button[type=submit]').first().click()
  await p.waitForTimeout(6000)
  return { ctx, p }
}
const openReq = async (p) => { await p.goto(UI + '#/requests/' + reqId); await p.waitForTimeout(4000) }
try {
  // the HR Manager raises a request (normal chain starts at the HR Manager step)
  const c = createClient(URL_, env.TEST_ANON_KEY, { auth: { persistSession: false } })
  await c.auth.signInWithPassword({ email: users.hrm.email, password: pw })
  const { data: r, error } = await c.rpc('request_create', { p_type: 'annual_leave', p_worker_id: 'wu-w-mvlwluod', p_title: 'UI assign test', p_data: { from: '2026-12-01', to: '2026-12-03', reason: 'UI assign test' }, p_amount: null, p_priority: 'normal' })
  if (error) throw error
  reqId = r.id
  check('setup: request created at the HR Manager step', r.status === 'submitted', r.status)

  // CEO: Assign → GM
  const ceo = await login(users.ceo); await openReq(ceo.p)
  const btn = ceo.p.getByRole('button', { name: 'Assign…' })
  check('CEO sees the Assign button in Actions', await btn.count() === 1)
  await btn.click(); await ceo.p.waitForTimeout(2500)
  const roleOpts = await ceo.p.locator('#as-r option').allTextContents()
  check('picker lists roles in scope (no requester shown as a person)', roleOpts.includes('General Manager') && roleOpts.includes('HR Admin'), roleOpts)
  await ceo.p.selectOption('#as-r', 'general_manager'); await ceo.p.selectOption('#as-u', users.gm.id); await ceo.p.fill('#as-n', 'Please decide this one')
  await ceo.p.locator('.modal').getByRole('button', { name: 'Assign', exact: true }).click(); await ceo.p.waitForTimeout(4000)
  let body = await ceo.p.locator('body').innerText()
  check('header: "Assigned to: UI GM (GM)"', body.includes('Assigned to: UI GM (GM)'), body.slice(0, 600))
  check('timeline: "Assigned by CEO (UI CEO) → GM: UI GM, <date time>" + note', /Assigned by CEO \(UI CEO\) → GM: UI GM, \d{1,2} [A-Z][a-z]{2} \d\d:\d\d/.test(body) && body.includes('Please decide this one'))
  check('timeline: skipped steps', body.includes('HR Manager step skipped by CEO (UI CEO)') && body.includes('HR Admin step skipped by CEO (UI CEO)'))
  await ceo.p.screenshot({ path: '/tmp/asg-ceo.png', fullPage: true })

  // GM: sees it assigned to him, reassigns to the HR Admin
  const gm = await login(users.gm); await openReq(gm.p)
  body = await gm.p.locator('body').innerText()
  check('GM sees "Assigned to: UI GM (GM)" and the Assign button', body.includes('Assigned to: UI GM (GM)') && await gm.p.getByRole('button', { name: 'Assign…' }).count() === 1)
  await gm.p.getByRole('button', { name: 'Assign…' }).click(); await gm.p.waitForTimeout(2500)
  await gm.p.selectOption('#as-r', 'hr_admin'); await gm.p.selectOption('#as-u', users.hra.id); await gm.p.fill('#as-n', 'HRA check balance')
  await gm.p.locator('.modal').getByRole('button', { name: 'Assign', exact: true }).click(); await gm.p.waitForTimeout(4000)
  body = await gm.p.locator('body').innerText()
  check('timeline: "Assigned by GM (UI GM) → HR Admin: UI HRA"', body.includes('Assigned by GM (UI GM) → HR Admin: UI HRA') && body.includes('Assigned to: UI HRA (HR Admin)'))
  const { data: rev } = await admin.from('ceo_reviews').select('reason').eq('request_id', reqId)
  check('CEO review list gets "GM assigned"', (rev || []).some((x) => x.reason === 'gm_assigned'), JSON.stringify(rev))
  const { data: nev } = await admin.from('notification_events').select('id,event').eq('request_id', reqId)
  const evIds = (nev || []).map((x) => x.id)
  const { data: dl } = await admin.from('notification_deliveries').select('event,user_id,channel').in('event_id', evIds.length ? evIds : ['00000000-0000-0000-0000-000000000000'])
  check('notified: GM (assigned), HRA (assigned), CEO (GM assigned) in-app + push', ['gm', 'hra'].every((k) => (dl || []).some((d) => d.event === 'request_assigned' && d.user_id === users[k].id && d.channel === 'push'))
    && (dl || []).some((d) => d.event === 'gm_assigned' && d.user_id === users.ceo.id && d.channel === 'in_app'), JSON.stringify(dl))
  await gm.ctx.close()

  // HR Admin (the assignee): no Assign button, can decide
  const hra = await login(users.hra); await openReq(hra.p)
  body = await hra.p.locator('body').innerText()
  check('HR Admin: no Assign button; decision buttons shown', await hra.p.getByRole('button', { name: 'Assign…' }).count() === 0 && /Approve|Recommend & send up/.test(body))
  await hra.ctx.close()
  // HR Manager (requester): no Assign button, told who has it
  const hrm = await login(users.hrm); await openReq(hrm.p)
  body = await hrm.p.locator('body').innerText()
  check('HR Manager: no Assign button; sees "Assigned to: UI HRA (HR Admin)"', await hrm.p.getByRole('button', { name: 'Assign…' }).count() === 0 && body.includes('Assigned to: UI HRA (HR Admin)'))
  await hrm.ctx.close()

  // CEO: amend, keep it moving
  await openReq(ceo.p)
  await ceo.p.getByRole('button', { name: /Overrule \/ amend/ }).click(); await ceo.p.waitForTimeout(1500)
  await ceo.p.getByRole('radio', { name: /^Amend/ }).check()
  await ceo.p.waitForTimeout(500)
  check('amend: "keep it moving" option ticked by default', await ceo.p.getByRole('checkbox', { name: /keep it/ }).isChecked())
  const reasonField = ceo.p.locator('#am-reason')
  await reasonField.fill('Changed by CEO in UI test')
  await ceo.p.fill('#ceo-why', 'Clarified reason')
  await ceo.p.locator('.modal').getByRole('button', { name: 'Save changes' }).click(); await ceo.p.waitForTimeout(4000)
  body = await ceo.p.locator('body').innerText()
  const { data: rr } = await admin.from('requests').select('status,ceo_locked,data').eq('id', reqId).single()
  check('amend kept it moving (still with HR Admin, not locked) and shows the original', rr.status === 'recommended' && !rr.ceo_locked && /Amended by CEO \(UI CEO\)/.test(body) && body.includes('UI assign test → Changed by CEO in UI test'), JSON.stringify(rr) + body.slice(-900))
  await ceo.p.screenshot({ path: '/tmp/asg-ceo2.png', fullPage: true })
  await ceo.ctx.close()
} finally {
  await browser.close()
  if (reqId) {
    const { data: nev } = await admin.from('notification_events').select('id').eq('request_id', reqId)
    if (nev?.length) { await admin.from('notification_deliveries').delete().in('event_id', nev.map((x) => x.id)); await admin.from('notification_events').delete().in('id', nev.map((x) => x.id)) }
    await admin.from('ceo_reviews').delete().eq('request_id', reqId)
    await admin.from('request_events').delete().eq('request_id', reqId)
    const { error } = await admin.from('requests').delete().eq('id', reqId); if (error) console.log('cleanup request:', error.message)
  }
  await admin.from('notification_deliveries').delete().in('user_id', ids)
  for (const id of ids) { await admin.from('profiles').delete().eq('id', id); await admin.auth.admin.deleteUser(id).catch(() => {}) }
}
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
