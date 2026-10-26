// Shared TEST-only setup for the manual screenshots. SAFETY: refuses the live project and any project that has
// non-@example.com users. Every row it makes is stamped 'hlp-' and removed by cleanup(); it never wipes other data.
// Run with: node --experimental-websocket (Node 20)
import fs from 'node:fs'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
const ROOT = new URL('../../', import.meta.url).pathname
const require = createRequire(ROOT + 'package.json')
const { createClient } = require('@supabase/supabase-js')
const LIVE_REF = 'gnepquxtwkyffjmoydnv'
export const env = Object.fromEntries(fs.readFileSync(ROOT + '.secrets.env', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
export const URL_ = env.TEST_SUPABASE_URL, ANON = env.TEST_ANON_KEY
if (!URL_ || URL_.includes(LIVE_REF) || !URL_.includes(env.TEST_PROJECT_REF) || env.TEST_PROJECT_REF !== 'nvwiezzqqxwacfhormxo') { console.error('ABORT: not the test project'); process.exit(1) }
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
export const admin = createClient(URL_, env.TEST_SERVICE_ROLE_KEY, opts)
{ const { data } = await admin.auth.admin.listUsers({ perPage: 1000 }); if (data.users.some((u) => !/@example\.com$/.test(u.email || ''))) { console.error('ABORT: real users found'); process.exit(1) } }
export const STATE = '/tmp/hlp-state.json'
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10)
export const P = 'hlp-'

export async function seed() {
  const stamp = Date.now().toString(36), pw = crypto.randomBytes(12).toString('hex') + 'Aa1!'
  const now = new Date().toISOString()
  const outs = [['O1', 'Nasi Kandar – Jalan Ampang', 'main'], ['O2', 'Banana Leaf – Brickfields', 'main'], ['O3', 'Mart 24 – Cheras', 'c2']]
  const rows = outs.map(([id, name, companyId]) => ({ entity: 'outlets', id: P + id, deleted: false, client_ts: now, data: { id: P + id, name, type: 'Restaurant', companyId, state: id === 'O3' ? 'Selangor' : 'Kuala Lumpur', restDay: 'Sunday' } }))
  const names = ['Ram Bahadur Thapa', 'Muthu Kumar', 'Arjun Singh', 'Rahim Uddin', 'Kyaw Zin', 'Suresh Rai', 'Bikash Gurung', 'Ali Hassan', 'Prakash Tamang', 'Raju Pillai', 'Tun Aung', 'Hari Magar']
  const nat = ['Nepal', 'India', 'India', 'Bangladesh', 'Myanmar', 'Nepal', 'Nepal', 'Bangladesh', 'Nepal', 'India', 'Myanmar', 'Nepal']
  const st = ['Active-Working', 'Active-Working', 'Active-Working', 'On Leave', 'Active-Working', 'Active-Working', 'Absconded', 'Active-Working', 'Active-Working', 'Active-Working', 'Active-Working', 'Active-Working']
  const exp = [[-5, 400], [45, 200], [12, 25], [80, 300], [300, 70], [500, 20], [-30, 10], [200, 55], [600, 500], [25, 700], [400, 88], [700, 365]]
  const pp = (i) => 'H' + (stamp.toUpperCase().slice(-4)) + String(100 + i)
  names.forEach((n, i) => rows.push({ entity: 'workers', id: P + 'W' + i, deleted: false, client_ts: now, data: {
    id: P + 'W' + i, workerNo: 'FW' + (1001 + i), fullName: n, outletId: P + outs[i % 3][0], nationality: nat[i], status: st[i], joinDate: '2023-0' + (1 + (i % 9)) + '-01',
    primaryLanguage: i === 1 || i === 9 ? 'ta' : 'ne', jobCategory: ['Cook', 'Cashier', 'Kitchen helper', 'Waiter'][i % 4], phone: '01' + (1 + i % 8) + '-' + (2000000 + i * 7919),
    passportNo: pp(i), loans: i === 1 ? [{ id: 'l1', date: '2026-02-01', type: 'Loan', amount: 1200 }] : [], deductions: i === 1 ? [{ id: 'd1', date: '2026-03-01', amount: 300, type: 'Loan', loanId: 'l1' }] : [],
    leaves: [], increments: i === 1 ? [{ id: 'i1', date: '2026-01-01', oldPay: 1700, newPay: 1850 }] : [], allowances: [], memos: [],
    initialBasicPay: 1700 + (i % 4) * 100,
    documents: [{ id: 'p' + i, type: 'Passport', number: pp(i), expiryDate: day(exp[i][1] + 400) },
      { id: 'k' + i, type: 'Work Permit / PLKS (VP(TE))', number: 'PLKS' + (5500 + i), expiryDate: day(exp[i][0]) },
      { id: 'f' + i, type: 'FOMEMA Medical', expiryDate: day(exp[i][1]) }] } }))
  const ins = await admin.from('records').upsert(rows); if (ins.error) throw ins.error
  const U = {}, ids = []
  async function mk(key, name, role, extra = {}) {
    const email = `fwm-help-${key}-${stamp}@example.com`
    const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: name } })
    if (error) throw error
    ids.push(data.user.id)
    await admin.from('profiles').update({ role, status: 'active', full_name: name, outlet_ids: [], company_ids: [], ...extra }).eq('id', data.user.id)
    const c = createClient(URL_, ANON, opts); const s = await c.auth.signInWithPassword({ email, password: pw }); if (s.error) throw s.error
    U[key] = { email, id: data.user.id, c, token: s.data.session.access_token }
  }
  await mk('ceo', 'Arun Prakash', 'super_admin')
  await mk('gm', 'Daniel Tan', 'general_manager')
  await mk('hra', 'Priya Nair', 'hr_admin', { company_ids: ['main', 'c2'] })
  await mk('hrm', 'Farah Aziz', 'hr_manager', { company_ids: ['main', 'c2'] })
  await mk('om', 'Ahmad Yusof', 'outlet_manager', { outlet_ids: [P + 'O1', P + 'O2'] })
  await mk('viewer', 'Siti Rahman', 'viewer')
  { // one pending sign-up for the "Approve a new sign-up" screenshot (removed by cleanup: fwm-help- prefix)
    const { data, error } = await admin.auth.admin.createUser({ email: `fwm-help-pending-${stamp}@example.com`, password: pw, email_confirm: true, user_metadata: { full_name: 'Ravi Kumar', outlet_id: P + 'O1' } })
    if (error) throw error; ids.push(data.user.id) }
  const gen = await (await fetch(`${URL_}/functions/v1/worker-access`, { method: 'POST', headers: { apikey: ANON, Authorization: 'Bearer ' + U.hrm.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'generate', workerId: P + 'W1' }) })).json()
  if (!/^\d{6}$/.test(gen.pin || '')) throw new Error('PIN generate failed: ' + JSON.stringify(gen).slice(0, 200))
  // requests at different steps
  const act = (k, id, a, c = 'OK') => U[k].c.rpc('request_act', { p_id: id, p_action: a, p_comment: c, p_patch: null })
  const log = []
  async function req(type, w, title, data, amount, steps) {
    const by = Number(w.slice(1)) % 3 === 0 ? 'om' : 'hrm'
    const r = await U[by].c.rpc('request_create', { p_type: type, p_worker_id: P + w, p_title: title, p_data: data, p_amount: amount, p_priority: 'normal' })
    if (r.error) { log.push(type + ' create: ' + r.error.message); return null }
    for (const [k, a, c] of steps) { const x = await act(k, r.data.id, a, c); if (x.error) log.push(`${type} ${k} ${a}: ${x.error.message}`) }
    return r.data.id
  }
  const R = {}
  R.leaveHrm = await req('annual_leave', 'W0', 'Annual leave – family wedding', { from: day(20), to: day(24), reason: 'Sister’s wedding in Pokhara' }, null, [])
  R.advHra = await req('salary_advance', 'W3', 'Salary advance before Deepavali', { amount: 800, reason: 'Deepavali expenses' }, 800, [['hrm', 'forward', 'Checked – within limit']])
  R.loanGm = await req('loan', 'W6', 'Loan – school fees', { amount: 1500, reason: 'Children’s school fees' }, 1500, [['hrm', 'forward', 'Recommended'], ['hra', 'approve', 'Recommended to GM']])
  R.loanDone = await req('loan', 'W0', 'Loan for family medical costs', { amount: 2000, reason: 'Mother’s surgery' }, 2000, [['hrm', 'forward', 'Recommended'], ['hra', 'approve', 'Recommended'], ['gm', 'approve', 'Approved']])
  R.advRej = await req('salary_advance', 'W9', 'Salary advance – phone', { amount: 600, reason: 'New phone' }, 600, [['hrm', 'forward', 'OK'], ['hra', 'reject', 'Not an urgent need']])
  const st8 = { stamp, pw, pin: gen.pin, pp: pp(1), users: Object.fromEntries(Object.entries(U).map(([k, v]) => [k, { email: v.email, id: v.id }])), ids, R, log }
  fs.writeFileSync(STATE, JSON.stringify(st8, null, 1), { mode: 0o600 })
  return st8
}

