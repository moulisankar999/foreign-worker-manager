/* One recruit, from selection to arrival: the country checklist (with the quota gate), calling visa, flight,
 * airport authorisation letter, payments, history, and "Convert to worker" once he is here. */
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Btn, Card, Chip, Empty, KV } from '../../components/ui'
import { IconAction } from '../../components/iconAction'
import { toast } from '../../components/toast'
import { Preview } from '../../reports/Preview'
import type { Block } from '../../reports/types'
import { useWorkers } from '../../lib/hooks'
import { db, saveWorker } from '../../lib/db'
import { syncNow } from '../../lib/sync'
import type { DocRec, Worker } from '../../lib/types'
import type { CostRec } from '../../lib/trackers'
import { addMonths, fmtDate, todayISO, uid } from '../../lib/util'
import { atMyt, PAY_CATS, payLabel, progress, qcall, rmFmt, stageLabel, stepsFor, UR_STATUS, useQuota, type CStep, type Recruit } from '../../lib/quota'
import { NoteAsk, QForm, s, useQCtx, useSheetMeta } from './shared'
import { recruitStage, RecruitForm } from './Pipeline'
import { PaymentForm } from './Costs'
import './quota.css'

export default function RecruitPage({ id }: { id: string }) {
  const ctx = useQCtx()
  const d = useQuota()
  const nav = useNavigate()
  const r = d.recruits.find((x) => x.id === id)
  const [step, setStep] = useState<CStep | null>(null)
  const [edit, setEdit] = useState<'details' | 'travel' | 'link' | 'pay' | 'drop' | 'letter' | 'convert' | null>(null)
  if (!d.loaded) return <div className="page"><p className="muted">Loading…</p></div>
  if (!r) return <div className="page"><Empty title="Recruit not found"><Link to="/quota?tab=pipeline">Back to the pipeline</Link></Empty></div>
  const steps = stepsFor(r.country, r.ecr, d.rules.templates)
  const ur = d.requests.find((u) => u.id === r.use_request_id)
  const batch = d.batches.find((b) => b.id === r.batch_id)
  const pays = d.payments.filter((p) => p.recruit_id === r.id)
  const evs = d.events.filter((e) => e.recruit_id === r.id).sort((a, b) => b.id - a.id)
  const p = progress(r, d.rules.templates)
  const active = r.status === 'active'
  const hostel = ctx.cfg.hostels.items.find((h) => h.id === r.hostel_id)
  const isDone = (st: CStep) => (st.key === 'quota_use' ? ur?.status === 'approved' : !!r.steps?.[st.key]?.done)
  const stageOf = (stepsNow: Recruit['steps']) => stepsFor(r.country, r.ecr, d.rules.templates).find((x) => !(x.key === 'quota_use' ? ur?.status === 'approved' : stepsNow?.[x.key]?.done))?.stage || 'ready'

  const save = (patch: Record<string, unknown>) => qcall('qr_save_recruit', { p: { id: r.id, ...patch } })
  const tick = async (st: CStep, v: { date?: string; ref?: string; note?: string; done: boolean }, extra: Record<string, unknown> = {}) => {
    const val = v.done ? { done: true, date: v.date || todayISO(), ref: v.ref || undefined, note: v.note || undefined } : { done: false }
    const next = { ...r.steps, [st.key]: val }
    await save({ steps: { [st.key]: val }, stage: stageOf(next), ...extra })
  }

  return (
    <div className="page">
      <header className="page-h">
        <IconAction kind="close" label="Back to the pipeline" onClick={() => nav('/quota?tab=pipeline')} />
        <div><h1>{r.full_name}</h1><small className="muted">{r.country}{r.ecr ? ` · ${r.ecr}` : ''} · {ctx.cName(r.company_id)}{batch && <> · <Link to="/quota?tab=pipeline">{batch.title}</Link></>}</small></div>
        <span className="spacer" />
        <Chip tone={r.status === 'active' ? 'blue' : r.status === 'converted' ? 'green' : 'gray'}>{r.status === 'active' ? stageLabel(recruitStage(r, d.rules.templates)) : r.status === 'converted' ? 'Converted to worker' : 'Dropped'}</Chip>
      </header>

      <div className="qr-grid two">
        <Card title={<>Checklist <Chip tone="gray">{p.done} / {p.total}</Chip></>}>
          <div className="qr-bar big"><i style={{ width: `${p.pct}%` }} /></div>
          {r.country === 'India' && <div className="note-box">{r.ecr === 'ECR' ? 'ECR passport: emigration clearance in eMigrate is compulsory before he can fly — the attestation, eMigrate and POE steps are included.' : r.ecr === 'ECNR' ? 'ECNR passport: no emigration clearance needed; the eMigrate / POE steps are left out.' : 'Set ECR or ECNR in the details to get the right India steps.'}</div>}
          <ol className="qr-steps">{steps.map((st) => {
            const done = isDone(st); const v = r.steps?.[st.key]
            const blocked = st.key === 'vdr_apply' && ur?.status !== 'approved'
            return <li key={st.key} className={`${done ? 'done' : ''} ${st.gate ? 'gate' : ''}`}>
              <button type="button" className="qr-tick" aria-label={done ? `Undo: ${st.label}` : `Mark done: ${st.label}`} disabled={!active || st.key === 'quota_use' || (done && st.key === 'vdr_apply') || (!done && blocked)}
                title={st.key === 'quota_use' ? 'Done automatically when the CEO approves the Quota Use Request' : blocked ? 'Locked until the CEO approves the Quota Use Request' : undefined}
                onClick={() => (done ? tick(st, { done: false }).catch((e) => toast(e.message, 'err')) : setStep(st))}>{done ? '✓' : ''}</button>
              <div><span>{st.label}</span>{st.gate && <> <Chip tone={done ? 'green' : 'red'}>{st.key === 'quota_use' ? (ur ? `Q-${ur.ref_no} ${UR_STATUS[ur.status].label}` : 'No request linked') : 'Uses 1 quota slot'}</Chip></>}
                {v?.done && <small className="muted"> · {fmtDate(v.date)}{v.ref ? ` · ${v.ref}` : ''}{v.note ? ` · ${v.note}` : ''}</small>}
                {st.hint && !done && <small className="hint">{st.hint}</small>}</div>
            </li>
          })}</ol>
        </Card>

        <div className="qr-grid">
          <Card title="Quota" actions={active && !r.vdr_applied ? <IconAction kind="assign" label={ur ? 'Link to another request' : 'Link to a Quota Use Request'} onClick={() => setEdit('link')} /> : undefined}>
            {ur ? <KV items={[['Request', <Link key="l" to={`/quota?tab=approvals&open=${ur.id}`}>Q-{ur.ref_no}</Link>], ['Status', <Chip key="s" tone={UR_STATUS[ur.status].tone}>{UR_STATUS[ur.status].label}</Chip>],
              ['Letter', d.quotas.find((q) => q.id === ur.quota_id)?.ref_no || '—'], ['Slots', `${ur.slots} × ${ur.country}`]]} />
              : <p className="muted">Not linked yet. Raise a Quota Use Request in <Link to="/quota?tab=approvals">Approvals</Link> and link him to it; the calling visa stays locked until the CEO approves.</p>}
          </Card>
          <Card title="Details" actions={active ? <IconAction kind="edit" label="Edit details" onClick={() => setEdit('details')} /> : undefined}>
            <KV items={[['Passport', [r.passport_no, r.passport_expiry && `exp ${fmtDate(r.passport_expiry)}`].filter(Boolean).join(' · ') || '—'], ['Date of birth', fmtDate(r.dob || '') || '—'], ['Gender', r.gender || '—'], ['Job', r.job || '—'], ['Phone', r.phone || '—']]} />
          </Card>
          <Card title="Calling visa, flight & arrival" actions={active ? <><IconAction kind="edit" label="Edit visa / flight / arrival" onClick={() => setEdit('travel')} /><IconAction kind="print" label="Airport authorisation letter (A4)" onClick={() => setEdit('letter')} /></> : undefined}>
            <KV items={[['VDR no.', r.vdr_no || '—'], ['VDR applied', fmtDate(r.vdr_applied || '') || '—'], ['VDR approved', fmtDate(r.vdr_approved || '') || '—'], ['VDR valid until', fmtDate(r.vdr_expiry || '') || '—'],
              ['Flight', r.flight_at ? `${r.flight_no || ''} · ${atMyt(r.flight_at)}` : '—'], ['Airport', r.airport || '—'], ['Pickup by', r.pickup_by || '—'], ['Transport', r.transport || '—'],
              ['Hostel', hostel ? `${hostel.name}${hostel.capacity ? ` (capacity ${hostel.capacity})` : ''}` : '—'], ['Arrived', r.arrived_at ? atMyt(r.arrived_at) : '—'],
              ['FOMEMA due', r.arrived_at ? fmtDate(addDays30(r.arrived_at)) : '—']]} />
          </Card>
          <Card title={<>Payments <Chip tone="gray">{rmFmt(pays.filter((x) => x.status !== 'void').reduce((a, x) => a + Number(x.amount_rm), 0))}</Chip></>} actions={<IconAction kind="add" label="Record a payment for him" onClick={() => setEdit('pay')} />}>
            {pays.length ? <ul className="alist">{pays.map((x) => <li key={x.id} className={x.status === 'void' ? 'strike' : ''}>{fmtDate(x.paid_on)} · {payLabel(x.category)} · <b>{rmFmt(x.amount_rm)}</b> {x.status === 'pending_check' && <Chip tone="amber">To check</Chip>}</li>)}</ul> : <p className="muted">No payments yet.</p>}
          </Card>
          <Card title="History">
            {evs.length ? <ol className="qr-tl">{evs.map((e) => <li key={e.id}><b>{e.action}</b> <small className="muted">{atMyt(e.at)} · {ctx.who(e.by_name, e.by_role)}</small>{e.note && <div className="qr-tl-n">{e.note}</div>}</li>)}</ol> : <p className="muted">—</p>}
          </Card>
          {active && <Card title="Finish">
            <div className="row-gap">
              <Btn kind="primary" icon="userplus" disabled={!r.arrived_at} title={r.arrived_at ? undefined : 'Available once he has arrived'} onClick={() => setEdit('convert')}>Convert to worker</Btn>
              {ctx.isHraUp && <Btn kind="danger" icon="ban" onClick={() => setEdit('drop')}>Drop</Btn>}
            </div>
            {r.vdr_applied && <small className="muted">A dropped recruit whose calling visa was applied keeps the slot used; return it with a ledger movement once the VDR is cancelled.</small>}
          </Card>}
          {r.status === 'converted' && r.worker_id && <Card title="Worker"><Link to={`/workers/${r.worker_id}`}>Open the worker record</Link></Card>}
        </div>
      </div>

      {step && <QForm title={step.label} initial={{ date: todayISO() }} onClose={() => setStep(null)} saveLabel="Mark done"
        note={step.key === 'vdr_apply' ? 'This uses 1 quota slot from the approved request and is recorded in the ledger.' : step.hint}
        fields={[{ key: 'date', label: 'Date', type: 'date', required: true }, { key: 'ref', label: step.key === 'vdr_apply' ? 'VDR / FWCMS application no.' : 'Reference (optional)', required: step.key === 'vdr_apply' }, { key: 'note', label: 'Note', full: true }]}
        onSave={(v) => tick(step, { done: true, date: s(v.date), ref: s(v.ref), note: s(v.note) },
          step.key === 'vdr_apply' ? { vdr_applied: v.date, vdr_no: v.ref } : step.key === 'vdr_ok' ? { vdr_approved: v.date } : step.key === 'arrived' && !r.arrived_at ? { arrived_at: `${v.date}T12:00:00+08:00` } : {})} />}
      {edit === 'details' && <RecruitForm v={{ ...r } as unknown as Record<string, unknown>} onClose={() => setEdit(null)} />}
      {edit === 'travel' && <TravelForm r={r} onClose={() => setEdit(null)} />}
      {edit === 'link' && <LinkForm r={r} onClose={() => setEdit(null)} />}
      {edit === 'pay' && <PaymentForm initial={{ company_id: r.company_id, recruit_id: r.id, batch_id: r.batch_id, country: r.country, quota_id: ur?.quota_id, paid_on: todayISO() }} onClose={() => setEdit(null)} />}
      {edit === 'drop' && <NoteAsk title={`Drop ${r.full_name}`} label="Reason" danger confirm="Drop" onClose={() => setEdit(null)} onOk={(n) => qcall('qr_drop_recruit', { p_id: r.id, p_reason: n })} />}
      {edit === 'letter' && <AirportLetter r={r} onClose={() => setEdit(null)} />}
      {edit === 'convert' && <ConvertForm r={r} onClose={() => setEdit(null)} />}
    </div>
  )
}

