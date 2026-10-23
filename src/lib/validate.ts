/* v1.1.2 field validation + profile completeness. Errors block saving only for values the user typed/changed;
   warnings never block. Old records are never invalidated: completeness is computed, not stored. */
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min'
import type { DocRec, Outlet, Worker } from './types'
import { todayISO } from './util'

export type Issue = { level: 'error' | 'warn'; msg: string }
export type Issues = Record<string, Issue>

// ---------- phone ----------
export const DIAL_CODES: { cc: CountryCode; dial: string; name: string; flag: string }[] = [
  { cc: 'MY', dial: '+60', name: 'Malaysia', flag: '🇲🇾' },
  { cc: 'NP', dial: '+977', name: 'Nepal', flag: '🇳🇵' },
  { cc: 'BD', dial: '+880', name: 'Bangladesh', flag: '🇧🇩' },
  { cc: 'MM', dial: '+95', name: 'Myanmar', flag: '🇲🇲' },
  { cc: 'ID', dial: '+62', name: 'Indonesia', flag: '🇮🇩' },
  { cc: 'IN', dial: '+91', name: 'India', flag: '🇮🇳' },
  { cc: 'PK', dial: '+92', name: 'Pakistan', flag: '🇵🇰' },
  { cc: 'LK', dial: '+94', name: 'Sri Lanka', flag: '🇱🇰' },
  { cc: 'VN', dial: '+84', name: 'Vietnam', flag: '🇻🇳' },
  { cc: 'TH', dial: '+66', name: 'Thailand', flag: '🇹🇭' },
  { cc: 'KH', dial: '+855', name: 'Cambodia', flag: '🇰🇭' },
  { cc: 'PH', dial: '+63', name: 'Philippines', flag: '🇵🇭' },
  { cc: 'LA', dial: '+856', name: 'Laos', flag: '🇱🇦' },
  { cc: 'CN', dial: '+86', name: 'China', flag: '🇨🇳' },
  { cc: 'SG', dial: '+65', name: 'Singapore', flag: '🇸🇬' },
  { cc: 'AE', dial: '+971', name: 'UAE', flag: '🇦🇪' },
  { cc: 'SA', dial: '+966', name: 'Saudi Arabia', flag: '🇸🇦' },
]
export const NATIONALITY_CC: Record<string, CountryCode> = {
  Malaysia: 'MY', Nepal: 'NP', Bangladesh: 'BD', Myanmar: 'MM', Indonesia: 'ID', India: 'IN', Pakistan: 'PK', 'Sri Lanka': 'LK',
  Vietnam: 'VN', Thailand: 'TH', Cambodia: 'KH', Philippines: 'PH',
}
/** split a stored value ("+9779812345678", legacy "012-345 6789") into country + national digits for the editor */
export function splitPhone(v: string | undefined, fallback: CountryCode = 'MY'): { cc: CountryCode; national: string } {
  const s = (v || '').trim()
  if (!s) return { cc: fallback, national: '' }
  const p = parsePhoneNumberFromString(s, fallback)
  if (p?.country) return { cc: p.country, national: p.nationalNumber }
  if (p && s.startsWith('+')) { const d = DIAL_CODES.find((x) => x.dial === '+' + p.countryCallingCode); if (d) return { cc: d.cc, national: p.nationalNumber } }
  return { cc: fallback, national: s.replace(/^\+/, '') }
}
/** E.164 if valid, else null */
export function toE164(cc: CountryCode, national: string): string | null {
  const p = parsePhoneNumberFromString(national, cc)
  return p && p.isValid() ? p.number : null
}
export function phoneIssue(v: unknown, label: string): Issue | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  const p = parsePhoneNumberFromString(s, 'MY')
  if (!p || !p.isValid()) return { level: 'error', msg: `${label}: this doesn’t look like a valid number for the selected country` }
  return null
}
export function fmtPhone(v?: string) {
  if (!v) return ''
  const p = parsePhoneNumberFromString(v, 'MY')
  return p?.isValid() ? p.formatInternational() : v
}

