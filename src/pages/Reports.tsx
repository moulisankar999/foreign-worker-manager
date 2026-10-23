import { printPage } from '../lib/platform'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Btn, Card, SelectFilter, Toolbar } from '../components/ui'
import { matchesQuery } from './Workers'
import { allowancesTotal, currentBasic, currentDocs, docStatus, isExited, latestDoc, leaveBalances, loanBalance, minContractEnd, outletName, proratedPenalty, sortedIncrements, ticketInfo } from '../lib/calc'
import { useOutlets, useSettings, useWorkers } from '../lib/hooks'
import { BUSINESS_TYPES, NATIONALITIES, type Outlet, type Settings, type Worker } from '../lib/types'
import { useAuth } from '../lib/auth'
import { updateWorker } from '../lib/db'
import { useConfig } from '../lib/config'
import { CONSENT_LABEL, CUSTODY_LABEL, consentPdf, consentOf, custodyOf, lastRelease, overdueDays, passportOf } from '../lib/passport'
import { missingLanguage, otherLanguagesText, primaryLangName } from '../lib/languages'
import { proofDue, proofState, refNo, useRequests } from '../lib/requests'
import { STATUS_LABEL, type EmergencyReason, type RequestRow } from '../lib/workflow'
import { daysUntil, download, fmtDate, monthsBetween, rm, serviceText, toCSV, todayISO } from '../lib/util'

type Fmt = 'date' | 'rm' | 'num' | 'text'
interface Col { key: string; label: string; fmt?: Fmt }
type Row = Record<string, string | number | undefined> & { _wid?: string }
interface Report { id: string; name: string; desc: string; cols: Col[]; rows: (ws: Worker[], o: Outlet[], s: Settings, opt: { within: string; reqs: RequestRow[]; reasons: EmergencyReason[] }) => Row[]; scope?: 'all' | 'current' }

const base = (w: Worker, o: Outlet[]) => ({ _wid: w.id, id: w.workerNo, name: w.fullName, outlet: outletName(o, w.outletId) })
const WC: Col[] = [{ key: 'id', label: 'ID' }, { key: 'name', label: 'Worker' }, { key: 'outlet', label: 'Outlet' }]

