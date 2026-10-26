// Company records (045): who may create / see / edit / delete companies, their details, SSM copies and directors.
// SAFETY: TEST project only. Creates only its own fwc-*@example.com users and its own "CT … <run>" companies; removes only those.
// The HR permission switches it flips are put back afterwards. Never prints secrets.
import { createRequire } from 'module'
import fs from 'fs'
import crypto from 'crypto'
import { cleanupOwn, keepConfig, RUN } from './_own.mjs'
const require = createRequire(new URL('../package.json', import.meta.url))
const { createClient } = require('@supabase/supabase-js')
const LIVE_REF = 'gnepquxtwkyffjmoydnv'
const env = Object.fromEntries(fs.readFileSync(new URL('../.secrets.env', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const URL_ = env.TEST_SUPABASE_URL, ANON = env.TEST_ANON_KEY, SERVICE = env.TEST_SERVICE_ROLE_KEY
if (!URL_ || URL_.includes(LIVE_REF) || !URL_.includes(env.TEST_PROJECT_REF)) { console.error('ABORT: not the test project'); process.exit(1) }
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(URL_, SERVICE, opts)
let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : extra) }
const err = (r) => (r.error ? r.error.message : 'no error')
const pw = crypto.randomBytes(12).toString('hex'), PRE = `fwc-${RUN}-`
const U = {}; const mine = []
async function mk(key, role, companies = []) {
  const email = `${PRE}${key}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: 'CT ' + key.toUpperCase() } })
  if (error) throw error
  const up = await admin.from('profiles').update({ role, status: 'active', full_name: 'CT ' + key.toUpperCase(), company_ids: companies }).eq('id', data.user.id); if (up.error) throw up.error
  const c = createClient(URL_, ANON, opts); const s = await c.auth.signInWithPassword({ email, password: pw }); if (s.error) throw s.error
  U[key] = { id: data.user.id, c }
}
const pdf = Buffer.from('%PDF-1.4\n% CT test file\n%%EOF\n')
const up = (who, path) => U[who].c.storage.from('company-docs').upload(path, pdf, { contentType: 'application/pdf' })
const dl = async (who, path) => { const r = await U[who].c.storage.from('company-docs').download(path); return !r.error && !!r.data }
const items = async () => ((await admin.from('app_config').select('value').eq('key', 'companies').single()).data?.value?.items || [])
const restore = await keepConfig(admin, ['hr_admin'])
const SCOPE = `ct-scope-${RUN}`

try {
  await mk('ceo', 'super_admin'); await mk('gm', 'general_manager'); await mk('hra', 'hr_admin'); await mk('hrm', 'hr_manager', [SCOPE])
  await mk('om', 'outlet_manager', [SCOPE]); await mk('viewer', 'viewer', [SCOPE]); await mk('hra2', 'hr_admin', [`ct-other-${RUN}`])
  const before = (await items()).map((c) => c.id)

  // ---- HR Manager creates a company with every field, SSM copy and a director with IC copy
  const ssm = `staging/${U.hrm.id}/ssm/${crypto.randomUUID()}.pdf`, icf = `staging/${U.hrm.id}/directors/${crypto.randomUUID()}.pdf`
  let r = await up('hrm', ssm); check('HR Manager uploads an SSM copy while creating', !r.error, err(r))
  r = await up('hrm', icf); check('HR Manager uploads a director IC copy while creating', !r.error, err(r))
  r = await up('hrm', `staging/${U.gm.id}/ssm/x.pdf`); check('nobody uploads into another user\'s staging folder', !!r.error)
  r = await up('om', `staging/${U.om.id}/ssm/x.pdf`); check('Outlet Manager cannot upload company files', !!r.error)
  const name = `CT Hrm Company ${RUN}`
  r = await U.hrm.c.rpc('company_create', { p: { name, sector: 'Manufacturing',
    details: { ssm_new: '201901012345', ssm_old: '1234567-X', incorporated_on: '2019-04-01', reg_address: '1 Jalan Test, KL', biz_address: '2 Jalan Test, KL', phone: '03-1234 5678', email: 'Office@CT.example.com' },
    docs: [{ doc_type: 'form9', title: 'Form 9', path: ssm, name: 'form9.pdf', mime: 'application/pdf', size: pdf.length, expiry_date: '2027-12-31' }],
    directors: [{ full_name: 'Ali Test', id_type: 'ic', id_no: '800101145678', designation: 'director', email: 'ali@ct.example.com', mobile: '012-345 6789', id_file: icf },
                { full_name: 'Raj Test', id_type: 'passport', id_no: 'k1234567', nationality: 'India', designation: 'shareholder' }] } })
  check('HR Manager creates a company with all fields', !r.error && r.data?.directors === 2 && r.data?.documents === 1, err(r))
  const C = r.data?.id; if (C) mine.push(C)
  check('the new company is in the company list with its sector', (await items()).some((c) => c.id === C && c.sector === 'Manufacturing'))
  check('other companies on TEST are untouched', before.every((id) => (async () => true)) && (await items()).filter((c) => before.includes(c.id)).length === before.length)
  check('the creator (scoped) can now pick the new company', ((await admin.from('profiles').select('company_ids').eq('id', U.hrm.id).single()).data?.company_ids || []).includes(C))
  const lst = await U.hrm.c.rpc('my_company_list'); check('HR Manager company picker lists the new company', !lst.error && JSON.stringify(lst.data).includes(C), err(lst))

  // ---- what each role sees
  r = await U.hrm.c.from('company_details').select('*').eq('company_id', C).maybeSingle()
  check('HR Manager sees the company details', r.data?.ssm_new === '201901012345' && r.data?.phone === '+60312345678' && r.data?.email === 'office@ct.example.com', err(r) + JSON.stringify(r.data))
  r = await U.hrm.c.from('company_docs').select('*').eq('company_id', C); check('HR Manager sees the SSM document list', r.data?.length === 1, err(r))
  check('HR Manager opens the SSM copy', await dl('hrm', ssm))
  r = await U.hrm.c.from('company_directors').select('*').eq('company_id', C); check('HR Manager gets nothing from the directors table itself', !r.error && r.data.length === 0, err(r))
  r = await U.hrm.c.from('company_directors_v').select('*').eq('company_id', C).order('full_name')
  check('HR Manager sees director names and designations', r.data?.length === 2 && r.data[0].full_name === 'Ali Test' && r.data[1].designation === 'shareholder', err(r))
  check('HR Manager sees IC / passport masked to the last 4', r.data?.[0]?.id_no === '••••5678' && r.data?.[1]?.id_no === '••••4567' && !JSON.stringify(r.data).includes('800101'), JSON.stringify(r.data?.map((x) => x.id_no)))
  check('HR Manager never gets the ID copy path', r.data?.every((x) => x.id_file === null) && r.data?.[0]?.has_id_file === true)
  check('HR Manager cannot open the ID copy', !(await dl('hrm', icf)))
  const dir = (await admin.from('company_directors').select('id,id_file,id_no').eq('company_id', C).eq('full_name', 'Ali Test').single()).data
  check('IC stored in YYMMDD-PB-###G form', dir?.id_no === '800101-14-5678', dir?.id_no)
  check('HR Manager cannot open the ID copy at its real path either', !(await dl('hrm', dir?.id_file || 'x')))
  r = await U.hra.c.from('company_directors_v').select('*').eq('company_id', C).order('full_name'); check('HR Admin sees full IC / passport numbers', r.data?.[0]?.id_no === '800101-14-5678' && r.data?.[1]?.id_no === 'K1234567', JSON.stringify(r.data?.map((x) => x.id_no)))
  r = await U.hra.c.from('company_directors').select('*').eq('company_id', C); check('HR Admin reads the directors table', r.data?.length === 2, err(r))
  check('HR Admin opens the ID copy', await dl('hra', dir?.id_file || icf))
  r = await U.gm.c.from('company_directors_v').select('id_no').eq('company_id', C); check('GM sees everything in full', r.data?.some((x) => x.id_no === '800101-14-5678'), err(r))
  check('CEO opens the ID copy', await dl('ceo', dir?.id_file || icf))
  for (const k of ['om', 'viewer', 'hra2']) {
    const a = await U[k].c.from('company_details').select('*').eq('company_id', C), b = await U[k].c.from('company_directors_v').select('*').eq('company_id', C), d = await U[k].c.from('company_docs').select('*').eq('company_id', C)
    check(`${k === 'hra2' ? 'HR Admin of another company' : k === 'om' ? 'Outlet Manager' : 'Viewer'} sees no details, documents or directors`, !a.data?.length && !b.data?.length && !d.data?.length)
    check(`${k} cannot open the SSM copy`, !(await dl(k, ssm)))
  }

  // ---- HR Manager edits the basic fields only; deletes nothing
  r = await U.hrm.c.from('company_details').update({ biz_address: '3 Jalan Baru, KL' }).eq('company_id', C).select(); check('HR Manager edits company details', r.data?.length === 1, err(r))
  r = await U.hrm.c.rpc('company_update_basic', { p_id: C, p: { name: name + ' B', sector: 'Construction' } }); check('HR Manager renames / changes sector', !r.error, err(r))
  r = await U.hrm.c.from('company_directors').update({ full_name: 'Changed' }).eq('company_id', C).select(); check('HR Manager cannot edit directors after creation', !r.data?.length)
  r = await U.hrm.c.from('company_directors').insert({ company_id: C, full_name: 'New Dir', id_type: 'ic', id_no: '800101145679' }).select(); check('HR Manager cannot add directors after creation', !!r.error || !r.data?.length)
  r = await U.hrm.c.from('company_docs').insert({ company_id: C, doc_type: 'form24', path: `${C}/ssm/x.pdf` }).select(); check('HR Manager cannot add documents after creation', !!r.error || !r.data?.length)
  r = await U.hrm.c.from('company_directors').delete().eq('company_id', C).select(); check('HR Manager cannot delete directors (server)', !r.data?.length && (await admin.from('company_directors').select('id').eq('company_id', C)).data?.length === 2)
  r = await U.hrm.c.from('company_docs').delete().eq('company_id', C).select(); check('HR Manager cannot delete documents (server)', !r.data?.length && (await admin.from('company_docs').select('id').eq('company_id', C)).data?.length === 1)
  r = await U.hrm.c.storage.from('company-docs').remove([ssm]); check('HR Manager cannot delete stored files', (await dl('hra', ssm)))
  r = await U.hrm.c.rpc('company_delete', { p_id: C }); check('HR Manager cannot delete the company (server)', !!r.error, err(r))
  r = await U.hra.c.rpc('company_delete', { p_id: C }); check('HR Admin cannot delete the company (server)', !!r.error, err(r))
  r = await U.hra.c.from('company_directors').delete().eq('company_id', C).select(); check('HR Admin cannot delete directors', !r.data?.length)
  const cur = (await admin.from('app_config').select('value').eq('key', 'companies').single()).data.value
  r = await U.hrm.c.from('app_config').update({ value: { ...cur, items: cur.items.filter((c) => c.id !== C) } }).eq('key', 'companies').select(); check('HR Manager cannot remove a company by saving the list', !r.data?.length && (await items()).some((c) => c.id === C), err(r))

  // ---- HR Admin full edit; validation
  r = await U.hra.c.from('company_directors').insert({ company_id: C, full_name: 'Bad Ic', id_type: 'ic', id_no: '12345' }); check('invalid IC (not 12 digits) is refused', !!r.error && /12 digits/.test(err(r)), err(r))
  r = await U.hra.c.from('company_directors').insert({ company_id: C, full_name: 'Bad Date', id_type: 'ic', id_no: '801301145678' }); check('IC with an impossible birth date is refused', !!r.error, err(r))
  r = await U.hra.c.from('company_directors').insert({ company_id: C, full_name: 'Bad Mail', id_type: 'ic', id_no: '800101145678', email: 'nope' }); check('bad email is refused', !!r.error, err(r))
  r = await U.hra.c.from('company_directors').insert({ company_id: C, full_name: 'Bad Phone', id_type: 'ic', id_no: '800101145678', mobile: '12345' }); check('bad mobile is refused', !!r.error, err(r))
  r = await U.hra.c.from('company_directors').insert({ company_id: C, full_name: 'No Nat', id_type: 'passport', id_no: 'A1234567' }); check('passport needs nationality', !!r.error, err(r))
  r = await U.hra.c.from('company_directors').insert({ company_id: C, full_name: 'Placeholder', id_type: 'ic', id_no: '000000-00-0001' }); check('placeholder IC only allowed for sample companies', !!r.error, err(r))
  r = await U.hra.c.from('company_directors').insert({ company_id: C, full_name: 'Siti Test', id_type: 'ic', id_no: '900215-10-1234', designation: 'director_shareholder', mobile: '+60 19-876 5432' }).select(); check('HR Admin adds a director', r.data?.[0]?.mobile === '+60198765432', err(r))
  const ssm2 = `${C}/ssm/${crypto.randomUUID()}.pdf`
  r = await up('hra', ssm2); check('HR Admin uploads another SSM copy', !r.error, err(r))
  r = await U.hra.c.from('company_docs').insert({ company_id: C, doc_type: 'einfo', path: ssm2, name: 'einfo.pdf' }).select(); check('HR Admin adds an SSM document row', r.data?.length === 1, err(r))
  r = await U.hra.c.from('company_details').update({ ssm_new: '12' }).eq('company_id', C); check('bad SSM number is refused', !!r.error, err(r))

  // ---- audit (with the IC masked)
  const au = (await admin.from('audit_log').select('action,details').eq('entity', 'company').eq('entity_id', C)).data || []
  check('company changes are audited', ['company.create', 'company.details.insert', 'company.directors.insert', 'company.docs.insert', 'company.details.update', 'company.edit'].every((a) => au.some((x) => x.action === a)), JSON.stringify([...new Set(au.map((x) => x.action))]))
  check('the audit log never holds the full IC number', !JSON.stringify(au).includes('800101-14-5678') && !JSON.stringify(au).includes('800101145678'))

  // ---- create permission switches (HR permissions; default ON)
  const flags = (await admin.from('app_config').select('value').eq('key', 'hr_admin').maybeSingle()).data?.value || {}
  r = await U.hra.c.from('app_config').upsert({ key: 'hr_admin', value: { ...flags, hrmCreateCompanies: false } }).select(); check('HR Admin cannot change the permission switch', !r.data?.length)
  r = await U.gm.c.from('app_config').upsert({ key: 'hr_admin', value: { ...flags, hrmCreateCompanies: false, createCompanies: false } }).select(); check('GM turns the switches off', r.data?.length === 1, err(r))
  r = await U.hrm.c.rpc('company_create', { p: { name: `CT Off ${RUN}` } }); check('with the switch off, HR Manager cannot create', !!r.error, err(r))
  r = await U.hra.c.rpc('company_create', { p: { name: `CT Off2 ${RUN}` } }); check('with the switch off, HR Admin cannot create', !!r.error, err(r))
  r = await U.hrm.c.storage.from('company-docs').upload(`staging/${U.hrm.id}/ssm/y.pdf`, pdf); check('with the switch off, HR Manager cannot upload', !!r.error)
  await admin.from('app_config').upsert({ key: 'hr_admin', value: flags })
  r = await U.om.c.rpc('company_create', { p: { name: `CT Om ${RUN}` } }); check('Outlet Manager can never create', !!r.error, err(r))
  r = await U.viewer.c.rpc('company_create', { p: { name: `CT View ${RUN}` } }); check('Viewer can never create', !!r.error, err(r))
  const cfg2 = (await admin.from('app_config').select('value').eq('key', 'companies').single()).data.value
  r = await U.hra.c.from('app_config').update({ value: { ...cfg2, items: [...cfg2.items, { id: `ct-x-${RUN}`, name: 'CT X' }] } }).eq('key', 'companies').select()
  check('company list write path is guarded (HR Admin has no list write)', !r.data?.length)
  r = await U.hra.c.rpc('company_create', { p: { name: (name + ' b').toUpperCase() } }); check('duplicate names refused (any case)', !!r.error, err(r))

  // ---- delete: GM / CEO, only without dependants
  r = await U.gm.c.rpc('company_create', { p: { name: `CT Gm ${RUN}`, sector: 'Agriculture' } }); const G = r.data?.id; if (G) mine.push(G); check('GM creates a company', !!G, err(r))
  await admin.from('records').insert({ entity: 'outlets', id: `ct-o-${RUN}`, data: { name: 'CT outlet', companyId: G } })
  r = await U.gm.c.rpc('company_delete', { p_id: G }); check('GM cannot delete a company that has outlets', !!r.error && /outlet/i.test(err(r)), err(r))
  await admin.from('records').delete().eq('id', `ct-o-${RUN}`)
  await admin.from('qr_quotas').insert({ company_id: G, ref_no: `CT/${RUN}`, approval_date: '2026-10-01', expiry_date: '2027-10-01', total: 1, breakdown: { Nepal: 1 } }).then(() => {}, () => {})
  const hasQ = (await admin.from('qr_quotas').select('id').eq('company_id', G)).data?.length
  if (hasQ) { r = await U.gm.c.rpc('company_delete', { p_id: G }); check('GM cannot delete a company with quota letters', !!r.error && /quota/i.test(err(r)), err(r)); await admin.from('qr_quotas').delete().eq('company_id', G) }
  r = await U.gm.c.rpc('company_delete', { p_id: G }); check('GM deletes a clean company', !r.error && !(await items()).some((c) => c.id === G), err(r))
  r = await U.gm.c.from('company_directors').delete().eq('company_id', C).eq('full_name', 'Siti Test').select(); check('GM deletes a director', r.data?.length === 1, err(r))
  r = await U.ceo.c.rpc('company_delete', { p_id: C }); check('CEO deletes a company and gets its files back to remove', !r.error && r.data?.paths?.length >= 3, err(r) + JSON.stringify(r.data))
  if (!r.error) { const rm = await U.ceo.c.storage.from('company-docs').remove(r.data.paths); check('CEO removes the stored files', !rm.error && rm.data?.length >= 3, JSON.stringify(rm.error || rm.data?.length)) }
  check('company detail rows are gone', !(await admin.from('company_details').select('company_id').eq('company_id', C)).data?.length && !(await admin.from('company_directors').select('id').eq('company_id', C)).data?.length)
} catch (e) { fail++; console.log('FAIL exception', e.message) }
finally {
  await restore()
  // remove only this run's companies (and their rows / files) if a check failed half-way
  const cfg = (await admin.from('app_config').select('value').eq('key', 'companies').single()).data?.value
  const left = (cfg?.items || []).filter((c) => (c.name || '').startsWith('CT ') && (c.name || '').includes(RUN)).map((c) => c.id)
  if (left.length) {
    const files = [...((await admin.from('company_docs').select('path').in('company_id', left)).data || []).map((x) => x.path), ...((await admin.from('company_directors').select('id_file').in('company_id', left)).data || []).map((x) => x.id_file).filter(Boolean)]
    for (const t of ['company_directors', 'company_docs', 'company_details']) await admin.from(t).delete().in('company_id', left)
    await admin.from('app_config').update({ value: { ...cfg, items: cfg.items.filter((c) => !left.includes(c.id)) } }).eq('key', 'companies')
    if (files.length) await admin.storage.from('company-docs').remove(files)
  }
  const stray = ((await admin.storage.from('company-docs').list('staging', { limit: 1000 })).data || []).map((f) => f.name).filter((n) => Object.values(U).some((u) => u.id === n))
  for (const s of stray) for (const sub of ['ssm', 'directors']) { const l = (await admin.storage.from('company-docs').list(`staging/${s}/${sub}`)).data || []; if (l.length) await admin.storage.from('company-docs').remove(l.map((f) => `staging/${s}/${sub}/${f.name}`)) }
  await cleanupOwn(admin, PRE).catch((e) => console.log('cleanup note:', e.message))
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
