// ai-assistant: the FW Manager chat assistant (v1.5.0).
//   POST {op:'status'}                                  -> {enabled, provider, model?, limit, used, role}
//   POST {op:'chat', messages:[{role,text}], lang}       -> {reply, tables[], drafts[], tools[], usage}
// Security model
// - The caller's JWT is verified, then EVERY lookup runs as the caller (anon key + caller JWT), so RLS, scope and
//   hide-superiors apply exactly as in the app (pull_records, profiles_v, requests_v, qr_* functions).
// - Tool results are reduced to a whitelist before they reach the LLM: passport numbers masked to the last 4 characters,
//   no PINs, phones, bank / remittance details or documents; pay only for roles that may see salary.
// - Action tools only PREPARE drafts (ai_drafts). The user confirms in the app, which runs the normal functions.
// - Provider: secrets AI_PROVIDER (gemini | openai | anthropic, default gemini), AI_API_KEY, optional AI_MODEL.
//   No key -> dormant (enabled:false). The key is read here only, never returned or logged.
// - Test-only mock provider: AI_PROVIDER=mock AND AI_ALLOW_MOCK=1 (never set on live). Deterministic tool calls.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import K from './knowledge.json' with { type: 'json' }

const env = (k: string) => (Deno.env.get(k) || '').trim()
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const PROVIDER = (env('AI_PROVIDER') || 'gemini').toLowerCase()
const MOCK = PROVIDER === 'mock' && env('AI_ALLOW_MOCK') === '1'
const DEFAULT_MODEL: Record<string, string> = { gemini: 'gemini-3.8-flash', openai: 'gpt-5-mini', anthropic: 'claude-haiku-4-5' }
const MODEL = env('AI_MODEL') || DEFAULT_MODEL[PROVIDER] || ''
const ENABLED = MOCK || (!!env('AI_API_KEY') && PROVIDER in DEFAULT_MODEL)
const MAX_ROUNDS = 5

const RANK: Record<string, number> = { super_admin: 6, admin: 6, general_manager: 5, hr_admin: 4, hr_manager: 3, manager: 3, outlet_manager: 2, viewer: 1 }
const ROLE_LABEL: Record<string, string> = { super_admin: 'CEO', general_manager: 'General Manager', hr_admin: 'HR Admin', hr_manager: 'HR Manager', outlet_manager: 'Outlet Manager', viewer: 'Viewer (read only)' }
const HELP_ROLE: Record<string, string> = { super_admin: 'ceo', admin: 'ceo', general_manager: 'gm', hr_admin: 'hra', hr_manager: 'hrm', manager: 'hrm', outlet_manager: 'om' }
const LANGS: Record<string, string> = { en: 'English', ms: 'Bahasa Melayu', zh: 'Chinese (Simplified)', ta: 'Tamil', hi: 'Hindi', ne: 'Nepali', bn: 'Bengali', id: 'Bahasa Indonesia', my: 'Burmese', ur: 'Urdu', te: 'Telugu', ml: 'Malayalam' }
const EXITED = ['Absconded', 'Resigned', 'Terminated', 'Contract Ended', 'Repatriated']
const DOC = { passport: 'Passport', permit: 'Work Permit / PLKS (VP(TE))', visa: 'Visa / VDR', fomema: 'FOMEMA Medical', insurance: 'Insurance (SPIKPA / Hospitalisation)' } as Record<string, string>

// ---------- helpers ----------
type J = Record<string, unknown>
const todayMY = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
const daysTo = (d?: string) => (d ? Math.round((Date.parse(d.slice(0, 10)) - Date.parse(todayMY())) / 864e5) : null)
export const maskId = (v?: unknown) => {
  const s = String(v ?? '').replace(/\s+/g, '')
  if (!s) return null
  return s.length <= 4 ? '••' + s.slice(-2) : '•••• ' + s.slice(-4)
}
const norm = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim()
const words = (s: unknown) => norm(s).split(' ').filter((w) => w.length > 1)
const clip = (s: unknown, n = 300) => { const t = String(s ?? ''); return t.length > n ? t.slice(0, n) + '…' : t }

interface Me { id: string; role: string; rank: number; name: string; canSeeSalary: boolean; quotaRank: number }
interface Table { title: string; columns: { key: string; label: string }[]; rows: J[]; more?: number }
interface Ctx { me: Me; db: SupabaseClient; tables: Table[]; drafts: J[]; tools: string[]; cache: Map<string, unknown> }

