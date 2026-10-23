import { printPage } from '../lib/platform'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { db } from '../lib/db'
import { LogoImg } from '../components/logos'
import { outletLogo } from '../lib/logos'
import { currentBasic, latestDoc, leaveBalanceNow, minContractEnd, outletName, ticketInfo } from '../lib/calc'
import { useOutlets, useSettings } from '../lib/hooks'
import { fmtDate, rm, serviceText } from '../lib/util'

export default function MemoPrint() {
  const { wid, mid } = useParams()
  const w = useLiveQuery(() => db.workers.get(wid || ''), [wid])
  const s = useSettings()
  const outlets = useOutlets()
  const nav = useNavigate()
  useEffect(() => { document.title = 'Memo — Foreign Worker Manager' }, [])
  if (w === undefined) return <p>Loading…</p>
  const m = w?.memos.find((x) => x.id === mid)
  if (!w || !m) return <p>Memo not found. <button onClick={() => nav('/')}>Home</button></p>
  const pp = latestDoc(w, 'Passport')
  const vp = latestDoc(w, 'Work Permit / PLKS (VP(TE))')
  const fm = latestDoc(w, 'FOMEMA Medical')
  const t = ticketInfo(w, s)
  const leave = w.leaves.find((l) => l.id === m.leaveId)
  const net = (m.finalSalary ?? 0) - (m.outstandingBalance || 0) - (m.penalty || 0)
  return (
    <div className="print-wrap">
      <div className="no-print print-bar">
        <button className="btn btn-secondary" onClick={() => nav(`/workers/${w.id}`)}>← Back</button>
        <button className="btn btn-primary" onClick={() => printPage()}>🖨 Print / Save PDF</button>
      </div>
      <article className="memo">
        <header className="memo-h">
          <div className="row gap-s"><LogoImg path={outletLogo(outlets.find((o) => o.id === w.outletId))} size={48} fallback={false} /><div><h1>{s.companyName}</h1><p>{outletName(outlets, w.outletId)} · {w.businessType || ''}</p></div></div>
          <div className="memo-k"><h2>{m.kind.toUpperCase()} MEMO</h2><p>Date: {fmtDate(m.date)}</p><p>Ref: {w.workerNo}-{m.id.slice(0, 6).toUpperCase()}</p></div>
        </header>
        <table className="memo-t">
          <tbody>
            <tr><th>Name</th><td>{w.fullName}</td><th>Worker ID</th><td>{w.workerNo}</td></tr>
            <tr><th>Nationality</th><td>{w.nationality}</td><th>Position</th><td>{w.jobCategory || '—'} ({w.skillLevel || '—'})</td></tr>
            <tr><th>Passport no.</th><td>{pp?.number || '—'} (exp {fmtDate(pp?.expiryDate)})</td><th>Permit (PLKS)</th><td>{vp?.number || '—'} (exp {fmtDate(vp?.expiryDate)})</td></tr>
            <tr><th>FOMEMA</th><td>exp {fmtDate(fm?.expiryDate)}</td><th>Join date / service</th><td>{fmtDate(w.joinDate)} · {serviceText(w.joinDate, m.lastWorkingDay)}</td></tr>
            {m.kind === 'Exit Clearance' && <tr><th>Exit type</th><td>{m.exitType || w.status}</td><th>Last working day</th><td>{fmtDate(m.lastWorkingDay)}</td></tr>}
            {m.kind === 'Exit Clearance' && <tr><th>Minimum contract</th><td>{w.minContractMonths || 0} months (until {fmtDate(minContractEnd(w))})</td><th>Basic pay</th><td>{rm(currentBasic(w))}</td></tr>}
            {m.kind !== 'Exit Clearance' && <tr><th>{m.kind === 'Return from Leave' ? 'Reported back' : 'Last working day'}</th><td>{fmtDate(m.lastWorkingDay)}</td><th>{m.kind === 'Return from Leave' ? 'Leave period' : 'Expected return'}</th><td>{m.kind === 'Return from Leave' ? (leave ? `${fmtDate(leave.from)} – ${fmtDate(leave.to)}` : '—') : fmtDate(m.expectedReturn)}</td></tr>}
            {m.kind !== 'Exit Clearance' && <tr><th>Leave</th><td>{leave ? `${leave.type} · ${leave.days} day(s)` : '—'}</td><th>Annual leave balance</th><td>{leaveBalanceNow(w, s)} days</td></tr>}
            <tr><th>Flight ticket</th><td colSpan={3}>{m.ticketDetails || leave?.ticketDetails || '—'} {leave?.ticketProvided ? `(${rm(leave.ticketCost)}, paid by ${leave.ticketPaidBy || 'Company'})` : ''} · Entitlement balance: {t.balance}</td></tr>
            <tr><th>Next of kin</th><td colSpan={3}>{w.family.filter((f) => f.isNextOfKin || f.isEmergency).map((f) => `${f.name} (${f.relation}) ${f.phone || ''}`).join('; ') || '—'}</td></tr>
          </tbody>
        </table>
        <h3>Clearance checklist</h3>
        <table className="memo-c">
          <thead><tr><th>#</th><th>Item</th><th>Done</th><th>Remarks</th></tr></thead>
          <tbody>{m.checklist.map((c, i) => <tr key={i}><td>{i + 1}</td><td>{c.label}</td><td className="ctr">{c.done ? '☑' : '☐'}</td><td>{c.remarks || ''}</td></tr>)}</tbody>
        </table>
        <h3>Financial summary</h3>
        <table className="memo-t">
          <tbody>
            {m.kind === 'Exit Clearance' && <tr><th>Final salary</th><td className="num">{m.finalSalary !== undefined ? rm(m.finalSalary) : '__________'}</td></tr>}
            <tr><th>Less: outstanding loan / advance</th><td className="num">{rm(m.outstandingBalance)}</td></tr>
            {m.kind === 'Exit Clearance' && <tr><th>Less: prorated early-termination penalty</th><td className="num">{rm(m.penalty)}</td></tr>}
            {m.kind === 'Exit Clearance' && <tr className="tot"><th>Net payable to worker</th><td className="num">{m.finalSalary !== undefined ? rm(net) : '__________'}</td></tr>}
          </tbody>
        </table>
        {m.notes && <p><strong>Notes:</strong> {m.notes}</p>}
        <p className="small">I, the undersigned, confirm the above details are correct and all items have been cleared/handed over as indicated.</p>
        <div className="signs">
          {[['Worker', m.workerSign ?? w.fullName], ['Manager / Supervisor', m.managerSign], ['HR / Admin', m.hrSign]].map(([k, v]) => (
            <div key={k}><div className="sline" /><strong>{k}</strong><span>{v || 'Name:'}</span><span>Date:</span></div>
          ))}
        </div>
        <footer className="memo-f">Generated by Foreign Worker Manager · {fmtDate(new Date().toISOString().slice(0, 10))}</footer>
      </article>
    </div>
  )
}