export async function cleanup() {
  const s = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : null
  const wids = Array.from({ length: 12 }, (_, i) => P + 'W' + i)
  const rq = (await admin.from('requests').select('id').in('worker_id', wids)).data || []
  if (rq.length) { await admin.from('ceo_reviews').delete().in('request_id', rq.map((x) => x.id)); await admin.from('requests').delete().in('id', rq.map((x) => x.id)) }
  const acc = (await admin.from('worker_access').select('user_id').in('worker_id', wids)).data || []
  await admin.from('worker_access').delete().in('worker_id', wids)
  for (const a of acc) await admin.auth.admin.deleteUser(a.user_id).catch(() => {})
  await admin.from('records').delete().like('id', P + '%')
  if (s) for (const id of s.ids) await admin.auth.admin.deleteUser(id).catch(() => {})
  { const { data } = await admin.auth.admin.listUsers({ perPage: 1000 }); for (const u of data.users) if (/^fwm-help-/.test(u.email || '')) await admin.auth.admin.deleteUser(u.id).catch(() => {}) }
  if (fs.existsSync(STATE)) fs.unlinkSync(STATE)
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const cmd = process.argv[2]
  if (cmd === 'seed') { const s = await seed(); console.log('seeded', s.stamp, 'requests', JSON.stringify(s.R), 'log', JSON.stringify(s.log)) }
  else if (cmd === 'cleanup') { await cleanup(); console.log('cleaned') }
  else console.log('usage: seed | cleanup')
}