// ---------- passport / documents ----------
export const PASSPORT_HINT: Record<string, { re: RegExp; eg: string }> = {
  Nepal: { re: /^([A-Z]{1,2}\d{7}|\d{8})$/, eg: '8 digits (older) or e-passport like PA1234567' },
  Bangladesh: { re: /^[A-Z]{1,2}\d{7,8}$/, eg: '2 letters + 7 digits, e.g. EB1234567 (e-passport A01234567)' },
  Myanmar: { re: /^[A-Z]{1,2}\d{6,7}$/, eg: '2 letters + 6 digits, e.g. MC123456' },
  Indonesia: { re: /^[A-Z]{1,2}\d{6,7}$/, eg: '1–2 letters + 6–7 digits, e.g. X1234567' },
  India: { re: /^[A-Z]\d{7}$/, eg: '1 letter + 7 digits, e.g. P1234567' },
  Pakistan: { re: /^[A-Z]{2}\d{7}$/, eg: '2 letters + 7 digits, e.g. AB1234567' },
  'Sri Lanka': { re: /^[A-Z]\d{7,8}$/, eg: '1 letter + 7 digits, e.g. N1234567' },
  Vietnam: { re: /^[A-Z]\d{7}$/, eg: '1 letter + 7 digits, e.g. C1234567' },
  Philippines: { re: /^[A-Z]{1,2}\d{6,7}[A-Z]?$/, eg: 'e.g. P1234567A' },
  Thailand: { re: /^[A-Z]{1,2}\d{6,7}$/, eg: '1–2 letters + 7 digits, e.g. AA1234567' },
  Cambodia: { re: /^[A-Z]{1,2}\d{6,8}$/, eg: 'letter(s) + digits, e.g. N01234567' },
}
export const passportHint = (nat?: string) => (nat && PASSPORT_HINT[nat] ? `${nat}: ${PASSPORT_HINT[nat].eg}` : '6–12 letters/digits, no spaces')
export const normPassport = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')
export function passportIssue(v: unknown, nat?: string): Issue | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  if (!/^[A-Z0-9]{6,12}$/.test(s)) return { level: 'error', msg: 'Passport no.: 6–12 capital letters / digits, no spaces or dashes' }
  const h = nat ? PASSPORT_HINT[nat] : undefined
  if (h && !h.re.test(s)) return { level: 'warn', msg: `Unusual format for ${nat} — usually ${h.eg}. Please double-check.` }
  return null
}
export const PERMIT_HINT = 'As printed on the PLKS / VP(TE) sticker or i-Kad (letters & digits)'
export const PERMIT_RE = /^[A-Z0-9][A-Z0-9/-]{4,19}$/
export function docNumberIssue(v: unknown, kind: string): Issue | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  if (kind === 'vp' && !PERMIT_RE.test(s.toUpperCase())) return { level: 'warn', msg: `Permit no. looks unusual — ${PERMIT_HINT}` }
  return null
}
export function dateIssues(issue?: string, expiry?: string, opts: { passport?: boolean; contractEnd?: string } = {}): { issue?: Issue; expiry?: Issue } {
  const out: { issue?: Issue; expiry?: Issue } = {}
  const today = todayISO()
  if (issue && issue > today) out.issue = { level: 'error', msg: 'Issue date can’t be in the future' }
  if (issue && expiry && expiry <= issue) out.expiry = { level: 'error', msg: 'Expiry must be after the issue date' }
  else if (opts.passport && expiry) {
    const six = new Date(); six.setMonth(six.getMonth() + 6)
    const sixISO = six.toISOString().slice(0, 10)
    if (expiry < today) out.expiry = { level: 'warn', msg: 'Passport has EXPIRED — renew before any permit application' }
    else if (expiry < sixISO) out.expiry = { level: 'warn', msg: 'Passport valid for less than 6 months — renew soon (needed for PLKS renewal)' }
    else if (opts.contractEnd && expiry < opts.contractEnd) out.expiry = { level: 'warn', msg: 'Passport expires before the contract ends' }
  }
  return out
}
export function dobIssue(dob?: string): Issue | null {
  if (!dob) return null
  if (dob > todayISO()) return { level: 'error', msg: 'Date of birth can’t be in the future' }
  const d = new Date(dob), n = new Date()
  let a = n.getFullYear() - d.getFullYear()
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--
  if (a < 18 || a > 45) return { level: 'warn', msg: `Age ${a}: PLKS normally requires 18–45 years at application/renewal — check eligibility` }
  return null
}
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
export const emailIssue = (v: unknown): Issue | null => (String(v ?? '').trim() && !EMAIL_RE.test(String(v).trim()) ? { level: 'error', msg: 'Email looks incomplete, e.g. name@example.com' } : null)
export function moneyIssue(v: unknown, label: string): Issue | null {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n)) return { level: 'error', msg: `${label}: enter an amount like 1,700.00` }
  if (n < 0) return { level: 'error', msg: `${label} can’t be negative` }
  return null
}
export const fmtMoneyInput = (n: unknown) => (n === undefined || n === null || n === '' || !Number.isFinite(Number(n)) ? '' : Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
export const parseMoney = (s: string): number | undefined => {
  const t = s.replace(/[,\sRMrm]/g, '')
  if (!t) return undefined
  const n = Number(t)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN
}

// ---------- completeness ----------
export const PERMIT_TYPE = 'Work Permit / PLKS (VP(TE))'
export const latestDoc = (docs: DocRec[] | undefined, type: string) =>
  (docs || []).filter((d) => d.type === type).sort((a, b) => (b.expiryDate || '').localeCompare(a.expiryDate || ''))[0]
export type ReqItem = { key: string; label: string; step: string; done: boolean }
/** the 'mandatory' list; permit fields only once a permit exists */
export function requiredItems(w: Partial<Worker>, outlets: Pick<Outlet, 'id' | 'companyId'>[]): ReqItem[] {
  const has = (x: unknown) => x !== undefined && x !== null && String(x).trim() !== ''
  const pp = latestDoc(w.documents, 'Passport')
  const vp = latestDoc(w.documents, PERMIT_TYPE)
  const o = outlets.find((x) => x.id === w.outletId)
  const items: ReqItem[] = [
    { key: 'fullName', label: 'Name as in passport', step: 'Personal', done: has(w.fullName) },
    { key: 'nationality', label: 'Nationality', step: 'Personal', done: has(w.nationality) },
    { key: 'gender', label: 'Gender', step: 'Personal', done: has(w.gender) },
    { key: 'dob', label: 'Date of birth', step: 'Personal', done: has(w.dob) },
    { key: 'primaryLanguage', label: 'Primary language', step: 'Personal', done: has(w.primaryLanguage) && (w.primaryLanguage !== 'other' || has(w.primaryLanguageOther)) },
    { key: 'phoneMY', label: 'Mobile number', step: 'Personal', done: has(w.phoneMY) },
    { key: 'pp_no', label: 'Passport no.', step: 'Documents', done: has(pp?.number) },
    { key: 'pp_issue', label: 'Passport issue date', step: 'Documents', done: has(pp?.issueDate) },
    { key: 'pp_exp', label: 'Passport expiry date', step: 'Documents', done: has(pp?.expiryDate) },
    { key: 'companyId', label: 'Company', step: 'Job', done: !!o },
    { key: 'outletId', label: 'Outlet', step: 'Job', done: !!o },
    { key: 'jobCategory', label: 'Job title', step: 'Job', done: has(w.jobCategory) },
    { key: 'joinDate', label: 'Start date', step: 'Job', done: has(w.joinDate) },
    { key: 'initialBasicPay', label: 'Basic salary', step: 'Contract & pay', done: Number(w.initialBasicPay) > 0 },
  ]
  if (vp) items.push(
    { key: 'vp_no', label: 'Permit no.', step: 'Documents', done: has(vp.number) },
    { key: 'vp_issue', label: 'Permit issue date', step: 'Documents', done: has(vp.issueDate) },
    { key: 'vp_exp', label: 'Permit expiry date', step: 'Documents', done: has(vp.expiryDate) },
  )
  return items
}
export function completeness(w: Partial<Worker>, outlets: Pick<Outlet, 'id' | 'companyId'>[]) {
  const items = requiredItems(w, outlets)
  const missing = items.filter((i) => !i.done)
  return { total: items.length, done: items.length - missing.length, missing, complete: missing.length === 0 }
}
