import { allowancesTotal, currentBasic, currentDocs, docStatus, isExited, isOnLeave, latestDoc, leaveBalances, loanBalance, minContractEnd, outletName, ticketInfo } from '../../lib/calc'
import { FOMEMA, PERMIT } from '../../lib/compliance'
import { companyName, outletCompany } from '../../lib/companies'
import { missingLanguage, otherLanguagesText, primaryLangName } from '../../lib/languages'
import { CONSENT_LABEL, CUSTODY_LABEL, consentOf, custodyOf, passportOf } from '../../lib/passport'
import { stayYears } from '../../lib/trackers'
import type { Worker } from '../../lib/types'
import { age, daysUntil, fmtDate, serviceText, todayISO } from '../../lib/util'
import { maskAcct, maskId } from '../format'
import type { Block, Col, ReportDef, Row } from '../types'
import { W, WC, anyone, byName, daysTone, doc, docName, exitDateOf, flowDone, hr, isLimited, kpi, pct, ppNo, sum, table } from './helpers'

export const WORKFORCE: ReportDef[] = [
  {
    id: 'headcount', title: 'Headcount summary', group: 'Workforce', desc: 'Workers by company and outlet, with status, gender and nationality mix', who: anyone,
    filters: ['company', 'outlet', 'btype', 'nat', 'status'], status: 'current', routine: 'monthly',
    build: (c) => {
      const ws = c.workers
      const nats = [...new Set(ws.map((w) => w.nationality || 'Other'))].map((n) => [n, ws.filter((w) => (w.nationality || 'Other') === n).length] as const).sort((a, b) => b[1] - a[1])
      const top = nats.slice(0, 4).map(([n]) => n)
      const cols: Col[] = [{ key: 'outlet', label: 'Outlet', w: 20 }, { key: 'type', label: 'Business', w: 11 }, { key: 'act', label: 'Working', fmt: 'int', w: 6 }, { key: 'lv', label: 'On leave', fmt: 'int', w: 6 }, { key: 'ex', label: 'Exited', fmt: 'int', w: 5 }, { key: 'm', label: 'Male', fmt: 'int', w: 5 }, { key: 'f', label: 'Female', fmt: 'int', w: 5.5 },
        ...top.map((n) => ({ key: 'n_' + n, label: n, fmt: 'int' as const, w: 7 })), { key: 'oth', label: 'Others', fmt: 'int', w: 5.5 }, { key: 'tot', label: 'Total', fmt: 'int', w: 5.5 }]
      const rows: Row[] = []
      const groups = new Map<string, Worker[]>()
      for (const w of ws) { const k = w.outletId || ''; groups.set(k, [...(groups.get(k) || []), w]) }
      for (const [oid, list] of groups) {
        const o = c.outlets.find((x) => x.id === oid)
        const r: Row = { _group: companyName(c.companies, outletCompany(o)) || 'No company', outlet: o?.name || 'No outlet', type: o?.type || '', act: list.filter((w) => w.status === 'Active-Working').length, lv: list.filter(isOnLeave).length, ex: list.filter(isExited).length, m: list.filter((w) => w.gender === 'Male').length, f: list.filter((w) => w.gender === 'Female').length, tot: list.length }
        for (const n of top) r['n_' + n] = list.filter((w) => w.nationality === n).length
        r.oth = list.filter((w) => !top.includes(w.nationality)).length
        rows.push(r)
      }
      rows.sort((a, b) => String(a._group).localeCompare(String(b._group)) || String(a.outlet).localeCompare(String(b.outlet)))
      const totals: Row = { outlet: 'TOTAL', type: '' }
      for (const k of cols.slice(2)) totals[k.key] = sum(rows, k.key)
      const jobs = [...new Set(ws.map((w) => w.jobCategory || 'Not set'))].map((j) => ({ job: j, n: ws.filter((w) => (w.jobCategory || 'Not set') === j).length })).sort((a, b) => b.n - a.n)
      const share: Col[] = [{ key: 'n', label: 'Workers', fmt: 'int', w: 12 }, { key: 'p', label: 'Share', fmt: 'pct', w: 12 }]
      return doc([
        { kind: 'kpis', items: [kpi('Workers in report', ws.length), kpi('Working', ws.filter((w) => w.status === 'Active-Working').length, 'green'), kpi('On leave', ws.filter(isOnLeave).length, 'amber'), kpi('Outlets', groups.size), kpi('Nationalities', nats.length)] },
        table(cols, rows, { title: 'By company and outlet', totals, groupBy: '_group' }),
        table([{ key: 'nat', label: 'Nationality', w: 30 }, ...share], nats.map(([n, k]) => ({ nat: n, n: k, p: pct(k, ws.length) })), { title: 'By nationality' }),
        table([{ key: 'job', label: 'Job', w: 30 }, ...share], jobs.map((j) => ({ ...j, p: pct(j.n, ws.length) })), { title: 'By job' }),
      ], ws.length)
    },
  },
  {
    id: 'master', title: 'Worker master list', group: 'Workforce', desc: 'One line per worker: identity, job, service, status and key document expiries', landscape: true, who: anyone,
    filters: ['company', 'outlet', 'btype', 'nat', 'gender', 'status'], status: 'current', routine: 'monthly',
    build: (c) => {
      const rows = c.workers.map((w): Row => ({ ...W(c, w), _group: outletName(c.outlets, w.outletId), nat: w.nationality, g: w.gender?.[0], age: age(w.dob) ?? undefined, job: w.jobCategory, join: w.joinDate, svc: serviceText(w.joinDate, w.exitDate), status: w.status, pp: ppNo(c, w), ppx: passportOf(w).expiry, vpx: latestDoc(w, PERMIT)?.expiryDate, fmx: latestDoc(w, FOMEMA)?.expiryDate, lang: missingLanguage(w) ? 'Not recorded' : primaryLangName(w), _tone: isExited(w) ? 'gray' : undefined })).sort(byName)
      return doc([table([{ key: 'no', label: 'ID', w: 6 }, { key: 'name', label: 'Worker', w: 15 }, { key: 'nat', label: 'Nationality', w: 8 }, { key: 'g', label: 'M/F', w: 3.5 }, { key: 'age', label: 'Age', fmt: 'int', w: 3.5 }, { key: 'job', label: 'Job', w: 9 }, { key: 'lang', label: 'Language', w: 7 }, { key: 'join', label: 'Joined', fmt: 'date', w: 7 }, { key: 'svc', label: 'Service', w: 7 }, { key: 'status', label: 'Status', w: 8 }, { key: 'pp', label: 'Passport no.', w: 8 }, { key: 'ppx', label: 'Passport exp.', fmt: 'date', w: 7 }, { key: 'vpx', label: 'Permit exp.', fmt: 'date', w: 7 }, { key: 'fmx', label: 'FOMEMA exp.', fmt: 'date', w: 7 }],
        rows, { groupBy: '_group', groupLabel: (g, n) => `${g} — ${n} worker${n === 1 ? '' : 's'}` })], rows.length)
    },
  },
  {
    id: 'profile', title: 'Worker profile sheet', group: 'Workforce', desc: 'Full record per worker, one worker per page (pick a worker, or print every worker in the filter)', who: anyone,
    filters: ['company', 'outlet', 'nat', 'status', 'worker'], status: 'current',
    build: (c) => {
      const list = (c.f.worker ? c.all.filter((w) => w.id === c.f.worker) : c.workers).slice().sort((a, b) => a.fullName.localeCompare(b.fullName)).slice(0, 300)
      const blocks: Block[] = []
      list.forEach((w, i) => {
        if (i) blocks.push({ kind: 'pagebreak' })
        const o = c.outlets.find((x) => x.id === w.outletId)
        const st = stayYears(w)
        blocks.push({ kind: 'person', name: w.fullName, photo: w.photo, badge: w.status, tone: isExited(w) ? 'gray' : w.status === 'Active-Working' ? 'green' : 'amber',
          lines: [`Worker ID ${w.workerNo} · ${w.nationality}${w.gender ? ' · ' + w.gender : ''}${w.dob ? ' · Age ' + age(w.dob) : ''}`, `${o?.name || 'No outlet'}${o ? ' · ' + companyName(c.companies, outletCompany(o)) : ''}`, `${w.jobCategory || 'Job not set'}${w.skillLevel ? ' · ' + w.skillLevel : ''} · joined ${fmtDate(w.joinDate)} (${serviceText(w.joinDate, w.exitDate)})`] })
        blocks.push({ kind: 'fields', title: 'Personal', cols: 3, items: [['Date of birth', fmtDate(w.dob)], ['Religion', w.religion], ['Primary language', missingLanguage(w) ? 'Not recorded' : primaryLangName(w)], ['Other languages', otherLanguagesText(w)], ['Phone (MY)', w.phoneMY], ['Phone (home)', w.phoneHome], ['Hostel address', w.hostelAddress], ['Home address', w.overseasAddress], ['Agent', w.agent]] })
        blocks.push({ kind: 'fields', title: 'Employment & permit', cols: 3, items: [['Business', w.businessType], ['Contract', w.contractStart ? `${fmtDate(w.contractStart)} – ${fmtDate(w.contractEnd)}` : ''], ['Minimum period ends', fmtDate(minContractEnd(w))], ['Employer on PLKS', w.permitEmployer], ['Sector on PLKS', w.permitSector], ['Years in Malaysia', st === null ? '' : (Math.round(st * 10) / 10) + ' yrs'], ['Passport custody', CUSTODY_LABEL[custodyOf(w)]], ['Safekeeping consent', CONSENT_LABEL[consentOf(w)]], ['Exit date', fmtDate(w.exitDate)]] })
        const docs = currentDocs(w).sort((a, b) => (a.expiryDate || '9').localeCompare(b.expiryDate || '9'))
        blocks.push(table([{ key: 'doc', label: 'Document', w: 20 }, { key: 'no', label: 'Number', w: 14 }, { key: 'iss', label: 'Issued', fmt: 'date', w: 10 }, { key: 'exp', label: 'Expires', fmt: 'date', w: 10 }, { key: 'd', label: 'Days left', fmt: 'int', w: 8 }, { key: 'stage', label: 'Stage', w: 14 }, { key: 'st', label: 'Status', w: 10 }],
          docs.map((d) => { const n = daysUntil(d.expiryDate); return { doc: docName(d.type, d.label), no: d.type === 'Passport' ? maskId(d.number, c.mask) : d.number, iss: d.issueDate, exp: d.expiryDate, d: n ?? undefined, stage: d.stage, st: docStatus(d, c.s), _tone: daysTone(n) } }), { title: 'Documents', empty: 'No documents recorded' }))
        if (w.family?.length) blocks.push(table([{ key: 'rel', label: 'Relation', w: 10 }, { key: 'n', label: 'Name', w: 20 }, { key: 'ph', label: 'Phone', w: 14 }, { key: 'fl', label: 'Contact', w: 14 }], w.family.map((f) => ({ rel: f.relation, n: f.name, ph: f.phone, fl: [f.isNextOfKin && 'Next of kin', f.isEmergency && 'Emergency'].filter(Boolean).join(', ') })), { title: 'Family & next of kin' }))
        if (c.p.canSeeSalary && w.initialBasicPay !== undefined) {
          const ob = (w.loans || []).reduce((t, l) => t + loanBalance(w, l.id), 0)
          blocks.push({ kind: 'fields', title: 'Pay (confidential, RM)', cols: 4, items: [['Basic pay', currentBasic(w).toFixed(2)], ['Allowances', allowancesTotal(w).toFixed(2)], ['Loan / advance balance', ob.toFixed(2)], ['Bank', [w.bankName, maskAcct(w.bankAccount)].filter(Boolean).join(' ')]] })
        }
        if (!isLimited(c.p)) {
          const lb = leaveBalances(w, c.s).pop(); const t = ticketInfo(w, c.s)
          blocks.push({ kind: 'fields', title: 'Leave & ticket', cols: 4, items: [['Annual leave balance', lb ? `${lb.balance} day(s)` : ''], ['Leave taken this year', lb ? `${lb.used} day(s)` : ''], ['Return tickets due', String(t.balance)], ['Last trip home', fmtDate(t.lastTrip)]] })
        }
        const rem = c.remarks.filter((r) => r.workerId === w.id).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5)
        if (rem.length) blocks.push(table([{ key: 'at', label: 'Date', fmt: 'date', w: 9 }, { key: 'k', label: 'Type', w: 9 }, { key: 't', label: 'Remark', w: 50, wrap: true }, { key: 'by', label: 'By', w: 14 }], rem.map((r) => ({ at: r.at.slice(0, 10), k: r.kind || 'remark', t: r.text, by: r.by })), { title: 'Latest remarks' }))
        const hist = [...w.statusHistory].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4)
        if (hist.length) blocks.push(table([{ key: 'd', label: 'Date', fmt: 'date', w: 10 }, { key: 'fr', label: 'From', w: 14 }, { key: 'to', label: 'To', w: 14 }, { key: 'r', label: 'Remarks', w: 40, wrap: true }], hist.map((h) => ({ d: h.date, fr: h.from, to: h.to, r: h.remarks })), { title: 'Status history' }))
      })
      if (!list.length) blocks.push({ kind: 'note', text: 'No worker matches the filters.' })
      return doc(blocks, list.length)
    },
  },
  {
    id: 'movement', title: 'Joiners, leavers & turnover', group: 'Workforce', desc: 'New joiners, exits by type (resigned, terminated, ended, repatriated, absconded) and turnover for the period', who: hr,
    filters: ['company', 'outlet', 'nat', 'range'], status: 'all', routine: 'monthly',
    build: (c) => {
      const from = c.f.from || '0000', to = c.f.to || todayISO()
      const ws = c.workers
      const gone = (w: Worker, d: string) => isExited(w) && !!exitDateOf(w) && exitDateOf(w) < d
      const open = ws.filter((w) => w.joinDate < from && !gone(w, from)).length
      const joined = ws.filter((w) => c.inRange(w.joinDate))
      const left = ws.filter((w) => isExited(w) && c.inRange(exitDateOf(w)))
      const close = ws.filter((w) => w.joinDate <= to && !(isExited(w) && exitDateOf(w) && exitDateOf(w) <= to)).length
      const avg = (open + close) / 2
      const types = ['Resigned', 'Terminated', 'Contract Ended', 'Repatriated', 'Absconded']
      const ab = left.filter((w) => w.status === 'Absconded').length
      return doc([
        { kind: 'kpis', items: [kpi('Opening headcount', open), kpi('Joined', joined.length, 'green'), kpi('Left', left.length, left.length ? 'amber' : undefined), kpi('Closing headcount', close), kpi('Turnover', pct(left.length, avg) + '%', undefined, 'leavers ÷ average headcount'), kpi('Absconded', ab, ab ? 'red' : undefined)] },
        table([{ key: 't', label: 'Exit type', w: 30 }, { key: 'n', label: 'Workers', fmt: 'int', w: 10 }, { key: 'p', label: 'Share of leavers', fmt: 'pct', w: 14 }], types.map((t) => { const n = left.filter((w) => w.status === t).length; return { t, n, p: pct(n, left.length) } }), { title: 'Leavers by type', totals: { t: 'TOTAL', n: left.length, p: left.length ? 100 : 0 } }),
        table([...WC, { key: 'nat', label: 'Nationality', w: 10 }, { key: 'job', label: 'Job', w: 12 }, { key: 'join', label: 'Joined', fmt: 'date', w: 9 }, { key: 'agent', label: 'Agent', w: 12 }], joined.map((w) => ({ ...W(c, w), nat: w.nationality, job: w.jobCategory, join: w.joinDate, agent: w.agent })).sort((a, b) => String(a.join).localeCompare(String(b.join))), { title: 'Joiners', empty: 'No joiners in this period' }),
        table([...WC, { key: 'type', label: 'Exit type', w: 10 }, { key: 'ex', label: 'Exit date', fmt: 'date', w: 9 }, { key: 'svc', label: 'Service', w: 9 }, { key: 'fl', label: 'Exit checklist', w: 9 }, { key: 'pp', label: 'Passport', w: 11 }], left.map((w): Row => ({ ...W(c, w), type: w.status, ex: exitDateOf(w), svc: serviceText(w.joinDate, exitDateOf(w) || undefined), fl: flowDone(w) || 'Not started', pp: CUSTODY_LABEL[custodyOf(w)], _tone: w.status === 'Absconded' ? 'red' : undefined })).sort((a, b) => String(a.ex).localeCompare(String(b.ex))), { title: 'Leavers', empty: 'No leavers in this period' }),
      ], joined.length + left.length)
    },
  },
  {
    id: 'abscond', title: 'Absconding & repatriation tracker', group: 'Workforce', desc: 'Absconded and leaving workers with police, Immigration, COM and PLKS cancellation steps', who: hr,
    filters: ['company', 'outlet', 'range'], status: 'all', routine: 'monthly',
    build: (c) => {
      const list = c.workers.filter((w) => (isExited(w) || w.exitFlow) && (c.inRange(exitDateOf(w) || w.exitFlow?.started) || (!!w.exitFlow && !w.exitFlow.closed)))
      const ab = list.filter((w) => w.status === 'Absconded' || w.exitFlow?.kind === 'abscond')
      const ex = list.filter((w) => !ab.includes(w))
      const st = (w: Worker, k: string) => { const s = w.exitFlow?.steps?.[k]; return s?.done ? fmtDate(s.date) || 'Done' : '' }
      const noPol = ab.filter((w) => !w.exitFlow?.steps?.police?.done).length, noImm = ab.filter((w) => !w.exitFlow?.steps?.immigration?.done).length
      return doc([
        { kind: 'kpis', items: [kpi('Absconded', ab.length, ab.length ? 'red' : undefined), kpi('Police report missing', noPol, noPol ? 'red' : undefined), kpi('Immigration not told', noImm, noImm ? 'red' : undefined), kpi('Other exits', ex.length), kpi('PLKS not cancelled', list.filter((w) => !w.exitFlow?.steps?.cancel?.done).length, 'amber')] },
        table([...WC, { key: 'seen', label: 'Last seen', fmt: 'date', w: 8 }, { key: 'pol', label: 'Police report', w: 9 }, { key: 'imm', label: 'Immigration', w: 9 }, { key: 'can', label: 'PLKS cancelled', w: 9 }, { key: 'fl', label: 'Steps', w: 7 }],
          ab.map((w): Row => ({ ...W(c, w), seen: w.exitFlow?.lastSeen || exitDateOf(w), pol: st(w, 'police') || 'MISSING', imm: st(w, 'immigration') || 'MISSING', can: st(w, 'cancel') || 'No', fl: flowDone(w), _tone: !w.exitFlow?.steps?.police?.done || !w.exitFlow?.steps?.immigration?.done ? 'red' : undefined })), { title: 'Absconded workers', empty: 'None' }),
        table([{ key: 'no', label: 'ID', w: 6 }, { key: 'name', label: 'Worker', w: 14 }, { key: 'type', label: 'Exit type', w: 9 }, { key: 'ex', label: 'Exit date', fmt: 'date', w: 8 }, { key: 'memo', label: 'Exit memo', w: 7.5 }, { key: 'fp', label: 'Final pay', w: 7.5 }, { key: 'pp', label: 'Passport back', w: 7.5 }, { key: 'tk', label: 'Ticket', w: 7.5 }, { key: 'com', label: 'COM', w: 7.5 }, { key: 'can', label: 'PLKS cancelled', w: 7.5 }],
          ex.map((w) => ({ ...W(c, w), type: w.status, ex: exitDateOf(w), memo: st(w, 'memo'), fp: st(w, 'finalPay'), pp: st(w, 'passport'), tk: st(w, 'ticket'), com: st(w, 'com'), can: st(w, 'cancel') })), { title: 'Exits & repatriation checklist (date each step was done)', empty: 'None' }),
        { kind: 'note', text: 'Absconding: make a police report and report to Immigration (FWCMS eRUNAWAY) promptly. Check exact rules with JTKSM / Immigration or your agent.' },
      ], list.length)
    },
  },
  {
    id: 'family', title: 'Next-of-kin & emergency contacts', group: 'Workforce', desc: 'Family members, next of kin and emergency contacts per worker', who: hr,
    filters: ['company', 'outlet', 'nat', 'status'], status: 'current',
    build: (c) => {
      const rows = c.workers.flatMap((w) => (w.family || []).map((f) => ({ ...W(c, w), rel: f.relation, fname: f.name, phone: f.phone, flags: [f.isNextOfKin && 'Next of kin', f.isEmergency && 'Emergency'].filter(Boolean).join(', ') }))).sort(byName)
      const none = c.workers.filter((w) => !(w.family || []).some((f) => f.isNextOfKin || f.isEmergency))
      return doc([
        table([...WC, { key: 'rel', label: 'Relation', w: 9 }, { key: 'fname', label: 'Name', w: 18 }, { key: 'phone', label: 'Phone', w: 13 }, { key: 'flags', label: 'Contact', w: 14 }], rows),
        table(WC, none.map((w) => W(c, w)).sort(byName), { title: 'No next of kin / emergency contact recorded', empty: 'Every worker has one' }),
      ], rows.length)
    },
  },
]
