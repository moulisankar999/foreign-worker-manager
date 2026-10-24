import type { Perms } from '../../lib/auth'
import { outletName } from '../../lib/calc'
import { FOMEMA, INSURANCE, PERMIT } from '../../lib/compliance'
import { passportOf } from '../../lib/passport'
import { ABSCOND_STEPS, EXIT_STEPS } from '../../lib/trackers'
import { EXITED_STATUSES, type Worker } from '../../lib/types'
import { REQUEST_TYPES } from '../../lib/workflow'
import { daysUntil } from '../../lib/util'
import { maskId } from '../format'
import type { Block, Col, Ctx, ReportDoc, Row, Tone } from '../types'

/* ---------------- who may run a report (the data is already limited by the server for the role) ---------------- */
const HR_ROLES = ['super_admin', 'general_manager', 'hr_admin', 'hr_manager']
export const anyone = (p: Perms) => !!p.role
export const hr = (p: Perms) => HR_ROLES.includes(p.role || '')
export const pay = (p: Perms) => p.canSeeSalary
export const remit = (p: Perms) => ['super_admin', 'hr_admin', 'hr_manager'].includes(p.role || '') // = can_view_remittance() on the server
export const audit = (p: Perms) => p.canSeeAudit
export const users = (p: Perms) => p.isAdmin
export const isLimited = (p: Perms) => p.role === 'outlet_manager' || p.role === 'viewer'

/* ---------------- building blocks ---------------- */
export const W = (c: Ctx, w: Worker): Row => ({ _wid: w.id, no: w.workerNo, name: w.fullName, outlet: outletName(c.outlets, w.outletId) })
export const WC: Col[] = [{ key: 'no', label: 'ID', w: 7 }, { key: 'name', label: 'Worker', w: 16 }, { key: 'outlet', label: 'Outlet', w: 13 }]
export const byName = (a: Row, b: Row) => String(a.outlet).localeCompare(String(b.outlet)) || String(a.name).localeCompare(String(b.name))
export const sum = (rows: Row[], k: string) => rows.reduce((t, r) => t + (Number(r[k]) || 0), 0)
export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0)
export const daysTone = (d: number | null | undefined, warn = 30): Tone | undefined => (d === null || d === undefined ? undefined : d < 0 ? 'red' : d <= warn ? 'amber' : undefined)
export const docName = (t: string, label?: string) => (t === 'Other' ? label || 'Other' : t === PERMIT ? 'Work permit (PLKS)' : t === INSURANCE ? 'Insurance (SPIKPA)' : t === FOMEMA ? 'FOMEMA medical' : t)
export const reqLabel = (t: string) => REQUEST_TYPES.find((x) => x.key === t)?.label || t
export const exitDateOf = (w: Worker) => w.exitDate || [...w.statusHistory].reverse().find((h) => EXITED_STATUSES.includes(h.to as Worker['status']))?.date || ''
export const kpi = (label: string, value: string | number, tone?: Tone, sub?: string) => ({ label, value, tone, sub })
export const table = (cols: Col[], rows: Row[], o: Partial<Extract<Block, { kind: 'table' }>> = {}): Block => ({ kind: 'table', cols, rows, ...o })
export const doc = (blocks: Block[], rows = 0): ReportDoc => ({ blocks, rows })
export const ppNo = (c: Ctx, w: Worker) => maskId(passportOf(w).no, c.mask)
export const withinOk = (within: string, n: number) => !within || (within === 'expired' ? n < 0 : n <= Number(within))
export const errNote = (c: Ctx): Block[] => (c.extra.error ? [{ kind: 'note', tone: 'red', text: c.extra.error }] : [])
export function flowDone(w: Worker) {
  const f = w.exitFlow
  if (!f) return ''
  const steps = f.kind === 'abscond' ? ABSCOND_STEPS : EXIT_STEPS
  return `${steps.filter((s) => f.steps?.[s.key]?.done).length}/${steps.length}${f.closed ? ' (closed)' : ''}`
}
/** days until an ISO date (0 if unparseable) */
export const dleft = (d?: string) => daysUntil(d) ?? 0
