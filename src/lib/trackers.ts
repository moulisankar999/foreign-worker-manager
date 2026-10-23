/* v1.2.2 trackers & risk: hostel register (Act 446), extra expiry rules (FOMEMA yearly, PLKS renewal,
 * passport 15 months, insurance, security bond, 10-year stay cap), job-permit match, exit / absconding
 * checklists, hiring tracker, cost tracker, zero-cost declaration, PDPA consent and the outlet risk score.
 * These are helpers, not legal advice: uncertain points say "check with JTKSM or your agent". */
import type { Outlet, Worker } from './types'
import { addDays, addMonths, daysUntil, fmtDate, monthsBetween, todayISO } from './util'

export const CHECK = 'check with JTKSM or your agent'

/* ---------------- hostel register ---------------- */
export interface Inspection { id: string; date: string; by?: string; result: 'Passed' | 'Issues found' | 'Failed'; notes?: string }
export interface Hostel {
  id: string; name: string; address?: string; state?: string; companyId?: string
  /** Certificate for Accommodation (JTKSM, Act 446) */
  certNo?: string; certExpiry?: string
  capacity?: number; landlord?: string
  inspections: Inspection[]
  nextInspection?: string
  notes?: string
  archived?: boolean
}
export interface HostelsConfig { items: Hostel[] }
export const DEFAULT_HOSTELS: HostelsConfig = { items: [] }

/* ---------------- hiring tracker ---------------- */
export interface HiringStep { done?: boolean; date?: string; ref?: string; note?: string }
export const HIRING_STEPS = [
  { key: 'advert', label: 'MYFutureJobs advert', hint: 'Advertise the job to locals on MYFutureJobs for at least 14 days.' },
  { key: 'interview', label: 'Local interviews recorded', hint: 'Keep a record of the local candidates interviewed and why they were not hired.' },
  { key: 'quota', label: 'Quota approved (FWCMS, s.60K)', hint: 'Apply for the quota and approval in FWCMS. Employment Act s.60K needs approval before hiring a foreign worker.' },
  { key: 'vdr', label: 'VDR / calling visa', hint: 'Visa with Reference (VDR) or calling visa issued.' },
  { key: 'arrival', label: 'Arrived in Malaysia', hint: 'Date the worker entered Malaysia.' },
  { key: 'fomema', label: 'FOMEMA medical (within 30 days)', hint: 'FOMEMA medical exam within 30 days of arrival.' },
  { key: 'plks', label: 'PLKS issued', hint: 'Work permit (PLKS / VP(TE)) endorsed.' },
] as const
export type HiringStepKey = (typeof HIRING_STEPS)[number]['key']
export interface HiringCase {
  id: string; title: string; companyId?: string; outletId?: string; job?: string; count: number
  nationality?: string; agent?: string; candidateNames?: string
  steps: Partial<Record<HiringStepKey, HiringStep>>
  /** worker profile created once the worker arrives */
  workerIds?: string[]
  closed?: boolean; notes?: string; createdAt: string
}
export interface HiringConfig { items: HiringCase[] }
export const DEFAULT_HIRING: HiringConfig = { items: [] }

export interface HiringIssue { level: 'red' | 'amber' | 'info'; text: string; date?: string }
export function hiringIssues(c: HiringCase, today = todayISO()): HiringIssue[] {
  const out: HiringIssue[] = []
  const s = c.steps || {}
  if (c.closed) return out
  const advert = s.advert
  if (advert?.date) {
    const ends = addDays(advert.date, 14)
    if (s.quota?.date && s.quota.date < ends) out.push({ level: 'amber', text: `Quota applied on ${fmtDate(s.quota.date)} — before the 14-day advert ended (${fmtDate(ends)}). ${CHECK}.` })
    else if (!s.advert?.done && today < ends) out.push({ level: 'info', text: `Advert runs until ${fmtDate(ends)}.`, date: ends })
  }
  if (s.quota?.done && !s.interview?.done) out.push({ level: 'amber', text: 'Quota done but no record of local interviews — keep the interview record for inspections.' })
  if (s.arrival?.date && !s.fomema?.done) {
    const due = addDays(s.arrival.date, 30)
    const n = daysUntil(due)!
    out.push({ level: n < 7 ? 'red' : 'amber', text: `FOMEMA medical due by ${fmtDate(due)} (${n < 0 ? `${-n} day(s) overdue` : `${n} day(s) left`}).`, date: due })
  }
  if (s.fomema?.done && !s.plks?.done) out.push({ level: 'info', text: 'FOMEMA done — follow up the PLKS endorsement.' })
  return out
}
export const hiringProgress = (c: HiringCase) => HIRING_STEPS.filter((st) => c.steps?.[st.key]?.done).length

