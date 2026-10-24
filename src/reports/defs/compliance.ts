import { buildAlerts, currentDocs, isExited, latestDoc, outletName } from '../../lib/calc'
import { healthScore, FOMEMA, INSURANCE, PERMIT } from '../../lib/compliance'
import { missingLanguage } from '../../lib/languages'
import { CONSENT_LABEL, CUSTODY_LABEL, consentOf, custodyOf, lastRelease, overdueDays, passportOf } from '../../lib/passport'
import { monthLabel } from '../../lib/pay'
import { outletRisks } from '../../lib/risk'
import { fomemaDue, hostelIssues, stayYears } from '../../lib/trackers'
import { REQUIRED_DOCS, type Worker } from '../../lib/types'
import { fmtDate, monthsBetween } from '../../lib/util'
import { maskId } from '../format'
import type { ReportDef, Row } from '../types'
import { W, WC, anyone, byName, daysTone, dleft, doc, docName, hr, kpi, pct, sum, table, withinOk } from './helpers'

export const COMPLIANCE: ReportDef[] = [
  {
    id: 'expiry', title: 'Document expiry report', group: 'Compliance & documents', desc: 'Expired and expiring passports, permits (PLKS), visas, FOMEMA, insurance, levy and other documents — 30 / 60 / 90 days', who: anyone,
    filters: ['company', 'outlet', 'nat', 'status', 'within', 'docType'], status: 'current', routine: 'monthly',
    build: (c) => {
      const within = c.f.within ?? '90'
      const all = c.workers.flatMap((w) => currentDocs(w).filter((d) => d.expiryDate && (!c.f.docType || d.type === c.f.docType)).map((d) => { const n = dleft(d.expiryDate); return { ...W(c, w), doc: docName(d.type, d.label), num: d.type === 'Passport' ? maskId(d.number, c.mask) : d.number, exp: d.expiryDate, d: n, stage: d.stage, _n: n } }))
      const bucket = (n: number) => (n < 0 ? '1|Expired' : n <= 30 ? '2|Due within 30 days' : n <= 60 ? '3|31 – 60 days' : n <= 90 ? '4|61 – 90 days' : '5|More than 90 days')
      const rows = all.filter((r) => withinOk(within, r._n)).sort((a, b) => a._n - b._n).map((r): Row => ({ ...r, _group: bucket(r._n), _tone: daysTone(r._n) }))
      const cnt = (f: (n: number) => boolean) => all.filter((r) => f(r._n)).length
      return doc([
        { kind: 'kpis', items: [kpi('Expired', cnt((n) => n < 0), 'red'), kpi('Within 30 days', cnt((n) => n >= 0 && n <= 30), 'amber'), kpi('31 – 60 days', cnt((n) => n > 30 && n <= 60)), kpi('61 – 90 days', cnt((n) => n > 60 && n <= 90)), kpi('Workers covered', c.workers.length)] },
        table([...WC, { key: 'doc', label: 'Document', w: 13 }, { key: 'num', label: 'Number', w: 10 }, { key: 'exp', label: 'Expiry', fmt: 'date', w: 9 }, { key: 'd', label: 'Days left', fmt: 'int', w: 6 }, { key: 'stage', label: 'Renewal stage', w: 12 }], rows,
          { groupBy: '_group', groupLabel: (g, n) => `${g.split('|')[1]} — ${n}`, empty: 'Nothing expires in this window' }),
      ], rows.length)
    },
  },
  {
    id: 'permits', title: 'Permit (PLKS) renewal & levy schedule', group: 'Compliance & documents', desc: 'Renewal calendar by month: PLKS, levy, FOMEMA, passport validity and 10-year stay cap', landscape: true, who: hr,
    filters: ['company', 'outlet', 'nat', 'within'], status: 'current', routine: 'monthly',
    build: (c) => {
      const t = c.cfg.trackers
      const within = c.f.within ?? '180'
      const rows = c.workers.map((w) => {
        const vp = latestDoc(w, PERMIT); const lv = latestDoc(w, 'Levy Payment'); const pp = passportOf(w); const fm = fomemaDue(w, t)
        const n = vp?.expiryDate ? dleft(vp.expiryDate) : null; const sy = stayYears(w)
        const ppAfter = vp?.expiryDate && pp.expiry ? monthsBetween(vp.expiryDate, pp.expiry) : null
        const issues = [
          !vp?.expiryDate && 'No permit expiry',
          ppAfter !== null && ppAfter < t.passportMinMonths && `Passport < ${t.passportMinMonths} mo after permit`,
          fm && vp?.expiryDate && fm < vp.expiryDate && 'FOMEMA due before renewal',
          lv?.expiryDate && vp?.expiryDate && lv.expiryDate < vp.expiryDate && 'Levy ends before permit',
          sy !== null && sy >= t.stayWarnYears && `${Math.round(sy * 10) / 10} yrs stay (cap ${t.stayCapYears})`,
        ].filter(Boolean).join('; ')
        const grp = !vp?.expiryDate ? '9999|No permit expiry recorded' : n! < 0 ? '0000|Already expired' : vp.expiryDate.slice(0, 7) + '|Due ' + monthLabel(vp.expiryDate.slice(0, 7))
        return { ...W(c, w), nat: w.nationality, vpno: vp?.number, vpx: vp?.expiryDate, d: n ?? undefined, stage: vp?.stage, lvx: lv?.expiryDate, fm, ppx: pp.expiry, sy: sy === null ? undefined : Math.round(sy * 10) / 10, iss: issues, _n: n ?? -99999, _group: grp, _tone: n === null ? 'amber' as const : daysTone(n, t.plksLeadDays) }
      }).filter((r) => withinOk(within, r._n)).sort((a, b) => String(a._group).localeCompare(String(b._group)) || a._n - b._n)
      const exp = rows.filter((r) => r._n < 0 && r._n !== -99999).length
      return doc([
        { kind: 'kpis', items: [kpi('Permits expired', exp, exp ? 'red' : undefined), kpi(`Renew within ${t.plksLeadDays} days`, rows.filter((r) => r._n >= 0 && r._n <= t.plksLeadDays).length, 'amber'), kpi('No permit expiry', rows.filter((r) => r._n === -99999).length), kpi('Issues flagged', rows.filter((r) => r.iss).length)] },
        table([{ key: 'no', label: 'ID', w: 6 }, { key: 'name', label: 'Worker', w: 14 }, { key: 'outlet', label: 'Outlet', w: 12 }, { key: 'nat', label: 'Nationality', w: 7 }, { key: 'vpno', label: 'Permit no.', w: 8 }, { key: 'vpx', label: 'Permit exp.', fmt: 'date', w: 7 }, { key: 'd', label: 'Days', fmt: 'int', w: 4 }, { key: 'stage', label: 'Stage', w: 9 }, { key: 'lvx', label: 'Levy paid to', fmt: 'date', w: 7 }, { key: 'fm', label: 'FOMEMA due', fmt: 'date', w: 7 }, { key: 'ppx', label: 'Passport exp.', fmt: 'date', w: 7 }, { key: 'sy', label: 'Yrs in MY', fmt: 'num', w: 4.5 }, { key: 'iss', label: 'Check', w: 15, wrap: true }],
          rows, { groupBy: '_group', groupLabel: (g, n) => `${g.split('|')[1]} — ${n}`, empty: 'No permit renewals in this window' }),
        { kind: 'note', text: `Start renewals at least ${t.plksLeadDays} days before expiry. Passport validity, FOMEMA and levy rules follow Settings → Trackers — confirm current requirements with Immigration (FWCMS) or your agent.` },
      ], rows.length)
    },
  },
  {
    id: 'fomema', title: 'FOMEMA & insurance status', group: 'Compliance & documents', desc: 'Medical examination due dates and SPIKPA / hospitalisation insurance cover per worker', who: hr,
    filters: ['company', 'outlet', 'nat', 'within'], status: 'current', routine: 'monthly',
    build: (c) => {
      const within = c.f.within || ''
      const rows = c.workers.map((w) => {
        const fd = currentDocs(w).find((d) => d.type === FOMEMA); const due = fomemaDue(w, c.cfg.trackers); const n1 = due ? dleft(due) : null
        const ins = latestDoc(w, INSURANCE); const n2 = ins?.expiryDate ? dleft(ins.expiryDate) : null
        const worst = Math.min(n1 ?? -9999, ins ? n2 ?? 99999 : -9999)
        return { ...W(c, w), fx: fd?.issueDate, due, d1: n1 ?? undefined, fst: !due ? 'NOT RECORDED' : n1! < 0 ? 'Overdue' : n1! <= 60 ? 'Due soon' : 'OK', ino: ins?.number, ix: ins?.expiryDate, d2: n2 ?? undefined, ist: !ins ? 'NO COVER' : n2 !== null && n2 < 0 ? 'Expired' : n2 !== null && n2 <= 60 ? 'Due soon' : 'OK', _w: worst, _tone: worst < 0 ? 'red' as const : worst <= 60 ? 'amber' as const : undefined }
      }).filter((r) => withinOk(within, r._w)).sort((a, b) => a._w - b._w)
      return doc([
        { kind: 'kpis', items: [kpi('FOMEMA overdue / missing', rows.filter((r) => r.fst === 'Overdue' || r.fst === 'NOT RECORDED').length, 'red'), kpi('FOMEMA due ≤ 60 days', rows.filter((r) => r.fst === 'Due soon').length, 'amber'), kpi('Insurance expired / none', rows.filter((r) => r.ist === 'Expired' || r.ist === 'NO COVER').length, 'red'), kpi('Insurance due ≤ 60 days', rows.filter((r) => r.ist === 'Due soon').length, 'amber')] },
        table([...WC, { key: 'fx', label: 'Last FOMEMA', fmt: 'date', w: 8 }, { key: 'due', label: 'Next due', fmt: 'date', w: 8 }, { key: 'd1', label: 'Days', fmt: 'int', w: 5 }, { key: 'fst', label: 'FOMEMA', w: 9 }, { key: 'ino', label: 'Policy no.', w: 9 }, { key: 'ix', label: 'Cover to', fmt: 'date', w: 8 }, { key: 'd2', label: 'Days', fmt: 'int', w: 5 }, { key: 'ist', label: 'Insurance', w: 8 }], rows),
      ], rows.length)
    },
  },
  {
    id: 'missing', title: 'Missing records checklist', group: 'Compliance & documents', desc: 'Workers missing required documents, consent forms, language, next of kin or other key records', who: hr,
    filters: ['company', 'outlet', 'nat'], status: 'current', routine: 'monthly',
    build: (c) => {
      const rows = c.workers.map((w): Row => {
        const docs = currentDocs(w)
        const miss = [
          ...REQUIRED_DOCS.filter((t) => !docs.some((d) => d.type === t && (d.number || d.expiryDate))).map((t) => docName(t)),
          consentOf(w) !== 'signed' && custodyOf(w) === 'in_safe' && 'Passport held without signed consent',
          w.zeroCost?.status !== 'signed' && 'Zero-cost declaration',
          w.pdpa?.status !== 'given' && 'PDPA consent',
          missingLanguage(w) && 'Primary language',
          !(w.family || []).some((f) => f.isNextOfKin || f.isEmergency) && 'Next of kin',
          !w.contractStart && 'Contract dates',
          !w.phoneMY && 'Phone',
        ].filter(Boolean) as string[]
        return { ...W(c, w), n: miss.length, miss: miss.join(', '), _tone: miss.some((m) => /Passport held|permit|Insurance|FOMEMA/.test(m)) ? 'red' : undefined }
      }).filter((r) => r.n).sort((a, b) => Number(b.n) - Number(a.n) || byName(a, b))
      return doc([
        { kind: 'kpis', items: [kpi('Workers checked', c.workers.length), kpi('With gaps', rows.length, rows.length ? 'amber' : 'green'), kpi('Complete', c.workers.length - rows.length, 'green')] },
        table([...WC, { key: 'n', label: 'Gaps', fmt: 'int', w: 5 }, { key: 'miss', label: 'Missing', w: 50, wrap: true }], rows, { empty: 'All records complete' }),
      ], rows.length)
    },
  },
  {
    id: 'passport', title: 'Passport custody & consent register', group: 'Compliance & documents', desc: 'Passports Act 1966 s.12(1)(f): safekeeping consent and where every passport is', who: hr,
    filters: ['company', 'outlet', 'nat', 'status'], status: 'current', routine: 'monthly',
    build: (c) => {
      const order = ['pending', 'uploaded', 'not_issued', 'withdrawn', 'signed']
      const rows = c.workers.map((w) => { const p = passportOf(w); const cs = consentOf(w); const cu = custodyOf(w); const lr = cu === 'released' ? lastRelease(w) : undefined; const od = overdueDays(w)
        return { ...W(c, w), pp: maskId(p.no, c.mask), ppx: p.expiry, consent: CONSENT_LABEL[cs], signed: w.passportSafe?.signedAt, custody: CUSTODY_LABEL[cu], rel: lr?.date, exp: lr?.expectedReturn, od: od || undefined, _c: order.indexOf(cs), _tone: (cu === 'in_safe' && cs !== 'signed') || od ? 'red' as const : cs === 'pending' ? 'amber' as const : undefined } }).sort((a, b) => a._c - b._c || byName(a, b))
      const n = (f: (w: Worker) => boolean) => c.workers.filter(f).length
      return doc([
        { kind: 'kpis', items: [kpi('In company safe', n((w) => custodyOf(w) === 'in_safe')), kpi('Held without signed consent', n((w) => custodyOf(w) === 'in_safe' && consentOf(w) !== 'signed'), 'red'), kpi('With worker', n((w) => custodyOf(w) === 'with_worker')), kpi('Released, overdue back', n((w) => overdueDays(w) > 0), 'amber'), kpi('Consent signed', n((w) => consentOf(w) === 'signed'), 'green')] },
        table([...WC, { key: 'pp', label: 'Passport', w: 9 }, { key: 'ppx', label: 'Expiry', fmt: 'date', w: 8 }, { key: 'consent', label: 'Consent', w: 10 }, { key: 'signed', label: 'Signed', fmt: 'date', w: 8 }, { key: 'custody', label: 'Passport is', w: 10 }, { key: 'rel', label: 'Released', fmt: 'date', w: 8 }, { key: 'exp', label: 'Due back', fmt: 'date', w: 8 }, { key: 'od', label: 'Days late', fmt: 'int', w: 5 }], rows),
        { kind: 'note', text: 'Employers may keep a worker’s passport only for safekeeping with the worker’s written, voluntary consent, and must return it on request.' },
      ], rows.length)
    },
  },
  {
    id: 'passmoves', title: 'Passport movement log', group: 'Compliance & documents', desc: 'Every deposit, release and return of a passport in the period, with reason and handler', who: hr,
    filters: ['company', 'outlet', 'range'], status: 'all', routine: 'monthly',
    build: (c) => {
      const rows = c.workers.flatMap((w) => (w.passportSafe?.moves || []).filter((m) => c.inRange(m.date)).map((m) => ({ ...W(c, w), date: m.date, kind: m.kind === 'release' ? 'Released to worker' : m.kind === 'deposit' ? 'Deposited in safe' : 'Returned to safe', reason: m.reason, exp: m.expectedReturn, by: m.by }))).sort((a, b) => String(a.date).localeCompare(String(b.date)))
      return doc([table([{ key: 'date', label: 'Date', fmt: 'date', w: 8 }, ...WC, { key: 'kind', label: 'Movement', w: 12 }, { key: 'reason', label: 'Reason', w: 18, wrap: true }, { key: 'exp', label: 'Due back', fmt: 'date', w: 8 }, { key: 'by', label: 'Handled by', w: 11 }], rows, { empty: 'No passport movements in this period' })], rows.length)
    },
  },
  {
    id: 'hostels', title: 'Accommodation register (Act 446)', group: 'Compliance & documents', desc: 'Hostels: certificate, capacity and occupancy, inspections and issues, with occupants', who: hr,
    filters: ['company'], status: 'current', routine: 'quarterly',
    build: (c) => {
      const hs = (c.cfg.hostels.items || []).filter((h) => !h.archived && (!c.f.company || h.companyId === c.f.company))
      const occ = (id: string) => c.workers.filter((w) => w.hostelId === id && !isExited(w))
      const rows = hs.map((h): Row => { const o = occ(h.id).length; const last = [...(h.inspections || [])].sort((a, b) => b.date.localeCompare(a.date))[0]; const iss = hostelIssues(h, o, c.cfg.trackers)
        return { name: h.name, addr: [h.address, h.state].filter(Boolean).join(', '), cert: h.certNo, cx: h.certExpiry, cap: h.capacity, occ: o, pc: h.capacity ? pct(o, h.capacity) : undefined, last: last ? `${fmtDate(last.date)} ${last.result}` : '', iss: iss.map((i) => i.text).join('; '), _tone: iss.some((i) => i.level === 'red') ? 'red' : iss.length ? 'amber' : undefined } })
      const unassigned = c.workers.filter((w) => !w.hostelId && !isExited(w))
      const occRows = hs.flatMap((h) => occ(h.id).map((w) => ({ ...W(c, w), _group: h.name, job: w.jobCategory, nat: w.nationality })))
      return doc([
        { kind: 'kpis', items: [kpi('Hostels', hs.length), kpi('Beds', sum(rows, 'cap')), kpi('Occupants', sum(rows, 'occ')), kpi('With issues', rows.filter((r) => r.iss).length, rows.some((r) => r._tone === 'red') ? 'red' : undefined), kpi('Workers with no hostel set', unassigned.length, unassigned.length ? 'amber' : undefined)] },
        table([{ key: 'name', label: 'Hostel', w: 14 }, { key: 'addr', label: 'Address', w: 18, wrap: true }, { key: 'cert', label: 'Certificate', w: 9 }, { key: 'cx', label: 'Cert. expiry', fmt: 'date', w: 8 }, { key: 'cap', label: 'Beds', fmt: 'int', w: 5 }, { key: 'occ', label: 'In use', fmt: 'int', w: 5 }, { key: 'pc', label: 'Use', fmt: 'pct', w: 5 }, { key: 'last', label: 'Last inspection', w: 11 }, { key: 'iss', label: 'Issues', w: 20, wrap: true }], rows, { empty: 'No hostels in the register (Trackers → Hostels)' }),
        table([...WC, { key: 'nat', label: 'Nationality', w: 10 }, { key: 'job', label: 'Job', w: 12 }], occRows, { title: 'Occupants', groupBy: '_group', groupLabel: (g, n) => `${g} — ${n}`, empty: 'No workers linked to a hostel' }),
      ], rows.length)
    },
  },
  {
    id: 'risk', title: 'Compliance & risk summary', group: 'Compliance & documents', desc: 'Compliance health score, outlet risk ranking and open alerts by category — the management summary', who: hr,
    filters: ['company', 'outlet'], status: 'current', routine: 'monthly',
    build: (c) => {
      const alerts = buildAlerts(c.workers, c.s)
      const outs = c.outlets.filter((o) => c.workers.some((w) => w.outletId === o.id))
      const sc = healthScore(c.workers, alerts, outs, { pay: c.p.canSeeSalary })
      const risks = outletRisks(c.workers, outs, alerts, null, c.p.canSeeSalary)
      const cats = [...new Set(alerts.map((a) => a.category))].map((k) => { const l = alerts.filter((a) => a.category === k); return { cat: k, cr: l.filter((a) => a.severity === 'critical').length, hi: l.filter((a) => a.severity === 'high').length, me: l.filter((a) => a.severity === 'medium').length, lo: l.filter((a) => a.severity === 'low' || a.severity === 'info').length, tot: l.length } }).sort((a, b) => b.cr - a.cr || b.hi - a.hi || b.tot - a.tot)
      const top = alerts.filter((a) => a.severity === 'critical' || a.severity === 'high').slice(0, 40).map((a): Row => ({ no: a.workerNo, name: a.workerName, outlet: outletName(c.outlets, a.outletId), sev: a.severity, t: a.title, _tone: a.severity === 'critical' ? 'red' : 'amber' }))
      const crit = alerts.filter((a) => a.severity === 'critical').length, high = risks.filter((r) => r.level === 'High').length
      return doc([
        { kind: 'kpis', items: [kpi('Compliance score', sc.score === null ? '—' : sc.score + ' / 100', sc.tone === 'gray' ? undefined : sc.tone, sc.label), kpi('Current workers', sc.total), kpi('Critical alerts', crit, crit ? 'red' : undefined), kpi('High alerts', alerts.filter((a) => a.severity === 'high').length, 'amber'), kpi('High-risk outlets', high, high ? 'red' : undefined)] },
        table([{ key: 'label', label: 'Check', w: 30 }, { key: 'affected', label: 'Workers affected', fmt: 'int', w: 10 }, { key: 'lost', label: 'Points lost', fmt: 'int', w: 8 }, { key: 'tip', label: 'What to do', w: 40, wrap: true }], sc.lines.map((l): Row => ({ label: l.label, affected: l.affected, lost: l.lost, tip: l.tip, _tone: l.lost ? 'amber' : undefined })), { title: 'Compliance score breakdown' }),
        table([{ key: 'name', label: 'Outlet', w: 24 }, { key: 'workers', label: 'Workers', fmt: 'int', w: 8 }, { key: 'score', label: 'Risk score', fmt: 'int', w: 8 }, { key: 'level', label: 'Level', w: 8 }, { key: 'parts', label: 'Main drivers', w: 40, wrap: true }], risks.map((r): Row => ({ name: r.name, workers: r.workers, score: r.score, level: r.level, parts: r.parts.filter((p) => p.count).map((p) => `${p.label}: ${p.count}`).join('; '), _tone: r.level === 'High' ? 'red' : r.level === 'Medium' ? 'amber' : undefined })), { title: 'Outlet risk ranking' }),
        table([{ key: 'cat', label: 'Alert category', w: 30 }, { key: 'cr', label: 'Critical', fmt: 'int', w: 8 }, { key: 'hi', label: 'High', fmt: 'int', w: 8 }, { key: 'me', label: 'Medium', fmt: 'int', w: 8 }, { key: 'lo', label: 'Low / info', fmt: 'int', w: 8 }, { key: 'tot', label: 'Total', fmt: 'int', w: 8 }], cats, { title: 'Open alerts by category', totals: { cat: 'TOTAL', cr: sum(cats, 'cr'), hi: sum(cats, 'hi'), me: sum(cats, 'me'), lo: sum(cats, 'lo'), tot: sum(cats, 'tot') } }),
        table([{ key: 'no', label: 'ID', w: 7 }, { key: 'name', label: 'Worker', w: 16 }, { key: 'outlet', label: 'Outlet', w: 14 }, { key: 'sev', label: 'Severity', w: 8 }, { key: 't', label: 'Issue', w: 40, wrap: true }], top, { title: 'Critical and high items (first 40)', empty: 'None' }),
      ], alerts.length)
    },
  },
]
