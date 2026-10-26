// GM-final approvals + CEO review / overrule / recall / lock + HR follow-up tasks + agencies config.
// Scenarios: GM approves → CEO ignores → stays approved; GM rejects → CEO recalls & amends → locked;
// GM edit after the lock is refused; booked ticket → CEO reject → HR task created.
// SAFETY: runs ONLY against the separate TEST project (TEST_SUPABASE_URL in .secrets.env),
// refuses the live project, and refuses any project that has non-@example.com users. Never prints passwords.
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

let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : extra) }
const pw = crypto.randomBytes(12).toString('hex'), stamp = Date.now()
const U = {}
const mkClient = () => createClient(URL_, ANON, opts)
async function mk(key) {
  const email = `fwr-${key}-${stamp}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: key.toUpperCase() } })
  if (error) throw error
  const c = mkClient(); const s = await c.auth.signInWithPassword({ email, password: pw }); if (s.error) throw s.error
  U[key] = { id: data.user.id, email, c }
  return U[key]
}
const prof = async (id) => (await admin.from('profiles').select('*').eq('id', id).maybeSingle()).data
const strip = (r) => { const { tempPassword, ...rest } = r; return JSON.stringify({ ...rest, tempPassword: tempPassword ? '(hidden)' : undefined }) }
const now = () => new Date().toISOString()
await admin.from('records').delete().neq('id', '__none__')
await admin.from('requests').delete().neq('type', '__none__')
{ const { data } = await admin.auth.admin.listUsers({ perPage: 1000 }); for (const u of data.users) await admin.auth.admin.deleteUser(u.id) }
await admin.from('profiles').delete().neq('id', '00000000-0000-0000-0000-000000000000')
await admin.from('app_config').upsert({ key: 'companies', value: { items: [{ id: 'main', name: 'Main company' }] } })
await admin.from('app_config').upsert({ key: 'gm_powers', value: { powers: {} } })
{ // other suites may replace the notification config; make sure the v1.2 events exist (same defaults as migration 013)
  const cur = (await admin.from('app_config').select('value').eq('key', 'notifications').maybeSingle()).data?.value || { events: {} }
  const ch = { in_app: true, push: true, email: false, sms: false, whatsapp: false }
  const add = { ceo_review: ['super_admin'], ceo_overruled: ['participants', 'hr_admin'], hr_task_created: ['hr_manager', 'hr_admin'] }
  cur.events = cur.events || {}
  for (const [k, r] of Object.entries(add)) if (!cur.events[k]) cur.events[k] = { enabled: true, critical: false, recipients: r, channels: ch, title: k + ' {{ref}}', body: '', email: '', sms: '' }
  await admin.from('app_config').upsert({ key: 'notifications', value: cur })
}
const err = (r) => r.error ? r.error.message : 'no error'

try {
  const S = await mk('ceo')
  await S.c.rpc('push_records', { p_rows: [
    { entity: 'outlets', id: 'O1', client_ts: now(), data: { id: 'O1', name: 'Outlet One', companyId: 'main' } },
    { entity: 'workers', id: 'W1', client_ts: now(), data: { id: 'W1', workerNo: 'FW1', fullName: 'Test Worker One', outletId: 'O1', nationality: 'Nepal', status: 'Active-Working', joinDate: '2024-01-01', documents: [], loans: [], leaves: [] } }] })
  for (const k of ['gm', 'hra', 'hrm', 'om']) await mk(k)
  const ap = (k, role, cos = [], outs = []) => S.c.rpc('approve_user', { p_id: U[k].id, p_role: role, p_company_ids: cos, p_outlet_ids: outs })
  await ap('gm', 'general_manager'); await ap('hra', 'hr_admin'); await ap('hrm', 'hr_manager'); await ap('om', 'outlet_manager', [], ['O1'])
  check('setup roles', (await prof(U.gm.id)).role === 'general_manager' && (await prof(U.om.id)).role === 'outlet_manager')

  const create = (k, type, amount = null, data = {}) => U[k].c.rpc('request_create', { p_type: type, p_worker_id: 'W1', p_title: type, p_data: data, p_amount: amount, p_priority: 'normal' })
  const act = (k, id, action, comment = null, patch = null) => U[k].c.rpc('request_act', { p_id: id, p_action: action, p_comment: comment, p_patch: patch })
  const decide = (k, id, d, reason = null, patch = null) => U[k].c.rpc('ceo_decide', { p_id: id, p_decision: d, p_reason: reason, p_patch: patch })
  const toGm = async (type, amount = null, data = {}) => {
    const r = await create('om', type, amount, data); if (r.error) throw r.error
    await act('hrm', r.data.id, 'forward', 'OK'); const x = await act('hra', r.data.id, 'approve', 'OK')
    return { id: r.data.id, status: x.data?.status, e: x.error }
  }
  const req = async (id) => (await admin.from('requests').select('*').eq('id', id).single()).data

  // ---- scenario 1: GM approves → CEO ignores → stays approved
  const a = await toGm('loan', 300)
  check('HR Admin passes the loan up to the final approver', a.status === 'escalated', JSON.stringify(a.e))
  let x = await act('hra', a.id, 'approve'); check('HR Admin cannot give the final approval', !!x.error)
  x = await act('gm', a.id, 'approve', 'Fine')
  check('GM approves (final)', x.data?.status === 'approved', err(x))
  let q = await req(a.id)
  check('decision says General Manager', q.decided_by_role === 'general_manager' && q.decided_by_name === 'GM', JSON.stringify([q.decided_by_role, q.decided_by_name]))
  let rv = await S.c.from('ceo_reviews').select('*').eq('request_id', a.id)
  check('CEO review queue gets the GM approval', rv.data?.[0]?.reason === 'gm_approved' && !rv.data[0].reviewed_at, JSON.stringify(rv))
  rv = await U.gm.c.from('ceo_reviews').select('*')
  check('GM cannot read the CEO review queue', (rv.data || []).length === 0)
  const ne = await admin.from('notification_events').select('event').eq('request_id', a.id).eq('event', 'ceo_review')
  check('CEO is notified (ceo_review event)', (ne.data || []).length >= 1)
  q = await req(a.id)
  check('CEO ignores → stays approved, not locked', q.status === 'approved' && !q.ceo_locked)
  x = await decide('ceo', a.id, 'reviewed')
  rv = await S.c.from('ceo_reviews').select('*').eq('request_id', a.id)
  check('Mark reviewed keeps the decision', !x.error && rv.data?.[0]?.outcome === 'kept' && (await req(a.id)).status === 'approved', err(x))

  // ---- scenario 2: GM rejects → CEO recalls and amends → locked
  const b = await toGm('loan', 900)
  x = await act('gm', b.id, 'reject', 'Too much')
  check('GM rejects', x.data?.status === 'rejected', err(x))
  rv = await S.c.from('ceo_reviews').select('reason').eq('request_id', b.id)
  check('rejection goes to the CEO review queue', rv.data?.[0]?.reason === 'gm_rejected')
  for (const k of ['gm', 'hra', 'hrm', 'om']) { const y = await decide(k, b.id, 'approve'); check(`${k} cannot use CEO overrule`, !!y.error) }
  x = await U.gm.c.rpc('request_effects', { p_id: b.id }); check('GM cannot read request effects', !!x.error)
  x = await decide('ceo', b.id, 'recall', 'Let me look at this')
  check('CEO recalls → escalated + locked', x.data?.status === 'escalated' && x.data?.ceo_locked === true, err(x))
  x = await act('gm', b.id, 'approve'); check('GM cannot act on a recalled (locked) request', !!x.error)
  x = await decide('ceo', b.id, 'amend', 'Approve RM 600 instead', { amount: 600 })
  q = await req(b.id)
  check('CEO amends then approves', q.status === 'approved' && Number(q.amount) === 600 && q.ceo_locked && q.decided_by_role === 'super_admin', err(x))
  x = await act('gm', b.id, 'reject', 'No'); check('GM edit after the lock is refused (reject)', !!x.error && /locked|CEO/i.test(x.error.message), err(x))
  x = await U.gm.c.rpc('request_note', { p_id: b.id, p_data: { amount: 1 }, p_comment: 'x' }); check('GM data edit after the lock is refused', !!x.error)
  x = await act('hra', b.id, 'reject', 'No'); check('HR Admin cannot change a locked request', !!x.error)
  x = await act('gm', b.id, 'comment', 'Noted'); check('comments still allowed after the lock', !x.error, err(x))
  const evG = await U.gm.c.from('request_events').select('action').eq('request_id', b.id)
  const evC = await S.c.from('request_events_v').select('action,from_status,to_status,by_name').eq('request_id', b.id)
  check('GM does not see CEO overrule events (neutral note only)', !(evG.data || []).some((e) => e.action.startsWith('ceo_')) && (evG.data || []).length > 0)
  check('CEO history has overrule line', (evC.data || []).some((e) => e.action === 'ceo_overrule' && e.from_status === 'escalated' && e.to_status === 'approved' && e.by_name === 'CEO'), JSON.stringify(evC.data))
  const evO = await U.om.c.from('request_events').select('action').eq('request_id', b.id)
  check('requester (below) does not see the CEO overrule line, only the request itself', !(evO.data || []).some((e) => e.action.startsWith('ceo_')) && (evO.data || []).length > 0, JSON.stringify(evO.data))
  const no = await admin.from('notification_events').select('event').eq('request_id', b.id).eq('event', 'ceo_overruled')
  check('chain notified (ceo_overruled)', (no.data || []).length >= 1)
  const au = await admin.from('audit_log').select('action').eq('entity_id', b.id)
  check('audited', (au.data || []).some((r) => r.action === 'request.ceo_amend') && (au.data || []).some((r) => r.action === 'request.ceo_recall'))

  // ---- scenario 3: booked ticket → CEO rejects → HR task
  const c = await toGm('loan', 200)
  await act('gm', c.id, 'approve', 'OK')
  x = await U.hrm.c.rpc('request_note', { p_id: c.id, p_data: { ticketBooked: true }, p_comment: 'Ticket booked' })
  check('HR marks ticket booked', !x.error, err(x))
  const fx = await S.c.rpc('request_effects', { p_id: c.id })
  check('effects warn about the ticket', (fx.data || []).some((e) => e.kind === 'ticket'), JSON.stringify(fx))
  x = await decide('ceo', c.id, 'reject', 'Not now')
  q = await req(c.id)
  check('CEO rejects (final)', q.status === 'rejected' && q.ceo_locked, err(x))
  const t1 = await U.hrm.c.from('hr_tasks_v').select('*').eq('request_id', c.id)
  check('HR task created for the ticket', (t1.data || []).length === 1 && /Cancel ticket/.test(t1.data[0].title), JSON.stringify(t1))
  const nt = await admin.from('notification_events').select('event').eq('request_id', c.id).eq('event', 'hr_task_created')
  check('HR notified about the task', (nt.data || []).length >= 1)
  const t2 = await U.om.c.from('hr_tasks').select('id').eq('request_id', c.id)
  check('outlet manager does not see HR tasks', (t2.data || []).length === 0)
  x = await U.om.c.rpc('hr_task_done', { p_id: t1.data[0].id, p_note: 'x' }); check('outlet manager cannot close an HR task', !!x.error)
  x = await U.hrm.c.rpc('hr_task_done', { p_id: t1.data[0].id, p_note: 'Ticket cancelled, refund pending' })
  const t3 = (await admin.from('hr_tasks').select('*').eq('id', t1.data[0].id).single()).data
  check('HR closes the task', !x.error && !!t3.done_at, err(x))

  // ---- GM without the final-approval power → CEO decides
  await S.c.rpc('set_gm_powers', { p_powers: { 'requests.final': false, 'requests.loans': false } })
  const d = await toGm('loan', 100)
  x = await act('gm', d.id, 'approve'); check('GM without power cannot give the final approval', !!x.error)
  x = await act('ceo', d.id, 'approve', 'OK'); check('falls back to the CEO', x.data?.status === 'approved', err(x))
  x = await U.gm.c.rpc('set_gm_powers', { p_powers: { 'requests.final': true } }); check('GM cannot edit own powers', !!x.error)
  await S.c.rpc('set_gm_powers', { p_powers: { 'requests.final': true, 'requests.loans': true } })

  // ---- agencies (CEO / HR Admin; GM by power; others refused)
  const ag = await S.c.from('app_config').select('value').eq('key', 'agencies').maybeSingle()
  const items = ag.data?.value?.items
  check('agencies config readable', Array.isArray(items) && items.length >= 11, String(items?.length))
  if (Array.isArray(items)) {
    const changed = { items: items.map((i, n) => n === 0 ? { ...i, notes: 'test note' } : i) }
    x = await U.hra.c.rpc('set_agencies', { p_value: changed }); check('HR Admin can edit agencies', !x.error, err(x))
    x = await U.om.c.rpc('set_agencies', { p_value: changed }); check('outlet manager cannot edit agencies', !!x.error)
    x = await U.hrm.c.rpc('set_agencies', { p_value: changed }); check('HR manager cannot edit agencies', !!x.error)
    x = await U.hra.c.rpc('set_agencies', { p_value: { items: [{ ...items[0], api: { endpoint: 'https://x', enabled: true } }, ...items.slice(1)] } })
    const after = (await admin.from('app_config').select('value').eq('key', 'agencies').single()).data.value.items[0]
    check('API field can never be switched on', !!x.error || after.api?.enabled !== true, JSON.stringify(after.api))
    x = await S.c.rpc('set_agencies', { p_value: { items } }); check('CEO can edit agencies', !x.error, err(x))
  }
} catch (e) { fail++; console.log('FAIL exception', e.message) }
finally {
  await admin.from('requests').delete().neq('type', '__none__')
  for (const k of Object.keys(U)) await admin.auth.admin.deleteUser(U[k].id).catch(() => {})
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
