/* Compliance health score (0–100), "today's priorities" and tips for the advice-style dashboard.
 * Plain-language, explainable: every point lost is listed in the "why" breakdown. */
import { isExited, type Alert } from './calc'
import { completeness } from './validate'
import type { Agency } from './agencies'
import type { Outlet, Worker } from './types'

export const PERMIT = 'Work Permit / PLKS (VP(TE))'
export const FOMEMA = 'FOMEMA Medical'
export const INSURANCE = 'Insurance (SPIKPA / Hospitalisation)'

export interface ScoreLine { key: string; label: string; affected: number; lost: number; max: number; tip: string }
export interface Score { score: number | null; total: number; lines: ScoreLine[]; tone: 'green' | 'amber' | 'red' | 'gray'; label: string }

const RULES: { key: string; label: string; max: number; tip: string; hit: (w: Worker, a: Alert[]) => boolean }[] = [
  { key: 'permit', label: 'Work permit (PLKS) expired', max: 30, tip: 'Renew in FWCMS now. A worker without a valid permit should not be working.', hit: (_w, a) => a.some((x) => x.category === PERMIT && (x.days ?? 0) < 0) },
  { key: 'expired', label: 'Passport, FOMEMA or insurance expired', max: 15, tip: 'Renew the expired document — the permit renewal needs them.', hit: (_w, a) => a.some((x) => ['Passport', FOMEMA, INSURANCE].includes(x.category) && (x.days ?? 0) < 0) },
  { key: 'soon', label: 'Key document expires within 60 days', max: 10, tip: 'Start the renewal now so there is no gap.', hit: (_w, a) => a.some((x) => [PERMIT, 'Passport', FOMEMA, INSURANCE].includes(x.category) && x.days !== null && x.days >= 0 && x.days <= 60) },
  { key: 'missing', label: 'Required document missing', max: 15, tip: 'Add the passport, permit, FOMEMA and insurance records for every worker.', hit: (_w, a) => a.some((x) => x.category === 'Missing document') },
  { key: 'passport', label: 'Passport kept without signed consent', max: 15, tip: 'Keep a passport only with the worker’s signed consent, and return it when he asks.', hit: (_w, a) => a.some((x) => x.id.startsWith('ppnoconsent-')) },
  { key: 'overdue', label: 'Not back from leave', max: 5, tip: 'Contact the worker. If he has absconded, report it — check with JTKSM or your agent.', hit: (_w, a) => a.some((x) => x.category === 'Overdue return') },
  { key: 'profile', label: 'Profile incomplete', max: 5, tip: 'Fill in the missing details so letters and forms are correct.', hit: () => false },
  { key: 'checks', label: 'Status not checked on time', max: 5, tip: 'Open the worker → Check status, check on the official site and record the result.', hit: (_w, a) => a.some((x) => x.category === 'Status check') },
]

/** score for a group of workers (company, outlet or everyone) */
export function healthScore(workers: Worker[], alerts: Alert[], outlets: Outlet[]): Score {
  const act = workers.filter((w) => !isExited(w))
  if (!act.length) return { score: null, total: 0, lines: [], tone: 'gray', label: 'No workers yet' }
  const byW = new Map<string, Alert[]>()
  for (const a of alerts) { const l = byW.get(a.workerId); if (l) l.push(a); else byW.set(a.workerId, [a]) }
  const lines = RULES.map((r) => {
    const affected = act.filter((w) => r.key === 'profile' ? !completeness(w, outlets).complete : r.hit(w, byW.get(w.id) || [])).length
    // any problem costs at least 30% of that line, the rest grows with the share of workers affected
    const lost = affected ? Math.round(r.max * Math.min(1, 0.3 + 0.7 * (affected / act.length))) : 0
    return { key: r.key, label: r.label, affected, lost, max: r.max, tip: r.tip }
  })
  const score = Math.max(0, 100 - lines.reduce((s, l) => s + l.lost, 0))
  const tone = score >= 85 ? 'green' : score >= 65 ? 'amber' : 'red'
  return { score, total: act.length, lines, tone, label: score >= 85 ? 'Good' : score >= 65 ? 'Needs attention' : 'At risk' }
}

/* ---------- Today's priorities ---------- */
export interface Action { label: string; to?: string; href?: string }
export interface Priority { id: string; rank: number; icon: string; tone: 'red' | 'amber' | 'blue' | 'teal'; text: string; detail: string; action: Action; second?: Action }

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
const within = (d: number) => (d <= 31 ? 'within a month' : d <= 62 ? 'within 2 months' : 'within 3 months')

export function priorities(alerts: Alert[], workers: Worker[], outlets: Outlet[], agencies: Agency[], opts: { om?: boolean } = {}): Priority[] {
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
  { title: 'Minimum wage', text: 'The minimum wage is RM1,700 a month for most employers (Minimum Wages Order 2024). Check the current order for your business size.', source: 'Minimum Wages Order 2024 — check with JTKSM or your agent' },
  { title: 'Overtime pay', text: 'Overtime is paid at least 1.5× the hourly rate on a normal day, 2× on a rest day and 3× on a public holiday.', source: 'Employment Act 1955, s.60 & s.60A' },
  { title: 'Overtime limit', text: 'A worker should not do more than 104 hours of overtime in a month.', source: 'Employment (Limitation of Overtime Work) Regulations 1980' },
  { title: 'Deductions', text: 'Total deductions in a month should not exceed 50% of the wages, except for the cases the law allows.', source: 'Employment Act 1955, s.24 — check with JTKSM or your agent' },
  { title: 'Worker housing', text: 'Accommodation for workers must meet the minimum standards and needs a Certificate for Accommodation.', source: 'Act 446 — check with JTKSM or your agent' },
  { title: 'Medical check-ups', text: 'Foreign workers need a FOMEMA medical exam on arrival and again for permit renewals. Keep the result on file.', source: 'FOMEMA — check with your agent for the exact schedule' },
  { title: 'Start permit renewals early', text: 'Start the PLKS renewal about 3 months before expiry so the worker never works without a valid permit.', source: 'Immigration — check with JTKSM or your agent' },
  { title: 'Social security', text: 'Register every foreign worker with PERKESO (SOCSO) and pay the contribution every month.', source: 'Employees’ Social Security Act 1969 — check with PERKESO' },
  { title: 'EPF for foreign workers', text: 'EPF contributions for foreign workers (2% employer + 2% employee) apply from October 2025 wages.', source: 'KWSP — check with KWSP or your agent' },
  { title: 'Written contract', text: 'Give every worker a written contract and keep a copy. Explain it in a language he understands.', source: 'Employment Act 1955, s.10 — check with JTKSM or your agent' },
  { title: 'No recruitment fees from workers', text: 'Workers should not pay recruitment fees. Keep a signed zero-cost recruitment declaration on file.', source: 'Good practice / buyer audits — check with your agent' },
  { title: 'Insurance cover', text: 'Keep each worker’s hospitalisation and surgical insurance (SPIKPA) active for the whole permit period.', source: 'Ministry of Health — check with your agent' },
]
export function tipOfDay(d = new Date()): Tip {
  const start = new Date(d.getFullYear(), 0, 0)
  const day = Math.floor((d.getTime() - start.getTime()) / 86400000)
  return TIPS[day % TIPS.length]
}
