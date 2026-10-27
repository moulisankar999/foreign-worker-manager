/* 1.6.4 CEO-only Permit Compliance: is every worker at an outlet of the company that holds his KDN approval / calling visa?
 * Data comes only from the CEO-only RPC permit_compliance() (migration 055); everyone else gets an access message. */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useHideDemo } from '../lib/demo'
import { Btn, Card, Chip, Empty, SelectFilter, Tabs, Toolbar } from '../components/ui'
import { Preview } from '../reports/Preview'
import type { Block, Tone } from '../reports/types'
import type { SheetMeta } from '../reports/Sheets'
import { mytStamp } from '../reports/format'
import { ROLE_LABEL } from '../lib/workflow'
import { todayISO } from '../lib/util'
import { RISK_LABEL, RISK_ORDER, RISK_TONE, fixList, movePlan, summary, usePermitCompliance, type PcWorker, type Risk } from '../lib/permit'

type Tab = 'summary' | 'outlet' | 'move' | 'fix'
const ptone = (r: Risk): Tone => (r === 'critical' || r === 'high' ? 'red' : r === 'medium' ? 'amber' : r === 'ok' ? 'green' : 'gray')
const kdn = (w: PcWorker) => [w.kdnRef, w.kdnSector, w.kdnJob].filter(Boolean).join(' · ') || '—'
const mismatchText = (w: PcWorker) => [w.status2 === 'mismatch' ? 'company' : '', w.sectorMismatch ? 'sector' : '', w.jobMismatch ? 'occupation' : ''].filter(Boolean).join(', ')

