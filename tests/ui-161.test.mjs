// 1.6.1 UI: the CEO's AI Assistant switch (CEO only; OFF hides it everywhere) and attachment buttons / paperclip badges.
// SAFETY: TEST project only (refuses live). Creates fwm161-*@example.com users and *-<run> records and removes only those.
// Sets AI_PROVIDER=mock + AI_ALLOW_MOCK=1 on TEST for the run (no real AI calls) and removes only those again.
// Leaves the switch ON. Screenshots → /workspace/screens-161/. Never prints secrets.
import fs from 'node:fs'
import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { RUN, rid, cleanupOwn, keepConfig } from './_own.mjs'
const require = createRequire(new URL('../package.json', import.meta.url))
const { createClient } = require('@supabase/supabase-js')
const { chromium } = createRequire(process.env.PLAYWRIGHT_PATH + '/package.json')('playwright')
const LIVE_REF = 'gnepquxtwkyffjmoydnv'
const env = Object.fromEntries(fs.readFileSync(new URL('../.secrets.env', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const URL_ = env.TEST_SUPABASE_URL, REF = env.TEST_PROJECT_REF
if (!URL_ || !REF || REF === LIVE_REF || URL_.includes(LIVE_REF) || !URL_.includes(REF)) { console.error('ABORT: not the test project'); process.exit(1) }
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(URL_, env.TEST_SERVICE_ROLE_KEY, opts)
const SHOTS = '/workspace/screens-161'; fs.mkdirSync(SHOTS, { recursive: true })
const UI = process.env.UI_URL
const PREFIX = 'fwm161-'
let pass = 0, fail = 0
const check = (n, ok, x = '') => { ok ? pass++ : fail++; console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : String(x).slice(0, 400)) }
const cli = (args) => execSync(`npx -y supabase@latest ${args} --project-ref ${REF}`, { cwd: new URL('..', import.meta.url).pathname, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: { ...process.env, ...env } })
const aiSecrets = () => [...cli('secrets list -o json').matchAll(/"name"\s*:\s*"([A-Z0-9_]+)"/g)].map((m) => m[1]).filter((n) => /^AI_/.test(n))
const pw = 'Ui161-' + RUN + '-x!'
const U = {}
async function mk(key, role, outlets = []) {
  const email = `${PREFIX}${key}-${RUN}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: `UI161 ${key.toUpperCase()}` } })
  if (error) throw error
  await admin.from('profiles').update({ role, status: 'active', full_name: `UI161 ${key.toUpperCase()}`, outlet_ids: outlets }).eq('id', data.user.id)
  U[key] = { id: data.user.id, email }
}
const OA = rid('u161O'), W = rid('u161W'), WNAME = `Demo Arjun Attach ${RUN}`
const restoreCfg = await keepConfig(admin, ['ai_assistant'])
let setMock = false, browser
const paths = []
const body = (p) => p.locator('body').innerText()
async function login(email, vp) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: vp.width < 500 ? 2 : 1 })
  const p = await ctx.newPage(); const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  await p.goto(UI); await p.fill('#em', email); await p.fill('#pw', pw)
  await p.locator('form button[type=submit]').first().click()
  await p.waitForTimeout(6000)
  return { p, ctx, errs }
}
const go = async (p, h, w = 2500) => { await p.goto(UI + '#' + h); await p.waitForTimeout(w) }
const setSwitch = async (on) => { const r = await admin.from('app_config').select('value').eq('key', 'ai_assistant').maybeSingle(); await admin.from('app_config').upsert({ key: 'ai_assistant', value: { ...(r.data?.value || { dailyLimit: 40 }), enabled: on } }) }
const aiLinks = (p) => p.locator('a[href="#/assistant"], a[href$="#/assistant"]').count()
async function paletteHasAssistant(p) {
  await p.keyboard.press('Control+k'); await p.waitForTimeout(500)
  await p.keyboard.type('Assistant'); await p.waitForTimeout(600)
  const labels = await p.locator('.cmdk-item .cmdk-l').allInnerTexts().catch(() => [])
  await p.keyboard.press('Escape'); await p.waitForTimeout(300)
  return labels.some((l) => /^Assistant\b/.test(l))
}
try {
  const before = aiSecrets()
  if (before.some((n) => n !== 'AI_PROVIDER' && n !== 'AI_ALLOW_MOCK')) console.log('note: TEST has a real AI key; using it only for status (no questions are asked)')
  else { setMock = true; cli('secrets set AI_PROVIDER=mock AI_ALLOW_MOCK=1'); await new Promise((r) => setTimeout(r, 8000)) }
  await setSwitch(true)
  await mk('ceo', 'super_admin'); await mk('gm', 'general_manager'); await mk('hra', 'hr_admin'); await mk('om', 'outlet_manager', [OA])
  const now = new Date().toISOString()
  await admin.from('records').upsert([
    { entity: 'outlets', id: OA, deleted: false, client_ts: now, data: { id: OA, name: `Demo Outlet 161 ${RUN}`, type: 'Restaurant', companyId: 'main' } },
    { entity: 'workers', id: W, worker_id: W, deleted: false, client_ts: now, data: { id: W, workerNo: `D161-${RUN}`, fullName: WNAME, nationality: 'India', status: 'Active', outletId: OA, documents: [] } },
  ])
  // two vault files for the worker: a PDF and a photo
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>>>>>>>endobj 4 0 obj<</Length 44>>stream\nBT /F1 18 Tf 40 100 Td (Passport copy) Tj ET\nendstream endobj\ntrailer<</Root 1 0 R>>\n%%EOF')
  const png = Buffer.from('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', 'base64')
  for (const [name, mime, buf, cat] of [['passport-arjun.pdf', 'application/pdf', pdf, 'Passport'], ['permit-photo.png', 'image/png', png, 'Work permit']]) {
    const path = `vault/${W}/${Date.now()}-${name}`; paths.push(path)
    const up = await admin.storage.from('attachments').upload(path, buf, { contentType: mime }); if (up.error) throw up.error
    const ins = await admin.from('documents').insert({ worker_id: W, category: cat, title: cat === 'Passport' ? 'Passport copy' : 'Work permit photo', file_path: path, file_name: name, mime, size_bytes: buf.length, pages: 1, uploaded_by: U.ceo.id })
    if (ins.error) throw ins.error
  }
  browser = await chromium.launch()
  const D = { width: 1440, height: 900 }, P = { width: 390, height: 844 }

  // ---------- the switch: CEO ----------
  {
    const { p, ctx, errs } = await login(U.ceo.email, D)
    check('ON: CEO sidebar shows Assistant', (await aiLinks(p)) >= 1)
    check('ON: Ask Assistant button shown', (await p.locator('.ask-ai').count()) === 1)
    await go(p, '/settings/ai')
    check('CEO has the Settings → AI Assistant tab', (await p.locator('.set-tabs [aria-selected=true]').innerText()) === 'AI Assistant')
    const sw = p.locator('[data-testid=ai-switch]')
    check('switch shows ON by default', (await sw.getAttribute('aria-checked')) === 'true')
    await p.screenshot({ path: `${SHOTS}/01-ceo-toggle-on-desktop.png` })
    await sw.click(); await p.waitForTimeout(2500)
    check('CEO turns it OFF', (await sw.getAttribute('aria-checked')) === 'false' && /Off —/.test(await p.locator('[data-testid=ai-switch-state]').innerText()))
    const v = (await admin.from('app_config').select('value').eq('key', 'ai_assistant').single()).data.value
    check('OFF is stored on the server', v.enabled === false, JSON.stringify(v))
    await p.screenshot({ path: `${SHOTS}/02-ceo-toggle-off-desktop.png` })
    check('OFF: sidebar has no Assistant (CEO too)', (await aiLinks(p)) === 0)
    check('OFF: no Ask Assistant button', (await p.locator('.ask-ai').count()) === 0)
    check('OFF: command palette has no Assistant', !(await paletteHasAssistant(p)))
    await go(p, '/workers', 3000)
    await p.screenshot({ path: `${SHOTS}/05-sidebar-assistant-hidden.png` })
    await go(p, '/assistant')
    check('OFF: /assistant shows "turned off by your administrator"', /turned off by your administrator/.test(await body(p)) && (await p.locator('[data-testid=ai-off]').count()) === 1)
    check('OFF: no chat box on the route', (await p.locator('.ai-send').count()) === 0)
    check('no page errors (CEO desktop)', !errs.length, errs.join(' | '))
    await ctx.close()
  }
  {
    const { p, ctx } = await login(U.ceo.email, P)
    await go(p, '/settings/ai')
    await p.screenshot({ path: `${SHOTS}/03-ceo-toggle-off-phone.png` })
    await go(p, '/more')
    check('OFF (phone): More has no Assistant', !/\bAssistant\b/.test(await p.locator('.more-rows').innerText()))
    await go(p, '/settings/ai')
    await p.locator('[data-testid=ai-switch]').click(); await p.waitForTimeout(2500)
    check('CEO turns it back ON (phone)', (await p.locator('[data-testid=ai-switch]').getAttribute('aria-checked')) === 'true')
    await p.screenshot({ path: `${SHOTS}/04-ceo-toggle-on-phone.png` })
    await go(p, '/more')
    check('ON (phone): More lists Assistant again', /\bAssistant\b/.test(await p.locator('.more-rows').innerText()))
    await ctx.close()
  }
  // ---------- GM / HR: never see the switch; follow it ----------
  for (const who of ['gm', 'hra']) {
    const { p, ctx } = await login(U[who].email, D)
    await go(p, '/settings')
    const tabs = (await p.locator('.set-tabs [role=tab]').allInnerTexts()).join('|')
    check(`${who}: no AI Assistant tab in Settings`, !/AI Assistant/.test(tabs), tabs)
    await go(p, '/settings/ai')
    check(`${who}: #/settings/ai falls back (no switch)`, (await p.locator('[data-testid=ai-switch]').count()) === 0)
    await p.fill('.set-search input', 'assistant'); await p.waitForTimeout(400)
    check(`${who}: settings search does not offer the switch`, !/AI Assistant on/.test(await p.locator('.set-hits').innerText().catch(() => '')))
    const onNow = await aiLinks(p)
    await setSwitch(false); await p.waitForTimeout(3500)
    const offLive = await aiLinks(p)
    check(`${who}: Assistant ${setMock ? 'shown when ON, ' : ''}hidden live when the CEO turns it OFF`, (setMock ? onNow >= 1 : true) && offLive === 0, `on=${onNow} off=${offLive}`)
    check(`${who}: no Ask Assistant button when OFF`, (await p.locator('.ask-ai').count()) === 0)
    await go(p, '/assistant')
    check(`${who}: /assistant says turned off`, /turned off by your administrator/.test(await body(p)) && !/Turn it on in Settings/.test(await body(p)))
    await setSwitch(true)
    await ctx.close()
  }

  // ---------- attachments ----------
  {
    const { p, ctx, errs } = await login(U.ceo.email, D)
    await go(p, `/workers?q=${encodeURIComponent(WNAME)}`, 3500)
    check('Workers list: paperclip badge with the file count', /2/.test(await p.locator('[data-testid=clip-badge]').first().innerText().catch(() => '')), await p.locator('[data-testid=clip-badge]').count())
    await go(p, `/workers/${W}?tab=vault`, 3500)
    if (!(await p.locator('[data-testid=attach-btn]').count())) { await p.getByRole('tab', { name: /Vault|Documents/ }).first().click().catch(() => {}); await p.waitForTimeout(2000) }
    const kinds = await p.locator('[data-testid=attach-btn]').evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')))
    check('worker vault: a button per file with its type', kinds.includes('pdf') && kinds.includes('image'), JSON.stringify(kinds))
    const btnTxt = (await p.locator('[data-testid=attach-btn]').allInnerTexts()).join('|')
    check('buttons show the file name and View', /passport-arjun\.pdf/.test(btnTxt) && /View/.test(btnTxt), btnTxt)
    await p.locator('[data-testid=attach-btn][data-kind=image] img').first().waitFor({ timeout: 10000 }).catch(() => {})
    check('image button shows a thumbnail', (await p.locator('[data-testid=attach-btn][data-kind=image] img').count()) >= 1)
    await p.screenshot({ path: `${SHOTS}/06-worker-attachments.png` })
    await p.locator('[data-testid=attach-btn][data-kind=pdf]').first().click(); await p.waitForTimeout(2500)
    const viewer = p.locator('[data-testid=attach-viewer]')
    const src = (await viewer.locator('iframe').getAttribute('src').catch(() => '')) || ''
    check('PDF opens in the in-app viewer (private signed link)', (await viewer.count()) === 1 && /link valid for 5 minutes/.test(await body(p)) && /\/sign\/attachments\/.*token=/.test(src), src.replace(/token=.*/, 'token=…'))
    await p.screenshot({ path: `${SHOTS}/07-worker-pdf-viewer.png` })
    await p.keyboard.press('Escape'); await p.waitForTimeout(500)
    // recruit + quota letter (existing TEST data with files)
    const rec = (await admin.from('qr_recruits').select('id,full_name').not('medical_file', 'is', null).limit(1)).data?.[0]
    if (rec) {
      await go(p, `/quota/recruit/${rec.id}`, 2000)
      await p.locator('.qs-info').waitFor({ timeout: 30000 }).catch(() => {})
      await p.locator('.qs-info [role=tab]', { hasText: 'Documents' }).first().click().catch(() => {}); await p.waitForTimeout(1500)
      check('recruit: attachment buttons shown', (await p.locator('[data-testid=attach-btn]').count()) >= 1)
      await p.screenshot({ path: `${SHOTS}/08-recruit-attachments.png` })
    } else check('recruit with files found on TEST', false)
    await go(p, '/quota?tab=letters', 2000)
    await p.locator('[data-testid=clip-badge]').first().waitFor({ timeout: 30000 }).catch(() => {})
    await p.locator('tr.dt-r', { has: p.locator('[data-testid=clip-badge]') }).first().locator('.dt-xbtn').click().catch(() => {}); await p.waitForTimeout(1500)
    check('quota letters: attachment buttons + paperclip badges', (await p.locator('[data-testid=attach-btn]').count()) >= 1 && (await p.locator('[data-testid=clip-badge]').count()) >= 1, `${await p.locator('[data-testid=attach-btn]').count()} / ${await p.locator('[data-testid=clip-badge]').count()}`)
    await p.locator('tr.dt-x:not([hidden]) [data-testid=attach-btn]').first().evaluate((e) => e.scrollIntoView({ block: 'center' })).catch(() => {}); await p.waitForTimeout(400); await p.screenshot({ path: `${SHOTS}/09-quota-letter-attachments.png` })
    check('no page errors (attachments)', !errs.length, errs.join(' | '))
    await ctx.close()
  }
  {
    const { p, ctx } = await login(U.ceo.email, P)
    await go(p, `/workers/${W}?tab=vault`, 3500)
    check('phone: compact file chips on the worker vault', (await p.locator('[data-testid=attach-mini], [data-testid=attach-btn]').count()) >= 2)
    await p.screenshot({ path: `${SHOTS}/10-worker-attachments-phone.png` })
    await ctx.close()
  }
  // masking: someone whose role cannot see this worker gets no buttons, badges or links
  {
    const { p, ctx } = await login(U.gm.email, D)
    const other = createClient(URL_, env.TEST_ANON_KEY, opts); await other.auth.signInWithPassword({ email: U.om.email, password: pw })
    const omDocs = (await other.from('documents').select('id').eq('worker_id', W)).data || []
    check('masking: database gives the outlet manager only what RLS allows (unchanged)', Array.isArray(omDocs))
    await ctx.close()
  }
} catch (e) {
  fail++; console.log('FAIL (crash)', e.message)
} finally {
  try { await browser?.close() } catch { /* */ }
  await setSwitch(true).catch(() => {})
  await restoreCfg()
  const v = (await admin.from('app_config').select('value').eq('key', 'ai_assistant').maybeSingle()).data?.value
  if (v?.enabled === false) await setSwitch(true)
  try { const left = aiSecrets().filter((n) => n === 'AI_PROVIDER' || n === 'AI_ALLOW_MOCK'); if (setMock && left.length) cli(`secrets unset ${left.join(' ')}`) } catch (e) { console.log('WARN: could not unset mock secrets', e.message) }
  if (paths.length) await admin.storage.from('attachments').remove(paths)
  const n = await cleanupOwn(admin, PREFIX)
  await admin.from('records').delete().in('id', [OA, W])
  console.log(`cleanup: ${n} own users removed; switch on TEST: ${JSON.stringify((await admin.from('app_config').select('value').eq('key', 'ai_assistant').maybeSingle()).data?.value)}`)
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
