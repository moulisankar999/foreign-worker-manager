import { useCallback, useEffect, useMemo, useState } from 'react'
import { isDemoCompany, useHideDemo } from '../lib/demo'
import { supabase } from '../lib/supabase'
import { addDays, toISO, todayISO } from '../lib/util'
import type { Filters } from './types'

export type Freq = 'monthly' | 'quarterly' | 'half_yearly' | 'yearly'
export const FREQ_LABEL: Record<Freq, string> = { monthly: 'Monthly', quarterly: 'Quarterly', half_yearly: 'Half-yearly', yearly: 'Yearly' }
export interface Schedule {
  id: string; report_id: string; title: string; frequency: Freq; due_day: number; company_id: string | null
  filters: Filters & { lang?: string; mask?: boolean }; start_period: string | null; notes: string | null; active: boolean
  created_by_name: string | null; created_at: string; updated_at: string
}
export interface StepRec { at: string; by: string; by_name: string | null; by_role: string | null; note?: string | null }
export type StepKey = 'generated' | 'printed' | 'prepared' | 'verified' | 'reviewed' | 'approved' | 'filed'
export interface Submission { id: string; schedule_id: string; period: string; status: string; steps: Partial<Record<StepKey, StepRec>>; file_ref: string | null; updated_at: string }

export const STEPS: { key: StepKey; label: string; who: string; sign?: boolean }[] = [
  { key: 'generated', label: 'Generated', who: 'HR Manager' },
  { key: 'printed', label: 'Printed', who: 'HR Manager' },
  { key: 'prepared', label: 'Prepared & signed', who: 'HR Manager', sign: true },
  { key: 'verified', label: 'Verified', who: 'HR Admin', sign: true },
  { key: 'reviewed', label: 'Reviewed', who: 'General Manager', sign: true },
  { key: 'approved', label: 'Approved', who: 'CEO', sign: true },
  { key: 'filed', label: 'Filed', who: 'HR Manager' },
]
const RANK: Record<string, number> = { hr_manager: 1, hr_admin: 2, general_manager: 3, super_admin: 4 }
const NEED: Record<StepKey, number> = { generated: 1, printed: 1, prepared: 1, verified: 2, reviewed: 3, approved: 4, filed: 1 }
/** mirrors report_submission_step() on the server (the server re-checks everything) */
export function canDoStep(step: StepKey, role: string | null, steps: Submission['steps'], uid?: string): { ok: boolean; why?: string } {
  const rk = RANK[role || ''] || 0
  if (rk < NEED[step]) return { ok: false, why: `Needs ${STEPS.find((s) => s.key === step)!.who}` }
  const i = STEPS.findIndex((s) => s.key === step)
  if (i > 1) {
    const prev = STEPS[i - 1].key
    if (!steps[prev]) return { ok: false, why: `Waiting for: ${STEPS[i - 1].label}` }
    if (steps[step] && step !== 'filed') return { ok: false, why: 'Done' }
    if (role !== 'super_admin' && (step === 'verified' || step === 'reviewed') && steps[prev]?.by === uid) return { ok: false, why: 'Another person must sign this level' }
  }
  return { ok: true }
}

