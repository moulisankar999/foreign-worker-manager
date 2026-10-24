import { leaveBalances, outletName, ticketInfo } from '../../lib/calc'
import { refNo } from '../../lib/requests'
import { todayISO } from '../../lib/util'
import { ROLE_LABEL, STATUS_LABEL } from '../../lib/workflow'
import { hoursBetween, tat } from '../format'
import type { ReportDef, Row } from '../types'
import { W, WC, anyone, byName, doc, hr, kpi, pct, reqLabel, sum, table } from './helpers'

const CLOSED = ['cancelled', 'rejected', 'approved', 'applied', 'done', 'completed']

export const LEAVE: ReportDef[] = [
  {
    id: 'requests', title: 'Requests & approvals log', group: 'Leave & requests', desc: 'Every request in the period with who decided and how long it took (turnaround), plus open items', landscape: true, who: hr,
    filters: ['company', 'outlet', 'range'], status: 'all', routine: 'monthly',
    build: (c) => {
      const ids = new Set(c.workers.map((w) => w.id))
      const outlets = new Set(c.workers.map((w) => w.outletId))
      const ok = (r: { outlet_id: string | null; worker_id: string | null }) => (r.worker_id ? ids.has(r.worker_id) : !r.outlet_id || outlets.has(r.outlet_id) || (!c.f.outlet && !c.f.company))
      const now = new Date().toISOString()
      const rows = c.reqs.filter((r) => c.inRange(r.created_at.slice(0, 10)) && ok(r)).map((r) => {
        const w = c.all.find((x) => x.id === r.worker_id); const h = hoursBetween(r.created_at, r.decided_at); const open = !r.decided_at && !CLOSED.includes(r.status)
        const age = hoursBetween(r.created_at, now) || 0
        return { ref: refNo(r), type: reqLabel(r.type), worker: w ? `${w.fullName} (${w.workerNo})` : '', outlet: outletName(c.outlets, r.outlet_id || w?.outletId), by: r.created_by_name, at: r.created_at, lvl: ROLE_LABEL[r.required_level] || r.required_level, st: STATUS_LABEL[r.status] || r.status, dby: [r.decided_by_name, r.decided_by_role && `(${ROLE_LABEL[r.decided_by_role] || r.decided_by_role})`].filter(Boolean).join(' '), dat: r.decided_at, tat: h === null ? (open ? 'open ' + tat(age) : '') : tat(h), amt: r.amount ?? undefined, _h: h, _open: open, _type: r.type, _status: r.status, _tone: open && age > 72 ? 'amber' as const : r.status === 'rejected' ? 'gray' as const : undefined }
      }).sort((a, b) => String(a.at).localeCompare(String(b.at)))
      const avgOf = (l: typeof rows) => { const d = l.filter((r) => r._h !== null); return d.length ? tat(d.reduce((s, r) => s + (r._h || 0), 0) / d.length) : '' }
      const summ = [...new Set(rows.map((r) => r._type))].map((t) => { const l = rows.filter((r) => r._type === t); const d = l.filter((r) => r._h !== null)
        return { type: reqLabel(t), n: l.length, ap: l.filter((r) => /approved|applied|done|completed/.test(r._status)).length, rj: l.filter((r) => r._status === 'rejected').length, op: l.filter((r) => r._open).length, avg: avgOf(l), mx: d.length ? tat(Math.max(...d.map((r) => r._h || 0))) : '' } }).sort((a, b) => b.n - a.n)
      const dec = rows.filter((r) => r._h !== null), open = rows.filter((r) => r._open).length
      return doc([
        { kind: 'kpis', items: [kpi('Requests', rows.length), kpi('Decided', dec.length, 'green'), kpi('Still open', open, open ? 'amber' : undefined), kpi('Average turnaround', avgOf(rows) || '—'), kpi('Decided within 24 h', dec.length ? pct(dec.filter((r) => (r._h || 0) <= 24).length, dec.length) + '%' : '—')] },
        table([{ key: 'type', label: 'Request type', w: 24 }, { key: 'n', label: 'Total', fmt: 'int', w: 7 }, { key: 'ap', label: 'Approved', fmt: 'int', w: 7 }, { key: 'rj', label: 'Rejected', fmt: 'int', w: 7 }, { key: 'op', label: 'Open', fmt: 'int', w: 7 }, { key: 'avg', label: 'Avg turnaround', w: 9 }, { key: 'mx', label: 'Longest', w: 9 }], summ, { title: 'Summary by type', totals: { type: 'TOTAL', n: rows.length, ap: sum(summ, 'ap'), rj: sum(summ, 'rj'), op: open, avg: avgOf(rows) } }),
        table([{ key: 'ref', label: 'Ref', w: 7 }, { key: 'type', label: 'Type', w: 11 }, { key: 'worker', label: 'Worker', w: 15 }, { key: 'outlet', label: 'Outlet', w: 10 }, { key: 'by', label: 'Raised by', w: 10 }, { key: 'at', label: 'Raised', fmt: 'dt', w: 10 }, { key: 'lvl', label: 'Needs', w: 8 }, { key: 'st', label: 'Status', w: 8 }, { key: 'dby', label: 'Decided by', w: 13 }, { key: 'dat', label: 'Decided', fmt: 'dt', w: 10 }, { key: 'tat', label: 'Turnaround', w: 7 }, { key: 'amt', label: 'RM', fmt: 'rm', w: 6 }], rows, { title: 'All requests', empty: 'No requests in this period' }),
      ], rows.length)
    },
  },
  {
    id: 'leave', title: 'Leave balances', group: 'Leave & requests', desc: 'Annual leave entitlement, carry-forward, taken and balance for the current leave year', who: hr,
    filters: ['company', 'outlet', 'nat'], status: 'current', routine: 'quarterly',
    build: (c) => {
      const rows = c.workers.map((w): Row => { const y = leaveBalances(w, c.s).pop(); return { ...W(c, w), join: w.joinDate, ent: w.annualLeaveDays ?? c.s.annualLeaveDays, bf: y?.carryIn, yr: y?.entitled, used: y?.used, bal: y?.balance, status: w.status, _tone: (y?.balance ?? 0) < 0 ? 'red' : undefined } }).sort(byName)
      return doc([table([...WC, { key: 'join', label: 'Joined', fmt: 'date', w: 8 }, { key: 'ent', label: 'Days / yr', fmt: 'num', w: 6 }, { key: 'bf', label: 'Brought fwd', fmt: 'num', w: 7 }, { key: 'yr', label: 'This year', fmt: 'num', w: 6 }, { key: 'used', label: 'Taken', fmt: 'num', w: 6 }, { key: 'bal', label: 'Balance', fmt: 'num', w: 6 }, { key: 'status', label: 'Status', w: 10 }], rows, { totals: { name: 'TOTAL', used: sum(rows, 'used'), bal: sum(rows, 'bal') } })], rows.length)
    },
  },
  {
    id: 'leaveapps', title: 'Leave taken & applications', group: 'Leave & requests', desc: 'Leave in the period by type with approval, return and ticket details', landscape: true, who: hr,
    filters: ['company', 'outlet', 'nat', 'range'], status: 'all', routine: 'monthly',
    build: (c) => {
      const today = todayISO()
      const rows = c.workers.flatMap((w) => (w.leaves || []).filter((l) => c.inRange(l.from) || c.inRange(l.to)).map((l): Row => { const late = l.status === 'Approved' && !l.returned && l.to < today
        return { ...W(c, w), type: l.type, from: l.from, to: l.to, days: l.days, st: l.status, by: l.approvedBy, ret: l.returned ? (l.returnedOn || 'Yes') : late ? 'NOT RETURNED' : '', tk: l.ticketProvided ? l.ticketDetails || 'Yes' : '', cost: l.ticketCost, paid: l.ticketProvided ? l.ticketPaidBy : '', _tone: late ? 'red' : undefined } })).sort((a, b) => String(a.from).localeCompare(String(b.from)))
      const types = [...new Set(rows.map((r) => String(r.type)))]
      return doc([
        { kind: 'kpis', items: [kpi('Applications', rows.length), ...types.slice(0, 4).map((t) => kpi(t, sum(rows.filter((r) => r.type === t), 'days') + ' days', undefined, rows.filter((r) => r.type === t).length + ' application(s)'))] },
        table([...WC, { key: 'type', label: 'Type', w: 8 }, { key: 'from', label: 'From', fmt: 'date', w: 8 }, { key: 'to', label: 'To', fmt: 'date', w: 8 }, { key: 'days', label: 'Days', fmt: 'num', w: 4 }, { key: 'st', label: 'Approval', w: 7 }, { key: 'by', label: 'By', w: 10 }, { key: 'ret', label: 'Returned', w: 9 }, { key: 'tk', label: 'Ticket', w: 9 }, { key: 'cost', label: 'Ticket RM', fmt: 'rm', w: 7 }, { key: 'paid', label: 'Paid by', w: 7 }], rows, { empty: 'No leave in this period' }),
      ], rows.length)
    },
  },
  {
    id: 'emergency', title: 'Emergency leave register', group: 'Leave & requests', desc: 'Emergency / compassionate leave with reason, family member, proof status and ticket decision', landscape: true, who: hr,
    filters: ['company', 'outlet', 'range'], status: 'all', routine: 'quarterly',
    build: (c) => {
      const rows = c.workers.flatMap((w) => (w.leaves || []).filter((l) => (l.type === 'Emergency' || l.emergencyReason) && c.inRange(l.from)).map((l): Row => ({ ...W(c, w), from: l.from, to: l.to, days: l.days, reason: l.emergencyReason || l.remarks, rel: l.relationship, proof: l.proofStatus || 'pending', st: l.status, ret: l.returned ? 'Yes' : '', cost: l.ticketCost, dec: (l.ticketDecision || '').replace('_', ' '), _tone: (l.proofStatus || 'pending') === 'pending' ? 'amber' : undefined }))).sort((a, b) => String(a.from).localeCompare(String(b.from)))
      return doc([
        { kind: 'kpis', items: [kpi('Emergency leaves', rows.length), kpi('Days', sum(rows, 'days')), kpi('Proof still pending', rows.filter((r) => r.proof === 'pending').length, 'amber'), kpi('Ticket cost (RM)', sum(rows, 'cost').toFixed(2))] },
        table([...WC, { key: 'from', label: 'From', fmt: 'date', w: 8 }, { key: 'to', label: 'To', fmt: 'date', w: 8 }, { key: 'days', label: 'Days', fmt: 'num', w: 4 }, { key: 'reason', label: 'Reason', w: 12, wrap: true }, { key: 'rel', label: 'Family member', w: 8 }, { key: 'proof', label: 'Proof', w: 7 }, { key: 'st', label: 'Status', w: 7 }, { key: 'ret', label: 'Back', w: 4 }, { key: 'cost', label: 'Ticket RM', fmt: 'rm', w: 7 }, { key: 'dec', label: 'Ticket decision', w: 9 }], rows, { empty: 'No emergency leave in this period' }),
      ], rows.length)
    },
  },
  {
    id: 'tickets', title: 'Flight ticket entitlement', group: 'Leave & requests', desc: 'Return tickets earned, used and due, with estimated value', who: hr,
    filters: ['company', 'outlet', 'nat'], status: 'current',
    build: (c) => {
      const rows = c.workers.map((w) => { const t = ticketInfo(w, c.s); return { ...W(c, w), join: w.joinDate, earned: t.earned, used: t.used, bal: t.balance, val: t.value, last: t.lastTrip, next: t.nextDate } }).sort((a, b) => b.bal - a.bal || byName(a, b))
      return doc([table([...WC, { key: 'join', label: 'Joined', fmt: 'date', w: 8 }, { key: 'earned', label: 'Earned', fmt: 'int', w: 6 }, { key: 'used', label: 'Used', fmt: 'int', w: 6 }, { key: 'bal', label: 'Due', fmt: 'int', w: 5 }, { key: 'val', label: 'Est. value RM', fmt: 'rm', w: 9 }, { key: 'last', label: 'Last trip', fmt: 'date', w: 8 }, { key: 'next', label: 'Next earned', fmt: 'date', w: 8 }], rows, { totals: { name: 'TOTAL', bal: sum(rows, 'bal'), val: sum(rows, 'val') } })], rows.length)
    },
  },
  {
    id: 'remarks', title: 'Outlet manager remarks', group: 'Leave & requests', desc: 'Remarks, performance notes, incidents and praise recorded on workers in the period', who: anyone,
    filters: ['company', 'outlet', 'range', 'worker'], status: 'all', routine: 'monthly',
    build: (c) => {
      const ids = new Set(c.workers.map((w) => w.id))
      const rows = c.remarks.filter((r) => ids.has(r.workerId) && c.inRange(r.at.slice(0, 10)) && (!c.f.worker || r.workerId === c.f.worker)).map((r): Row => { const w = c.all.find((x) => x.id === r.workerId)!
        return { at: r.at, no: w.workerNo, name: w.fullName, _group: outletName(c.outlets, w.outletId), k: (r.kind || 'remark').replace(/^./, (x) => x.toUpperCase()), t: r.text, by: [r.by, r.byRole && `(${ROLE_LABEL[r.byRole] || r.byRole})`].filter(Boolean).join(' '), _tone: r.kind === 'incident' ? 'red' : r.kind === 'praise' ? 'green' : undefined } }).sort((a, b) => String(a._group).localeCompare(String(b._group)) || String(a.at).localeCompare(String(b.at)))
      const k = (x: string) => rows.filter((r) => String(r.k).toLowerCase() === x).length
      return doc([
        { kind: 'kpis', items: [kpi('Remarks', rows.length), kpi('Incidents', k('incident'), k('incident') ? 'red' : undefined), kpi('Performance', k('performance')), kpi('Praise', k('praise'), 'green')] },
        table([{ key: 'at', label: 'Date', fmt: 'dt', w: 12 }, { key: 'no', label: 'ID', w: 6 }, { key: 'name', label: 'Worker', w: 14 }, { key: 'k', label: 'Type', w: 9 }, { key: 't', label: 'Remark', w: 40, wrap: true }, { key: 'by', label: 'By', w: 14 }], rows, { groupBy: '_group', groupLabel: (g, n) => `${g} — ${n}`, empty: 'No remarks in this period' }),
      ], rows.length)
    },
  },
]
