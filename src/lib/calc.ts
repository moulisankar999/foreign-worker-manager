import { EXITED_STATUSES, LEAVE_STATUSES, REQUIRED_DOCS, type DocRec, type Outlet, type Settings, type Worker } from './types'
import { daysSinceCheck, lastCheck, type Agency } from './agencies'
import { getConfig } from './config'
import { computePayslip, prevMonth, statutoryAnnualForYear, statutoryLeave, monthLabel, minWageForWorker, nextMinWage, wageDueDate, workerCompany } from './pay'
import { ABSCOND_STEPS, CHECK, EXIT_STEPS, RECRUITMENT_COSTS, fomemaDue, hostelIssues, sameEmployer, stayYears, type TrackersConfig } from './trackers'
import { companyName } from './companies'
import { addDays, addMonths, daysUntil, fmtDate, monthsBetween, parseISO, rm, todayISO } from './util'

export type DocStatus = 'Valid' | 'Expiring soon' | 'Expired' | 'No expiry'

export function docStatus(d: DocRec, s: Settings): DocStatus {
  const n = daysUntil(d.expiryDate)
  if (n === null) return 'No expiry'
  if (n < 0) return 'Expired'
  if (n <= Math.max(...s.leadTimes, 0)) return 'Expiring soon'
  return 'Valid'
}

export const isExited = (w: Worker) => EXITED_STATUSES.includes(w.status)
export const isOnLeave = (w: Worker) => LEAVE_STATUSES.includes(w.status)

/** Latest record per document type (and per label for "Other"). */
export function currentDocs(w: Worker): DocRec[] {
  const m = new Map<string, DocRec>()
  for (const d of w.documents) {
    const k = d.type + '|' + (d.type === 'Other' ? d.label || '' : '')
    const prev = m.get(k)
    if (!prev || (d.expiryDate || '') > (prev.expiryDate || '')) m.set(k, d)
  }
  return [...m.values()]
}

export function latestDoc(w: Worker, type: string) {
  return w.documents.filter((d) => d.type === type).sort((a, b) => (b.expiryDate || '').localeCompare(a.expiryDate || ''))[0]
}

/* ---------- Pay ---------- */
export function sortedIncrements(w: Worker) {
  return [...w.increments].sort((a, b) => a.date.localeCompare(b.date))
}
export function currentBasic(w: Worker) {
  const inc = sortedIncrements(w).filter((i) => i.date <= todayISO())
  return inc.length ? inc[inc.length - 1].newPay : w.initialBasicPay || 0
}
export const allowancesTotal = (w: Worker) => w.allowances.reduce((s, a) => s + (Number(a.amount) || 0), 0)

/* ---------- Loans ---------- */
export function loanBalance(w: Worker, loanId: string) {
  const loan = w.loans.find((l) => l.id === loanId)
  if (!loan) return 0
  const paid = w.deductions.filter((d) => d.loanId === loanId).reduce((s, d) => s + Number(d.amount || 0), 0)
  return Math.max(0, Number(loan.amount || 0) - paid)
}
export function outstanding(w: Worker) {
  return w.loans.reduce((s, l) => s + loanBalance(w, l.id), 0)
}
export function loanLedger(w: Worker) {
  type Row = { date: string; kind: string; desc: string; debit: number; credit: number; balance: number }
  const ev: Omit<Row, 'balance'>[] = [
    ...w.loans.map((l) => ({ date: l.date, kind: l.type, desc: l.purpose || l.type, debit: Number(l.amount) || 0, credit: 0 })),
    ...w.deductions.filter((d) => d.loanId).map((d) => ({ date: d.date, kind: d.type, desc: d.remarks || d.type, debit: 0, credit: Number(d.amount) || 0 })),
  ].sort((a, b) => a.date.localeCompare(b.date) || b.debit - a.debit)
  let bal = 0
  return ev.map((e): Row => { bal += e.debit - e.credit; return { ...e, balance: Math.max(0, bal) } })
}