const PAY_REPORTS = ['loans', 'deductions', 'increments', 'payroll', 'exits']
const REPORTS: Report[] = [
  {
    id: 'passport', name: 'Passport consent & custody', desc: 'Passports Act 1966 s.12(1)(f) — safekeeping consent status and where each passport is (worker or company safe with consent)', scope: 'current',
    cols: [...WC, { key: 'pp', label: 'Passport' }, { key: 'ppx', label: 'Expiry', fmt: 'date' }, { key: 'consent', label: 'Consent' }, { key: 'issued', label: 'Form issued', fmt: 'date' }, { key: 'signed', label: 'Signed', fmt: 'date' }, { key: 'custody', label: 'Passport is' }, { key: 'rel', label: 'Released', fmt: 'date' }, { key: 'exp', label: 'Expected back', fmt: 'date' }, { key: 'od', label: 'Days overdue', fmt: 'num' }],
    rows: (ws, o) => ws.map((w) => { const p = passportOf(w); const c = consentOf(w); const cu = custodyOf(w); const lr = cu === 'released' ? lastRelease(w) : undefined
      return { ...base(w, o), pp: p.no, ppx: p.expiry, consent: CONSENT_LABEL[c], _c: c, issued: w.passportSafe?.issuedAt, signed: w.passportSafe?.signedAt, custody: CUSTODY_LABEL[cu], rel: lr?.date, exp: lr?.expectedReturn, od: overdueDays(w) || undefined } })
      .sort((a, b) => ['pending', 'uploaded', 'not_issued', 'withdrawn', 'signed'].indexOf(String(a._c)) - ['pending', 'uploaded', 'not_issued', 'withdrawn', 'signed'].indexOf(String(b._c))),
  },
  {
    id: 'passmoves', name: 'Passport movement register', desc: 'Every deposit, release and return of a passport, with reason and who handled it',
    cols: [...WC, { key: 'date', label: 'Date', fmt: 'date' }, { key: 'kind', label: 'Movement' }, { key: 'reason', label: 'Reason' }, { key: 'exp', label: 'Expected back', fmt: 'date' }, { key: 'by', label: 'By' }],
    rows: (ws, o) => ws.flatMap((w) => (w.passportSafe?.moves || []).map((m) => ({ ...base(w, o), date: m.date, kind: m.kind === 'release' ? 'Released to worker' : m.kind === 'deposit' ? 'Deposited in safe' : 'Returned to safe', reason: m.reason, exp: m.expectedReturn, by: m.by }))).sort((a, b) => String(b.date).localeCompare(String(a.date))),
  },
  {
    id: 'emergency', name: 'Emergency leave', desc: 'Emergency leave requests with reason, family member, ticket and proof status',
    cols: [...WC, { key: 'ref', label: 'Ref' }, { key: 'from', label: 'From', fmt: 'date' }, { key: 'to', label: 'To', fmt: 'date' }, { key: 'reason', label: 'Reason' }, { key: 'rel', label: 'Family member' }, { key: 'proof', label: 'Proof' }, { key: 'due', label: 'Proof due', fmt: 'date' }, { key: 'ticket', label: 'Ticket' }, { key: 'cost', label: 'Ticket cost', fmt: 'rm' }, { key: 'dec', label: 'Ticket decision' }, { key: 'status', label: 'Status' }],
    rows: (ws, o, _s, { reqs, reasons }) => reqs.filter((r) => r.type === 'emergency_leave').flatMap((r) => {
      const w = ws.find((x) => x.id === r.worker_id); if (!w) return []
      const days = Number(r.data.proofDays) || reasons.find((x) => x.key === r.data.reasonKey)?.proofDays || 14
      const ps = proofState(r, r.data.proofReceived ? 1 : 0, days)
      return [{ ...base(w, o), ref: refNo(r), from: String(r.data.from || ''), to: String(r.data.to || ''), reason: String(r.data.reasonLabel || r.data.reasonKey || ''), rel: String(r.data.relationship || ''), proof: ps === 'pending' ? 'proof pending' : ps, due: ps === 'pending' || ps === 'overdue' ? proofDue(r, days) : undefined, ticket: r.data.ticketBooked ? 'Attached' : 'Missing', cost: Number(r.data.ticketCost) || undefined, dec: String(r.result?.ticketDecision || '').replace('_', ' '), status: STATUS_LABEL[r.status] }]
    }),
  },
  {
    id: 'expiry', name: 'Expiry report', desc: 'Latest passport, permit, FOMEMA, insurance & other document expiries', scope: 'current',
    cols: [...WC, { key: 'doc', label: 'Document' }, { key: 'no', label: 'Number' }, { key: 'exp', label: 'Expiry', fmt: 'date' }, { key: 'days', label: 'Days left', fmt: 'num' }, { key: 'st', label: 'Status' }],
    rows: (ws, o, s, { within }) => ws.flatMap((w) => currentDocs(w).filter((d) => d.expiryDate).map((d) => ({ ...base(w, o), doc: d.type === 'Other' ? d.label : d.type, no: d.number, exp: d.expiryDate, days: daysUntil(d.expiryDate)!, st: docStatus(d, s) })))
      .filter((r) => !within || (within === 'expired' ? (r.days as number) < 0 : (r.days as number) <= Number(within)))
      .sort((a, b) => (a.days as number) - (b.days as number)),
  },
  {
    id: 'master', name: 'Worker master list', desc: 'All worker details in one sheet',
    cols: [...WC, { key: 'nat', label: 'Nationality' }, { key: 'lang', label: 'Primary language' }, { key: 'langrw', label: 'Reads / writes it' }, { key: 'langs', label: 'Other languages' }, { key: 'gender', label: 'Gender' }, { key: 'dob', label: 'DOB', fmt: 'date' }, { key: 'type', label: 'Business' }, { key: 'job', label: 'Job' }, { key: 'skill', label: 'Skill' }, { key: 'join', label: 'Joined', fmt: 'date' }, { key: 'svc', label: 'Service' }, { key: 'status', label: 'Status' }, { key: 'pp', label: 'Passport' }, { key: 'ppx', label: 'Passport exp', fmt: 'date' }, { key: 'vpx', label: 'Permit exp', fmt: 'date' }, { key: 'fmx', label: 'FOMEMA exp', fmt: 'date' }, { key: 'phone', label: 'Phone' }, { key: 'hostel', label: 'Hostel' }],
    rows: (ws, o) => ws.map((w) => ({ ...base(w, o), nat: w.nationality, lang: missingLanguage(w) ? 'MISSING' : primaryLangName(w), langrw: w.primaryLanguage ? [w.primaryRead ? 'read' : '', w.primaryWrite ? 'write' : ''].filter(Boolean).join(' & ') || 'speaks only' : '', langs: otherLanguagesText(w), gender: w.gender, dob: w.dob, type: w.businessType, job: w.jobCategory, skill: w.skillLevel, join: w.joinDate, svc: serviceText(w.joinDate, w.exitDate), status: w.status, pp: latestDoc(w, 'Passport')?.number, ppx: latestDoc(w, 'Passport')?.expiryDate, vpx: latestDoc(w, 'Work Permit / PLKS (VP(TE))')?.expiryDate, fmx: latestDoc(w, 'FOMEMA Medical')?.expiryDate, phone: w.phoneMY, hostel: w.hostelAddress })),
  },
  {
    id: 'leave', name: 'Leave balances', desc: 'Annual leave entitlement, carry-forward and balance (current year)', scope: 'current',
    cols: [...WC, { key: 'ent', label: 'Entitled/yr', fmt: 'num' }, { key: 'bf', label: 'B/F', fmt: 'num' }, { key: 'yr', label: 'This year', fmt: 'num' }, { key: 'used', label: 'Taken', fmt: 'num' }, { key: 'bal', label: 'Balance', fmt: 'num' }, { key: 'status', label: 'Status' }],
    rows: (ws, o, s) => ws.map((w) => { const y = leaveBalances(w, s).pop(); return { ...base(w, o), ent: w.annualLeaveDays ?? s.annualLeaveDays, bf: y?.carryIn, yr: y?.entitled, used: y?.used, bal: y?.balance, status: w.status } }),
  },
  {
    id: 'leaveapps', name: 'Leave applications', desc: 'All leave applications with approval & ticket details',
    cols: [...WC, { key: 'type', label: 'Type' }, { key: 'from', label: 'From', fmt: 'date' }, { key: 'to', label: 'To', fmt: 'date' }, { key: 'days', label: 'Days', fmt: 'num' }, { key: 'st', label: 'Approval' }, { key: 'by', label: 'By' }, { key: 'ret', label: 'Returned' }, { key: 'tk', label: 'Ticket' }, { key: 'cost', label: 'Ticket cost', fmt: 'rm' }, { key: 'paid', label: 'Paid by' }],
    rows: (ws, o) => ws.flatMap((w) => w.leaves.map((l) => ({ ...base(w, o), type: l.type, from: l.from, to: l.to, days: l.days, st: l.status, by: l.approvedBy, ret: l.returned ? fmtDate(l.returnedOn) : '', tk: l.ticketProvided ? l.ticketDetails || 'Yes' : 'No', cost: l.ticketCost, paid: l.ticketProvided ? l.ticketPaidBy : '' }))).sort((a, b) => String(b.from).localeCompare(String(a.from))),
  },
  {
    id: 'tickets', name: 'Flight ticket eligibility', desc: 'Return ticket entitlement & accumulation', scope: 'current',
    cols: [...WC, { key: 'join', label: 'Joined', fmt: 'date' }, { key: 'svc', label: 'Service' }, { key: 'earned', label: 'Earned', fmt: 'num' }, { key: 'used', label: 'Used', fmt: 'num' }, { key: 'bal', label: 'Balance', fmt: 'num' }, { key: 'val', label: 'Est. value', fmt: 'rm' }, { key: 'last', label: 'Last trip', fmt: 'date' }, { key: 'next', label: 'Next earned', fmt: 'date' }],
    rows: (ws, o, s) => ws.map((w) => { const t = ticketInfo(w, s); return { ...base(w, o), join: w.joinDate, svc: serviceText(w.joinDate), earned: t.earned, used: t.used, bal: t.balance, val: t.value, last: t.lastTrip, next: t.nextDate } }).sort((a, b) => (b.bal as number) - (a.bal as number)),
  },
  {
    id: 'loans', name: 'Loans & advances', desc: 'Every loan/advance with repaid amount and balance',
    cols: [...WC, { key: 'type', label: 'Type' }, { key: 'date', label: 'Date', fmt: 'date' }, { key: 'purpose', label: 'Purpose' }, { key: 'amt', label: 'Amount', fmt: 'rm' }, { key: 'paid', label: 'Repaid', fmt: 'rm' }, { key: 'bal', label: 'Balance', fmt: 'rm' }, { key: 'mo', label: 'Monthly', fmt: 'rm' }],
    rows: (ws, o) => ws.flatMap((w) => w.loans.map((l) => { const b = loanBalance(w, l.id); return { ...base(w, o), type: l.type, date: l.date, purpose: l.purpose, amt: l.amount, paid: l.amount - b, bal: b, mo: l.monthlyDeduction } })),
  },
  {
    id: 'deductions', name: 'Deductions', desc: 'All salary deductions',
    cols: [...WC, { key: 'date', label: 'Date', fmt: 'date' }, { key: 'type', label: 'Type' }, { key: 'amt', label: 'Amount', fmt: 'rm' }, { key: 'rem', label: 'Remarks' }],
    rows: (ws, o) => ws.flatMap((w) => w.deductions.map((d) => ({ ...base(w, o), date: d.date, type: d.type, amt: d.amount, rem: d.remarks }))).sort((a, b) => String(b.date).localeCompare(String(a.date))),
  },
  {
    id: 'increments', name: 'Increment history', desc: 'All pay changes with % increase',
    cols: [...WC, { key: 'date', label: 'Effective', fmt: 'date' }, { key: 'old', label: 'Old basic', fmt: 'rm' }, { key: 'new', label: 'New basic', fmt: 'rm' }, { key: 'chg', label: 'Change', fmt: 'rm' }, { key: 'pct', label: '%', fmt: 'num' }, { key: 'reason', label: 'Reason' }],
    rows: (ws, o) => ws.flatMap((w) => sortedIncrements(w).map((i) => ({ ...base(w, o), date: i.date, old: i.oldPay, new: i.newPay, chg: i.newPay - i.oldPay, pct: i.oldPay ? Math.round(((i.newPay - i.oldPay) / i.oldPay) * 1000) / 10 : undefined, reason: i.reason }))),
  },
  {
    id: 'payroll', name: 'Payroll summary by outlet', desc: 'Headcount and monthly basic/allowance totals (current workers)', scope: 'current',
    cols: [{ key: 'outlet', label: 'Outlet' }, { key: 'type', label: 'Business' }, { key: 'hc', label: 'Headcount', fmt: 'num' }, { key: 'basic', label: 'Basic total', fmt: 'rm' }, { key: 'allow', label: 'Allowances', fmt: 'rm' }, { key: 'gross', label: 'Gross', fmt: 'rm' }, { key: 'avg', label: 'Avg basic', fmt: 'rm' }],
    rows: (ws, o) => {
      const m = new Map<string, Row>()
      for (const w of ws) {
        const k = w.outletId || '—'
        const r = m.get(k) || { outlet: outletName(o, w.outletId), type: w.businessType, hc: 0, basic: 0, allow: 0, gross: 0, avg: 0 }
        r.hc = (r.hc as number) + 1; r.basic = (r.basic as number) + currentBasic(w); r.allow = (r.allow as number) + allowancesTotal(w)
        r.gross = (r.basic as number) + (r.allow as number); r.avg = (r.basic as number) / (r.hc as number)
        m.set(k, r)
      }
      const rows = [...m.values()]
      const tot = rows.reduce<Row>((a, r) => ({ ...a, hc: (a.hc as number) + (r.hc as number), basic: (a.basic as number) + (r.basic as number), allow: (a.allow as number) + (r.allow as number), gross: (a.gross as number) + (r.gross as number) }), { outlet: 'TOTAL', type: '', hc: 0, basic: 0, allow: 0, gross: 0 })
      tot.avg = (tot.hc as number) ? (tot.basic as number) / (tot.hc as number) : 0
      return rows.length ? [...rows, tot] : []
    },
  },
  {
    id: 'exits', name: 'Exits & penalties', desc: 'Workers who left, with served period and prorated penalty',
    cols: [...WC, { key: 'status', label: 'Exit type' }, { key: 'exit', label: 'Exit date', fmt: 'date' }, { key: 'served', label: 'Served (mo)', fmt: 'num' }, { key: 'min', label: 'Min (mo)', fmt: 'num' }, { key: 'pen', label: 'Penalty', fmt: 'rm' }, { key: 'bal', label: 'Loan bal.', fmt: 'rm' }, { key: 'memo', label: 'Clearance' }],
    rows: (ws, o) => ws.filter(isExited).map((w) => {
      const exit = w.exitDate || w.statusHistory.at(-1)?.date || todayISO()
      const memo = w.memos.filter((m) => m.kind === 'Exit Clearance').pop()
      return { ...base(w, o), status: w.status, exit, served: Math.round(monthsBetween(w.contractStart || w.joinDate, exit) * 10) / 10, min: w.minContractMonths, pen: memo?.penalty ?? proratedPenalty(w, exit).penalty, bal: memo?.outstandingBalance ?? 0, memo: memo ? `${memo.checklist.filter((c) => c.done).length}/${memo.checklist.length}` : 'No memo' }
    }),
  },
  {
    id: 'contracts', name: 'Contracts', desc: 'Contract end and minimum-period dates', scope: 'current',
    cols: [...WC, { key: 'start', label: 'Start', fmt: 'date' }, { key: 'end', label: 'End', fmt: 'date' }, { key: 'days', label: 'Days left', fmt: 'num' }, { key: 'min', label: 'Min period ends', fmt: 'date' }, { key: 'pen', label: 'Penalty if leave today', fmt: 'rm' }],
    rows: (ws, o) => ws.map((w) => ({ ...base(w, o), start: w.contractStart, end: w.contractEnd, days: daysUntil(w.contractEnd) ?? undefined, min: minContractEnd(w), pen: proratedPenalty(w, todayISO()).penalty })).sort((a, b) => ((a.days as number) ?? 99999) - ((b.days as number) ?? 99999)),
  },
  {
    id: 'family', name: 'Family & next-of-kin directory', desc: 'Emergency contacts and family members',
    cols: [...WC, { key: 'rel', label: 'Relation' }, { key: 'fname', label: 'Name' }, { key: 'dob', label: 'DOB', fmt: 'date' }, { key: 'phone', label: 'Phone' }, { key: 'addr', label: 'Address' }, { key: 'flags', label: 'Flags' }],
    rows: (ws, o) => ws.flatMap((w) => w.family.map((f) => ({ ...base(w, o), rel: f.relation, fname: f.name, dob: f.dob, phone: f.phone, addr: f.address || w.overseasAddress, flags: [f.isNextOfKin && 'Next of kin', f.isEmergency && 'Emergency'].filter(Boolean).join(', ') }))),
  },
]

