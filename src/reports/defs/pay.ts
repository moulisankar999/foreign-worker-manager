import { allowancesTotal, currentBasic, isExited, loanBalance, minContractEnd, payAlerts, proratedPenalty, sortedIncrements } from '../../lib/calc'
import { companyName, outletCompany } from '../../lib/companies'
import { computePayslip, monthLabel } from '../../lib/pay'
import { RECRUITMENT_COSTS } from '../../lib/trackers'
import { monthsBetween, todayISO } from '../../lib/util'
import { maskAcct } from '../format'
import type { ReportDef, Row } from '../types'
import { W, WC, byName, daysTone, dleft, doc, exitDateOf, hr, kpi, pay, remit, sum, table, withinOk } from './helpers'

const money = (n: number) => n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const PAY: ReportDef[] = [
  {
    id: 'payroll', title: 'Payroll cost summary by outlet', group: 'Pay & money', desc: 'Headcount, basic pay and allowance totals for current workers by company and outlet', who: pay,
    filters: ['company', 'outlet', 'btype'], status: 'current', routine: 'monthly',
    build: (c) => {
      const m = new Map<string, { _group: string; outlet: string; type?: string; hc: number; basic: number; allow: number }>()
      for (const w of c.workers) {
        const o = c.outlets.find((x) => x.id === w.outletId)
        const k = w.outletId || '—'
        const r = m.get(k) || { _group: companyName(c.companies, outletCompany(o)) || 'No company', outlet: o?.name || 'No outlet', type: o?.type, hc: 0, basic: 0, allow: 0 }
        r.hc++; r.basic += currentBasic(w); r.allow += allowancesTotal(w)
        m.set(k, r)
      }
      const rows: Row[] = [...m.values()].map((r) => ({ ...r, gross: r.basic + r.allow, avg: r.basic / r.hc })).sort((a, b) => String(a._group).localeCompare(String(b._group)) || String(a.outlet).localeCompare(String(b.outlet)))
      const hc = sum(rows, 'hc'), basic = sum(rows, 'basic'), allow = sum(rows, 'allow')
      return doc([
        { kind: 'kpis', items: [kpi('Current workers', hc), kpi('Monthly basic (RM)', money(basic)), kpi('Allowances (RM)', money(allow)), kpi('Gross / month (RM)', money(basic + allow)), kpi('Average basic (RM)', money(hc ? basic / hc : 0))] },
        table([{ key: 'outlet', label: 'Outlet', w: 24 }, { key: 'type', label: 'Business', w: 12 }, { key: 'hc', label: 'Headcount', fmt: 'int', w: 8 }, { key: 'basic', label: 'Basic (RM)', fmt: 'rm', w: 11 }, { key: 'allow', label: 'Allowances (RM)', fmt: 'rm', w: 11 }, { key: 'gross', label: 'Gross (RM)', fmt: 'rm', w: 11 }, { key: 'avg', label: 'Avg basic (RM)', fmt: 'rm', w: 10 }], rows, { groupBy: '_group', totals: { outlet: 'TOTAL', hc, basic, allow, gross: basic + allow, avg: hc ? basic / hc : 0 } }),
        { kind: 'note', text: 'Contractual monthly pay from worker records (before overtime and statutory contributions). See the payslip register for actual monthly pay.' },
      ], rows.length)
    },
  },
  {
    id: 'payslips', title: 'Payslip & statutory contributions register', group: 'Pay & money', desc: 'Monthly payslips: gross, overtime, EPF, SOCSO, EIS, deductions and net pay (estimates)', landscape: true, who: pay,
    filters: ['company', 'outlet', 'month'], status: 'all', routine: 'monthly',
    build: (c) => {
      const month = c.f.month || todayISO().slice(0, 7)
      const rows = c.workers.flatMap((w) => (w.payslips || []).filter((p) => p.month === month).map((p): Row => { const r = computePayslip(p, c.cfg.rates, w)
        return { ...W(c, w), basic: r.basicEarned, ot: r.otTotal, gross: r.gross, epfEe: r.epfEe, epfEr: r.epfEr, socEe: r.socsoEe, socEr: r.socsoEr, eis: r.lindung, ded: r.otherDeductions, net: r.net, cost: r.employerCost, pd: p.payDate, warn: r.warnings.filter((x) => x.level !== 'info').length || undefined, _tone: r.warnings.some((x) => x.level === 'red') ? 'red' : undefined } })).sort(byName)
      const noSlip = c.workers.filter((w) => !isExited(w) && w.joinDate.slice(0, 7) <= month && !(w.payslips || []).some((p) => p.month === month))
      const keys = ['basic', 'ot', 'gross', 'epfEe', 'epfEr', 'socEe', 'socEr', 'eis', 'ded', 'net', 'cost']
      const tot: Row = { name: 'TOTAL' }; for (const k of keys) tot[k] = sum(rows, k)
      const stat = ['epfEe', 'epfEr', 'socEe', 'socEr', 'eis'].reduce((t, k) => t + Number(tot[k]), 0)
      return doc([
        { kind: 'kpis', items: [kpi('Payslips', rows.length), kpi('Gross (RM)', money(Number(tot.gross))), kpi('Net pay (RM)', money(Number(tot.net))), kpi('EPF + SOCSO + EIS (RM)', money(stat), undefined, 'employee + employer'), kpi('Missing payslips', noSlip.length, noSlip.length ? 'amber' : undefined)] },
        table([{ key: 'no', label: 'ID', w: 5 }, { key: 'name', label: 'Worker', w: 13 }, { key: 'outlet', label: 'Outlet', w: 10 }, { key: 'basic', label: 'Basic', fmt: 'rm', w: 6.5 }, { key: 'ot', label: 'OT', fmt: 'rm', w: 6 }, { key: 'gross', label: 'Gross', fmt: 'rm', w: 6.5 }, { key: 'epfEe', label: 'EPF ee', fmt: 'rm', w: 5.5 }, { key: 'epfEr', label: 'EPF er', fmt: 'rm', w: 5.5 }, { key: 'socEe', label: 'SOCSO ee', fmt: 'rm', w: 5.5 }, { key: 'socEr', label: 'SOCSO er', fmt: 'rm', w: 5.5 }, { key: 'eis', label: 'EIS', fmt: 'rm', w: 4.5 }, { key: 'ded', label: 'Deduct.', fmt: 'rm', w: 6 }, { key: 'net', label: 'Net', fmt: 'rm', w: 6.5 }, { key: 'cost', label: 'Employer cost', fmt: 'rm', w: 7 }, { key: 'pd', label: 'Paid on', fmt: 'date', w: 6.5 }, { key: 'warn', label: 'Flags', fmt: 'int', w: 4 }],
          rows, { title: `Payslips for ${monthLabel(month)} (RM)`, totals: tot, empty: 'No payslips saved for this month' }),
        table(WC, noSlip.map((w) => W(c, w)).sort(byName), { title: 'Current workers with no payslip this month', empty: 'None' }),
        { kind: 'note', tone: 'amber', text: 'ESTIMATES: EPF, SOCSO and EIS amounts are calculated by FW Manager from the rates in Settings → Pay & Leave rules. Always check them against the official KWSP / PERKESO contribution tables before payment.' },
      ], rows.length)
    },
  },
  {
    id: 'paycomp', title: 'Pay compliance check', group: 'Pay & money', desc: 'Minimum wage, overtime limits, late payment, deduction limits and hostel deduction checks', who: pay,
    filters: ['company', 'outlet', 'month'], status: 'current', routine: 'monthly',
    build: (c) => {
      const month = c.f.month || todayISO().slice(0, 7)
      const rows: Row[] = []
      for (const w of c.workers) {
        for (const p of (w.payslips || []).filter((x) => x.month === month)) for (const x of computePayslip(p, c.cfg.rates, w).warnings.filter((x) => x.level !== 'info')) rows.push({ ...W(c, w), src: 'Payslip ' + monthLabel(month), issue: x.text, rule: x.source, lvl: x.level === 'red' ? 'Breach' : 'Check', _tone: x.level === 'red' ? 'red' : 'amber' })
        for (const a of payAlerts(w, c.s)) if (a.severity !== 'info') { const bad = a.severity === 'high' || a.severity === 'critical'; rows.push({ ...W(c, w), src: 'Worker record', issue: a.title, rule: a.detail, lvl: bad ? 'Breach' : 'Check', _tone: bad ? 'red' : 'amber' }) }
      }
      rows.sort((a, b) => String(a.lvl).localeCompare(String(b.lvl)) || byName(a, b))
      const below = c.workers.filter((w) => payAlerts(w, c.s).some((a) => a.id === `pay-minwage-${w.id}`))
      return doc([
        { kind: 'kpis', items: [kpi('Workers checked', c.workers.length), kpi('Breaches', rows.filter((r) => r.lvl === 'Breach').length, 'red'), kpi('To check', rows.filter((r) => r.lvl === 'Check').length, 'amber'), kpi('Below minimum wage', below.length, below.length ? 'red' : 'green'), kpi('Exempt from min. wage', c.workers.filter((w) => w.minWageExempt).length)] },
        table([...WC, { key: 'lvl', label: 'Level', w: 6 }, { key: 'src', label: 'Source', w: 10 }, { key: 'issue', label: 'Issue', w: 24, wrap: true }, { key: 'rule', label: 'Rule / detail', w: 30, wrap: true }], rows, { title: `Payslips for ${monthLabel(month)} and current worker records`, empty: 'No pay compliance issues found' }),
        { kind: 'note', text: 'Checks use the minimum wage, overtime and deduction rules in Settings → Pay & Leave rules (Employment Act 1955, Minimum Wages Order). Confirm with JTKSM if unsure.' },
      ], rows.length)
    },
  },
  {
    id: 'loans', title: 'Loans & advances', group: 'Pay & money', desc: 'Every loan and salary advance with repaid amount, balance and monthly deduction', who: pay,
    filters: ['company', 'outlet', 'status', 'range'], status: 'all', routine: 'monthly',
    build: (c) => {
      const rows = c.workers.flatMap((w) => (w.loans || []).filter((l) => !c.f.from || c.inRange(l.date) || loanBalance(w, l.id) > 0).map((l): Row => { const b = loanBalance(w, l.id); return { ...W(c, w), type: l.type, date: l.date, purpose: l.purpose, amt: l.amount, paid: l.amount - b, bal: b, mo: l.monthlyDeduction, st: isExited(w) ? w.status : '', _tone: b > 0 && isExited(w) ? 'red' : undefined } })).sort(byName)
      const owedEx = rows.filter((r) => r.st).reduce((t, r) => t + Number(r.bal), 0)
      return doc([
        { kind: 'kpis', items: [kpi('Loans / advances', rows.length), kpi('Lent (RM)', money(sum(rows, 'amt'))), kpi('Outstanding (RM)', money(sum(rows, 'bal')), 'amber'), kpi('Owed by exited workers (RM)', money(owedEx), owedEx ? 'red' : undefined)] },
        table([...WC, { key: 'type', label: 'Type', w: 7 }, { key: 'date', label: 'Date', fmt: 'date', w: 8 }, { key: 'purpose', label: 'Purpose', w: 12, wrap: true }, { key: 'amt', label: 'Amount', fmt: 'rm', w: 7 }, { key: 'paid', label: 'Repaid', fmt: 'rm', w: 7 }, { key: 'bal', label: 'Balance', fmt: 'rm', w: 7 }, { key: 'mo', label: 'Monthly', fmt: 'rm', w: 6 }, { key: 'st', label: 'Exited', w: 7 }], rows, { title: 'Amounts in RM', totals: { name: 'TOTAL', amt: sum(rows, 'amt'), paid: sum(rows, 'paid'), bal: sum(rows, 'bal'), mo: sum(rows, 'mo') }, empty: 'No loans or advances' }),
      ], rows.length)
    },
  },
  {
    id: 'deductions', title: 'Salary deductions register', group: 'Pay & money', desc: 'All salary deductions in the period by type', who: pay,
    filters: ['company', 'outlet', 'range'], status: 'all', routine: 'monthly',
    build: (c) => {
      const rows = c.workers.flatMap((w) => (w.deductions || []).filter((d) => c.inRange(d.date)).map((d) => ({ ...W(c, w), date: d.date, type: d.type, amt: d.amount, rem: d.remarks }))).sort((a, b) => String(a.date).localeCompare(String(b.date)))
      const types = [...new Set(rows.map((r) => String(r.type)))].map((t) => ({ t, n: rows.filter((r) => r.type === t).length, a: sum(rows.filter((r) => r.type === t), 'amt') }))
      return doc([
        table([{ key: 't', label: 'Type', w: 30 }, { key: 'n', label: 'Count', fmt: 'int', w: 8 }, { key: 'a', label: 'Amount (RM)', fmt: 'rm', w: 12 }], types, { title: 'By type', totals: { t: 'TOTAL', n: rows.length, a: sum(rows, 'amt') } }),
        table([{ key: 'date', label: 'Date', fmt: 'date', w: 8 }, ...WC, { key: 'type', label: 'Type', w: 11 }, { key: 'amt', label: 'Amount (RM)', fmt: 'rm', w: 9 }, { key: 'rem', label: 'Remarks', w: 22, wrap: true }], rows, { title: 'All deductions', totals: { name: 'TOTAL', amt: sum(rows, 'amt') }, empty: 'No deductions in this period' }),
      ], rows.length)
    },
  },
  {
    id: 'increments', title: 'Increments & pay changes', group: 'Pay & money', desc: 'Pay changes effective in the period with % increase', who: pay,
    filters: ['company', 'outlet', 'range'], status: 'all', routine: 'yearly',
    build: (c) => {
      const rows = c.workers.flatMap((w) => sortedIncrements(w).filter((i) => c.inRange(i.date)).map((i) => ({ ...W(c, w), date: i.date, old: i.oldPay, new: i.newPay, chg: i.newPay - i.oldPay, pct: i.oldPay ? Math.round(((i.newPay - i.oldPay) / i.oldPay) * 1000) / 10 : undefined, reason: i.reason }))).sort((a, b) => String(a.date).localeCompare(String(b.date)))
      return doc([
        { kind: 'kpis', items: [kpi('Pay changes', rows.length), kpi('Added to monthly pay (RM)', money(sum(rows, 'chg'))), kpi('Average increase', rows.length ? (Math.round((sum(rows, 'pct') / rows.length) * 10) / 10) + '%' : '—')] },
        table([{ key: 'date', label: 'Effective', fmt: 'date', w: 8 }, ...WC, { key: 'old', label: 'Old basic', fmt: 'rm', w: 8 }, { key: 'new', label: 'New basic', fmt: 'rm', w: 8 }, { key: 'chg', label: 'Change', fmt: 'rm', w: 7 }, { key: 'pct', label: '%', fmt: 'pct', w: 5 }, { key: 'reason', label: 'Reason', w: 16, wrap: true }], rows, { title: 'Amounts in RM', totals: { name: 'TOTAL', chg: sum(rows, 'chg') }, empty: 'No pay changes in this period' }),
      ], rows.length)
    },
  },
  {
    id: 'costs', title: 'Recruitment costs & zero-cost compliance', group: 'Pay & money', desc: 'Levy, permit, visa, agent and other costs, who paid them, and zero-cost declarations', landscape: true, who: pay,
    filters: ['company', 'outlet', 'range'], status: 'all', routine: 'quarterly',
    build: (c) => {
      const rows = c.workers.flatMap((w) => (w.costs || []).filter((x) => c.inRange(x.date)).map((x): Row => { const bad = RECRUITMENT_COSTS.includes(x.type) && x.paidBy === 'Worker' && !x.refunded
        return { ...W(c, w), date: x.date, type: x.type, amt: x.amount, by: x.paidBy, ref: x.refunded ? 'Refunded' : '', notes: x.notes, flag: bad ? 'Worker paid — refund' : '', _tone: bad ? 'red' : undefined } })).sort((a, b) => String(a.date).localeCompare(String(b.date)))
      const types = [...new Set(rows.map((r) => String(r.type)))].map((t) => { const l = rows.filter((r) => r.type === t); return { t, co: sum(l.filter((r) => r.by === 'Company'), 'amt'), wk: sum(l.filter((r) => r.by === 'Worker'), 'amt'), ag: sum(l.filter((r) => r.by === 'Agent'), 'amt'), tot: sum(l, 'amt') } })
      const cur = c.workers.filter((w) => !isExited(w))
      const wk = sum(types, 'wk')
      return doc([
        { kind: 'kpis', items: [kpi('Total cost (RM)', money(sum(rows, 'amt'))), kpi('Paid by company (RM)', money(sum(types, 'co'))), kpi('Paid by workers (RM)', money(wk), wk ? 'red' : undefined), kpi('Zero-cost declarations signed', `${cur.filter((w) => w.zeroCost?.status === 'signed').length} / ${cur.length}`)] },
        table([{ key: 't', label: 'Cost type', w: 24 }, { key: 'co', label: 'Company', fmt: 'rm', w: 10 }, { key: 'wk', label: 'Worker', fmt: 'rm', w: 10 }, { key: 'ag', label: 'Agent', fmt: 'rm', w: 10 }, { key: 'tot', label: 'Total', fmt: 'rm', w: 10 }], types, { title: 'By type (RM)', totals: { t: 'TOTAL', co: sum(types, 'co'), wk, ag: sum(types, 'ag'), tot: sum(types, 'tot') } }),
        table([{ key: 'date', label: 'Date', fmt: 'date', w: 8 }, ...WC, { key: 'type', label: 'Type', w: 13 }, { key: 'amt', label: 'Amount RM', fmt: 'rm', w: 8 }, { key: 'by', label: 'Paid by', w: 7 }, { key: 'ref', label: 'Refund', w: 7 }, { key: 'flag', label: 'Check', w: 11 }, { key: 'notes', label: 'Notes', w: 14, wrap: true }], rows, { title: 'All costs', empty: 'No costs recorded in this period' }),
        { kind: 'note', text: 'Recruitment fees, levy, permit and visa costs should not be borne by the worker (employer-pays / zero-cost recruitment). Refund any amount a worker paid.' },
      ], rows.length)
    },
  },
  {
    id: 'remittance', title: 'Remittance accounts register', group: 'Pay & money', desc: 'Remittance providers and beneficiaries on record (account numbers masked)', landscape: true, who: remit,
    filters: ['company', 'outlet', 'nat'], status: 'current',
    build: (c) => {
      const rows = c.workers.flatMap((w) => (w.remittance || []).map((r) => ({ ...W(c, w), prov: r.provider, ben: r.beneficiaryName, rel: r.relationship, ctry: r.country, bank: r.bankOrWallet, acct: maskAcct(r.accountNo), pri: r.isPrimary ? 'Primary' : '' }))).sort(byName)
      const none = c.workers.filter((w) => !(w.remittance || []).length)
      return doc([
        { kind: 'kpis', items: [kpi('Accounts on record', rows.length), kpi('Workers with an account', c.workers.length - none.length, 'green'), kpi('Workers without', none.length, none.length ? 'amber' : undefined)] },
        table([...WC, { key: 'prov', label: 'Provider', w: 11 }, { key: 'ben', label: 'Beneficiary', w: 14 }, { key: 'rel', label: 'Relation', w: 8 }, { key: 'ctry', label: 'Country', w: 9 }, { key: 'bank', label: 'Bank / wallet', w: 12 }, { key: 'acct', label: 'Account', w: 8 }, { key: 'pri', label: '', w: 6 }], rows, { empty: 'No remittance accounts recorded' }),
      ], rows.length)
    },
  },
  {
    id: 'exits', title: 'Exit settlements & penalties', group: 'Pay & money', desc: 'Workers who left: service, minimum period, prorated penalty, loan balance and clearance', who: pay,
    filters: ['company', 'outlet', 'range'], status: 'exited', routine: 'quarterly',
    build: (c) => {
      const rows = c.workers.filter((w) => isExited(w) && c.inRange(exitDateOf(w))).map((w) => {
        const exit = exitDateOf(w) || todayISO(); const memo = (w.memos || []).filter((m) => m.kind === 'Exit Clearance').pop()
        return { ...W(c, w), status: w.status, exit, served: Math.round(monthsBetween(w.contractStart || w.joinDate, exit) * 10) / 10, min: w.minContractMonths, pen: memo?.penalty ?? proratedPenalty(w, exit).penalty, bal: memo?.outstandingBalance ?? (w.loans || []).reduce((t, l) => t + loanBalance(w, l.id), 0), memo: memo ? `${memo.checklist.filter((x) => x.done).length}/${memo.checklist.length}` : 'No memo' }
      }).sort((a, b) => String(a.exit).localeCompare(String(b.exit)))
      return doc([table([...WC, { key: 'status', label: 'Exit type', w: 9 }, { key: 'exit', label: 'Exit date', fmt: 'date', w: 8 }, { key: 'served', label: 'Served (mo)', fmt: 'num', w: 7 }, { key: 'min', label: 'Min (mo)', fmt: 'int', w: 6 }, { key: 'pen', label: 'Penalty RM', fmt: 'rm', w: 8 }, { key: 'bal', label: 'Loan bal. RM', fmt: 'rm', w: 8 }, { key: 'memo', label: 'Clearance', w: 7 }], rows, { totals: { name: 'TOTAL', pen: sum(rows, 'pen'), bal: sum(rows, 'bal') }, empty: 'No exits in this period' })], rows.length)
    },
  },
  {
    id: 'contracts', title: 'Contracts & minimum period', group: 'Pay & money', desc: 'Contract end dates, minimum-period end and penalty if the worker left today', who: hr,
    filters: ['company', 'outlet', 'within'], status: 'current',
    build: (c) => {
      const within = c.f.within || ''
      const rows = c.workers.map((w) => { const n = w.contractEnd ? dleft(w.contractEnd) : null; return { ...W(c, w), start: w.contractStart, end: w.contractEnd, d: n ?? undefined, min: minContractEnd(w), pen: c.p.canSeeSalary ? proratedPenalty(w, todayISO()).penalty : undefined, _n: n ?? 99999, _tone: daysTone(n, 60) } }).filter((r) => withinOk(within, r._n)).sort((a, b) => a._n - b._n)
      return doc([table([...WC, { key: 'start', label: 'Start', fmt: 'date', w: 8 }, { key: 'end', label: 'End', fmt: 'date', w: 8 }, { key: 'd', label: 'Days left', fmt: 'int', w: 6 }, { key: 'min', label: 'Min. period ends', fmt: 'date', w: 9 }, ...(c.p.canSeeSalary ? [{ key: 'pen', label: 'Penalty today RM', fmt: 'rm' as const, w: 9 }] : [])], rows)], rows.length)
    },
  },
]