// ---------- data access (always as the caller) ----------
async function loadRecords(ctx: Ctx) {
  if (ctx.cache.has('records')) return ctx.cache.get('records') as { workers: J[]; outlets: Map<string, string> }
  const workers = new Map<string, J>(), outlets = new Map<string, string>()
  let since = '1970-01-01T00:00:00Z'
  for (let i = 0; i < 40; i++) {
    const { data, error } = await ctx.db.rpc('pull_records', { p_since: since, p_limit: 1000 })
    if (error) throw new Error('Could not read workers: ' + error.message)
    const rows = (data || []) as { entity: string; id: string; data: J; deleted: boolean; server_ts: string }[]
    for (const r of rows) {
      if (r.entity === 'workers') { if (r.deleted) workers.delete(r.id); else workers.set(r.id, r.data) }
      if (r.entity === 'outlets') { if (r.deleted) outlets.delete(r.id); else outlets.set(r.id, String((r.data as J).name || r.id)) }
    }
    if (rows.length < 1000) break
    since = rows[rows.length - 1].server_ts
  }
  const v = { workers: [...workers.values()].filter((w) => w && w.id), outlets }
  ctx.cache.set('records', v)
  return v
}
const docsOf = (w: J) => (Array.isArray(w.documents) ? w.documents : []) as J[]
const latestDoc = (w: J, type: string) => docsOf(w).filter((d) => d.type === type).sort((a, b) => String(b.expiryDate || '').localeCompare(String(a.expiryDate || '')))[0]
function basicPay(w: J): number | null {
  const inc = (Array.isArray(w.increments) ? w.increments : []) as J[]
  const last = [...inc].sort((a, b) => String(a.date).localeCompare(String(b.date))).pop()
  const v = last ? Number(last.newPay) : Number(w.initialBasicPay)
  return Number.isFinite(v) && v > 0 ? v : null
}
// the ONLY shape of a worker the LLM ever sees
function safeWorker(ctx: Ctx, w: J, outlets: Map<string, string>) {
  const pp = latestDoc(w, DOC.passport), pm = latestDoc(w, DOC.permit)
  const o: J = {
    id: w.id, worker_no: w.workerNo || null, name: w.fullName || '', nationality: w.nationality || null, status: w.status || null,
    outlet: w.outletId ? outlets.get(String(w.outletId)) || null : null, job: w.jobCategory || null, joined: w.joinDate || null,
    passport_no: maskId(pp?.number), passport_expiry: pp?.expiryDate || null, permit_expiry: pm?.expiryDate || null,
    contract_end: w.contractEnd || null, link: `/workers/${w.id}`,
  }
  if (ctx.me.canSeeSalary) { const b = basicPay(w); if (b != null) o.basic_pay_rm = b }
  return o
}
function findWorker(list: J[], ref: string): J | { error: string } {
  const r = norm(ref)
  if (!r) return { error: 'Say which worker (name or worker number).' }
  const exact = list.filter((w) => norm(w.id) === r || norm(w.workerNo) === r)
  if (exact.length === 1) return exact[0]
  const ws = words(ref)
  const hits = list.filter((w) => { const n = norm(w.fullName); return ws.every((x) => n.includes(x)) })
  if (hits.length === 1) return hits[0]
  if (hits.length > 1) return { error: `${hits.length} workers match "${ref}": ${hits.slice(0, 6).map((w) => `${w.fullName} (${w.workerNo || w.id})`).join('; ')}. Ask which one.` }
  return { error: `No worker matching "${ref}" in your scope.` }
}

// ---------- tools ----------
type Tool = { name: string; description: string; parameters: J; run: (ctx: Ctx, a: J) => Promise<J> }
const S = (d: string, extra: J = {}) => ({ type: 'string', description: d, ...extra })
const N = (d: string) => ({ type: 'integer', description: d })
const B = (d: string) => ({ type: 'boolean', description: d })
const obj = (props: J, required: string[] = []) => ({ type: 'object', properties: props, required })