/* ---------------- periods ---------------- */
const pad = (n: number) => String(n).padStart(2, '0')
export function periodOf(freq: Freq, iso = todayISO()) {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7))
  return freq === 'monthly' ? `${y}-${pad(m)}` : freq === 'quarterly' ? `${y}-Q${Math.ceil(m / 3)}` : freq === 'half_yearly' ? `${y}-H${m <= 6 ? 1 : 2}` : `${y}`
}
export function periodRange(key: string): { from: string; to: string } {
  const y = Number(key.slice(0, 4))
  const end = (yy: number, mm: number) => toISO(new Date(yy, mm, 0)) // last day of month mm (1-12)
  let a = 1, b = 12
  const rest = key.slice(5)
  if (/^\d\d$/.test(rest)) { a = b = Number(rest) }
  else if (rest.startsWith('Q')) { const q = Number(rest[1]); a = q * 3 - 2; b = q * 3 }
  else if (rest.startsWith('H')) { const h = Number(rest[1]); a = h === 1 ? 1 : 7; b = h === 1 ? 6 : 12 }
  return { from: `${y}-${pad(a)}-01`, to: end(y, b) }
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export function periodLabel(key: string) {
  const y = key.slice(0, 4), rest = key.slice(5)
  if (/^\d\d$/.test(rest)) return `${MONTH[Number(rest) - 1]} ${y}`
  if (rest.startsWith('Q')) { const q = Number(rest[1]); return `Q${q} ${y} (${MON[q * 3 - 3]}–${MON[q * 3 - 1]})` }
  if (rest.startsWith('H')) return `${rest[1] === '1' ? 'Jan–Jun' : 'Jul–Dec'} ${y}`
  return `Year ${y}`
}
export function nextPeriod(key: string) { return periodOfNext(key) }
function periodOfNext(key: string) {
  const r = periodRange(key)
  const d = addDays(r.to, 1)
  const freq: Freq = /^\d{4}-\d\d$/.test(key) ? 'monthly' : key.includes('Q') ? 'quarterly' : key.includes('H') ? 'half_yearly' : 'yearly'
  return periodOf(freq, d)
}
/** due on day N of the month after the period ends */
export function dueDate(key: string, dueDay: number) {
  const to = periodRange(key).to
  const y = Number(to.slice(0, 4)), m = Number(to.slice(5, 7))
  return toISO(new Date(y, m, Math.min(28, Math.max(1, dueDay)))) // month index m = next month
}
export function periodsFor(s: Schedule, today = todayISO()): string[] {
  const start = s.start_period || periodOf(s.frequency, s.created_at.slice(0, 10))
  const cur = periodOf(s.frequency, today)
  const out: string[] = []
  let k = start
  for (let i = 0; i < 60 && k <= cur; i++) { out.push(k); k = periodOfNext(k) }
  return out.slice(-24).reverse()
}
export type SubState = 'filed' | 'overdue' | 'due' | 'open'
export function subState(s: Schedule, period: string, sub?: Submission, today = todayISO()): { state: SubState; due: string; days: number } {
  const due = dueDate(period, s.due_day)
  const days = Math.round((new Date(due).getTime() - new Date(today).getTime()) / 864e5)
  if (sub?.steps.filed) return { state: 'filed', due, days }
  if (periodRange(period).to >= today) return { state: 'open', due, days }
  return { state: days < 0 ? 'overdue' : 'due', due, days }
}
export const STATE_LABEL: Record<SubState, string> = { filed: 'Filed', overdue: 'Overdue', due: 'Due', open: 'Period in progress' }
export const STATE_TONE: Record<SubState, string> = { filed: 'green', overdue: 'red', due: 'amber', open: 'gray' }
export const lastStep = (sub?: Submission) => [...STEPS].reverse().find((s) => sub?.steps[s.key])

/* ---------------- data ---------------- */
export async function loadSubs(): Promise<{ schedules: Schedule[]; submissions: Submission[]; error?: string }> {
  const [a, b] = await Promise.all([
    supabase.from('report_schedules').select('*').order('created_at'),
    supabase.from('report_submissions').select('*').order('period', { ascending: false }).limit(2000),
  ])
  const err = a.error || b.error
  if (err) return { schedules: [], submissions: [], error: /does not exist|schema cache/i.test(err.message) ? 'Required submissions are not set up on the server yet (database update 018).' : err.message }
  return { schedules: (a.data || []) as Schedule[], submissions: (b.data || []) as Submission[] }
}
let tick = 0
const subs = new Set<() => void>()
export const subsChanged = () => { tick++; subs.forEach((f) => f()) }
export function useSubs() {
  const [data, set] = useState<{ schedules: Schedule[]; submissions: Submission[]; error?: string; loading: boolean }>({ schedules: [], submissions: [], loading: true })
  const hide = useHideDemo()
  const reload = useCallback(() => { void loadSubs().then((d) => set({ ...d, loading: false })) }, [])
  useEffect(() => { reload(); const f = () => reload(); subs.add(f); return () => { subs.delete(f) } }, [reload])
  // schedules for the demo company (and their submissions) are left out unless demo data is shown (lib/demo.ts)
  const shown = useMemo(() => {
    if (!hide) return data
    const schedules = data.schedules.filter((x) => !isDemoCompany(x.company_id))
    if (schedules.length === data.schedules.length) return data
    const ids = new Set(schedules.map((x) => x.id))
    return { ...data, schedules, submissions: data.submissions.filter((x) => ids.has(x.schedule_id)) }
  }, [data, hide])
  return { ...shown, reload, tick }
}
export async function saveSchedule(p: Partial<Schedule>) {
  const { data, error } = await supabase.rpc('save_report_schedule', { p })
  if (error) throw new Error(error.message)
  subsChanged()
  return data as string
}
export async function deleteSchedule(id: string) {
  const { error } = await supabase.rpc('delete_report_schedule', { p_id: id })
  if (error) throw new Error(error.message)
  subsChanged()
}
export async function doStep(scheduleId: string, period: string, step: StepKey | 'reset', note?: string, fileRef?: string) {
  const { data, error } = await supabase.rpc('report_submission_step', { p_schedule: scheduleId, p_period: period, p_step: step, p_note: note || null, p_file_ref: fileRef || null })
  if (error) throw new Error(error.message)
  subsChanged()
  return data
}