const addDays30 = (iso: string) => { const d = new Date(iso); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10) }
const toLocalDT = (iso?: string | null) => (iso ? new Date(new Date(iso).getTime() + 8 * 3600e3).toISOString().slice(0, 16) : '')

function TravelForm({ r, onClose }: { r: Recruit; onClose: () => void }) {
  const ctx = useQCtx()
  return (
    <QForm title="Calling visa, flight & arrival" onClose={onClose}
      note="Times are Malaysia time (MYT). Saving a flight time tells HR to prepare the hostel bed, pickup and airport letter."
      initial={{ vdr_no: r.vdr_no, vdr_approved: r.vdr_approved, vdr_expiry: r.vdr_expiry, flight_no: r.flight_no, flight_at: toLocalDT(r.flight_at), airport: r.airport || 'KLIA Terminal 1', pickup_by: r.pickup_by, transport: r.transport, hostel_id: r.hostel_id, arrived_at: toLocalDT(r.arrived_at) }}
      fields={[
        { key: 'vdr_no', label: 'VDR / calling visa no.', show: () => !!r.vdr_applied }, { key: 'vdr_approved', label: 'VDR approved on', type: 'date', show: () => !!r.vdr_applied },
        { key: 'vdr_expiry', label: 'Calling visa valid until', type: 'date', show: () => !!r.vdr_applied, hint: 'He must enter Malaysia before this date.' },
        { key: 'flight_no', label: 'Flight no.', type: 'upper' }, { key: 'flight_at', label: 'Lands at (MYT)', type: 'datetime-local' },
        { key: 'airport', label: 'Airport', type: 'select', options: ['KLIA Terminal 1', 'KLIA Terminal 2', 'Penang International', 'Senai (Johor Bahru)', 'Kota Kinabalu', 'Kuching', 'Other'] },
        { key: 'pickup_by', label: 'Pickup person (name, IC, phone)', full: true }, { key: 'transport', label: 'Transport (vehicle / plate)' },
        { key: 'hostel_id', label: 'Hostel', type: 'select', options: [{ value: '', label: '—' }, ...ctx.cfg.hostels.items.filter((h) => !h.archived).map((h) => ({ value: h.id, label: h.name }))] },
        { key: 'arrived_at', label: 'Arrived at (MYT)', type: 'datetime-local' },
      ]}
      onSave={(v) => {
        const p: Record<string, unknown> = { id: r.id }
        for (const [k, x] of Object.entries(v)) if (x !== '' && x != null) p[k] = (k === 'flight_at' || k === 'arrived_at') ? `${x}:00+08:00` : x
        if (p.flight_at === `${toLocalDT(r.flight_at)}:00+08:00`) delete p.flight_at
        if (p.arrived_at === `${toLocalDT(r.arrived_at)}:00+08:00`) delete p.arrived_at
        return qcall('qr_save_recruit', { p })
      }} />
  )
}