const TOOLS: Tool[] = [
  {
    name: 'search_workers', description: 'Find workers the user can see, by name, worker number, nationality, outlet, job or status. Returns key facts and a link to each worker.',
    parameters: obj({ query: S('Words to match (name, worker no., nationality, outlet, job). Empty = everyone.'), status: S('active (default), exited or all', { enum: ['active', 'exited', 'all'] }), limit: N('Max rows (default 20, max 50)') }),
    async run(ctx, a) {
      const { workers, outlets } = await loadRecords(ctx)
      const st = String(a.status || 'active'), ws = words(a.query)
      let list = workers.filter((w) => st === 'all' || (st === 'exited' ? EXITED.includes(String(w.status)) : !EXITED.includes(String(w.status))))
      if (ws.length) list = list.filter((w) => { const hay = norm([w.fullName, w.workerNo, w.id, w.nationality, w.jobCategory, w.status, outlets.get(String(w.outletId))].join(' ')); return ws.every((x) => hay.includes(x)) })
      const lim = Math.min(Math.max(Number(a.limit) || 20, 1), 50)
      const rows = list.slice(0, lim).map((w) => safeWorker(ctx, w, outlets))
      const cols = [{ key: 'name', label: 'Name' }, { key: 'worker_no', label: 'No.' }, { key: 'nationality', label: 'Nationality' }, { key: 'outlet', label: 'Outlet' }, { key: 'status', label: 'Status' }, { key: 'passport_no', label: 'Passport' }, { key: 'permit_expiry', label: 'Permit expiry' }]
      if (ctx.me.canSeeSalary) cols.push({ key: 'basic_pay_rm', label: 'Basic (RM)' })
      if (rows.length) ctx.tables.push({ title: `Workers${a.query ? ` matching "${clip(a.query, 40)}"` : ''}`, columns: cols, rows, more: Math.max(list.length - rows.length, 0) })
      return { total_matches: list.length, shown: rows.length, workers: rows }
    },
  },
  {
    name: 'document_expiries', description: 'Workers whose passport, work permit (PLKS), visa, FOMEMA or insurance expires soon or has expired.',
    parameters: obj({ doc: S('passport, permit, visa, fomema, insurance or any (default any)', { enum: ['any', 'passport', 'permit', 'visa', 'fomema', 'insurance'] }), within_days: N('Look ahead this many days (default 60, max 365)'), include_expired: B('Include already expired (default true)') }),
    async run(ctx, a) {
      const { workers, outlets } = await loadRecords(ctx)
      const kinds = !a.doc || a.doc === 'any' ? Object.keys(DOC) : [String(a.doc)]
      const within = Math.min(Math.max(Number(a.within_days) || 60, 1), 365), incl = a.include_expired !== false
      const out: J[] = []
      for (const w of workers) {
        if (EXITED.includes(String(w.status))) continue
        for (const k of kinds) {
          const d = latestDoc(w, DOC[k]); const left = daysTo(d?.expiryDate as string)
          if (left == null || left > within || (!incl && left < 0)) continue
          out.push({ id: w.id, name: w.fullName, worker_no: w.workerNo || null, outlet: outlets.get(String(w.outletId)) || null, document: k, number: k === 'passport' ? maskId(d!.number) : undefined, expiry: d!.expiryDate, days_left: left, link: `/workers/${w.id}` })
        }
      }
      out.sort((x, y) => Number(x.days_left) - Number(y.days_left))
      const rows = out.slice(0, 50)
      if (rows.length) ctx.tables.push({ title: `Expiring within ${within} days${incl ? ' (and expired)' : ''}`, columns: [{ key: 'name', label: 'Worker' }, { key: 'outlet', label: 'Outlet' }, { key: 'document', label: 'Document' }, { key: 'expiry', label: 'Expiry' }, { key: 'days_left', label: 'Days left' }], rows, more: Math.max(out.length - rows.length, 0) })
      return { total: out.length, expired: out.filter((x) => Number(x.days_left) < 0).length, items: rows }
    },
  },
  {
    name: 'quota_overview', description: 'Quota master: per company and letter, approved / reserved / used / available slots, expiry and days left (Approval & Recruitment roles only).',
    parameters: obj({ company: S('Company name or id to filter (optional)') }),
    async run(ctx, a) {
      if (ctx.me.quotaRank < 1) return { error: 'Approval & Recruitment figures are not part of your role.' }
      const { data, error } = await ctx.db.rpc('qr_master', { p_company: null })
      if (error) return { error: error.message }
      let rows = ((data || []) as J[]).map((r) => ({ level: r.level, company: r.company_id, sector: r.sector, letter: r.ref_no, expiry: r.expiry_date, days_left: r.days_left, approved: r.approved, reserved: r.reserved, used: r.used, available: r.available, expiring_unused: r.expiring_unused, runaways: r.runaways, link: '/quota' }))
      if (a.company) { const ws = words(a.company); rows = rows.filter((r) => ws.every((x) => norm(r.company).includes(x))) }
      rows = rows.slice(0, 60)
      if (rows.length) ctx.tables.push({ title: 'Quota master', columns: [{ key: 'level', label: 'Level' }, { key: 'company', label: 'Company' }, { key: 'letter', label: 'Letter' }, { key: 'approved', label: 'Approved' }, { key: 'reserved', label: 'Reserved' }, { key: 'used', label: 'Used' }, { key: 'available', label: 'Available' }, { key: 'expiry', label: 'Expiry' }], rows })
      return { rows }
    },
  },
  {
    name: 'pipeline_status', description: 'Recruits in the pipeline (from quota approval to arrival): stage, country, VDR, flight, by company (roles with Approval & Recruitment access).',
    parameters: obj({ query: S('Name, country, company or stage words (optional)'), stage: S('Stage key to filter (optional)'), include_closed: B('Include dropped / converted (default false)') }),
    async run(ctx, a) {
      if (ctx.me.quotaRank < 1) return { error: 'The recruitment pipeline is not part of your role.' }
      let q = ctx.db.from('qr_recruits').select('id, company_id, country, full_name, passport_no, stage, status, vdr_approved, vdr_expiry, flight_at, arrived_at, outlet_id').order('updated_at', { ascending: false }).limit(500)
      if (!a.include_closed) q = q.eq('status', 'active')
      if (a.stage) q = q.eq('stage', String(a.stage))
      const { data, error } = await q
      if (error) return { error: error.message }
      let rows = ((data || []) as J[]).map((r) => ({ id: r.id, name: r.full_name, company: r.company_id, country: r.country, stage: r.stage, status: r.status, passport_no: maskId(r.passport_no), vdr_approved: r.vdr_approved || null, vdr_expiry: r.vdr_expiry || null, flight: r.flight_at ? String(r.flight_at).slice(0, 16) : null, arrived: r.arrived_at ? String(r.arrived_at).slice(0, 10) : null, link: `/quota/recruit/${r.id}` }))
      if (a.query) { const ws = words(a.query); rows = rows.filter((r) => { const h = norm([r.name, r.company, r.country, r.stage].join(' ')); return ws.every((x) => h.includes(x)) }) }
      const by: Record<string, number> = {}; for (const r of rows) by[String(r.stage)] = (by[String(r.stage)] || 0) + 1
      const shown = rows.slice(0, 40)
      if (shown.length) ctx.tables.push({ title: 'Recruitment pipeline', columns: [{ key: 'name', label: 'Recruit' }, { key: 'company', label: 'Company' }, { key: 'country', label: 'Country' }, { key: 'stage', label: 'Stage' }, { key: 'vdr_expiry', label: 'VDR expiry' }, { key: 'flight', label: 'Flight' }], rows: shown, more: Math.max(rows.length - shown.length, 0) })
      return { total: rows.length, by_stage: by, recruits: shown }
    },
  },
  {
    name: 'followups', description: 'What needs attention: open requests the user can see (waiting, returned, escalated), HR follow-ups and overdue quota tasks.',
    parameters: obj({ only_overdue: B('Only items past their due date (default false)') }),
    async run(ctx, a) {
      const out: J[] = []
      const visible = new Set<string>([ctx.me.id])
      const pv = await ctx.db.from('profiles_v').select('id').limit(1000)
      for (const p of (pv.data || []) as J[]) visible.add(String(p.id))
      const rq = await ctx.db.from('requests_v').select('id, ref_no, type, title, status, required_level, created_at, created_by, created_by_name, created_by_role, worker_id').in('status', ['submitted', 'returned', 'recommended', 'escalated', 'approved']).order('created_at', { ascending: true }).limit(200)
      const label = new Map((K.requestTypes as J[]).map((t) => [t.key, t.label]))
      for (const r of (rq.data || []) as J[]) {
        const age = -Number(daysTo(String(r.created_at)))
        const by = visible.has(String(r.created_by)) && (RANK[String(r.created_by_role)] || 0) <= ctx.me.rank ? r.created_by_name : null
        out.push({ kind: 'request', ref: `#${r.ref_no}`, title: r.title || label.get(r.type) || r.type, status: r.status, waiting_days: age, raised_by: by, overdue: age > 3, link: `/requests/${r.id}` })
      }
      if (ctx.me.quotaRank >= 1) {
        const fu = await ctx.db.rpc('qr_followups')
        for (const f of (fu.data || []) as J[]) out.push({ kind: 'quota ' + f.kind, ref: f.ref, title: f.title, status: f.step, due: f.due, days_late: f.days_late, owner: f.owner_id && visible.has(String(f.owner_id)) ? f.owner_name : null, overdue: Number(f.days_late) > 0, link: '/quota' })
      }
      const ht = await ctx.db.from('hr_tasks_v').select('id, worker_id, kind, title, status, created_at, done_at').is('done_at', null).order('created_at', { ascending: true }).limit(200)
      for (const t of (ht.data || []) as J[]) {
        if (['done', 'closed', 'cancelled'].includes(String(t.status))) continue
        const age = -Number(daysTo(String(t.created_at)))
        out.push({ kind: 'hr task', ref: null, title: clip(t.title || t.kind || 'HR task', 120), status: t.status || 'open', waiting_days: age, overdue: age > 7, link: t.worker_id ? `/workers/${t.worker_id}` : '/requests' })
      }
      const rows = (a.only_overdue ? out.filter((x) => x.overdue) : out).slice(0, 60)
      if (rows.length) ctx.tables.push({ title: a.only_overdue ? 'Overdue items' : 'Follow-ups', columns: [{ key: 'kind', label: 'Type' }, { key: 'ref', label: 'Ref' }, { key: 'title', label: 'Item' }, { key: 'status', label: 'Status' }, { key: 'days_late', label: 'Days late' }, { key: 'waiting_days', label: 'Waiting (days)' }], rows })
      return { total: rows.length, overdue: out.filter((x) => x.overdue).length, items: rows }
    },
  },
  {
    name: 'rules_regulations', description: 'Malaysian foreign-worker rules & regulations in force (quota validity, levy, FOMEMA, VDR, age limits, sector rules…) with source and effective date.',
    parameters: obj({ query: S('Topic words, e.g. "FOMEMA days", "levy", "age limit" (optional)') }),
    async run(ctx, a) {
      if (ctx.me.quotaRank < 1) return { error: 'Rules & regulations are kept in Approval & Recruitment, which is not part of your role. See Help for the basics.' }
      const [cat, rules] = await Promise.all([ctx.db.rpc('qr_reg_catalog'), ctx.db.from('qr_reg_rules').select('key, scope, value, effective_from, source_ref, source_url, verified, note').eq('status', 'active').order('effective_from', { ascending: false }).limit(500)])
      const labels = new Map(((cat.data || []) as J[]).map((c) => [c.key, c]))
      const seen = new Set<string>(); const today = todayMY()
      let rows = ((rules.data || []) as J[]).filter((r) => String(r.effective_from) <= today).filter((r) => { const k = `${r.key}|${r.scope}`; if (seen.has(k)) return false; seen.add(k); return true })
        .map((r) => { const c = labels.get(r.key) as J | undefined; return { rule: c?.label || r.key, group: c?.grp || null, scope: r.scope || null, value: clip(JSON.stringify(r.value), 400), unit: c?.unit || null, effective_from: r.effective_from, source: r.source_ref || null, verified: !!r.verified, explain: c?.help || null, link: '/quota' } })
      if (a.query) { const ws = words(a.query); const sc = (r: J) => ws.filter((x) => norm([r.rule, r.group, r.scope, r.explain, r.value].join(' ')).includes(x)).length; rows = rows.map((r) => [sc(r), r] as const).filter(([s]) => s > 0).sort((x, y) => y[0] - x[0]).map(([, r]) => r) }
      rows = rows.slice(0, 25)
      if (rows.length) ctx.tables.push({ title: 'Rules & regulations in force', columns: [{ key: 'rule', label: 'Rule' }, { key: 'scope', label: 'Scope' }, { key: 'value', label: 'Value' }, { key: 'effective_from', label: 'From' }, { key: 'source', label: 'Source' }], rows })
      return { rules: rows }
    },
  },
  {
    name: 'help_search', description: 'Search the FW Manager user manual and FAQ (for this user\'s role) for how to do something in the app.',
    parameters: obj({ query: S('What the user wants to do or know') }, ['query']),
    async run(ctx, a) {
      const hr = HELP_ROLE[ctx.me.role] || 'viewer', ws = words(a.query)
      const score = (t: string) => ws.reduce((s, x) => s + (norm(t).includes(x) ? 1 : 0), 0)
      const g = (K.guides as J[]).filter((x) => (x.roles as string[]).includes(hr)).map((x) => ({ s: score(`${x.title} ${x.title} ${x.text}`), x })).filter((x) => x.s > 0).sort((p, q) => q.s - p.s).slice(0, 3)
      const f = (K.faqs as J[]).filter((x) => (x.roles as string[]).includes(hr)).map((x) => ({ s: score(`${x.q} ${x.q} ${x.a}`), x })).filter((x) => x.s > 0).sort((p, q) => q.s - p.s).slice(0, 4)
      return { guides: g.map(({ x }) => ({ title: x.title, text: clip(x.text, 1500), link: `/help` })), faqs: f.map(({ x }) => ({ q: x.q, a: x.a })) }
    },
  },
  {
    name: 'draft_request', description: 'PREPARE a request draft (leave, advance, warning letter, accident report, …) for a worker. Nothing is submitted: the user reviews and taps Confirm in the app. Use the request type keys listed in the instructions.',
    parameters: obj({ request_type: S('Request type key'), worker: S('Worker name or worker number'), title: S('Short title'), details: { type: 'object', description: 'Field values for the request type (e.g. from, to, reason, amount)' }, amount: { type: 'number', description: 'Amount in RM when the type has one' } }, ['request_type', 'worker']),
    async run(ctx, a) {
      if (ctx.me.rank <= 1) return { error: 'Your role is view-only: it cannot raise requests.' }
      const t = (K.requestTypes as J[]).find((x) => x.key === a.request_type)
      if (!t) return { error: `Unknown request type "${a.request_type}".` }
      const { workers } = await loadRecords(ctx)
      const w = findWorker(workers, String(a.worker || ''))
      if ('error' in w) return w
      const details = (a.details && typeof a.details === 'object' ? a.details : {}) as J
      const fields = (t.fields as J[]).map((f) => ({ key: f.key, label: f.label, value: details[String(f.key)] ?? null, required: f.required }))
      const missing = fields.filter((f) => f.required && (f.value == null || f.value === '')).map((f) => f.label)
      const payload = { type: t.key, type_label: t.label, worker_name: w.fullName, worker_no: w.workerNo || null, title: clip(a.title || `${t.label} — ${w.fullName}`, 120), data: Object.fromEntries(fields.filter((f) => f.value != null).map((f) => [f.key, f.value])), fields, amount: a.amount ?? (t.amountKey ? details[String(t.amountKey)] ?? null : null), missing }
      const { data, error } = await ctx.db.rpc('ai_draft_create', { p_kind: 'request', p_title: payload.title, p_worker_id: w.id, p_payload: payload })
      if (error) return { error: error.message }
      ctx.drafts.push({ id: (data as J).id, kind: 'request', title: payload.title, worker_id: w.id, payload })
      return { draft_prepared: true, title: payload.title, missing_required: missing, note: 'Shown to the user with Confirm / Discard. Not submitted yet.' }
    },
  },
  {
    name: 'draft_note', description: 'PREPARE a remark / note on a worker\'s record (remark, performance, incident or praise). Saved only when the user taps Confirm.',
    parameters: obj({ worker: S('Worker name or worker number'), text: S('The note'), kind: S('remark, performance, incident or praise', { enum: ['remark', 'performance', 'incident', 'praise'] }) }, ['worker', 'text']),
    async run(ctx, a) {
      if (ctx.me.rank <= 1) return { error: 'Your role is view-only: it cannot add notes.' }
      const { workers } = await loadRecords(ctx)
      const w = findWorker(workers, String(a.worker || ''))
      if ('error' in w) return w
      const kind = ['remark', 'performance', 'incident', 'praise'].includes(String(a.kind)) ? String(a.kind) : 'remark'
      const payload = { worker_name: w.fullName, worker_no: w.workerNo || null, text: clip(a.text, 2000), kind }
      const title = `Note on ${w.fullName}`
      const { data, error } = await ctx.db.rpc('ai_draft_create', { p_kind: 'note', p_title: title, p_worker_id: w.id, p_payload: payload })
      if (error) return { error: error.message }
      ctx.drafts.push({ id: (data as J).id, kind: 'note', title, worker_id: w.id, payload })
      return { draft_prepared: true, title, note: 'Shown to the user with Confirm / Discard. Not saved yet.' }
    },
  },
  {
    name: 'draft_reminder', description: 'PREPARE a personal reminder (calendar entry) for the user, optionally about a worker. Created only when the user taps Confirm.',
    parameters: obj({ title: S('What to remember'), date: S('Date YYYY-MM-DD'), time: S('Time HH:MM, 24h (optional, default 09:00)'), worker: S('Worker name or number (optional)'), note: S('Extra detail (optional)') }, ['title', 'date']),
    async run(ctx, a) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(a.date || ''))) return { error: 'Give the date as YYYY-MM-DD.' }
      let wid: string | null = null, wname: string | null = null
      if (a.worker) { const { workers } = await loadRecords(ctx); const w = findWorker(workers, String(a.worker)); if ('error' in w) return w; wid = String(w.id); wname = String(w.fullName) }
      const time = /^\d{2}:\d{2}$/.test(String(a.time || '')) ? String(a.time) : '09:00'
      const payload = { title: clip(a.title, 120), date: a.date, time, note: a.note ? clip(a.note, 500) : null, worker_name: wname }
      const { data, error } = await ctx.db.rpc('ai_draft_create', { p_kind: 'reminder', p_title: payload.title, p_worker_id: wid, p_payload: payload })
      if (error) return { error: error.message }
      ctx.drafts.push({ id: (data as J).id, kind: 'reminder', title: payload.title, worker_id: wid, payload })
      return { draft_prepared: true, title: payload.title, when: `${a.date} ${time}` }
    },
  },
]

