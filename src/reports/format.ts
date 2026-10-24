import { fmtDate, rm } from '../lib/util'
import type { Cell, Fmt } from './types'

export const MYT = 'Asia/Kuala_Lumpur'
/** 24 Oct 2026, 08:15 MYT */
export function mytStamp(d: Date | string = new Date()) {
  const x = typeof d === 'string' ? new Date(d) : d
  if (isNaN(x.getTime())) return String(d)
  return x.toLocaleString('en-GB', { timeZone: MYT, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) + ' MYT'
}
export const mytDate = (d: Date = new Date()) => d.toLocaleDateString('en-CA', { timeZone: MYT }) // YYYY-MM-DD

export function show(v: Cell, f?: Fmt): string {
  if (v === undefined || v === null || v === '' || (typeof v === 'number' && !isFinite(v))) return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  switch (f) {
    case 'date': return fmtDate(String(v))
    case 'dt': return mytStamp(String(v))
    case 'rm': return rm(Number(v)).replace('RM ', '')
    case 'num': return Number(v).toLocaleString('en-MY', { maximumFractionDigits: 1 })
    case 'int': return Math.round(Number(v)).toLocaleString('en-MY')
    case 'pct': return Number(v).toLocaleString('en-MY', { maximumFractionDigits: 1 }) + '%'
    default: return String(v)
  }
}
export const isNumFmt = (f?: Fmt) => f === 'rm' || f === 'num' || f === 'int' || f === 'pct'

/** "A1234567" -> "A12•••567" (printed lists for roles that should not carry full ID numbers) */
export function maskId(v?: string | null, on = true) {
  if (!v) return v || ''
  if (!on || v.length < 5) return v
  return v.slice(0, 2) + '•'.repeat(Math.max(3, v.length - 5)) + v.slice(-3)
}
export const maskAcct = (v?: string | null) => (v ? '••••' + v.replace(/\s+/g, '').slice(-4) : '')

export function hoursBetween(a?: string | null, b?: string | null) {
  if (!a || !b) return null
  const h = (new Date(b).getTime() - new Date(a).getTime()) / 36e5
  return isFinite(h) ? h : null
}
export const tat = (h: number | null) => (h === null ? '' : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24 * 10) / 10} d`)

/* ---------------- labels (English + optional Malay / Tamil on the printed headings & signature block) ---------------- */
export type Lang = 'en' | 'ms' | 'ta'
const T: Record<string, { ms: string; ta: string }> = {
  'Prepared by': { ms: 'Disediakan oleh', ta: 'தயாரித்தவர்' },
  'Verified by': { ms: 'Disemak oleh', ta: 'சரிபார்த்தவர்' },
  'Reviewed by': { ms: 'Disemak semula oleh', ta: 'மதிப்பாய்வு செய்தவர்' },
  'Approved by': { ms: 'Diluluskan oleh', ta: 'அங்கீகரித்தவர்' },
  Name: { ms: 'Nama', ta: 'பெயர்' },
  Signature: { ms: 'Tandatangan', ta: 'கையொப்பம்' },
  Date: { ms: 'Tarikh', ta: 'தேதி' },
  'Company stamp': { ms: 'Cop syarikat', ta: 'நிறுவன முத்திரை' },
  Page: { ms: 'Muka surat', ta: 'பக்கம்' },
  of: { ms: 'daripada', ta: '/' },
  Generated: { ms: 'Dijana', ta: 'உருவாக்கப்பட்டது' },
  Confidential: { ms: 'Sulit', ta: 'இரகசியம்' },
  'Filing record': { ms: 'Rekod pemfailan', ta: 'கோப்பு பதிவு' },
}
export const tr = (en: string, lang: Lang) => (lang === 'en' || !T[en] ? en : `${en} / ${T[en][lang]}`)
