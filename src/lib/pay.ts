/* Pay & contribution compliance (Malaysia). Every rate is effective-dated and editable in
 * Settings → Pay & Leave rules; the built-in values below are the defaults as of Oct 2026.
 * Calculations are helpers, not legal advice: uncertain points say "check with JTKSM or your agent". */
import type { Worker } from './types'
import { addDays, parseISO, rm, todayISO, toISO } from './util'

export interface Dated { from: string; note?: string }
export interface MinWageRate extends Dated { monthly: number; hourly: number; daily6: number; daily5: number; daily4: number }
export interface EpfRate extends Dated { employee: number; employer: number }
export interface SocsoRate extends Dated { employer: number; employee: number; ceiling: number }
export interface LindungRate extends Dated { employee: number; ceiling: number }
export interface HostelCapRate extends Dated { amount: number }
export interface OtRule extends Dated { normal: number; restOt: number; phDayExtra: number; phOt: number; capHours: number; hoursPerDay: number; daysPerMonth: number; weeklyHours: number }
export interface LeaveTier { minYears: number; annual: number; sick: number }
export interface LeaveRules { tiers: LeaveTier[]; hospital: number; maternity: number; paternity: number; paternityMinMonths: number }
export interface RatesConfig {
  minWage: MinWageRate[]; epf: EpfRate[]; socso: SocsoRate[]; lindung: LindungRate[]; hostelCap: HostelCapRate[]; ot: OtRule[]
  payDays: number; deductionCapPct: number; leave: LeaveRules
}

export const DEFAULT_RATES: RatesConfig = {
  minWage: [
    { from: '2022-05-01', monthly: 1500, hourly: 7.21, daily6: 57.69, daily5: 69.23, daily4: 86.54, note: 'Minimum Wages Order 2022' },
    { from: '2025-02-01', monthly: 1700, hourly: 8.72, daily6: 65.38, daily5: 78.46, daily4: 98.08, note: 'Minimum Wages Order 2024 (employers with fewer than 5 workers: from 1 Aug 2025)' },
  ],
  epf: [{ from: '2025-10-01', employee: 2, employer: 2, note: 'Foreign workers, from October 2025 wages. Each share is rounded up to the next ringgit.' }],
  socso: [
    { from: '2019-01-01', employer: 1.25, employee: 0, ceiling: 5000, note: 'Employment Injury only' },
    { from: '2024-07-01', employer: 1.75, employee: 0.5, ceiling: 5000, note: 'Employment Injury 1.25% + Invalidity 0.5% (employer); Invalidity 0.5% (worker)' },
    { from: '2024-10-01', employer: 1.75, employee: 0.5, ceiling: 6000, note: 'Wage ceiling RM6,000' },
  ],
  lindung: [
    { from: '2026-06-01', employee: 0.75, ceiling: 6000, note: 'LINDUNG 24 Jam — paid by the worker' },
    { from: '2028-06-01', employee: 1.0, ceiling: 6000, note: 'Planned step' },
    { from: '2031-06-01', employee: 1.25, ceiling: 6000, note: 'Planned step' },
  ],
  hostelCap: [
    { from: '2020-06-01', amount: 100, note: 'Act 446 deduction limit' },
    { from: '2026-03-01', amount: 150, note: 'P.U.(A) 49/2026' },
  ],
  ot: [{ from: '2022-09-01', normal: 1.5, restOt: 2, phDayExtra: 2, phOt: 3, capHours: 104, hoursPerDay: 8, daysPerMonth: 26, weeklyHours: 45, note: 'Employment Act 1955 s.60, s.60A, s.60D' }],
  payDays: 7,
  deductionCapPct: 50,
  leave: {
    tiers: [{ minYears: 0, annual: 8, sick: 14 }, { minYears: 2, annual: 12, sick: 18 }, { minYears: 5, annual: 16, sick: 22 }],
    hospital: 60, maternity: 98, paternity: 7, paternityMinMonths: 12,
  },
}

