/* Pay & contribution compliance UI: worker pay checks, payslip helper, OT calculator, statutory leave,
 * and the editable Pay & Leave rules (rates with effective dates, public holidays per year/state). */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Btn, Card, Chip, Empty, Field, FormGrid, FormModal, KV, Modal, type FieldDef } from './ui'
import { updateWorker } from '../lib/db'
import { useAuth } from '../lib/auth'
import { savePayConfig, useConfig } from '../lib/config'
import { allowancesTotal, currentBasic } from '../lib/calc'
import {
  BUILTIN_HOLIDAYS, DEFAULT_RATES, REST_DAYS, STATES, computePayslip, holidaysFor, hostelCertValid, monthLabel, otQuick, prevMonth, rateAt, replacementDay, statutoryLeave,
  type Dated, type Holiday, type HolidaysConfig, type PayResult, type PayslipRec, type RatesConfig,
} from '../lib/pay'
import type { Outlet, Worker } from '../lib/types'
import { addDays, fmtDate, parseISO, rm, todayISO, uid } from '../lib/util'

type V = Record<string, unknown>
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const CHECK = 'check with JTKSM or your agent'

function Warnings({ r }: { r: PayResult }) {
  if (!r.warnings.length) return <p className="pay-ok">✓ No pay-rule problems found for this month.</p>
  return (
    <ul className="pay-warn">
      {r.warnings.map((x, i) => <li key={i} className={`pw-${x.level}`}><span aria-hidden>{x.level === 'red' ? '⛔' : x.level === 'amber' ? '⚠️' : 'ℹ️'}</span><div>{x.text}<small>{x.source}</small></div></li>)}
    </ul>
  )
}

function ResultTable({ r }: { r: PayResult }) {
  const row = (k: string, v: number, cls = '') => v ? <tr className={cls}><td>{k}</td><td className="num">{rm(v)}</td></tr> : null
  return (
    <table className="tbl pay-res">
      <tbody>
        <tr><td>Basic earned{r.unpaid ? ` (after ${rm(r.unpaid)} unpaid leave)` : ''}</td><td className="num">{rm(r.basicEarned)}</td></tr>
        {row('Overtime — normal day', r.otNormal)}{row('Rest day worked', r.restDay)}{row('Overtime — rest day', r.restOt)}{row('Public holiday worked', r.phDay)}{row('Overtime — public holiday', r.phOt)}
        <tr className="tot"><td>Gross wages</td><td className="num">{rm(r.gross)}</td></tr>
        {row('EPF — worker 2%', -r.epfEe)}{row('PERKESO — worker (estimate)', -r.socsoEe)}{row('LINDUNG 24 Jam — worker', -r.lindung)}{row('Other deductions', -r.otherDeductions)}
        <tr className="tot"><td>Net pay</td><td className="num">{rm(r.net)}</td></tr>
        <tr><td className="muted">EPF — employer</td><td className="num muted">{rm(r.epfEr)}</td></tr>
        <tr><td className="muted">PERKESO — employer (estimate)</td><td className="num muted">{rm(r.socsoEr)}</td></tr>
        <tr><td className="muted">Total cost to employer</td><td className="num muted">{rm(r.employerCost)}</td></tr>
      </tbody>
    </table>
  )
}

