/* 1.6.0: 8-week trend lines for the home stat tiles, rebuilt from each worker's own status history and
 * document dates (no extra data stored). Week points are the Malaysia-date end of each of the last 8 weeks. */
import { currentDocs } from './calc'
import { EXITED_STATUSES, LEAVE_STATUSES, type Worker } from './types'

const myt = (t: number) => new Date(t + 8 * 3600e3).toISOString().slice(0, 10)
/** status on a given day: the last status change on or before it; before joining → null */
export function statusOn(w: Worker, day: string): string | null {
  const start = w.joinDate || w.firstArrivalDate || (w.createdAt || '').slice(0, 10)
  if (start && start > day) return null
  const hist = (w.statusHistory || []).filter((h) => h.date && h.date <= day).sort((a, b) => a.date.localeCompare(b.date))
  if (hist.length) return hist[hist.length - 1].to
  const first = (w.statusHistory || []).filter((h) => h.date).sort((a, b) => a.date.localeCompare(b.date))[0]
  return first?.from || (first ? null : w.status)
}
export interface Trends { total: number[]; active: number[]; leave: number[]; expired: number[] }
export function weeklyTrends(workers: Worker[], weeks = 8, now = Date.now()): Trends {
  const out: Trends = { total: [], active: [], leave: [], expired: [] }
  for (let i = weeks - 1; i >= 0; i--) {
    const day = myt(now - i * 7 * 864e5)
    let total = 0, active = 0, leave = 0, expired = 0
    for (const w of workers) {
      const st = statusOn(w, day)
      if (!st || (EXITED_STATUSES as string[]).includes(st)) continue
      total++
      if (st === 'Active-Working') active++
      if ((LEAVE_STATUSES as string[]).includes(st)) leave++
      for (const d of currentDocs(w)) if (d.expiryDate && d.expiryDate < day && (!d.issueDate || d.issueDate <= day)) expired++
    }
    out.total.push(total); out.active.push(active); out.leave.push(leave); out.expired.push(expired)
  }
  return out
}
