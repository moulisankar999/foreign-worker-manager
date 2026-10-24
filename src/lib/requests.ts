/* Requests & approvals: cloud-only (needs a connection), live-updated through realtime. */
import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { useDemoOutletIds, useHideDemo } from './demo'
import { db, updateWorker } from './db'
import { currentBasic } from './calc'
import { defaultChecklist } from './memo'
import { REQUEST_TYPE, type RequestRow } from './workflow'
import { daysBetweenInclusive, todayISO, uid } from './util'
import type { LeaveRec, MemoRec, PassportMove, Worker, WorkerStatus } from './types'

export interface RequestEvent { id: number; request_id: string; at: string; by_name: string | null; by_role: string | null; action: string; from_status: string | null; to_status: string | null; comment: string | null
  to_user?: string | null; to_name?: string | null; to_role?: string | null; meta?: Record<string, unknown> | null }
export const refNo = (r: Pick<RequestRow, 'ref_no'>) => `REQ-${r.ref_no}`

const err = (e: { message: string } | null) => {
  if (!e) return
  const m = e.message.replace(/^.*?ERROR:\s*/, '')
  throw new Error(!navigator.onLine ? 'You are offline. Requests need an internet connection.' : m)
}

/* ---------- live list ---------- */
const subs = new Set<() => void>()
let tick = 0
let ch: ReturnType<typeof supabase.channel> | null = null
export function requestsChanged() { tick++; subs.forEach((f) => f()) }
function ensureLive() {
  if (ch) return
  ch = supabase.channel('requests-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'requests' }, () => requestsChanged())
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'request_events' }, () => requestsChanged())
    .subscribe()
}
export function useTick() {
  const [t, setT] = useState(tick)
  useEffect(() => { ensureLive(); const f = () => setT(tick); subs.add(f); return () => { subs.delete(f) } }, [])
  return t
}
const CACHE = 'fwm-requests'
export function useRequests(opts: { workerId?: string } = {}) {
  const t = useTick()
  const [state, setState] = useState<{ rows: RequestRow[]; loading: boolean; error: string }>(() => {
    try { const rows = JSON.parse(localStorage.getItem(CACHE) || '[]') as RequestRow[]; return { rows: opts.workerId ? rows.filter((r) => r.worker_id === opts.workerId) : rows, loading: true, error: '' } } catch { return { rows: [], loading: true, error: '' } }
  })
  useEffect(() => {
    let alive = true
    ;(async () => {
      let q = supabase.from('requests').select('*').order('updated_at', { ascending: false }).limit(1000)
      if (opts.workerId) q = q.eq('worker_id', opts.workerId)
      const { data, error } = await q
      if (!alive) return
      if (error) { setState((s) => ({ ...s, loading: false, error: navigator.onLine ? error.message : 'Offline — showing the last saved list' })); return }
      if (!opts.workerId) localStorage.setItem(CACHE, JSON.stringify(data))
      setState({ rows: data as RequestRow[], loading: false, error: '' })
    })()
    return () => { alive = false }
  }, [t, opts.workerId])
  // the demo company (App Review) stays out of the lists and counts unless shown (lib/demo.ts)
  const hide = useHideDemo()
  const demo = useDemoOutletIds()
  return useMemo(() => (hide && demo.size && !opts.workerId ? { ...state, rows: state.rows.filter((r) => !demo.has(r.outlet_id || '')) } : state),
    [state, hide, demo, opts.workerId])
}
export function useRequest(id?: string) {
  const t = useTick()
  const [state, setState] = useState<{ req: RequestRow | null; events: RequestEvent[]; loading: boolean; error: string }>({ req: null, events: [], loading: true, error: '' })
  useEffect(() => {
    if (!id) return
    let alive = true
    ;(async () => {
      const [{ data: r, error }, { data: ev }] = await Promise.all([
        supabase.from('requests').select('*').eq('id', id).maybeSingle(),
        supabase.from('request_events').select('*').eq('request_id', id).order('at'),
      ])
      if (!alive) return
      setState({ req: r as RequestRow | null, events: (ev || []) as RequestEvent[], loading: false, error: error ? error.message : '' })
    })()
    return () => { alive = false }
  }, [id, t])
  return state
}

