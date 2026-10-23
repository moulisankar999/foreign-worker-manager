/* Compliance health score (0–100), "today's priorities" and tips for the advice-style dashboard.
 * Plain-language, explainable: every point lost is listed in the "why" breakdown. */
import { isExited, type Alert } from './calc'
import { completeness } from './validate'
import type { Agency } from './agencies'
import type { Outlet, Worker } from './types'
import { getConfig } from './config'
import { minWageFor, monthLabel, prevMonth, rateAt, wageDueDate } from './pay'
import { parseISO, rm0, todayISO } from './util'

export const PERMIT = 'Work Permit / PLKS (VP(TE))'
export const FOMEMA = 'FOMEMA Medical'
export const INSURANCE = 'Insurance (SPIKPA / Hospitalisation)'

export interface ScoreLine { key: string; label: string; affected: number; lost: number; max: number; tip: string; pay?: boolean }
export interface Score { score: number | null; total: number; lines: ScoreLine[]; tone: 'green' | 'amber' | 'red' | 'gray'; label: string }

const RULES: { key: string; label: string; max: number; tip: string; pay?: boolean; hit: (w: Worker, a: Alert[]) => boolean }[] = [
  { key: 'permit', label: 'Work permit (PLKS) expired', max: 25, tip: 'Renew in FWCMS now. A worker without a valid permit should not be working.', hit: (_w, a) => a.some((x) => x.category === PERMIT && (x.days ?? 0) < 0) },
  { key: 'expired', label: 'Passport, FOMEMA or insurance expired', max: 12, tip: 'Renew the expired document — the permit renewal needs them.', hit: (_w, a) => a.some((x) => ['Passport', FOMEMA, INSURANCE].includes(x.category) && (x.days ?? 0) < 0) },
  { key: 'soon', label: 'Key document expires within 60 days', max: 8, tip: 'Start the renewal now so there is no gap.', hit: (_w, a) => a.some((x) => [PERMIT, 'Passport', FOMEMA, INSURANCE].includes(x.category) && x.days !== null && x.days >= 0 && x.days <= 60) },
  { key: 'missing', label: 'Required document missing', max: 12, tip: 'Add the passport, permit, FOMEMA and insurance records for every worker.', hit: (_w, a) => a.some((x) => x.category === 'Missing document') },
  { key: 'passport', label: 'Passport kept without signed consent', max: 12, tip: 'Keep a passport only with the worker’s signed consent, and return it when he asks.', hit: (_w, a) => a.some((x) => x.id.startsWith('ppnoconsent-')) },
  { key: 'overdue', label: 'Not back from leave', max: 5, tip: 'Contact the worker. If he has absconded, report it — check with JTKSM or your agent.', hit: (_w, a) => a.some((x) => x.category === 'Overdue return') },
  { key: 'hostel', label: 'Hostel certificate missing / expired or over capacity', max: 4, tip: 'Workers’ housing needs a valid Certificate for Accommodation (Act 446) and must not be over capacity. See Compliance → Hostels.', hit: (_w, a) => a.some((x) => x.category === 'Hostel') },
  { key: 'stay', label: 'At or near the 10-year stay limit', max: 2, tip: 'Plan the exit or replacement of workers close to the 10-year limit. Check with JTKSM or your agent.', hit: (_w, a) => a.some((x) => x.category === '10-year stay' && (x.severity === 'critical' || x.severity === 'high')) },
  { key: 'profile', label: 'Profile incomplete', max: 4, tip: 'Fill in the missing details so letters and forms are correct.', hit: () => false },
  { key: 'checks', label: 'Status not checked on time', max: 4, tip: 'Open the worker → Check status, check on the official site and record the result.', hit: (_w, a) => a.some((x) => x.category === 'Status check') },
  { key: 'minwage', pay: true, label: 'Paid below minimum wage', max: 8, tip: 'Raise the basic pay to at least the minimum wage, or record why the worker is exempt. Check with JTKSM or your agent.', hit: (_w, a) => a.some((x) => x.id.startsWith('pay-minwage-') && !x.id.startsWith('pay-minwage-next-')) },
  { key: 'latepay', pay: true, label: 'Wages late or not recorded as paid', max: 5, tip: 'Pay wages within 7 days after the month ends and record the pay date on the payslip.', hit: (_w, a) => a.some((x) => x.id.startsWith('pay-late-')) },
  { key: 'deduct', pay: true, label: 'Deductions or hostel charge over the limit', max: 3, tip: 'Keep deductions within 50% of wages and the hostel charge within the Act 446 limit, with the paperwork on file.', hit: (_w, a) => a.some((x) => x.id.startsWith('pay-deduct-') || x.id.startsWith('pay-hostel-')) },
  { key: 'ot', pay: true, label: 'Overtime over 104 hours a month', max: 1, tip: 'Plan rosters so nobody works more than 104 overtime hours in a month.', hit: (_w, a) => a.some((x) => x.id.startsWith('pay-ot-')) },
  { key: 'leave', pay: true, label: 'Annual leave set below the legal minimum', max: 1, tip: 'Annual leave is at least 8, 12 or 16 days a year depending on length of service. Update the worker’s leave setting.', hit: (_w, a) => a.some((x) => x.id.startsWith('pay-leave-')) },
]