/* ---------------- Worker → Pay tab additions ---------------- */
export function WorkerPayCompliance({ w, outlets }: { w: Worker; outlets: Outlet[] }) {
  const cfg = useConfig()
  const { canSeeSalary } = useAuth()
  const [exempt, setExempt] = useState<V | null>(null)
  const [hostel, setHostel] = useState<V | null>(null)
  const [slip, setSlip] = useState<PayslipRec | null>(null)
  const nav = useNavigate()
  if (!canSeeSalary) return <Card title="Pay compliance"><p className="muted">Pay checks and payslips are only shown to people allowed to see pay.</p></Card>
  const rates = cfg.rates
  const today = todayISO()
  const basic = currentBasic(w)
  const mw = rateAt(rates.minWage, today)
  const outlet = outlets.find((o) => o.id === w.outletId)
  const est = computePayslip({ id: 'est', month: today.slice(0, 7), basic, allowances: allowancesTotal(w), hostel: w.hostelDeduction?.amount, payDate: today, state: outlet?.state }, rates, w, today)
  const cap = rateAt(rates.hostelCap, today)
  const hd = w.hostelDeduction || {}
  const slips = [...(w.payslips || [])].sort((a, b) => b.month.localeCompare(a.month))
  const newSlip = () => {
    const m = prevMonth(today)
    const ex = slips.find((p) => p.month === m)
    setSlip(ex || { id: uid(), month: m, basic, allowances: allowancesTotal(w), hostel: hd.amount, epfOn: true, socsoOn: true, lindungOn: true, state: outlet?.state })
  }
  return (
    <>
      <Card title="Pay compliance">
        <div className="calc">
          <div className={mw && basic < mw.monthly && !w.minWageExempt ? 'pay-bad' : ''}><span>Minimum wage now</span><strong>{mw ? rm(mw.monthly) : '—'}</strong><small className="muted">{mw ? `${rm(mw.hourly)}/hour · from ${fmtDate(mw.from)}` : ''}</small></div>
          <div><span>This worker’s basic</span><strong>{rm(basic)}</strong>
            <small>{w.minWageExempt ? <Chip tone="gray">Exempt</Chip> : mw && basic > 0 && basic < mw.monthly ? <Chip tone="red">Below minimum</Chip> : basic > 0 ? <Chip tone="green">OK</Chip> : <Chip tone="gray">Not set</Chip>}</small></div>
          <div><span>EPF (worker + employer)</span><strong>{rm(est.epfEe)} + {rm(est.epfEr)}</strong><small className="muted">2% each, rounded up</small></div>
          <div><span>PERKESO (worker + employer)</span><strong>{rm(est.socsoEe)} + {rm(est.socsoEr)}</strong><small className="muted">estimate — use PERKESO’s table</small></div>
          {est.lindung > 0 && <div><span>LINDUNG 24 Jam (worker)</span><strong>{rm(est.lindung)}</strong><small className="muted">{rateAt(rates.lindung, today)?.employee}% of wages</small></div>}
        </div>
        <div className="row gap-s wrap">
          <Btn small icon="edit" onClick={() => setExempt({ minWageExempt: !!w.minWageExempt, minWageExemptReason: w.minWageExemptReason || '' })}>Minimum-wage exemption</Btn>
          <Btn small icon="edit" onClick={() => setHostel({ ...hd })}>Hostel deduction set-up</Btn>
        </div>
        {(hd.amount || 0) > 0 && (
          <div className="pay-hostel">
            <h4>Accommodation (hostel) deduction</h4>
            {outlet?.state && ['Sabah', 'Sarawak'].includes(outlet.state) ? <p className="muted small">Act 446 deduction limits apply in Peninsular Malaysia and Labuan. For {outlet.state}, {CHECK}.</p> : null}
            <KV items={[
              ['Monthly deduction', <>{rm(hd.amount)} {cap && (hd.amount || 0) > cap.amount ? <Chip tone="red">over {rm(cap.amount)} limit</Chip> : null}</>],
              ['Certificate for Accommodation', hostelCertValid(w, today) ? <Chip tone="green">On file</Chip> : <Chip tone="amber">Not on file</Chip>],
              ['Worker’s written request', hd.writtenRequest ? <Chip tone="green">Yes{hd.requestDate ? ` · ${fmtDate(hd.requestDate)}` : ''}</Chip> : <Chip tone="amber">Not recorded</Chip>],
              ['Director General approval', hd.dgApproval ? <Chip tone="green">Yes{hd.approvalRef ? ` · ${hd.approvalRef}` : ''}</Chip> : <Chip tone="amber">Not recorded</Chip>],
              ['Contract', hd.freeInContract ? <Chip tone="red">Says free — no deduction allowed</Chip> : hd.contractAmount ? rm(hd.contractAmount) : '—'],
            ]} />
          </div>
        )}
      </Card>
      <Card title="Payslips" actions={<Btn kind="primary" small icon="plus" onClick={newSlip}>New payslip</Btn>}>
        {slips.length === 0 ? <Empty title="No payslips yet">Use the payslip helper to work out overtime, EPF, PERKESO and LINDUNG, and to check the pay rules.</Empty> : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Month</th><th className="num">Gross</th><th className="num">Net</th><th>Paid on</th><th>Checks</th><th /></tr></thead>
            <tbody>{slips.map((p) => {
              const r = computePayslip(p, rates, w, today)
              const red = r.warnings.filter((x) => x.level === 'red').length
              const amber = r.warnings.filter((x) => x.level === 'amber').length
              return (
                <tr key={p.id}><td>{monthLabel(p.month)}</td><td className="num">{rm(r.gross)}</td><td className="num">{rm(r.net)}</td><td>{p.payDate ? fmtDate(p.payDate) : <span className="muted">not paid</span>}</td>
                  <td>{red ? <Chip tone="red">{red} problem{red > 1 ? 's' : ''}</Chip> : amber ? <Chip tone="amber">{amber} to check</Chip> : <Chip tone="green">OK</Chip>}</td>
                  <td className="nowrap"><Btn small kind="ghost" icon="edit" title="Open" onClick={() => setSlip(p)} /><Btn small kind="ghost" icon="print" title="Print" onClick={() => nav(`/print/payslip/${w.id}/${p.id}`)} /></td></tr>
              )
            })}</tbody>
          </table></div>
        )}
      </Card>
      {exempt && (
        <FormModal title="Minimum-wage exemption" initial={exempt} onClose={() => setExempt(null)}
          fields={[{ key: 'minWageExempt', label: 'This worker is not covered by the minimum wage (switch off the check)', type: 'checkbox', full: true }, { key: 'minWageExemptReason', label: 'Reason', full: true, show: (v) => !!v.minWageExempt, required: true, placeholder: 'e.g. domestic servant' }]}
          onSave={(v) => updateWorker(w.id, (x) => { x.minWageExempt = !!v.minWageExempt || undefined; x.minWageExemptReason = v.minWageExempt ? String(v.minWageExemptReason || '') : undefined })}>
          {() => <p className="muted small">The Minimum Wages Order covers almost every worker. Domestic servants are excluded. Switch this off only if you are sure — {CHECK}.</p>}
        </FormModal>
      )}
      {hostel && (
        <FormModal title="Hostel / accommodation deduction" initial={hostel} onClose={() => setHostel(null)}
          fields={[
            { key: 'amount', label: 'Monthly deduction', type: 'money', hint: cap ? `Limit now ${rm(cap.amount)} a month (Peninsular Malaysia & Labuan)` : undefined },
            { key: 'contractAmount', label: 'Amount written in the contract', type: 'money' },
            { key: 'freeInContract', label: 'The contract says accommodation is free', type: 'checkbox', full: true },
            { key: 'writtenRequest', label: 'Worker asked in writing for the deduction', type: 'checkbox', full: true },
            { key: 'requestDate', label: 'Date of the written request', type: 'date', show: (v) => !!v.writtenRequest },
            { key: 'dgApproval', label: 'Director General (JTKSM) approval received', type: 'checkbox', full: true },
            { key: 'approvalRef', label: 'Approval reference', show: (v) => !!v.dgApproval },
          ]}
          onSave={(v) => updateWorker(w.id, (x) => { x.hostelDeduction = { amount: n(v.amount) || undefined, contractAmount: n(v.contractAmount) || undefined, freeInContract: !!v.freeInContract, writtenRequest: !!v.writtenRequest, requestDate: (v.requestDate as string) || undefined, dgApproval: !!v.dgApproval, approvalRef: (v.approvalRef as string) || undefined } })}>
          {() => <p className="muted small">A deduction for accommodation needs a valid Certificate for Accommodation (upload it under Expiry docs as “Hostel / Accommodation”), the worker’s written request and approval, and can never be more than the contract amount. Rules: Act 446 and Employment Act s.24 — {CHECK}.</p>}
        </FormModal>
      )}
      {slip && <PayslipModal w={w} initial={slip} rates={rates} state={outlet?.state} onClose={() => setSlip(null)} />}
    </>
  )
}