/* ---------- actions ---------- */
export async function createRequest(type: string, workerId: string, title: string, data: Record<string, unknown>, amount: number | null, priority = 'normal'): Promise<RequestRow> {
  const { data: r, error } = await supabase.rpc('request_create', { p_type: type, p_worker_id: workerId, p_title: title, p_data: data, p_amount: amount, p_priority: priority })
  err(error)
  requestsChanged()
  return r as RequestRow
}
export async function actRequest(id: string, action: string, comment?: string, patch?: Record<string, unknown>): Promise<RequestRow> {
  const { data, error } = action === 'mgr_approve' || action === 'mgr_reject'
    ? await supabase.rpc('request_manager_act', { p_id: id, p_action: action === 'mgr_approve' ? 'approve' : 'reject', p_comment: comment || null })
    : await supabase.rpc('request_act', { p_id: id, p_action: action, p_comment: comment || null, p_patch: patch || null })
  err(error)
  requestsChanged()
  return data as RequestRow
}
/* ---------- assign / escalate (CEO and GM only; enforced by request_assign on the server) ---------- */
export interface Assignee { id: string; name: string; role: string; roleLabel: string }
export async function listAssignees(id: string): Promise<Assignee[]> {
  const { data, error } = await supabase.rpc('request_assignees', { p_id: id })
  err(error)
  return (data || []) as Assignee[]
}
export async function assignRequest(id: string, userId: string, note?: string): Promise<RequestRow> {
  const { data, error } = await supabase.rpc('request_assign', { p_id: id, p_user: userId, p_note: note?.trim() || null })
  err(error)
  requestsChanged()
  return data as RequestRow
}
export async function noteRequest(id: string, data: Record<string, unknown>, comment: string) {
  const { error } = await supabase.rpc('request_note', { p_id: id, p_data: data, p_comment: comment })
  err(error)
  requestsChanged()
}

