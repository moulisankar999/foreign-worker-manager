import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Btn, Card, Chip, Empty, Modal, SelectFilter, Tabs, Toolbar } from '../components/ui'
import { toast } from '../components/toast'
import { useAuth } from '../lib/auth'
import { outletName } from '../lib/calc'
import { ceoDecide, requestEffects, REVIEW_REASON, useCeoReviews, type CeoDecision, type CeoReview, type Effect } from '../lib/ceoReview'
import { useOutlets, useWorkers } from '../lib/hooks'
import { refNo, useRequests } from '../lib/requests'
import { REQUEST_TYPE, REQUEST_TYPES, ROLE_LABEL, STATUS_LABEL, STATUS_TONE, type RequestRow } from '../lib/workflow'
import { rm } from '../lib/util'
import { DataTable, Details } from '../components/dataTable'
import { Actions, IconAction } from '../components/iconAction'

/** number of decisions waiting for the CEO's review (badge) */
export function useCeoBadge() {
  const { isSuper } = useAuth()
  const rows = useCeoReviews(isSuper)
  return isSuper ? rows.filter((r) => !r.reviewed_at).length : 0
}

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')
export function decidedLine(r: Pick<RequestRow, 'status' | 'decided_by_name' | 'decided_by_role' | 'decided_at'>) {
  if (!r.decided_by_name) return ''
  const verb = r.status === 'rejected' ? 'Rejected' : r.status === 'cancelled' ? 'Cancelled' : 'Approved'
  const who = r.decided_by_role === 'super_admin' ? 'CEO' : r.decided_by_role ? ROLE_LABEL[r.decided_by_role] || r.decided_by_role : ''
  return `${verb} by ${who ? who + ' ' : ''}${r.decided_by_name}${r.decided_at ? ' · ' + when(r.decided_at) : ''}`
}

