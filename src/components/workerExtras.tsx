import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Btn, Card, Chip, Empty, FormModal, KV } from './ui'
import { UploadDoc } from './vault'
import { useAuth } from '../lib/auth'
import { useConfig } from '../lib/config'
import { db, updateWorker } from '../lib/db'
import { useOutlets, useSettings } from '../lib/hooks'
import { CONSENT_LABEL, CONSENT_TONE, CUSTODY_LABEL, consentOf, consentPdf, custodyOf, lastRelease, overdueDays, passportOf, slipPdf } from '../lib/passport'
import { refNo, useRequests } from '../lib/requests'
import { OPEN_STATUSES, REQUEST_TYPE, STATUS_LABEL, STATUS_TONE } from '../lib/workflow'
import type { PassportMove, Remark, Worker } from '../lib/types'
import { download, fmtDate, todayISO, uid } from '../lib/util'

const fail = (e: unknown) => alert((e as Error).message)

/* ---------- Passport safekeeping: consent + custody register ---------- */
export function PassportPanel({ w }: { w: Worker }) {
  const { canWrite, isOM, profile } = useAuth()
  const s = useSettings()
  const outlets = useOutlets()
  const cfg = useConfig()
  const nav = useNavigate()
  const [up, setUp] = useState(false)
  const [move, setMove] = useState<PassportMove['kind'] | null>(null)
  const ps = w.passportSafe
  const consent = consentOf(w)
  const custody = custodyOf(w)
  const pp = passportOf(w)
  const od = overdueDays(w)
  const me = profile?.full_name || profile?.email || 'HR'
  const company = s.companyName

  const form = async () => {
    try {
      download(`passport-consent-${w.workerNo}.pdf`, await consentPdf([w], outlets, company), 'application/pdf')
      if (canWrite && (consent === 'not_issued' || consent === 'withdrawn'))
        await updateWorker(w.id, (x) => { x.passportSafe = { ...(x.passportSafe || { consent: 'not_issued' }), consent: 'pending', issuedAt: todayISO(), issuedBy: me } })
    } catch (e) { fail(e) }
  }
  const verify = () => updateWorker(w.id, (x) => { x.passportSafe = { ...x.passportSafe!, consent: 'signed', signedAt: todayISO(), verifiedBy: me } }).catch(fail)
  const withdraw = () => {
    const why = prompt('Worker withdrew consent. Reason / note:')
    if (why === null) return
    updateWorker(w.id, (x) => {
      x.passportSafe = { ...x.passportSafe!, consent: 'withdrawn', withdrawnAt: todayISO(), withdrawnReason: why }
      x.notes.push({ id: uid(), date: todayISO(), text: `Passport safekeeping consent withdrawn${why ? ': ' + why : ''}. Passport must be returned to the worker.` })
    }).catch(fail)
    if (custody === 'in_safe') setTimeout(() => setMove('release'), 50)
  }
  const saveMove = async (v: Record<string, unknown>) => {
    const m: PassportMove = { id: uid(), kind: move!, date: String(v.date), by: me, reason: (v.reason as string) || undefined, expectedReturn: (v.expectedReturn as string) || undefined, remarks: (v.remarks as string) || undefined }
    await updateWorker(w.id, (x) => {
      const p = x.passportSafe || { consent: 'not_issued' as const }
      p.moves = [...(p.moves || []), m]
      p.custody = m.kind === 'release' ? 'released' : 'in_safe'
      x.passportSafe = p
      x.notes.push({ id: uid(), date: m.date, text: `Passport ${m.kind === 'release' ? `released to worker (${m.reason || ''}${m.expectedReturn ? `, back by ${fmtDate(m.expectedReturn)}` : ''})` : m.kind === 'deposit' ? 'deposited in company safe (with consent)' : 'returned to company safe'} by ${me}` })
    })
    // slip PDF → vault (best effort; also downloaded for signing)
    try {
      const blob = await slipPdf((await db.workers.get(w.id))!, m, outlets, company)
      download(`passport-${m.kind}-${w.workerNo}-${m.date}.pdf`, blob, 'application/pdf')
      const { uploadDoc } = await import('../lib/vault')
      const d = await uploadDoc({ workerId: w.id, category: 'Passport release slip', title: `Passport ${m.kind} slip ${fmtDate(m.date)}`, source: 'generated' }, { blob, name: `passport-${m.kind}-${m.date}.pdf`, pages: 1 })
      await updateWorker(w.id, (x) => { const mv = x.passportSafe?.moves?.find((y) => y.id === m.id); if (mv) mv.slipDocId = d.id })
    } catch (e) { console.warn(e) }
  }
  const slip = async (m: PassportMove) => { try { download(`passport-${m.kind}-${w.workerNo}-${m.date}.pdf`, await slipPdf(w, m, outlets, company), 'application/pdf') } catch (e) { fail(e) } }
  const lr = lastRelease(w)
  return (
    <>
      <Card title="🛂 Passport safekeeping" className={consent === 'pending' ? 'card-alert' : ''}>
        <p className="muted small">Passports Act 1966 s.12(1)(f): an employer may not keep a worker’s passport without his consent. The passport is kept in the <strong>worker’s own hands or the company safe (with consent)</strong>; it is his property, returned on request within {cfg.passport.turnaroundHours} hours, no deposit or fee.</p>
        <div className="row gap-s wrap">
          <Chip tone={CONSENT_TONE[consent]}>Consent: {CONSENT_LABEL[consent]}</Chip>
          <Chip tone={custody === 'in_safe' ? 'blue' : custody === 'released' ? 'amber' : 'gray'}>{CUSTODY_LABEL[custody]}</Chip>
          {od > 0 && <Chip tone="red">Return overdue {od} d</Chip>}
          {w.waOptIn && <Chip tone="green">WhatsApp opt-in {fmtDate(w.waOptInAt)}</Chip>}
        </div>
        <KV items={[
          ['Passport no.', pp.no || '—'], ['Passport expiry', fmtDate(pp.expiry)],
          ['Form issued', ps?.issuedAt ? `${fmtDate(ps.issuedAt)} · ${ps.issuedBy || ''}` : '—'],
          ['Signed copy uploaded', ps?.uploadedAt ? `${fmtDate(ps.uploadedAt.slice(0, 10))} · ${ps.uploadedBy || ''}` : '—'],
          ['Verified (signed)', ps?.signedAt ? `${fmtDate(ps.signedAt)} · ${ps.verifiedBy || ''}` : '—'],
          ...(ps?.withdrawnAt ? [['Withdrawn', `${fmtDate(ps.withdrawnAt)} ${ps.withdrawnReason || ''}`] as [string, string]] : []),
          ...(custody === 'released' && lr ? [['Released', `${fmtDate(lr.date)} · ${lr.reason || ''} · back by ${fmtDate(lr.expectedReturn)}`] as [string, string]] : []),
        ]} />
        <div className="row gap-s wrap mt-s">
          <Btn small icon="print" onClick={form}>{consent === 'not_issued' || consent === 'withdrawn' ? 'Issue consent form (EN/BM PDF)' : 'Re-print consent form'}</Btn>
          {(canWrite || isOM) && consent !== 'signed' && <Btn small kind={consent === 'pending' ? 'primary' : 'secondary'} icon="upload" onClick={() => setUp(true)}>Upload signed consent</Btn>}
          {canWrite && consent === 'uploaded' && <Btn small kind="primary" icon="check" onClick={verify}>Verify &amp; mark Signed</Btn>}
          {canWrite && (consent === 'signed' || consent === 'uploaded') && <Btn small kind="ghost" onClick={withdraw}>Record withdrawal</Btn>}
        </div>
      </Card>
      <Card title="Custody register" actions={canWrite ? (
        <div className="row gap-s">
          {custody === 'with_worker' && <Btn small kind="primary" disabled={consent !== 'signed'} title={consent !== 'signed' ? 'Consent must be signed and verified first' : ''} onClick={() => setMove('deposit')}>Deposit in safe</Btn>}
          {custody === 'in_safe' && <Btn small kind="primary" onClick={() => setMove('release')}>Release to worker</Btn>}
          {custody === 'released' && consent === 'signed' && <Btn small kind="primary" onClick={() => setMove('return')}>Returned to safe</Btn>}
        </div>) : isOM ? <Btn small onClick={() => nav(`/requests/new?type=passport&worker=${w.id}`)}>Request release / return</Btn> : undefined}>
        {custody === 'with_worker' && consent !== 'signed' && canWrite && <p className="muted small">Deposit is possible only after the signed consent is verified.</p>}
        {!(ps?.moves || []).length ? <p className="muted small">No movements recorded.</p> : (
          <table className="tbl">
            <thead><tr><th>Date</th><th>Movement</th><th>Reason / expected back</th><th>By</th><th /></tr></thead>
            <tbody>{[...(ps?.moves || [])].reverse().map((m) => (
              <tr key={m.id}><td>{fmtDate(m.date)}</td><td>{m.kind === 'release' ? 'Released to worker' : m.kind === 'deposit' ? 'Deposited in safe' : 'Returned to safe'}</td>
                <td>{m.reason || ''}{m.expectedReturn ? ` · by ${fmtDate(m.expectedReturn)}` : ''}</td><td>{m.by}</td>
                <td><Btn small kind="ghost" icon="print" title="Slip PDF" onClick={() => slip(m)} /></td></tr>
            ))}</tbody>
          </table>
        )}
      </Card>
      {canWrite && (
        <Card title="WhatsApp / SMS messages">
          <label className="check"><input type="checkbox" checked={!!w.waOptIn} onChange={(e) => updateWorker(w.id, (x) => { x.waOptIn = e.target.checked; x.waOptInAt = e.target.checked ? todayISO() : undefined; if (!e.target.checked) x.waOptOutVia = 'HR' }).catch(fail)} /> Worker agreed to receive WhatsApp / SMS updates (point 7 on the consent form)</label>
        </Card>
      )}
      {up && <UploadDoc workerId={w.id} category="Passport safekeeping consent" lockCategory title={`Passport safekeeping consent — ${w.fullName}`} hint="Scan all pages of the signed form (worker signature or thumbprint, witness, HR). HR Manager then verifies it and marks it Signed." onClose={() => setUp(false)} />}
      {move && (
        <FormModal title={move === 'release' ? 'Release passport to worker' : move === 'deposit' ? 'Deposit passport in company safe' : 'Passport returned to safe'} onClose={() => setMove(null)}
          initial={{ date: todayISO() }} onSave={saveMove}
          fields={[{ key: 'date', label: 'Date', type: 'date', required: true },
            ...(move === 'release' ? [{ key: 'reason', label: 'Reason', type: 'select' as const, required: true, options: ['Worker request', 'Home leave / travel', 'Permit renewal / immigration', 'Bank / official use', 'Consent withdrawn', 'Exit / repatriation', 'Other'] }, { key: 'expectedReturn', label: 'Expected return (blank = not returning)', type: 'date' as const }] : []),
            { key: 'remarks', label: 'Remarks', type: 'textarea', full: true }]}>
          {() => <p className="muted small">A {move} slip PDF is created for signatures and saved in the vault.</p>}
        </FormModal>
      )}
    </>
  )
}

