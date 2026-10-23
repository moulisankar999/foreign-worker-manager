import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Btn, Card, Chip, D, Empty, FormModal, KV, Modal, docTone, type FieldDef } from './ui'
import { FilePick } from './filePick'
import { compressImage } from '../lib/vault'
import { Icon } from './Icon'
import { updateWorker } from '../lib/db'
import { useOutlets } from '../lib/hooks'
import { openAttachment } from '../lib/sync'
import { allowancesTotal, buildAlerts, currentBasic, docStatus, leaveBalances, loanBalance, loanLedger, minContractEnd, outstanding, proratedPenalty, sortedIncrements, ticketInfo } from '../lib/calc'
import { buildICS } from '../lib/ics'
import { defaultChecklist } from '../lib/memo'
import { dateIssues, passportIssue } from '../lib/validate'
import { APPROVAL, DEDUCTION_TYPES, DOC_SHORT, DOC_STAGES, DOC_TYPES, REQUIRED_DOCS, EXIT_TYPES, LEAVE_TYPES, LOAN_TYPES, RELATIONS, TICKET_PAYERS, type DocRec, type LeaveRec, type MemoRec, type Settings, type Worker, type WorkerStatus } from '../lib/types'
import { daysBetweenInclusive, daysUntil, download, fmtDate, readFileAsDataURL, rm, todayISO, uid } from '../lib/util'
import { LeaveEntitlementCard, WorkerPayCompliance } from './pay'

type V = Record<string, unknown>
type P = { w: Worker; s: Settings }
const upd = (w: Worker, fn: (x: Worker) => void) => updateWorker(w.id, fn)
const strip = (v: V) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === '' ? undefined : x]))

export function setStatus(w: Worker, to: WorkerStatus, date: string, remarks?: string) {
  return upd(w, (x) => {
    if (x.status === to) return
    x.statusHistory.push({ id: uid(), date, from: x.status, to, remarks })
    x.status = to
  })
}

/* ---------------- Documents ---------------- */
export function DocumentsTab({ w, s }: P) {
  const [edit, setEdit] = useState<Partial<DocRec> | null>(null)
  const fields: FieldDef[] = [
    { key: 'type', label: 'Document type', type: 'select', options: [...DOC_TYPES], required: true },
    { key: 'label', label: 'Document name', required: true, show: (v) => v.type === 'Other', placeholder: 'e.g. Food handler cert, Driving licence' },
    { key: 'number', label: 'Number / reference', type: 'upper' },
    { key: 'issueDate', label: 'Issue date', type: 'date', max: todayISO() },
    { key: 'expiryDate', label: 'Expiry date', type: 'date' },
    { key: 'issuePlace', label: 'Issuing place / office' },
    { key: 'stage', label: 'Status', type: 'select', options: DOC_STAGES },
    { key: 'remarks', label: 'Remarks', type: 'textarea' },
  ]
  const order = (t: string) => { const i = (DOC_TYPES as readonly string[]).indexOf(t); return i < 0 ? 99 : i }
  // one numbered entry per document type (latest record first, older ones as history)
  const groups = new Map<string, DocRec[]>()
  for (const d of w.documents) { const g = d.type === 'Other' ? `Other:${d.label || d.id}` : d.type; groups.set(g, [...(groups.get(g) || []), d]) }
  for (const t of REQUIRED_DOCS) if (!groups.has(t)) groups.set(t, [])
  const list = [...groups.entries()].map(([g, ds]) => ({ g, type: ds[0]?.type || g, ds: ds.sort((a, b) => (b.expiryDate || '').localeCompare(a.expiryDate || '')) }))
    .sort((a, b) => order(a.type) - order(b.type) || a.g.localeCompare(b.g))
  const ics = (d: DocRec) => {
    const a = buildAlerts([{ ...w, documents: [d], leaves: [], loans: [], family: [], contractEnd: undefined, minContractMonths: undefined }], { ...s, leadTimes: [100000] }).filter((x) => x.id === `doc-${d.id}`)
    download(`${w.workerNo}-${(d.label || d.type).replace(/\W+/g, '-')}.ics`, buildICS(a, Math.max(...s.leadTimes)), 'text/calendar')
  }
  const validate = (v: V) => {
    const di = dateIssues(v.issueDate as string, v.expiryDate as string)
    if (di.issue?.level === 'error') return di.issue.msg
    if (di.expiry?.level === 'error') return di.expiry.msg
    if (v.type === 'Passport') { const pi = passportIssue(v.number, w.nationality); if (pi?.level === 'error') return pi.msg }
    return null
  }
  return (
    <Card title="Documents" actions={<Btn kind="primary" small icon="plus" onClick={() => setEdit({ type: 'Passport' })}>Add</Btn>}>
      {list.length === 0 ? <Empty title="No documents yet" /> : (
        <ol className="doc-list">
          {list.map(({ g, type, ds }, i) => {
            const d = ds[0]
            const title = type === 'Other' ? d?.label || 'Other' : DOC_SHORT[type] || type
            if (!d) return (
              <li key={g} className="doc-item empty">
                <div className="doc-h"><span className="doc-no">{i + 1}.</span><strong>{title}</strong><Chip tone="red">Not recorded</Chip><span className="spacer" />
                  <Btn small icon="plus" onClick={() => setEdit({ type })}>Add</Btn></div>
              </li>
            )
            const st = docStatus(d, s)
            const n = daysUntil(d.expiryDate)
            return (
              <li key={g} className="doc-item">
                <div className="doc-h">
                  <span className="doc-no">{i + 1}.</span><strong>{title}</strong>
                  <Chip tone={docTone(st)}>{st}</Chip>
                  <span className="spacer" />
                  {d.attachment && <button type="button" className="btn btn-ghost btn-s" title="Open attachment" aria-label="Open attachment" onClick={() => openAttachment(d.attachment!)}><Icon name="doc" size={16} /></button>}
                  {d.expiryDate && <Btn small kind="ghost" icon="cal" title="Add to calendar" onClick={() => ics(d)} />}
                  {d.expiryDate && <Btn small onClick={() => setEdit({ type: d.type, label: d.label, number: d.number, issuePlace: d.issuePlace })}>Renew</Btn>}
                  <Btn small kind="ghost" icon="edit" title="Edit" onClick={() => setEdit(d)} />
                </div>
                <dl className="doc-dl">
                  <div><dt>Number</dt><dd>{d.number || '—'}</dd></div>
                  <div><dt>Issue date</dt><dd><D d={d.issueDate} /></dd></div>
                  <div><dt>Expiry date</dt><dd><D d={d.expiryDate} />{n !== null ? <small className="muted"> ({n < 0 ? `${-n}d ago` : `${n}d`})</small> : null}</dd></div>
                  <div><dt>Issuing place</dt><dd>{d.issuePlace || '—'}</dd></div>
                  <div><dt>Status</dt><dd>{d.stage || '—'}</dd></div>
                </dl>
                {d.remarks && <small className="muted">{d.remarks}</small>}
                {ds.length > 1 && (
                  <div className="doc-hist">History: {ds.slice(1).map((h) => (
                    <button key={h.id} type="button" className="link small ml-s" onClick={() => setEdit(h)}>{h.number ? `#${h.number} ` : ''}exp {fmtDate(h.expiryDate)}</button>
                  ))}</div>
                )}
              </li>
            )
          })}
        </ol>
      )}
      <p className="muted small">Tip: “Renew” adds a new record and keeps the old one as history. Alerts use the latest expiry per document type.</p>
      {edit && (
        <FormModal title={edit.id ? 'Edit document' : 'Add document'} fields={fields} initial={edit as V} onClose={() => setEdit(null)} validate={validate}
          onDelete={edit.id ? () => upd(w, (x) => { x.documents = x.documents.filter((d) => d.id !== edit.id) }) : undefined}
          onSave={(v) => upd(w, (x) => {
            const rec = { ...(strip(v) as unknown as DocRec), id: edit.id || uid() }
            x.documents = edit.id ? x.documents.map((d) => (d.id === edit.id ? rec : d)) : [...x.documents, rec]
          })}>
          {(v, set) => <AttachmentField v={v} set={set} />}
        </FormModal>
      )}
    </Card>
  )
}