/* ---------- Leave & accumulation ---------- */
export interface LeaveYear { year: number; carryIn: number; entitled: number; used: number; balance: number; carryOut: number }
export function leaveBalances(w: Worker, s: Settings): LeaveYear[] {
  const join = parseISO(w.joinDate)
  if (!join) return []
  const ent0 = w.annualLeaveDays ?? s.annualLeaveDays
  const rates = getConfig().rates
  const endYear = new Date().getFullYear()
  const rows: LeaveYear[] = []
  let carry = 0
  for (let y = join.getFullYear(); y <= endYear; y++) {
    // never less than the Employment Act minimum for the length of service (s.60E)
    const ent = Math.max(ent0, statutoryAnnualForYear(w.joinDate, y, rates))
    // prorate the joining year by remaining months
    const entitled = y === join.getFullYear() ? Math.round((ent * (12 - join.getMonth())) / 12 * 2) / 2 : ent
    const used = w.leaves
      .filter((l) => l.type === 'Annual' && l.status === 'Approved' && parseISO(l.from)?.getFullYear() === y)
      .reduce((a, l) => a + Number(l.days || 0), 0)
    const balance = carry + entitled - used
    const carryOut = s.maxCarryForward > 0 ? Math.min(Math.max(0, balance), s.maxCarryForward) : Math.max(0, balance)
    rows.push({ year: y, carryIn: carry, entitled, used, balance, carryOut })
    carry = carryOut
  }
  return rows
}
export function leaveBalanceNow(w: Worker, s: Settings) {
  const r = leaveBalances(w, s)
  return r.length ? r[r.length - 1].balance : 0
}
export function activeLeave(w: Worker) {
  return w.leaves
    .filter((l) => l.status === 'Approved' && !l.returned && l.from <= todayISO())
    .sort((a, b) => b.from.localeCompare(a.from))[0]
}

/* ---------- Return flight ticket eligibility ---------- */
export interface TicketInfo { earned: number; used: number; balance: number; eligible: boolean; nextDate: string; lastTrip?: string; monthsSinceLast: number; value: number }
export function ticketInfo(w: Worker, s: Settings): TicketInfo {
  const every = Math.max(1, s.ticketEveryMonths)
  const served = Math.max(0, monthsBetween(w.joinDate, w.exitDate || todayISO()))
  const earned = Math.floor(served / every)
  const trips = w.leaves.filter((l) => l.status === 'Approved' && (l.ticketFromEntitlement || (l.type === 'Home Leave' && l.ticketProvided && (l.ticketPaidBy || 'Company') !== 'Worker' && l.ticketFromEntitlement !== false)))
  const used = trips.length
  const balance = Math.max(0, earned - used)
  const lastTrip = trips.map((t) => t.from).sort().pop()
  return {
    earned, used, balance, eligible: balance > 0,
    nextDate: addMonths(w.joinDate, (earned + 1) * every),
    lastTrip,
    monthsSinceLast: Math.floor(monthsBetween(lastTrip || w.joinDate, todayISO())),
    value: balance * s.ticketValue,
  }
}

/* ---------- Contract & prorated penalty ---------- */
export function minContractEnd(w: Worker) {
  const start = w.contractStart || w.joinDate
  return w.minContractMonths ? addMonths(start, w.minContractMonths) : undefined
}
export interface PenaltyCalc { served: number; remaining: number; penalty: number; minEnd?: string; applies: boolean }
export function proratedPenalty(w: Worker, exitDate: string): PenaltyCalc {
  const start = w.contractStart || w.joinDate
  const min = w.minContractMonths || 0
  const full = w.earlyPenalty || 0
  const served = Math.max(0, monthsBetween(start, exitDate))
  const remaining = Math.max(0, min - served)
  const penalty = min > 0 ? Math.round(((full * remaining) / min) * 100) / 100 : 0
  return { served, remaining, penalty, minEnd: minContractEnd(w), applies: remaining > 0 && full > 0 }
}

/* ---------- Alerts ---------- */
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'
export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info']
export interface Alert {
  id: string; workerId: string; workerName: string; workerNo: string; outletId?: string; businessType?: string
  category: string; title: string; detail: string; date?: string; days: number | null; severity: Severity
}

export function severityFor(days: number | null, s: Settings): Severity {
  if (days === null) return 'info'
  const lt = [...s.leadTimes].sort((a, b) => a - b)
  if (days < 0) return 'critical'
  if (days <= (lt[0] ?? 7)) return 'critical'
  if (days <= (lt[1] ?? 30)) return 'high'
  if (days <= (lt[2] ?? 60)) return 'medium'
  return 'low'
}