/* ---------- Remarks (outlet managers can add these without edit rights) ---------- */
export function RemarksPanel({ w }: { w: Worker }) {
  const { canRequest, profile, session, role } = useAuth()
  const rows = useLiveQuery(() => db.remarks.where('workerId').equals(w.id).reverse().sortBy('at'), [w.id]) || []
  const [text, setText] = useState('')
  const [kind, setKind] = useState<Remark['kind']>('remark')
  const add = async () => {
    if (!text.trim()) return
    try {
      await db.remarks.put({ id: uid(), workerId: w.id, text: text.trim(), kind, at: new Date().toISOString(), by: profile?.full_name || profile?.email || '', byId: session?.user.id, byRole: role || undefined })
      setText('')
    } catch (e) { fail(e) }
  }
  const tone: Record<string, string> = { remark: 'gray', performance: 'blue', incident: 'red', praise: 'green' }
  return (
    <Card title={`Remarks (${rows.length})`}>
      {canRequest && (
        <div className="mb-s">
          <textarea rows={2} aria-label="New remark" placeholder="Add a remark about this worker…" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row gap-s mt-s">
            <select aria-label="Remark type" value={kind} onChange={(e) => setKind(e.target.value as Remark['kind'])}>{['remark', 'performance', 'incident', 'praise'].map((k) => <option key={k}>{k}</option>)}</select>
            <Btn small kind="primary" icon="plus" onClick={add}>Add remark</Btn>
          </div>
        </div>
      )}
      {rows.length === 0 ? <p className="muted small">No remarks yet.</p> : (
        <ul className="rows">{rows.map((r) => <li key={r.id}><div className="r-main"><span>{r.text}</span><small>{r.by} · {new Date(r.at).toLocaleString()}</small></div><Chip tone={tone[r.kind || 'remark']}>{r.kind || 'remark'}</Chip></li>)}</ul>
      )}
    </Card>
  )
}

/* ---------- requests of one worker ---------- */
export function WorkerRequests({ w }: { w: Worker }) {
  const { canRequest } = useAuth()
  const nav = useNavigate()
  const { rows, loading } = useRequests({ workerId: w.id })
  return (
    <Card title={`Requests (${rows.filter((r) => OPEN_STATUSES.includes(r.status)).length} open)`} actions={canRequest && <Btn small kind="primary" icon="plus" onClick={() => nav(`/requests/new?worker=${w.id}`)}>New request</Btn>}>
      {loading && !rows.length ? <p className="muted">Loading…</p> : rows.length === 0 ? <Empty title="No requests for this worker" /> : (
        <ul className="rows">{rows.map((r) => (
          <li key={r.id}><Link to={`/requests/${r.id}`} className="req-link"><span className="req-ic">{REQUEST_TYPE[r.type]?.icon}</span>
            <div className="r-main"><strong>{REQUEST_TYPE[r.type]?.label || r.type}</strong><small>{refNo(r)} · {fmtDate(r.created_at.slice(0, 10))} · {r.created_by_name}</small></div>
            <Chip tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Chip></Link></li>
        ))}</ul>
      )}
    </Card>
  )
}