/** latest entry whose start date is on or before the date */
export function rateAt<T extends Dated>(list: T[] | undefined, date: string): T | undefined {
  return [...(list || [])].filter((r) => r.from && r.from <= date).sort((a, b) => a.from.localeCompare(b.from)).pop()
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
/** EPF share: wages × rate, rounded UP to the next whole ringgit (e.g. RM1,751 × 2% = 35.02 → RM36) */
export const epfShare = (wages: number, pct: number) => (wages > 0 && pct > 0 ? Math.ceil(r2((wages * pct) / 100) - 1e-9) : 0)

/* ---------- months & dates ---------- */
export const monthEnd = (month: string) => { const [y, m] = month.split('-').map(Number); return toISO(new Date(y, m, 0)) }
export const monthStart = (month: string) => `${month}-01`
/** month before the given date or YYYY-MM month */
export const prevMonth = (iso = todayISO()) => { const d = parseISO(iso.length === 7 ? iso + '-01' : iso) || new Date(); return toISO(new Date(d.getFullYear(), d.getMonth() - 1, 1)).slice(0, 7) }
export const monthLabel = (month: string) => { const d = parseISO(month + '-01'); return d ? d.toLocaleDateString('en-MY', { month: 'long', year: 'numeric' }) : month }
/** wages due: the 7th day after the end of the wage period (s.19) */
export const wageDueDate = (month: string, r: RatesConfig) => addDays(monthEnd(month), r.payDays)
/** OT / rest-day / public-holiday pay: by the last day of the next wage period (s.19(1A)) */
export const otDueDate = (month: string) => { const [y, m] = month.split('-').map(Number); return toISO(new Date(y, m + 1, 0)) }

/* ---------- worker pay fields ---------- */
export interface HostelDeduction { amount?: number; writtenRequest?: boolean; requestDate?: string; dgApproval?: boolean; approvalRef?: string; contractAmount?: number; freeInContract?: boolean }
export interface PayslipRec {
  id: string; month: string
  basic: number; unpaidDays?: number; allowances?: number; otherEarnings?: number
  otNormalH?: number; restHalfDays?: number; restFullDays?: number; otRestH?: number; phDays?: number; otPhH?: number
  hostel?: number; advance?: number; loanRepay?: number; otherDeductions?: number
  epfOn?: boolean; socsoOn?: boolean; lindungOn?: boolean
  payDate?: string; otPayDate?: string; state?: string
  notes?: string; savedAt?: string; savedBy?: string
}

export const EAST_MALAYSIA = ['Sabah', 'Sarawak']

export interface PayWarning { key: 'minwage' | 'ot' | 'late' | 'otlate' | 'deduct' | 'hostel' | 'info'; level: 'red' | 'amber' | 'info'; text: string; source: string }
export interface PayResult {
  orpDaily: number; orpHourly: number
  basicEarned: number; unpaid: number
  otNormal: number; restDay: number; restOt: number; phDay: number; phOt: number; otTotal: number; otHours: number
  gross: number; epfWages: number
  epfEe: number; epfEr: number; socsoEe: number; socsoEr: number; lindung: number
  statutory: number; otherDeductions: number; net: number; employerCost: number
  minWage?: MinWageRate; hostelCap?: number; wageDue: string; otDue: string
  warnings: PayWarning[]
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** hostel certificate on file and valid at the date? (doc type "Hostel / Accommodation") */
export function hostelCertValid(w: Pick<Worker, 'documents'> | undefined, date: string) {
  return !!w?.documents?.some((d) => d.type === 'Hostel / Accommodation' && (!d.expiryDate || d.expiryDate >= date))
}

export function computePayslip(p: PayslipRec, rates: RatesConfig, w?: Worker, today = todayISO()): PayResult {
  const end = monthEnd(p.month)
  const ot = rateAt(rates.ot, end) || DEFAULT_RATES.ot[0]
  const basic = num(p.basic)
  const orpDaily = r2(basic / (ot.daysPerMonth || 26))
  const orpHourly = r2(orpDaily / (ot.hoursPerDay || 8))
  const unpaid = r2(orpDaily * num(p.unpaidDays))
  const basicEarned = Math.max(0, r2(basic - unpaid))
  const otNormal = r2(orpHourly * ot.normal * num(p.otNormalH))
  const restDay = r2(orpDaily * 0.5 * num(p.restHalfDays) + orpDaily * num(p.restFullDays))
  const restOt = r2(orpHourly * ot.restOt * num(p.otRestH))
  const phDay = r2(orpDaily * ot.phDayExtra * num(p.phDays))
  const phOt = r2(orpHourly * ot.phOt * num(p.otPhH))
  const otTotal = r2(otNormal + restDay + restOt + phDay + phOt)
  const otHours = num(p.otNormalH) + num(p.otRestH) + num(p.otPhH)
  const fixed = basicEarned + num(p.allowances) + num(p.otherEarnings)
  const gross = r2(fixed + otTotal)
  const epf = rateAt(rates.epf, end)
  const epfWages = r2(fixed) // EPF wages exclude overtime
  const epfOn = p.epfOn !== false && !!epf
  const epfEe = epfOn ? epfShare(epfWages, epf!.employee) : 0
  const epfEr = epfOn ? epfShare(epfWages, epf!.employer) : 0
  const so = rateAt(rates.socso, end)
  const soBase = so ? Math.min(gross, so.ceiling) : 0
  const socsoOn = p.socsoOn !== false && !!so
  const socsoEe = socsoOn ? r2((soBase * so!.employee) / 100) : 0
  const socsoEr = socsoOn ? r2((soBase * so!.employer) / 100) : 0
  const li = rateAt(rates.lindung, end)
  const lindung = p.lindungOn !== false && li ? r2((Math.min(gross, li.ceiling) * li.employee) / 100) : 0
  const statutory = r2(epfEe + socsoEe + lindung)
  const otherDeductions = r2(num(p.hostel) + num(p.advance) + num(p.loanRepay) + num(p.otherDeductions))
  const net = r2(gross - statutory - otherDeductions)
  const employerCost = r2(gross + epfEr + socsoEr)
  const mw = rateAt(rates.minWage, end)
  const capRate = rateAt(rates.hostelCap, end)
  const wageDue = wageDueDate(p.month, rates)
  const otDue = otDueDate(p.month)
  const warnings: PayWarning[] = []
  const warn = (key: PayWarning['key'], level: PayWarning['level'], text: string, source: string) => warnings.push({ key, level, text, source })

  // minimum wage (monthly basic for a full month)
  if (mw && basic > 0 && basic < mw.monthly) {
    if (w?.minWageExempt) warn('info', 'info', `Basic pay ${rm(basic)} is below the minimum wage ${rm(mw.monthly)}, but this worker is marked exempt${w.minWageExemptReason ? ` (${w.minWageExemptReason})` : ''}.`, 'Minimum Wages Order — check with JTKSM or your agent')
    else warn('minwage', 'red', `Basic pay ${rm(basic)} is below the minimum wage of ${rm(mw.monthly)} a month (from ${fmt(mw.from)}).`, `${mw.note || 'Minimum Wages Order'} — check with JTKSM or your agent`)
  }
  // overtime hours
  if (otHours > ot.capHours) warn('ot', 'red', `${otHours} overtime hours — more than the ${ot.capHours}-hour monthly limit.`, 'Employment (Limitation of Overtime Work) Regulations 1980')
  else if (otHours >= ot.capHours * 0.9) warn('ot', 'amber', `${otHours} overtime hours — close to the ${ot.capHours}-hour monthly limit.`, 'Employment (Limitation of Overtime Work) Regulations 1980')
  // pay timing
  if (p.payDate && p.payDate > wageDue) warn('late', 'red', `Wages paid on ${fmt(p.payDate)} — late. They were due by ${fmt(wageDue)}.`, 'Employment Act 1955 s.19')
  else if (!p.payDate && today > wageDue) warn('late', 'red', `No pay date recorded — wages were due by ${fmt(wageDue)}.`, 'Employment Act 1955 s.19')
  const otPaid = p.otPayDate || p.payDate
  if (otTotal > 0 && otPaid && otPaid > otDue) warn('otlate', 'red', `Overtime / rest-day / holiday pay paid on ${fmt(otPaid)} — due by ${fmt(otDue)}.`, 'Employment Act 1955 s.19(1A)')
  // deductions
  const capAmt = r2((gross * rates.deductionCapPct) / 100)
  if (gross > 0 && otherDeductions > capAmt) warn('deduct', 'red', `Deductions ${rm(otherDeductions)} are more than ${rates.deductionCapPct}% of wages (${rm(capAmt)}).`, 'Employment Act 1955 s.24 — EPF, PERKESO and LINDUNG are not counted; check with JTKSM or your agent')
  // hostel / accommodation
  const hostel = num(p.hostel)
  if (hostel > 0) {
    const hd = w?.hostelDeduction
    const state = p.state
    if (state && EAST_MALAYSIA.includes(state)) warn('info', 'info', `Act 446 deduction limits apply in Peninsular Malaysia and Labuan only. For ${state}, check with JTKSM or your agent.`, 'Act 446')
    else {
      if (capRate && hostel > capRate.amount) warn('hostel', 'red', `Accommodation deduction ${rm(hostel)} is more than the ${rm(capRate.amount)} monthly limit.`, `${capRate.note || 'Act 446'} — check with JTKSM or your agent`)
      if (hd?.freeInContract) warn('hostel', 'red', 'The contract says accommodation is free, so nothing may be deducted for it.', 'Act 446 — check with JTKSM or your agent')
      else if (hd?.contractAmount && hostel > hd.contractAmount) warn('hostel', 'red', `Deduction ${rm(hostel)} is more than the amount in the contract (${rm(hd.contractAmount)}).`, 'Act 446 — check with JTKSM or your agent')
      if (w && !hostelCertValid(w, end)) warn('hostel', 'amber', 'No valid Certificate for Accommodation on file (document type "Hostel / Accommodation").', 'Act 446 — a deduction needs a valid certificate')
      if (!hd?.writtenRequest) warn('hostel', 'amber', 'No written request from the worker for the accommodation deduction is recorded.', 'Employment Act 1955 s.24(4) — check with JTKSM or your agent')
      if (!hd?.dgApproval) warn('hostel', 'amber', 'Director General (JTKSM) approval for the deduction is not recorded.', 'Employment Act 1955 s.24(4) — check with JTKSM or your agent')
    }
  }
  if (lindung > 0) warn('info', 'info', `LINDUNG 24 Jam ${li!.employee}% (${rm(lindung)}) is deducted from the worker for non-work accidents.`, 'PERKESO — check with PERKESO')
  return { orpDaily, orpHourly, basicEarned, unpaid, otNormal, restDay, restOt, phDay, phOt, otTotal, otHours, gross, epfWages, epfEe, epfEr, socsoEe, socsoEr, lindung, statutory, otherDeductions, net, employerCost, minWage: mw, hostelCap: capRate?.amount, wageDue, otDue, warnings }
}
function fmt(iso?: string) { const d = parseISO(iso); return d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—' }

/* ---------- OT quick calculator ---------- */
export function otQuick(basic: number, hours: { normal?: number; rest?: number; ph?: number }, rates: RatesConfig, date = todayISO()) {
  const ot = rateAt(rates.ot, date) || DEFAULT_RATES.ot[0]
  const daily = r2(basic / ot.daysPerMonth); const hourly = r2(daily / ot.hoursPerDay)
  const normal = r2(hourly * ot.normal * num(hours.normal)); const rest = r2(hourly * ot.restOt * num(hours.rest)); const ph = r2(hourly * ot.phOt * num(hours.ph))
  const total = num(hours.normal) + num(hours.rest) + num(hours.ph)
  return { daily, hourly, normal, rest, ph, pay: r2(normal + rest + ph), hours: total, over: total > ot.capHours, cap: ot.capHours, rule: ot }
}

/* ---------- leave by length of service ---------- */
export function serviceYears(joinDate?: string, at = todayISO()) {
  const a = parseISO(joinDate); const b = parseISO(at)
  if (!a || !b || b < a) return 0
  let y = b.getFullYear() - a.getFullYear()
  if (b.getMonth() < a.getMonth() || (b.getMonth() === a.getMonth() && b.getDate() < a.getDate())) y--
  return Math.max(0, y)
}
export function statutoryLeave(joinDate: string | undefined, rates: RatesConfig, at = todayISO()) {
  const yrs = serviceYears(joinDate, at)
  const tiers = [...rates.leave.tiers].sort((a, b) => a.minYears - b.minYears)
  const tier = tiers.filter((t) => yrs >= t.minYears).pop() || tiers[0]
  const months = joinDate ? Math.max(0, Math.floor((Date.parse(at) - Date.parse(joinDate)) / (30.44 * 86400000))) : 0
  return { years: yrs, annual: tier?.annual ?? 8, sick: tier?.sick ?? 14, hospital: rates.leave.hospital, maternity: rates.leave.maternity, paternity: rates.leave.paternity, paternityEligible: months >= rates.leave.paternityMinMonths, tier }
}
/** statutory annual leave for a calendar year (service completed on 1 Jan, or on the join date in the joining year) */
export function statutoryAnnualForYear(joinDate: string, year: number, rates: RatesConfig) {
  const at = `${year}-01-01` < joinDate ? joinDate : `${year}-01-01`
  return statutoryLeave(joinDate, rates, at).annual
}

/* ---------- public holidays ---------- */
export const STATES = ['Johor', 'Kedah', 'Kelantan', 'Melaka', 'Negeri Sembilan', 'Pahang', 'Penang', 'Perak', 'Perlis', 'Sabah', 'Sarawak', 'Selangor', 'Terengganu', 'Kuala Lumpur', 'Labuan', 'Putrajaya'] as const
export const REST_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export interface Holiday { id: string; date: string; name: string; states: string[] /* ['*'] = nationwide */ }
export interface HolidaysConfig { years: Record<string, Holiday[]>; source?: string }

const AB: Record<string, string> = { JHR: 'Johor', KDH: 'Kedah', KTN: 'Kelantan', MLK: 'Melaka', NSN: 'Negeri Sembilan', PHG: 'Pahang', PNG: 'Penang', PRK: 'Perak', PLS: 'Perlis', SBH: 'Sabah', SWK: 'Sarawak', SGR: 'Selangor', TRG: 'Terengganu', KUL: 'Kuala Lumpur', LBN: 'Labuan', PJY: 'Putrajaya' }
const ALL_ABS = Object.keys(AB)
const H2026: [string, string, string][] = [
  ['01-01', 'New Year’s Day', 'KUL LBN MLK NSN PHG PNG PRK PJY SBH SWK SGR'],
  ['01-14', 'Birthday of the Yang di-Pertuan Besar of Negeri Sembilan', 'NSN'],
  ['01-17', 'Israk and Mikraj', 'KDH NSN PLS TRG'],
  ['01-18', 'Israk and Mikraj (holiday)', 'TRG'],
  ['02-01', 'Federal Territory Day', 'KUL LBN PJY'],
  ['02-01', 'Thaipusam', 'JHR KUL NSN PNG PRK PJY SGR'],
  ['02-02', 'Thaipusam (holiday)', 'JHR KUL NSN PNG PRK PJY SGR'],
  ['02-03', 'Federal Territory Day (holiday)', 'KUL LBN PJY'],
  ['02-17', 'Chinese New Year', '*'],
  ['02-18', 'Chinese New Year (second day)', '*'],
  ['02-19', 'Awal Ramadan', 'JHR KDH'],
  ['02-20', 'Independence Declaration Day', 'MLK'],
  ['03-04', 'Installation of the Sultan of Terengganu', 'TRG'],
  ['03-07', 'Nuzul Al-Quran', 'KTN KUL LBN PHG PNG PRK PLS PJY SGR TRG'],
  ['03-08', 'Nuzul Al-Quran (holiday)', 'KTN TRG'],
  ['03-20', 'Hari Raya Aidilfitri (holiday)', '*'],
  ['03-21', 'Hari Raya Aidilfitri', '*'],
  ['03-22', 'Hari Raya Aidilfitri (second day)', '*'],
  ['03-23', 'Hari Raya Aidilfitri (holiday)', 'JHR KTN MLK NSN PHG PNG PRK PLS SBH SWK SGR TRG KUL LBN PJY'],
  ['03-23', 'Birthday of the Sultan of Johor', 'JHR'],
  ['03-24', 'Hari Raya Aidilfitri (holiday)', 'JHR'],
  ['03-30', 'Birthday of the Governor of Sabah', 'SBH'],
  ['04-03', 'Good Friday', 'SBH SWK'],
  ['04-26', 'Birthday of the Sultan of Terengganu', 'TRG'],
  ['05-01', 'Labour Day', '*'],
  ['05-03', 'Labour Day (holiday)', 'KDH'],
  ['05-17', 'Birthday of the Raja of Perlis', 'PLS'],
  ['05-18', 'Birthday of the Raja of Perlis (holiday)', 'PLS'],
  ['05-22', 'Hari Hol Pahang', 'PHG'],
  ['05-26', 'Arafat Day', 'KTN TRG'],
  ['05-27', 'Hari Raya Haji', '*'],
  ['05-28', 'Hari Raya Haji (holiday)', 'KDH KTN PLS TRG'],
  ['05-30', 'Pesta Kaamatan', 'LBN SBH'],
  ['05-31', 'Pesta Kaamatan (second day)', 'LBN SBH'],
  ['05-31', 'Wesak Day', '*'],
  ['06-01', 'Birthday of the Yang di-Pertuan Agong', '*'],
  ['06-01', 'Hari Gawai', 'SWK'],
  ['06-02', 'Hari Gawai (second day)', 'SWK'],
  ['06-02', 'Wesak Day (holiday)', 'JHR KUL LBN MLK NSN PHG PNG PRK PLS PJY SBH SGR'],
  ['06-03', 'Pesta Kaamatan (holiday)', 'LBN SBH'],
  ['06-03', 'Wesak Day (holiday)', 'SWK'],
  ['06-04', 'Hari Gawai (holiday)', 'SWK'],
  ['06-17', 'Awal Muharram', '*'],
  ['06-21', 'Birthday of the Sultan of Kedah', 'KDH'],
  ['07-07', 'George Town World Heritage City Day', 'PNG'],
  ['07-11', 'Birthday of the Governor of Penang', 'PNG'],
  ['07-21', 'Hari Hol Almarhum Sultan Iskandar', 'JHR'],
  ['07-22', 'Sarawak Day', 'SWK'],
  ['07-31', 'Birthday of the Sultan of Pahang', 'PHG'],
  ['08-24', 'Birthday of the Governor of Melaka', 'MLK'],
  ['08-25', 'Maulidur Rasul', '*'],
  ['08-31', 'National Day (Merdeka)', '*'],
  ['09-16', 'Malaysia Day', '*'],
  ['09-29', 'Birthday of the Sultan of Kelantan', 'KTN'],
  ['09-30', 'Birthday of the Sultan of Kelantan (holiday)', 'KTN'],
  ['10-10', 'Birthday of the Governor of Sarawak', 'SWK'],
  ['10-25', 'Silver Jubilee of the Sultan of Selangor', 'SGR'],
  ['10-26', 'Silver Jubilee of the Sultan of Selangor (holiday)', 'SGR'],
  ['11-06', 'Birthday of the Sultan of Perak', 'PRK'],
  ['11-08', 'Deepavali', ALL_ABS.filter((s) => s !== 'SWK').join(' ')],
  ['11-09', 'Deepavali (holiday)', ALL_ABS.filter((s) => !['KDH', 'KTN', 'SWK', 'TRG'].includes(s)).join(' ')],
  ['12-11', 'Birthday of the Sultan of Selangor', 'SGR'],
  ['12-24', 'Christmas Eve', 'SBH'],
  ['12-25', 'Christmas Day', '*'],
  ['12-27', 'Christmas Day (holiday)', 'KDH'],
]
export const BUILTIN_HOLIDAYS: Record<string, Holiday[]> = {
  '2026': H2026.map(([d, name, st], i) => ({ id: `h26-${i}`, date: `2026-${d}`, name, states: st === '*' ? ['*'] : st.split(' ').map((s) => AB[s]) })),
}
export const DEFAULT_HOLIDAYS: HolidaysConfig = { years: BUILTIN_HOLIDAYS, source: 'Built-in list for 2026 (official gazette as published). Check your state’s gazette for changes.' }

export const holidaysFor = (cfg: HolidaysConfig, year: number | string, state?: string) =>
  (cfg.years[String(year)] || []).filter((h) => !state || h.states.includes('*') || h.states.includes(state)).sort((a, b) => a.date.localeCompare(b.date))

/** If a holiday falls on the outlet's rest day, the next working day is the replacement (s.60D(1)(b)). */
export function replacementDay(date: string, restDay = 'Sunday', taken: string[] = []) {
  const d = parseISO(date)
  if (!d || REST_DAYS[d.getDay()] !== restDay) return undefined
  let n = addDays(date, 1)
  for (let i = 0; i < 7 && (taken.includes(n) || REST_DAYS[parseISO(n)!.getDay()] === restDay); i++) n = addDays(n, 1)
  return n
}
