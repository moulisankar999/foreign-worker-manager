// AI Assistant screenshots on a TEST build (desktop + phone). Usage: UI_URL=http://localhost:4192/ node tests/ai-shots.mjs
// TEST only. Own fwaishot-* users and *-<run> records, removed afterwards. Mock provider set on TEST only for the run, then unset.
// The browser shows natural questions; the request to the mock provider is rewritten to its deterministic /tool form.
import fs from 'fs'
import crypto from 'crypto'
import { createRequire } from 'module'
import { execSync } from 'child_process'
import { RUN, rid, cleanupOwn } from './_own.mjs'
const require = createRequire(new URL('../package.json', import.meta.url))
const { createClient } = require('@supabase/supabase-js')
const { chromium } = createRequire((process.env.PW_PKG || '/workspace/tools/pw') + '/package.json')('playwright')
const env = Object.fromEntries(fs.readFileSync(new URL('../.secrets.env', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const URL_ = env.TEST_SUPABASE_URL, REF = env.TEST_PROJECT_REF
if (!REF || REF === 'gnepquxtwkyffjmoydnv' || !URL_.includes(REF)) { console.error('ABORT: not TEST'); process.exit(1) }
const UI = process.env.UI_URL, OUT = process.env.OUT || '/workspace/screens-ai/'
fs.mkdirSync(OUT, { recursive: true })
const admin = createClient(URL_, env.TEST_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const cli = (a) => execSync(`npx -y supabase@latest ${a} --project-ref ${REF}`, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: { ...process.env, ...env } })
const aiSecrets = () => [...cli('secrets list -o json').matchAll(/"name"\s*:\s*"([A-Z0-9_]+)"/g)].map((m) => m[1]).filter((n) => /^AI_/.test(n))
const PREFIX = 'fwaishot-', pw = crypto.randomBytes(12).toString('hex'), U = {}
const OA = rid('aisO'), W = [rid('aisW1'), rid('aisW2'), rid('aisW3')]
async function mk(key, role, name, outlets = []) {
  const email = `${PREFIX}${key}-${RUN}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: name } }); if (error) throw error
  await admin.from('profiles').update({ role, status: 'active', full_name: name, outlet_ids: outlets }).eq('id', data.user.id)
  U[key] = email
}
const d = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10)
const REWRITE = [
  [/permits?.*expire/i, '/tool document_expiries {"within_days":60}'],
  [/annual leave/i, '/tool draft_request {"request_type":"annual_leave","worker":"Ravi Kumar","details":{"from":"2026-12-01","to":"2026-12-05","reason":"Family visit"}}'],
  [/remind/i, '/tool draft_reminder {"title":"Check hostel fire extinguishers","date":"2026-11-06","time":"10:30","worker":"Ravi Kumar"}'],
]
const browser = await chromium.launch()
async function shoot(who, tag, questions = []) {
  for (const [vn, opt] of [['desktop', { viewport: { width: 1440, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }]]) {
    const ctx = await browser.newContext(opt); const p = await ctx.newPage()
    await p.route('**/functions/v1/ai-assistant', async (route) => {
      const req = route.request(); let body = req.postData() || ''
      try { const j = JSON.parse(body); const last = j.messages?.[j.messages.length - 1]; if (last?.role === 'user') { const hit = REWRITE.find(([re]) => re.test(last.text)); if (hit) last.text = hit[1] } body = JSON.stringify(j) } catch { /* */ }
      await route.continue({ postData: body })
    })
    await p.goto(UI); await p.fill('#em', U[who]); await p.fill('#pw', pw); await p.locator('form button[type=submit]').first().click()
    await p.waitForTimeout(5000)
    await p.goto(UI + '#/assistant'); await p.waitForTimeout(2500)
    if (!questions.length) await p.screenshot({ path: `${OUT}${tag}-${vn}.png`, fullPage: false })
    for (const q of questions) { await p.fill('.ai-compose textarea', q); await p.keyboard.press('Enter'); await p.waitForSelector('.ai-typing, .ai-dots', { state: 'detached', timeout: 30000 }).catch(() => {}); await p.waitForTimeout(3500) }
    if (questions.length) {
      await p.screenshot({ path: `${OUT}${tag}-${vn}.png`, fullPage: false })
      const row = p.locator('tr.dt-click').first(); if (vn === 'desktop' && await row.count()) { await row.locator('td').nth(3).click({ force: true }); await p.waitForTimeout(600); await p.screenshot({ path: `${OUT}${tag}-${vn}-expanded.png`, fullPage: false }) }
    }
    await ctx.close()
  }
}
try {
  if (aiSecrets().some((n) => n === 'AI_API_KEY')) throw new Error('real key on TEST — stop')
  await mk('ceo', 'super_admin', 'Shot CEO'); await mk('om', 'outlet_manager', 'Shot Outlet Manager', [OA]); await mk('hrm', 'hr_manager', 'Shot HR Manager', [OA])
  const now = new Date().toISOString()
  const wk = (id, no, name, nat, permit, pass) => ({ entity: 'workers', id, worker_id: id, deleted: false, client_ts: now, data: { id, workerNo: no, fullName: name, nationality: nat, status: 'Active', outletId: OA, position: 'Kitchen Helper', documents: [{ type: 'Passport', number: pass, expiryDate: d(900) }, { type: 'Work Permit / PLKS (VP(TE))', number: 'PLKS-' + no, expiryDate: permit }] } })
  await admin.from('records').upsert([
    { entity: 'outlets', id: OA, deleted: false, client_ts: now, data: { id: OA, name: 'Sunrise Café KLCC', type: 'Restaurant', companyId: 'main' } },
    wk(W[0], 'SC-101', 'Ravi Kumar', 'India', d(12), 'P8812345R21'), wk(W[1], 'SC-102', 'Bishnu Thapa', 'Nepal', d(34), 'N44556677'), wk(W[2], 'SC-103', 'Rahim Uddin', 'Bangladesh', d(51), 'BD0099887'),
  ])
  if (aiSecrets().length) cli(`secrets unset ${aiSecrets().join(' ')}`)
  await new Promise((r) => setTimeout(r, 8000))
  await shoot('ceo', '01-ceo-not-switched-on')
  cli('secrets set AI_PROVIDER=mock AI_ALLOW_MOCK=1'); await new Promise((r) => setTimeout(r, 15000))
  await shoot('ceo', '02-ceo-ready')
  await shoot('om', '03-om-expiries-table', ['Whose permits expire in the next 60 days?'])
  await shoot('hrm', '04-hrm-draft-request', ['Draft annual leave for Ravi Kumar, 1–5 Dec, family visit'])
  await shoot('hrm', '05-hrm-reminder', ['Remind me to check the hostel fire extinguishers on 6 Nov 10:30'])
} catch (e) { console.log('ERROR', e.message) } finally {
  await browser.close()
  try { const left = aiSecrets(); if (left.length) cli(`secrets unset ${left.join(' ')}`) } catch (e) { console.log('WARN unset', e.message) }
  const n = await cleanupOwn(admin, PREFIX); await admin.from('records').delete().in('id', [OA, ...W])
  console.log(`cleanup: ${n} users; AI_* on TEST: ${aiSecrets().join(', ') || 'none'}`); console.log(fs.readdirSync(OUT).join('\n'))
}