function LinkForm({ r, onClose }: { r: Recruit; onClose: () => void }) {
  const d = useQuota()
  const opts = d.requests.filter((u) => u.company_id === r.company_id && u.country === r.country && ['pending', 'gm_approved', 'approved'].includes(u.status) && u.id !== r.use_request_id)
    .map((u) => ({ u, linked: d.recruits.filter((x) => x.use_request_id === u.id).length })).filter((x) => x.linked < x.u.slots)
  return (
    <QForm title={`Link ${r.full_name} to a Quota Use Request`} onClose={onClose} initial={{}} saveLabel="Link"
      note={opts.length ? 'Only requests for the same company and country with a free slot are listed.' : 'No open request has a free slot for this country. Raise a new request in Approvals.'}
      fields={[{ key: 'req', label: 'Request', type: 'select', required: true, options: opts.map(({ u, linked }) => ({ value: u.id, label: `Q-${u.ref_no} · ${UR_STATUS[u.status].label} · ${linked}/${u.slots} linked` })) }]}
      onSave={(v) => qcall('qr_link_recruit', { p_recruit: r.id, p_request: v.req })} />
  )
}

function AirportLetter({ r, onClose }: { r: Recruit; onClose: () => void }) {
  const ctx = useQCtx()
  const meta = useSheetMeta(r.company_id, 'Airport authorisation letter')
  const company = ctx.cName(r.company_id)
  const blocks: Block[] = [
    { kind: 'heading', text: 'To: Immigration Department of Malaysia / Airport Arrival Desk', sub: r.airport || 'KLIA' },
    { kind: 'note', text: `${company} confirms that the foreign worker below is employed by us under an approved calling visa (VDR) and authorises the person named to receive him at the airport and bring him to our registered accommodation.` },
    { kind: 'fields', title: 'Worker', cols: 2, items: [['Name', r.full_name], ['Nationality', r.country], ['Passport no.', r.passport_no], ['Passport expiry', fmtDate(r.passport_expiry || '')], ['VDR / calling visa no.', r.vdr_no], ['VDR valid until', fmtDate(r.vdr_expiry || '')], ['Job', r.job]] },
    { kind: 'fields', title: 'Arrival', cols: 2, items: [['Flight', r.flight_no], ['Lands (MYT)', r.flight_at ? atMyt(r.flight_at) : ''], ['Airport', r.airport], ['Authorised pickup', r.pickup_by], ['Transport', r.transport],
      ['Accommodation', ctx.cfg.hostels.items.find((h) => h.id === r.hostel_id)?.address || ctx.cfg.hostels.items.find((h) => h.id === r.hostel_id)?.name || '']] },
    { kind: 'note', tone: 'amber', text: 'The worker keeps his own passport. The company pays the flight, levy, calling visa and FOMEMA; no fee is charged to the worker. FOMEMA medical is done within 30 days of arrival.' },
    { kind: 'signatures' },
  ]
  return <Preview blocks={blocks} meta={meta} file={`airport-letter-${r.full_name.replace(/\W+/g, '-')}.pdf`} onClose={onClose}
    onPrinted={() => { if (!r.steps?.airport_letter?.done) qcall('qr_save_recruit', { p: { id: r.id, steps: { airport_letter: { done: true, date: todayISO() } } } }).catch(() => undefined) }} />
}