type View = 'todo' | 'done' | 'any'
export default function CeoReviewPage() {
  const { isSuper } = useAuth()
  const nav = useNavigate()
  const reviews = useCeoReviews(isSuper)
  const { rows } = useRequests()
  const workers = useWorkers()
  const outlets = useOutlets()
  const [view, setView] = useState<View>('todo')
  const [by, setBy] = useState('')
  const [type, setType] = useState('')
  const [outlet, setOutlet] = useState('')
  const [period, setPeriod] = useState('30')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<{ r: RequestRow; d?: CeoDecision } | null>(null)
  if (!isSuper) return <div className="page"><Empty icon="lock" title="CEO only">This page is only for the CEO.</Empty><Btn onClick={() => nav('/')}>Home</Btn></div>

  const byId = new Map(rows.map((r) => [r.id, r]))
  const wName = (id: string | null) => workers.find((w) => w.id === id)?.fullName || '—'
  const since = period ? Date.now() - Number(period) * 864e5 : 0
  const keep = (r: RequestRow, rv?: CeoReview) => (!type || r.type === type) && (!outlet || r.outlet_id === outlet)
    && (!by || (by === 'gm' ? (rv?.decided_by_role || r.decided_by_role) === 'general_manager' : (rv?.decided_by_role || r.decided_by_role) !== 'general_manager'))
    && (!since || new Date(rv?.decided_at || r.updated_at).getTime() >= since)
    && (!q || `${refNo(r)} ${wName(r.worker_id)} ${r.title} ${r.decided_by_name || ''}`.toLowerCase().includes(q.toLowerCase()))
  const todo = reviews.filter((v) => !v.reviewed_at)
  const list: { r: RequestRow; rv?: CeoReview }[] = view === 'any'
    ? rows.filter((r) => keep(r, reviews.find((v) => v.request_id === r.id))).map((r) => ({ r, rv: reviews.find((v) => v.request_id === r.id) }))
    : (view === 'todo' ? todo : reviews.filter((v) => v.reviewed_at)).map((rv) => ({ r: byId.get(rv.request_id)!, rv })).filter((x) => x.r && keep(x.r, x.rv))

  return (
    <div className="page">
      <div className="page-h">
        <div><h1>CEO review <Chip tone="purple">CEO only</Chip></h1>
          <p className="muted">Decisions by the General Manager and rejections, for your review. Your decision is final and locks the request. Nobody else sees this page.</p></div>
      </div>
      <Tabs tabs={[{ id: 'todo' as View, label: 'To review', badge: todo.length }, { id: 'done' as View, label: 'Reviewed' }, { id: 'any' as View, label: 'Any request (recall)' }]} value={view} onChange={setView} />
      <Toolbar>
        <label className="sel-f"><span>Search</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="REQ no., worker, name" /></label>
        <SelectFilter label="Decided by" value={by} onChange={setBy} options={[{ value: '', label: 'Anyone' }, { value: 'gm', label: 'General Manager' }, { value: 'other', label: 'Others' }]} />
        <SelectFilter label="Type" value={type} onChange={setType} options={[{ value: '', label: 'All types' }, ...REQUEST_TYPES.map((t) => ({ value: t.key, label: `${t.icon} ${t.label}` }))]} />
        {outlets.length > 1 && <SelectFilter label="Outlet" value={outlet} onChange={setOutlet} options={[{ value: '', label: 'All outlets' }, ...outlets.map((o) => ({ value: o.id, label: o.name }))]} />}
        <SelectFilter label="Period" value={period} onChange={setPeriod} options={[{ value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }, { value: '', label: 'All time' }]} />
      </Toolbar>
      <Card>
        {list.length === 0 ? <Empty icon="check" title={view === 'todo' ? 'Nothing to review 🎉' : 'Nothing here'} /> : (
          <DataTable label="Decisions for CEO review" className="ceo-t" rows={list} rowKey={({ r }) => r.id} rowTestId={() => 'ceo-row'} initialSort={{ key: 'at', dir: 'desc' }}
            columns={[
              { key: 'req', label: 'Request', main: true, sort: ({ r }) => REQUEST_TYPE[r.type]?.label || r.type, render: ({ r }) => <span className="dt-person"><span className="req-ic" aria-hidden>{REQUEST_TYPE[r.type]?.icon || '📝'}</span><span><Link className="dt-link" to={`/requests/${r.id}`}>{REQUEST_TYPE[r.type]?.label || r.type}{r.amount ? ` · ${rm(r.amount)}` : ''}</Link><small>{refNo(r)}</small></span></span> },
              { key: 'w', label: 'Worker', sort: ({ r }) => wName(r.worker_id), render: ({ r }) => wName(r.worker_id) },
              { key: 'why', label: 'Why', hide: 'tablet', render: ({ rv }) => <span className="small">{rv ? (REVIEW_REASON[rv.reason] || rv.reason) : '—'}</span> },
              { key: 'by', label: 'Decided by', hide: 'tablet', sort: ({ r, rv }) => r.decided_by_name || rv?.decided_by_name || '', render: ({ r, rv }) => <span className="small">{r.decided_by_name || rv?.decided_by_name || '—'}</span> },
              { key: 'st', label: 'Status', hide: 'phone', sort: ({ r }) => STATUS_LABEL[r.status], render: ({ r }) => <span className="row gap-s wrap"><Chip tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Chip>{r.ceo_locked && <Chip tone="purple">🔒 CEO final</Chip>}</span> },
              { key: 'at', label: 'When', hide: 'tablet', sort: ({ r, rv }) => rv?.decided_at || r.decided_at || r.updated_at, render: ({ r, rv }) => <span className="small">{when(rv?.decided_at || r.decided_at || r.updated_at)}</span> },
            ]}
            actions={({ r, rv }) => (
              <Actions>
                {view !== 'any' && !rv?.reviewed_at && <IconAction kind="approve" label="Mark reviewed — keep the decision" onClick={() => setOpen({ r, d: 'reviewed' })} />}
                <IconAction kind="edit" tone="pri" label="Overrule — approve, amend, reject or cancel" onClick={() => setOpen({ r })} />
                {!(r.status === 'escalated' && r.ceo_locked) && <IconAction kind="recall" label="Recall to me" onClick={() => setOpen({ r, d: 'recall' })} />}
              </Actions>
            )}
            expand={({ r, rv }) => (
              <>
                <Details items={[['Worker', wName(r.worker_id)], ['Outlet', outletName(outlets, r.outlet_id || undefined)], ['Why it is here', rv ? (REVIEW_REASON[rv.reason] || rv.reason) : null],
                  ['Decision', decidedLine(r) || rv?.decided_by_name], ['Your review', rv?.reviewed_at ? `${rv.outcome === 'kept' ? 'Kept the decision' : rv.outcome} · ${when(rv.reviewed_at)}` : null]]} />
                <div className="mt-s"><Btn small icon="eye" onClick={() => nav(`/requests/${r.id}`)}>Open request</Btn></div>
              </>
            )} />
        )}
      </Card>
      {open && <OverruleDialog r={open.r} initial={open.d} workerName={wName(open.r.worker_id)} onClose={() => setOpen(null)} />}
    </div>
  )
}