function AttachmentField({ v, set }: { v: V; set: (p: V) => void }) {
  const att = v.attachment as DocRec['attachment']
  return (
    <div className="field full">
      <label>Attachment (optional, max 5 MB, saved privately in the cloud)</label>
      <div className="row gap-s wrap">
        <FilePick name="attachment" onFiles={async ([f0]) => {
          let f: Blob = f0
          if (f0.type.startsWith('image/') && f0.size > 1024 * 1024) { try { f = await compressImage(f0) } catch { f = f0 } }
          if (f.size > 5 * 1024 * 1024) { alert('File too large (max 5 MB)'); return }
          set({ attachment: { name: f0.name, type: f.type || f0.type, dataUrl: await readFileAsDataURL(f as File) } })
        }} />
        {att && <span className="small">📎 {att.name} <button type="button" className="link" onClick={() => set({ attachment: undefined })}>remove</button></span>}
      </div>
    </div>
  )
}

/* ---------------- Family ---------------- */
export function FamilyTab({ w }: P) {
  const [edit, setEdit] = useState<V | null>(null)
  const fields: FieldDef[] = [
    { key: 'relation', label: 'Relation', type: 'select', options: RELATIONS, required: true },
    { key: 'name', label: 'Name', required: true },
    { key: 'dob', label: 'Date of birth', type: 'date' },
    { key: 'phone', label: 'Phone', type: 'tel' },
    { key: 'address', label: 'Address', type: 'textarea' },
    { key: 'isNextOfKin', label: 'Next of kin', type: 'checkbox' },
    { key: 'isEmergency', label: 'Emergency contact', type: 'checkbox' },
  ]
  return (
    <>
      <Card title="Addresses">
        <KV items={[['Overseas address', w.overseasAddress], ['Malaysian accommodation / hostel', w.hostelAddress]]} />
      </Card>
      <Card title="Next of kin & family" actions={<Btn kind="primary" small icon="plus" onClick={() => setEdit({})}>Add</Btn>}>
        {w.family.length === 0 ? <Empty title="No family members recorded" /> : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Relation</th><th>Name</th><th>DOB</th><th>Phone</th><th>Address</th><th>Flags</th><th /></tr></thead>
              <tbody>
                {w.family.map((f) => (
                  <tr key={f.id}>
                    <td>{f.relation}</td><td>{f.name}</td><td><D d={f.dob} /></td>
                    <td>{f.phone ? <a href={`tel:${f.phone}`}>{f.phone}</a> : '—'}</td><td>{f.address || '—'}</td>
                    <td>{f.isNextOfKin && <Chip tone="teal">Next of kin</Chip>} {f.isEmergency && <Chip tone="red">Emergency</Chip>}</td>
                    <td><Btn small kind="ghost" icon="edit" title="Edit" onClick={() => setEdit(f as unknown as V)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {edit && (
        <FormModal title={edit.id ? 'Edit family member' : 'Add family member'} fields={fields} initial={edit} onClose={() => setEdit(null)}
          onDelete={edit.id ? () => upd(w, (x) => { x.family = x.family.filter((f) => f.id !== edit.id) }) : undefined}
          onSave={(v) => upd(w, (x) => {
            const rec = { ...(strip(v) as unknown as Worker['family'][number]), id: (edit.id as string) || uid() }
            x.family = edit.id ? x.family.map((f) => (f.id === edit.id ? rec : f)) : [...x.family, rec]
          })} />
      )}
    </>
  )
}

/* ---------------- Contract & exit ---------------- */
export function ContractTab({ w, s }: P) {
  const nav = useNavigate()
  const [calcDate, setCalcDate] = useState(todayISO())
  const [exit, setExit] = useState(false)
  const [renew, setRenew] = useState(false)
  const pc = proratedPenalty(w, calcDate)
  const mce = minContractEnd(w)
  return (
    <>
      <Card title="Contract" actions={<><Btn small onClick={() => setRenew(true)}>Renew / extend</Btn><Btn small kind="danger" icon="exit" onClick={() => setExit(true)}>Process exit</Btn></>}>
        <KV items={[
          ['Join date', fmtDate(w.joinDate)], ['Contract start', fmtDate(w.contractStart)], ['Contract end', <>{fmtDate(w.contractEnd)} {w.contractEnd && <Chip tone={daysUntil(w.contractEnd)! < 0 ? 'red' : daysUntil(w.contractEnd)! < 90 ? 'amber' : 'green'}>{daysUntil(w.contractEnd)! < 0 ? 'ended' : `${daysUntil(w.contractEnd)}d left`}</Chip>}</>],
          ['Minimum contract period', w.minContractMonths ? `${w.minContractMonths} months (until ${fmtDate(mce)})` : 'Not set'],
          ['Early-termination penalty', w.earlyPenalty ? rm(w.earlyPenalty) + ' (full)' : 'Not set'],
          ['Exit date', fmtDate(w.exitDate)],
        ]} />
      </Card>
      <Card title="Prorated penalty calculator">
        <p className="muted small">Penalty = Full penalty × (remaining months of minimum period ÷ minimum period months)</p>
        <div className="grid-form">
          <div className="field"><label htmlFor="pc-d">If worker leaves on</label><input id="pc-d" type="date" value={calcDate} onChange={(e) => setCalcDate(e.target.value)} /></div>
        </div>
        <div className="calc">
          <div><span>Served</span><strong>{pc.served.toFixed(1)} mo</strong></div>
          <div><span>Remaining of min. period</span><strong>{pc.remaining.toFixed(1)} mo</strong></div>
          <div><span>Formula</span><strong className="small">{rm(w.earlyPenalty)} × {pc.remaining.toFixed(1)} / {w.minContractMonths || 0}</strong></div>
          <div className="hl"><span>Penalty payable</span><strong>{rm(pc.penalty)}</strong></div>
        </div>
        {!w.minContractMonths && <p className="muted small">Set a minimum contract period and penalty via Edit worker → Contract & pay.</p>}
      </Card>
      {renew && (
        <FormModal title="Renew / extend contract" initial={{ contractStart: w.contractEnd || todayISO(), contractEnd: '' }} onClose={() => setRenew(false)}
          fields={[{ key: 'contractStart', label: 'New contract start', type: 'date' }, { key: 'contractEnd', label: 'New contract end', type: 'date', required: true }, { key: 'note', label: 'Remarks', type: 'textarea' }]}
          onSave={(v) => upd(w, (x) => {
            x.notes.push({ id: uid(), date: todayISO(), text: `Contract renewed: ${fmtDate(x.contractStart)}–${fmtDate(x.contractEnd)} → ${fmtDate(v.contractStart as string)}–${fmtDate(v.contractEnd as string)}${v.note ? '. ' + v.note : ''}` })
            x.contractStart = (v.contractStart as string) || x.contractStart
            x.contractEnd = v.contractEnd as string
          })} />
      )}
      {exit && <ExitModal w={w} s={s} onClose={() => setExit(false)} onDone={(mid) => nav(`/print/memo/${w.id}/${mid}`)} />}
    </>
  )
}

function ExitModal({ w, onClose, onDone }: P & { onClose: () => void; onDone: (memoId: string) => void }) {
  const [type, setType] = useState<WorkerStatus>('Resigned')
  const [date, setDate] = useState(todayISO())
  const [finalSalary, setFinal] = useState<number | undefined>(undefined)
  const [waive, setWaive] = useState(false)
  const [remarks, setRemarks] = useState('')
  const pc = proratedPenalty(w, date)
  const bal = outstanding(w)
  const penalty = waive || type === 'Contract Ended' ? 0 : pc.penalty
  const go = async () => {
    const memo: MemoRec = {
      id: uid(), kind: 'Exit Clearance', date: todayISO(), exitType: type, lastWorkingDay: date, checklist: defaultChecklist('Exit Clearance'),
      outstandingBalance: bal, finalSalary, penalty, notes: remarks,
    }
    await upd(w, (x) => {
      x.memos.push(memo)
      x.exitDate = date
      x.statusHistory.push({ id: uid(), date, from: x.status, to: type, remarks: remarks || `Exit processed. Penalty ${rm(penalty)}` })
      x.status = type
    })
    onDone(memo.id)
  }
  return (
    <Modal title="Process exit & clearance" onClose={onClose}>
      <div className="grid-form">
        <div className="field"><label htmlFor="ex-t">Exit type</label><select id="ex-t" value={type} onChange={(e) => setType(e.target.value as WorkerStatus)}>{EXIT_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
        <div className="field"><label htmlFor="ex-d">Last working day</label><input id="ex-d" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="field"><label htmlFor="ex-s">Final salary (RM, before deductions)</label><input id="ex-s" type="number" inputMode="decimal" value={finalSalary ?? ''} onChange={(e) => setFinal(e.target.value === '' ? undefined : Number(e.target.value))} /></div>
        <label className="check"><input type="checkbox" checked={waive} onChange={(e) => setWaive(e.target.checked)} /> <span>Waive penalty</span></label>
        <div className="field full"><label htmlFor="ex-r">Remarks</label><textarea id="ex-r" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>
      </div>
      <div className="calc">
        <div><span>Served of min. period</span><strong>{pc.served.toFixed(1)} / {w.minContractMonths || 0} mo</strong></div>
        <div><span>Prorated penalty</span><strong>{rm(penalty)}</strong></div>
        <div><span>Outstanding loan / advance</span><strong>{rm(bal)}</strong></div>
        <div className="hl"><span>Net payable to worker</span><strong>{finalSalary !== undefined ? rm(finalSalary - bal - penalty) : '—'}</strong></div>
      </div>
      <p className="muted small">This sets status to “{type}”, records exit date and creates a printable Exit Clearance memo with the checklist.</p>
      <div className="modal-actions"><span className="spacer" /><Btn onClick={onClose}>Cancel</Btn><Btn kind="danger" icon="exit" onClick={go}>Confirm exit & create memo</Btn></div>
    </Modal>
  )
}

/* ---------------- Pay ---------------- */
export function PayTab({ w }: P) {
  const outlets = useOutlets()
  const [inc, setInc] = useState<V | null>(null)
  const [al, setAl] = useState<V | null>(null)
  const incs = sortedIncrements(w)
  const basic = currentBasic(w)
  return (
    <>
      <Card title="Current pay">
        <div className="calc">
          <div><span>Basic</span><strong>{rm(basic)}</strong></div>
          <div><span>Allowances</span><strong>{rm(allowancesTotal(w))}</strong></div>
          <div className="hl"><span>Gross monthly</span><strong>{rm(basic + allowancesTotal(w))}</strong></div>
          <div><span>Starting basic</span><strong>{rm(w.initialBasicPay)}</strong></div>
        </div>
        <KV items={[['Bank', w.bankName], ['Account', w.bankAccount]]} />
      </Card>
      <Card title="Increment history" actions={<Btn kind="primary" small icon="plus" onClick={() => setInc({ date: todayISO(), oldPay: basic })}>Add increment</Btn>}>
        {incs.length === 0 ? <Empty title="No increments yet" /> : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Effective</th><th className="num">Old</th><th className="num">New</th><th className="num">Change</th><th>Reason</th><th /></tr></thead>
            <tbody>{incs.map((i) => (
              <tr key={i.id}><td><D d={i.date} /></td><td className="num">{rm(i.oldPay)}</td><td className="num">{rm(i.newPay)}</td>
                <td className="num">{rm(i.newPay - i.oldPay)} ({i.oldPay ? (((i.newPay - i.oldPay) / i.oldPay) * 100).toFixed(1) : '—'}%)</td><td>{i.reason || '—'}</td>
                <td><Btn small kind="ghost" icon="edit" title="Edit" onClick={() => setInc(i as unknown as V)} /></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      <Card title="Allowances" actions={<Btn small icon="plus" onClick={() => setAl({})}>Add</Btn>}>
        {w.allowances.length === 0 ? <p className="muted">None</p> : (
          <ul className="rows">{w.allowances.map((a) => <li key={a.id}><div className="r-main"><strong>{a.name}</strong></div><div className="r-act">{rm(a.amount)}<Btn small kind="ghost" icon="edit" title="Edit" onClick={() => setAl(a as unknown as V)} /></div></li>)}</ul>
        )}
      </Card>
      {inc && (
        <FormModal title={inc.id ? 'Edit increment' : 'Add increment'} initial={inc} onClose={() => setInc(null)}
          fields={[{ key: 'date', label: 'Effective date', type: 'date', required: true }, { key: 'oldPay', label: 'Old basic', type: 'money', required: true }, { key: 'newPay', label: 'New basic', type: 'money', required: true }, { key: 'reason', label: 'Reason', placeholder: 'Annual increment / promotion' }]}
          onDelete={inc.id ? () => upd(w, (x) => { x.increments = x.increments.filter((i) => i.id !== inc.id) }) : undefined}
          onSave={(v) => upd(w, (x) => {
            const rec = { ...(strip(v) as unknown as Worker['increments'][number]), id: (inc.id as string) || uid() }
            x.increments = inc.id ? x.increments.map((i) => (i.id === inc.id ? rec : i)) : [...x.increments, rec]
          })}>
          {(v) => v.newPay !== undefined && v.oldPay ? <p className="muted">Change: {rm(Number(v.newPay) - Number(v.oldPay))} ({(((Number(v.newPay) - Number(v.oldPay)) / Number(v.oldPay)) * 100).toFixed(1)}%)</p> : null}
        </FormModal>
      )}
      {al && (
        <FormModal title="Allowance" initial={al} onClose={() => setAl(null)} fields={[{ key: 'name', label: 'Name', required: true }, { key: 'amount', label: 'Amount per month', type: 'money', required: true }]}
          onDelete={al.id ? () => upd(w, (x) => { x.allowances = x.allowances.filter((a) => a.id !== al.id) }) : undefined}
          onSave={(v) => upd(w, (x) => {
            const rec = { ...(strip(v) as unknown as Worker['allowances'][number]), id: (al.id as string) || uid() }
            x.allowances = al.id ? x.allowances.map((a) => (a.id === al.id ? rec : a)) : [...x.allowances, rec]
          })} />
      )}
      <WorkerPayCompliance w={w} outlets={outlets} />
    </>
  )
}

/* ---------------- Loans ---------------- */
export function LoansTab({ w }: P) {
  const [loan, setLoan] = useState<V | null>(null)
  const [ded, setDed] = useState<V | null>(null)
  const ledger = loanLedger(w)
  const loanOpts = w.loans.map((l) => ({ value: l.id, label: `${l.type} ${fmtDate(l.date)} · ${rm(l.amount)} (bal ${rm(loanBalance(w, l.id))})` }))
  return (
    <>
      <Card title="Advances & loans" actions={<><Btn small icon="plus" onClick={() => setDed({ date: todayISO(), type: 'Loan repayment', loanId: w.loans.find((l) => loanBalance(w, l.id) > 0)?.id })}>Deduction</Btn><Btn kind="primary" small icon="plus" onClick={() => setLoan({ date: todayISO(), type: 'Advance' })}>Loan / advance</Btn></>}>
        <div className="calc">
          <div><span>Total given</span><strong>{rm(w.loans.reduce((a, l) => a + Number(l.amount || 0), 0))}</strong></div>
          <div><span>Total repaid</span><strong>{rm(w.deductions.filter((d) => d.loanId).reduce((a, d) => a + Number(d.amount || 0), 0))}</strong></div>
          <div className="hl"><span>Outstanding</span><strong>{rm(outstanding(w))}</strong></div>
        </div>
        {w.loans.length === 0 ? <Empty title="No loans or advances" /> : (
          <ul className="rows">
            {w.loans.map((l) => {
              const b = loanBalance(w, l.id)
              return (
                <li key={l.id}>
                  <div className="r-main"><strong>{l.type}: {rm(l.amount)}</strong><small><D d={l.date} /> · {l.purpose || '—'} · {l.monthlyDeduction ? `${rm(l.monthlyDeduction)}/month` : 'no schedule'}{b > 0 && l.monthlyDeduction ? ` · ~${Math.ceil(b / l.monthlyDeduction)} months left` : ''}</small></div>
                  <div className="r-act"><Chip tone={b > 0 ? 'amber' : 'green'}>{b > 0 ? `Bal ${rm(b)}` : 'Settled'}</Chip>
                    {b > 0 && <Btn small onClick={() => setDed({ date: todayISO(), type: 'Loan repayment', loanId: l.id, amount: Math.min(b, l.monthlyDeduction || b) })}>Deduct</Btn>}
                    <Btn small kind="ghost" icon="edit" title="Edit" onClick={() => setLoan(l as unknown as V)} /></div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
      <Card title="Ledger (running balance)">
        {ledger.length === 0 ? <p className="muted">No entries</p> : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Date</th><th>Type</th><th>Description</th><th className="num">Given</th><th className="num">Deducted</th><th className="num">Balance</th></tr></thead>
            <tbody>{ledger.map((r, i) => <tr key={i}><td><D d={r.date} /></td><td>{r.kind}</td><td>{r.desc}</td><td className="num">{r.debit ? rm(r.debit) : ''}</td><td className="num">{r.credit ? rm(r.credit) : ''}</td><td className="num"><strong>{rm(r.balance)}</strong></td></tr>)}</tbody>
          </table></div>
        )}
      </Card>
      <Card title="All deductions">
        {w.deductions.length === 0 ? <p className="muted">No deductions</p> : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Date</th><th>Type</th><th className="num">Amount</th><th>Against</th><th>Remarks</th><th /></tr></thead>
            <tbody>{[...w.deductions].sort((a, b) => b.date.localeCompare(a.date)).map((d) => (
              <tr key={d.id}><td><D d={d.date} /></td><td>{d.type}</td><td className="num">{rm(d.amount)}</td><td>{d.loanId ? (w.loans.find((l) => l.id === d.loanId)?.type || 'Loan') + ' ' + fmtDate(w.loans.find((l) => l.id === d.loanId)?.date) : '—'}</td><td>{d.remarks || '—'}</td>
                <td><Btn small kind="ghost" icon="edit" title="Edit" onClick={() => setDed(d as unknown as V)} /></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {loan && (
        <FormModal title={loan.id ? 'Edit loan / advance' : 'New loan / advance'} initial={loan} onClose={() => setLoan(null)}
          fields={[{ key: 'type', label: 'Type', type: 'select', options: LOAN_TYPES, required: true }, { key: 'date', label: 'Date', type: 'date', required: true }, { key: 'amount', label: 'Amount', type: 'money', required: true }, { key: 'monthlyDeduction', label: 'Monthly deduction', type: 'money' }, { key: 'purpose', label: 'Purpose', full: true }]}
          onDelete={loan.id ? () => upd(w, (x) => { x.loans = x.loans.filter((l) => l.id !== loan.id); x.deductions = x.deductions.map((d) => (d.loanId === loan.id ? { ...d, loanId: undefined } : d)) }) : undefined}
          onSave={(v) => upd(w, (x) => {
            const rec = { ...(strip(v) as unknown as Worker['loans'][number]), id: (loan.id as string) || uid() }
            x.loans = loan.id ? x.loans.map((l) => (l.id === loan.id ? rec : l)) : [...x.loans, rec]
          })} />
      )}
      {ded && (
        <FormModal title={ded.id ? 'Edit deduction' : 'Record deduction'} initial={ded} onClose={() => setDed(null)}
          fields={[{ key: 'date', label: 'Date', type: 'date', required: true }, { key: 'type', label: 'Type', type: 'select', options: DEDUCTION_TYPES, required: true }, { key: 'amount', label: 'Amount', type: 'money', required: true }, { key: 'loanId', label: 'Against loan / advance', type: 'select', options: loanOpts, hint: 'Linked deductions reduce the balance automatically' }, { key: 'remarks', label: 'Remarks', full: true }]}
          onDelete={ded.id ? () => upd(w, (x) => { x.deductions = x.deductions.filter((d) => d.id !== ded.id) }) : undefined}
          validate={(v) => { const b = v.loanId ? loanBalance(w, String(v.loanId)) + (ded.id && ded.loanId === v.loanId ? Number(ded.amount || 0) : 0) : Infinity; return Number(v.amount) > b + 0.001 ? `Amount exceeds balance (${rm(b)})` : null }}
          onSave={(v) => upd(w, (x) => {
            const rec = { ...(strip(v) as unknown as Worker['deductions'][number]), id: (ded.id as string) || uid() }
            x.deductions = ded.id ? x.deductions.map((d) => (d.id === ded.id ? rec : d)) : [...x.deductions, rec]
          })} />
      )}
    </>
  )
}

/* ---------------- Leave ---------------- */
export function LeaveTab({ w, s, openMemo }: P & { openMemo: (m: Partial<MemoRec>) => void }) {
  const [edit, setEdit] = useState<V | null>(null)
  const years = leaveBalances(w, s)
  const t = ticketInfo(w, s)
  const fields: FieldDef[] = [
    { key: 'type', label: 'Leave type', type: 'select', options: [...LEAVE_TYPES], required: true },
    { key: 'appliedOn', label: 'Applied on', type: 'date' },
    { key: 'from', label: 'From', type: 'date', required: true },
    { key: 'to', label: 'To', type: 'date', required: true },
    { key: 'days', label: 'Days', type: 'number', hint: 'Auto-calculated from dates; edit if needed' },
    { key: 'status', label: 'Approval', type: 'select', options: [...APPROVAL], required: true },
    { key: 'approvedBy', label: 'Approved / rejected by' },
    { key: 'remarks', label: 'Remarks', type: 'textarea' },
    { key: 'ticketProvided', label: 'Return flight ticket provided', type: 'checkbox', full: true },
    { key: 'ticketDetails', label: 'Ticket details (route, airline, PNR)', full: true, show: (v) => !!v.ticketProvided },
    { key: 'ticketCost', label: 'Ticket cost', type: 'money', show: (v) => !!v.ticketProvided },
    { key: 'ticketPaidBy', label: 'Paid by', type: 'select', options: TICKET_PAYERS, show: (v) => !!v.ticketProvided, hint: 'Company/Shared/Agent-paid home-leave tickets use up the entitlement' },
  ]
  const startLeave = async (l: LeaveRec) => {
    const to: WorkerStatus = l.type === 'Home Leave' ? 'Home Leave' : l.type === 'Medical' ? 'Medical Leave' : 'On Leave'
    await setStatus(w, to, l.from, `${l.type} ${fmtDate(l.from)}–${fmtDate(l.to)}`)
    if (!w.memos.some((m) => m.leaveId === l.id && m.kind === 'Home Leave Checkout')) openMemo({ kind: 'Home Leave Checkout', leaveId: l.id, expectedReturn: l.to, lastWorkingDay: l.from, ticketDetails: l.ticketDetails })
  }
  const returned = async (l: LeaveRec) => {
    await upd(w, (x) => {
      x.leaves = x.leaves.map((y) => (y.id === l.id ? { ...y, returned: true, returnedOn: todayISO() } : y))
      if (x.status !== 'Active-Working') { x.statusHistory.push({ id: uid(), date: todayISO(), from: x.status, to: 'Active-Working', remarks: `Returned from ${l.type}` }); x.status = 'Active-Working' }
    })
    openMemo({ kind: 'Return from Leave', leaveId: l.id })
  }
  return (
    <>
      <LeaveEntitlementCard w={w} />
      <div className="grid2">
        <Card title="✈ Return flight ticket">
          <div className="calc">
            <div><span>Rule</span><strong>1 ticket / {s.ticketEveryMonths} months</strong></div>
            <div><span>Earned</span><strong>{t.earned}</strong></div>
            <div><span>Used</span><strong>{t.used}</strong></div>
            <div className="hl"><span>Accumulated balance</span><strong>{t.balance} {t.balance ? `(${rm(t.value)})` : ''}</strong></div>
          </div>
          <p className="small">{t.eligible ? <Chip tone="purple">Eligible now</Chip> : <Chip>Not yet eligible</Chip>} Next ticket earned on <strong><D d={t.nextDate} /></strong>. Last company-paid trip: <D d={t.lastTrip} />.</p>
          <p className="muted small">If the worker doesn’t go home, entitlement keeps accumulating.</p>
        </Card>
        <Card title="Annual leave balance (with carry-forward)">
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Year</th><th className="num">B/F</th><th className="num">Entitled</th><th className="num">Taken</th><th className="num">Balance</th></tr></thead>
            <tbody>{years.map((y) => <tr key={y.year}><td>{y.year}</td><td className="num">{y.carryIn}</td><td className="num">{y.entitled}</td><td className="num">{y.used}</td><td className="num"><strong>{y.balance}</strong></td></tr>)}</tbody>
          </table></div>
          <p className="muted small">{w.annualLeaveDays ?? s.annualLeaveDays} days/year{s.maxCarryForward ? `, carry-forward capped at ${s.maxCarryForward}` : ', unused leave carries forward (no cap)'}. Joining year prorated.</p>
        </Card>
      </div>
      <Card title="Leave applications" actions={<Btn kind="primary" small icon="plus" onClick={() => setEdit({ type: 'Annual', status: 'Pending', appliedOn: todayISO(), from: todayISO(), to: todayISO(), days: 1 })}>Apply leave</Btn>}>
        {w.leaves.length === 0 ? <Empty title="No leave records" /> : (
          <ul className="rows">
            {[...w.leaves].sort((a, b) => b.from.localeCompare(a.from)).map((l) => {
              const ongoing = l.status === 'Approved' && !l.returned && l.from <= todayISO()
              const future = l.status === 'Approved' && l.from > todayISO()
              return (
                <li key={l.id}>
                  <div className="r-main">
                    <strong>{l.type} · {l.days} day(s)</strong>
                    <small><D d={l.from} /> → <D d={l.to} />{l.approvedBy ? ` · by ${l.approvedBy}` : ''}{l.returned ? ` · returned ${fmtDate(l.returnedOn)}` : ''}</small>
                    {l.ticketProvided && <small>✈ {l.ticketDetails || 'Ticket'} · {rm(l.ticketCost)} · paid by {l.ticketPaidBy || 'Company'}</small>}
                    {l.remarks && <small className="muted">{l.remarks}</small>}
                  </div>
                  <div className="r-act">
                    <Chip tone={l.status === 'Approved' ? 'green' : l.status === 'Rejected' ? 'red' : 'amber'}>{l.status}</Chip>
                    {l.status === 'Pending' && <><Btn small onClick={() => upd(w, (x) => { x.leaves = x.leaves.map((y) => (y.id === l.id ? { ...y, status: 'Approved' } : y)) })}>Approve</Btn><Btn small kind="ghost" onClick={() => upd(w, (x) => { x.leaves = x.leaves.map((y) => (y.id === l.id ? { ...y, status: 'Rejected' } : y)) })}>Reject</Btn></>}
                    {(future || (ongoing && w.status === 'Active-Working')) && <Btn small icon="plane" onClick={() => startLeave(l)}>Check out</Btn>}
                    {ongoing && w.status !== 'Active-Working' && <Btn small kind="primary" icon="check" onClick={() => returned(l)}>Returned</Btn>}
                    <Btn small kind="ghost" icon="edit" title="Edit" onClick={() => setEdit(l as unknown as V)} />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
      {edit && (
        <FormModal title={edit.id ? 'Edit leave' : 'Leave application'} fields={fields} initial={edit} onClose={() => setEdit(null)}
          validate={(v) => (String(v.to) < String(v.from) ? 'End date is before start date' : null)}
          onDelete={edit.id ? () => upd(w, (x) => { x.leaves = x.leaves.filter((l) => l.id !== edit.id) }) : undefined}
          onSave={(v) => upd(w, (x) => {
            const rec = { ...(strip(v) as unknown as LeaveRec), id: (edit.id as string) || uid(), days: Number(v.days) || daysBetweenInclusive(v.from as string, v.to as string) }
            x.leaves = edit.id ? x.leaves.map((l) => (l.id === edit.id ? rec : l)) : [...x.leaves, rec]
          })}>
          {(v, set) => <LeaveAutoDays v={v} set={set} bal={years.length ? years[years.length - 1].balance : 0} t={t.balance} />}
        </FormModal>
      )}
    </>
  )
}

function LeaveAutoDays({ v, set, bal, t }: { v: V; set: (p: V) => void; bal: number; t: number }) {
  const d = daysBetweenInclusive(v.from as string, v.to as string)
  return (
    <p className="muted small">
      {d > 0 && <>Calendar days: <strong>{d}</strong>{v.days !== d && <> · <button type="button" className="link" onClick={() => set({ days: d })}>use {d}</button></>} · </>}
      Annual balance now: <strong>{bal}</strong>{v.type === 'Home Leave' && <> · Ticket balance: <strong>{t}</strong></>}
    </p>
  )
}

/* ---------------- Memos ---------------- */
const MEMO_CAT: Record<MemoRec['kind'], string> = { 'Home Leave Checkout': 'Checkout memo', 'Return from Leave': 'Return memo', 'Exit Clearance': 'Exit clearance memo' }
/** Each save stores a PDF copy in the worker's document vault (new version of the same memo). Best effort: offline or local-only use just skips it. */
async function saveMemoToVault(w: Worker, m: MemoRec) {
  try {
    if (!navigator.onLine) return
    const [{ memoPdf }, { uploadDoc }, { db }, { supabase }] = await Promise.all([import('../lib/passport'), import('../lib/vault'), import('../lib/db'), import('../lib/supabase')])
    if (!(await supabase.auth.getSession()).data.session) return
    const outlets = await db.outlets.toArray()
    const s = await db.settings.get('app')
    const blob = await memoPdf(w, m, outlets, s?.companyName || 'Company')
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(m.id)
    await uploadDoc({ workerId: w.id, category: MEMO_CAT[m.kind], title: `${m.kind} memo ${m.date}`, issueDate: m.date, groupId: isUuid ? m.id : undefined, source: 'memo' }, { blob, name: `${m.kind.replace(/\s+/g, '-').toLowerCase()}-${w.workerNo}-${m.date}.pdf`, pages: 1 })
  } catch (e) { console.warn('Memo PDF not saved to vault', e) }
}

export function MemoEditor({ w, init, onClose }: { w: Worker; init: Partial<MemoRec>; onClose: () => void }) {
  const nav = useNavigate()
  const kind = init.kind || 'Home Leave Checkout'
  const [m, setM] = useState<MemoRec>({
    id: init.id || uid(), kind, date: init.date || todayISO(), checklist: init.checklist || defaultChecklist(kind),
    outstandingBalance: init.outstandingBalance ?? outstanding(w), ...init,
  } as MemoRec)
  const set = (p: Partial<MemoRec>) => setM({ ...m, ...p })
  const save = async (print: boolean) => {
    await upd(w, (x) => { x.memos = x.memos.some((y) => y.id === m.id) ? x.memos.map((y) => (y.id === m.id ? m : y)) : [...x.memos, m] })
    onClose()
    void saveMemoToVault(w, m)
    if (print) nav(`/print/memo/${w.id}/${m.id}`)
  }
  return (
    <Modal title={m.kind} onClose={onClose} wide>
      <div className="grid-form">
        <div className="field"><label htmlFor="m-d">Memo date</label><input id="m-d" type="date" value={m.date} onChange={(e) => set({ date: e.target.value })} /></div>
        <div className="field"><label htmlFor="m-l">{m.kind === 'Return from Leave' ? 'Reported back on' : 'Last working day'}</label><input id="m-l" type="date" value={m.lastWorkingDay || ''} onChange={(e) => set({ lastWorkingDay: e.target.value })} /></div>
        {m.kind === 'Home Leave Checkout' && <div className="field"><label htmlFor="m-r">Expected return</label><input id="m-r" type="date" value={m.expectedReturn || ''} onChange={(e) => set({ expectedReturn: e.target.value })} /></div>}
        <div className="field"><label htmlFor="m-o">Outstanding loan / advance (RM)</label><input id="m-o" type="number" value={m.outstandingBalance} onChange={(e) => set({ outstandingBalance: Number(e.target.value) })} /></div>
        {m.kind === 'Exit Clearance' && <>
          <div className="field"><label htmlFor="m-s">Final salary (RM)</label><input id="m-s" type="number" value={m.finalSalary ?? ''} onChange={(e) => set({ finalSalary: e.target.value === '' ? undefined : Number(e.target.value) })} /></div>
          <div className="field"><label htmlFor="m-p">Penalty (RM)</label><input id="m-p" type="number" value={m.penalty ?? ''} onChange={(e) => set({ penalty: e.target.value === '' ? undefined : Number(e.target.value) })} /></div>
        </>}
        <div className="field full"><label htmlFor="m-t">Flight ticket details</label><input id="m-t" value={m.ticketDetails || ''} onChange={(e) => set({ ticketDetails: e.target.value })} /></div>
      </div>
      <h4>Checklist</h4>
      <ul className="checklist">
        {m.checklist.map((c, i) => (
          <li key={i}>
            <label className="check"><input type="checkbox" checked={c.done} onChange={(e) => set({ checklist: m.checklist.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)) })} /> <span>{c.label}</span></label>
            <input className="cl-r" aria-label={`Remarks for ${c.label}`} placeholder="Remarks" value={c.remarks || ''} onChange={(e) => set({ checklist: m.checklist.map((x, j) => (j === i ? { ...x, remarks: e.target.value } : x)) })} />
          </li>
        ))}
      </ul>
      <Btn small icon="plus" onClick={() => { const l = prompt('Checklist item'); if (l) set({ checklist: [...m.checklist, { label: l, done: false }] }) }}>Add item</Btn>
      <div className="grid-form mt">
        <div className="field"><label htmlFor="s1">Worker name (signature)</label><input id="s1" value={m.workerSign ?? w.fullName} onChange={(e) => set({ workerSign: e.target.value })} /></div>
        <div className="field"><label htmlFor="s2">Manager</label><input id="s2" value={m.managerSign || ''} onChange={(e) => set({ managerSign: e.target.value })} /></div>
        <div className="field"><label htmlFor="s3">HR</label><input id="s3" value={m.hrSign || ''} onChange={(e) => set({ hrSign: e.target.value })} /></div>
        <div className="field full"><label htmlFor="s4">Notes</label><textarea id="s4" rows={2} value={m.notes || ''} onChange={(e) => set({ notes: e.target.value })} /></div>
      </div>
      <div className="modal-actions">
        <span className="small muted">{m.checklist.filter((c) => c.done).length}/{m.checklist.length} done</span>
        <span className="spacer" />
        <Btn onClick={() => save(false)}>Save</Btn>
        <Btn kind="primary" icon="print" onClick={() => save(true)}>Save & print</Btn>
      </div>
    </Modal>
  )
}

export function MemosTab({ w, openMemo }: P & { openMemo: (m: Partial<MemoRec>) => void }) {
  const nav = useNavigate()
  return (
    <Card title="Checkout / clearance memos" actions={<>
      <Btn small icon="plus" onClick={() => openMemo({ kind: 'Home Leave Checkout' })}>Leave checkout</Btn>
      <Btn small icon="plus" onClick={() => openMemo({ kind: 'Return from Leave' })}>Return memo</Btn>
      <Btn small icon="plus" onClick={() => openMemo({ kind: 'Exit Clearance', penalty: proratedPenalty(w, todayISO()).penalty })}>Exit clearance</Btn>
    </>}>
      {w.memos.length === 0 ? <Empty title="No memos yet"><p className="muted small">Memos are created automatically when you check out a leave or process an exit.</p></Empty> : (
        <ul className="rows">
          {[...w.memos].sort((a, b) => b.date.localeCompare(a.date)).map((m) => {
            const done = m.checklist.filter((c) => c.done).length
            return (
              <li key={m.id}>
                <div className="r-main"><strong>{m.kind}</strong><small><D d={m.date} />{m.exitType ? ` · ${m.exitType}` : ''} · {done}/{m.checklist.length} items cleared</small></div>
                <div className="r-act">
                  <Chip tone={done === m.checklist.length ? 'green' : 'amber'}>{done === m.checklist.length ? 'Cleared' : 'Pending'}</Chip>
                  <Btn small kind="ghost" icon="edit" title="Edit" onClick={() => openMemo(m)} />
                  <Btn small icon="print" onClick={() => nav(`/print/memo/${w.id}/${m.id}`)}>Print</Btn>
                  <Btn small kind="ghost" icon="trash" title="Delete" onClick={() => confirm('Delete memo?') && upd(w, (x) => { x.memos = x.memos.filter((y) => y.id !== m.id) })} />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

/* ---------------- Notes & timeline ---------------- */
export function NotesTab({ w }: P) {
  const [text, setText] = useState('')
  const items = [
    ...w.notes.map((n) => ({ id: n.id, date: n.date, kind: 'note' as const, text: n.text })),
    ...w.statusHistory.map((h) => ({ id: h.id, date: h.date, kind: 'status' as const, text: `${h.from ? h.from + ' → ' : ''}${h.to}${h.remarks ? ' · ' + h.remarks : ''}` })),
    ...w.leaves.map((l) => ({ id: 'l' + l.id, date: l.from, kind: 'leave' as const, text: `${l.type} leave ${fmtDate(l.from)}–${fmtDate(l.to)} (${l.status})` })),
    ...w.increments.map((i) => ({ id: 'i' + i.id, date: i.date, kind: 'pay' as const, text: `Basic ${rm(i.oldPay)} → ${rm(i.newPay)}` })),
    ...w.memos.map((m) => ({ id: 'm' + m.id, date: m.date, kind: 'memo' as const, text: m.kind })),
  ].sort((a, b) => b.date.localeCompare(a.date))
  return (
    <Card title="Notes & timeline">
      <form className="row gap-s" onSubmit={(e) => { e.preventDefault(); if (!text.trim()) return; upd(w, (x) => { x.notes.push({ id: uid(), date: todayISO(), text: text.trim() }) }); setText('') }}>
        <input className="grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note…" aria-label="New note" />
        <Btn kind="primary" type="submit" icon="plus">Add</Btn>
      </form>
      <ul className="timeline">
        {items.map((i) => (
          <li key={i.id} className={`tl-${i.kind}`}>
            <span className="tl-d"><D d={i.date} /></span>
            <span className="tl-t"><Chip>{i.kind}</Chip> {i.text}</span>
            {i.kind === 'note' && <button className="link small" onClick={() => confirm('Delete note?') && upd(w, (x) => { x.notes = x.notes.filter((n) => n.id !== i.id) })}>delete</button>}
          </li>
        ))}
      </ul>
    </Card>
  )
}