// ---------- system prompt ----------
function systemPrompt(me: Me, lang: string) {
  const language = LANGS[lang] || 'English'
  const types = (K.requestTypes as J[]).map((t) => `${t.key} (${t.label}; fields: ${(t.fields as J[]).map((f) => `${f.key}${f.required ? '*' : ''}`).join(', ')})`).join('; ')
  return [
    `You are the FW Manager Assistant for a Malaysian employer of foreign workers. Today is ${todayMY()} (Malaysia time).`,
    `You are helping ${me.name || 'a staff member'}, role: ${ROLE_LABEL[me.role] || me.role}. Answer ONLY from tool results and the help manual; never invent workers, numbers, dates or rules. If a tool returns an error or nothing, say so plainly.`,
    `Reply in ${language}. Keep answers short and confident: a one-line answer first, then key points. Tables are shown to the user automatically from tool results, so do not repeat whole tables — summarise (counts, the most urgent items).`,
    `Link to app screens with markdown links using the "link" values from tool results, e.g. [Ravi Kumar](/workers/abc).`,
    `You can only READ data and PREPARE drafts (draft_request, draft_note, draft_reminder). You cannot approve, reject, delete, edit or override anything. When asked to do so, prepare a draft or point to the screen where the user does it. After preparing a draft, tell the user to review it and tap Confirm.`,
    `Privacy: passport numbers are masked (last 4 only) on purpose; never ask for or reveal full passport numbers, PINs, passwords, bank details or salaries. ${me.canSeeSalary ? '' : 'This user cannot see pay: do not discuss salaries.'}`,
    `Request type keys (* = required field): ${types}.`,
  ].join('\n')
}