const dueText = (days: number) => (days < 0 ? `${Math.abs(days)} day(s) overdue` : days === 0 ? 'due today' : `in ${days} day(s)`)

export function buildAlerts(workers: Worker[], s: Settings, agencies: Agency[] = getConfig().agencies.items): Alert[] {
  const remind = agencies.filter((a) => a.enabled && a.remindDays > 0)
  const out: Alert[] = []
  const maxLead = Math.max(...s.leadTimes, 0)
  const occ = new Map<string, number>()
  for (const w of workers) if (w.hostelId && !isExited(w)) occ.set(w.hostelId, (occ.get(w.hostelId) || 0) + 1)
  for (const w of workers) {
    const base = { workerId: w.id, workerName: w.fullName, workerNo: w.workerNo, outletId: w.outletId, businessType: w.businessType }
    const push = (a: Omit<Alert, keyof typeof base>) => out.push({ ...base, ...a })
    // exit / absconding checklists stay on the list after the worker has left, until every step is done
    for (const a of flowAlerts(w)) push(a)
    if (isExited(w)) continue
    for (const a of trackerAlerts(w, s, occ)) push(a)
    // documents: use latest of each type/label
    for (const d of currentDocs(w)) {
      const n = daysUntil(d.expiryDate)
      if (n === null || n > maxLead) continue
      const name = d.type === 'Other' ? d.label || 'Document' : d.type
      push({ id: `doc-${d.id}`, category: d.type === 'Other' ? 'Other document' : d.type, title: `${name} ${n < 0 ? 'expired' : 'expiring'}`, detail: `${d.number ? '#' + d.number + ' · ' : ''}${fmtDate(d.expiryDate)} (${dueText(n)})`, date: d.expiryDate, days: n, severity: severityFor(n, s) })
    }
    for (const req of REQUIRED_DOCS) {
      if (!w.documents.some((d) => d.type === req)) push({ id: `missing-${w.id}-${req}`, category: 'Missing document', title: `${req} missing`, detail: 'No record on file', days: null, severity: 'medium' })
    }
    if (w.contractEnd) {
      const n = daysUntil(w.contractEnd)!
      if (n <= maxLead) push({ id: `contract-${w.id}`, category: 'Contract end', title: n < 0 ? 'Contract ended' : 'Contract ending', detail: `${fmtDate(w.contractEnd)} (${dueText(n)}) — renew or plan exit & checkout memo`, date: w.contractEnd, days: n, severity: severityFor(n, s) })
    }
    const mce = minContractEnd(w)
    if (mce) {
      const n = daysUntil(mce)!
      if (n >= 0 && n <= maxLead) push({ id: `mincontract-${w.id}`, category: 'Minimum contract', title: 'Minimum contract period completes', detail: `${fmtDate(mce)} (${dueText(n)}) — no early-exit penalty after this`, date: mce, days: n, severity: 'info' })
    }
    const t = ticketInfo(w, s)
    if (t.eligible) push({ id: `ticket-${w.id}`, category: 'Flight ticket', title: `Eligible for return flight ticket${t.balance > 1 ? ` ×${t.balance} (accumulated)` : ''}`, detail: `Earned ${t.earned}, used ${t.used}. Approx value ${rm(t.value)}`, days: null, severity: t.balance > 1 ? 'high' : 'medium' })
    else {
      const n = daysUntil(t.nextDate)!
      if (n <= maxLead) push({ id: `ticketsoon-${w.id}`, category: 'Flight ticket', title: 'Becomes eligible for flight ticket', detail: `${fmtDate(t.nextDate)} (${dueText(n)})`, date: t.nextDate, days: n, severity: 'low' })
    }
    const lv = activeLeave(w)
    if (lv && isOnLeave(w)) {
      const n = daysUntil(lv.to)!
      if (n < -s.overdueGraceDays) push({ id: `overdue-${lv.id}`, category: 'Overdue return', title: 'Not returned from leave', detail: `${lv.type} ended ${fmtDate(lv.to)} (${dueText(n)}) — follow up / check absconding`, date: lv.to, days: n, severity: 'critical' })
      else if (n <= 7) push({ id: `dueback-${lv.id}`, category: 'Due back', title: 'Due back from leave', detail: `${lv.type} ends ${fmtDate(lv.to)} (${dueText(n)}) — prepare return memo`, date: lv.to, days: n, severity: 'low' })
    }
    for (const l of w.leaves) {
      if (l.status === 'Pending') {
        const n = daysUntil(l.from)
        push({ id: `pending-${l.id}`, category: 'Leave approval', title: `${l.type} leave awaiting approval`, detail: `${fmtDate(l.from)} → ${fmtDate(l.to)} (${l.days} days)`, date: l.from, days: n, severity: n !== null && n <= 7 ? 'high' : 'medium' })
      }
      if (l.type === 'Home Leave' && l.status === 'Approved' && !l.returned) {
        const n = daysUntil(l.from)!
        if (n >= 0 && n <= 30) {
          if (!l.ticketProvided) push({ id: `noticket-${l.id}`, category: 'Flight ticket', title: 'Home leave without ticket booked', detail: `Departs ${fmtDate(l.from)} (${dueText(n)}) — book flight ticket`, date: l.from, days: n, severity: 'high' })
          if (!w.memos.some((m) => m.leaveId === l.id && m.kind === 'Home Leave Checkout')) push({ id: `nomemo-${l.id}`, category: 'Checkout memo', title: 'Checkout memo not prepared', detail: `Home leave from ${fmtDate(l.from)} (${dueText(n)})`, date: l.from, days: n, severity: 'high' })
        }
      }
    }
    // passport safekeeping (Passports Act 1966 s.12(1)(f))
    const ps = w.passportSafe
    const consent = ps?.consent || 'not_issued'
    const custody = ps?.custody || 'with_worker'
    if (custody === 'in_safe' && consent !== 'signed' && consent !== 'uploaded') push({ id: `ppnoconsent-${w.id}`, category: 'Passport consent', title: 'Passport in safe WITHOUT signed consent', detail: 'Return it to the worker or get the consent form signed now', days: null, severity: 'critical' })
    else if (consent === 'pending') push({ id: `pppending-${w.id}`, category: 'Passport consent', title: 'Passport consent PENDING', detail: `Form issued ${fmtDate(ps?.issuedAt)} — collect the signed form and upload it`, days: null, severity: 'high' })
    else if (consent === 'uploaded') push({ id: `ppverify-${w.id}`, category: 'Passport consent', title: 'Signed consent to verify', detail: 'HR Manager: check the scan and mark Signed', days: null, severity: 'medium' })
    if (custody === 'released') {
      const rel = [...(ps?.moves || [])].reverse().find((m) => m.kind === 'release')
      const n = daysUntil(rel?.expectedReturn)
      if (n !== null && n < 0 && consent === 'signed') push({ id: `ppoverdue-${w.id}`, category: 'Passport return', title: 'Passport not returned to safe', detail: `Expected back ${fmtDate(rel?.expectedReturn)} (${dueText(n)}) — worker keeps it unless he returns it voluntarily`, date: rel?.expectedReturn, days: n, severity: 'high' })
    }
    // government portal status checks (e.g. FOMEMA status not checked in 30 days)
    for (const a of remind) {
      const since = daysSinceCheck(w, a.id)
      if (since === null || since > a.remindDays) {
        const lc = lastCheck(w, a.id)
        push({ id: `check-${a.id}-${w.id}`, category: 'Status check', title: `${a.short} not checked in ${a.remindDays} days`, detail: lc ? `Last checked ${fmtDate(lc.date)} by ${lc.by || '—'}: ${lc.status}` : 'Never checked — open the worker → Check status', days: null, severity: 'low' })
      }
    }
    if (payVisible) for (const a of payAlerts(w, s)) push(a)
    const bal = outstanding(w)
    if (bal > 0) push({ id: `loan-${w.id}`, category: 'Loan / advance', title: 'Outstanding loan / advance', detail: `${rm(bal)} balance`, days: null, severity: 'info' })
  }
  return out.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || (a.days ?? 9999) - (b.days ?? 9999))
}

