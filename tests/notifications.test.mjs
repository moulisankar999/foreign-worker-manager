// Notifications test: outbox, recipients by role/outlet, SMS rules, email links, opt-out, quiet hours, dedupe, delivery log.
// SAFETY: TEST project only (same guards as server-rules.test.mjs). Providers are the mock-provider function
// deployed by tests/deploy-test-functions.sh — no real SMS/email is ever sent.
import { createRequire } from 'module'
import fs from 'fs'
import crypto from 'crypto'
const require = createRequire(new URL('../package.json', import.meta.url))
const { createClient } = require('@supabase/supabase-js')
const LIVE_REF = 'gnepquxtwkyffjmoydnv'
const env = Object.fromEntries(fs.readFileSync(new URL('../.secrets.env', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const URL_ = env.TEST_SUPABASE_URL, ANON = env.TEST_ANON_KEY, SERVICE = env.TEST_SERVICE_ROLE_KEY
if (!URL_ || URL_.includes(LIVE_REF) || !URL_.includes(env.TEST_PROJECT_REF)) { console.error('ABORT: not the test project'); process.exit(1) }
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(URL_, SERVICE, opts)
{ const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 }); if (error) throw error
  if (data.users.some((u) => !/@example\.com$/.test(u.email || ''))) { console.error('ABORT: project has real users'); process.exit(1) } }
{ const { error } = await admin.from('mock_provider_log').select('id').limit(1); if (error) { console.error('ABORT: mock provider not set up (run tests/deploy-test-functions.sh)'); process.exit(1) } }

let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : extra) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pw = crypto.randomBytes(12).toString('hex'), stamp = Date.now()
const users = {}
async function mk(key) {
  const email = `fwn-${key}-${stamp}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: key.toUpperCase() } })
  if (error) throw error
  const c = createClient(URL_, ANON, opts)
  const s = await c.auth.signInWithPassword({ email, password: pw }); if (s.error) throw s.error
  return (users[key] = { id: data.user.id, c, email })
}
async function dispatch() {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(`${URL_}/functions/v1/notify-dispatch`, { method: 'POST', headers: { 'x-cron-secret': env.TEST_CRON_SECRET, 'Content-Type': 'application/json' }, body: '{}' })
    const j = await r.json()
    const { count } = await admin.from('notification_deliveries').select('id', { count: 'exact', head: true }).in('status', ['queued', 'sending']).lte('next_attempt_at', new Date().toISOString())
    if (!count) return j
    await sleep(3000)
  }
}
const deliveries = async (event) => (await admin.from('notification_deliveries').select('*').eq('event', event).order('id')).data || []

// fresh state (TEST project only)
await admin.from('records').delete().neq('id', '__none__')
await admin.from('requests').delete().neq('type', '__none__')
await admin.from('documents').delete().neq('category', '__none__')
await admin.from('notification_deliveries').delete().gte('id', 0)
await admin.from('notification_events').delete().gte('id', 0)
await admin.from('mock_provider_log').delete().gte('id', 0)
await admin.from('whatsapp_inbound').delete().gte('id', 0)
{ const { data } = await admin.auth.admin.listUsers({ perPage: 1000 }); for (const u of data.users) await admin.auth.admin.deleteUser(u.id) }
const seed = (key) => JSON.parse(new RegExp(`\\('${key}', '(.+?)'::jsonb\\)`).exec(fs.readFileSync(new URL(`../supabase/migrations/${key === 'notifications' ? '006_whatsapp' : '003_roles_requests_vault'}.sql`, import.meta.url), 'utf8'))[1].replace(/''/g, "'"))
const DEFAULT_CFG = seed('notifications')
// providers are OFF by default; this test switches every channel on to exercise them against the mock provider
const NCFG = { ...DEFAULT_CFG, enabled: { in_app: true, push: true, email: true, sms: true, whatsapp: true } }
await admin.from('app_config').update({ value: seed('approval_rules') }).eq('key', 'approval_rules')
await admin.from('app_config').update({ value: { ...NCFG, smsSender: 'ACME', quietHours: { ...NCFG.quietHours, enabled: false } } }).eq('key', 'notifications')

try {
  const S = await mk('super')
  for (const k of ['hra', 'hrm', 'om1', 'om2']) await mk(k)
  const setRole = (who, role, outlet_ids = []) => S.c.from('profiles').update({ role, status: 'active', outlet_ids }).eq('id', users[who].id)
  await setRole('hra', 'hr_admin'); await setRole('hrm', 'hr_manager'); await setRole('om1', 'outlet_manager', ['O1']); await setRole('om2', 'outlet_manager', ['O2'])
  const ua = await deliveries('user_awaiting_approval')
  check('new sign-up queues "user awaiting approval" for user admins', ua.some((d) => d.user_id === S.id && d.channel === 'in_app'))

  // default config: outbound providers OFF → nothing but in-app/push is queued
  await admin.from('app_config').update({ value: { ...DEFAULT_CFG, smsSender: 'ACME' } }).eq('key', 'notifications')
  await admin.rpc('notify', { p_event: 'emergency_submitted', p_worker: null, p_request: null, p_vars: {}, p_dedupe: 'off-test', p_users: [S.id] })
  const off = await deliveries('emergency_submitted')
  check('default: WhatsApp/SMS/email master switches OFF → only in-app + push queued', off.length > 0 && off.every((d) => ['in_app', 'push'].includes(d.channel)), JSON.stringify(off.map((d) => d.channel)))
  await admin.from('notification_deliveries').delete().gte('id', 0); await admin.from('notification_events').delete().gte('id', 0)
  await admin.from('app_config').update({ value: { ...NCFG, smsSender: 'ACME', quietHours: { ...NCFG.quietHours, enabled: false } } }).eq('key', 'notifications')

  // contact details
  let r = await users.om1.c.rpc('update_my_contact', { p_phone: '012-345 6789', p_optout: [] })
  const p = (await admin.from('profiles').select('phone').eq('id', users.om1.id).single()).data
  check('phone normalised to E.164 +60', !r.error && p.phone === '+60123456789', JSON.stringify(r.error || p))
  r = await users.om2.c.rpc('update_my_contact', { p_phone: 'abc', p_optout: [] })
  check('invalid phone rejected', !!r.error)
  await users.om2.c.rpc('update_my_contact', { p_phone: '+60 11-2222 3333', p_optout: [] })
  await users.hrm.c.rpc('update_my_contact', { p_phone: '0198887777', p_optout: ['remark_added:email', 'request_submitted:in_app'] })
  r = await users.hra.c.rpc('update_my_contact', { p_phone: '0176665555', p_optout: [], p_wa_optin: true })
  const hp = (await admin.from('profiles').select('wa_optin,wa_optin_at').eq('id', users.hra.id).single()).data
  check('WhatsApp opt-in recorded with date', !r.error && hp.wa_optin === true && !!hp.wa_optin_at, JSON.stringify(r.error || hp))
  await users.om2.c.rpc('update_my_contact', { p_phone: '+60 11-2222 0000', p_optout: [], p_wa_optin: true }) // mock: "not on WhatsApp"
  const sneaky = await users.om1.c.from('profiles').update({ role: 'super_admin' }).eq('id', users.om1.id).select()
  check('user still cannot change his own role', !!sneaky.error || !sneaky.data?.length)

  const now = () => new Date().toISOString()
  const W = (id, outletId, extra = {}) => ({ entity: 'workers', id, deleted: false, client_ts: now(), data: { id, workerNo: 'FW-' + id, fullName: 'Ram Bahadur ' + id, outletId, passportNo: 'PA1234567', phoneMY: '0134445555', documents: [], ...extra } })
  const in10 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10)
  await S.c.rpc('push_records', { p_rows: [{ entity: 'outlets', id: 'O1', client_ts: now(), data: { id: 'O1', name: 'Outlet One' } }, { entity: 'outlets', id: 'O2', client_ts: now(), data: { id: 'O2', name: 'Outlet Two' } },
    W('W1', 'O1', { waOptIn: true, waOptInAt: '2026-10-01', documents: [{ id: 'd1', type: 'Work permit (PLKS)', expiryDate: in10 }, { id: 'd2', type: 'Passport', expiryDate: '2020-01-01' }] }),
    W('W2', 'O2', { documents: [{ id: 'd3', type: 'FOMEMA medical', expiryDate: '2021-01-01' }] })] })

  // request → recipients by role + outlet
  const create = (who, type, wid, data = {}, amount = null) => users[who].c.rpc('request_create', { p_type: type, p_worker_id: wid, p_title: type, p_data: data, p_amount: amount, p_priority: 'normal' })
  const act = (who, id, action, comment = null) => users[who].c.rpc('request_act', { p_id: id, p_action: action, p_comment: comment, p_patch: null })
  const q1 = await create('om1', 'annual_leave', 'W1', { from: '2026-12-01', to: '2026-12-05' })
  let sub = await deliveries('request_submitted')
  const subUsers = new Set(sub.filter((d) => d.channel === 'in_app').map((d) => d.user_id))
  check('submitted → HR manager notified (in-app)', sub.some((d) => d.user_id === users.hrm.id) && !sub.some((d) => d.user_id === users.hrm.id && d.channel === 'in_app'), 'opted out of in_app so only email/push')
  check('actor (requesting OM) is not notified of his own action', !subUsers.has(users.om1.id))
  check('other outlet manager not notified', !sub.some((d) => d.user_id === users.om2.id))
  check('non-critical request_submitted has no SMS by default', !sub.some((d) => d.channel === 'sms'))
  const hrmWa = sub.find((d) => d.channel === 'whatsapp' && d.user_id === users.hrm.id)
  check('WhatsApp not sent without opt-in (skipped "no WhatsApp opt-in")', hrmWa?.status === 'skipped' && hrmWa.last_error === 'no WhatsApp opt-in', JSON.stringify(hrmWa))
  check('non-critical: no SMS fallback for missing opt-in', !sub.some((d) => d.channel === 'sms'))
  await act('hrm', q1.data.id, 'forward', 'ok')
  await act('hra', q1.data.id, 'approve', 'enjoy')
  const ap = await deliveries('request_approved')
  check('approved → requester (OM) notified', ap.some((d) => d.user_id === users.om1.id && d.channel === 'in_app'))
  const ld = await deliveries('leave_decided')
  const wwa = ld.find((d) => d.channel === 'whatsapp' && !d.user_id)
  check('leave decision → opted-in worker gets WhatsApp template on his own phone (+60)', wwa?.address === '+60134445555' && ['queued', 'sending', 'sent'].includes(wwa.status) && wwa.wa_template === 'fwm_worker_leave_update', JSON.stringify(ld))

  // emergency (critical) → SMS to HR manager with RM0 prefix, worker code, no name/link/phone
  const em = await create('om1', 'emergency_leave', 'W1', { reasonKey: 'death', relationship: 'Mother', from: '2026-11-01', to: '2026-11-14' })
  const es = await deliveries('emergency_submitted')
  const hrSms = es.find((d) => d.channel === 'sms' && d.user_id === users.hrm.id)
  check('emergency (critical), HR manager without WhatsApp opt-in → SMS fallback', !!hrSms && hrSms.address === '+60198887777' && !!hrSms.fallback_of, JSON.stringify(es.map((d) => [d.channel, d.status, d.user_id === users.hrm.id])))
  const hraWa = es.find((d) => d.channel === 'whatsapp' && d.user_id === users.hra.id)
  check('emergency → opted-in HR admin queued on WhatsApp template fwm_emergency_leave', ['queued', 'sending', 'sent'].includes(hraWa?.status) && hraWa.wa_template === 'fwm_emergency_leave' && hraWa.vars?.workerNo === 'FW-W1', JSON.stringify(hraWa))
  check('opted-in HR admin gets no SMS', !es.some((d) => d.channel === 'sms' && d.user_id === users.hra.id))
  check('SMS starts with "RM0 ACME: "', hrSms?.body.startsWith('RM0 ACME: '), hrSms?.body)
  check('SMS uses worker code, not name / passport', hrSms?.body.includes('FW-W1') && !hrSms.body.includes('Ram') && !hrSms.body.includes('PA1234567'), hrSms?.body)
  check('SMS has no link and no phone number', !/https?:|www\.|#\/|\d{8,}/.test(hrSms?.body || ''), hrSms?.body)
  check('SMS fits one message (≤160)', (hrSms?.body.length || 999) <= 160)
  const em_mail = es.find((d) => d.channel === 'email' && d.user_id === users.hrm.id)
  check('email carries the deep link to the request', em_mail?.link?.includes('#/requests/' + em.data.id))

  // HR uploads home-leave ticket → OM notified; OM-uploaded emergency ticket → no ticket notice
  const hl = await create('om1', 'home_leave', 'W1', { from: '2027-01-10', to: '2027-02-10' })
  await users.hrm.c.from('documents').insert({ worker_id: 'W1', category: 'Flight ticket', title: 'AK ticket', file_path: 'vault/W1/t.pdf', request_id: hl.data.id, uploaded_by: users.hrm.id })
  await users.om1.c.from('documents').insert({ worker_id: 'W1', category: 'Flight ticket', title: 'Emergency ticket', file_path: 'vault/W1/e.pdf', request_id: em.data.id, uploaded_by: users.om1.id })
  const tu = await deliveries('ticket_uploaded')
  check('HR ticket upload → outlet manager notified in-app + SMS', tu.some((d) => d.user_id === users.om1.id && d.channel === 'in_app') && tu.some((d) => d.user_id === users.om1.id && d.channel === 'sms'), JSON.stringify(tu.map((d) => [d.channel, d.recipient])))
  check('ticket notice link opens the request', tu.find((d) => d.user_id === users.om1.id)?.link?.includes(hl.data.id))
  check('OM-uploaded emergency ticket does not trigger "ticket booked"', tu.filter((d) => d.channel === 'in_app').length === 1)

  // opt-out: non-critical honoured, critical not
  await users.om1.c.rpc('push_records', { p_rows: [{ entity: 'remarks', id: 'RM1', client_ts: now(), data: { workerId: 'W1', text: 'late' } }] })
  const rm = await deliveries('remark_added')
  check('opt-out honoured for non-critical (HR manager remark email)', rm.some((d) => d.user_id === users.hrm.id) && !rm.some((d) => d.user_id === users.hrm.id && d.channel === 'email'))
  await users.hrm.c.rpc('update_my_contact', { p_phone: '0198887777', p_optout: ['emergency_submitted:sms'] })
  await create('om1', 'emergency_leave', 'W1', { reasonKey: 'accident', relationship: 'Brother', from: '2026-11-20', to: '2026-11-25' })
  const es2 = (await deliveries('emergency_submitted')).filter((d) => d.user_id === users.hrm.id && d.channel === 'sms')
  check('critical events ignore personal opt-out', es2.length === 2)

  // sweep: expiry + dedupe
  let sw = await admin.rpc('notify_sweep'); await admin.rpc('notify_sweep')
  const exp = await deliveries('doc_expiring'), ex2 = await deliveries('doc_expired')
  check('sweep queues "expiring in 30 days" to HR + the outlet manager', exp.some((d) => d.user_id === users.om1.id) && exp.some((d) => d.user_id === users.hrm.id), JSON.stringify(sw))
  check('sweep queues "expired" (critical; SMS fallback for people without WhatsApp)', ex2.some((d) => d.channel === 'sms' && d.fallback_of))
  check('running the sweep twice does not duplicate', (await admin.from('notification_events').select('id').eq('event', 'doc_expiring')).data.length === 1)
  check('expired doc of outlet-2 worker → opted-in OM2 queued on WhatsApp', ex2.some((d) => d.user_id === users.om2.id && d.channel === 'whatsapp'))
  check('expiry notice not sent to other outlet manager', !exp.some((d) => d.user_id === users.om2.id))

  // dispatch through the mock providers
  const dj = await dispatch()
  const log = (await admin.from('mock_provider_log').select('*').order('id')).data
  const smsCalls = log.filter((l) => l.path.startsWith('/sms')), mailCalls = log.filter((l) => l.path.startsWith('/email'))
  check('dispatcher used OneWaySMS adapter (GET with apiusername/mobileno/languagetype)', smsCalls.length > 0 && smsCalls.every((c) => c.query.apiusername === 'mock-user' && /^60\d+$/.test(c.query.mobileno) && c.query.languagetype === '1'), JSON.stringify(dj))
  check('every SMS sent starts with RM0 and has no URL', smsCalls.every((c) => c.query.message.startsWith('RM0 ACME: ') && !/https?:|www\./.test(c.query.message)))
  check('dispatcher used Brevo adapter for email', mailCalls.length > 0 && mailCalls.every((c) => c.has_key && JSON.parse(c.body).sender.email === 'noreply@example.com'))
  check('email html has "Open in FW Manager" link', mailCalls.some((c) => JSON.parse(c.body).htmlContent.includes('#/requests/')))
  const sent = (await admin.from('notification_deliveries').select('channel,status,cost,provider,provider_id').in('channel', ['sms', 'email'])).data
  const smsSent = sent.filter((d) => d.channel === 'sms' && d.status === 'sent')
  check('SMS delivery logged with provider id and cost RM0.115', smsSent.length > 0 && smsSent.every((d) => d.provider === 'onewaysms' && d.provider_id && Number(d.cost) === 0.115), JSON.stringify(smsSent.slice(0, 2)))
  const push = (await admin.from('notification_deliveries').select('status,last_error').eq('channel', 'push').limit(1)).data[0]
  check('push without VAPID keys → skipped "provider not configured" (not failed)', push?.status === 'skipped' && /not configured/.test(push.last_error), JSON.stringify(push))
  check('no SMS/email deliveries failed', !(await admin.from('notification_deliveries').select('id,last_error').eq('status', 'failed').neq('channel', 'whatsapp')).data.length)

  // WhatsApp Cloud API through the mock Graph endpoint
  const graph = log.filter((l) => l.path.includes('/messages'))
  const g = graph.map((c) => JSON.parse(c.body))
  const ge = g.find((b) => b.template?.name === 'fwm_emergency_leave')
  check('Graph POST /{PHONE_NUMBER_ID}/messages with approved template + params', graph.every((c) => c.path.includes('/mock-phone/messages')) && ge?.messaging_product === 'whatsapp' && ge.to === '60176665555'
    && ge.template.language.code === 'en' && ge.template.components[0].parameters.length === 3 && ge.template.components[0].parameters[1].text === 'FW-W1', JSON.stringify(ge))
  check('template URL button carries the deep link path', ge?.template.components[1]?.parameters[0].text.startsWith('requests/'), JSON.stringify(ge?.template.components))
  check('Graph API version is current (v26.0 default)', graph[0]?.path.includes('/v26.0/'), graph[0]?.path)
  const waSent = (await admin.from('notification_deliveries').select('*').eq('channel', 'whatsapp').eq('status', 'sent')).data
  check('WhatsApp delivery logged: wamid + cost RM0.0564', waSent.length > 0 && waSent.every((d) => d.provider_id?.startsWith('wamid.') && Number(d.cost) === 0.0564), JSON.stringify(waSent.slice(0, 1)))
  const om2wa = (await admin.from('notification_deliveries').select('*').eq('channel', 'whatsapp').eq('user_id', users.om2.id)).data
  const om2fb = (await admin.from('notification_deliveries').select('*').eq('channel', 'sms').eq('user_id', users.om2.id)).data
  check('WhatsApp undeliverable (131026) → failed + SMS fallback sent', om2wa.some((d) => d.status === 'failed' && /131026/.test(d.last_error)) && om2fb.some((d) => d.fallback_of && d.status === 'sent'), JSON.stringify([om2wa.map((d) => [d.status, d.last_error]), om2fb.map((d) => [d.status, d.fallback_of])]))
  // webhook: signature, receipts, failure fallback, inbound STOP
  const WH = `${URL_}/functions/v1/whatsapp-webhook`
  const sign = (b) => 'sha256=' + crypto.createHmac('sha256', 'mock-app-secret').update(b).digest('hex')
  const hook = (payload, sig) => { const b = JSON.stringify(payload); return fetch(WH, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig ?? sign(b) }, body: b }) }
  const v1 = await fetch(`${WH}?hub.mode=subscribe&hub.verify_token=mock-verify&hub.challenge=12345`)
  const v2 = await fetch(`${WH}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345`)
  check('webhook verify handshake (right token → challenge, wrong → 403)', v1.status === 200 && (await v1.text()) === '12345' && v2.status === 403)
  const target = waSent.find((d) => d.user_id === users.hra.id)
  const st = (id, status, extra = {}) => ({ object: 'whatsapp_business_account', entry: [{ id: 'mock-waba', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', statuses: [{ id, status, timestamp: '1', recipient_id: '60176665555', ...extra }] } }] }] })
  const bad = await hook(st(target.provider_id, 'read'), 'sha256=' + '0'.repeat(64))
  check('webhook rejects invalid X-Hub-Signature-256', bad.status === 401)
  await hook(st(target.provider_id, 'delivered')); await hook(st(target.provider_id, 'read')); await hook(st(target.provider_id, 'delivered'))
  const tr = (await admin.from('notification_deliveries').select('status,wa_status,delivered_at').eq('id', target.id).single()).data
  check('receipts: delivered → read, never downgraded', tr.status === 'read' && tr.wa_status === 'read' && !!tr.delivered_at, JSON.stringify(tr))
  const crit = waSent.find((d) => d.critical && d.id !== target.id) || waSent.find((d) => d.critical)
  await admin.from('notification_deliveries').update({ wa_status: null, status: 'sent' }).eq('id', crit.id)
  await hook(st(crit.provider_id, 'failed', { errors: [{ code: 131049, title: 'Not delivered to maintain healthy ecosystem' }] }))
  const cf = (await admin.from('notification_deliveries').select('status,last_error,cost').eq('id', crit.id).single()).data
  const cfb = (await admin.from('notification_deliveries').select('id').eq('fallback_of', crit.id)).data
  check('webhook "failed" → delivery failed (cost 0) + SMS fallback queued', cf.status === 'failed' && /131049/.test(cf.last_error) && Number(cf.cost) === 0 && cfb.length === 1, JSON.stringify([cf, cfb]))
  await hook({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { contacts: [{ wa_id: '60176665555', profile: { name: 'HRA' } }], messages: [{ id: 'wamid.IN1', from: '60176665555', type: 'text', text: { body: 'STOP' } }] } }] }] })
  const inb = (await admin.from('whatsapp_inbound').select('*').eq('wamid', 'wamid.IN1')).data[0]
  const hra2 = (await admin.from('profiles').select('wa_optin').eq('id', users.hra.id).single()).data
  check('inbound reply logged + linked to user; STOP withdraws opt-in', inb?.user_id === users.hra.id && inb.action === 'opt_out' && hra2.wa_optin === false, JSON.stringify([inb, hra2]))
  const ib = await users.hra.c.from('whatsapp_inbound').select('id')
  check('inbound log readable by Super Admin only', (ib.data || []).length === 0 && (await S.c.from('whatsapp_inbound').select('id')).data.length === 1)
  // template admin (mock Meta)
  const wa = await fetch(`${URL_}/functions/v1/wa-admin`, { method: 'POST', headers: { Authorization: 'Bearer ' + (await S.c.auth.getSession()).data.session.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'submit' }) }).then((r) => r.json())
  const subm = Object.values(wa.results || {}).filter((x) => String(x).startsWith('submitted')).length
  check('wa-admin submits missing templates and stores approval status', subm >= 20 && wa.results['fwm_ticket_ready:en'] === 'already on account' && wa.items?.['hello_world:en_US']?.status === 'APPROVED', JSON.stringify(wa).slice(0, 300))
  const posted = (await admin.from('mock_provider_log').select('body').like('path', '%message_templates').eq('method', 'POST')).data.map((x) => JSON.parse(x.body))
  check('submitted templates are UTILITY, no app metadata, app URL filled in', posted.length && posted.every((t) => t.category === 'UTILITY' && !t.fwm && !JSON.stringify(t).includes('__APP_URL__')))
  const wa2 = await fetch(`${URL_}/functions/v1/wa-admin`, { method: 'POST', headers: { Authorization: 'Bearer ' + (await users.hra.c.auth.getSession()).data.session.access_token }, body: '{}' })
  check('wa-admin is Super Admin only', wa2.status === 403)

  // quiet hours defer non-critical, not critical
  const t = new Date(Date.now() + 8 * 3600e3), hh = (h) => String((t.getUTCHours() + h + 24) % 24).padStart(2, '0') + ':00'
  await admin.from('app_config').update({ value: { ...NCFG, smsSender: 'ACME', quietHours: { enabled: true, start: hh(-1), end: hh(2) } } }).eq('key', 'notifications')
  await create('om1', 'salary_advance', 'W1', { month: '2026-11' }, 100)
  await create('om1', 'emergency_leave', 'W1', { reasonKey: 'own_medical', from: '2026-12-20', to: '2026-12-22' })
  await dispatch()
  const nc = (await deliveries('request_submitted')).filter((d) => d.channel === 'email').at(-1)
  const cr = (await deliveries('emergency_submitted')).filter((d) => d.channel === 'email').at(-1)
  check('quiet hours: non-critical email deferred', nc?.status === 'queued' && /quiet/.test(nc.last_error || '') && new Date(nc.next_attempt_at) > new Date(), JSON.stringify(nc))
  check('quiet hours: critical email still sent', cr?.status === 'sent', JSON.stringify(cr))
  await admin.from('app_config').update({ value: { ...NCFG, smsSender: 'ACME', quietHours: { ...NCFG.quietHours, enabled: false } } }).eq('key', 'notifications')

  // inbox + delivery log permissions
  const inbox = await users.om1.c.from('notification_deliveries').select('id,channel,user_id')
  check('user reads only his own in-app inbox', inbox.data.length > 0 && inbox.data.every((d) => d.user_id === users.om1.id && d.channel === 'in_app'))
  const mr = await users.om1.c.rpc('notify_mark_read', { p_ids: null })
  check('mark all read', mr.data === inbox.data.length, JSON.stringify(mr))
  const all = await S.c.from('notification_deliveries').select('id', { count: 'exact', head: true })
  check('super admin sees full delivery log', all.count > inbox.data.length)
  const sum = await S.c.rpc('notify_summary', { p_months: 1 })
  const smsRow = sum.data?.find((x) => x.channel === 'sms' && x.status === 'sent')
  check('monthly summary with SMS count and cost', !!smsRow && Number(smsRow.cost) > 0, JSON.stringify(sum))
  const sum2 = await users.hra.c.rpc('notify_summary', { p_months: 1 })
  check('monthly summary empty for non-super-admin', (sum2.data || []).length === 0)
  const ins = await users.om1.c.from('notification_deliveries').insert({ event: 'x', channel: 'sms', address: '+60123' })
  check('clients cannot insert deliveries directly', !!ins.error)
  const t1 = await S.c.rpc('notify_test', { p_channel: 'sms' })
  check('super admin "send test" SMS skipped when he has no phone', !t1.error && (await admin.from('notification_deliveries').select('status').eq('id', t1.data).single()).data.status === 'skipped')
  const t2 = await users.hrm.c.rpc('notify_test', { p_channel: 'email' })
  check('only super admin can send test messages', !!t2.error)
} catch (e) { fail++; console.log('FAIL exception', e.stack || e) }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