function ConvertForm({ r, onClose }: { r: Recruit; onClose: () => void }) {
  const d = useQuota()
  const workers = useWorkers()
  const nav = useNavigate()
  const ur = d.requests.find((u) => u.id === r.use_request_id)
  const pays = d.payments.filter((p) => p.recruit_id === r.id && p.status !== 'void')
  const dup = useMemo(() => workers.find((w) => r.passport_no && w.documents?.some((x) => x.type === 'Passport' && x.number === r.passport_no)), [workers, r.passport_no])
  return (
    <QForm title={`Convert ${r.full_name} to a worker`} onClose={onClose} saveLabel="Create worker"
      note={<>Creates the worker record with passport, VDR, payments (as company-paid costs) and the quota link. {dup && <b className="neg">A worker with passport {r.passport_no} already exists ({dup.workerNo}).</b>}</>}
      initial={{ joinDate: (r.arrived_at || todayISO()).slice(0, 10), initialBasicPay: 1700, outletId: r.outlet_id || d.batches.find((b) => b.id === r.batch_id)?.outlet_id || '' }}
      fields={[{ key: 'joinDate', label: 'Join date', type: 'date', required: true }, { key: 'initialBasicPay', label: 'Basic pay', type: 'money', required: true, hint: 'Check the minimum wage in force.' }]}
      onSave={async (v) => {
        if (dup) throw new Error(`Passport ${r.passport_no} is already on ${dup.workerNo}.`)
        const all = await db.workers.toArray()
        const max = all.reduce((m, w) => Math.max(m, parseInt(w.workerNo.replace(/\D/g, '')) || 0), 1000)
        const now = new Date().toISOString()
        const docs: DocRec[] = []
        if (r.passport_no) docs.push({ id: uid(), type: 'Passport', number: r.passport_no, expiryDate: r.passport_expiry || undefined })
        if (r.vdr_no) docs.push({ id: uid(), type: 'Visa / VDR', number: r.vdr_no, issueDate: r.vdr_approved || undefined, expiryDate: r.vdr_expiry || undefined })
        const costs: CostRec[] = pays.map((p) => ({ id: uid(), date: p.paid_on, type: PAY_CATS.find((c) => c.key === p.category)?.workerCost || 'Other', amount: Number(p.amount_rm), paidBy: 'Company', notes: `${payLabel(p.category)}${p.ref ? ` · ${p.ref}` : ''} (from recruitment)` }))
        const w: Worker = {
          id: uid(), workerNo: `FW${max + 1}`, fullName: r.full_name, nationality: r.country, dob: r.dob || undefined, gender: r.gender || undefined, phoneMY: r.phone || undefined,
          outletId: s(v.outletId) || undefined, hostelId: r.hostel_id || undefined, joinDate: s(v.joinDate), status: 'Active-Working',
          statusHistory: [{ id: uid(), date: s(v.joinDate), to: 'Active-Working', remarks: `Arrived ${r.arrived_at ? atMyt(r.arrived_at) : ''} — converted from recruitment${ur ? ` (Q-${ur.ref_no})` : ''}` }],
          documents: docs, family: [], initialBasicPay: Number(v.initialBasicPay) || 0, increments: [], allowances: [], loans: [], deductions: [], leaves: [], memos: [], notes: [],
          firstArrivalDate: (r.arrived_at || '').slice(0, 10) || undefined, contractStart: s(v.joinDate), contractEnd: addMonths(s(v.joinDate), 24),
          quotaId: ur?.quota_id, recruitId: r.id, costs, createdAt: now, updatedAt: now,
        } as Worker
        await saveWorker(w)
        await syncNow().catch(() => undefined)
        let last: unknown
        for (let i = 0; i < 5; i++) {
          try { await qcall('qr_mark_converted', { p_id: r.id, p_worker: w.id }); last = null; break } catch (e) { last = e; await new Promise((ok) => setTimeout(ok, 1500)); await syncNow().catch(() => undefined) }
        }
        if (last) { toast('Worker created on this device; the link will be finished once it syncs — open the recruit again later.', 'err'); return }
        toast(`${w.workerNo} created`)
        nav(`/workers/${w.id}`)
      }} />
  )
}