/** score for a group of workers (company, outlet or everyone) */
/** opts.pay = false when the viewer may not see pay (outlet managers): pay lines are left out and the score is rescaled to 100 */
export function healthScore(workers: Worker[], alerts: Alert[], outlets: Outlet[], opts: { pay?: boolean } = {}): Score {
  const rules = RULES.filter((r) => opts.pay !== false || !r.pay)
  const maxSum = rules.reduce((t, r) => t + r.max, 0)
  const act = workers.filter((w) => !isExited(w))
  if (!act.length) return { score: null, total: 0, lines: [], tone: 'gray', label: 'No workers yet' }
  const byW = new Map<string, Alert[]>()
  for (const a of alerts) { const l = byW.get(a.workerId); if (l) l.push(a); else byW.set(a.workerId, [a]) }
  const lines = rules.map((r) => {
    const affected = act.filter((w) => r.key === 'profile' ? !completeness(w, outlets).complete : r.hit(w, byW.get(w.id) || [])).length
    // any problem costs at least 30% of that line, the rest grows with the share of workers affected
    const lost = affected ? Math.round(r.max * Math.min(1, 0.3 + 0.7 * (affected / act.length))) : 0
    return { key: r.key, label: r.label, affected, lost, max: r.max, tip: r.tip, pay: !!r.pay }
  })
  const score = Math.max(0, Math.round(100 - (lines.reduce((s, l) => s + l.lost, 0) * 100) / maxSum))
  const tone = score >= 85 ? 'green' : score >= 65 ? 'amber' : 'red'
  return { score, total: act.length, lines, tone, label: score >= 85 ? 'Good' : score >= 65 ? 'Needs attention' : 'At risk' }
}

/* ---------- Today's priorities ---------- */
export interface Action { label: string; to?: string; href?: string }
export interface Priority { id: string; rank: number; icon: string; tone: 'red' | 'amber' | 'blue' | 'teal'; text: string; detail: string; action: Action; second?: Action }

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
const within = (d: number) => (d <= 31 ? 'within a month' : d <= 62 ? 'within 2 months' : 'within 3 months')