/* ---------- emergency leave helpers ---------- */
/** words that show annual / home leave being filed as an emergency */
const NOT_EMERGENCY = /\b(annual leave|holiday|vacation|balik kampung|cuti tahunan|home leave|festival|raya|wedding of friend|visit family)\b/i
export function emergencyMisuse(text: string) { return NOT_EMERGENCY.test(text) }
export function proofDue(r: RequestRow, days: number): string {
  const start = String(r.data.from || r.created_at.slice(0, 10))
  const d = new Date(start); d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
export type ProofState = 'received' | 'pending' | 'overdue' | 'waived' | 'n/a'
export function proofState(r: RequestRow, proofDocs: number, days: number): ProofState {
  if (r.type !== 'emergency_leave') return 'n/a'
  if (r.data.proofWaived) return 'waived'
  if (proofDocs > 0 || r.data.proofReceived) return 'received'
  return proofDue(r, days) < todayISO() ? 'overdue' : 'pending'
}

/* ---------- apply an approved request to the worker record (HR) ---------- */
export interface ApplyChoice { ticketDecision?: 'reimburse' | 'entitlement' | 'worker_pays'; note?: string }
export async function applyRequest(r: RequestRow, choice: ApplyChoice = {}, ticketDocId?: string): Promise<string> {
  const t = REQUEST_TYPE[r.type]
  const d = r.data as Record<string, string | number | boolean | undefined>
  const w = await db.workers.get(r.worker_id || '')
  if (!w) throw new Error('Worker not found on this device — sync first')
  const by = r.decided_by_name || 'HR'
  const ref = `REQ-${r.ref_no}`
  let summary = ''
  await updateWorker(w.id, (x: Worker) => {
    const today = todayISO()
    switch (t?.effect) {
      case 'leave': {
        const type = r.type === 'annual_leave' ? 'Annual' : r.type === 'medical_leave' ? 'Medical' : r.type === 'emergency_leave' ? 'Emergency' : 'Home Leave'
        const from = String(d.from || today), to = String(d.to || from)
        const rec: LeaveRec = {
          id: uid(), type, from, to, days: daysBetweenInclusive(from, to), status: 'Approved', approvedBy: by, appliedOn: r.created_at.slice(0, 10),
          remarks: `${ref}${d.reason ? ' — ' + d.reason : ''}`, requestId: r.id,
        }
        if (r.type === 'home_leave' && d.ticketNeeded) {
          Object.assign(rec, { ticketProvided: true, ticketPaidBy: 'Company', ticketDetails: String(d.route || ''), ticketCost: Number(d.ticketCost) || undefined, ticketFromEntitlement: true, ticketStatus: ticketDocId ? 'booked' : 'needed', ticketDocId })
        }
        if (r.type === 'emergency_leave') {
          const dec = choice.ticketDecision || 'worker_pays'
          Object.assign(rec, {
            emergencyReason: String(d.reasonLabel || d.reasonKey || ''), relationship: d.relationship ? String(d.relationship) : undefined,
            proofStatus: d.proofWaived ? 'waived' : d.proofReceived ? 'received' : 'pending', ticketDecision: dec,
            ticketProvided: true, ticketDetails: String(d.route || ''), ticketCost: Number(d.ticketCost) || undefined,
            ticketPaidBy: dec === 'worker_pays' ? 'Worker' : 'Company', ticketFromEntitlement: dec === 'entitlement', ticketStatus: 'booked', ticketDocId,
          })
          if (dec === 'reimburse') x.notes.push({ id: uid(), date: today, text: `${ref}: emergency ticket RM${Number(d.ticketCost) || 0} to be reimbursed to worker (HR decision).` })
        }
        x.leaves.push(rec)
        summary = `${type} leave ${from} → ${to} recorded`
        break
      }
      case 'increment': {
        const old = currentBasic(x)
        x.increments.push({ id: uid(), date: String(d.date || today), oldPay: old, newPay: old + (Number(d.increase) || 0), reason: `${ref} ${d.reason || ''}`.trim() })
        summary = `Basic pay RM${old} → RM${old + (Number(d.increase) || 0)}`
        break
      }
      case 'advance': case 'loan': {
        const amount = Number(d.amount) || 0, n = Math.max(1, Number(d.instalments) || 1)
        x.loans.push({ id: uid(), date: String(d.startDate || today), type: t.effect === 'loan' ? 'Loan' : 'Advance', amount, purpose: `${ref} ${d.reason || ''}`.trim(), monthlyDeduction: Math.round((amount / n) * 100) / 100 })
        summary = `${t.effect === 'loan' ? 'Loan' : 'Advance'} RM${amount} recorded (${n} month(s))`
        break
      }
      case 'deduction':
        x.deductions.push({ id: uid(), date: String(d.date || today), amount: Number(d.amount) || 0, type: String(d.dtype) === 'Damage' ? 'Damage' : 'Other', remarks: `${ref} ${d.dtype || ''} ${d.reason || ''}`.trim() })
        summary = `Deduction RM${Number(d.amount) || 0} recorded`
        break
      case 'penalty':
        if (Number(d.amount) > 0) x.deductions.push({ id: uid(), date: today, amount: Number(d.amount), type: 'Penalty', remarks: `${ref} ${d.action || ''}` })
        x.notes.push({ id: uid(), date: today, text: `${ref}: ${d.action || 'Disciplinary action'} — ${d.reason || ''}` })
        summary = `${d.action || 'Penalty'} recorded`
        break
      case 'memo': {
        const kind = (String(d.kind || 'Home Leave Checkout')) as MemoRec['kind']
        x.memos.push({ id: uid(), kind, date: String(d.date || today), expectedReturn: d.expectedReturn ? String(d.expectedReturn) : undefined, checklist: defaultChecklist(kind), outstandingBalance: 0, notes: `${ref} ${d.reason || ''}`.trim() })
        summary = `${kind} memo created`
        break
      }
      case 'transfer':
        x.notes.push({ id: uid(), date: String(d.date || today), text: `${ref}: transferred from outlet ${x.outletId || '—'} to ${d.toOutlet}` })
        x.outletId = String(d.toOutlet)
        summary = 'Outlet changed'
        break
      case 'exit': case 'absconded': {
        const to = (t.effect === 'absconded' ? 'Absconded' : r.type === 'termination' ? 'Terminated' : String(d.exitType || 'Resigned')) as WorkerStatus
        const date = String(d.lastDay || d.lastSeen || today)
        if (x.status !== to) x.statusHistory.push({ id: uid(), date, from: x.status, to, remarks: ref })
        x.status = to
        if (t.effect === 'exit') x.exitDate = date
        summary = `Status → ${to}`
        break
      }
      case 'details':
        if (d.phoneMY) x.phoneMY = String(d.phoneMY)
        if (d.phoneHome) x.phoneHome = String(d.phoneHome)
        if (d.hostelAddress) x.hostelAddress = String(d.hostelAddress)
        if (d.overseasAddress) x.overseasAddress = String(d.overseasAddress)
        if (d.family) x.notes.push({ id: uid(), date: today, text: `${ref} family change: ${d.family}` })
        summary = 'Details updated'
        break
      case 'passport': {
        const action = String(d.action || '')
        const ps = x.passportSafe || { consent: 'not_issued' as const }
        const move: PassportMove = { id: uid(), kind: action.startsWith('Release') ? 'release' : action.startsWith('Return') ? 'return' : 'deposit', date: String(d.date || today), by, reason: d.reason ? String(d.reason) : action, expectedReturn: d.expectedReturn ? String(d.expectedReturn) : undefined, requestId: r.id }
        if (move.kind !== 'deposit') {
          ps.moves = [...(ps.moves || []), move]
          ps.custody = move.kind === 'release' ? 'released' : 'in_safe'
          x.passportSafe = { ...ps }
          summary = move.kind === 'release' ? 'Passport released to worker' : 'Passport back in safe'
        } else summary = 'Passport copy given'
        break
      }
      default:
        summary = 'Noted'
    }
    x.notes.push({ id: uid(), date: today, text: `${ref} ${t?.label || r.type} applied: ${summary}${choice.note ? ' — ' + choice.note : ''}` })
  })
  return summary
}
