import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Btn, Card } from '../components/ui'
import { useAuth } from '../lib/auth'
import { outletCompany } from '../lib/companies'
import { updateWorker } from '../lib/db'
import { companyLogo, headerLogo, useLogoUrl } from '../lib/logos'
import { consentOf, consentPdf } from '../lib/passport'
import { ROLE_LABEL } from '../lib/workflow'
import { download, fmtDate, toCSV, todayISO } from '../lib/util'
import { BUSINESS_TYPES, DOC_TYPES, GENDERS, NATIONALITIES, STATUSES } from '../lib/types'
import { GROUPS, reportById, reportsFor } from './catalog'
import { RANGES, buildCtx, filterText, useExtra, useReportData } from './data'
import { hr, isLimited } from './defs/helpers'
import { mytStamp, show, type Lang } from './format'
import { Preview } from './Preview'
import type { SheetMeta } from './Sheets'
import { DueBanner, SubmissionsPanel, tasksOf, type Task } from './Submissions'
import { FREQ_LABEL, doStep, periodLabel, periodRange, useSubs } from './submissions'
import type { Block, Filters, ReportDef } from './types'
import './reports.css'

export default function ReportsPage() {
  const auth = useAuth()
  const { profile, role, myCompanies, myOutlets, canWrite } = auth
  const d = useReportData()
  const defs = useMemo(() => reportsFor(auth), [auth])
  const [sp, setSp] = useSearchParams()
  const tab = sp.get('tab') === 'subs' && hr(auth) ? 'subs' : 'lib'
  const def = reportById(sp.get('r') || '') && defs.find((x) => x.id === sp.get('r')) ? reportById(sp.get('r')!)! : undefined
  const subs = useSubs()
  const tasks = useMemo(() => tasksOf(subs.schedules, subs.submissions), [subs.schedules, subs.submissions])

  const [f, setF] = useState<Filters>({})
  const [range, setRange] = useState('all')
  const [sign, setSign] = useState(false)
  const [lang, setLang] = useState<Lang>('en')
  const [mask, setMask] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [task, setTask] = useState<Task | null>(null)
  const [q, setQ] = useState('')

  const pick = (r: ReportDef) => { setSp({ r: r.id }, { replace: true }); setTask(null); setF({}); setRange(r.id === 'audit' ? 'tm' : 'all'); setSign(!!r.routine && hr(auth) && !isLimited(auth)); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const setRangeKey = (k: string) => { setRange(k); const r = RANGES.find((x) => x.key === k)?.get(); if (k !== 'custom') setF((x) => ({ ...x, from: r?.[0], to: r?.[1] })) }

  const extra = useExtra(def, f, { schedules: subs.schedules, submissions: subs.submissions }, subs.error)
  const built = useMemo(() => {
    if (!def || def.soon) return null
    try { return def.build(buildCtx(d, def, f, auth, mask, extra)) } catch (e) { return { blocks: [{ kind: 'note', tone: 'red', text: 'Could not build this report: ' + (e as Error).message } as Block], rows: 0 } }
  }, [def, d, f, auth, mask, extra])
  const blocks = useMemo(() => (built ? [...built.blocks, ...(sign || task ? [{ kind: 'signatures' } as Block] : [])] : []), [built, sign, task])

  // header logo: the chosen company, else the user's own single company
  const logoPath = f.company ? companyLogo(f.company) : headerLogo(role, myCompanies, myOutlets, d.outlets)
  const logo = useLogoUrl(logoPath)
  const company = (f.company && d.companies.find((c) => c.id === f.company)?.name) || (d.companies.length === 1 ? d.companies[0].name : '') || d.s.companyName || 'FW Manager'
  const now = new Date()
  const stamp = mytStamp(now)
  const meta: SheetMeta | null = def ? {
    company, logo, title: task?.s.title || def.title, landscape: def.landscape, lang,
    ref: `RPT-${def.id.toUpperCase()}-${now.toLocaleString('sv-SE', { timeZone: 'Asia/Kuala_Lumpur' }).slice(0, 16).replace(/[-: ]/g, '')}`,
    filters: filterText(d, def, f, RANGES.find((x) => x.key === range)?.label), generated: stamp,
    by: `${profile?.full_name || profile?.email || 'User'} (${ROLE_LABEL[role || ''] || role})`,
    band: task ? `REQUIRED SUBMISSION · ${FREQ_LABEL[task.s.frequency]} · Period ${periodLabel(task.period)} · Due ${fmtDate(task.state.due)}` : undefined,
    signs: task ? Object.fromEntries((['prepared', 'verified', 'reviewed', 'approved'] as const).flatMap((k) => { const x = task.sub?.steps[k]; return x ? [[k, { name: x.by_name || '', date: fmtDate(new Date(x.at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' })) }]] : [] })) : undefined,
  } : null

  // open a required submission: the schedule's report, for its period
  const openTask = (t: Task) => {
    const r = defs.find((x) => x.id === t.s.report_id)
    if (!r) return alert('This report is not available for your role.')
    const pr = periodRange(t.period)
    setSp({ r: r.id }, { replace: true })
    setTask(t); setSign(true); setLang((t.s.filters?.lang as Lang) || 'en'); setRange('custom')
    setF({ ...(t.s.filters || {}), company: t.s.company_id || undefined, from: pr.from, to: pr.to, month: pr.from.slice(0, 7) })
    setOpenId(r.id)
    if (!t.sub?.steps.generated) void doStep(t.s.id, t.period, 'generated').catch(() => undefined)
  }
  useEffect(() => { if (task) { const t = tasks.find((x) => x.s.id === task.s.id && x.period === task.period); if (t && t.sub !== task.sub) setTask(t) } }, [tasks, task])

  const csv = () => {
    if (!def || !built) return
    const tables = built.blocks.filter((b): b is Extract<Block, { kind: 'table' }> => b.kind === 'table')
    const rows = tables.flatMap((t) => t.rows.map((r) => Object.fromEntries([...(tables.length > 1 ? [['Section', t.title || '']] : []), ...t.cols.map((c) => [c.label, show(r[c.key], c.fmt === 'rm' ? 'num' : c.fmt).replace('—', '')])])))
    const cols = [...new Set([...(tables.length > 1 ? ['Section'] : []), ...tables.flatMap((t) => t.cols.map((c) => c.label))])]
    download(`${def.id}-${todayISO()}.csv`, toCSV(rows, cols), 'text/csv')
  }
  const bulkConsent = async () => {
    const target = d.all.filter((w) => !['Absconded', 'Resigned', 'Terminated', 'Contract Ended', 'Repatriated'].includes(w.status) && consentOf(w) !== 'signed' && (!f.outlet || w.outletId === f.outlet) && (!f.company || outletCompany(d.outlets.find((o) => o.id === w.outletId)) === f.company))
    if (!target.length) return alert('Everyone in this list has signed consent.')
    if (!confirm(`Create bilingual consent forms for ${target.length} workers (not yet signed)? Workers not yet issued a form are marked “Pending”.`)) return
    try {
      download(`passport-consent-forms-${todayISO()}.pdf`, await consentPdf(target, d.outlets, d.s.companyName), 'application/pdf')
      const by = profile?.full_name || profile?.email || 'HR'
      for (const w of target) if (consentOf(w) === 'not_issued' || consentOf(w) === 'withdrawn') await updateWorker(w.id, (x) => { x.passportSafe = { ...(x.passportSafe || { consent: 'not_issued' }), consent: 'pending', issuedAt: todayISO(), issuedBy: by } })
    } catch (e) { alert((e as Error).message) }
  }

  const outletOpts = d.outlets.filter((o) => !f.company || outletCompany(o) === f.company)
  const workerOpts = d.all.filter((w) => (!f.outlet || w.outletId === f.outlet)).sort((a, b) => a.fullName.localeCompare(b.fullName))
  const sel = (label: string, v: string | undefined, set: (v: string) => void, opts: (string | { value: string; label: string })[], any = 'All') => (
    <label><span>{label}</span><select aria-label={label} value={v || ''} onChange={(e) => set(e.target.value)}>
      <option value="">{any}</option>{opts.map((o) => typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}
    </select></label>
  )
  const up = (k: keyof Filters) => (v: string) => setF((x) => ({ ...x, [k]: v || undefined, ...(k === 'company' ? { outlet: undefined } : {}) }))
  const shown = defs.filter((r) => !q || (r.title + ' ' + r.desc + ' ' + r.group).toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="page">
      <div className="page-h no-print">
        <div><h1>Reports</h1><p className="muted">{isLimited(auth) ? 'Printable A4 reports for your outlet' : `${defs.filter((x) => !x.soon).length} printable A4 reports for your role`}</p></div>
      </div>
      {hr(auth) && <DueBanner tasks={tasks} onShow={() => setSp({ tab: 'subs' }, { replace: true })} />}
      {hr(auth) && (
        <div className="rep-tabs no-print">
          <button className={tab === 'lib' ? 'on' : ''} onClick={() => setSp(def ? { r: def.id } : {}, { replace: true })}>Report library</button>
          <button className={tab === 'subs' ? 'on' : ''} onClick={() => setSp({ tab: 'subs' }, { replace: true })}>Required submissions{tasks.filter((t) => t.state.state === 'overdue' || t.state.state === 'due').length ? ` (${tasks.filter((t) => t.state.state === 'overdue' || t.state.state === 'due').length})` : ''}</button>
        </div>
      )}

      {tab === 'subs' ? <SubmissionsPanel defs={defs} schedules={subs.schedules} submissions={subs.submissions} error={subs.error} onOpen={openTask} /> : <>
        {def && meta && (
          <Card title={<>{def.title} <small className="muted">· {def.landscape ? 'A4 landscape' : 'A4 portrait'}{built ? ` · ${built.rows ?? 0} records` : ''}</small></>} actions={<Btn small kind="ghost" onClick={() => { setSp({}, { replace: true }); setTask(null) }}>Close</Btn>}>
            <p className="muted small">{def.desc}</p>
            {task && <p className="small"><b>Required submission:</b> {task.s.title} · {periodLabel(task.period)} · due {fmtDate(task.state.due)}</p>}
            <div className="rpt-filters" style={{ marginTop: 8 }}>
              {def.filters.includes('company') && d.companies.length > 1 && sel('Company', f.company, up('company'), d.companies.map((c) => ({ value: c.id, label: c.name })), 'All companies')}
              {def.filters.includes('outlet') && sel('Outlet', f.outlet, up('outlet'), outletOpts.map((o) => ({ value: o.id, label: o.name })), 'All outlets')}
              {def.filters.includes('btype') && sel('Business', f.btype, up('btype'), [...BUSINESS_TYPES])}
              {def.filters.includes('nat') && sel('Nationality', f.nat, up('nat'), NATIONALITIES)}
              {def.filters.includes('gender') && sel('Gender', f.gender, up('gender'), GENDERS)}
              {def.filters.includes('status') && sel('Workers', f.status, up('status'), [{ value: 'current', label: 'Current' }, { value: 'exited', label: 'Exited' }, { value: 'all', label: 'All workers' }, ...STATUSES.map((s) => ({ value: s, label: 'Status: ' + s }))], `Default (${def.status || 'all'})`)}
              {def.filters.includes('within') && sel('Expiring', f.within, up('within'), [{ value: 'expired', label: 'Expired' }, ...['30', '60', '90', '180', '365'].map((n) => ({ value: n, label: `Within ${n} days` }))], 'Any date')}
              {def.filters.includes('docType') && sel('Document', f.docType, up('docType'), [...DOC_TYPES], 'All documents')}
              {def.filters.includes('worker') && sel('Worker', f.worker, up('worker'), workerOpts.map((w) => ({ value: w.id, label: `${w.fullName} (${w.workerNo})` })), 'All in filter')}
              {def.filters.includes('month') && <label><span>Month</span><input type="month" value={f.month || todayISO().slice(0, 7)} onChange={(e) => up('month')(e.target.value)} /></label>}
              {def.filters.includes('range') && sel('Period', range, setRangeKey, RANGES.filter((r) => r.key !== 'all').map((r) => ({ value: r.key, label: r.label })), 'All dates')}
              {def.filters.includes('range') && range === 'custom' && <><label><span>From</span><input type="date" value={f.from || ''} onChange={(e) => up('from')(e.target.value)} /></label><label><span>To</span><input type="date" value={f.to || ''} onChange={(e) => up('to')(e.target.value)} /></label></>}
              {!isLimited(auth) && <label><span>Signature labels</span><select aria-label="Signature labels" value={lang} onChange={(e) => setLang(e.target.value as Lang)}><option value="en">English</option><option value="ms">English + BM</option><option value="ta">English + Tamil</option></select></label>}
            </div>
            <div className="rpt-actions">
              {!isLimited(auth) && <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={sign || !!task} disabled={!!task} onChange={(e) => setSign(e.target.checked)} /> Add sign-off block (HR Manager → HR Admin → GM → CEO)</label>}
              {!isLimited(auth) && <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={mask} onChange={(e) => setMask(e.target.checked)} /> Mask passport / account numbers</label>}
              <span style={{ flex: 1 }} />
              {def.id === 'passport' && canWrite && <Btn small icon="doc" onClick={bulkConsent}>Bulk consent forms</Btn>}
              <Btn small icon="download" onClick={csv} disabled={!built || extra.loading}>CSV</Btn>
              <Btn small kind="primary" icon="print" onClick={() => setOpenId(def.id)} disabled={!built || extra.loading}>{extra.loading ? 'Loading…' : 'Preview & print'}</Btn>
            </div>
          </Card>
        )}
        <div className="toolbar no-print" style={{ marginTop: 8 }}><div className="search"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a report…" aria-label="Find a report" /></div></div>
        {GROUPS.map((g) => { const list = shown.filter((r) => r.group === g); return list.length ? (
          <div key={g}>
            <div className="rpt-grp">{g}</div>
            <div className="rpt-lib">{list.map((r) => (
              <button key={r.id} className={'rpt-card' + (r.id === def?.id ? ' on' : '') + (r.soon ? ' soon' : '')} disabled={r.soon} onClick={() => pick(r)}>
                <b>{r.title}</b><small>{r.desc}</small>
                <div className="rpt-tags">
                  {r.soon && <span className="rpt-tag">Coming soon</span>}
                  {r.landscape && <span className="rpt-tag">Landscape</span>}
                  {r.routine && !isLimited(auth) && <span className="rpt-tag pri">Suggested: {FREQ_LABEL[r.routine]}</span>}
                  {subs.schedules.some((s) => s.active && s.report_id === r.id) && <span className="rpt-tag amber">Required print</span>}
                </div>
              </button>
            ))}</div>
          </div>) : null })}
      </>}

      {openId === def?.id && def && meta && built && (
        <Preview blocks={blocks} meta={meta} file={`${def.id}-${todayISO()}.pdf`} onClose={() => setOpenId(null)}
          onPrinted={task && !task.sub?.steps.printed ? () => { void doStep(task.s.id, task.period, 'printed').catch(() => undefined) } : undefined} />
      )}
    </div>
  )
}
