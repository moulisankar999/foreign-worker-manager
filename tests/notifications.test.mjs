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
{ const { data } = await admin.auth.admin.listUsers({ perPage: 1000 }); for (const u of data.users) await admin.auth.admin.deleteUser(u.id) }
const seed = (key) => JSON.parse(new RegExp(`\\('${key}', '(.+?)'::jsonb\\)`).exec(fs.readFileSync(new URL(`../supabase/migrations/${key === 'notifications' ? '004_notifications' : '003_roles_requests_vault'}.sql`, import.meta.url), 'utf8'))[1].replace(/''/g, "'"))
const NCFG = seed('notifications')
await admin.from('app_config').update({ value: seed('approval_rules') }).eq('key', 'approval_rules')
await admin.from('app_config').update({ value: { ...NCFG, smsSender: 'ACME', quietHours: { ...NCFG.quietHours, enabled: false } } }).eq('key', 'notifications')

try {
  const S = await mk('super')
  for (const k of ['hra', 'hrm', 'om1', 'om2']) await mk(k)
  const setRole = (who, role, outlet_ids = []) => S.c.from('profiles').update({ role, status: 'active', outlet_ids }).eq('id', users[who].id)
  await setRole('hra', 'hr_admin'); await setRole('hrm', 'hr_manager'); await setRole('om1', 'outlet_manager', ['O1']); await setRole('om2', 'outlet_manager', ['O2'])
  const ua = await deliveries('user_awaiting_approval')
  check('new sign-up queues "user awaiting approval" for user admins', ua.some((d) => d.user_id === S.id && d.channel === 'in_app'))

  // contact details
  let r = await users.om1.c.rpc('update_my_contact', { p_phone: '012-345 6789', p_optout: [] })
  const p = (await admin.from('profiles').select('phone').eq('id', users.om1.id).single()).data
  check('phone normalised to E.164 +60', !r.error && p.phone === '+60123456789', JSON.stringify(r.error || p))
  r = await users.om2.c.rpc('update_my_contact', { p_phone: 'abc', p_optout: [] })
  check('invalid phone rejected', !!r.error)
  await users.om2.c.rpc('update_my_contact', { p_phone: '+60 11-2222 3333', p_optout: [] })
  await users.hrm.c.rpc('update_my_contact', { p_phone: '0198887777', p_optout: ['remark_added:email', 'request_submitted:in_app'] })
  await users.hra.c.rpc('update_my_contact', { p_phone: '0176665555', p_optout: [] })
  const sneaky = await users.om1.c.from('profiles').update({ role: 'super_admin' }).eq('id', users.om1.id).select()
  check('user still cannot change his own role', !!sneaky.error || !sneaky.data?.length)

  const now = () => new Date().toISOString()
  const W = (id, outletId, extra = {}) => ({ entity: 'workers', id, deleted: false, client_ts: now(), data: { id, workerNo: 'FW-' + id, fullName: 'Ram Bahadur ' + id, outletId, passportNo: 'PA1234567', phoneMY: '0134445555', documents: [], ...extra } })
  const in10 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10)
  await S.c.rpc('push_records', { p_rows: [{ entity: 'outlets', id: 'O1', client_ts: now(), data: { id: 'O1', name: 'Outlet One' } }, { entity: 'outlets', id: 'O2', client_ts: now(), data: { id: 'O2', name: 'Outlet Two' } },
    W('W1', 'O1', { documents: [{ id: 'd1', type: 'Work permit (PLKS)', expiryDate: in10 }, { id: 'd2', type: 'Passport', expiryDate: '2020-01-01' }] }), W('W2', 'O2')] })

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
  check('whatsapp not queued (coming later)', !sub.some((d) => d.channel === 'whatsapp'))
  await act('hrm', q1.data.id, 'forward', 'ok')
  await act('hra', q1.data.id, 'approve', 'enjoy')
  const ap = await deliveries('request_approved')
  check('approved → requester (OM) notified', ap.some((d) => d.user_id === users.om1.id && d.channel === 'in_app'))
  const ld = await deliveries('leave_decided')
  const wsms = ld.find((d) => d.channel === 'sms' && !d.user_id)
  check('leave decision → worker SMS to his own phone (+60)', wsms?.address === '+60134445555', JSON.stringify(ld))

  // emergency (critical) → SMS to HR manager with RM0 prefix, worker code, no name/link/phone
  const em = await create('om1', 'emergency_leave', 'W1', { reasonKey: 'death', relationship: 'Mother', from: '2026-11-01', to: '2026-11-14' })
  const es = await deliveries('emergency_submitted')
  const hrSms = es.find((d) => d.channel === 'sms' && d.user_id === users.hrm.id)
  check('emergency submitted → urgent SMS to HR manager', !!hrSms && hrSms.address === '+60198887777', JSON.stringify(es.map((d) => [d.channel, d.user_id === users.hrm.id])))
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
  check('sweep queues "expired" (critical, SMS)', ex2.some((d) => d.channel === 'sms'))
  check('running the sweep twice does not duplicate', (await admin.from('notification_events').select('id').eq('event', 'doc_expiring')).data.length === 1)
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
  check('no deliveries failed', !(await admin.from('notification_deliveries').select('id,last_error').eq('status', 'failed')).data.length)

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
