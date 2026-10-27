// 1.6.2: every outlet must have a company (migration 054). Server: push_records / direct writes refuse a missing, empty or
// unknown company; keeping or moving to a real company works; deleting still works. UI: Add outlet has no default company and
// shows an inline error until one is chosen; the saved outlet carries the chosen company.
// SAFETY: TEST project only (refuses live). Creates fwm162-*@example.com users and *-<run> records and removes only those.
// Needs a staff TEST build at UI_URL. Never prints secrets.
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { RUN, rid, cleanupOwn } from './_own.mjs'
const require = createRequire(new URL('../package.json', import.meta.url))
const { createClient } = require('@supabase/supabase-js')
const { chromium } = createRequire((process.env.PLAYWRIGHT_PATH || '/workspace/tools/pw') + '/package.json')('playwright')
const LIVE_REF = 'gnepquxtwkyffjmoydnv'
const env = Object.fromEntries(fs.readFileSync(new URL('../.secrets.env', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const URL_ = env.TEST_SUPABASE_URL, REF = env.TEST_PROJECT_REF
if (!URL_ || !REF || REF === LIVE_REF || URL_.includes(LIVE_REF) || !URL_.includes(REF)) { console.error('ABORT: not the test project'); process.exit(1) }
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(URL_, env.TEST_SERVICE_ROLE_KEY, opts)
const UI = process.env.UI_URL
const SHOTS = '/workspace/screens-162'; fs.mkdirSync(SHOTS, { recursive: true })
const PREFIX = 'fwm162-'
let pass = 0, fail = 0
const check = (n, ok, x = '') => { ok ? pass++ : fail++; console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : String(x).slice(0, 400)) }
const pw = 'Oc162-' + RUN + '-x!'
const now = () => new Date().toISOString()
const OA = rid('oc-A'), OB = rid('oc-B'), OC = rid('oc-C'), OD = rid('oc-D'), OE = rid('oc-E')
const UINAME = `UI162 Outlet ${RUN}`
let browser, ceo
const push = (c, row) => c.rpc('push_records', { p_rows: [{ deleted: false, client_ts: now(), ...row }] })
const rej = (r) => r.data?.rejected?.[0]?.reason || r.error?.message || ''
const get = async (id) => (await admin.from('records').select('data, deleted').eq('entity', 'outlets').eq('id', id).maybeSingle()).data
try {
  const email = `${PREFIX}ceo-${RUN}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: 'UI162 CEO' } })
  if (error) throw error
  for (let i = 0; i < 10; i++) {
    const u = await admin.from('profiles').update({ role: 'super_admin', status: 'active', full_name: 'UI162 CEO', outlet_ids: [], company_ids: [] }).eq('id', data.user.id).select('role,status')
    if (u.data?.[0]?.role === 'super_admin' && u.data[0].status === 'active') break
    await new Promise((r) => setTimeout(r, 500))
  }
  ceo = createClient(URL_, env.TEST_ANON_KEY, opts); const s = await ceo.auth.signInWithPassword({ email, password: pw }); if (s.error) throw s.error
  const cos = ((await admin.from('app_config').select('value').eq('key', 'companies').single()).data.value.items || []).map((c) => c.id)
  const C1 = cos.includes('main') ? 'main' : cos[0], C2 = cos.find((c) => c !== C1 && !c.startsWith('sample-') && !c.startsWith('qdemo')) || cos.find((c) => c !== C1)

  // ---- server: push_records (the app's sync path)
  let r = await push(ceo, { entity: 'outlets', id: OA, data: { id: OA, name: 'No company' } })
  check('push: outlet without company refused', r.data?.ok === 0 && /company/i.test(rej(r)), JSON.stringify(r))
  check('push: nothing stored', !(await get(OA)))
  r = await push(ceo, { entity: 'outlets', id: OB, data: { id: OB, name: 'Empty company', companyId: '  ' } })
  check('push: blank company refused', r.data?.ok === 0 && /company/i.test(rej(r)), JSON.stringify(r))
  r = await push(ceo, { entity: 'outlets', id: OC, data: { id: OC, name: 'Unknown company', companyId: 'no-such-co-' + RUN } })
  check('push: unknown company refused', r.data?.ok === 0 && /not found/i.test(rej(r)), JSON.stringify(r))
  r = await push(ceo, { entity: 'outlets', id: OD, data: { id: OD, name: 'Real company', companyId: C1 } })
  check('push: outlet with a real company saved', r.data?.ok === 1 && (await get(OD))?.data?.companyId === C1, JSON.stringify(r))
  r = await push(ceo, { entity: 'outlets', id: OD, data: { id: OD, name: 'Real company (edited)' } })
  check('push: edit that drops the company refused', r.data?.ok === 0 && (await get(OD))?.data?.companyId === C1 && (await get(OD))?.data?.name === 'Real company', JSON.stringify(r))
  r = await push(ceo, { entity: 'outlets', id: OD, data: { id: OD, name: 'Real company (edited)', companyId: C1 } })
  check('push: edit keeping the company saved', r.data?.ok === 1 && (await get(OD))?.data?.name === 'Real company (edited)', JSON.stringify(r))
  r = await push(ceo, { entity: 'outlets', id: OD, data: { id: OD, name: 'Real company (edited)', companyId: 'no-such-co-' + RUN } })
  check('push: move to an unknown company refused', r.data?.ok === 0 && (await get(OD))?.data?.companyId === C1, JSON.stringify(r))
  if (C2) {
    r = await push(ceo, { entity: 'outlets', id: OD, data: { id: OD, name: 'Real company (edited)', companyId: C2 } })
    check('push: CEO moves the outlet to another real company', r.data?.ok === 1 && (await get(OD))?.data?.companyId === C2, JSON.stringify(r))
  }
  r = await ceo.rpc('push_records', { p_rows: [{ entity: 'outlets', id: OD, data: {}, deleted: true, client_ts: now() }] })
  const dd = await get(OD)
  check('push: deleting an outlet still works (keeps its company)', r.data?.ok === 1 && dd?.deleted === true && !!dd?.data?.companyId, JSON.stringify(r) + JSON.stringify(dd))

  // ---- server: direct writes (server jobs / service role) are refused too
  const d1 = await admin.from('records').insert({ entity: 'outlets', id: OE, client_ts: now(), data: { id: OE, name: 'Direct no company' } })
  check('direct insert without company refused', !!d1.error && /company/i.test(d1.error.message), JSON.stringify(d1.error))
  const d2 = await admin.from('records').insert({ entity: 'outlets', id: OE, client_ts: now(), data: { id: OE, name: 'Direct', companyId: C1 } })
  check('direct insert with company saved', !d2.error && (await get(OE))?.data?.companyId === C1, JSON.stringify(d2.error))
  const d3 = await admin.from('records').update({ data: { id: OE, name: 'Direct' }, client_ts: now() }).eq('entity', 'outlets').eq('id', OE)
  check('direct update removing company refused', !!d3.error && (await get(OE))?.data?.companyId === C1, JSON.stringify(d3.error))
  const wk = await admin.from('records').insert({ entity: 'workers', id: rid('oc-W'), client_ts: now(), data: { id: rid('oc-W'), fullName: 'Rule check', outletId: OE } })
  check('other record types are not affected', !wk.error, JSON.stringify(wk.error))

  // ---- UI
  if (!UI) { check('UI_URL set', false, 'no UI_URL') } else {
    browser = await chromium.launch()
    for (const [vp, tag] of [[{ width: 1280, height: 860 }, 'desktop'], [{ width: 390, height: 844 }, 'phone']]) {
      const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: vp.width < 500 ? 2 : 1 })
      const p = await ctx.newPage(); const errs = []
      p.on('pageerror', (e) => errs.push(e.message))
      await p.goto(UI); await p.fill('#em', email); await p.fill('#pw', pw)
      await p.locator('form button[type=submit]').first().click(); await p.waitForTimeout(6000)
      await p.goto(UI + '#/settings/org'); await p.waitForTimeout(3000)
      const sec = p.locator('#s-outlets'); const fold = sec.locator('.card-fold.is-closed .fold-btn'); if (await fold.count()) await fold.first().click()
      await sec.getByRole('button', { name: /Add outlet/ }).first().click(); await p.waitForTimeout(600)
      const modal = p.locator('.modal').last()
      const coSel = modal.locator('select[name=companyId]')
      check(`[${tag}] Add outlet: company field shown, required, no default`, await coSel.count() === 1 && (await coSel.inputValue()) === '' && await coSel.evaluate((e) => e.required))
      await modal.locator('input[name=name]').fill(UINAME + ' ' + tag)
      await modal.getByRole('button', { name: /^Save$/ }).click(); await p.waitForTimeout(500)
      const inline = modal.locator('.field:has(select[name=companyId]) .fmsg.error')
      check(`[${tag}] inline error under Company`, await inline.count() === 1 && /Choose the company this outlet belongs to/.test(await inline.innerText()), await modal.innerText())
      await p.screenshot({ path: `${SHOTS}/add-outlet-no-company-${tag}.png` })
      const opt = await coSel.locator('option').nth(1).getAttribute('value')
      await coSel.selectOption(opt); await p.waitForTimeout(300)
      check(`[${tag}] inline error clears once a company is chosen`, await inline.count() === 0)
      await modal.getByRole('button', { name: /^Save$/ }).click(); await p.waitForTimeout(6000)
      const saved = (await admin.from('records').select('data').eq('entity', 'outlets').eq('data->>name', UINAME + ' ' + tag)).data || []
      check(`[${tag}] saved outlet synced with the chosen company`, saved.length === 1 && saved[0].data.companyId === opt, JSON.stringify(saved))
      check(`[${tag}] no page errors`, errs.length === 0, errs.join(' | '))
      await ctx.close()
    }
  }
} catch (e) { check('suite ran', false, e.stack || e.message) } finally {
  if (browser) await browser.close().catch(() => {})
  await admin.from('records').delete().like('data->>name', `UI162 Outlet ${RUN}%`).then(() => {}, () => {})
  await cleanupOwn(admin, PREFIX)
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
