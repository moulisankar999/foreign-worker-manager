/* 1.6.0 smart forms: auto-fill learned from this company's own records (no hard-coded government values),
 * duplicate detection (worker ID, passport no., name + date of birth, company name / SSM no.) and one-tap fixes.
 * Every suggestion carries a plain "why" so the "why am I seeing this" tooltip can explain it. */
import type { Worker } from './types'
import { addMonths, fmtDate } from './util'
import { normPassport, type Issue } from './validate'

const monthsBetween = (a: string, b: string) => {
  const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number)
  return (y2 - y1) * 12 + (m2 - m1) + (d2 - d1 >= 15 ? 1 : d2 - d1 <= -15 ? -1 : 0)
}

export type Validity = Record<string, { months: number; n: number; of: number }>
/** usual validity (months) per document type, learned from documents that have both an issue and an expiry date.
 * Needs at least 3 records and a clear majority (≥ 60%) so a few odd records never drive the suggestion. */
export function learnValidity(workers: Pick<Worker, 'documents'>[]): Validity {
  const by: Record<string, Record<number, number>> = {}
  for (const w of workers) for (const d of w.documents || []) {
    if (!d.issueDate || !d.expiryDate || d.expiryDate <= d.issueDate) continue
    const m = monthsBetween(d.issueDate, d.expiryDate)
    if (m < 1 || m > 180) continue
    ;(by[d.type] ||= {})[m] = ((by[d.type] ||= {})[m] || 0) + 1
  }
  const out: Validity = {}
  for (const [t, hist] of Object.entries(by)) {
    const of = Object.values(hist).reduce((a, b) => a + b, 0)
    const [m, n] = Object.entries(hist).sort((a, b) => b[1] - a[1])[0]
    if (of >= 3 && n / of >= 0.6) out[t] = { months: +m, n, of }
  }
  return out
}

/** expiry auto-fill tip: issue date typed, expiry still empty, and this company has a clear usual validity */
export function expiryTip(type: string, label: string, issue: string | undefined, expiry: string | undefined, v: Validity): Issue | null {
  const r = v[type]
  if (!issue || expiry || !r) return null
  const val = addMonths(issue, r.months)
  return { level: 'tip', msg: `Usually valid ${r.months} months — expiry ${fmtDate(val)}?`, fix: { label: 'Use this date', value: val },
    why: `${r.n} of ${r.of} ${label} records here run ${r.months} months from the issue date. Always check the date printed on the document.` }
}

export const normName = (s: string) => s.toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim()
/** another worker with the same passport no. (any document of type Passport) */
export function passportDup(no: unknown, selfId: string | undefined, workers: Worker[]): Issue | null {
  const n = normPassport(String(no || ''))
  if (n.length < 6) return null
  const w = workers.find((x) => x.id !== selfId && (x.documents || []).some((d) => d.type === 'Passport' && d.number && normPassport(d.number) === n))
  return w ? { level: 'warn', msg: `${w.workerNo} · ${w.fullName} already has this passport no.`, link: { label: 'Open', href: `#/workers/${w.id}` },
    why: 'Passport numbers are unique. The same number usually means this worker is already registered (maybe at another outlet or as exited).' } : null
}
/** same full name and date of birth as another worker */
export function personDup(name: unknown, dob: unknown, selfId: string | undefined, workers: Worker[]): Issue | null {
  const n = normName(String(name || ''))
  if (!n || !dob) return null
  const w = workers.find((x) => x.id !== selfId && x.dob === dob && normName(x.fullName || '') === n)
  return w ? { level: 'warn', msg: `Looks like ${w.workerNo} · ${w.fullName} (same name and date of birth)`, link: { label: 'Open', href: `#/workers/${w.id}` },
    why: 'Two records with the same name and date of birth are usually the same person. Check before adding a second record.' } : null
}
/** worker ID taken → offer the next free one */
export function workerNoDup(no: unknown, selfId: string | undefined, workers: Worker[]): Issue | null {
  const s = String(no || '').trim()
  if (!s) return null
  const taken = workers.some((x) => x.id !== selfId && x.workerNo === s)
  if (!taken) return null
  const pre = s.replace(/\d+$/, '') || 'FW'
  const width = (s.match(/\d+$/)?.[0] || '').length // keep zero padding: FBI001 -> FBI014
  const max = workers.reduce((m, w) => { const n = String(w.workerNo || ''); return n.startsWith(pre) && /^\d+$/.test(n.slice(pre.length)) ? Math.max(m, parseInt(n.slice(pre.length))) : m }, 0)
  const next = pre + String(max + 1).padStart(width, '0')
  return { level: 'error', msg: 'This Worker ID is already used', fix: { label: `Use ${next}`, value: next }, why: 'Every worker needs their own ID.' }
}
/** tidy a typed full name: extra spaces → one; passport names are written in capitals */
export function nameTip(name: unknown): Issue | null {
  const s = String(name || '')
  if (!s.trim()) return null
  const tidy = s.replace(/\s+/g, ' ').trim().toUpperCase()
  if (tidy === s) return null
  if (s.trim().length < 3) return null
  return { level: 'tip', msg: 'Write the name exactly as in the passport (capitals).', fix: { label: `Use “${tidy.length > 28 ? tidy.slice(0, 26) + '…' : tidy}”`, value: tidy },
    why: 'Permits, FOMEMA and payroll match on the passport name. Capitals and single spaces avoid mismatches.' }
}

// ---------- companies
const CO_SUFFIX = /\b(SDN\.?\s*BHD\.?|SDN|BHD|BERHAD|PLT|ENTERPRISE|ENT|CO|COMPANY|THE|AND|&)\b/g
export const normCompany = (s: string) => s.toUpperCase().replace(/[^A-Z0-9& ]/g, ' ').replace(CO_SUFFIX, ' ').replace(/\s+/g, ' ').trim()
export function companyDup(name: string, selfId: string | undefined, items: { id: string; name: string }[]): { id: string; name: string } | null {
  const n = normCompany(name)
  if (n.length < 3) return null
  return items.find((c) => c.id !== selfId && normCompany(c.name) === n) || null
}
export const normSsm = (s?: string | null) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