function monthOptions() {
  const out: { value: string; label: string }[] = []
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + 1)
  for (let i = 0; i < 15; i++) { d.setMonth(d.getMonth() - 1); const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; out.push({ value: m, label: monthLabel(m) }) }
  return out
}

export function PayslipModal({ w, initial, rates, state, onClose }: { w: Worker; initial: PayslipRec; rates: RatesConfig; state?: string; onClose: () => void }) {
  const { profile } = useAuth()
  const [v, setV] = useState<V>(initial as unknown as V)
  const [err, setErr] = useState<string | null>(null)
  const exists = (w.payslips || []).some((p) => p.id === initial.id)
  const rec = useMemo((): PayslipRec => ({ ...(v as unknown as PayslipRec), state: (v.state as string) || state }), [v, state])
  const r = computePayslip(rec, rates, w)
  const ot = rateAt(rates.ot, `${rec.month}-28`) || DEFAULT_RATES.ot[0]
  const F = (fields: FieldDef[]) => <FormGrid fields={fields} value={v} onChange={setV} />
  const save = async () => {
    if (!rec.month) return setErr('Choose the month')
    if ((w.payslips || []).some((p) => p.month === rec.month && p.id !== rec.id)) return setErr(`There is already a payslip for ${monthLabel(rec.month)}`)
    const clean: PayslipRec = { id: rec.id, month: rec.month, basic: n(rec.basic), savedAt: new Date().toISOString(), savedBy: profile?.full_name || profile?.email || undefined, state: rec.state }
    for (const k of ['unpaidDays', 'allowances', 'otherEarnings', 'otNormalH', 'restHalfDays', 'restFullDays', 'otRestH', 'phDays', 'otPhH', 'hostel', 'advance', 'loanRepay', 'otherDeductions'] as const) if (n(rec[k])) clean[k] = n(rec[k])
    for (const k of ['epfOn', 'socsoOn', 'lindungOn'] as const) clean[k] = rec[k] !== false
    if (rec.payDate) clean.payDate = rec.payDate
    if (rec.otPayDate) clean.otPayDate = rec.otPayDate
    if (rec.notes) clean.notes = rec.notes
    await updateWorker(w.id, (x) => { x.payslips = [...(x.payslips || []).filter((p) => p.id !== clean.id), clean] })
    onClose()
  }
  const del = async () => { if (!confirm('Delete this payslip?')) return; await updateWorker(w.id, (x) => { x.payslips = (x.payslips || []).filter((p) => p.id !== initial.id) }); onClose() }
  return (
    <Modal wide title={`Payslip helper — ${w.fullName}`} onClose={onClose}
      footer={<>{exists && <Btn kind="danger" icon="trash" onClick={del}>Delete</Btn>}<span className="spacer" /><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" icon="check" onClick={save}>Save payslip</Btn></>}>
      <div className="pay-grid">
        <div>
          {F([{ key: 'month', label: 'Wage month', type: 'select', options: monthOptions(), required: true }, { key: 'payDate', label: 'Date wages paid', type: 'date', hint: `Due by ${fmtDate(r.wageDue)}` }])}
          <h4>Earnings</h4>
          {F([{ key: 'basic', label: 'Basic pay (full month)', type: 'money' }, { key: 'unpaidDays', label: 'Unpaid leave days', type: 'number' }, { key: 'allowances', label: 'Fixed allowances', type: 'money' }, { key: 'otherEarnings', label: 'Other earnings (incentive, commission)', type: 'money' }])}
          <h4>Overtime & rest days <small className="muted">hourly rate {rm(r.orpHourly)} · daily {rm(r.orpDaily)}</small></h4>
          {F([
            { key: 'otNormalH', label: `OT hours — normal days (×${ot.normal})`, type: 'number' },
            { key: 'restHalfDays', label: 'Rest days worked — up to half day', type: 'number', hint: 'Paid ½ day’s pay each' },
            { key: 'restFullDays', label: 'Rest days worked — more than half day', type: 'number', hint: 'Paid 1 day’s pay each' },
            { key: 'otRestH', label: `OT hours on rest days (×${ot.restOt})`, type: 'number' },
            { key: 'phDays', label: 'Public holidays worked', type: 'number', hint: `Paid ${ot.phDayExtra} extra days’ pay each` },
            { key: 'otPhH', label: `OT hours on public holidays (×${ot.phOt})`, type: 'number' },
            { key: 'otPayDate', label: 'Date OT / holiday pay paid (if different)', type: 'date', hint: `Due by ${fmtDate(r.otDue)}` },
          ])}
          <h4>Deductions</h4>
          {F([{ key: 'hostel', label: 'Hostel / accommodation', type: 'money' }, { key: 'advance', label: 'Salary advance', type: 'money' }, { key: 'loanRepay', label: 'Loan repayment', type: 'money' }, { key: 'otherDeductions', label: 'Other deductions', type: 'money' }])}
          <div className="row gap-s wrap pay-toggles">
            {(['epfOn', 'socsoOn', 'lindungOn'] as const).map((k) => (
              <Field key={k} def={{ key: k, label: k === 'epfOn' ? 'EPF' : k === 'socsoOn' ? 'PERKESO' : 'LINDUNG 24 Jam', type: 'checkbox' }} value={v[k] !== false} onChange={(x) => setV({ ...v, [k]: x })} />
            ))}
          </div>
          {F([{ key: 'state', label: 'State (for Act 446 scope)', type: 'select', options: [...STATES] }, { key: 'notes', label: 'Notes', type: 'textarea' }])}
        </div>
        <div className="pay-side">
          <ResultTable r={r} />
          <h4>Checks</h4>
          <Warnings r={r} />
          <p className="muted small">OT {r.otHours} h of {ot.capHours} h allowed. EPF wages exclude overtime ({rm(r.epfWages)}); PERKESO and LINDUNG use gross wages up to the ceiling. PERKESO figures are estimates — the exact amount comes from PERKESO’s contribution table. Rules can be changed in Settings → Pay &amp; Leave rules.</p>
          {err && <p className="err" role="alert">{err}</p>}
        </div>
      </div>
    </Modal>
  )
}

/* ---------------- OT calculator ---------------- */
export function OtCalculator() {
  const cfg = useConfig()
  const [v, setV] = useState<V>({ basic: rateAt(cfg.rates.minWage, todayISO())?.monthly || 1700, normal: 0, rest: 0, ph: 0 })
  const q = otQuick(n(v.basic), { normal: n(v.normal), rest: n(v.rest), ph: n(v.ph) }, cfg.rates)
  return (
    <Card title="⏱️ Overtime calculator">
      <FormGrid value={v} onChange={setV} fields={[{ key: 'basic', label: 'Monthly basic pay', type: 'money' }, { key: 'normal', label: `OT hours — normal days (×${q.rule.normal})`, type: 'number' }, { key: 'rest', label: `OT hours — rest days (×${q.rule.restOt})`, type: 'number' }, { key: 'ph', label: `OT hours — public holidays (×${q.rule.phOt})`, type: 'number' }]} />
      <div className="calc">
        <div><span>Daily rate (÷{q.rule.daysPerMonth})</span><strong>{rm(q.daily)}</strong></div>
        <div><span>Hourly rate (÷{q.rule.hoursPerDay})</span><strong>{rm(q.hourly)}</strong></div>
        <div className="hl"><span>Overtime pay</span><strong>{rm(q.pay)}</strong></div>
        <div className={q.over ? 'pay-bad' : ''}><span>OT hours this month</span><strong>{q.hours} / {q.cap}</strong></div>
      </div>
      {q.over && <p className="callout warn">⛔ More than {q.cap} overtime hours in a month is not allowed (Employment (Limitation of Overtime Work) Regulations 1980).</p>}
      <p className="muted small">For monthly-paid workers: daily rate = monthly pay ÷ {q.rule.daysPerMonth}; hourly rate = daily rate ÷ {q.rule.hoursPerDay} normal hours. Employment Act s.60 &amp; s.60A — {CHECK}.</p>
    </Card>
  )
}

/* ---------------- Leave entitlement by service ---------------- */
export function LeaveEntitlementCard({ w }: { w: Worker }) {
  const cfg = useConfig()
  const st = statutoryLeave(w.joinDate, cfg.rates)
  const set = w.annualLeaveDays
  return (
    <Card title="📏 Leave by law (Employment Act)">
      <div className="calc">
        <div><span>Service</span><strong>{st.years} year{st.years === 1 ? '' : 's'}</strong></div>
        <div className={set !== undefined && set < st.annual ? 'pay-bad' : 'hl'}><span>Annual leave</span><strong>{st.annual} days</strong>{set !== undefined && <small>{set < st.annual ? `Set to ${set} — the app uses ${st.annual}` : `Set to ${set}`}</small>}</div>
        <div><span>Sick leave</span><strong>{st.sick} days</strong><small className="muted">+ up to {st.hospital} days if hospitalised</small></div>
        <div><span>Maternity</span><strong>{st.maternity} days</strong></div>
        <div><span>Paternity</span><strong>{st.paternity} days</strong><small className="muted">{st.paternityEligible ? 'married, 12+ months’ service' : 'needs 12 months’ service'}</small></div>
      </div>
      <p className="muted small">Annual: {cfg.rates.leave.tiers.map((t) => `${t.annual} days from ${t.minYears} yrs`).join(' · ')}. Sick: {cfg.rates.leave.tiers.map((t) => t.sick).join(' / ')} days. Employment Act s.60E, s.60F, s.37, s.60FA — {CHECK}.</p>
    </Card>
  )
}

/* ---------------- Settings → Pay & Leave rules ---------------- */
type Col = { key: string; label: string; type?: 'number' | 'text' | 'date'; suffix?: string }
function DatedTable<T extends Dated>({ title, help, rows, cols, canEdit, onSave }: { title: string; help?: string; rows: T[]; cols: Col[]; canEdit: boolean; onSave: (rows: T[]) => Promise<void> }) {
  const [edit, setEdit] = useState<{ v: V; idx: number } | null>(null)
  const sorted = [...rows].sort((a, b) => a.from.localeCompare(b.from))
  const now = rateAt(rows, todayISO())
  const fields: FieldDef[] = [{ key: 'from', label: 'Effective from', type: 'date', required: true }, ...cols.map((c) => ({ key: c.key, label: c.label + (c.suffix ? ` (${c.suffix})` : ''), type: (c.type || 'number') as FieldDef['type'], required: c.type !== 'text' })), { key: 'note', label: 'Note / source', full: true }]
  return (
    <Card title={title} actions={canEdit ? <Btn small icon="plus" onClick={() => setEdit({ v: { ...(sorted[sorted.length - 1] || {}), from: todayISO() } as unknown as V, idx: -1 })}>New rate from a date</Btn> : undefined}>
      {help && <p className="muted small">{help}</p>}
      <div className="tbl-wrap"><table className="tbl">
        <thead><tr><th>From</th>{cols.map((c) => <th key={c.key} className="num">{c.label}</th>)}<th>Note</th>{canEdit && <th />}</tr></thead>
        <tbody>{sorted.map((r) => {
          const idx = rows.indexOf(r)
          return (
            <tr key={r.from + idx} className={r === now ? 'pay-now' : ''}>
              <td className="nowrap">{fmtDate(r.from)} {r === now ? <Chip tone="green">now</Chip> : r.from > todayISO() ? <Chip tone="blue">future</Chip> : null}</td>
              {cols.map((c) => <td key={c.key} className="num">{String((r as unknown as V)[c.key] ?? '—')}{c.suffix && (r as unknown as V)[c.key] !== undefined ? c.suffix.startsWith('%') ? '%' : '' : ''}</td>)}
              <td className="small muted">{r.note || ''}</td>
              {canEdit && <td><Btn small kind="ghost" icon="edit" title="Edit" onClick={() => setEdit({ v: { ...r } as unknown as V, idx })} /></td>}
            </tr>
          )
        })}</tbody>
      </table></div>
      {edit && (
        <FormModal title={edit.idx < 0 ? `${title} — new rate` : `${title} — edit`} initial={edit.v} fields={fields} onClose={() => setEdit(null)}
          onDelete={edit.idx >= 0 && rows.length > 1 ? () => void onSave(rows.filter((_, i) => i !== edit.idx)) : undefined}
          validate={(v) => (rows.some((r, i) => r.from === v.from && i !== edit.idx) ? 'A rate already starts on this date' : null)}
          onSave={async (v) => {
            const rec = { ...v } as V
            for (const c of cols) if (c.type !== 'text' && c.type !== 'date') rec[c.key] = n(v[c.key])
            if (!rec.note) delete rec.note
            await onSave(edit.idx < 0 ? [...rows, rec as unknown as T] : rows.map((r, i) => (i === edit.idx ? (rec as unknown as T) : r)))
          }} />
      )}
    </Card>
  )
}

export function PayRulesSettings() {
  const cfg = useConfig()
  const { isSuper, isHrAdmin, can } = useAuth()
  const canRates = isSuper || isHrAdmin || can('compliance.rates')
  const canHol = isSuper || isHrAdmin || can('compliance.settings')
  const rates = cfg.rates
  const [msg, setMsg] = useState<string | null>(null)
  const [single, setSingle] = useState<'pay' | 'leave' | null>(null)
  const save = async (next: RatesConfig) => {
    try { await savePayConfig('rates', next); setMsg('Saved ✓') } catch (e) { setMsg((e as Error).message); throw e }
  }
  const put = <K extends keyof RatesConfig>(k: K) => (rows: RatesConfig[K]) => save({ ...rates, [k]: rows })
  return (
    <>
      <p className="callout">These rates drive the payslip helper, the pay checks on the dashboard and the leave balances. Each rate has a start date, so old months keep the old rate. Built-in values are as of October 2026. Where a rule is uncertain the app says “{CHECK}”. {!canRates && <strong>You can view these rules; only the CEO, HR Admin or a General Manager with the “Statutory rates” power can change them.</strong>}</p>
      {msg && <p className={msg.startsWith('Saved') ? 'ok-msg' : 'err'} role="status">{msg}</p>}
      <DatedTable title="💰 Minimum wage" help="Domestic servants are not covered. Employers with fewer than 5 workers moved to RM1,700 from 1 Aug 2025." rows={rates.minWage} canEdit={canRates} onSave={put('minWage')}
        cols={[{ key: 'monthly', label: 'Monthly RM' }, { key: 'hourly', label: 'Hourly RM' }, { key: 'daily6', label: 'Daily (6-day wk)' }, { key: 'daily5', label: 'Daily (5-day wk)' }, { key: 'daily4', label: 'Daily (4-day wk)' }]} />
      <DatedTable title="🏦 EPF (KWSP) — foreign workers" help="Each share is wages × rate, rounded up to the next ringgit. Overtime is not EPF wages. Pay by the 15th of the next month." rows={rates.epf} canEdit={canRates} onSave={put('epf')}
        cols={[{ key: 'employee', label: 'Worker %', suffix: '%' }, { key: 'employer', label: 'Employer %', suffix: '%' }]} />
      <DatedTable title="🛡️ PERKESO (SOCSO) — foreign workers" help="Employment Injury + Invalidity. The app gives an estimate on wages up to the ceiling; PERKESO’s band table gives the exact amount." rows={rates.socso} canEdit={canRates} onSave={put('socso')}
        cols={[{ key: 'employer', label: 'Employer %', suffix: '%' }, { key: 'employee', label: 'Worker %', suffix: '%' }, { key: 'ceiling', label: 'Wage ceiling RM' }]} />
      <DatedTable title="🚑 LINDUNG 24 Jam" help="Paid by the worker for 24-hour non-work accident cover." rows={rates.lindung} canEdit={canRates} onSave={put('lindung')}
        cols={[{ key: 'employee', label: 'Worker %', suffix: '%' }, { key: 'ceiling', label: 'Wage ceiling RM' }]} />
      <DatedTable title="🏠 Hostel deduction limit (Act 446)" help="Peninsular Malaysia and Labuan. Needs a valid Certificate for Accommodation, the worker’s written request and approval, and never more than the contract amount." rows={rates.hostelCap} canEdit={canRates} onSave={put('hostelCap')}
        cols={[{ key: 'amount', label: 'Max per month RM' }]} />
      <DatedTable title="⏱️ Overtime & hours" help="Rest day: up to half the normal hours = ½ day’s pay, more = 1 day’s pay. Public holiday worked = extra days’ pay as set." rows={rates.ot} canEdit={canRates} onSave={put('ot')}
        cols={[{ key: 'normal', label: 'OT normal ×' }, { key: 'restOt', label: 'OT rest day ×' }, { key: 'phDayExtra', label: 'PH worked (days)' }, { key: 'phOt', label: 'OT PH ×' }, { key: 'capHours', label: 'OT cap h/month' }, { key: 'hoursPerDay', label: 'Hours/day' }, { key: 'daysPerMonth', label: 'Days/month' }, { key: 'weeklyHours', label: 'Hours/week' }]} />
      <div className="grid2">
        <Card title="📅 Pay deadlines & deductions" actions={canRates ? <Btn small icon="edit" onClick={() => setSingle('pay')}>Edit</Btn> : undefined}>
          <KV items={[['Wages due', `${rates.payDays} days after the month ends`], ['OT / rest-day / holiday pay', 'by the last day of the next month'], ['Deductions limit', `${rates.deductionCapPct}% of the month’s wages`]]} />
          <p className="muted small">Employment Act s.19, s.19(1A), s.24 — EPF, PERKESO and LINDUNG are not counted in the limit ({CHECK}).</p>
        </Card>
        <Card title="🏖️ Leave entitlements" actions={canRates ? <Btn small icon="edit" onClick={() => setSingle('leave')}>Edit</Btn> : undefined}>
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Service from</th><th className="num">Annual</th><th className="num">Sick</th></tr></thead>
            <tbody>{rates.leave.tiers.map((t) => <tr key={t.minYears}><td>{t.minYears} years</td><td className="num">{t.annual} days</td><td className="num">{t.sick} days</td></tr>)}</tbody></table></div>
          <KV items={[['Hospitalisation', `${rates.leave.hospital} days`], ['Maternity', `${rates.leave.maternity} days`], ['Paternity', `${rates.leave.paternity} days (${rates.leave.paternityMinMonths}+ months’ service)`]]} />
        </Card>
      </div>
      {single === 'pay' && (
        <FormModal title="Pay deadlines & deductions" initial={{ payDays: rates.payDays, deductionCapPct: rates.deductionCapPct }} onClose={() => setSingle(null)}
          fields={[{ key: 'payDays', label: 'Wages due — days after the month ends', type: 'number', required: true }, { key: 'deductionCapPct', label: 'Deductions limit (% of wages)', type: 'number', required: true }]}
          onSave={(v) => save({ ...rates, payDays: n(v.payDays), deductionCapPct: n(v.deductionCapPct) })} />
      )}
      {single === 'leave' && (
        <FormModal title="Leave entitlements" onClose={() => setSingle(null)}
          initial={{ ...Object.fromEntries(rates.leave.tiers.flatMap((t, i) => [[`y${i}`, t.minYears], [`a${i}`, t.annual], [`s${i}`, t.sick]])), hospital: rates.leave.hospital, maternity: rates.leave.maternity, paternity: rates.leave.paternity, paternityMinMonths: rates.leave.paternityMinMonths }}
          fields={[...rates.leave.tiers.flatMap((_, i) => [{ key: `y${i}`, label: `Tier ${i + 1}: from years of service`, type: 'number' as const, required: true }, { key: `a${i}`, label: `Tier ${i + 1}: annual days`, type: 'number' as const, required: true }, { key: `s${i}`, label: `Tier ${i + 1}: sick days`, type: 'number' as const, required: true }]),
            { key: 'hospital', label: 'Hospitalisation days', type: 'number', required: true }, { key: 'maternity', label: 'Maternity days', type: 'number', required: true }, { key: 'paternity', label: 'Paternity days', type: 'number', required: true }, { key: 'paternityMinMonths', label: 'Paternity: months of service needed', type: 'number', required: true }]}
          onSave={(v) => save({ ...rates, leave: { tiers: rates.leave.tiers.map((_, i) => ({ minYears: n(v[`y${i}`]), annual: n(v[`a${i}`]), sick: n(v[`s${i}`]) })), hospital: n(v.hospital), maternity: n(v.maternity), paternity: n(v.paternity), paternityMinMonths: n(v.paternityMinMonths) } })} />
      )}
      {canRates && <p><Btn small kind="ghost" onClick={() => { if (confirm('Put all pay rates back to the built-in values?')) void save(DEFAULT_RATES).catch(() => undefined) }}>Reset rates to built-in values</Btn></p>}
      <OtCalculator />
      <HolidaysEditor canEdit={canHol} />
    </>
  )
}

/* ---------------- Public holidays ---------------- */
export function HolidaysEditor({ canEdit }: { canEdit: boolean }) {
  const cfg = useConfig()
  const h = cfg.holidays
  const thisYear = new Date().getFullYear()
  const years = [...new Set([...Object.keys(h.years), String(thisYear), String(thisYear + 1)])].sort()
  const [year, setYear] = useState(String(thisYear))
  const [state, setState] = useState('')
  const [rest, setRest] = useState('Sunday')
  const [edit, setEdit] = useState<V | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const list = holidaysFor(h, year, state || undefined)
  const all = h.years[year] || []
  const save = async (next: Holiday[]) => {
    const value: HolidaysConfig = { ...h, years: { ...h.years, [year]: next } }
    try { await savePayConfig('holidays', value); setMsg('Saved ✓') } catch (e) { setMsg((e as Error).message); throw e }
  }
  const dates = list.map((x) => x.date)
  const nationwide = list.filter((x) => x.states.includes('*')).length
  return (
    <Card title="🎉 Public holidays" actions={canEdit ? <Btn small icon="plus" onClick={() => setEdit({ date: `${year}-01-01`, nationwide: false, states: state ? [state] : [] })}>Add holiday</Btn> : undefined}>
      <div className="row gap-s wrap pay-filters">
        <label>Year <select value={year} onChange={(e) => setYear(e.target.value)}>{years.map((y) => <option key={y}>{y}</option>)}</select></label>
        <label>State <select value={state} onChange={(e) => setState(e.target.value)}><option value="">All states</option>{STATES.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label>Rest day <select value={rest} onChange={(e) => setRest(e.target.value)}>{REST_DAYS.map((d) => <option key={d}>{d}</option>)}</select></label>
      </div>
      <p className="muted small">Give at least 11 paid public holidays a year. Five are compulsory: National Day, the Agong’s Birthday, the Ruler’s Birthday (or Federal Territory Day), Labour Day and Malaysia Day. If a holiday falls on the rest day, the next working day is the replacement (Employment Act s.60D — {CHECK}). {state ? `${list.length} holidays listed for ${state} (${nationwide} nationwide).` : ''}</p>
      {msg && <p className={msg.startsWith('Saved') ? 'ok-msg' : 'err'} role="status">{msg}</p>}
      {all.length === 0 ? <Empty title={`No holidays for ${year} yet`}>{canEdit ? 'Add them from the official gazette when they are announced.' : 'HR will add them when they are announced.'}</Empty> : (
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Date</th><th>Day</th><th>Holiday</th><th>Where</th><th>If rest day is {rest}</th>{canEdit && <th />}</tr></thead>
          <tbody>{list.map((x) => {
            const rep = replacementDay(x.date, rest, dates)
            const base = x.name.replace(/\s*\((second day|holiday)\)$/i, '').toLowerCase()
            const gaz = rep ? list.find((y) => y.date > x.date && y.date <= addDays(x.date, 3) && /\(holiday\)$/i.test(y.name) && y.name.toLowerCase().startsWith(base)) : undefined
            return (
              <tr key={x.id}><td className="nowrap">{fmtDate(x.date)}</td><td>{parseISO(x.date)?.toLocaleDateString('en-GB', { weekday: 'short' })}</td><td>{x.name}</td>
                <td className="small">{x.states.includes('*') ? <Chip tone="teal">Nationwide</Chip> : x.states.length > 4 ? `${x.states.length} states` : x.states.join(', ')}</td>
                <td className="small">{gaz ? `Gazetted replacement: ${fmtDate(gaz.date)}` : rep ? `Replace on ${fmtDate(rep)}` : '—'}</td>
                {canEdit && <td><Btn small kind="ghost" icon="edit" title="Edit" onClick={() => setEdit({ ...x, nationwide: x.states.includes('*') })} /></td>}</tr>
            )
          })}</tbody>
        </table></div>
      )}
      {canEdit && BUILTIN_HOLIDAYS[year] && <p><Btn small kind="ghost" onClick={() => { if (confirm(`Replace the ${year} list with the built-in list?`)) void save(BUILTIN_HOLIDAYS[year]).catch(() => undefined) }}>Reset {year} to the built-in list</Btn></p>}
      <p className="muted small">{h.source || ''}</p>
      {edit && (
        <FormModal title={edit.id ? 'Edit holiday' : 'Add holiday'} initial={edit} onClose={() => setEdit(null)}
          fields={[{ key: 'date', label: 'Date', type: 'date', required: true }, { key: 'name', label: 'Name', required: true }, { key: 'nationwide', label: 'Nationwide (all states)', type: 'checkbox', full: true }]}
          validate={(v) => (!String(v.date || '').startsWith(year) ? `The date must be in ${year}` : !v.nationwide && !(v.states as string[] | undefined)?.length ? 'Choose at least one state' : null)}
          onDelete={edit.id ? () => void save(all.filter((x) => x.id !== edit.id)).catch(() => undefined) : undefined}
          onSave={async (v) => {
            const rec: Holiday = { id: (edit.id as string) || uid(), date: String(v.date), name: String(v.name), states: v.nationwide ? ['*'] : (v.states as string[]) }
            await save(edit.id ? all.map((x) => (x.id === rec.id ? rec : x)) : [...all, rec])
          }}>
          {(v, set) => v.nationwide ? null : (
            <fieldset className="pay-states"><legend>States</legend>
              {STATES.map((s) => { const on = ((v.states as string[]) || []).includes(s); return <label key={s} className="check"><input type="checkbox" checked={on} onChange={() => set({ states: on ? (v.states as string[]).filter((x) => x !== s) : [...((v.states as string[]) || []), s] })} /> {s}</label> })}
            </fieldset>
          )}
        </FormModal>
      )}
    </Card>
  )
}