// ---------- providers ----------
type Msg = { role: 'user' | 'assistant'; text?: string; calls?: { id: string; name: string; args: J }[] } | { role: 'tool'; results: { id: string; name: string; content: J }[] }
type Out = { text?: string; calls?: { id: string; name: string; args: J }[] }
const decls = () => TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }))

async function post(url: string, headers: Record<string, string>, body: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
  const t = await r.text()
  if (!r.ok) { let m = t.slice(0, 300); try { const j = JSON.parse(t); m = j.error?.message || j.error?.type || m } catch { /* keep text */ } throw new Error(`AI provider error (${r.status}): ${m}`) }
  return JSON.parse(t)
}

async function callGemini(sys: string, msgs: Msg[]): Promise<Out> {
  const contents = msgs.map((m) => m.role === 'tool'
    ? { role: 'user', parts: m.results.map((r) => ({ functionResponse: { name: r.name, response: r.content } })) }
    : { role: m.role === 'assistant' ? 'model' : 'user', parts: [...(m.text ? [{ text: m.text }] : []), ...(m.calls || []).map((c) => ({ functionCall: { name: c.name, args: c.args }, ...(c.args.__sig ? { thoughtSignature: c.args.__sig } : {}) }))] })
  for (const c of contents) for (const p of c.parts as J[]) { const fc = p.functionCall as J | undefined; if (fc?.args) delete (fc.args as J).__sig }
  const j = await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, { 'x-goog-api-key': env('AI_API_KEY') },
    { systemInstruction: { parts: [{ text: sys }] }, contents, tools: [{ functionDeclarations: decls() }], generationConfig: { temperature: 0.2, maxOutputTokens: 2048 } })
  const parts = (j.candidates?.[0]?.content?.parts || []) as J[]
  const calls = parts.filter((p) => p.functionCall).map((p, i) => { const fc = p.functionCall as J; return { id: `g${i}`, name: String(fc.name), args: { ...((fc.args || {}) as J), ...(p.thoughtSignature ? { __sig: p.thoughtSignature } : {}) } } })
  return { text: parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('').trim(), calls }
}
async function callOpenAI(sys: string, msgs: Msg[]): Promise<Out> {
  const messages: J[] = [{ role: 'system', content: sys }]
  for (const m of msgs) {
    if (m.role === 'tool') for (const r of m.results) messages.push({ role: 'tool', tool_call_id: r.id, content: JSON.stringify(r.content) })
    else if (m.role === 'assistant' && m.calls?.length) messages.push({ role: 'assistant', content: m.text || null, tool_calls: m.calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) })
    else messages.push({ role: m.role, content: m.text || '' })
  }
  const j = await post('https://api.openai.com/v1/chat/completions', { Authorization: `Bearer ${env('AI_API_KEY')}` }, { model: MODEL, messages, tools: decls().map((d) => ({ type: 'function', function: d })) })
  const msg = j.choices?.[0]?.message || {}
  return { text: String(msg.content || '').trim(), calls: (msg.tool_calls || []).map((c: J) => { const f = c.function as J; let args: J = {}; try { args = JSON.parse(String(f.arguments || '{}')) } catch { /* empty */ } return { id: String(c.id), name: String(f.name), args } }) }
}
async function callAnthropic(sys: string, msgs: Msg[]): Promise<Out> {
  const messages = msgs.map((m) => m.role === 'tool'
    ? { role: 'user', content: m.results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: JSON.stringify(r.content) })) }
    : { role: m.role, content: [...(m.text ? [{ type: 'text', text: m.text }] : []), ...(m.calls || []).map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.args }))] })
  const j = await post('https://api.anthropic.com/v1/messages', { 'x-api-key': env('AI_API_KEY'), 'anthropic-version': '2023-06-01' },
    { model: MODEL, system: sys, max_tokens: 2048, temperature: 0.2, messages, tools: decls().map((d) => ({ name: d.name, description: d.description, input_schema: d.parameters })) })
  const content = (j.content || []) as J[]
  return { text: content.filter((c) => c.type === 'text').map((c) => c.text).join('').trim(), calls: content.filter((c) => c.type === 'tool_use').map((c) => ({ id: String(c.id), name: String(c.name), args: (c.input || {}) as J })) }
}
// deterministic test provider: lines "/tool name {json}" in the user's message become tool calls; after tools it
// replies with a fixed sentence. Everything it was given is echoed back in llm_saw (tests check masking).
const mockSaw: string[] = []
async function callMock(sys: string, msgs: Msg[], lang: string): Promise<Out> {
  mockSaw.push(sys, JSON.stringify(msgs))
  const last = msgs[msgs.length - 1]
  if (last.role === 'tool') return { text: `MOCK(${lang}): looked up ${last.results.map((r) => r.name).join(', ')}. See [the first link](${String(((last.results[0]?.content as J)?.workers as J[] | undefined)?.[0]?.link || '/workers')}).` }
  const calls = String(last.text || '').split('\n').map((l) => l.match(/^\/tool\s+(\w+)\s*(\{.*\})?\s*$/)).filter(Boolean).map((m, i) => { let args: J = {}; try { args = JSON.parse(m![2] || '{}') } catch { /* empty */ } return { id: `m${i}`, name: m![1], args } })
  return calls.length ? { calls } : { text: `MOCK(${lang}): ${clip(last.text, 80)}` }
}
const callLLM = (sys: string, msgs: Msg[], lang: string) => MOCK ? callMock(sys, msgs, lang) : PROVIDER === 'openai' ? callOpenAI(sys, msgs) : PROVIDER === 'anthropic' ? callAnthropic(sys, msgs) : callGemini(sys, msgs)

