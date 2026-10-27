// 1.6.4: permit-vs-outlet compliance. API: only the CEO can call permit_compliance(); every other role and anon are refused.
// Risks: ok / high / critical / medium / needs_data, sources worker / kdn / permit_employer. UI: CEO colours + report tabs,
// move plan (swap pair, single move, no valid outlet), PDF preview; non-CEO sees the permit company as plain text, no report.
// SAFETY: TEST project only. Creates its own stamped outlets / workers / KDN letter / users and removes only those.
// Needs: staff TEST build at UI_URL. Never prints passwords or tokens.
import fs from 'node:fs'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
const require = createRequire(new URL('../package.json', import.meta.url))
const { createClient } = require('@supabase/supabase-js')
const { chromium } = createRequire((process.env.PW_PKG || '/workspace/tools/pw') + '/package.json')('playwright')
const LIVE_REF = 'gnepquxtwkyffjmoydnv'
const env = Object.fromEntries(fs.readFileSync(new URL('../.secrets.env', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const URL_ = env.TEST_SUPABASE_URL, ANON = env.TEST_ANON_KEY
if (!URL_ || URL_.includes(LIVE_REF) || !URL_.includes(env.TEST_PROJECT_REF)) { console.error('ABORT: not the test project'); process.exit(1) }
const UI = process.env.UI_URL
if (!UI) { console.error('Set UI_URL'); process.exit(1) }
const OUT = process.env.OUT || '/workspace/screens-compliance/'
fs.mkdirSync(OUT, { recursive: true })
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(URL_, env.TEST_SERVICE_ROLE_KEY, opts)
let pass = 0, fail = 0
const check = (n, ok, x = '') => { ok ? pass++ : fail++; console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : String(x).slice(0, 400)) }
const stamp = Date.now().toString(36), pw = crypto.randomBytes(12).toString('hex')
const OA = 'pc-oa-' + stamp, OB = 'pc-ob-' + stamp
const W = Object.fromEntries(['ok', 'text', 'high', 'swap', 'crit', 'med', 'unk', 'none'].map((k) => [k, `pc-${k}-${stamp}`]))
const N = Object.fromEntries(Object.keys(W).map((k) => [k, `PC ${k.toUpperCase()} ${stamp}`]))
const staffIds = []
let qid = null
async function staff(key, role, outlets = []) {
  const email = `fw164-${key}-${stamp}@example.com`, full = 'PC164 ' + key.toUpperCase()
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: full } })
  if (error) throw error
  staffIds.push(data.user.id)
  for (let i = 0; i < 10; i++) {
    const u = await admin.from('profiles').update({ role, status: 'active', outlet_ids: outlets, company_ids: [], full_name: full }).eq('id', data.user.id).select('role,status')
    if (!u.error && u.data?.[0]?.role === role && u.data[0].status === 'active') break
    await new Promise((r) => setTimeout(r, 500))
  }
  const c = createClient(URL_, ANON, opts); const s = await c.auth.signInWithPassword({ email, password: pw }); if (s.error) throw s.error
  return { c, email, id: data.user.id }
}
const now = new Date().toISOString()
let browser
async function login(p, email) {
  await p.goto(UI); await p.fill('#em', email); await p.fill('#pw', pw)
  await p.locator('form button[type=submit]').first().click(); await p.waitForTimeout(7000)
}
try {
  const cos = ((await admin.from('app_config').select('value').eq('key', 'companies').single()).data.value.items || [])
  const P = cos.find((c) => c.id === 'c2'), Q = cos.find((c) => c.id === 'main'), NOWHERE = cos.find((c) => c.id === 'qdemo-cafe')
  if (!P || !Q || !NOWHERE) throw new Error('TEST companies c2 / main / qdemo-cafe missing')
  const q = await admin.from('qr_quotas').insert({ company_id: P.id, ref_no: 'KDN-PC-' + stamp, kind: 'new', approval_date: '2026-01-15', sector: 'Services', job_title: 'Cleaner', status: 'active' }).select('id').single()
  if (q.error) throw q.error
  qid = q.data.id
  const wk = (k, outletId, extra = {}) => ({ entity: 'workers', id: W[k], client_ts: now, data: { id: W[k], workerNo: 'PC' + k.slice(0, 2).toUpperCase() + stamp.slice(-4), fullName: N[k], outletId, nationality: 'India', status: 'Active-Working', joinDate: '2024-01-03',
    dob: '1990-05-05', primaryLanguage: 'ta', phoneMY: '012-345 6789', jobCategory: 'Assistant Cook', businessType: 'Restaurant', initialBasicPay: 1700, documents: [], family: [], statusHistory: [], increments: [], allowances: [], loans: [], deductions: [], leaves: [], memos: [], notes: [], ...extra } })
  const ins = await admin.from('records').insert([
    { entity: 'outlets', id: OA, client_ts: now, data: { id: OA, name: 'PC Outlet A ' + stamp, type: 'Restaurant', companyId: P.id, state: 'Selangor' } },
    { entity: 'outlets', id: OB, client_ts: now, data: { id: OB, name: 'PC Outlet B ' + stamp, type: 'Restaurant', companyId: Q.id, state: 'Selangor' } },
    wk('ok', OA, { permitCompanyId: P.id }),
    wk('text', OA, { permitEmployer: P.name.toUpperCase() + ' SDN. BHD.' }),
    wk('high', OB, { permitCompanyId: P.id }),
    wk('swap', OA, { permitCompanyId: Q.id }),
    wk('crit', OB, { quotaId: qid }),
    wk('med', OA, { quotaId: qid }),
    wk('unk', OB),
    wk('none', OA, { permitCompanyId: NOWHERE.id }),
  ])
  if (ins.error) throw ins.error

  // ---------- API: who may read the report ----------
  const ceo = await staff('ceo', 'super_admin')
  const r = await ceo.c.rpc('permit_compliance')
  check('CEO can call permit_compliance()', !r.error && Array.isArray(r.data?.workers), r.error?.message)
  const by = Object.fromEntries((r.data?.workers || []).filter((w) => Object.values(W).includes(w.id)).map((w) => [w.id, w]))
  const exp = { ok: ['ok', 'compliant', 'worker'], text: ['ok', 'compliant', 'permit_employer'], high: ['high', 'mismatch', 'worker'], swap: ['high', 'mismatch', 'worker'], crit: ['critical', 'mismatch', 'kdn'], med: ['medium', 'compliant', 'kdn'], unk: ['needs_data', 'unknown', null], none: ['high', 'mismatch', 'worker'] }
  for (const [k, [risk, st, src]] of Object.entries(exp)) { const w = by[W[k]]; check(`RPC ${k}: risk ${risk}, ${st}, source ${src}`, w && w.risk === risk && w.status2 === st && (w.permitSource ?? null) === src, JSON.stringify(w)) }
  check('RPC carries KDN ref, sector and job', by[W.crit]?.kdnRef === 'KDN-PC-' + stamp && by[W.crit]?.kdnSector === 'Services' && by[W.crit]?.kdnJob === 'Cleaner' && by[W.crit]?.jobMismatch === true, JSON.stringify(by[W.crit]))
  check('RPC names companies', by[W.high]?.permitCompany === P.name && by[W.high]?.outletCompany === Q.name, JSON.stringify(by[W.high]))
  const others = {}
  for (const role of ['general_manager', 'hr_admin', 'hr_manager', 'outlet_manager', 'viewer']) {
    const u = await staff(role.replace('_', ''), role, role === 'outlet_manager' || role === 'hr_manager' ? [OA, OB] : [])
    others[role] = u
    const x = await u.c.rpc('permit_compliance')
    check(`${role} is refused the report (API)`, !!x.error && !x.data && /CEO/i.test(x.error.message), x.error?.message || JSON.stringify(x.data).slice(0, 100))
    const h = await u.c.rpc('pc_norm', { t: 'X' })
    check(`${role} cannot call helper pc_norm`, !!h.error, JSON.stringify(h.data))
  }
  const an = createClient(URL_, ANON, opts)
  const xa = await an.rpc('permit_compliance')
  check('anon is refused the report (API)', !!xa.error && !xa.data, JSON.stringify(xa.data))
  const raw = await fetch(`${URL_}/rest/v1/rpc/permit_compliance`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: '{}' })
  check('anon REST call refused', raw.status === 401 || raw.status === 403 || raw.status === 404, raw.status)

  // ---------- UI ----------
  browser = await chromium.launch()
  for (const [vp, tag] of [[{ width: 1366, height: 860 }, 'desktop'], [{ width: 390, height: 844 }, 'phone']]) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: vp.width < 500 ? 2 : 1, ...(vp.width < 500 ? { isMobile: true, hasTouch: true } : {}) })
    const p = await ctx.newPage(); const errs = []
    p.on('pageerror', (e) => errs.push(e.message))
    await login(p, ceo.email)
    await p.goto(UI + '#/workers?q=' + encodeURIComponent(stamp)); await p.waitForTimeout(3500)
    const tone = async (k) => p.getByTestId('worker-row').filter({ hasText: N[k] }).first().locator('[data-testid=pc]').first().getAttribute('data-tone').catch(() => 'missing')
    if (tag === 'desktop') {
      check('[CEO] list: compliant worker is green', await tone('ok') === 'ok', await tone('ok'))
      check('[CEO] list: mismatched worker is red', await tone('high') === 'bad', await tone('high'))
      check('[CEO] list: unknown worker is grey', await tone('unk') === 'unknown', await tone('unk'))
      check('[CEO] list: KDN-letter worker is red', await tone('crit') === 'bad', await tone('crit'))
      check('[CEO] nav has Permit compliance', await p.locator('a[href="#/permit-compliance"]').count() > 0)
      await p.screenshot({ path: `${OUT}ceo-workers-list-desktop.png` })
      await p.goto(UI + '#/workers?gap=permit&q=' + encodeURIComponent(stamp)); await p.waitForTimeout(2000)
      const gapRows = await p.getByTestId('worker-row').allInnerTexts()
      check('Data gap "Permit company missing" lists only the unknown worker', gapRows.length === 1 && gapRows[0].includes(N.unk), gapRows.join(' | '))
    } else {
      const row = p.getByTestId('worker-row').filter({ hasText: N.high }).first()
      await row.locator('.dt-xbtn').click().catch(() => {}); await p.waitForTimeout(500)
      const det = row.locator('xpath=following-sibling::tr[1]'); const dt = (await det.innerText().catch(() => '')).replace(/\s+/g, ' ')
      check('[CEO phone] expanded row shows Permit company', /permit company/i.test(dt) && dt.includes(P.name), dt)
      await det.scrollIntoViewIfNeeded().catch(() => {}); await p.evaluate(() => window.scrollBy(0, -200)); await p.screenshot({ path: `${OUT}ceo-workers-expanded-phone.png` })
    }
    await p.goto(UI + '#/workers/' + W.high); await p.waitForTimeout(2500)
    const wp = p.getByTestId('wd-permit')
    check(`[CEO ${tag}] profile shows permit company in red`, (await wp.innerText().catch(() => '')).includes(P.name) && await wp.locator('[data-tone=bad]').count() === 1, await wp.innerText().catch(() => ''))
    await p.screenshot({ path: `${OUT}ceo-worker-profile-${tag}.png` })
    // report
    await p.goto(UI + '#/permit-compliance'); await p.waitForSelector('[data-testid=pc-summary]', { timeout: 15000 }).catch(() => {})
    check(`[CEO ${tag}] report summary shows`, await p.getByTestId('pc-total').count() === 1 && Number(await p.getByTestId('pc-total').innerText()) >= 8)
    await p.screenshot({ path: `${OUT}report-summary-${tag}.png` })
    await p.getByRole('tab', { name: /By outlet/ }).click(); await p.waitForTimeout(500)
    const rk = async (k) => p.locator(`[data-testid=pc-row][data-wid="${W[k]}"]`).getAttribute('data-risk').catch(() => 'missing')
    if (tag === 'desktop') for (const k of ['ok', 'high', 'crit', 'med', 'unk']) check(`[CEO] By outlet: ${k} → ${exp[k][0]}`, await rk(k) === exp[k][0], await rk(k))
    await p.locator(`[data-testid=pc-row][data-wid="${W.crit}"]`).scrollIntoViewIfNeeded().catch(() => {})
    await p.screenshot({ path: `${OUT}report-by-outlet-${tag}.png` })
    await p.getByRole('tab', { name: /Move plan/ }).click(); await p.waitForTimeout(500)
    const mk = async (k) => p.locator(`[data-testid=pc-move][data-wid="${W[k]}"]`).getAttribute('data-kind').catch(() => 'missing')
    if (tag === 'desktop') {
      // 'swap' (at A, permit B's company) pairs with one of high / crit (at B, permit A's company): critical first; the other moves alone
      const [mh, mc, ms] = [await mk('high'), await mk('crit'), await mk('swap')]
      check('[CEO] Move plan: swap pair keeps headcount (critical paired first)', ms === 'swap' && mc === 'swap' && mh === 'move', `${mh} ${mc} ${ms}`)
      const sw = await p.locator(`[data-testid=pc-move][data-wid="${W.crit}"]`).innerText().catch(() => '')
      check('[CEO] swap goes to the partner\'s outlet', sw.includes('PC Outlet A ' + stamp) && sw.includes(N.swap), sw)
      const mv = await p.locator(`[data-testid=pc-move][data-wid="${W.high}"]`).innerText().catch(() => '')
      check('[CEO] Move plan: single move to a permit-company outlet', /Same business type/.test(mv) && mv.includes(' → '), mv)
      const nn = await p.locator(`[data-testid=pc-move][data-wid="${W.none}"]`).innerText().catch(() => '')
      check('[CEO] Move plan: no valid outlet → employer transfer or new quota', await mk('none') === 'none' && /employer transfer, or new quota/.test(nn), nn)
      check('[CEO] compliant / medium / unknown not in move plan', await mk('ok') === 'missing' && await mk('med') === 'missing' && await mk('unk') === 'missing')
    }
    await p.locator(`[data-testid=pc-move][data-wid="${W.high}"]`).scrollIntoViewIfNeeded().catch(() => {})
    await p.screenshot({ path: `${OUT}report-move-plan-${tag}.png` })
    await p.getByRole('tab', { name: /Fix list/ }).click(); await p.waitForTimeout(500)
    if (tag === 'desktop') {
      const fx = (await p.getByTestId('pc-fixes').innerText()).replace(/\s+/g, ' ')
      check('[CEO] Fix list: medium explains the occupation', fx.includes(N.med) && /Occupation: KDN Cleaner/.test(fx), fx.slice(0, 300))
      check('[CEO] Fix list: unknown asks for the permit company', fx.includes(N.unk) && /Set the permit company/.test(fx))
      // filters
      await p.locator('label:has-text("Outlet") select').first().selectOption(OB); await p.waitForTimeout(400)
      const fx2 = await p.getByTestId('pc-fixes').innerText()
      check('[CEO] Outlet filter narrows the fix list', fx2.includes(N.high) && !fx2.includes(N.med), fx2.slice(0, 300))
      await p.locator('label:has-text("Risk") select').first().selectOption('critical'); await p.waitForTimeout(400)
      const fx3 = await p.getByTestId('pc-fixes').innerText()
      check('[CEO] Risk filter: critical only', fx3.includes(N.crit) && !fx3.includes(N.high), fx3.slice(0, 300))
      await p.locator('label:has-text("Risk") select').first().selectOption(''); await p.locator('label:has-text("Outlet") select').first().selectOption('')
    }
    await p.screenshot({ path: `${OUT}report-fix-list-${tag}.png` })
    await p.getByRole('button', { name: /PDF \/ Print/ }).click(); await p.waitForTimeout(2500)
    check(`[CEO ${tag}] PDF / Print preview opens`, await p.locator('.rpt-overlay').count() === 1)
    await p.screenshot({ path: `${OUT}report-pdf-preview-${tag}.png` })
    check(`[CEO ${tag}] no page errors`, errs.length === 0, errs.join(' | '))
    await ctx.close()
  }
  // non-CEO: HR manager
  for (const [vp, tag] of [[{ width: 1366, height: 860 }, 'desktop'], [{ width: 390, height: 844 }, 'phone']]) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: vp.width < 500 ? 2 : 1, ...(vp.width < 500 ? { isMobile: true, hasTouch: true } : {}) })
    const p = await ctx.newPage(); const errs = []
    p.on('pageerror', (e) => errs.push(e.message))
    await login(p, others.hr_manager.email)
    await p.goto(UI + '#/workers?q=' + encodeURIComponent(stamp)); await p.waitForTimeout(3500)
    const pcs = p.locator('[data-testid=worker-row] [data-testid=pc]')
    const n = await pcs.count(), toned = await p.locator('[data-testid=worker-row] [data-testid=pc][data-tone]').count(), coloured = await p.locator('.pc-ok, .pc-bad, .pc-unknown').count()
    check(`[HR ${tag}] permit company shown without colour`, (tag === 'phone' || n >= 8) && toned === 0 && coloured === 0, `${n} ${toned} ${coloured}`)
    if (tag === 'desktop') {
      const t = await p.getByTestId('worker-row').filter({ hasText: N.high }).first().innerText()
      check('[HR] list shows the permit company name', t.includes('Permit: ' + P.name), t)
      check('[HR] no Permit compliance nav entry', await p.locator('a[href="#/permit-compliance"]').count() === 0)
      await p.screenshot({ path: `${OUT}hr-workers-list-desktop.png` })
    }
    await p.goto(UI + '#/workers/' + W.high); await p.waitForTimeout(2500)
    const wp = p.getByTestId('wd-permit')
    check(`[HR ${tag}] profile shows permit company plain`, (await wp.innerText().catch(() => '')).includes(P.name) && await wp.locator('[data-tone]').count() === 0)
    await p.screenshot({ path: `${OUT}hr-worker-profile-${tag}.png` })
    await p.goto(UI + '#/permit-compliance'); await p.waitForTimeout(2500)
    const body = await p.locator('main, .page').first().innerText().catch(() => '')
    check(`[HR ${tag}] report page says CEO only, no data`, /CEO only/.test(body) && await p.getByTestId('pc-summary').count() === 0, body.slice(0, 200))
    if (tag === 'phone') { await p.goto(UI + '#/more'); await p.waitForTimeout(1500); check('[HR phone] More has no Permit compliance', !(await p.locator('body').innerText()).includes('Permit compliance')) }
    await p.screenshot({ path: `${OUT}hr-report-blocked-${tag}.png` })
    check(`[HR ${tag}] no page errors`, errs.length === 0, errs.join(' | '))
    await ctx.close()
  }
  // HR edits the permit company in the worker form → CEO report turns the unknown worker compliant
  {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } }); const p = await ctx.newPage()
    await login(p, others.hr_manager.email)
    await p.goto(UI + '#/workers/' + W.unk + '/edit'); await p.waitForTimeout(3000)
    await p.locator('.wf-stepper li:nth-child(2) button').click(); await p.waitForTimeout(600)
    const sel = p.locator('select[name=permitCompanyId]')
    check('Worker form has a Permit company field', await sel.count() === 1)
    await sel.selectOption(Q.id); await p.waitForTimeout(300)
    const kd = p.locator('select[name=quotaId]')
    if (await kd.count()) { const opts2 = await kd.locator('option').allInnerTexts(); check('KDN letter list is filtered by the permit company', !opts2.some((o) => o.includes('KDN-PC-' + stamp)), opts2.join(' | ')) }
    await p.screenshot({ path: `${OUT}worker-form-permit-desktop.png` })
    await p.getByRole('button', { name: /^Save$/ }).first().click(); await p.waitForTimeout(4000)
    let after
    for (let i = 0; i < 10; i++) { after = ((await ceo.c.rpc('permit_compliance')).data?.workers || []).find((w) => w.id === W.unk); if (after?.risk === 'ok') break; await new Promise((r) => setTimeout(r, 1000)) }
    check('Saved permit company → CEO report shows the worker compliant', after?.risk === 'ok' && after?.permitSource === 'worker', JSON.stringify(after))
    await ctx.close()
  }
} catch (e) { check('suite ran', false, e.stack || e.message) } finally {
  if (browser) await browser.close().catch(() => {})
  const evs = ((await admin.from('notification_deliveries').select('event_id').in('user_id', staffIds)).data || []).map((d) => d.event_id).filter(Boolean)
  await admin.from('notification_deliveries').delete().in('user_id', staffIds)
  if (evs.length) await admin.from('notification_events').delete().in('id', [...new Set(evs)])
  for (const id of staffIds) await admin.auth.admin.deleteUser(id)
  await admin.from('records').delete().in('id', [OA, OB, ...Object.values(W)])
  if (qid) await admin.from('qr_quotas').delete().eq('id', qid)
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
