import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Btn, Card, Chip, Empty, KV, Modal, SelectFilter, Tabs, Toolbar } from '../components/ui'
import { FilePick } from '../components/filePick'
import { DocRowItem, UploadDoc } from '../components/vault'
import { useAuth } from '../lib/auth'
import { useConfig } from '../lib/config'
import { db, updateWorker } from '../lib/db'
import { outletName } from '../lib/calc'
import { useOutlets, useSettings, useWorkers } from '../lib/hooks'
import { slipPdf } from '../lib/passport'
import { actRequest, applyRequest, assignRequest, createRequest, listAssignees, type Assignee, type RequestEvent, emergencyMisuse, noteRequest, proofDue, proofState, refNo, useRequest, useRequests, type ApplyChoice } from '../lib/requests'
import { uploadDoc, useDocs, type DocRow } from '../lib/vault'
import {
  ACTION_LABEL, EMERGENCY_PROOF_CATEGORY, IMMEDIATE_FAMILY, OPEN_STATUSES, REQUEST_TYPE, REQUEST_TYPES, ROLE_LABEL, STATUS_LABEL, STATUS_TONE,
  availableActions, canAssign, needsMyAction, requiredLevel, ruleFor, type ReqField, type RequestRow,
} from '../lib/workflow'
import { fmtDate, rm, todayISO } from '../lib/util'
import { isExited } from '../lib/calc'
import { hrTaskDone, useHrTasks, type HrTask } from '../lib/ceoReview'
import { OverruleDialog, decidedLine } from './CeoReview'
import { toast } from '../components/toast'

const LEVEL_PATH: Record<string, string> = { hr_manager: 'HR Manager', hr_admin: 'HR Manager → HR Admin', super_admin: 'HR Manager → HR Admin → General Manager (final; CEO if no GM)' }
const ago = (iso: string) => {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000)
  return h < 1 ? 'just now' : h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`
}
const err = (e: unknown) => alert((e as Error).message)
/** short role names for the timeline ("Assigned by CEO (Mouli Sankar) → GM: Aisyah, 24 Oct 10:55") */
const SHORT_ROLE: Record<string, string> = { super_admin: 'CEO', admin: 'Admin', general_manager: 'GM', hr_admin: 'HR Admin', hr_manager: 'HR Manager', outlet_manager: 'Outlet Manager', worker: 'Worker' }
const shortRole = (r?: string | null) => (r ? SHORT_ROLE[r] || ROLE_LABEL[r] || r : '')
const when = (iso: string) => {
  const d = new Date(iso)
  return `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const who = (e: Pick<RequestEvent, 'by_role' | 'by_name'>) => `${shortRole(e.by_role)}${e.by_name ? ` (${e.by_name})` : ''}`
/** one readable timeline line for assign / escalate / skipped / CEO steps; null = use the default line */
function eventLine(e: RequestEvent): string | null {
  const meta = (e.meta || {}) as { kind?: string }
  if (e.action === 'assign' || e.action === 'escalate')
    return `${e.action === 'assign' ? 'Assigned' : 'Escalated'} by ${who(e)} → ${shortRole(e.to_role)}${e.to_name ? `: ${e.to_name}` : ''}, ${when(e.at)}`
  if (e.action === 'skipped') return `${shortRole(e.to_role)} step skipped by ${who(e)}, ${when(e.at)}`
  if (e.action === 'ceo_reviewed') return `Reviewed by ${who(e)}, ${when(e.at)}`
  if (e.action === 'ceo_recall') return `Recalled by ${who(e)} → CEO${e.to_name ? `: ${e.to_name}` : ''}, ${when(e.at)}`
  if (e.action === 'ceo_overrule' && meta.kind === 'amend') return `Amended by ${who(e)}, ${when(e.at)}`
  return null
}
/** "Before" values kept when the CEO amends a request (the original stays in the history) */
function AmendDiff({ e }: { e: RequestEvent }) {
  const m = (e.meta || {}) as { kind?: string; before?: Record<string, unknown>; after?: Record<string, unknown> }
  if (m.kind !== 'amend' || !m.before) return null
  const rows: string[] = []
  const b = m.before, a = m.after || {}
  const fmt = (x: unknown) => (x === null || x === undefined || x === '' ? '—' : typeof x === 'object' ? JSON.stringify(x) : String(x))
  if ('title' in a && fmt(b.title) !== fmt(a.title)) rows.push(`Title: ${fmt(b.title)} → ${fmt(a.title)}`)
  if ('amount' in a && fmt(b.amount) !== fmt(a.amount)) rows.push(`Amount: ${fmt(b.amount)} → ${fmt(a.amount)}`)
  const bd = (b.data || {}) as Record<string, unknown>, ad = (a.data || {}) as Record<string, unknown>
  Object.keys(ad).forEach((k) => { if (fmt(bd[k]) !== fmt(ad[k])) rows.push(`${k}: ${fmt(bd[k])} → ${fmt(ad[k])}`) })
  return rows.length ? <ul className="small muted">{rows.map((x) => <li key={x}>{x}</li>)}</ul> : null
}

