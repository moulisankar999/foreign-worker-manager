// AI Assistant (v1.5.0): dormant without a key, then a deterministic MOCK provider (TEST only) for role scoping,
// passport / salary masking, draft → confirm flow, audit + hide-superiors, rate limit and reply language.
// SAFETY: TEST project only. Creates and removes only its own fwai-*@example.com users and *-<run> records.
// Sets AI_PROVIDER=mock + AI_ALLOW_MOCK=1 on TEST only and removes them again. Never prints secrets.
import { createRequire } from 'module'
import fs from 'fs'
import crypto from 'crypto'
import { execSync } from 'child_process'
import { RUN, rid, cleanupOwn, keepConfig } from './_own.mjs'
const require = createRequire(new URL('../package.json', import.meta.url))
const { createClient } = require('@supabase/supabase-js')
const LIVE_REF = 'gnepquxtwkyffjmoydnv'
const env = Object.fromEntries(fs.readFileSync(new URL('../.secrets.env', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const URL_ = env.TEST_SUPABASE_URL, ANON = env.TEST_ANON_KEY, SERVICE = env.TEST_SERVICE_ROLE_KEY, REF = env.TEST_PROJECT_REF
if (!URL_ || !REF || REF === LIVE_REF || URL_.includes(LIVE_REF) || !URL_.includes(REF)) { console.error('ABORT: not the test project'); process.exit(1) }
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(URL_, SERVICE, opts)
const PREFIX = 'fwai-'
let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : String(extra).slice(0, 400)) }
const pw = crypto.randomBytes(12).toString('hex')
const U = {}
const OA = rid('aiOA'), OB = rid('aiOB'), W1 = rid('aiW1'), W2 = rid('aiW2'), TAG = `AITEST${RUN}`
const cli = (args) => execSync(`npx -y supabase@latest ${args} --project-ref ${REF}`, { cwd: new URL('..', import.meta.url).pathname, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: { ...process.env, ...env } })
const aiSecrets = () => [...cli('secrets list -o json').matchAll(/"name"\s*:\s*"([A-Z0-9_]+)"/g)].map((m) => m[1]).filter((n) => /^AI_/.test(n))
async function mk(key, role, outlets = []) {
  const email = `${PREFIX}${key}-${RUN}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: `AI ${key.toUpperCase()}` } })
  if (error) throw error
  const up = await admin.from('profiles').update({ role, status: 'active', full_name: key === 'ceo' ? 'AITEST Chief Zed' : `AI ${key.toUpperCase()}`, outlet_ids: outlets }).eq('id', data.user.id)
  if (up.error) throw up.error
  const c = createClient(URL_, ANON, opts); const s = await c.auth.signInWithPassword({ email, password: pw }); if (s.error) throw s.error
  U[key] = { id: data.user.id, c }
}
async function ai(who, body) {
  const { data, error } = await U[who].c.functions.invoke('ai-assistant', { body })
  if (error) { let j = {}; try { j = await error.context.json() } catch { /* */ } return { _status: error.context?.status, ...j } }
  return data
}
const ask = (who, text, lang = 'en') => ai(who, { op: 'chat', messages: [{ role: 'user', text }], lang })
const used = async (who) => (await U[who].c.rpc('ai_status')).data?.used
async function waitEnabled(want) {
  for (let i = 0; i < 30; i++) { const s = await ai('ceo', { op: 'status' }); if (!!s.enabled === want) return true; await new Promise((r) => setTimeout(r, 3000)) }
  return false
}
const restoreCfg = await keepConfig(admin, ['ai_assistant'])
let restoreSecrets = []
try {
  const before = aiSecrets()
  if (before.length) { console.log('note: removing existing AI_* secrets on TEST for the no-key phase:', before.join(', ')); restoreSecrets = before.filter((n) => n !== 'AI_PROVIDER' && n !== 'AI_ALLOW_MOCK') }
  if (restoreSecrets.length) throw new Error('TEST has a real AI key set — not touching it. Remove it manually or run with that state in mind.')
  if (before.length) cli(`secrets unset ${before.join(' ')}`)

  await mk('ceo', 'super_admin'); await mk('gm', 'general_manager'); await mk('hra', 'hr_admin'); await mk('hrm', 'hr_manager')
  await mk('om', 'outlet_manager', [OA]); await mk('viewer', 'viewer', [OA])
  const now = new Date().toISOString()
  const soon = new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10)
  await admin.from('records').upsert([
    { entity: 'outlets', id: OA, deleted: false, client_ts: now, data: { id: OA, name: `AI Outlet A ${RUN}`, type: 'Restaurant', companyId: 'main' } },
    { entity: 'outlets', id: OB, deleted: false, client_ts: now, data: { id: OB, name: `AI Outlet B ${RUN}`, type: 'Restaurant', companyId: 'main' } },
    { entity: 'workers', id: W1, worker_id: W1, deleted: false, client_ts: now, data: { id: W1, workerNo: `A1-${RUN}`, fullName: `${TAG} Ravi Alpha`, nationality: 'India', status: 'Active', outletId: OA, initialBasicPay: 1777, phoneMY: '+60123334444', bankAccount: '9988776655', documents: [{ type: 'Passport', number: 'P1234567X89', expiryDate: '2030-01-01' }, { type: 'Work Permit / PLKS (VP(TE))', number: 'PLKS1', expiryDate: soon }] } },
    { entity: 'workers', id: W2, worker_id: W2, deleted: false, client_ts: now, data: { id: W2, workerNo: `B2-${RUN}`, fullName: `${TAG} Bina Beta`, nationality: 'Nepal', status: 'Active', outletId: OB, initialBasicPay: 1888, documents: [{ type: 'Passport', number: 'N98765432', expiryDate: '2029-05-05' }] } },
  ])

  // ---- Phase 1: no key → dormant
  check('no-key: status is disabled', (await ai('ceo', { op: 'status' })).enabled === false)
  const u0 = await used('ceo')
  const r0 = await ask('ceo', 'hello')
  check('no-key: chat answers "not switched on" and does not call the LLM', r0.disabled === true && /not switched on/i.test(r0.reply || ''), JSON.stringify(r0))
  check('no-key: usage not counted', (await used('ceo')) === u0)
  check('no-key: other roles get the soft message', /not available/i.test((await ask('om', 'hi')).reply || ''))

  // ---- Phase 2: mock provider (TEST only)
  cli('secrets set AI_PROVIDER=mock AI_ALLOW_MOCK=1')
  check('mock: switches on without an app update', await waitEnabled(true))
  let st = await ai('om', { op: 'status' })
  check('status hides the model from non-CEO roles', st.enabled && st.model === undefined && st.role === 'outlet_manager', JSON.stringify(st))

  let r = await ask('ceo', `/tool search_workers {"query":"${TAG}"}`)
  const ceoRows = r.tables?.[0]?.rows || []
  check('CEO sees both test workers', ceoRows.length === 2, JSON.stringify(r).slice(0, 300))
  check('passport masked to last 4 in what the LLM saw', r.llm_saw?.includes('7X89') && !r.llm_saw.includes('P1234567X89') && !r.llm_saw.includes('N98765432'), r.llm_saw?.slice(0, 200))
  check('phone, bank details never sent', !r.llm_saw.includes('+60123334444') && !r.llm_saw.includes('9988776655'))
  check('CEO (salary access) sees basic pay', r.llm_saw.includes('1777'))
  check('rows carry links into the app', ceoRows.every((x) => String(x.link).startsWith('/workers/')))
  check('system prompt states role and masking rules', /role: CEO/.test(r.llm_saw) && /masked/.test(r.llm_saw))

  r = await ask('om', `/tool search_workers {"query":"${TAG}"}`)
  const omRows = r.tables?.[0]?.rows || []
  check('Outlet Manager sees only own outlet (1 worker)', omRows.length === 1 && omRows[0].id === W1, JSON.stringify(omRows))
  check('Outlet Manager: pay never sent to the LLM', !r.llm_saw.includes('1777') && !r.llm_saw.includes('basic_pay'))
  r = await ask('om', '/tool quota_overview {}')
  check('Outlet Manager refused quota overview', /not part of your role/.test(r.llm_saw || ''), r.llm_saw?.slice(-300))
  r = await ask('om', `/tool draft_note {"worker":"${TAG} Bina","text":"x"}`)
  check('Outlet Manager cannot draft on a worker outside scope', (r.drafts || []).length === 0 && /No worker matching/.test(r.llm_saw || ''))
  r = await ask('om', `/tool document_expiries {"within_days":60}`)
  check('expiries: OM sees the permit expiring in 20 days', (r.tables?.[0]?.rows || []).some((x) => x.id === W1 && x.document === 'permit'))

  r = await ask('viewer', `/tool draft_note {"worker":"${TAG} Ravi","text":"good"}`)
  check('Viewer cannot draft notes / requests', (r.drafts || []).length === 0 && /view-only/.test(r.llm_saw || ''))
  const vd = await U.viewer.c.rpc('ai_draft_create', { p_kind: 'request', p_title: 'x', p_worker_id: W1, p_payload: {} })
  check('Viewer refused by the database too', !!vd.error)

  r = await ask('hrm', `/tool draft_request {"request_type":"annual_leave","worker":"${TAG} Ravi","details":{"from":"2026-12-01","to":"2026-12-05","reason":"Family visit"}}`)
  const d = r.drafts?.[0]
  check('HR Manager gets a request draft (not submitted)', d && d.kind === 'request' && d.payload.missing.length === 0, JSON.stringify(r).slice(0, 300))
  const before1 = (await admin.from('requests').select('id').eq('worker_id', W1)).data.length
  check('draft alone creates no request', before1 === 0)
  const other = await U.om.c.rpc('ai_draft_decide', { p_id: d.id, p_status: 'confirmed', p_ref: 'x' })
  check("another user cannot confirm someone else's draft", !!other.error)
  const cr = await U.hrm.c.rpc('request_create', { p_type: 'annual_leave', p_worker_id: W1, p_title: d.payload.title, p_data: d.payload.data, p_amount: null, p_priority: 'normal' })
  check('Confirm runs the normal request_create', !cr.error && cr.data?.status === 'submitted', cr.error?.message)
  const dec = await U.hrm.c.rpc('ai_draft_decide', { p_id: d.id, p_status: 'confirmed', p_ref: `#${cr.data?.ref_no}` })
  check('draft marked confirmed', !dec.error, dec.error?.message)
  const dd = (await admin.from('ai_drafts').select('status,result_ref').eq('id', d.id).single()).data
  check('draft row: confirmed + request ref', dd.status === 'confirmed' && String(dd.result_ref).startsWith('#'), JSON.stringify(dd))
  const again = await U.hrm.c.rpc('ai_draft_decide', { p_id: d.id, p_status: 'discarded', p_ref: null })
  check('a decided draft cannot be decided again', !!again.error)
  r = await ask('hrm', `/tool draft_request {"request_type":"approve_everything","worker":"${TAG} Ravi"}`)
  check('unknown request types refused', (r.drafts || []).length === 0 && /Unknown request type/.test(r.llm_saw))

  const acts = (await admin.from('audit_log').select('action,user_id,details').in('user_id', [U.hrm.id, U.ceo.id]).like('action', 'ai.%')).data || []
  check('audit: ai.chat, ai.draft, ai.confirm recorded', ['ai.chat', 'ai.draft', 'ai.confirm'].every((a) => acts.some((x) => x.action === a && x.user_id === U.hrm.id)), JSON.stringify(acts.map((x) => x.action)))
  check('audit: chat log holds tool names only (no question text)', !JSON.stringify(acts).includes(TAG) || acts.filter((x) => x.action === 'ai.chat').every((x) => !JSON.stringify(x.details).includes(TAG)))
  const gmSees = (await U.gm.c.from('audit_log').select('id').eq('user_id', U.ceo.id).like('action', 'ai.%')).data || []
  check("GM cannot see the CEO's assistant audit rows (hide superiors)", gmSees.length === 0 && acts.some((x) => x.user_id === U.ceo.id))
  const ownU = (await U.gm.c.from('ai_usage').select('user_id')).data || []
  check('usage rows: each user sees only their own', ownU.every((x) => x.user_id === U.gm.id))

  r = await ask('hra', '/tool help_search {"query":"renew permit"}', 'ms')
  check('reply language passed through (ms)', /^MOCK\(ms\)/.test(r.reply) && /Bahasa Melayu/.test(r.llm_saw), r.reply)
  check('help search returns manual content', /guides/.test(r.llm_saw))
  r = await ask('hra', '/tool rules_regulations {"query":"FOMEMA"}')
  check('rules tool runs for HR Admin', r.tools?.includes('rules_regulations') && !/not part of your role/.test(r.llm_saw))
  r = await ask('ceo', '/tool followups {}')
  check('followups tool runs for CEO', r.tools?.includes('followups') && !/"error"/.test(r.llm_saw.split('"followups"').pop() || ''))
  r = await ask('hrm', `/tool draft_reminder {"title":"Check hostel","date":"2026-11-06","time":"10:30","worker":"${TAG} Ravi"}`)
  check('reminder draft prepared', r.drafts?.[0]?.kind === 'reminder' && r.drafts[0].payload.time === '10:30')

  // ---- rate limit (restored afterwards)
  const nOm = await used('om')
  check('CEO only can change the limit', !!(await U.gm.c.rpc('ai_set_limit', { p_limit: 5 })).error)
  await U.ceo.c.rpc('ai_set_limit', { p_limit: nOm })
  r = await ask('om', 'one more?')
  check('daily limit reached → friendly refusal (429)', r._status === 429 && /used all/.test(r.error || ''), JSON.stringify(r))
  check('refused question not counted', (await used('om')) === nOm)
} catch (e) {
  fail++; console.log('FAIL (crash)', e.message)
} finally {
  await restoreCfg()
  try { const left = aiSecrets(); if (left.length) cli(`secrets unset ${left.join(' ')}`) } catch (e) { console.log('WARN: could not unset mock secrets', e.message) }
  const n = await cleanupOwn(admin, PREFIX)
  await admin.from('records').delete().in('id', [OA, OB, W1, W2])
  console.log(`cleanup: ${n} own users removed; AI_* secrets on TEST now: ${aiSecrets().join(', ') || 'none'}`)
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