/* ---------- v1.2.2 trackers: exit / absconding checklists ---------- */
type WAlert = Omit<Alert, 'workerId' | 'workerName' | 'workerNo' | 'outletId' | 'businessType'>
export function flowAlerts(w: Worker, today = todayISO()): WAlert[] {
  const out: WAlert[] = []
  const t = getConfig().trackers
  const f = w.exitFlow
  if (w.status === 'Absconded' && (!f || f.kind !== 'abscond')) {
    out.push({ id: `abscond-start-${w.id}`, category: 'Absconding', title: 'Absconding checklist not started', detail: 'Open the worker → Compliance → Absconding checklist: police report, Immigration report (FWCMS eRUNAWAY), PLKS cancellation.', days: null, severity: 'high' })
    return out
  }
  if (!f || f.closed) return out
  const steps = f.kind === 'abscond' ? ABSCOND_STEPS : EXIT_STEPS
  const left = steps.filter((st) => !f.steps?.[st.key]?.done)
  if (!left.length) return out
  if (f.kind === 'abscond') {
    const seen = f.lastSeen || f.started
    const due = (k: 'police' | 'immigration', d: number, label: string) => {
      if (f.steps?.[k]?.done) return
      const date = addDays(seen, d)
      const n = daysUntil(date, today)!
      out.push({ id: `abscond-${k}-${w.id}`, category: 'Absconding', title: n < 0 ? `${label} overdue` : `${label} due`, detail: `Last seen ${fmtDate(seen)}. Company target: within ${d} days (${dueText(n)}) — ${CHECK}.`, date, days: n, severity: n < 0 ? 'critical' : 'high' })
    }
    due('police', t.abscondPoliceDays, 'Police report')
    due('immigration', t.abscondImmigrationDays, 'Immigration report')
    const rest = left.filter((st) => st.key !== 'police' && st.key !== 'immigration')
    if (rest.length) out.push({ id: `abscond-open-${w.id}`, category: 'Absconding', title: 'Absconding checklist open', detail: `Still to do: ${rest.map((x) => x.label).join(', ')}`, days: null, severity: 'medium' })
  } else {
    out.push({ id: `exit-open-${w.id}`, category: 'Exit', title: 'Exit checklist open', detail: `Still to do: ${left.map((x) => x.label).join(', ')}`, days: null, severity: left.some((x) => x.key === 'com' || x.key === 'cancel' || x.key === 'passport') ? 'high' : 'medium' })
  }
  return out
}