/* ---------------- tracker rules (editable) ---------------- */
export interface TrackersConfig {
  /** outlet / business types treated as an office (soft warning for PLKS workers) */
  officeTypes: string[]
  /** job titles treated as front-of-house / front liner (soft warning) */
  frontRoles: string[]
  jobMatchOn: boolean
  /** 10-year total stay cap */
  stayCapYears: number; stayWarnYears: number; stayHighYears: number
  plksLeadDays: number; passportWarnMonths: number; passportMinMonths: number; fomemaEveryMonths: number; bondMinMonths: number
  /** company targets for absconding reports (days after the worker was last seen) */
  abscondPoliceDays: number; abscondImmigrationDays: number
  inspectEveryMonths: number
  /** default amounts for the cost tracker */
  costDefaults: Record<string, number>
}
export const DEFAULT_TRACKERS: TrackersConfig = {
  officeTypes: ['Accounting', 'Management'],
  frontRoles: ['Cashier', 'Front Desk', 'Receptionist', 'Sales Assistant', 'Shop Assistant', 'Waiter'],
  jobMatchOn: true,
  stayCapYears: 10, stayWarnYears: 9, stayHighYears: 9.5,
  plksLeadDays: 90, passportWarnMonths: 15, passportMinMonths: 12, fomemaEveryMonths: 12, bondMinMonths: 18,
  abscondPoliceDays: 3, abscondImmigrationDays: 14,
  inspectEveryMonths: 6,
  costDefaults: { Levy: 1850 },
}

/* ---------------- worker-level records ---------------- */
export const COST_TYPES = ['Levy', 'FOMEMA', 'Insurance (SPIKPA / hospitalisation)', 'Visa / VDR', 'Work permit (PLKS)', 'Security bond', 'Flight ticket', 'Agent fee', 'Recruitment / processing fee', 'Other'] as const
/** costs that must not be paid by the worker (zero-cost / Employer Pays Principle) */
export const RECRUITMENT_COSTS = ['Levy', 'Visa / VDR', 'Work permit (PLKS)', 'Security bond', 'Agent fee', 'Recruitment / processing fee']
export interface CostRec { id: string; date: string; type: string; amount: number; paidBy: 'Company' | 'Worker' | 'Agent'; notes?: string; refunded?: boolean }

export interface FlowStep { done?: boolean; date?: string; ref?: string; note?: string }
export interface ExitFlow { kind: 'exit' | 'abscond'; started: string; lastSeen?: string; steps: Record<string, FlowStep>; closed?: boolean }
export const EXIT_STEPS = [
  { key: 'memo', label: 'Exit / checkout memo signed', hint: 'Prepare the exit clearance memo in the Contract & exit tab.' },
  { key: 'finalPay', label: 'Final pay settled', hint: 'Last wages, unused leave, OT and any agreed amounts paid; deductions within the legal limit.' },
  { key: 'passport', label: 'Passport returned to the worker', hint: 'The passport belongs to the worker — give it back and record it.' },
  { key: 'ticket', label: 'Flight ticket home', hint: 'Book the ticket home (normally paid by the employer for repatriation — ' + CHECK + ').' },
  { key: 'com', label: 'Check Out Memo (COM) from Immigration', hint: 'Apply for the Check Out Memo through FWCMS / Immigration before the worker leaves. The security bond can be claimed back with it.' },
  { key: 'cancel', label: 'Work permit (PLKS) cancelled', hint: 'Cancel the PLKS so the levy and quota are updated.' },
] as const
export const ABSCOND_STEPS = [
  { key: 'search', label: 'Tried to contact the worker', hint: 'Call, message, ask friends at the hostel. Write down what you did.' },
  { key: 'police', label: 'Police report made', hint: 'Make a police report and keep the certified copy.' },
  { key: 'immigration', label: 'Reported to Immigration (FWCMS eRUNAWAY or in person)', hint: 'Online: FWCMS eRUNAWAY with the police report, SSM, director IC, insurance / bank guarantee and passport copy. In person: PLKS cancellation letter, abscondment form and certified police report.' },
  { key: 'cancel', label: 'Work permit (PLKS) cancelled', hint: 'Cancel the PLKS after the report.' },
  { key: 'pay', label: 'Wages owed recorded', hint: 'Work out wages owed up to the last working day and keep them on record.' },
  { key: 'levy', label: 'Levy and bond noted', hint: 'Immigration keeps (forfeits) the security bond when a worker absconds. Levy already paid is normally not refunded — ' + CHECK + '.' },
] as const

