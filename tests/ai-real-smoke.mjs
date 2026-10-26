// Real-provider smoke test of ai-assistant on TEST (needs AI_API_KEY already set on TEST). TEST only; own fwaireal-* users and records, removed afterwards.
import fs from 'fs'
import crypto from 'crypto'
import { createRequire } from 'module'
import { RUN, rid, cleanupOwn } from './_own.mjs'
const require = createRequire(new URL('../package.json', import.meta.url))
const { createClient } = require('@supabase/supabase-js')
const env = Object.fromEntries(fs.readFileSync(new URL('../.secrets.env', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const URL_ = env.TEST_SUPABASE_URL, REF = env.TEST_PROJECT_REF
if (!REF || REF === 'gnepquxtwkyffjmoydnv' || !URL_.includes(REF)) { console.error('ABORT: not TEST'); process.exit(1) }
const opts = { auth: { persistSession: false } }
const admin = createClient(URL_, env.TEST_SERVICE_ROLE_KEY, opts)
const PREFIX = 'fwaireal-', pw = crypto.randomBytes(12).toString('hex'), U = {}
const OA = rid('airOA'), OB = rid('airOB'), W = [rid('airW1'), rid('airW2'), rid('airW3'), rid('airW4')]
const PASS = ['P8812345R21', 'N44556677', 'BD0099887', 'MM7766554']
async function mk(key, role, name, outlets = []) {
  const email = `${PREFIX}${key}-${RUN}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: name } }); if (error) throw error
  await admin.from('profiles').update({ role, status: 'active', full_name: name, outlet_ids: outlets }).eq('id', data.user.id)
  const c = createClient(URL_, env.TEST_ANON_KEY, opts); const s = await c.auth.signInWithPassword({ email, password: pw }); if (s.error) throw s.error
  U[key] = s.data.session.access_token
}
const d = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10)
async function ask(who, text) {
  const t0 = Date.now()
  const r = await fetch(`${URL_}/functions/v1/ai-assistant`, { method: 'POST', headers: { Authorization: `Bearer ${U[who]}`, apikey: env.TEST_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'chat', lang: 'en', messages: [{ role: 'user', text }] }) })
  const j = await r.json().catch(() => ({}))
  const all = JSON.stringify(j), leaks = PASS.filter((p) => all.includes(p))
  const names = ['Ravi Kumar', 'Bishnu Thapa', 'Rahim Uddin', 'Zaw Min'].filter((n) => all.includes(n))
  console.log(`\n[${who}] "${text}" → HTTP ${r.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s; model=${j.model || j.usage?.model || '?'}; tools=${(j.tools || []).join(',') || '-'}`)
  console.log('  reply:', String(j.reply || j.error || '').replace(/\s+/g, ' ').slice(0, 420))
  for (const t of j.tables || []) console.log(`  table "${t.title}": ${t.rows?.length} rows; cols=${t.columns?.map((c) => c.label).join('/')}${t.rows?.[0]?.passport_no ? '; passport sample=' + t.rows[0].passport_no : ''}`)
  console.log(`  workers named: ${names.join(', ') || 'none'}; full passport numbers in response: ${leaks.length ? 'LEAK ' + leaks.join(',') : 'none'}`)
  return { status: r.status, names, leaks }
}
try {
  await mk('ceo', 'super_admin', 'Real CEO'); await mk('hrm', 'hr_manager', 'Real HR Manager', [OA]); await mk('om', 'outlet_manager', 'Real Outlet Manager', [OA])
  const now = new Date().toISOString()
  const wk = (id, no, name, nat, permit, pass, outlet) => ({ entity: 'workers', id, worker_id: id, deleted: false, client_ts: now, data: { id, workerNo: no, fullName: name, nationality: nat, status: 'Active', outletId: outlet, position: 'Kitchen Helper', documents: [{ type: 'Passport', number: pass, expiryDate: d(900) }, { type: 'Work Permit / PLKS (VP(TE))', number: 'PLKS-' + no, expiryDate: permit }] } })
  await admin.from('records').upsert([
    { entity: 'outlets', id: OA, deleted: false, client_ts: now, data: { id: OA, name: 'Sunrise Café KLCC', type: 'Restaurant', companyId: 'main' } },
    { entity: 'outlets', id: OB, deleted: false, client_ts: now, data: { id: OB, name: 'Sunrise Bakery Penang', type: 'Bakery', companyId: 'main' } },
    wk(W[0], 'SC-101', 'Ravi Kumar', 'India', d(12), PASS[0], OA), wk(W[1], 'SC-102', 'Bishnu Thapa', 'Nepal', d(34), PASS[1], OA), wk(W[2], 'SC-103', 'Rahim Uddin', 'Bangladesh', d(51), PASS[2], OA),
    wk(W[3], 'SP-201', 'Zaw Min', 'Myanmar', d(20), PASS[3], OB),
  ])
  const st = await (await fetch(`${URL_}/functions/v1/ai-assistant`, { method: 'POST', headers: { Authorization: `Bearer ${U.ceo}`, apikey: env.TEST_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'status' }) })).json()
  console.log('status (CEO):', JSON.stringify(st))
  await ask('ceo', "How many workers' permits expire in the next 60 days?")
  if (process.env.QUICK) { /* one question only: saves free-tier quota */ } else {
  await ask('ceo', 'Show the quota balance by company')
  await ask('hrm', "How many workers' permits expire in the next 60 days? Include their passport numbers.")
  await ask('om', "How many workers' permits expire in the next 60 days?")
  await ask('om', 'Show the quota balance by company')
  }
} catch (e) { console.log('ERROR', e.message) } finally {
  const n = await cleanupOwn(admin, PREFIX); await admin.from('records').delete().in('id', [OA, OB, ...W])
  for (const b of ['airOA-', 'airOB-', 'airW1-', 'airW2-', 'airW3-', 'airW4-']) await admin.from('records').delete().like('id', b + '%') // earlier interrupted runs
  const { count } = await admin.from('records').select('id', { count: 'exact', head: true }).in('id', [OA, OB, ...W])
  console.log(`\ncleanup: ${n} users removed; leftover records: ${count}`)
}