/* ======================= list ======================= */
type ListTab = 'mine_action' | 'open' | 'done' | 'all' | 'tasks'
export default function RequestsPage() {
  const { session, role, canRequest, can, route, isHr } = useAuth()
  const tasks = useHrTasks(isHr)
  const openTasks = tasks.filter((x) => x.status === 'open')
  const uidMe = session?.user.id || ''
  const { rows, loading, error } = useRequests()
  const workers = useWorkers()
  const outlets = useOutlets()
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const [tab, setTab] = useState<ListTab>((sp.get('tab') as ListTab) || 'mine_action')
  const [type, setType] = useState(sp.get('type') || '')
  const [outlet, setOutlet] = useState('')
  const mine = rows.filter((r) => needsMyAction(r, role || '', uidMe, { can, route }))
  const shown = rows.filter((r) => (tab === 'mine_action' ? mine.includes(r) : tab === 'open' ? OPEN_STATUSES.includes(r.status) : tab === 'done' ? !OPEN_STATUSES.includes(r.status) : true)
    && (!type || r.type === type) && (!outlet || r.outlet_id === outlet))
  const wName = (id: string | null) => workers.find((w) => w.id === id)?.fullName || '—'
  return (
    <div className="page">
      <div className="page-h">
        <div><h1>Requests</h1><p className="muted">{rows.filter((r) => OPEN_STATUSES.includes(r.status)).length} open · {mine.length} waiting for you</p></div>
        {canRequest && <Btn kind="primary" icon="plus" onClick={() => nav('/requests/new')}>New request</Btn>}
      </div>
      <Tabs tabs={[{ id: 'mine_action', label: 'Needs my action', badge: mine.length }, { id: 'open', label: 'Open' }, { id: 'done', label: 'Closed' }, { id: 'all', label: 'All' }, ...(isHr ? [{ id: 'tasks' as ListTab, label: 'HR follow-ups', badge: openTasks.length }] : [])]} value={tab} onChange={(t) => { setTab(t); setSp({ tab: t }, { replace: true }) }} />
      <Toolbar>
        <SelectFilter label="Type" value={type} onChange={setType} options={[{ value: '', label: 'All types' }, ...REQUEST_TYPES.map((t) => ({ value: t.key, label: `${t.icon} ${t.label}` }))]} />
        {outlets.length > 1 && <SelectFilter label="Outlet" value={outlet} onChange={setOutlet} options={[{ value: '', label: 'All outlets' }, ...outlets.map((o) => ({ value: o.id, label: o.name }))]} />}
      </Toolbar>
      {error && <p className="warn small">{error}</p>}
      {tab === 'tasks' ? <HrTasksCard tasks={tasks} /> : <Card>
        {loading && !rows.length ? <p className="muted">Loading…</p> : shown.length === 0 ? <Empty icon="check" title={tab === 'mine_action' ? 'Nothing waiting for you 🎉' : 'No requests'} /> : (
          <ul className="rows req-list">
            {shown.map((r) => {
              const t = REQUEST_TYPE[r.type]
              return (
                <li key={r.id}>
                  <Link to={`/requests/${r.id}`} className="req-link">
                    <span className="req-ic" aria-hidden>{t?.icon || '📝'}</span>
                    <div className="r-main">
                      <strong>{t?.label || r.type}{r.amount ? ` · ${rm(r.amount)}` : ''}</strong>
                      <small>{refNo(r)} · {wName(r.worker_id)} · {outletName(outlets, r.outlet_id || undefined)} · {r.created_by_name} · {ago(r.updated_at)}</small>
                    </div>
                    <div className="r-act col-end">
                      <Chip tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Chip>
                      {(r.priority === 'urgent' || r.priority === 'high') && <Chip tone="red">{r.priority}</Chip>}
                      {r.source === 'worker' && <Chip tone="blue">📱 worker</Chip>}
                      {r.manager_overdue && <Chip tone="orange">OM overdue</Chip>}
                      {r.confidential && <Chip tone="purple">🔒 confidential</Chip>}
                      {r.type === 'emergency_leave' && r.data.proofReceived !== true && !r.data.proofWaived && OPEN_STATUSES.concat('completed').includes(r.status) && <Chip tone="orange">proof pending</Chip>}
                      {r.data.ticketBooked === true && <Chip tone="purple">✈ ticket</Chip>}
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </Card>}
    </div>
  )
}

export function HrTasksCard({ tasks, title = 'HR follow-up tasks' }: { tasks: HrTask[]; title?: string }) {
  const [busy, setBusy] = useState('')
  const done = async (t: HrTask) => {
    const note = prompt(`Done: ${t.title}\n\nNote (optional, e.g. ticket cancelled, refund ref):`)
    if (note === null) return
    setBusy(t.id)
    try { await hrTaskDone(t.id, note); toast('Follow-up marked done ✓') } catch (e) { err(e) } finally { setBusy('') }
  }
  return (
    <Card title={title}>
      {tasks.length === 0 ? <p className="muted small">No follow-up tasks.</p> : (
        <ul className="rows">
          {tasks.map((t) => (
            <li key={t.id}>
              <div className="r-main">
                <strong>{t.status === 'done' ? '✅ ' : '🟠 '}{t.title}</strong>
                <small>{t.details} · created by {t.created_by_name} · {new Date(t.created_at).toLocaleString()}{t.request_id && <> · <Link to={`/requests/${t.request_id}`}>open request</Link></>}</small>
                {t.status === 'done' && <small className="muted">Done by {t.done_by_name} · {t.done_at ? new Date(t.done_at).toLocaleString() : ''}{t.done_note ? ` — ${t.done_note}` : ''}</small>}
              </div>
              {t.status === 'open' && <div className="r-act"><Btn small kind="primary" icon="check" disabled={busy === t.id} onClick={() => done(t)}>Mark done</Btn></div>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/* ======================= new request ======================= */
export function NewRequest() {
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const cfg = useConfig()
  const { canRequest, isOM } = useAuth()
  const workers = useWorkers().filter((w) => !isExited(w)).sort((a, b) => a.fullName.localeCompare(b.fullName))
  const outlets = useOutlets()
  const [type, setType] = useState(sp.get('type') || '')
  const [workerId, setWorkerId] = useState(sp.get('worker') || '')
  const [v, setV] = useState<Record<string, unknown>>({})
  const [priority, setPriority] = useState('normal')
  const [ticket, setTicket] = useState<File | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const t = REQUEST_TYPE[type]
  const reasons = cfg.emergency_reasons
  const reason = reasons.find((r) => r.key === v.reasonKey)
  const amount = t?.amountKey ? (Number(v[t.amountKey]) || null) : null
  const level = t ? requiredLevel(cfg.approval_rules, type, amount) : null
  const enabledTypes = REQUEST_TYPES.filter((x) => ruleFor(cfg.approval_rules, x.key).enabled)
  const groups = [...new Set(enabledTypes.map((x) => x.group))]
  if (!canRequest) return <div className="page"><Empty title="Requests are raised by managers and HR" /></div>

  const set = (k: string, val: unknown) => setV({ ...v, [k]: val })
  const fieldEl = (f: ReqField) => {
    const val = v[f.key]
    const label = <label htmlFor={`f-${f.key}`}>{f.label}{f.required && <span className="req"> *</span>}</label>
    if (f.type === 'checkbox') return <label key={f.key} className="check full"><input type="checkbox" checked={!!val} onChange={(e) => set(f.key, e.target.checked)} /> {f.label}</label>
    if (f.type === 'emergency_reason') return (
      <div key={f.key} className="field full">{label}
        <select id={`f-${f.key}`} value={String(val || '')} onChange={(e) => setV({ ...v, reasonKey: e.target.value, reasonLabel: reasons.find((r) => r.key === e.target.value)?.label, relationship: undefined })}>
          <option value="">— Choose the emergency —</option>{reasons.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
        <small className="hint">Emergency leave is only for real emergencies. Annual leave or home leave must be requested as Annual / Home leave.</small>
      </div>)
    if (f.type === 'outlet' || f.type === 'select') return (
      <div key={f.key} className="field">{label}
        <select id={`f-${f.key}`} value={String(val || '')} onChange={(e) => set(f.key, e.target.value)}>
          <option value="">— Select —</option>
          {f.type === 'outlet' ? outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>) : (f.options || []).map((o) => <option key={o}>{o}</option>)}
        </select>{f.hint && <small className="hint">{f.hint}</small>}</div>)
    return (
      <div key={f.key} className={`field ${f.type === 'textarea' ? 'full' : ''}`}>{label}
        {f.type === 'textarea' ? <textarea id={`f-${f.key}`} rows={3} value={String(val || '')} onChange={(e) => set(f.key, e.target.value)} />
          : <input id={`f-${f.key}`} type={f.type || 'text'} inputMode={f.type === 'number' ? 'decimal' : undefined} value={String(val ?? '')} onChange={(e) => set(f.key, f.type === 'number' ? (e.target.value === '' ? undefined : Number(e.target.value)) : e.target.value)} />}
        {f.hint && <small className="hint">{f.hint}</small>}</div>)
  }

  const submit = async () => {
    setMsg('')
    if (!workerId) return setMsg('Choose the worker')
    if (!t) return setMsg('Choose the request type')
    for (const f of t.fields) if (f.required && (v[f.key] === undefined || v[f.key] === '' || v[f.key] === null)) return setMsg(`Fill in: ${f.label}`)
    if (v.from && v.to && String(v.to) < String(v.from)) return setMsg('“To” date is before “From” date')
    if (type === 'emergency_leave') {
      if (!reason) return setMsg('Choose the emergency reason')
      if (reason.relationship && !v.relationship) return setMsg('Choose the family member')
      if (reason.detailed && String(v.reasonDetail || '').length < 40) return setMsg('Explain the emergency in detail (at least 40 characters)')
      if (emergencyMisuse(`${v.reason || ''} ${v.reasonDetail || ''}`)) return setMsg('This looks like annual / home leave. Please use the Annual leave or Home leave request instead.')
      if (!ticket) return setMsg('Attach the flight ticket (required for emergency leave)')
    }
    const w = workers.find((x) => x.id === workerId)!
    try {
      setBusy('Sending…')
      const data = { ...v, ...(reason ? { reasonLabel: reason.label, proofDays: reason.proofDays, proofExpected: reason.proof } : {}) }
      const title = `${t.label} — ${w.fullName}`
      const r = await createRequest(type, workerId, title, data, amount, type === 'emergency_leave' ? 'urgent' : priority)
      const { compressImage } = await import('../lib/vault')
      const prep = async (f: File) => (f.type.startsWith('image/') ? { blob: await compressImage(f), name: f.name.replace(/\.\w+$/, '') + '.jpg', pages: 1 } : { blob: f as Blob, name: f.name, pages: 1 })
      if (ticket) { setBusy('Uploading ticket…'); await uploadDoc({ workerId, category: 'Flight ticket', title: `Flight ticket ${refNo(r)}`, requestId: r.id, source: 'request' }, await prep(ticket)) }
      for (const f of files) {
        setBusy('Uploading attachments…')
        await uploadDoc({ workerId, category: type === 'emergency_leave' ? EMERGENCY_PROOF_CATEGORY : t.mcCategory || 'Other', title: `${t.label} ${refNo(r)}`, requestId: r.id, source: 'request' }, await prep(f))
      }
      if (type === 'emergency_leave' && files.length) await noteRequest(r.id, { proofReceived: true }, 'Proof attached with the request')
      nav(`/requests/${r.id}`, { replace: true })
    } catch (e) { setMsg((e as Error).message) } finally { setBusy('') }
  }

  return (
    <div className="page narrow">
      <div className="page-h"><div className="row gap-s"><Btn kind="ghost" icon="back" onClick={() => nav(-1)} title="Back" /><h1>New request</h1></div></div>
      <Card>
        <div className="grid-form">
          <div className="field full"><label htmlFor="rq-w">Worker <span className="req">*</span></label>
            <select id="rq-w" value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
              <option value="">— Select worker —</option>{workers.map((w) => <option key={w.id} value={w.id}>{w.fullName} · {w.workerNo}</option>)}
            </select>
            {isOM && workers.length === 0 && <small className="warn">No workers in your outlets yet. Ask HR to assign your outlets.</small>}
          </div>
          <div className="field full"><label htmlFor="rq-t">Request type <span className="req">*</span></label>
            <select id="rq-t" value={type} onChange={(e) => { setType(e.target.value); setV({}) }}>
              <option value="">— Select —</option>
              {groups.map((g) => <optgroup key={g} label={g}>{enabledTypes.filter((x) => x.group === g).map((x) => <option key={x.key} value={x.key}>{x.icon} {x.label}</option>)}</optgroup>)}
            </select></div>
        </div>
      </Card>
      {t && (
        <Card title={`${t.icon} ${t.label}`}>
          {t.docHint && <p className="banner small">{t.docHint}</p>}
          <div className="grid-form">
            {t.fields.map(fieldEl)}
            {reason?.relationship && (
              <div className="field"><label htmlFor="rq-rel">Family member <span className="req">*</span></label>
                <select id="rq-rel" value={String(v.relationship || '')} onChange={(e) => set('relationship', e.target.value)}><option value="">— Select —</option>{IMMEDIATE_FAMILY.map((x) => <option key={x}>{x}</option>)}</select></div>
            )}
            {reason?.detailed && <div className="field full"><label htmlFor="rq-det">Explain the emergency <span className="req">*</span></label><textarea id="rq-det" rows={3} value={String(v.reasonDetail || '')} onChange={(e) => set('reasonDetail', e.target.value)} /><small className="hint">{String(v.reasonDetail || '').length}/40 characters minimum</small></div>}
            {type !== 'emergency_leave' && <div className="field"><label htmlFor="rq-p">Priority</label><select id="rq-p" value={priority} onChange={(e) => setPriority(e.target.value)}>{['low', 'normal', 'high', 'urgent'].map((p) => <option key={p}>{p}</option>)}</select></div>}
          </div>
          {reason && <p className="banner small mt-s">📎 <strong>Proof needed:</strong> {reason.proof}. You can submit now and upload the proof within <strong>{reason.proofDays} days</strong> (it is marked “proof pending” until then).</p>}
          {type === 'emergency_leave' && (
            <div className="field full mt-s"><label>Flight ticket <span className="req">*</span></label>
              <div className="row gap-s wrap"><FilePick name="ticket" onFiles={([f]) => setTicket(f)} />{ticket && <span className="small">📎 {ticket.name} <button type="button" className="link" onClick={() => setTicket(null)}>remove</button></span>}</div>
              <small className="hint">The worker or you book the ticket for emergency leave. HR decides whether it is reimbursed or taken from the ticket entitlement.</small></div>
          )}
          <div className="field full mt-s"><label>{type === 'emergency_leave' ? 'Proof documents (optional now)' : 'Attachments (optional)'}</label>
            <div className="row gap-s wrap"><FilePick name="attachments" multiple onFiles={(f) => setFiles((p) => [...p, ...f])} />{files.map((f, i) => <span key={i} className="small">📎 {f.name} <button type="button" className="link" onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}>remove</button></span>)}</div></div>
          {level && <p className="muted small mt-s">Approval path: <strong>{LEVEL_PATH[level]}</strong>{level === 'super_admin' && amount && t.amountKey ? ' (amount above HR Admin limit)' : ''}. HR Manager then applies it to the worker record.</p>}
          {msg && <p className="err" role="alert">{msg}</p>}
          <div className="row gap-s mt-s"><Btn kind="primary" icon="check" disabled={!!busy} onClick={submit}>{busy || 'Submit request'}</Btn></div>
        </Card>
      )}
    </div>
  )
}

/* ======================= detail ======================= */
export function RequestDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const { session, role, canWrite, isHr, can, route, isSuper, isGm } = useAuth()
  const { req: r, events, loading, error } = useRequest(id)
  const reqTasks = useHrTasks(isHr && !!id, id)
  const [detailSp] = useSearchParams()
  const [ceoOpen, setCeoOpen] = useState(() => detailSp.get('overrule') === '1') // push action "Overrule"
  const { docs } = useDocs({ requestId: id })
  const workers = useWorkers()
  const outlets = useOutlets()
  const s = useSettings()
  const cfg = useConfig()
  const [act, setAct] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [up, setUp] = useState<{ category: string; title: string } | null>(null)
  const [applyOpen, setApplyOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const uidMe = session?.user.id || ''
  const w = workers.find((x) => x.id === r?.worker_id)
  const t = r ? REQUEST_TYPE[r.type] : undefined
  const actions = useMemo(() => (r ? availableActions(r, role || '', uidMe, { can, route }).filter((a) => a !== 'apply' || canWrite) : []), [r, role, uidMe, canWrite, can, route])
  if (loading) return <div className="page"><p className="muted">Loading…</p></div>
  if (!r) return <div className="page"><Empty title="Request not found">{error && <p className="muted">{error}</p>}<Btn onClick={() => nav('/requests')}>Back</Btn></Empty></div>

  const assignable = (isSuper || isGm) && canAssign(r, role || '', uidMe)
  const tickets = docs.filter((d) => d.category === 'Flight ticket')
  const proofs = docs.filter((d) => d.category === EMERGENCY_PROOF_CATEGORY)
  const others = docs.filter((d) => !tickets.includes(d) && !proofs.includes(d))
  const mine = r.created_by === uidMe
  const reason = cfg.emergency_reasons.find((x) => x.key === r.data.reasonKey)
  const pDays = Number(r.data.proofDays) || reason?.proofDays || 14
  const pState = proofState(r, proofs.length, pDays)
  const ticketBooked = tickets.length > 0
  const canUpload = mine || canWrite
  const fields = (t?.fields || []).filter((f) => r.data[f.key] !== undefined && r.data[f.key] !== '' && f.type !== 'emergency_reason')
  const show = (f: ReqField) => {
    const x = r.data[f.key]
    if (f.type === 'checkbox') return x ? 'Yes' : 'No'
    if (f.type === 'date') return fmtDate(String(x))
    if (f.type === 'outlet') return outletName(outlets, String(x))
    if (f.type === 'number' && /amount|cost|increase/i.test(f.key)) return rm(Number(x))
    return String(x)
  }
  const doAct = async (a: string) => {
    if ((a === 'return' || a === 'reject' || a === 'mgr_reject') && !comment.trim()) return alert('Please write the reason')
    if (a === 'comment' && !comment.trim()) return alert('Write a comment')
    setBusy(true)
    try { await actRequest(r.id, a, comment); setAct(null); setComment('') } catch (e) { err(e) } finally { setBusy(false) }
  }
  const onTicketUploaded = async (d: DocRow) => {
    await noteRequest(r.id, { ticketBooked: true, ticketDocId: d.id }, 'Flight ticket attached')
    // already applied home leave → mark ticket booked on the leave record
    if (w && canWrite) await updateWorker(w.id, (x) => { x.leaves.forEach((l) => { if (l.requestId === r.id) { l.ticketStatus = 'booked'; l.ticketDocId = d.id } }) })
  }
  return (
    <div className="page narrow">
      <div className="page-h"><div className="row gap-s"><Btn kind="ghost" icon="back" onClick={() => nav(-1)} title="Back" /><h1>{t?.icon} {t?.label || r.type}</h1></div></div>
      <Card>
        {r.assigned_to && (
          <p className="callout small mb-s"><strong>Assigned to: {r.assigned_to_name || '—'} ({shortRole(r.assigned_role)})</strong>
            {r.assigned_by_name && <span className="muted"> · by {shortRole(r.assigned_by_role)} ({r.assigned_by_name}){r.assigned_at ? `, ${when(r.assigned_at)}` : ''}</span>}</p>
        )}
        <div className="row gap-s wrap">
          <Chip tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Chip>
          <Chip tone="gray">{refNo(r)}</Chip>
          {r.priority !== 'normal' && <Chip tone={r.priority === 'urgent' || r.priority === 'high' ? 'red' : 'gray'}>{r.priority}</Chip>}
          <Chip tone="blue">Final approval: {ROLE_LABEL[r.required_level]}</Chip>
          <Chip tone={r.source === 'worker' ? 'teal' : 'gray'}>{r.source === 'worker' ? '📱 Raised by worker (app)' : 'Raised by staff'}</Chip>
          {r.manager_overdue && <Chip tone="orange">Outlet manager did not answer in time</Chip>}
          {r.confidential && <Chip tone="purple">🔒 Confidential — hidden from outlet managers</Chip>}
        </div>
        {r.status === 'manager_review' && r.manager_due_at && <p className="callout small mt-s">Waiting for the outlet manager. Goes to HR automatically on {new Date(r.manager_due_at).toLocaleString()}.</p>}
        <KV items={[
          ['Worker', w ? <Link to={`/workers/${w.id}`}>{w.fullName} · {w.workerNo}</Link> : '—'],
          ['Outlet', outletName(outlets, r.outlet_id || undefined)],
          ['Requested by', `${r.created_by_name || '—'} · ${new Date(r.created_at).toLocaleString()}`],
          ...(r.amount ? [['Amount', rm(r.amount)] as [string, string]] : []),
          ...(r.type === 'emergency_leave' ? [['Emergency', String(r.data.reasonLabel || r.data.reasonKey)] as [string, string], ...(r.data.relationship ? [['Family member', String(r.data.relationship)] as [string, string]] : []), ...(r.data.reasonDetail ? [['Details', String(r.data.reasonDetail)] as [string, string]] : [])] : []),
          ...fields.map((f) => [f.label, show(f)] as [string, string]),
          ...(r.manager_decided_by_name ? [['Outlet manager', `${r.manager_decided_by_name}${r.manager_decided_at ? ' · ' + new Date(r.manager_decided_at).toLocaleString() : ''}`] as [string, string]] : []),
          ...(r.decided_by_name ? [['Decision', decidedLine(r)] as [string, string]] : []),
          ...(r.applied_by_name ? [['Applied by', `${r.applied_by_name}${r.result?.summary ? ' — ' + r.result.summary : ''}`] as [string, string]] : []),
          ...(r.result?.ticketDecision ? [['Ticket decision', String(r.result.ticketDecision).replace('_', ' ')] as [string, string]] : []),
        ]} />
        {r.ceo_locked && !isSuper && <p className="callout small mt-s">🔒 Updated by CEO{r.ceo_updated_at ? ` · ${new Date(r.ceo_updated_at).toLocaleString()}` : ''}. This is the CEO's final decision.</p>}
        {r.ceo_locked && isSuper && <p className="callout small mt-s">🔒 Your decision is final and locks this request for everyone else.</p>}
      </Card>

      {isSuper && (
        <Card title="CEO" className="card-ceo">
          <p className="muted small">Overrule (final, locks the request), amend with a change note, recall to you or mark reviewed. To send it to someone, use <strong>Assign…</strong> under Actions.</p>
          <Btn kind="primary" onClick={() => setCeoOpen(true)}>Overrule / amend / recall / review…</Btn>
        </Card>
      )}
      {isHr && reqTasks.length > 0 && <HrTasksCard tasks={reqTasks} />}

      {(r.type === 'home_leave' || r.type === 'emergency_leave' || ticketBooked) && (
        <Card title="✈️ Flight ticket" className={ticketBooked ? 'card-ok' : ''}>
          {ticketBooked ? (
            <>
              <p><strong>Ticket booked — download</strong></p>
              <ul className="rows">{tickets.map((d) => <DocRowItem key={d.id} d={d} />)}</ul>
            </>
          ) : r.type === 'home_leave' ? (
            <p className="muted">{r.data.ticketNeeded ? (r.status === 'approved' || r.status === 'completed' ? 'Approved — HR to book the ticket and attach it here.' : 'HR books the ticket after approval.') : 'No company ticket requested.'}</p>
          ) : <p className="warn">Ticket missing — emergency leave cannot be approved without the flight ticket.</p>}
          {((r.type === 'home_leave' && isHr && canWrite) || (r.type === 'emergency_leave' && canUpload)) && w && (
            <Btn small icon="upload" onClick={() => setUp({ category: 'Flight ticket', title: `Flight ticket ${refNo(r)}` })}>{ticketBooked ? 'Attach updated ticket' : 'Attach ticket'}</Btn>
          )}
        </Card>
      )}

      {r.type === 'emergency_leave' && (
        <Card title="📎 Proof">
          <p>Status: <Chip tone={pState === 'received' ? 'green' : pState === 'waived' ? 'gray' : pState === 'overdue' ? 'red' : 'orange'}>{pState === 'pending' ? `proof pending (due ${fmtDate(proofDue(r, pDays))})` : pState === 'overdue' ? `proof overdue (was due ${fmtDate(proofDue(r, pDays))})` : pState}</Chip></p>
          {(reason || !!r.data.proofExpected) && <p className="muted small">Expected: {String(r.data.proofExpected || reason?.proof)}</p>}
          {proofs.length > 0 && <ul className="rows">{proofs.map((d) => <DocRowItem key={d.id} d={d} />)}</ul>}
          <div className="row gap-s wrap">
            {canUpload && w && <Btn small icon="upload" onClick={() => setUp({ category: EMERGENCY_PROOF_CATEGORY, title: `Proof ${refNo(r)}` })}>Upload proof</Btn>}
            {isHr && pState !== 'received' && <Btn small kind="ghost" onClick={() => noteRequest(r.id, { proofReceived: true }, 'HR marked proof as received').catch(err)}>Mark received</Btn>}
            {isHr && pState !== 'waived' && pState !== 'received' && <Btn small kind="ghost" onClick={() => { const why = prompt('Why is proof waived?'); if (why) noteRequest(r.id, { proofWaived: true }, `Proof waived: ${why}`).catch(err) }}>Waive</Btn>}
          </div>
        </Card>
      )}

      <Card title={`Attachments (${others.length})`} actions={canUpload && w && <Btn small icon="plus" onClick={() => setUp({ category: t?.mcCategory || 'Other', title: `${t?.label || ''} ${refNo(r)}` })}>Add</Btn>}>
        {others.length === 0 ? <p className="muted small">None</p> : <ul className="rows">{others.map((d) => <DocRowItem key={d.id} d={d} />)}</ul>}
      </Card>

      {(actions.length > 0 || assignable) && (
        <Card title="Actions">
          {r.assigned_to && r.assigned_to !== uidMe && !isSuper && <p className="muted small">Assigned to {r.assigned_to_name} ({shortRole(r.assigned_role)}) — they make the decision at this step.</p>}
          <div className="row gap-s wrap">
            {assignable && <Btn kind="secondary" icon="users" onClick={() => setAssignOpen(true)}>Assign…</Btn>}
            {actions.filter((a) => a !== 'comment').map((a) => (
              <Btn key={a} kind={a === 'approve' || a === 'apply' || a === 'forward' || a === 'mgr_approve' ? 'primary' : a === 'reject' || a === 'mgr_reject' ? 'danger' : 'secondary'} disabled={busy}
                onClick={() => (a === 'apply' ? setApplyOpen(true) : a === 'resubmit' ? doAct('resubmit') : setAct(a))}>{ACTION_LABEL[a]}</Btn>
            ))}
            <Btn kind="ghost" onClick={() => setAct('comment')}>💬 Comment</Btn>
          </div>
          {r.type === 'emergency_leave' && actions.includes('approve') && !ticketBooked && <p className="warn small">Attach the flight ticket before approving.</p>}
          {act && (
            <div className="mt-s">
              <label className="small" htmlFor="rq-c">{act === 'return' || act === 'reject' || act === 'mgr_reject' ? 'Reason (required — the worker sees it)' : 'Comment'}</label>
              <textarea id="rq-c" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
              <div className="row gap-s mt-s"><Btn kind="primary" disabled={busy} onClick={() => doAct(act)}>{ACTION_LABEL[act]}</Btn><Btn kind="ghost" onClick={() => setAct(null)}>Cancel</Btn></div>
            </div>
          )}
        </Card>
      )}

      <Card title="Timeline">
        <ol className="timeline">
          {events.map((e) => (
            <li key={e.id}>
              <span className="tl-dot" />
              <div>
                {eventLine(e) ? <strong>{eventLine(e)}</strong> : <><strong>{e.action === 'ceo_overrule' || e.action === 'ceo_recall' ? `${ACTION_LABEL[e.action]} ${e.by_name}: ${STATUS_LABEL[e.from_status as keyof typeof STATUS_LABEL] || e.from_status} → ${STATUS_LABEL[e.to_status as keyof typeof STATUS_LABEL] || e.to_status}` : ACTION_LABEL[e.action] || (e.action === 'submit' ? 'Submitted' : e.action === 'update' ? 'Updated' : e.action)}</strong>
                {e.to_status && e.action !== 'submit' && !e.action.startsWith('ceo_') && <> → <Chip tone={STATUS_TONE[e.to_status as keyof typeof STATUS_TONE] || 'gray'}>{STATUS_LABEL[e.to_status as keyof typeof STATUS_LABEL] || e.to_status}</Chip></>}
                <small className="muted"> · {e.by_name} ({ROLE_LABEL[e.by_role || ''] || e.by_role}) · {new Date(e.at).toLocaleString()}</small></>}
                {e.comment && e.action !== 'skipped' && <p className="tl-c">{e.comment}</p>}
                <AmendDiff e={e} />
              </div>
            </li>
          ))}
        </ol>
      </Card>

      {up && w && <UploadDoc workerId={w.id} requestId={r.id} category={up.category} lockCategory={up.category !== 'Other'} title={up.title} onClose={() => setUp(null)}
        onDone={async (d) => { try { if (d.category === 'Flight ticket') await onTicketUploaded(d); if (d.category === EMERGENCY_PROOF_CATEGORY) await noteRequest(r.id, { proofReceived: true }, 'Proof uploaded') } catch (e) { err(e) } }} />}
      {ceoOpen && isSuper && <OverruleDialog r={r} workerName={w?.fullName} onClose={() => setCeoOpen(false)} />}
      {assignOpen && <AssignModal r={r} onClose={() => setAssignOpen(false)} />}
      {applyOpen && <ApplyModal r={r} ticketDocId={tickets[0]?.id} company={s.companyName} onClose={() => setApplyOpen(false)} />}
    </div>
  )
}

/** CEO / GM: assign or escalate the request to a specific person at any level (server: request_assign). */
function AssignModal({ r, onClose }: { r: RequestRow; onClose: () => void }) {
  const [list, setList] = useState<Assignee[] | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [roleSel, setRoleSel] = useState('')
  const [userSel, setUserSel] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { listAssignees(r.id).then(setList).catch((e) => setLoadErr((e as Error).message)) }, [r.id])
  const roles = useMemo(() => Array.from(new Map((list || []).map((a) => [a.role, a.roleLabel])).entries()), [list])
  const people = (list || []).filter((a) => a.role === roleSel)
  const go = async () => {
    if (!userSel) return alert('Choose the person')
    setBusy(true)
    try {
      const x = await assignRequest(r.id, userSel, note)
      const p = people.find((a) => a.id === userSel)
      toast(`${refNo(r)} ${x.status === 'escalated' && (roleSel === 'super_admin' || roleSel === 'general_manager') ? 'escalated' : 'assigned'} to ${p?.name || ''} (${shortRole(roleSel)})`)
      onClose()
    } catch (e) { err(e) } finally { setBusy(false) }
  }
  return (
    <Modal title={`Assign ${refNo(r)}`} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" icon="check" disabled={busy || !userSel} onClick={go}>{busy ? 'Assigning…' : 'Assign'}</Btn></>}>
      <p className="muted small">Send this request to any level and person. Steps in between are marked as skipped; the person is notified and it moves to their queue{r.confidential ? '. Confidential: outlet managers are never offered' : ''}.</p>
      {loadErr && <p className="warn">{loadErr}</p>}
      {!list && !loadErr && <p className="muted">Loading people…</p>}
      {list && list.length === 0 && <p className="muted">Nobody else can take this request in its company / outlet.</p>}
      {list && list.length > 0 && (
        <div className="grid-form">
          <div className="field"><label htmlFor="as-r">Role</label>
            <select id="as-r" value={roleSel} onChange={(e) => { setRoleSel(e.target.value); setUserSel('') }}>
              <option value="">Choose…</option>{roles.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select></div>
          <div className="field"><label htmlFor="as-u">Person</label>
            <select id="as-u" value={userSel} disabled={!roleSel} onChange={(e) => setUserSel(e.target.value)}>
              <option value="">Choose…</option>{people.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select></div>
          <div className="field full"><label htmlFor="as-n">Note (optional — staff only, the worker never sees it)</label><textarea id="as-n" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
      )}
    </Modal>
  )
}

function ApplyModal({ r, ticketDocId, company, onClose }: { r: RequestRow; ticketDocId?: string; company: string; onClose: () => void }) {
  const outlets = useOutlets()
  const t = REQUEST_TYPE[r.type]
  const [c, setC] = useState<ApplyChoice>({ ticketDecision: r.data.reimburse ? 'reimburse' : 'worker_pays' })
  const [busy, setBusy] = useState(false)
  const effectText: Record<string, string> = {
    leave: 'Adds the leave to the worker’s leave history' + (r.type === 'home_leave' && r.data.ticketNeeded ? ' and uses one flight-ticket entitlement' : ''),
    increment: 'Adds the salary increment', advance: 'Adds the advance (monthly deduction)', loan: 'Adds the loan (monthly deduction)', deduction: 'Adds the deduction',
    penalty: 'Records the penalty (and fine, if any)', memo: 'Creates the memo with its checklist', transfer: 'Moves the worker to the new outlet', exit: 'Changes status and exit date',
    absconded: 'Sets status to Absconded (remember: notify JIM & cancel permit)', details: 'Updates phone / address', passport: 'Records the passport movement and creates the slip PDF', letter: 'Adds a note', note: 'Adds a note',
  }
  const go = async () => {
    setBusy(true)
    try {
      const summary = await applyRequest(r, c, ticketDocId)
      // passport release / return → slip PDF into the vault
      if (t?.effect === 'passport' && !String(r.data.action).startsWith('Passport copy')) {
        const w = await db.workers.get(r.worker_id || '')
        const m = w?.passportSafe?.moves?.slice(-1)[0]
        if (w && m) {
          const blob = await slipPdf(w, m, outlets, company)
          const d = await uploadDoc({ workerId: w.id, category: 'Passport release slip', title: `${m.kind === 'release' ? 'Release' : 'Return'} slip ${fmtDate(m.date)}`, requestId: r.id, source: 'generated' }, { blob, name: `passport-${m.kind}-${m.date}.pdf`, pages: 1 })
          await updateWorker(w.id, (x) => { const mv = x.passportSafe?.moves?.find((y) => y.id === m.id); if (mv) mv.slipDocId = d.id })
        }
      }
      await actRequest(r.id, 'apply', c.note || summary, { summary, ticketDecision: c.ticketDecision || null })
      onClose()
    } catch (e) { err(e) } finally { setBusy(false) }
  }
  return (
    <Modal title={`Apply ${refNo(r)}`} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" icon="check" disabled={busy} onClick={go}>{busy ? 'Applying…' : 'Apply & close'}</Btn></>}>
      <p>{effectText[t?.effect || 'note']} — then the request is closed.</p>
      {r.type === 'emergency_leave' && (
        <fieldset className="radio-set">
          <legend>Flight ticket ({rm(Number(r.data.ticketCost) || 0)}) — HR decision</legend>
          {([['reimburse', 'Reimburse the worker (company pays)'], ['entitlement', 'Deduct from his flight-ticket entitlement'], ['worker_pays', 'Worker pays (no reimbursement)']] as const).map(([k, l]) => (
            <label key={k} className="check"><input type="radio" name="td" checked={c.ticketDecision === k} onChange={() => setC({ ...c, ticketDecision: k })} /> {l}</label>
          ))}
        </fieldset>
      )}
      <div className="field full mt-s"><label htmlFor="ap-n">Note (optional)</label><textarea id="ap-n" rows={2} value={c.note || ''} onChange={(e) => setC({ ...c, note: e.target.value })} /></div>
      <p className="muted small">Done on {fmtDate(todayISO())}. The change syncs to everyone.</p>
    </Modal>
  )
}
