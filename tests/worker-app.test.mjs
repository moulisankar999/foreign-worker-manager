// FW Worker app: login / lockout / PIN admin / RLS isolation / revoke / outlet-manager stage / escalation / confidential.
// SAFETY: runs ONLY against the TEST project (refuses live and any project with non-@example.com users).
// Does NOT wipe the project: every row it makes is tagged with a unique stamp and removed at the end.
// Never prints PINs, passwords or tokens.
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
// suites only create/remove their own prefixed @example.com users, so other (real or other-work) users are left alone

let pass = 0, fail = 0
const results = []
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; results.push({ name, ok }); console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : extra) }
const err = (r) => (r?.error ? r.error.message : 'no error')
const stamp = Date.now().toString(36), t0 = new Date().toISOString()
const pw = crypto.randomBytes(12).toString('hex')
const OA = 'wa-oa-' + stamp, OB = 'wa-ob-' + stamp, WA = 'wa-wa-' + stamp, WB = 'wa-wb-' + stamp, WC = 'wa-wc-' + stamp
const PPA = 'A' + stamp.toUpperCase().slice(-7), PPB = 'B' + stamp.toUpperCase().slice(-7), PPC = 'C' + stamp.toUpperCase().slice(-7)
const U = {}
const staffIds = []
const fn = async (name, body, token = ANON) => {
  const r = await fetch(`${URL_}/functions/v1/${name}`, { method: 'POST', headers: { apikey: ANON, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  let j = {}; try { j = await r.json() } catch { /* empty */ }
  return { status: r.status, ...j }
}
async function staff(key, role, outlets = []) {
  const email = `fww-${key}-${stamp}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: 'T ' + key.toUpperCase() } })
  if (error) throw error
  staffIds.push(data.user.id)
  const up = await admin.from('profiles').update({ role, status: 'active', outlet_ids: outlets, company_ids: [], full_name: 'T ' + key.toUpperCase() }).eq('id', data.user.id)
  if (up.error) throw up.error
  const c = createClient(URL_, ANON, opts); const s = await c.auth.signInWithPassword({ email, password: pw }); if (s.error) throw s.error
  U[key] = { id: data.user.id, c, token: s.data.session.access_token }
}
async function workerLogin(passport, pin) {
  const r = await fn('worker-auth', { action: 'login', passport, pin })
  if (!r.session) return { r }
  const c = createClient(URL_, ANON, opts)
  await c.auth.setSession({ access_token: r.session.access_token, refresh_token: r.session.refresh_token })
  return { r, c, token: r.session.access_token, refresh: r.session.refresh_token }
}
const access = (k, action, workerId) => fn('worker-access', { action, workerId }, U[k].token)
const pins = {}
const wrongPin = (p) => String((Number(p) + 500001) % 1000000).padStart(6, '0')

try {
  const now = new Date().toISOString()
  const plus = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10)
  const w = (id, name, outlet, pp, extra = {}) => ({ entity: 'workers', id, client_ts: now, data: { id, workerNo: 'T' + id.slice(-4), fullName: name, outletId: outlet, nationality: 'India', status: 'Active-Working', joinDate: '2024-01-01', primaryLanguage: 'ta',
    initialBasicPay: 1700, increments: [{ id: 'i1', date: '2025-01-01', oldPay: 1700, newPay: 1800 }], loans: [{ id: 'l1', date: '2025-02-01', type: 'Loan', amount: 1000 }], deductions: [{ id: 'd1', date: '2025-03-01', amount: 250, type: 'Loan', loanId: 'l1' }],
    documents: [{ id: 'p', type: 'Passport', number: pp, expiryDate: plus(400) }, { id: 'k', type: 'Work Permit / PLKS (VP(TE))', number: 'K1', expiryDate: plus(40) }, { id: 'f', type: 'FOMEMA Medical', expiryDate: plus(-5) }], leaves: [], memos: [], ...extra } })
  const ins = await admin.from('records').insert([
    { entity: 'outlets', id: OA, client_ts: now, data: { id: OA, name: 'Worker Test A', companyId: 'main' } },
    { entity: 'outlets', id: OB, client_ts: now, data: { id: OB, name: 'Worker Test B', companyId: 'main' } },
    w(WA, 'Arun Test', OA, PPA), w(WB, 'Bala Test', OB, PPB), w(WC, 'Chitra Test', OA, PPC)])
  if (ins.error) throw ins.error
  await staff('ceo', 'super_admin'); await staff('hrm', 'hr_manager'); await staff('hra', 'hr_admin'); await staff('gm', 'general_manager')
  await staff('oma', 'outlet_manager', [OA]); await staff('omb', 'outlet_manager', [OB]); await staff('vw', 'viewer', [OA])
  await staff('hrb', 'hr_manager', [OB]) // HR manager scoped to outlet B only

  // ---------- admin: who may generate
  let r = await access('oma', 'generate', WA); check('Outlet manager cannot generate a PIN (server)', r.status === 403 && !r.pin, JSON.stringify(r.status))
  r = await access('vw', 'generate', WA); check('Viewer cannot generate a PIN', r.status === 403 && !r.pin)
  r = await access('hrb', 'generate', WA); check('HR manager outside the worker\'s outlet cannot generate', r.status === 403 && !r.pin)
  r = await fn('worker-access', { action: 'generate', workerId: WA }); check('Anonymous call refused', r.status === 401)
  r = await access('hrm', 'generate', WA); check('HR Manager generates a PIN (shown once)', r.ok && /^\d{6}$/.test(r.pin || ''), JSON.stringify({ s: r.status, e: r.error })); pins.A = r.pin
  r = await access('hrm', 'generate', WA); check('Second generate refused (must use reset)', r.status === 409 && !r.pin)
  r = await access('ceo', 'generate', WB); check('CEO generates a PIN', /^\d{6}$/.test(r.pin || '')); pins.B = r.pin
  r = await access('gm', 'generate', WC); check('GM generates a PIN', /^\d{6}$/.test(r.pin || '')); pins.C = r.pin
  const row = (await admin.from('worker_access').select('*').eq('worker_id', WA).single()).data
  check('PIN is not stored in plain text anywhere in worker_access', !JSON.stringify(row).includes(pins.A))
  const aud = (await admin.from('audit_log').select('*').eq('entity_id', WA).eq('action', 'worker_app_generate')).data || []
  check('Generate is audit-logged with who did it', aud.length === 1 && aud[0].user_name === 'T HRM' && aud[0].user_role === 'hr_manager', JSON.stringify(aud.map((a) => [a.user_name, a.user_role])))
  const st = await U.hrm.c.rpc('worker_access_status', { p_worker: WA })
  check('Admin panel status = active', st.data?.status === 'active', err(st))
  const stOm = await U.oma.c.rpc('worker_access_status', { p_worker: WA }); check('Outlet manager cannot read app-access status', !!stOm.error)
  const omRows = await U.oma.c.from('worker_access').select('*'); check('Outlet manager reads no worker_access rows', (omRows.data || []).length === 0)

  // ---------- direct GoTrue with the PIN must not work (pepper)
  const au = (await admin.auth.admin.getUserById(row.user_id)).data.user
  { const c = createClient(URL_, ANON, opts); const s = await c.auth.signInWithPassword({ email: au.email, password: pins.A })
    check('PIN alone cannot sign in directly at Supabase Auth (bypass of lockout impossible)', !!s.error) }
  check('Worker auth user has no staff profile', !(await admin.from('profiles').select('id').eq('id', row.user_id).maybeSingle()).data)

  // ---------- login
  const A = await workerLogin(PPA.toLowerCase().replace(/^(.)/, '$1 '), pins.A)
  check('Worker A logs in with passport (any case / spaces) + PIN', !!A.c, JSON.stringify({ s: A.r.status, e: A.r.error }))
  const B = await workerLogin(PPB, pins.B); check('Worker B logs in', !!B.c)
  const bad1 = await fn('worker-auth', { action: 'login', passport: 'ZZ' + stamp, pin: '135792' })
  const bad2 = await fn('worker-auth', { action: 'login', passport: PPC, pin: wrongPin(pins.C) })
  check('Unknown passport and wrong PIN give the SAME generic error', bad1.status === 401 && bad2.status === 401 && bad1.error === bad2.error, JSON.stringify([bad1, bad2]))

  // ---------- worker reads: only himself
  const me = await A.c.rpc('worker_me')
  check('worker_me returns own profile', me.data?.name === 'Arun Test' && me.data?.outlet === 'Worker Test A', err(me))
  check('worker_me: passport number masked', me.data?.docs?.find((d) => d.type === 'Passport')?.number?.endsWith(PPA.slice(-4)) && !me.data.docs.find((d) => d.type === 'Passport').number.includes(PPA.slice(0, 3)))
  check('worker_me: pay 1800 and loan balance 750', Number(me.data?.basicPay) === 1800 && Number(me.data?.loanBalance) === 750, JSON.stringify([me.data?.basicPay, me.data?.loanBalance]))
  for (const t of ['records', 'requests', 'profiles', 'worker_access', 'audit_log', 'documents', 'request_events', 'app_config']) {
    const q = await A.c.from(t).select('*').limit(5)
    check(`Worker cannot read table ${t} directly`, !!q.error || (q.data || []).length === 0, JSON.stringify(q.data?.length))
  }
  const up = await A.c.from('records').update({ data: {} }).eq('id', WA).select()
  check('Worker cannot edit his own record', !!up.error || (up.data || []).length === 0)
  const rc = await A.c.rpc('request_create', { p_type: 'annual_leave', p_worker_id: WB, p_title: 'x', p_data: {}, p_amount: null, p_priority: 'normal' })
  check('Worker cannot use the staff request_create', !!rc.error)
  for (const f of [['worker_access_apply', { p_actor: U.ceo.id, p_worker: WA, p_action: 'unlock', p_user: null }], ['worker_login_begin', { p_passport: PPA, p_ip_hash: 'x', p_passport_hash: 'y' }], ['worker_kill_sessions', { p_user: row.user_id, p_keep: null }], ['worker_pin_verify', { p_user: row.user_id, p_secret: 'x' }]]) {
    const x1 = await A.c.rpc(f[0], f[1]); const x2 = await U.ceo.c.rpc(f[0], f[1])
    check(`Service-only ${f[0]} refused for worker and staff`, !!x1.error && !!x2.error)
  }

  // ---------- requests: OM stage
  const leave = await A.c.rpc('worker_request_create', { p_type: 'leave', p_data: { kind: 'annual', from: plus(10), to: plus(12), reason: 'Family function' } })
  check('Worker raises leave → waits for outlet manager', leave.data?.status === 'manager_review', err(leave))
  const lq = (await admin.from('requests').select('*').eq('id', leave.data?.id).single()).data
  check('Request logged with source=worker, due date, timestamps', lq?.source === 'worker' && !!lq.manager_due_at && !!lq.created_at && lq.worker_id === WA)
  const bReqs = await B.c.rpc('worker_requests'); check('Worker B cannot see worker A\'s request', !(bReqs.data || []).some((x) => x.id === leave.data?.id), err(bReqs))
  const aReqs = await A.c.rpc('worker_requests'); check('Worker A sees own request', (aReqs.data || []).some((x) => x.id === leave.data?.id))
  const ev = await B.c.rpc('worker_request_cancel', { p_id: leave.data?.id }); check('Worker B cannot cancel A\'s request', !!ev.error)
  const omB = await U.omb.c.from('requests').select('id').eq('id', leave.data?.id); check('Outlet manager of another outlet cannot see it', (omB.data || []).length === 0)
  const omA = await U.oma.c.from('requests').select('id').eq('id', leave.data?.id); check('Outlet manager of the worker\'s outlet sees it', (omA.data || []).length === 1)
  const nd = (await admin.from('notification_deliveries').select('user_id,event').eq('event', 'worker_request_submitted').in('user_id', [U.oma.id, U.omb.id])).data || []
  check('Outlet manager A notified, B not', nd.some((x) => x.user_id === U.oma.id) && !nd.some((x) => x.user_id === U.omb.id), JSON.stringify(nd))
  let x = await U.hrm.c.rpc('request_act', { p_id: leave.data?.id, p_action: 'approve', p_comment: null, p_patch: null })
  check('HR chain cannot act before the outlet manager', !!x.error)
  x = await U.omb.c.rpc('request_manager_act', { p_id: leave.data?.id, p_action: 'approve', p_comment: null }); check('Other outlet manager cannot approve', !!x.error)
  x = await U.oma.c.rpc('request_manager_act', { p_id: leave.data?.id, p_action: 'reject', p_comment: '' }); check('Outlet manager reject needs a reason', !!x.error)
  x = await U.oma.c.rpc('request_manager_act', { p_id: leave.data?.id, p_action: 'approve', p_comment: 'ok' })
  const lq2 = (await admin.from('requests').select('status,manager_decided_by_name').eq('id', leave.data?.id).single()).data
  check('Outlet manager approves → goes to HR chain', !x.error && lq2.status === 'submitted' && lq2.manager_decided_by_name === 'T OMA', err(x))
  x = await U.hrm.c.rpc('request_act', { p_id: leave.data?.id, p_action: 'forward', p_comment: 'ok', p_patch: null })
  check('Then the normal HR chain continues', !x.error, err(x))

  const adv = await A.c.rpc('worker_request_create', { p_type: 'salary_advance', p_data: { amount: 300, reason: 'Medical bills' } })
  x = await U.oma.c.rpc('request_manager_act', { p_id: adv.data?.id, p_action: 'reject', p_comment: 'Already took one this month' })
  const aReqs2 = (await A.c.rpc('worker_requests')).data || []
  const advRow = aReqs2.find((q) => q.id === adv.data?.id)
  check('OM rejection with reason is visible to the worker', advRow?.status === 'rejected' && advRow.events.some((e) => e.action === 'mgr_reject' && e.comment?.includes('Already')), JSON.stringify(advRow?.status))
  check('OM rejection queued for CEO review', !!(await admin.from('ceo_reviews').select('request_id').eq('request_id', adv.data?.id).maybeSingle()).data)

  // ---------- confidential complaint about the manager
  const cp = await A.c.rpc('worker_request_create', { p_type: 'complaint', p_data: { topic: 'Behaviour', reason: 'Shouting every day', aboutManager: true } })
  check('Complaint about manager skips the OM (straight to HR)', cp.data?.status === 'submitted', err(cp))
  x = await U.oma.c.from('requests').select('id').eq('id', cp.data?.id); check('Outlet manager cannot see the confidential complaint', (x.data || []).length === 0)
  x = await U.oma.c.from('request_events').select('id').eq('request_id', cp.data?.id); check('…nor its history', (x.data || []).length === 0)
  x = await U.hrm.c.from('requests').select('id').eq('id', cp.data?.id); check('HR Manager sees it', (x.data || []).length === 1)
  x = await U.ceo.c.from('requests').select('id').eq('id', cp.data?.id); check('CEO sees it', (x.data || []).length === 1)
  const cn = (await admin.from('notification_deliveries').select('user_id').eq('event', 'worker_complaint_confidential').in('user_id', [U.oma.id, U.ceo.id, U.hrm.id])).data || []
  check('CEO + HR notified, outlet manager not', cn.some((n) => n.user_id === U.ceo.id) && cn.some((n) => n.user_id === U.hrm.id) && !cn.some((n) => n.user_id === U.oma.id))
  x = await U.hrm.c.rpc('request_act', { p_id: cp.data?.id, p_action: 'reject', p_comment: 'Spoke to both sides' })
  const cn2 = (await admin.from('notification_deliveries').select('user_id').eq('event', 'request_rejected').in('user_id', [U.oma.id])).data || []
  check('Later updates on the complaint do not reach the outlet manager', !cn2.length)

  // ---------- auto-escalation
  const inc = await A.c.rpc('worker_request_create', { p_type: 'salary_increment', p_data: { reason: 'Two years without increment' } })
  await admin.from('requests').update({ manager_due_at: new Date(Date.now() - 60000).toISOString() }).eq('id', inc.data?.id)
  const esc = await admin.rpc('worker_requests_escalate')
  const iq = (await admin.from('requests').select('status,manager_overdue').eq('id', inc.data?.id).single()).data
  check('Overdue at OM → auto-escalated to HR with flag', esc.data >= 1 && iq.status === 'submitted' && iq.manager_overdue === true, JSON.stringify([esc, iq]))
  const evs = (await admin.from('request_events').select('action').eq('request_id', inc.data?.id)).data || []
  check('Escalation logged', evs.some((e) => e.action === 'auto_escalate'))
  const on = (await admin.from('notification_deliveries').select('user_id').eq('event', 'worker_request_overdue').eq('user_id', U.hrm.id)).data || []
  check('HR notified of the overdue request', on.length >= 1)

  // ---------- passport return + bad input
  const pr = await A.c.rpc('worker_request_create', { p_type: 'passport', p_data: { date: plus(2), reason: 'Bank account' } })
  check('Passport return goes straight to HR', pr.data?.status === 'submitted', err(pr))
  x = await A.c.rpc('worker_request_create', { p_type: 'discipline', p_data: {} }); check('Worker cannot raise other request types (e.g. discipline)', !!x.error)
  x = await A.c.rpc('worker_request_create', { p_type: 'salary_advance', p_data: { amount: -5 } }); check('Invalid amount refused', !!x.error)
  // manager-raised request also visible to the worker (source = manager)
  const mr = await U.oma.c.rpc('request_create', { p_type: 'annual_leave', p_worker_id: WA, p_title: 'Leave', p_data: { from: plus(30), to: plus(31), reason: 'x' }, p_amount: null, p_priority: 'normal' })
  const aReqs3 = (await A.c.rpc('worker_requests')).data || []
  check('Manager-raised request shows to the worker with source=manager', aReqs3.some((q) => q.id === mr.data?.id && q.source === 'manager'), err(mr))

  // ---------- change PIN
  r = await fn('worker-auth', { action: 'change_pin', currentPin: wrongPin(pins.A), newPin: '583920' }, A.token); check('Change PIN needs the current PIN', r.error === 'wrong_pin')
  r = await fn('worker-auth', { action: 'change_pin', currentPin: pins.A, newPin: '123456' }, A.token); check('Weak PIN refused', r.error === 'weak_pin')
  r = await fn('worker-auth', { action: 'change_pin', currentPin: pins.A, newPin: '583920' }, B.token); check('Worker B\'s token cannot change A\'s PIN (wrong PIN for B)', r.error === 'wrong_pin')
  r = await fn('worker-auth', { action: 'change_pin', currentPin: pins.A, newPin: '583920' }, U.ceo.token); check('Staff token cannot use change_pin', r.status === 401)
  const chg = await fn('worker-auth', { action: 'change_pin', currentPin: pins.A, newPin: '583920' }, A.token); check('Worker changes own PIN', chg.ok === true && !!chg.session, JSON.stringify({ s: chg.status, e: chg.error }))
  const oldTry = await workerLogin(PPA, pins.A); check('Old PIN no longer works', !oldTry.c)
  const A2 = await workerLogin(PPA, '583920'); check('New PIN works', !!A2.c); pins.A = '583920'
  { check('Old session ended by PIN change', !!(await A.c.rpc('worker_me')).error)
    const c = createClient(URL_, ANON, opts); await c.auth.setSession({ access_token: chg.session?.access_token, refresh_token: chg.session?.refresh_token })
    const k = await c.rpc('worker_me'); check('PIN change returns a fresh working session', !k.error, k.error?.message) }
  check('PIN change audit-logged', ((await admin.from('audit_log').select('id').eq('entity_id', WA).eq('action', 'worker_app_pin_changed')).data || []).length === 1)

  // ---------- lockout
  for (let i = 0; i < 4; i++) await fn('worker-auth', { action: 'login', passport: PPC, pin: wrongPin(pins.C) }) // + 1 earlier = 5
  let C = await workerLogin(PPC, pins.C); check('After 5 wrong PINs the right PIN is refused (locked)', !C.c && C.r.error === bad2.error)
  const stC = await U.hrm.c.rpc('worker_access_status', { p_worker: WC }); check('Admin panel shows locked', stC.data?.status === 'locked', JSON.stringify(stC.data?.status))
  r = await access('oma', 'unlock', WC); check('Outlet manager cannot unlock', r.status === 403)
  r = await access('hra', 'unlock', WC); check('HR Admin unlocks', r.ok === true)
  C = await workerLogin(PPC, pins.C); check('Login works after unlock', !!C.c)
  // cooldown: lock, then move locked_until into the past
  for (let i = 0; i < 5; i++) await fn('worker-auth', { action: 'login', passport: PPC, pin: wrongPin(pins.C) })
  await admin.from('worker_access').update({ locked_until: new Date(Date.now() - 1000).toISOString() }).eq('worker_id', WC)
  C = await workerLogin(PPC, pins.C); check('Login works again after the cooldown', !!C.c)
  // hard lock after 3 lockouts
  await admin.from('worker_access').update({ lock_count: 2, failed_count: 5, locked_until: null }).eq('worker_id', WC)
  await fn('worker-auth', { action: 'login', passport: PPC, pin: wrongPin(pins.C) })
  await admin.from('worker_access').update({ locked_until: new Date(Date.now() - 1000).toISOString() }).eq('worker_id', WC)
  C = await workerLogin(PPC, pins.C); check('3rd lockout = hard lock: cooldown does not unlock, only an admin', !C.c)
  await access('hrm', 'unlock', WC)
  // concurrency: 12 parallel wrong attempts never allow more than 5 counted tries
  await Promise.all(Array.from({ length: 12 }, () => fn('worker-auth', { action: 'login', passport: PPC, pin: wrongPin(pins.C) })))
  C = await workerLogin(PPC, pins.C); const wc = (await admin.from('worker_access').select('*').eq('worker_id', WC).single()).data
  check('Parallel guessing is capped (locked after burst)', !C.c && (wc.locked_until || wc.hard_locked), JSON.stringify([wc.failed_count, wc.lock_count]))
  await access('hrm', 'unlock', WC)

  // ---------- per-IP limit (use the IP hash this client was seen with)
  const myIp = (await admin.from('worker_login_attempts').select('ip_hash').eq('worker_id', WC).order('at', { ascending: false }).limit(1).single()).data.ip_hash
  await admin.from('worker_login_attempts').insert(Array.from({ length: 20 }, () => ({ ip_hash: myIp, passport_hash: 'iptest-' + stamp, ok: false, reason: 'test' })))
  C = await workerLogin(PPC, pins.C); check('Per-IP limit: 20 failures from one IP blocks even a correct PIN', !C.c)
  await admin.from('worker_login_attempts').delete().eq('ip_hash', myIp).gte('at', t0) // clears this run's failures from the IP window
  C = await workerLogin(PPC, pins.C); check('IP block lifts when the window passes', !!C.c)

  // ---------- revoke kills sessions immediately
  const meB = await B.c.rpc('worker_me'); check('Worker B session works before revoke', !meB.error)
  r = await access('oma', 'revoke', WB); check('Outlet manager cannot revoke', r.status === 403)
  r = await access('hrb', 'revoke', WB); check('HR Manager (scoped to B) revokes', r.ok === true, JSON.stringify(r))
  const meB2 = await B.c.rpc('worker_me'); check('Revoke: existing access token stops working at once', !!meB2.error)
  const rf = await createClient(URL_, ANON, opts).auth.refreshSession({ refresh_token: B.refresh }); check('Revoke: refresh token is dead', !!rf.error || !rf.data?.session)
  const B2 = await workerLogin(PPB, pins.B); check('Revoke: cannot log in', !B2.c)
  check('Revoke audit-logged with actor', ((await admin.from('audit_log').select('user_name').eq('entity_id', WB).eq('action', 'worker_app_revoke')).data || [])[0]?.user_name === 'T HRB')
  r = await access('hrb', 'reset', WB); check('Reset refused while revoked', r.status === 409 && !r.pin)
  r = await access('hrb', 'restore', WB); const B3 = await workerLogin(PPB, pins.B); check('Restore → can log in again', r.ok && !!B3.c)
  // reset
  r = await access('hra', 'reset', WB); check('Reset gives a new PIN', /^\d{6}$/.test(r.pin || '') && r.pin !== pins.B)
  const meB3 = await B3.c.rpc('worker_me'); check('Reset ends existing sessions', !!meB3.error)
  check('Old PIN fails after reset', !(await workerLogin(PPB, pins.B)).c); pins.B = r.pin
  check('New PIN works after reset', !!(await workerLogin(PPB, pins.B)).c)
  // deleted worker
  await admin.from('records').update({ deleted: true }).eq('entity', 'workers').eq('id', WC)
  check('Deleted worker cannot log in', !(await workerLogin(PPC, pins.C)).c)
  check('Deleted worker session stops working', !!(await C.c.rpc('worker_me')).error)
} catch (e) {
  fail++; console.log('FAIL exception', e?.message || e)
} finally {
  // cleanup only what this run created
  const wids = [WA, WB, WC]
  const acc = (await admin.from('worker_access').select('user_id').in('worker_id', wids)).data || []
  const rq = (await admin.from('requests').select('id').in('worker_id', wids)).data || []
  if (rq.length) { await admin.from('ceo_reviews').delete().in('request_id', rq.map((x) => x.id)); await admin.from('requests').delete().in('id', rq.map((x) => x.id)) }
  await admin.from('worker_access').delete().in('worker_id', wids)
  await admin.from('worker_login_attempts').delete().gte('at', t0)
  for (const a of acc) await admin.auth.admin.deleteUser(a.user_id)
  for (const id of staffIds) await admin.auth.admin.deleteUser(id)
  await admin.from('records').delete().in('id', [OA, OB, ...wids])
  console.log(`\n${pass} passed, ${fail} failed`)
  fs.mkdirSync(new URL('../screens/worker/', import.meta.url), { recursive: true })
  fs.writeFileSync(new URL('../screens/worker/security-results.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), pass, fail, results }, null, 1))
  process.exit(fail ? 1 : 0)
}
