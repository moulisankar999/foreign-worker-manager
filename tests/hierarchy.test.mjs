// v1.3.9 hierarchy visibility on TEST: nobody sees a superior — their user row, role, activity, assignments,
// reviews or audit lines — except the minimal approval trail of a request they are part of.
// Per role (GM, HR Admin, HR Manager, Outlet Manager, Viewer) every read path is checked for rows above the caller's rank:
// profiles / profiles_v, requests / requests_v, request_events(_v), hr_tasks(_v), audit_log, notification_events/deliveries.
// Also: approve → escalate → GM final → CEO overrule, CEO assign holds against the GM, GM Assign collapses
// superiors to "Next approval step", role pickers stay below the caller, realtime still fires after the column revoke.
// SAFETY: runs ONLY against the separate TEST project and refuses any project with non-@example.com users. Never prints passwords.
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
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : String(extra).slice(0, 600)) }
const pw = crypto.randomBytes(12).toString('hex'), stamp = Date.now()
const U = {}
const mkClient = () => createClient(URL_, ANON, opts)
async function mk(key) {
  const email = `fwh-${key}-${stamp}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: key.toUpperCase() } })
  if (error) throw error
  const c = mkClient(); const s = await c.auth.signInWithPassword({ email, password: pw }); if (s.error) throw s.error
  U[key] = { id: data.user.id, email, c }
  return U[key]
}
const RANK = { super_admin: 5, admin: 5, general_manager: 4, hr_admin: 3, hr_manager: 2, manager: 2, outlet_manager: 1 }
const rank = (r) => RANK[r] || 0
const now = () => new Date().toISOString()
const err = (r) => r?.error ? r.error.message : 'no error'
// Non-destructive: TEST is shared with other agents' runs, so only this suite's own fwh- users / rows are touched.
const OID = `fwh-O-${stamp}`, WID = `fwh-W-${stamp}`
async function cleanup() {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const mine = (data?.users || []).filter((u) => /^fwh-/.test(u.email || ''))
  const ids = mine.map((u) => u.id)
  if (ids.length) await admin.from('requests').delete().in('created_by', ids)
  await admin.from('requests').delete().like('worker_id', 'fwh-W-%')
  await admin.from('records').delete().like('id', 'fwh-%')
  for (const u of mine) await admin.auth.admin.deleteUser(u.id)
  if (ids.length) await admin.from('profiles').delete().in('id', ids)
}
await cleanup()
{ const { data } = await admin.from('app_config').select('value').eq('key', 'companies').maybeSingle()
  if (!(data?.value?.items || []).some((c) => c.id === 'main')) await admin.from('app_config').upsert({ key: 'companies', value: { items: [...(data?.value?.items || []), { id: 'main', name: 'Main company' }] } }) }

let rt = null
try {
  const S = await mk('ceo')
  await admin.from('profiles').update({ role: 'super_admin', status: 'active' }).eq('id', S.id)
  await S.c.rpc('push_records', { p_rows: [
    { entity: 'outlets', id: OID, client_ts: now(), data: { id: OID, name: 'Outlet One', companyId: 'main' } },
    { entity: 'workers', id: WID, client_ts: now(), data: { id: WID, workerNo: 'FW1', fullName: 'Test Worker One', outletId: OID, nationality: 'Nepal', status: 'Active-Working', joinDate: '2024-01-01', documents: [], loans: [], leaves: [] } }] })
  for (const k of ['gm', 'hra', 'hrm', 'om', 'view']) await mk(k)
  const ap = (k, role, cos = [], outs = []) => S.c.rpc('approve_user', { p_id: U[k].id, p_role: role, p_company_ids: cos, p_outlet_ids: outs })
  await ap('gm', 'general_manager'); await ap('hra', 'hr_admin'); await ap('hrm', 'hr_manager'); await ap('om', 'outlet_manager', [], [OID]); await ap('view', 'viewer', ['main'])
  const ROLE = { ceo: 'super_admin', gm: 'general_manager', hra: 'hr_admin', hrm: 'hr_manager', om: 'outlet_manager', view: 'viewer' }
  const roleOf = {}; for (const [k, r] of Object.entries(ROLE)) roleOf[U[k].id] = r
  const p0 = (await admin.from('profiles').select('id,role,status').in('id', Object.values(U).map((u) => u.id))).data || []
  check('setup: six active roles', p0.length === 6 && p0.every((p) => p.status === 'active' && p.role === roleOf[p.id]), JSON.stringify(p0))

  const create = (k, type, amount = null) => U[k].c.rpc('request_create', { p_type: type, p_worker_id: WID, p_title: type, p_data: {}, p_amount: amount, p_priority: 'normal' })
  const act = (k, id, action, comment = null) => U[k].c.rpc('request_act', { p_id: id, p_action: action, p_comment: comment, p_patch: null })
  const adminReq = async (id) => (await admin.from('requests').select('*').eq('id', id).single()).data

  // ---------- approvals still work end to end ----------
  const rA = (await create('om', 'loan', 300)).data
  let x = await act('hrm', rA.id, 'forward', 'OK'); check('HR Manager recommends up', x.data?.status && !x.error, err(x))
  x = await act('hra', rA.id, 'approve', 'OK'); check('HR Admin passes the loan to the final approver (escalated)', x.data?.status === 'escalated', err(x))
  x = await act('gm', rA.id, 'approve', 'Fine'); check('GM approves (final)', x.data?.status === 'approved', err(x))
  const rB = (await create('om', 'loan', 900)).data
  await act('hrm', rB.id, 'forward', 'OK'); await act('hra', rB.id, 'approve', 'OK')
  x = await act('gm', rB.id, 'reject', 'Too much'); check('GM rejects', x.data?.status === 'rejected', err(x))
  x = await S.c.rpc('ceo_decide', { p_id: rB.id, p_decision: 'approve', p_reason: 'CEO secret reason', p_patch: null })
  check('CEO overrules (approve, locked)', x.data?.status === 'approved' && x.data?.ceo_locked === true, err(x))
  x = await act('gm', rB.id, 'reject', 'No'); check('GM edit after the lock: neutral "final decision" message', !!x.error && /final decision/i.test(x.error.message) && !/CEO/.test(x.error.message), err(x))

  // raised by superiors
  const rC = (await create('ceo', 'other')).data
  const rD = (await create('gm', 'other')).data
  check('CEO and GM can raise requests', !!rC?.id && !!rD?.id)

  // CEO assigns a request to HR Admin → the GM cannot override it; message is neutral
  const rE = (await create('om', 'loan', 200)).data
  await act('hrm', rE.id, 'forward', 'OK')
  x = await S.c.rpc('request_assign', { p_id: rE.id, p_user: U.hra.id, p_note: 'CEO private note' })
  check('CEO assigns to HR Admin', !x.error && x.data?.assigned_to === U.hra.id, err(x))
  x = await U.gm.c.rpc('request_assign', { p_id: rE.id, p_user: U.hrm.id, p_note: null })
  check('GM cannot override the CEO assignment (neutral message)', !!x.error && /held at a higher level/.test(x.error.message) && !/CEO/.test(x.error.message), err(x))
  const gmE = (await U.gm.c.from('requests_v').select('id,assign_held,assigned_by_name,assigned_by_role,assigned_to,assigned_to_name').eq('id', rE.id)).data?.[0]
  check('GM view: Assign held, no CEO name/role on the assignment', gmE?.assign_held === true && !gmE.assigned_by_name && !gmE.assigned_by_role, JSON.stringify(gmE))
  const hraE = (await U.hra.c.from('requests_v').select('id,assigned_to,assigned_by_name,assigned_by_role').eq('id', rE.id)).data?.[0]
  check('HR Admin sees the request assigned to him, not who assigned it', hraE?.assigned_to === U.hra.id && !hraE.assigned_by_name && !hraE.assigned_by_role, JSON.stringify(hraE))
  const hraEv = (await U.hra.c.from('request_events_v').select('action,by_name,by_role,comment').eq('request_id', rE.id)).data || []
  const asg = hraEv.find((e) => e.action === 'assign')
  check('HR Admin timeline: assign line without the CEO name, role (the note to him is kept)', !!asg && !asg.by_name && !asg.by_role, JSON.stringify(hraEv))
  x = await act('hra', rE.id, 'approve', 'OK'); check('assigned HR Admin can still decide (→ escalated to GM)', x.data?.status === 'escalated' && !x.error, err(x))

  // GM Assign picker: superiors collapse to "Next approval step"; escalating to it still works
  const rG = (await create('om', 'loan', 150)).data
  const as = await U.gm.c.rpc('request_assignees', { p_id: rG.id })
  const list = as.data || []
  check('GM assignee list: no CEO name/role, one "Next approval step" entry', !as.error && !list.some((p) => p.role === 'super_admin' || /CEO/.test(p.name || '') || /CEO/.test(p.roleLabel || '')) && list.filter((p) => p.role === 'next_step').length === 1, JSON.stringify(as.error || list))
  check('GM assignee list still lists people at/below GM', list.some((p) => p.role === 'hr_admin') && list.some((p) => p.role === 'hr_manager'), JSON.stringify(list))
  const ns = list.find((p) => p.role === 'next_step')
  x = await U.gm.c.rpc('request_assign', { p_id: rG.id, p_user: ns?.id, p_note: 'Please decide' })
  check('GM escalates to the next approval step', !x.error && !!x.data, err(x))
  const asCeo = await S.c.rpc('request_assignees', { p_id: rG.id })
  check('CEO assignee list is unchanged (names shown)', !asCeo.error && !(asCeo.data || []).some((p) => p.role === 'next_step'), JSON.stringify(asCeo.error))

  // ---------- per-role visibility (no rows above the caller) ----------
  const allReqs = (await admin.from('requests').select('*')).data || []
  const allEv = (await admin.from('request_events').select('*')).data || []
  const CHAIN = { outlet_manager: 0, hr_manager: 1, hr_admin: 2, general_manager: 3 }
  for (const k of ['gm', 'hra', 'hrm', 'om', 'view']) {
    const me = U[k], myR = rank(ROLE[k]), L = ROLE[k].replace('_', ' ')
    // users
    const pv = await me.c.from('profiles_v').select('*')
    const above = (pv.data || []).filter((p) => p.id !== me.id && rank(p.role) > myR)
    check(`${L}: Users list (profiles_v) has nobody above`, !pv.error && above.length === 0 && (pv.data || []).some((p) => p.id === me.id), JSON.stringify(pv.error || above.map((p) => p.role)))
    const pb = await me.c.from('profiles').select('id,role')
    check(`${L}: profiles table has nobody above`, !pb.error && !(pb.data || []).some((p) => p.id !== me.id && rank(p.role) > myR), JSON.stringify(pb.error))
    const mine = (pv.data || []).find((p) => p.id === me.id)
    check(`${L}: own row hides who (above) approved him`, mine && !mine.approved_by && !mine.approved_by_name && !mine.approved_by_role, JSON.stringify(mine && [mine.approved_by_name, mine.approved_by_role]))
    const pAct = await me.c.from('profiles').select('approved_by_name')
    check(`${L}: actor columns are not readable on the base table`, !!pAct.error)
    // requests
    const rv = await me.c.from('requests_v').select('*')
    const bad = (rv.data || []).filter((r) => {
      const a = allReqs.find((q) => q.id === r.id); if (!a) return true
      const creatorUp = Math.max(rank(a.created_by_role), rank(roleOf[a.created_by])) > myR
      const part = a.created_by === me.id || a.assigned_to === me.id || allEv.some((e) => e.request_id === r.id && (e.by === me.id || e.to_user === me.id))
      return creatorUp && !part && !(CHAIN[ROLE[k]] !== undefined)
    })
    check(`${L}: requests list has no request raised by a superior he is not part of`, !rv.error && bad.length === 0, JSON.stringify(rv.error || bad.map((r) => r.id)))
    if (myR <= 1) check(`${L}: does not see the CEO- or GM-raised requests`, !(rv.data || []).some((r) => r.id === rC.id || r.id === rD.id), JSON.stringify((rv.data || []).map((r) => r.id)))
    if (k !== 'gm') check(`${L}: does not see the CEO-raised request`, !(rv.data || []).some((r) => r.id === rC.id))
    const leak = (rv.data || []).filter((r) => {
      const a = allReqs.find((q) => q.id === r.id) || {}
      return (rank(a.decided_by_role) > myR && (r.decided_by_name || r.decided_by_role)) || (rank(a.assigned_by_role) > myR && (r.assigned_by_name || r.assigned_by_role)) ||
        (rank(roleOf[a.created_by]) > myR && (r.created_by_name || r.created_by_role)) || r.ceo_updated_at || (r.assigned_role && rank(r.assigned_role) > myR)
    })
    check(`${L}: no superior name/role on any visible request`, leak.length === 0, JSON.stringify(leak.map((r) => [r.id, r.decided_by_name, r.assigned_by_name, r.created_by_name])))
    const rb = await me.c.from('requests').select('id,decided_by_name')
    check(`${L}: request actor columns are not readable on the base table`, !!rb.error)
    // timeline
    const ev = await me.c.from('request_events_v').select('*')
    const evBad = (ev.data || []).filter((e) => e.action.startsWith('ceo_') || rank(e.by_role) > myR || rank(e.to_role) > myR || /CEO secret reason|CEO private note/.test(e.comment || ''))
    check(`${L}: timeline has no CEO/superior lines or notes`, !ev.error && evBad.length === 0, JSON.stringify(ev.error || evBad))
    const eb = await me.c.from('request_events').select('id,action')
    check(`${L}: request_events base rows hold no ceo_* actions`, !eb.error && !(eb.data || []).some((e) => e.action.startsWith('ceo_')), JSON.stringify(eb.error))
    check(`${L}: request_events actor columns are not readable on the base table`, !!(await me.c.from('request_events').select('by_name')).error)
    // audit, notifications, HR tasks
    const au = await me.c.from('audit_log').select('user_id,user_role,action,details')
    const auBad = (au.data || []).filter((a) => rank(a.user_role) > myR || rank(roleOf[a.user_id]) > myR || a.action.startsWith('request.ceo_') || rank(a.details?.toRole) > myR || rank(a.details?.role) > myR)
    check(`${L}: audit log has no superior activity`, auBad.length === 0, JSON.stringify(au.error || auBad.slice(0, 3)))
    const ne = await me.c.from('notification_events').select('event,actor')
    check(`${L}: notification events: no CEO-only or superior-made events`, !(ne.data || []).some((e) => ['ceo_review', 'gm_assigned', 'user_approved_by_hr', 'ceo_overruled'].includes(e.event) || rank(roleOf[e.actor]) > myR), JSON.stringify(ne.error || (ne.data || []).map((e) => e.event)))
    const nd = await me.c.from('notification_deliveries').select('user_id')
    check(`${L}: delivery log has nobody above`, !(nd.data || []).some((d) => d.user_id && d.user_id !== me.id && rank(roleOf[d.user_id]) > myR), JSON.stringify(nd.error))
    const ht = await me.c.from('hr_tasks_v').select('*')
    check(`${L}: HR follow-ups never mention the CEO`, !ht.error && !(ht.data || []).some((t) => /CEO/.test(`${t.title} ${t.details || ''}`) || t.created_by_name), JSON.stringify(ht.error || ht.data))
    // role pickers / editing above
    const cr = await me.c.rpc('creatable_roles', { p_actor: me.id })
    const roles = (cr.data || []).map((r) => (typeof r === 'string' ? r : r.role))
    check(`${L}: role picker offers only roles below his own`, roles.every((r) => rank(r) < myR) && !roles.includes('super_admin'), JSON.stringify(cr.error || roles))
    const up = await me.c.from('profiles').update({ full_name: 'X' }).eq('id', S.id).select('id')
    check(`${L}: cannot edit the CEO's user row`, !!up.error || !(up.data || []).length)
  }
  // approval exception: the requester (OM) still sees his request, its status and the steps that touch him
  const omA = (await U.om.c.from('requests_v').select('id,status,decided_at').eq('id', rA.id)).data?.[0]
  const omAe = (await U.om.c.from('request_events_v').select('action').eq('request_id', rA.id)).data || []
  check('requester (OM) still sees his request outcome and its steps', omA?.status === 'approved' && !!omA.decided_at && omAe.length >= 3, JSON.stringify([omA, omAe]))
  const omB = (await U.om.c.from('requests_v').select('id,status,ceo_locked').eq('id', rB.id)).data?.[0]
  check('requester sees the final (locked) outcome, without who overruled', omB?.status === 'approved' && omB.ceo_locked === true, JSON.stringify(omB))
  const hrmB = (await U.hrm.c.from('request_events_v').select('action,comment').eq('request_id', rB.id)).data || []
  check('HR Manager (part of the chain) sees the chain steps but no overrule line or reason', hrmB.length >= 2 && !hrmB.some((e) => e.action.startsWith('ceo_') || /secret/.test(e.comment || '')), JSON.stringify(hrmB))
  // CEO still sees everything
  const ceoP = (await S.c.from('profiles_v').select('id')).data || []
  const ceoE = (await S.c.from('request_events_v').select('action,by_name').eq('request_id', rB.id)).data || []
  check('CEO sees every user and the full history with names', ceoP.length >= 6 && ceoE.some((e) => e.action === 'ceo_overrule' && e.by_name === 'CEO'), JSON.stringify(ceoE))
  const ceoA = (await S.c.from('audit_log').select('action')).data || []
  check('CEO audit log has the CEO actions', ceoA.some((a) => a.action.startsWith('request.ceo_')) && ceoA.some((a) => a.action === 'user.approve'))

  // ---------- realtime still fires for a role after the column revoke ----------
  const got = []
  rt = U.hrm.c.channel('hier-rt-' + stamp).on('postgres_changes', { event: '*', schema: 'public', table: 'requests' }, (p) => got.push(p))
  await new Promise((res) => { rt.subscribe((s) => { if (s === 'SUBSCRIBED') res() }); setTimeout(res, 10000) })
  await new Promise((r) => setTimeout(r, 1500))
  const rR = (await create('om', 'loan', 120)).data
  for (let i = 0; i < 20 && !got.some((p) => p.new?.id === rR?.id); i++) await new Promise((r) => setTimeout(r, 500))
  const ev = got.find((p) => p.new?.id === rR?.id)
  check('realtime: HR Manager gets the change event for a new request', !!ev, `${got.length} events`)
  check('realtime payload carries no actor names', ev && !('created_by_name' in (ev.new || {})) && !('decided_by_name' in (ev.new || {})), JSON.stringify(Object.keys(ev?.new || {})))
} catch (e) {
  check('exception', false, e?.stack || e)
} finally {
  if (rt) await rt.unsubscribe().catch(() => {})
  for (const u of Object.values(U)) await u.c.removeAllChannels?.()
  await cleanup().catch(() => {})
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