export default function PermitCompliancePage() {
  const { isSuper, profile, role } = useAuth()
  const { data, err, reload } = usePermitCompliance(isSuper)
  const hideDemo = useHideDemo()
  const [tab, setTab] = useState<Tab>('summary')
  const [fo, setFo] = useState('')
  const [fc, setFc] = useState('')
  const [fr, setFr] = useState('')
  const [print, setPrint] = useState(false)

  const all = useMemo(() => (data?.workers || []).filter((w) => !hideDemo || !w.demo), [data, hideDemo])
  const outlets = useMemo(() => (data?.outlets || []).filter((o) => !hideDemo || !o.demo), [data, hideDemo])
  const ws = useMemo(() => all.filter((w) => (!fo || w.outletId === fo) && (!fc || w.outletCompanyId === fc || w.permitCompanyId === fc) && (!fr || w.risk === fr)), [all, fo, fc, fr])
  const sm = useMemo(() => summary(ws), [ws])
  const plan = useMemo(() => movePlan(all, outlets).filter((m) => ws.some((w) => w.id === m.worker.id)), [all, outlets, ws])
  const fixes = useMemo(() => fixList(ws, plan), [ws, plan])
  const groups = useMemo(() => {
    const m = new Map<string, PcWorker[]>()
    for (const w of ws) { const k = w.outletId || ''; m.set(k, [...(m.get(k) || []), w]) }
    return [...m.entries()].map(([id, list]) => ({ id, o: outlets.find((x) => x.id === id), list: list.sort((a, b) => RISK_ORDER.indexOf(a.risk) - RISK_ORDER.indexOf(b.risk)) }))
      .sort((a, b) => (a.o?.name || '~').localeCompare(b.o?.name || '~'))
  }, [ws, outlets])

  if (!isSuper) return <div className="page"><Empty icon="lock" title="CEO only">The permit compliance report is only for the CEO.</Empty></div>

  const filtersText = [fo && `Outlet: ${outlets.find((o) => o.id === fo)?.name}`, fc && `Company: ${data?.companies.find((c) => c.id === fc)?.name}`, fr && `Risk: ${RISK_LABEL[fr as Risk]}`].filter(Boolean).join(' · ') || 'All active workers'
  const meta: SheetMeta = { company: 'FW Manager', title: 'Permit compliance (CEO)', ref: `PC-${todayISO().replace(/-/g, '')}`, filters: filtersText, generated: mytStamp(new Date()), by: `${profile?.full_name || profile?.email || 'CEO'} (${ROLE_LABEL[role || ''] || role})`, landscape: true, lang: 'en' }
  const blocks: Block[] = [
    { kind: 'kpis', items: [{ label: 'Workers', value: sm.total }, { label: 'Compliant', value: sm.compliant, tone: 'green' }, { label: 'Mismatched', value: sm.mismatch, tone: 'red' }, { label: 'Unknown', value: sm.unknown, tone: 'gray' }, { label: '% compliant', value: `${sm.pct}%`, tone: sm.pct >= 95 ? 'green' : sm.pct >= 80 ? 'amber' : 'red' }] },
    { kind: 'table', title: 'By outlet', groupBy: 'outlet', cols: [{ key: 'name', label: 'Worker' }, { key: 'permit', label: 'Permit company' }, { key: 'kdn', label: 'KDN · sector · job', wrap: true }, { key: 'oc', label: 'Outlet company · business', wrap: true }, { key: 'risk', label: 'Risk' }],
      rows: ws.map((w) => ({ outlet: w.outlet || 'No outlet', name: `${w.name} (${w.workerNo || '—'})`, permit: w.permitCompany || 'Unknown', kdn: kdn(w), oc: `${w.outletCompany || '—'} · ${w.outletType || w.business || '—'}`, risk: RISK_LABEL[w.risk], _tone: ptone(w.risk), _toneKey: 'risk' })), empty: 'No workers' },
    { kind: 'table', title: 'Emergency move plan', cols: [{ key: 'name', label: 'Worker' }, { key: 'from', label: 'From' }, { key: 'to', label: 'To' }, { key: 'why', label: 'Why', wrap: true }],
      rows: plan.map((m) => ({ name: m.worker.name, from: m.worker.outlet || '—', to: m.to?.name || '—', why: m.why, _tone: m.kind === 'none' ? 'red' : m.kind === 'swap' ? 'blue' : undefined, _toneKey: 'to' })), empty: 'Nobody needs to move' },
    { kind: 'table', title: 'Fix list', cols: [{ key: 'risk', label: 'Risk' }, { key: 'name', label: 'Worker' }, { key: 'action', label: 'Action', wrap: true }],
      rows: fixes.map((f) => ({ risk: RISK_LABEL[f.risk], name: `${f.worker.name} · ${f.worker.outlet || '—'}`, action: f.action, _tone: ptone(f.risk), _toneKey: 'risk' })), empty: 'Nothing to fix' },
  ]

  return (
    <div className="page pc-page" data-testid="pc-page">
      <div className="page-h">
        <div><h1>Permit compliance</h1><p className="muted">CEO only · is each worker at an outlet of his permit (KDN) company?</p></div>
        <div className="row gap-s"><Btn small icon="refresh" onClick={reload}>Refresh</Btn><Btn small icon="pdf" onClick={() => setPrint(true)} disabled={!data}>PDF / Print</Btn></div>
      </div>
      <Toolbar>
        <SelectFilter label="Outlet" value={fo} onChange={setFo} options={[{ value: '', label: 'All outlets' }, ...outlets.map((o) => ({ value: o.id, label: o.name }))]} />
        <SelectFilter label="Company" value={fc} onChange={setFc} options={[{ value: '', label: 'All companies' }, ...(data?.companies || []).map((c) => ({ value: c.id, label: c.name }))]} />
        <SelectFilter label="Risk" value={fr} onChange={setFr} options={[{ value: '', label: 'All risks' }, ...RISK_ORDER.map((r) => ({ value: r, label: RISK_LABEL[r] }))]} />
      </Toolbar>
      <Tabs compact value={tab} onChange={setTab} tabs={[{ id: 'summary', label: 'Summary' }, { id: 'outlet', label: 'By outlet' }, { id: 'move', label: 'Move plan', badge: plan.length }, { id: 'fix', label: 'Fix list', badge: fixes.length }]} />
      {err && <p className="err" data-testid="pc-err">{err}</p>}
      {!data && !err && <p className="muted">Loading…</p>}
      {data && tab === 'summary' && (
        <div className="pc-sum" data-testid="pc-summary">
          <div className="pc-kpis">
            <div className="pc-kpi"><b data-testid="pc-total">{sm.total}</b><span>Workers</span></div>
            <div className="pc-kpi ok"><b data-testid="pc-compliant">{sm.compliant}</b><span>Compliant</span></div>
            <div className="pc-kpi bad"><b data-testid="pc-mismatch">{sm.mismatch}</b><span>Mismatched</span></div>
            <div className="pc-kpi unk"><b data-testid="pc-unknown">{sm.unknown}</b><span>Unknown</span></div>
            <div className="pc-kpi"><b data-testid="pc-pct">{sm.pct}%</b><span>Compliant</span></div>
          </div>
          <div className="pc-risks">{RISK_ORDER.map((r) => <button key={r} className="chip-btn" onClick={() => { setFr(fr === r ? '' : r); setTab(r === 'ok' ? 'outlet' : 'fix') }}><Chip tone={RISK_TONE[r]}>{RISK_LABEL[r]} {sm.byRisk[r]}</Chip></button>)}</div>
          <p className="muted small">Critical = different company and the KDN sector or occupation also differs · High = different company · Medium = same company, wrong sector or occupation · Needs data = no permit company set. {plan.filter((m) => m.kind === 'none').length ? `${plan.filter((m) => m.kind === 'none').length} worker(s) have no valid outlet: employer transfer or a new quota is needed.` : ''}</p>
        </div>
      )}
      {data && tab === 'outlet' && (
        <div className="pc-groups" data-testid="pc-outlets">
          {!groups.length && <p className="muted">No workers match.</p>}
          {groups.map((g) => (
            <Card key={g.id} title={<>{g.o?.name || 'No outlet'} <small className="muted">· {g.o?.company || '—'} · {g.o?.type || '—'}</small></>}>
              <ul className="rows compact pc-rows">{g.list.map((w) => (
                <li key={w.id} data-testid="pc-row" data-risk={w.risk} data-wid={w.id}>
                  <div className="r-main"><Link to={`/workers/${w.id}`}><strong>{w.name}</strong></Link>
                    <small>Permit: <b className={'pc pc-' + (w.status2 === 'compliant' ? 'ok' : w.status2 === 'mismatch' ? 'bad' : 'unknown')}>{w.permitCompany || 'Unknown'}</b> · KDN {kdn(w)} · Job {w.job || '—'}{mismatchText(w) ? ` · differs: ${mismatchText(w)}` : ''}</small></div>
                  <Chip tone={RISK_TONE[w.risk]}>{RISK_LABEL[w.risk]}</Chip>
                </li>))}</ul>
            </Card>
          ))}
        </div>
      )}
      {data && tab === 'move' && (
        <Card><ul className="rows compact" data-testid="pc-moves">
          {!plan.length && <li className="muted">Nobody needs to move.</li>}
          {plan.map((m) => (
            <li key={m.worker.id} data-testid="pc-move" data-kind={m.kind} data-wid={m.worker.id}>
              <div className="r-main"><strong>{m.worker.name}</strong><small>{m.worker.outlet || '—'} → {m.to?.name || <b className="pc pc-bad">no valid outlet</b>} · {m.why}</small></div>
              <Chip tone={m.kind === 'swap' ? 'blue' : m.kind === 'move' ? 'teal' : 'red'}>{m.kind === 'swap' ? 'Swap' : m.kind === 'move' ? 'Move' : 'Transfer / quota'}</Chip>
            </li>))}
        </ul></Card>
      )}
      {data && tab === 'fix' && (
        <Card><ul className="rows compact" data-testid="pc-fixes">
          {!fixes.length && <li className="muted">Nothing to fix.</li>}
          {fixes.map((f) => (
            <li key={f.worker.id} data-testid="pc-fix" data-risk={f.risk}>
              <div className="r-main"><Link to={`/workers/${f.worker.id}`}><strong>{f.worker.name}</strong></Link><small>{f.worker.outlet || '—'} · {f.action}</small></div>
              <Chip tone={RISK_TONE[f.risk]}>{RISK_LABEL[f.risk]}</Chip>
            </li>))}
        </ul></Card>
      )}
      {print && <Preview blocks={blocks} meta={meta} file={`permit-compliance-${todayISO()}.pdf`} onClose={() => setPrint(false)} />}
    </div>
  )
}