export interface PriorityExtra { grievancesNew?: number; highRisk?: number; hiringFomema?: number }
export function priorities(alerts: Alert[], workers: Worker[], outlets: Outlet[], agencies: Agency[], opts: { om?: boolean; pay?: boolean } = {}, extra: PriorityExtra = {}): Priority[] {
  const ag = (id: string) => agencies.find((a) => a.id === id && a.enabled)
  const portal = (id: string, label: string): Action | undefined => { const a = ag(id); return a ? { label, href: a.url } : undefined }
  const uniq = (xs: Alert[]) => [...new Set(xs.map((x) => x.workerId))]
  const go = (ids: string[], tab: string, fallback: string): Action => ids.length === 1 ? { label: 'Open worker', to: `/workers/${ids[0]}?tab=${tab}` } : { label: 'See who', to: fallback }
  const out: Priority[] = []
  const of = (f: (a: Alert) => boolean) => alerts.filter(f)

  const noConsent = uniq(of((a) => a.id.startsWith('ppnoconsent-')))
  if (noConsent.length) out.push({ id: 'pp-noconsent', rank: 0, icon: '🛂', tone: 'red', text: `${plural(noConsent.length, 'passport')} ${noConsent.length === 1 ? 'is' : 'are'} in the safe without signed consent`, detail: 'Return it to the worker or get the consent form signed today (Passports Act 1966).', action: go(noConsent, 'passport', '/alerts?cat=Passport%20consent') })
  const overdue = uniq(of((a) => a.category === 'Overdue return'))
  if (overdue.length) out.push({ id: 'overdue', rank: 1, icon: '📞', tone: 'red', text: `${plural(overdue.length, 'worker has', 'workers have')} not come back from leave`, detail: 'Call them today. If a worker has absconded, report it — check with JTKSM or your agent.', action: go(overdue, 'overview', '/alerts?cat=Overdue%20return') })

  if (!opts.om) {
    const pExp = uniq(of((a) => a.category === PERMIT && (a.days ?? 0) < 0))
    if (pExp.length) out.push({ id: 'permit-expired', rank: 0, icon: '⛔', tone: 'red', text: `${plural(pExp.length, 'work permit')} ${pExp.length === 1 ? 'has' : 'have'} expired — renew in FWCMS now`, detail: 'A worker without a valid permit should not be working. Talk to your agent today.', action: portal('fwcms', 'Open FWCMS') || go(pExp, 'docs', `/alerts?cat=${encodeURIComponent(PERMIT)}`), second: go(pExp, 'docs', `/alerts?cat=${encodeURIComponent(PERMIT)}`) })
    const pSoon = of((a) => a.category === PERMIT && a.days !== null && a.days >= 0 && a.days <= 92)
    if (pSoon.length) { const max = Math.max(...pSoon.map((a) => a.days!)); const ids = uniq(pSoon); out.push({ id: 'permit-soon', rank: 2, icon: '📅', tone: 'amber', text: `${plural(ids.length, 'work permit')} expire${ids.length === 1 ? 's' : ''} ${within(max)} — start renewal in FWCMS now`, detail: 'Renewal usually opens about 3 months before expiry. Check with JTKSM or your agent.', action: portal('fwcms', 'Open FWCMS') || go(ids, 'docs', `/alerts?cat=${encodeURIComponent(PERMIT)}`), second: go(ids, 'docs', `/alerts?cat=${encodeURIComponent(PERMIT)}`) }) }
    const fom = uniq(of((a) => a.category === FOMEMA && a.days !== null && a.days <= 60))
    if (fom.length) out.push({ id: 'fomema', rank: 2, icon: '🩺', tone: 'amber', text: `${plural(fom.length, 'FOMEMA medical')} ${fom.length === 1 ? 'is' : 'are'} due or expired — book the exam`, detail: 'The permit renewal needs a fit FOMEMA result.', action: portal('fomema', 'Open FOMEMA') || go(fom, 'docs', `/alerts?cat=${encodeURIComponent(FOMEMA)}`), second: go(fom, 'docs', `/alerts?cat=${encodeURIComponent(FOMEMA)}`) })
    const pass = uniq(of((a) => a.category === 'Passport' && a.days !== null && a.days <= 92))
    if (pass.length) out.push({ id: 'passport', rank: 3, icon: '📘', tone: 'amber', text: `${plural(pass.length, 'passport')} expire${pass.length === 1 ? 's' : ''} soon — renew at the embassy`, detail: 'The permit cannot be renewed beyond the passport’s validity.', action: go(pass, 'docs', '/alerts?cat=Passport') })
    const ins = uniq(of((a) => a.category === INSURANCE && a.days !== null && a.days <= 60))
    if (ins.length) out.push({ id: 'insurance', rank: 3, icon: '💊', tone: 'amber', text: `${plural(ins.length, 'insurance policy', 'insurance policies')} (SPIKPA) due — renew the cover`, detail: 'Workers must stay insured for hospitalisation while employed.', action: portal('spikpa', 'Open SPIKPA') || go(ins, 'docs', `/alerts?cat=${encodeURIComponent(INSURANCE)}`), second: go(ins, 'docs', `/alerts?cat=${encodeURIComponent(INSURANCE)}`) })
    const miss = uniq(of((a) => a.category === 'Missing document'))
    if (miss.length) out.push({ id: 'missing', rank: 4, icon: '📄', tone: 'blue', text: `${plural(miss.length, 'worker is', 'workers are')} missing required documents`, detail: 'Add the passport, permit, FOMEMA and insurance details.', action: go(miss, 'docs', '/alerts?cat=Missing%20document') })
    const inc = workers.filter((w) => !isExited(w) && !completeness(w, outlets).complete)
    if (inc.length) out.push({ id: 'incomplete', rank: 5, icon: '📝', tone: 'blue', text: `${plural(inc.length, 'worker profile')} ${inc.length === 1 ? 'is' : 'are'} incomplete`, detail: 'Finish them so memos and forms are correct.', action: inc.length === 1 ? { label: 'Finish profile', to: `/workers/${inc[0].id}/edit` } : { label: 'Show them', to: '/workers?gap=incomplete' } })
    const chk = of((a) => a.category === 'Status check')
    if (chk.length) {
      const first = chk[0]; const ids = uniq(chk.filter((a) => a.title === first.title))
      out.push({ id: 'checks', rank: 6, icon: '🔎', tone: 'teal', text: `${plural(ids.length, 'worker')}: ${first.title.replace(/ not checked.*/, '')} not checked recently`, detail: 'Open the worker → Check status, check on the official site and record the result.', action: { label: ids.length === 1 ? 'Check now' : 'Start checking', to: `/workers/${ids[0]}?tab=checks` }, second: { label: 'See all', to: '/alerts?cat=Status%20check' } })
    }
  }
  if (!opts.om && opts.pay !== false) {
    const rates = getConfig().rates
    const mw = minWageFor(rates, todayISO())
    const PAY = '/alerts?cat=Pay%20compliance'
    const below = uniq(of((a) => a.id.startsWith('pay-minwage-') && !a.id.startsWith('pay-minwage-next-')))
    if (below.length) out.push({ id: 'pay-minwage', rank: 1, icon: '💰', tone: 'red', text: `${plural(below.length, 'worker is', 'workers are')} paid below the minimum wage${mw ? ` (${rm0(mw.monthly)})` : ''}`, detail: 'Raise the basic pay, or record why the worker is exempt. Check with JTKSM or your agent.', action: go(below, 'pay', PAY) })
    const late = uniq(of((a) => a.id.startsWith('pay-late-')))
    if (late.length) out.push({ id: 'pay-late', rank: 1, icon: '⏰', tone: 'red', text: `Wages for ${plural(late.length, 'worker')} ${late.length === 1 ? 'is' : 'are'} late or not recorded as paid`, detail: `Pay wages within ${rates.payDays} days after the month ends, and overtime by the end of the next month (Employment Act s.19).`, action: go(late, 'pay', PAY) })
    const ded = uniq(of((a) => a.id.startsWith('pay-deduct-') || a.id.startsWith('pay-hostel-')))
    if (ded.length) out.push({ id: 'pay-deduct', rank: 2, icon: '🏠', tone: 'amber', text: `${plural(ded.length, 'worker has', 'workers have')} deductions over the legal limit`, detail: `Total deductions: max ${rates.deductionCapPct}% of wages. Hostel: max ${rm0(rateAt(rates.hostelCap, todayISO())?.amount || 0)} a month, with a valid Certificate for Accommodation and the worker’s written request. Check with JTKSM or your agent.`, action: go(ded, 'pay', PAY) })
    const ot = uniq(of((a) => a.id.startsWith('pay-ot-')))
    if (ot.length) out.push({ id: 'pay-ot', rank: 2, icon: '⏱️', tone: 'amber', text: `${plural(ot.length, 'worker')} worked more than 104 overtime hours in a month`, detail: 'Spread the overtime so nobody goes over the monthly limit.', action: go(ot, 'pay', PAY) })
    const lv = uniq(of((a) => a.id.startsWith('pay-leave-')))
    if (lv.length) out.push({ id: 'pay-leave', rank: 5, icon: '🏖️', tone: 'blue', text: `${plural(lv.length, 'worker has', 'workers have')} annual leave set below the legal minimum`, detail: 'Annual leave is at least 8 / 12 / 16 days for under 2 / 2–5 / 5+ years of service.', action: go(lv, 'leave', PAY) })
    // pay-day reminder for companies using the payslip helper
    const users = workers.filter((w) => !isExited(w) && w.payslips?.length)
    const last = prevMonth(todayISO()); const due = wageDueDate(last, rates)
    if (users.length && todayISO() <= due) {
      const missing = users.filter((w) => !w.payslips!.some((p) => p.month === last && p.payDate))
      if (missing.length) out.push({ id: 'pay-day', rank: 3, icon: '🗓️', tone: 'teal', text: `${monthLabel(last)} wages are due by ${parseISO(due)!.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} — ${plural(missing.length, 'worker')} not marked paid yet`, detail: 'Make the payslip and record the pay date on each worker’s Pay tab.', action: go(missing.map((w) => w.id), 'pay', '/workers') })
    }
  }
  if (!opts.om) {
    const abs = uniq(of((a) => a.category === 'Absconding' && (a.severity === 'critical' || a.id.startsWith('abscond-start-'))))
    if (abs.length) out.push({ id: 'abscond', rank: 1, icon: '🚨', tone: 'red', text: `${plural(abs.length, 'absconding case')} need${abs.length === 1 ? 's' : ''} reports`, detail: 'Make the police report and report to Immigration (FWCMS eRUNAWAY). Check with JTKSM or your agent.', action: go(abs, 'trackers', '/alerts?cat=Absconding') })
    const hos = of((a) => a.category === 'Hostel')
    if (hos.length) out.push({ id: 'hostel', rank: 2, icon: '🏠', tone: 'amber', text: `Hostel problems affect ${plural(uniq(hos).length, 'worker')}`, detail: 'Renew the Certificate for Accommodation or move workers out of an over-full hostel.', action: { label: 'Open hostels', to: '/compliance?tab=hostels' } })
    const stay = uniq(of((a) => a.category === '10-year stay' && a.severity !== 'medium'))
    if (stay.length) out.push({ id: 'stay', rank: 3, icon: '⌛', tone: 'amber', text: `${plural(stay.length, 'worker is', 'workers are')} at or near the 10-year stay limit`, detail: 'Plan the exit or replacement. Check with JTKSM or your agent.', action: go(stay, 'trackers', '/alerts?cat=10-year%20stay') })
    if (extra.grievancesNew) out.push({ id: 'grievance', rank: 1, icon: '📣', tone: 'red', text: `${plural(extra.grievancesNew, 'new complaint')} from workers`, detail: 'Read it, set it to “In review” and reply — workers can track the status with their code.', action: { label: 'Open complaints', to: '/compliance?tab=grievances' } })
    if (extra.highRisk) out.push({ id: 'risk', rank: 2, icon: '📊', tone: 'amber', text: `${plural(extra.highRisk, 'outlet')} with a high risk score`, detail: 'Open the outlet risk table to see what drives the score.', action: { label: 'Outlet risk', to: '/compliance?tab=risk' } })
    if (extra.hiringFomema) out.push({ id: 'hiring', rank: 2, icon: '🧭', tone: 'amber', text: `${plural(extra.hiringFomema, 'new arrival')} need${extra.hiringFomema === 1 ? 's' : ''} FOMEMA within 30 days`, detail: 'Book the FOMEMA medical exam for workers who arrived recently.', action: { label: 'Hiring tracker', to: '/compliance?tab=hiring' } })
  }
  const pend = uniq(of((a) => a.id.startsWith('pppending-')))
  if (pend.length) out.push({ id: 'pp-pending', rank: 3, icon: '✍️', tone: 'amber', text: `${plural(pend.length, 'passport consent form')} waiting for signature`, detail: 'Collect the signed form and upload it.', action: go(pend, 'passport', '/alerts?cat=Passport%20consent') })
  const back = uniq(of((a) => a.category === 'Due back'))
  if (opts.om && back.length) out.push({ id: 'dueback', rank: 4, icon: '🧳', tone: 'blue', text: `${plural(back.length, 'worker')} due back from leave this week`, detail: 'Plan the roster and the return memo.', action: go(back, 'overview', '/alerts?cat=Due%20back') })
  return out.sort((a, b) => a.rank - b.rank).slice(0, 5)
}