/* ---------- v1.2.2 trackers: permit, stay, hostel, job match, declarations ---------- */
const isPlks = (d: { type: string }) => d.type === 'Work Permit / PLKS (VP(TE))'
export function trackerAlerts(w: Worker, s: Settings, occ: Map<string, number> = new Map(), today = todayISO()): WAlert[] {
  const out: WAlert[] = []
  const cfg = getConfig()
  const t: TrackersConfig = cfg.trackers
  const maxLead = Math.max(...s.leadTimes, 0)
  const permit = latestDoc(w, 'Work Permit / PLKS (VP(TE))')
  const hasPlks = w.documents.some(isPlks)
  // PLKS renewal can start 3 months before expiry
  const pn = daysUntil(permit?.expiryDate, today)
  if (permit && pn !== null && pn >= 0 && pn <= t.plksLeadDays && permit.stage !== 'Renewal in progress' && permit.stage !== 'With immigration' && permit.stage !== 'With agent')
    out.push({ id: `plks-renew-${w.id}`, category: 'PLKS renewal', title: 'Start the PLKS renewal', detail: `Permit expires ${fmtDate(permit.expiryDate)} (${dueText(pn)}). Renewal can be submitted up to ${Math.round(t.plksLeadDays / 30)} months before expiry. Set the permit stage to “Renewal in progress” once submitted.`, date: permit.expiryDate, days: pn, severity: pn <= 30 ? 'high' : 'medium' })
  // FOMEMA yearly (only when the record has no expiry date; dated records already alert above)
  const lastF = w.documents.filter((d) => d.type === 'FOMEMA Medical').sort((a, b) => (b.issueDate || b.expiryDate || '').localeCompare(a.issueDate || a.expiryDate || ''))[0]
  const fd = fomemaDue(w, t)
  if (lastF && !lastF.expiryDate && fd) {
    const n = daysUntil(fd, today)!
    if (n <= maxLead) out.push({ id: `fomema-due-${w.id}`, category: 'FOMEMA', title: n < 0 ? 'FOMEMA medical overdue' : 'FOMEMA medical due', detail: `Last exam ${fmtDate(lastF.issueDate)}; next due ${fmtDate(fd)} (${dueText(n)}). Needed for the PLKS renewal.`, date: fd, days: n, severity: severityFor(n, s) })
  }
  // passport: warn 15 months ahead; PLKS renewal needs at least 12 months' validity
  const pp = latestDoc(w, 'Passport')
  const ppm = pp?.expiryDate ? monthsBetween(today, pp.expiryDate) : null
  const ppDays = daysUntil(pp?.expiryDate, today)
  if (pp && ppm !== null && ppDays !== null && ppDays > maxLead && ppm < t.passportWarnMonths)
    out.push({ id: `pp-15m-${w.id}`, category: 'Passport', title: ppm < t.passportMinMonths ? 'Passport too short for PLKS renewal' : 'Plan the passport renewal', detail: `Passport expires ${fmtDate(pp.expiryDate)}. The PLKS renewal needs at least ${t.passportMinMonths} months of passport validity — start renewing at the embassy early.`, date: pp.expiryDate, days: ppDays, severity: ppm < t.passportMinMonths ? 'medium' : 'low' })
  // insurance (SPIKPA / hospitalisation) should cover the whole permit
  const ins = latestDoc(w, 'Insurance (SPIKPA / Hospitalisation)')
  if (ins?.expiryDate && permit?.expiryDate && ins.expiryDate < permit.expiryDate && (daysUntil(ins.expiryDate, today) ?? 0) >= 0)
    out.push({ id: `ins-short-${w.id}`, category: 'Insurance', title: 'Insurance ends before the work permit', detail: `Insurance ends ${fmtDate(ins.expiryDate)}, permit ends ${fmtDate(permit.expiryDate)}. Extend SPIKPA / hospitalisation cover.`, date: ins.expiryDate, days: daysUntil(ins.expiryDate, today), severity: 'medium' })
  // security bond
  if (hasPlks) {
    const bond = latestDoc(w, 'Security Bond')
    if (!bond) out.push({ id: `bond-missing-${w.id}`, category: 'Security bond', title: 'Security bond not recorded', detail: 'Add the security bond / insurance guarantee (Documents → Security Bond) with its end date.', days: null, severity: 'low' })
    else if (bond.expiryDate && pn !== null && pn <= t.plksLeadDays && monthsBetween(today, bond.expiryDate) < t.bondMinMonths)
      out.push({ id: `bond-short-${w.id}`, category: 'Security bond', title: 'Security bond too short for renewal', detail: `Bond ends ${fmtDate(bond.expiryDate)}. For the PLKS renewal it should have at least ${t.bondMinMonths} months left — ${CHECK}.`, date: bond.expiryDate, days: daysUntil(bond.expiryDate, today), severity: 'medium' })
  }
  // 10-year total stay
  const y = stayYears(w, today)
  if (hasPlks && y !== null && y >= t.stayWarnYears) {
    const from = w.firstArrivalDate || w.joinDate
    const capDate = from ? addMonths(from, Math.round(t.stayCapYears * 12)) : undefined
    out.push({ id: `stay-cap-${w.id}`, category: '10-year stay', title: y >= t.stayCapYears ? `Reached the ${t.stayCapYears}-year stay limit` : `${y.toFixed(1)} years in Malaysia — near the ${t.stayCapYears}-year limit`, detail: `${w.firstArrivalDate ? 'First arrival' : 'Joined (first arrival not recorded)'} ${fmtDate(from)}; limit reached about ${fmtDate(capDate)}. Plan the exit or replacement — ${CHECK}.`, date: capDate, days: daysUntil(capDate, today), severity: y >= t.stayCapYears ? 'critical' : y >= t.stayHighYears ? 'high' : 'medium' })
  }
  // job-permit match (soft warnings)
  if (t.jobMatchOn && hasPlks) {
    const lc = (x?: string) => (x || '').trim().toLowerCase()
    if (w.businessType && t.officeTypes.some((o) => lc(o) === lc(w.businessType)))
      out.push({ id: `jobmatch-office-${w.id}`, category: 'Job-permit match', title: 'PLKS worker in an office outlet', detail: `Assigned to a ${w.businessType} outlet. Foreign workers on PLKS are approved for a sector, not for office work — ${CHECK}.`, days: null, severity: 'low' })
    const job = lc(w.jobCategory)
    if (job && t.frontRoles.some((r) => lc(r) && job.includes(lc(r))))
      out.push({ id: `jobmatch-front-${w.id}`, category: 'Job-permit match', title: 'PLKS worker in a front-of-house role', detail: `Job “${w.jobCategory}”. Foreign workers are generally not allowed to work as front liners (e.g. cashier, front desk) — ${CHECK}.`, days: null, severity: 'low' })
    const myCo = companyName(cfg.companies.items, workerCompany(w))
    if (w.permitEmployer && myCo && !sameEmployer(w.permitEmployer, myCo))
      out.push({ id: `jobmatch-employer-${w.id}`, category: 'Job-permit match', title: 'Permit employer differs from the company', detail: `The permit is for “${w.permitEmployer}” but the worker is under “${myCo}”. A worker may only work for the employer on his permit — ${CHECK}.`, days: null, severity: 'medium' })
  }
  // hostel (Act 446)
  if (w.hostelId) {
    const h = (cfg.hostels.items || []).find((x) => x.id === w.hostelId)
    if (h) for (const i of hostelIssues(h, occ.get(h.id) || 0, t, today).filter((x) => x.level === 'red'))
      out.push({ id: `hostel-${h.id}-${w.id}-${i.text.slice(0, 12)}`, category: 'Hostel', title: `Hostel “${h.name}”: ${i.text}`, detail: 'Workers’ accommodation needs a valid Certificate for Accommodation (Act 446) — see Compliance → Hostels.', days: i.days ?? null, severity: 'medium' })
  }
  // zero-cost recruitment declaration and recruitment costs paid by the worker
  if (w.zeroCost?.status !== 'signed') out.push({ id: `zerocost-${w.id}`, category: 'Zero-cost declaration', title: w.zeroCost?.status === 'issued' ? 'Zero-cost declaration not signed yet' : 'Zero-cost declaration not issued', detail: 'Print it from the worker → Compliance tab and get it signed.', days: null, severity: 'low' })
  if (payVisible) {
    const paid = (w.costs || []).filter((c) => c.paidBy === 'Worker' && !c.refunded && RECRUITMENT_COSTS.includes(c.type))
    if (paid.length) out.push({ id: `cost-worker-${w.id}`, category: 'Recruitment cost', title: 'Worker paid recruitment costs', detail: `${paid.map((c) => `${c.type} ${rm(c.amount)}`).join(', ')} — the employer should bear these. Refund the worker and record it.`, days: null, severity: 'high' })
  }
  if (!w.pdpa || w.pdpa.status === 'not_recorded') out.push({ id: `pdpa-${w.id}`, category: 'PDPA', title: 'PDPA consent not recorded', detail: 'Record the personal-data notice / consent in the worker → Compliance tab.', days: null, severity: 'info' })
  return out
}