const CHOICES: { d: CeoDecision; label: string; help: string }[] = [
  { d: 'approve', label: 'Approve', help: 'Final approval. HR then applies it.' },
  { d: 'amend', label: 'Amend', help: 'Change amount / dates / details with a change note (the original stays in the history). Approve it now, or tick “keep it moving”.' },
  { d: 'reject', label: 'Reject', help: 'Final rejection.' },
  { d: 'cancel', label: 'Cancel', help: 'Stop the request (no decision on the merits).' },
  { d: 'recall', label: 'Recall to me', help: 'Take it back for your own decision (status: waiting for decision).' },
  { d: 'reviewed', label: 'Keep — mark reviewed', help: 'Leave the decision as it is.' },
]

/** CEO overrule dialog: used on the CEO review page and on the request page */
export function OverruleDialog({ r, initial, workerName, onClose }: { r: RequestRow; initial?: CeoDecision; workerName?: string; onClose: () => void }) {
  const [d, setD] = useState<CeoDecision>(initial || (r.status === 'rejected' ? 'approve' : 'reject'))
  const [reason, setReason] = useState('')
  const [fx, setFx] = useState<Effect[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const t = REQUEST_TYPE[r.type]
  const editable = (t?.fields || []).filter((f) => !f.type || ['text', 'textarea', 'date', 'number', 'select'].includes(f.type))
  const [patch, setPatch] = useState<Record<string, string>>(() => Object.fromEntries(editable.map((f) => [f.key, r.data[f.key] === undefined ? '' : String(r.data[f.key])])))
  const [amount, setAmount] = useState(r.amount === null || r.amount === undefined ? '' : String(r.amount))
  const canKeep = ['manager_review', 'submitted', 'returned', 'recommended', 'escalated', 'approved'].includes(r.status)
  const [keep, setKeep] = useState(canKeep && r.status !== 'approved')
  useEffect(() => { requestEffects(r.id).then(setFx).catch(() => setFx([])) }, [r.id])
  const choices = CHOICES.filter((c) => !(c.d === 'approve' && (r.status === 'approved' || r.status === 'completed')) && !(c.d === 'reject' && r.status === 'rejected') && !(c.d === 'cancel' && r.status === 'cancelled'))
  const willUndo = d === 'reject' || d === 'cancel' || d === 'amend'
  const go = async () => {
    setError('')
    if (d !== 'reviewed' && !reason.trim()) return setError(d === 'amend' ? 'Write a change note — it goes in the history (the original details are kept).' : 'Write a short reason — it goes in the history and to the people involved.')
    let p: Record<string, unknown> | undefined
    if (d === 'amend') {
      const data: Record<string, unknown> = {}
      for (const f of editable) if (patch[f.key] !== (r.data[f.key] === undefined ? '' : String(r.data[f.key]))) data[f.key] = f.type === 'number' ? Number(patch[f.key]) : patch[f.key]
      p = { data }
      if (amount !== (r.amount === null || r.amount === undefined ? '' : String(r.amount))) p.amount = amount
      if (!Object.keys(data).length && !('amount' in p)) return setError('Change at least one detail, or choose Approve.')
      if (keep && canKeep) p.keepStatus = true
    }
    setBusy(true)
    try {
      await ceoDecide(r.id, d, reason, p)
      toast(d === 'reviewed' ? `Marked reviewed ✓ — ${refNo(r)}` : d === 'amend' && keep && canKeep ? `Amended ✓ — ${refNo(r)} keeps moving` : `Done ✓ — ${refNo(r)} is now final (locked)`)
      onClose()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Modal title={`Overrule ${refNo(r)} — ${t?.label || r.type}`} onClose={onClose} wide footer={<>
      <Btn onClick={onClose}>Cancel</Btn>
      <Btn kind={d === 'reject' || d === 'cancel' ? 'danger' : 'primary'} disabled={busy} onClick={go}>{busy ? 'Saving…' : d === 'reviewed' ? 'Mark reviewed' : d === 'amend' && keep && canKeep ? 'Save changes' : 'Confirm — final decision'}</Btn>
    </>}>
      <p className="small">{workerName ? <strong>{workerName}</strong> : null} · now <Chip tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Chip> {decidedLine(r) && <span className="muted">· {decidedLine(r)}</span>}</p>
      <fieldset className="radio-set">
        <legend>Your decision</legend>
        {choices.map((c) => (
          <label key={c.d} className="check"><input type="radio" name="ceo-d" checked={d === c.d} onChange={() => setD(c.d)} /> <span><strong>{c.label}</strong> <small className="muted">— {c.help}</small></span></label>
        ))}
      </fieldset>
      {d === 'amend' && canKeep && (
        <label className="check mt-s"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> <span><strong>Amend details only — keep it moving</strong> <small className="muted">— the request stays at its current step (not locked); the original details stay in the history</small></span></label>
      )}
      {d === 'amend' && (
        <div className="grid2 mt-s">
          {r.amount !== null && r.amount !== undefined && <div className="field"><label htmlFor="am-amt">Amount (RM)</label><input id="am-amt" type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>}
          {editable.map((f) => (
            <div key={f.key} className={`field${f.type === 'textarea' ? ' full' : ''}`}>
              <label htmlFor={`am-${f.key}`}>{f.label}</label>
              {f.type === 'select' ? <select id={`am-${f.key}`} value={patch[f.key]} onChange={(e) => setPatch({ ...patch, [f.key]: e.target.value })}><option value="">—</option>{(f.options || []).map((o) => <option key={o}>{o}</option>)}</select>
                : f.type === 'textarea' ? <textarea id={`am-${f.key}`} rows={2} value={patch[f.key]} onChange={(e) => setPatch({ ...patch, [f.key]: e.target.value })} />
                  : <input id={`am-${f.key}`} type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'} value={patch[f.key]} onChange={(e) => setPatch({ ...patch, [f.key]: e.target.value })} />}
            </div>
          ))}
        </div>
      )}
      {d !== 'reviewed' && <div className="field full mt-s"><label htmlFor="ceo-why">{d === 'amend' ? 'Change note (required)' : 'Reason (required)'}</label><textarea id="ceo-why" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Amount too high for this month" /></div>}
      {willUndo && fx && fx.length > 0 && (
        <div className="callout warn mt-s" role="alert">
          <strong>⚠ Things already happened for this request:</strong>
          <ul>{fx.filter((e) => !(d === 'amend' && e.kind === 'ticket')).map((e, i) => <li key={i}>{e.effect} → HR follow-up task: <em>{d === 'amend' ? 'Adjust to the CEO’s changes: ' : ''}{e.task}</em></li>)}</ul>
          <p className="small">Nothing is reversed automatically (money is never taken back by the app). HR Managers / HR Admins get these tasks.</p>
        </div>
      )}
      {d !== 'reviewed' && !(d === 'amend' && keep && canKeep) && <p className="muted small mt-s">History will show “Overruled by CEO: {STATUS_LABEL[r.status]} → {STATUS_LABEL[d === 'recall' ? 'escalated' : d === 'reject' ? 'rejected' : d === 'cancel' ? 'cancelled' : 'approved']}”. The request is then locked: only you can change it. The people involved are notified; the General Manager sees a neutral “Updated by CEO” note.</p>}
      {error && <p className="warn small" role="alert">{error}</p>}
    </Modal>
  )
}