/* ---------- Tip of the day (Malaysian rules, plain language) ---------- */
export interface Tip { title: string; text: string; source: string }
export const TIPS: Tip[] = [
  { title: 'Passports belong to the worker', text: 'You may keep a passport in safe custody only with the worker’s written consent, and you must give it back when he asks.', source: 'Passports Act 1966, s.12(1)(f)' },
  { title: 'Pay wages on time', text: 'Wages must be paid no later than the 7th day after the end of each wage period (normally the month).', source: 'Employment Act 1955, s.19' },
  { title: 'Minimum wage', text: 'The minimum wage is RM1,700 a month (RM8.72 an hour) from 1 February 2025; employers with fewer than 5 workers followed from 1 August 2025. Domestic servants are not covered.', source: 'Minimum Wages Order 2024 — check with JTKSM or your agent' },
  { title: 'Overtime and holiday pay deadline', text: 'Overtime, rest-day and public-holiday pay must be paid by the last day of the next wage period.', source: 'Employment Act 1955, s.19(1A)' },
  { title: 'Overtime pay', text: 'Overtime is paid at least 1.5× the hourly rate on a normal day, 2× on a rest day and 3× on a public holiday. The hourly rate is the monthly pay ÷ 26 ÷ normal hours a day.', source: 'Employment Act 1955, s.60 & s.60A — check with JTKSM or your agent' },
  { title: 'Overtime limit', text: 'A worker should not do more than 104 hours of overtime in a month.', source: 'Employment (Limitation of Overtime Work) Regulations 1980' },
  { title: 'Deductions', text: 'Total deductions in a month should not exceed 50% of the wages, except for the cases the law allows.', source: 'Employment Act 1955, s.24 — check with JTKSM or your agent' },
  { title: 'Worker housing', text: 'Accommodation for workers must meet the minimum standards and needs a Certificate for Accommodation.', source: 'Act 446 — check with JTKSM or your agent' },
  { title: 'Hostel deduction limit', text: 'From 1 March 2026 you may deduct at most RM150 a month for accommodation (RM100 before), only with a valid Certificate for Accommodation, the worker’s written request and approval, and never more than the contract says. Applies in Peninsular Malaysia and Labuan.', source: 'Act 446, P.U.(A) 49/2026 — check with JTKSM or your agent' },
  { title: 'LINDUNG 24 Jam', text: 'From 1 June 2026 workers pay 0.75% of wages (up to RM6,000) for PERKESO’s 24-hour non-work accident cover. It is deducted from the worker, not paid by the employer.', source: 'PERKESO — check with PERKESO' },
  { title: 'Leave grows with service', text: 'Annual leave is at least 8 days (under 2 years), 12 days (2–5 years) and 16 days (5 years or more). Sick leave is 14, 18 or 22 days, plus up to 60 days if hospitalised.', source: 'Employment Act 1955, s.60E & s.60F' },
  { title: 'Public holidays', text: 'Give 11 paid public holidays a year, including National Day, the Agong’s Birthday, the Ruler’s (or Federal Territory Day), Labour Day and Malaysia Day. A holiday on a rest day moves to the next working day.', source: 'Employment Act 1955, s.60D — check with JTKSM or your agent' },
  { title: 'Medical check-ups', text: 'Foreign workers need a FOMEMA medical exam on arrival and again for permit renewals. Keep the result on file.', source: 'FOMEMA — check with your agent for the exact schedule' },
  { title: 'Start permit renewals early', text: 'Start the PLKS renewal about 3 months before expiry so the worker never works without a valid permit.', source: 'Immigration — check with JTKSM or your agent' },
  { title: 'Social security', text: 'Register every foreign worker with PERKESO (SOCSO). The employer pays 1.75% and the worker 0.5% of wages up to RM6,000, using PERKESO’s contribution table.', source: 'Employees’ Social Security Act 1969 — check with PERKESO' },
  { title: 'EPF for foreign workers', text: 'EPF for foreign workers is 2% from the employer and 2% from the worker, from October 2025 wages. Each share is rounded up to the next ringgit and is due by the 15th of the next month.', source: 'KWSP — check with KWSP or your agent' },
  { title: 'Written contract', text: 'Give every worker a written contract and keep a copy. Explain it in a language he understands.', source: 'Employment Act 1955, s.10 — check with JTKSM or your agent' },
  { title: 'No recruitment fees from workers', text: 'Workers should not pay recruitment fees. Keep a signed zero-cost recruitment declaration on file.', source: 'Good practice / buyer audits — check with your agent' },
  { title: 'Insurance cover', text: 'Keep each worker’s hospitalisation and surgical insurance (SPIKPA) active for the whole permit period.', source: 'Ministry of Health — check with your agent' },
]
export function tipOfDay(d = new Date()): Tip {
  const start = new Date(d.getFullYear(), 0, 0)
  const day = Math.floor((d.getTime() - start.getTime()) / 86400000)
  return TIPS[day % TIPS.length]
}