export function outletName(outlets: Outlet[], id?: string) {
  return outlets.find((o) => o.id === id)?.name || '—'
}

/** pay alerts are shown only to people allowed to see pay (set by the sign-in provider) */
let payVisible = false
export function setPayAlertsVisible(v: boolean) { payVisible = v }

/* ---------- Pay compliance (minimum wage, late pay, OT, deductions, hostel, leave) ---------- */
type PayAlert = Omit<Alert, 'workerId' | 'workerName' | 'workerNo' | 'outletId' | 'businessType'>
export function payAlerts(w: Worker, s: Settings, today = todayISO()): PayAlert[] {
  const out: PayAlert[] = []
  const cat = 'Pay compliance'
  const rates = getConfig().rates
  // salary hidden for this role (outlet managers): the fields are missing, so do not guess
  if (w.initialBasicPay === undefined || w.initialBasicPay === null) return out
  const basic = currentBasic(w)
  const mw = minWageForWorker(rates, today, w)
  if (mw && basic > 0 && basic < mw.monthly && !w.minWageExempt) out.push({ id: `pay-minwage-${w.id}`, category: cat, title: 'Paid below the minimum wage', detail: `Basic ${rm(basic)} — minimum is ${rm(mw.monthly)} a month. Raise the pay or record an exemption (check with JTKSM or your agent).`, days: null, severity: 'high' })
  else {
    const nx = nextMinWage(rates, today, workerCompany(w))
    const nd = daysUntil(nx?.from, today)
    if (nx && nd !== null && nd <= 366 && basic > 0 && basic < nx.monthly && !w.minWageExempt)
      out.push({ id: `pay-minwage-next-${w.id}`, category: cat, title: `Minimum wage rises to ${rm(nx.monthly)} on ${fmtDate(nx.from)}`, detail: `Basic ${rm(basic)} is below the new rate${nx.largeOnly ? ' (announced — confirm when gazetted; businesses with sales under RM50 million can be marked exempt in Settings → Pay & Leave rules)' : ''}. Plan the increase.`, date: nx.from, days: nd, severity: 'info' })
  }
  // last month's payslip missing (only for workers who were already working last month)
  const lm = prevMonth(today)
  if (w.joinDate && w.joinDate < today.slice(0, 7) + '-01' && !(w.payslips || []).some((p) => p.month === lm)) {
    const due = wageDueDate(lm, rates)
    const n = daysUntil(due, today)!
    out.push({ id: `pay-noslip-${w.id}`, category: cat, title: `No payslip for ${monthLabel(lm)}`, detail: n >= 0 ? `Wages for ${monthLabel(lm)} are due by ${fmtDate(due)} — make the payslip in the Pay tab.` : `Wages were due by ${fmtDate(due)}. Make the payslip in the Pay tab and record the pay date.`, date: due, days: n, severity: n >= 0 ? 'low' : 'medium' })
  }
  // the most recent payslip (and last month's, if it exists) for late pay / OT / deductions / hostel
  const slips = [...(w.payslips || [])].sort((a, b) => b.month.localeCompare(a.month))
  const since = prevMonth(prevMonth(today))
  for (const p of slips.filter((x) => x.month >= since)) {
    const r = computePayslip(p, rates, w, today)
    const red = (k: string) => r.warnings.find((x) => x.key === k && x.level === 'red')
    const tag = monthLabel(p.month)
    const late = red('late') || red('otlate')
    if (late && !out.some((a) => a.id === `pay-late-${w.id}`)) out.push({ id: `pay-late-${w.id}`, category: cat, title: p.payDate ? 'Wages paid late' : 'Wages not recorded as paid', detail: `${tag}: ${late.text}`, date: r.wageDue, days: daysUntil(r.wageDue), severity: p.payDate ? 'medium' : 'high' })
    const ot = red('ot')
    if (ot && !out.some((a) => a.id === `pay-ot-${w.id}`)) out.push({ id: `pay-ot-${w.id}`, category: cat, title: 'Overtime over the monthly limit', detail: `${tag}: ${ot.text}`, days: null, severity: 'medium' })
    const de = red('deduct')
    if (de && !out.some((a) => a.id === `pay-deduct-${w.id}`)) out.push({ id: `pay-deduct-${w.id}`, category: cat, title: 'Deductions over 50% of wages', detail: `${tag}: ${de.text}`, days: null, severity: 'high' })
    const ho = red('hostel')
    if (ho && !out.some((a) => a.id === `pay-hostel-${w.id}`)) out.push({ id: `pay-hostel-${w.id}`, category: cat, title: 'Accommodation deduction not allowed', detail: `${tag}: ${ho.text}`, days: null, severity: 'high' })
  }
  // annual leave set lower than the law gives for the length of service
  if (w.annualLeaveDays !== undefined && w.annualLeaveDays !== null && w.joinDate) {
    const st = statutoryLeave(w.joinDate, rates, today)
    if (w.annualLeaveDays < st.annual) out.push({ id: `pay-leave-${w.id}`, category: cat, title: 'Annual leave set below the legal minimum', detail: `Set to ${w.annualLeaveDays} days; after ${st.years} year${st.years === 1 ? '' : 's'} of service the minimum is ${st.annual} days (the app already uses ${st.annual}). Update the worker’s leave setting.`, days: null, severity: 'low' })
  }
  void s
  return out
}