const show = (v: unknown, f?: Fmt) => (v === undefined || v === null || v === '' ? '—' : f === 'date' ? fmtDate(String(v)) : f === 'rm' ? rm(Number(v)) : String(v))

export default function Reports() {
  const ws = useWorkers()
  const outlets = useOutlets()
  const s = useSettings()
  const { canSeeSalary, canWrite, profile } = useAuth()
  const { rows: reqs } = useRequests()
  const reasons = useConfig().emergency_reasons
  const list = REPORTS.filter((r) => canSeeSalary || !PAY_REPORTS.includes(r.id))
  const [sp, setSp] = useSearchParams()
  const rid = sp.get('r') || 'expiry'
  const rep = list.find((r) => r.id === rid) || list.find((r) => r.id === 'expiry')!
  const [outlet, setOutlet] = useState('')
  const [type, setType] = useState('')
  const [nat, setNat] = useState('')
  const [scope, setScope] = useState('')
  const [q, setQ] = useState('')
  const [within, setWithin] = useState('')
  const [sort, setSort] = useState<{ k: string; d: 1 | -1 } | null>(null)

  const rows = useMemo(() => {
    const sc = scope || rep.scope || 'all'
    const filtered = ws.filter((w) => (!outlet || w.outletId === outlet) && (!type || w.businessType === type) && (!nat || w.nationality === nat) && (sc === 'all' || (sc === 'current' ? !isExited(w) : isExited(w))) && matchesQuery(w, q, outletName(outlets, w.outletId)))
    const r = rep.rows(filtered, outlets, s, { within, reqs, reasons })
    if (!sort) return r
    return [...r].sort((a, b) => {
      if (a.outlet === 'TOTAL') return 1
      if (b.outlet === 'TOTAL') return -1
      const x = a[sort.k], y = b[sort.k]
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true })) * sort.d
    })
  }, [ws, outlets, s, rep, outlet, type, nat, scope, q, within, sort, reqs, reasons])

  const csv = () => download(`${rep.id}-${todayISO()}.csv`, toCSV(rows.map((r) => Object.fromEntries(rep.cols.map((c) => [c.label, c.fmt === 'date' ? (r[c.key] ? fmtDate(String(r[c.key])) : '') : c.fmt === 'rm' && r[c.key] !== undefined ? Number(r[c.key]).toFixed(2) : r[c.key] ?? '']))), rep.cols.map((c) => c.label)), 'text/csv')
  const totals = rep.cols.filter((c) => c.fmt === 'rm' && rep.id !== 'payroll').map((c) => [c.label, rows.reduce((a, r) => a + Number(r[c.key] || 0), 0)] as const)

  return (
    <div className="page">
      <div className="page-h no-print">
        <div><h1>Reports</h1><p className="muted">Filter, sort (tap a column), print or export CSV</p></div>
      </div>
      <div className="rep-tabs no-print">
        {list.map((r) => <button key={r.id} className={r.id === rep.id ? 'on' : ''} onClick={() => { setSp({ r: r.id }, { replace: true }); setSort(null) }}>{r.name}</button>)}
      </div>
      <Toolbar>
        <div className="search no-print"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter workers…" aria-label="Filter workers" /></div>
        <SelectFilter label="Outlet" value={outlet} onChange={setOutlet} options={outlets.map((o) => ({ value: o.id, label: o.name }))} />
        <SelectFilter label="Business" value={type} onChange={setType} options={[...BUSINESS_TYPES]} />
        <SelectFilter label="Nationality" value={nat} onChange={setNat} options={NATIONALITIES} />
        <label className="sel-f"><span className="sr">Workers</span>
          <select aria-label="Worker scope" value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="">Workers: default ({rep.scope === 'current' ? 'current' : 'all'})</option><option value="all">All workers</option><option value="current">Current only</option><option value="exited">Exited only</option>
          </select>
        </label>
        {rep.id === 'expiry' && (
          <label className="sel-f"><span className="sr">Within</span>
            <select aria-label="Expiring within" value={within} onChange={(e) => setWithin(e.target.value)}>
              <option value="">Any date</option><option value="expired">Expired</option><option value="30">≤ 30 days</option><option value="60">≤ 60 days</option><option value="90">≤ 90 days</option><option value="180">≤ 180 days</option>
            </select>
          </label>
        )}
        <span className="spacer" />
        {rep.id === 'passport' && canWrite && <Btn small icon="doc" onClick={async () => {
          const ids = new Set(rows.map((r) => r._wid))
          const target = ws.filter((w) => ids.has(w.id) && consentOf(w) !== 'signed')
          if (!target.length) return alert('Everyone in this list has signed consent.')
          if (!confirm(`Create bilingual consent forms for ${target.length} workers (not yet signed)? Workers not yet issued a form are marked “Pending”.`)) return
          try {
            download(`passport-consent-forms-${todayISO()}.pdf`, await consentPdf(target, outlets, s.companyName), 'application/pdf')
            const by = profile?.full_name || profile?.email || 'HR'
            for (const w of target) if (consentOf(w) === 'not_issued' || consentOf(w) === 'withdrawn') await updateWorker(w.id, (x) => { x.passportSafe = { ...(x.passportSafe || { consent: 'not_issued' }), consent: 'pending', issuedAt: todayISO(), issuedBy: by } })
          } catch (e) { alert((e as Error).message) }
        }}>Bulk consent forms</Btn>}
        <Btn small icon="print" onClick={() => printPage()}>Print</Btn>
        <Btn small kind="primary" icon="download" onClick={csv}>CSV</Btn>
      </Toolbar>
      <Card title={<>{rep.name} <small className="muted">· {rows.length} rows</small></>}>
        <p className="muted small print-only">{s.companyName} · Printed {fmtDate(todayISO())}</p>
        <p className="muted small no-print">{rep.desc}</p>
        {totals.length > 0 && rows.length > 0 && <div className="calc">{totals.map(([l, v]) => <div key={l}><span>Total {l.toLowerCase()}</span><strong>{rm(v)}</strong></div>)}</div>}
        <div className="tbl-wrap">
          <table className="tbl rep">
            <thead><tr>{rep.cols.map((c) => (
              <th key={c.key} className={c.fmt === 'rm' || c.fmt === 'num' ? 'num' : ''}>
                <button className="th-b" onClick={() => setSort(sort?.k === c.key ? { k: c.key, d: sort.d === 1 ? -1 : 1 } : { k: c.key, d: 1 })}>{c.label}{sort?.k === c.key ? (sort.d === 1 ? ' ▲' : ' ▼') : ''}</button>
              </th>
            ))}</tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={rep.cols.length} className="muted center">No data</td></tr>}
              {rows.map((r, i) => (
                <tr key={i} className={r.outlet === 'TOTAL' ? 'tot' : ''}>
                  {rep.cols.map((c) => (
                    <td key={c.key} className={c.fmt === 'rm' || c.fmt === 'num' ? 'num' : ''}>
                      {c.key === 'name' && r._wid ? <Link to={`/workers/${r._wid}`}>{show(r[c.key])}</Link> : c.key === 'st' || c.key === 'days' || c.key === 'consent' || c.key === 'proof' || c.key === 'od' ? <span className={(c.key === 'days' && Number(r.days) < 0) || r.st === 'Expired' || (c.key === 'consent' && r._c === 'pending') || (c.key === 'proof' && r.proof === 'overdue') || c.key === 'od' ? 'neg' : r.st === 'Expiring soon' || (c.key === 'proof' && r.proof === 'proof pending') ? 'warn-t' : ''}>{show(r[c.key], c.fmt)}</span> : show(r[c.key], c.fmt)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