// ---------- handler ----------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Sign in first.' }, 401)
  const URL_ = env('SUPABASE_URL'), ANON = env('SUPABASE_ANON_KEY')
  const db = createClient(URL_, ANON, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } })
  const u = await db.auth.getUser(token)
  if (u.error || !u.data.user) return json({ error: 'Your session has expired. Sign in again.' }, 401)
  let body: J = {}
  try { body = await req.json() } catch { /* empty */ }

  const st = await db.rpc('ai_status')
  if (st.error || !st.data) return json({ error: 'Your account is not active.' }, 403)
  const status = st.data as J
  const role = String(status.role || 'viewer')
  if (body.op === 'status' || !body.op) return json({ enabled: ENABLED, provider: ENABLED ? (MOCK ? 'mock' : PROVIDER) : null, model: ENABLED && role === 'super_admin' ? (MOCK ? 'mock' : MODEL) : undefined, limit: status.limit, used: status.used, role })
  if (body.op !== 'chat') return json({ error: 'Unknown op' }, 400)
  if (!ENABLED) return json({ disabled: true, reply: role === 'super_admin' ? 'The assistant is not switched on yet. Add the AI provider key as a Supabase secret to switch it on.' : 'The assistant is not available yet.' })

  const msgsIn = (Array.isArray(body.messages) ? body.messages : []) as J[]
  const lang = String(body.lang || 'en').slice(0, 5).toLowerCase().split('-')[0]
  const history: Msg[] = msgsIn.slice(-12).filter((m) => typeof m.text === 'string' && String(m.text).trim()).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', text: clip(m.text, 4000) }))
  if (!history.length || history[history.length - 1].role !== 'user') return json({ error: 'Ask a question.' }, 400)

  const begin = await db.rpc('ai_begin')
  if (begin.error) return json({ error: begin.error.message, limit: true }, 429)

  const [{ data: sal }, { data: qr }, { data: prof }] = await Promise.all([db.rpc('can_view_salary'), db.rpc('qr_rank'), db.from('profiles_v').select('full_name').eq('id', u.data.user.id).maybeSingle()])
  const me: Me = { id: u.data.user.id, role, rank: RANK[role] || 1, name: String((prof as J | null)?.full_name || ''), canSeeSalary: sal === true, quotaRank: Number(qr) || 0 }
  const ctx: Ctx = { me, db, tables: [], drafts: [], tools: [], cache: new Map() }
  const sys = systemPrompt(me, lang)
  mockSaw.length = 0
  let reply = '', ok = true
  try {
    const convo: Msg[] = [...history]
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const out = await callLLM(sys, convo, lang)
      if (!out.calls?.length) { reply = out.text || ''; break }
      convo.push({ role: 'assistant', text: out.text, calls: out.calls })
      const results = []
      for (const c of out.calls.slice(0, 6)) {
        const tool = TOOLS.find((t) => t.name === c.name)
        ctx.tools.push(c.name)
        let content: J
        try { content = tool ? await tool.run(ctx, c.args || {}) : { error: `Unknown tool ${c.name}` } } catch (e) { content = { error: (e as Error).message } }
        results.push({ id: c.id, name: c.name, content })
      }
      convo.push({ role: 'tool', results })
      if (round === MAX_ROUNDS - 1) reply = out.text || 'Here is what I found.'
    }
  } catch (e) {
    ok = false
    reply = (e as Error).message.startsWith('AI provider error') ? 'The AI provider did not answer just now. Try again in a minute.' : 'Something went wrong while answering. Try again.'
    console.error('ai-assistant', (e as Error).message.slice(0, 300))
  }
  await db.rpc('ai_log_chat', { p_tools: [...new Set(ctx.tools)], p_lang: lang, p_provider: MOCK ? 'mock' : PROVIDER, p_ok: ok })
  return json({ reply, tables: ctx.tables.slice(0, 4), drafts: ctx.drafts, tools: [...new Set(ctx.tools)], usage: begin.data, ...(MOCK ? { llm_saw: mockSaw.join('\n') } : {}) })
})