export interface ZeroCostRec { status: 'not_issued' | 'issued' | 'signed'; issuedAt?: string; signedAt?: string; language?: string; paidDeclared?: string; docId?: string }
export interface PdpaRec { status: 'not_recorded' | 'given' | 'withdrawn'; date?: string; method?: string; noticeLanguage?: string; withdrawnAt?: string; notes?: string }

/* ---------------- helpers ---------------- */
const norm = (s?: string) => (s || '').toLowerCase().replace(/\b(sdn\.?|bhd\.?|berhad|enterprise|plt|\(m\))/g, '').replace(/[^a-z0-9]/g, '')
export const sameEmployer = (a?: string, b?: string) => !!a && !!b && norm(a) === norm(b)

/** years in Malaysia counted from the first arrival date (or the join date if not recorded) */
export function stayYears(w: Worker, today = todayISO()) {
  const from = w.firstArrivalDate || w.joinDate
  if (!from) return null
  return Math.max(0, monthsBetween(from, today) / 12)
}

export function hostelIssues(h: Hostel, occupants: number, t: TrackersConfig, today = todayISO()): { level: 'red' | 'amber'; text: string; days?: number | null }[] {
  const out: { level: 'red' | 'amber'; text: string; days?: number | null }[] = []
  if (h.archived) return out
  const n = daysUntil(h.certExpiry, today)
  if (!h.certNo && !h.certExpiry) out.push({ level: 'red', text: 'No Certificate for Accommodation recorded' })
  else if (n !== null && n < 0) out.push({ level: 'red', text: `Certificate expired ${fmtDate(h.certExpiry)}`, days: n })
  else if (n !== null && n <= 60) out.push({ level: 'amber', text: `Certificate expires ${fmtDate(h.certExpiry)} (${n} day(s))`, days: n })
  if (h.capacity && occupants > h.capacity) out.push({ level: 'red', text: `Over capacity: ${occupants} workers for ${h.capacity} places` })
  const last = [...(h.inspections || [])].sort((a, b) => b.date.localeCompare(a.date))[0]
  const next = h.nextInspection || (last ? addMonths(last.date, t.inspectEveryMonths) : undefined)
  const ni = daysUntil(next, today)
  if (!last && !h.nextInspection) out.push({ level: 'amber', text: 'No inspection recorded yet' })
  else if (ni !== null && ni < 0) out.push({ level: 'amber', text: `Inspection overdue since ${fmtDate(next)}`, days: ni })
  if (last && last.result !== 'Passed' && !(h.inspections || []).some((x) => x.date > last.date)) out.push({ level: last.result === 'Failed' ? 'red' : 'amber', text: `Last inspection ${fmtDate(last.date)}: ${last.result.toLowerCase()}` })
  return out
}

export interface OutletRiskPart { key: string; label: string; count: number; weight: number; points: number }
export interface OutletRisk { outletId: string; name: string; workers: number; score: number; level: 'Low' | 'Medium' | 'High'; parts: OutletRiskPart[] }
export const RISK_WEIGHTS: { key: string; label: string; weight: number; pay?: boolean }[] = [
  { key: 'passport', label: 'Passports held (no consent counts most)', weight: 20 },
  { key: 'latepay', label: 'Late or unpaid wages', weight: 15, pay: true },
  { key: 'ot', label: 'Overtime over the limit', weight: 10, pay: true },
  { key: 'deduct', label: 'Deduction problems', weight: 10, pay: true },
  { key: 'hostel', label: 'Hostel problems', weight: 15 },
  { key: 'complaints', label: 'Open complaints', weight: 15 },
  { key: 'expiry', label: 'Expired or due permits & documents', weight: 15 },
]
export const riskLevel = (score: number): OutletRisk['level'] => (score >= 45 ? 'High' : score >= 20 ? 'Medium' : 'Low')

/** due date of the next FOMEMA exam: expiry if set, else 12 months after the exam (issue) date */
export function fomemaDue(w: Worker, t: TrackersConfig): string | undefined {
  const docs = w.documents.filter((d) => d.type === 'FOMEMA Medical')
  const last = docs.sort((a, b) => (b.issueDate || b.expiryDate || '').localeCompare(a.issueDate || a.expiryDate || ''))[0]
  if (!last) return undefined
  return last.expiryDate || (last.issueDate ? addMonths(last.issueDate, t.fomemaEveryMonths) : undefined)
}

export function outletOfWorker(outlets: Outlet[], w: Worker) { return outlets.find((o) => o.id === w.outletId) }
