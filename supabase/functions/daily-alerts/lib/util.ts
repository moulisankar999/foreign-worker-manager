// AUTO-COPIED from src/lib by scripts/prepare-function.sh — edit the original, not this file
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36))

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

let todayOverride: string | null = null
/** Run fn as if "today" were iso (used to pre-compute future daily summaries). */
export function withToday<T>(iso: string, fn: () => T): T {
  const prev = todayOverride
  todayOverride = iso
  try { return fn() } finally { todayOverride = prev }
}
export function todayISO() {
  const d = new Date(Date.now() + 8 * 3600 * 1000) // Malaysia time (server clock is UTC)
  if (todayOverride) return todayOverride
  return toISO(d)
}
export function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function parseISO(s?: string): Date | null {
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (!m) return null
  return new Date(+m[1], +m[2] - 1, +m[3])
}
export function fmtDate(s?: string) {
  const d = parseISO(s)
  if (!d) return '—'
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}
export function fmtMonth(key: string) {
  const [y, m] = key.split('-')
  return `${MONTHS[+m - 1]} ${y.slice(2)}`
}
export function daysUntil(s?: string, from = todayISO()) {
  const d = parseISO(s)
  const f = parseISO(from)
  if (!d || !f) return null
  return Math.round((d.getTime() - f.getTime()) / 86400000)
}
export function daysBetweenInclusive(a?: string, b?: string) {
  const n = daysUntil(b, a)
  return n === null ? 0 : n + 1
}
export function addMonths(s: string, months: number) {
  const d = parseISO(s)
  if (!d) return '' // missing/invalid date: no result instead of a crash
  const day = d.getDate()
  const r = new Date(d.getFullYear(), d.getMonth() + months, 1)
  const last = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate()
  r.setDate(Math.min(day, last))
  return toISO(r)
}
export function addDays(s: string, days: number) {
  const d = parseISO(s)!
  d.setDate(d.getDate() + days)
  return toISO(d)
}
/** Fractional months between two dates (a -> b). */
export function monthsBetween(a?: string, b?: string) {
  const da = parseISO(a)
  const db = parseISO(b)
  if (!da || !db) return 0
  let months = (db.getFullYear() - da.getFullYear()) * 12 + (db.getMonth() - da.getMonth())
  let anchor = addMonths(a!, months)
  if (anchor > b!) { months -= 1; anchor = addMonths(a!, months) }
  const next = addMonths(a!, months + 1)
  const frac = (daysUntil(b, anchor) ?? 0) / Math.max(1, daysUntil(next, anchor) ?? 30)
  return months + frac
}
export function serviceText(join?: string, to = todayISO()) {
  const m = Math.floor(monthsBetween(join, to))
  if (!join || m < 0) return '—'
  const y = Math.floor(m / 12)
  const mm = m % 12
  return [y ? `${y}y` : '', `${mm}m`].filter(Boolean).join(' ')
}
export function age(dob?: string) {
  if (!dob) return null
  return Math.floor(monthsBetween(dob, todayISO()) / 12)
}
export function rm(n?: number | null) {
  const v = Number(n || 0)
  return 'RM ' + v.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
export function rm0(n?: number | null) {
  return 'RM ' + Math.round(Number(n || 0)).toLocaleString('en-MY')
}
type Saver = (filename: string, blob: Blob) => Promise<void>
let nativeSaver: Saver | null = null
/** In the Android/iOS app there is no browser download: files are shared/saved via the phone's share sheet instead. */
export function setNativeSaver(f: Saver) { nativeSaver = f }
export function download(filename: string, content: string | Blob, mime = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime })
  if (nativeSaver) { nativeSaver(filename, blob).catch((e) => alert('Could not save file: ' + (e as Error).message)); return }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
export function toCSV(rows: Record<string, unknown>[], columns?: string[]) {
  const cols = columns ?? Array.from(new Set(rows.flatMap((r) => Object.keys(r))))
  const esc = (v: unknown) => {
    const s = v === undefined || v === null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return '\ufeff' + [cols.map(esc).join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n')
}
export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(r.error)
    r.readAsDataURL(file)
  })
}
export async function resizeImage(file: File, max = 320): Promise<string> {
  const url = await readFileAsDataURL(file)
  const img = new Image()
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url })
  const scale = Math.min(1, max / Math.max(img.width, img.height))
  const c = document.createElement('canvas')
  c.width = Math.round(img.width * scale)
  c.height = Math.round(img.height * scale)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.82)
}
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')
