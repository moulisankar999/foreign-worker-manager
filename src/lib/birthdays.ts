/* 1.6.0 Birthdays: who has a birthday today / this week / this month (Malaysia time), the company's
 * automatic wish (server, migration 051) and personal in-app wishes from HR / GM / CEO.
 * The worker list is already RLS-scoped and masked; the server re-checks every wish. */
import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { EXITED_STATUSES, type Worker } from './types'

export const BDAY_LANGS: { code: string; name: string }[] = [
  { code: 'en', name: 'English' }, { code: 'ms', name: 'Malay' }, { code: 'ta', name: 'Tamil' }, { code: 'hi', name: 'Hindi' },
  { code: 'te', name: 'Telugu' }, { code: 'ml', name: 'Malayalam' }, { code: 'kn', name: 'Kannada' }, { code: 'bn', name: 'Bengali' },
  { code: 'ne', name: 'Nepali' }, { code: 'my', name: 'Burmese' },
]
export interface BdayConfig { autoWish: boolean; notifyStaff: boolean; templates: Record<string, string> }
export interface Wish { id: number; worker_id: string; kind: 'auto' | 'personal'; sender_name: string | null; sender_role: string | null; created_at: string; read_at: string | null; mine: boolean }
export type Range = 'today' | 'week' | 'month'

/** today's date in Malaysia (YYYY-MM-DD) */
export function mytToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}
const isLeap = (y: number) => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
/** the birthday in year y (29 Feb -> 28 Feb in non-leap years), as YYYY-MM-DD; null if dob is not a date */
export function bdayIn(dob: string | undefined, y: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob || '')
  if (!m) return null
  let d = +m[3]; const mo = +m[2]
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  if (mo === 2 && d === 29 && !isLeap(y)) d = 28
  return `${y}-${m[2]}-${String(d).padStart(2, '0')}`
}
const dayNum = (iso: string) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000)

export interface BdayRow { w: Worker; date: string; inDays: number; turning: number | null }
/** birthdays in range, soonest first. 'week' = today and the next 6 days; 'month' = this calendar month (past days included, last) */
export function birthdays(workers: Worker[], range: Range, today = mytToday()): BdayRow[] {
  const y = +today.slice(0, 4), t = dayNum(today)
  const out: BdayRow[] = []
  for (const w of workers) {
    if (EXITED_STATUSES.includes(w.status)) continue
    let b = bdayIn(w.dob, y)
    if (!b) continue
    let by = y
    // in late December, "this week" reaches into January
    if (range === 'week' && dayNum(b) < t) { const nb = bdayIn(w.dob, y + 1); if (nb) { b = nb; by = y + 1 } }
    const inDays = dayNum(b) - t
    const ok = range === 'today' ? inDays === 0 : range === 'week' ? inDays >= 0 && inDays <= 6 : b.slice(0, 7) === today.slice(0, 7)
    if (!ok) continue
    const born = +(w.dob || '').slice(0, 4)
    out.push({ w, date: b, inDays, turning: born > 1900 ? by - born : null })
  }
  return out.sort((a, b) => (a.inDays < 0 ? 1000 - a.inDays : a.inDays) - (b.inDays < 0 ? 1000 - b.inDays : b.inDays) || a.w.fullName.localeCompare(b.w.fullName))
}

export const ROLE_LABEL: Record<string, string> = { super_admin: 'CEO', admin: 'CEO', general_manager: 'GM', hr_admin: 'HR Admin', hr_manager: 'HR Manager', management: 'Management' }

export function render(tpl: string, name: string, company: string) {
  return tpl.replace(/\{\{\s*name\s*\}\}/g, name).replace(/\{\{\s*company\s*\}\}/g, company)
}
export const firstName = (full: string) => (full || '').trim().split(/\s+/)[0] || ''

export function useBdayData(enabled: boolean) {
  const [cfg, setCfg] = useState<BdayConfig | null>(null)
  const [wishes, setWishes] = useState<Wish[]>([])
  const [err, setErr] = useState('')
  const reload = useCallback(async () => {
    if (!enabled) return
    const [c, w] = await Promise.all([supabase.rpc('bday_config'), supabase.rpc('bday_wishes', { p_year: null })])
    if (c.error || w.error) { setErr((c.error || w.error)!.message); return }
    setErr(''); setCfg(c.data as BdayConfig); setWishes((w.data || []) as Wish[])
  }, [enabled])
  useEffect(() => { void reload() }, [reload])
  return { cfg, wishes, err, reload }
}

export async function sendWish(workerId: string, message: string): Promise<{ id: number; signedAs: string }> {
  const { data, error } = await supabase.rpc('bday_send_wish', { p_worker: workerId, p_message: message })
  if (error) throw new Error(error.message)
  return data as { id: number; signedAs: string }
}
export async function saveBdayConfig(c: BdayConfig): Promise<BdayConfig> {
  const { data, error } = await supabase.rpc('bday_config_save', { p_cfg: c })
  if (error) throw new Error(error.message)
  return data as BdayConfig
}
