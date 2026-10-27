/* v1.4 Approval & Recruitment — CEO, GM, HR Admin, HR Manager only.
 * The quota is kept like a bank account: an approval letter opens it, every movement is an append-only ledger line,
 * every use needs an approved Quota Use Request, and exits / runaways reconcile it. */
import { FollowUps, MasterTable } from './Extras'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Card, Chip, Empty, SelectFilter, Stat, Tabs, Toolbar, Skeleton } from '../../components/ui'
import { DataTable, usePaged } from '../../components/dataTable'
import { Actions, IconAction } from '../../components/iconAction'
import { useWorkers } from '../../lib/hooks'
import { inCompany, OTHER_CO, setKnownCompanies, atMyt, nextStep, quotaAlerts, quotaRag, rmFmt, stageLabelIn, stepCtx, tplOf, UR_STATUS, useQuota, type Tally } from '../../lib/quota'
import { daysUntil, fmtDate } from '../../lib/util'
import { RagDot, useQCtx } from './shared'
import { isSampleCompany } from '../../lib/companies'
import { useAuth } from '../../lib/auth'
import { LettersTab } from './Letters'
import { ApprovalsTab, canDecide } from './Approvals'
import { PipelineTab } from './Pipeline'
import { CostsTab } from './Costs'
import { ExitsTab } from './Exits'
import { ReconTab } from './Recon'
import { ClaimsTab } from './Claims'
import { ArrivalsTab } from './Arrivals'
import { RulesTab } from './Rules'
import RecruitPage from './Recruit'
import './quota.css'
import { CountUp, Donut, Spark } from '../../components/viz'

type TabId = 'overview' | 'letters' | 'approvals' | 'pipeline' | 'arrivals' | 'costs' | 'exits' | 'recon' | 'claims' | 'rules'

export default function QuotaPage() {
  const ctx = useQCtx()
  const { top } = useAuth()
  const d = useQuota()
  const { id } = useParams()
  const [sp, setSp] = useSearchParams()
  const [company, setCompany] = useState('')
  if (!ctx.rank) return <div className="page"><Empty title="Not available">Approval & Recruitment is not part of your role.</Empty></div>
  if (id) return <RecruitPage id={id} />
  const waiting = d.requests.filter((r) => canDecide(r, ctx.rank, ctx.profile?.id)).length
  const tabs: { id: TabId; label: string; badge?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'letters', label: 'Letters & ledger', badge: ctx.canOpenLetter ? d.quotas.filter((q) => q.status === 'pending').length : undefined },
    { id: 'approvals', label: 'Quota use approvals', badge: waiting || undefined },
    { id: 'pipeline', label: 'Pipeline' },
    { id: 'arrivals', label: 'Arrivals & hostel' },
    { id: 'costs', label: 'Payments & budget', badge: d.payments.filter((p) => p.status === 'pending_check').length || undefined },
    { id: 'exits', label: 'COM & runaways', badge: d.runaways.filter((r) => r.outcome === 'open' && !r.imm_ref).length || undefined },
    { id: 'recon', label: 'Reconciliation', badge: d.tally.filter((t) => t.mismatch !== 0).length || undefined },
    { id: 'claims', label: 'Replacement claims' },
    { id: 'rules', label: 'Rules & regulations' },
  ]
  const want = sp.get('tab') as TabId
  const tab = tabs.some((t) => t.id === want) ? want : 'overview'
  setKnownCompanies(ctx.cfg.companies.items.map((c) => c.id))
  const orphans = new Set(d.quotas.map((q) => q.company_id).filter((c) => inCompany(OTHER_CO, c))).size
  const companyPick = (ctx.companies.length > 1 || orphans > 0) && (
    <SelectFilter label="Company" value={company} onChange={setCompany} options={[{ value: '', label: 'All companies' }, ...ctx.companies.map((c) => ({ value: c.id, label: c.name })),
      ...(orphans ? [{ value: OTHER_CO, label: `Not in Settings (${orphans})` }] : [])]} />
  )
  return (
    <div className="page qr">
      <div className="page-h"><div><h1>Approval & Recruitment</h1>
        <p className="muted">Approval letters, the quota balance, approved quota use, recruits until they arrive, payments, Check Out Memos (COM), runaways and replacement claims.</p></div>
        <Toolbar>{companyPick}<IconAction kind="refresh" label="Reload from the server" onClick={() => d.reload()} /></Toolbar>
      </div>
      {d.error && <div className="note-box bad">Could not load: {d.error}</div>}
      {ctx.companies.some((c) => isSampleCompany(c.id)) && <div className="note-box" data-testid="sample-banner"><Chip tone="amber">SAMPLE</Chip> Companies named “SAMPLE …” hold example data with watermarked sample documents.{top('data.demo') && <> Remove it any time in <Link to="/settings/data">Settings → Data → Remove sample data</Link>.</>}</div>}
      {company === OTHER_CO && <div className="note-box">These letters belong to companies that are no longer set up in Settings › Companies. Their ledger stays on record; add the company back to manage them.</div>}
      <Tabs tabs={tabs} value={tab} onChange={(t) => setSp({ tab: t }, { replace: true })} />
      {!d.loaded ? <Skeleton /> : <>
        {tab === 'overview' && <Overview company={company} />}
        {tab === 'letters' && <LettersTab company={company} />}
        {tab === 'approvals' && <ApprovalsTab company={company} />}
        {tab === 'pipeline' && <PipelineTab company={company} />}
        {tab === 'arrivals' && <ArrivalsTab company={company} />}
        {tab === 'costs' && <CostsTab company={company} />}
        {tab === 'exits' && <ExitsTab company={company} />}
        {tab === 'recon' && <ReconTab company={company} />}
        {tab === 'claims' && <ClaimsTab company={company} />}
        {tab === 'rules' && <RulesTab />}
      </>}
    </div>
  )
}

/* v1.6.0: quota at a glance — donut of the balance, pace of new recruits (sparkline) and a simple run-out forecast */
function QuotaHero({ tally, recruits, spend, go }: { tally: Tally[]; recruits: { created_at: string; status: string }[]; spend: number; go: (t: string) => void }) {
  const approved = sum(tally, 'approved'), avail = sum(tally, 'available'), resv = sum(tally, 'reserved'), used = sum(tally, 'used')
  const now = Date.now(), wk = 7 * 864e5
  const weeks = Array.from({ length: 12 }, (_, i) => recruits.filter((r) => { const t = Date.parse(r.created_at); return t > now - (12 - i) * wk && t <= now - (11 - i) * wk }).length)
  const last90 = recruits.filter((r) => Date.parse(r.created_at) > now - 90 * 864e5).length
  const perDay = last90 / 90
  const days = perDay > 0 ? Math.round(avail / perDay) : null
  const runOut = days != null ? new Date(now + days * 864e5).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : null
  const pct = approved ? Math.round(((used + resv) / approved) * 100) : 0
  return (
    <section className="qr-hero hero160" aria-label="Quota at a glance">
      <button type="button" className="qr-donut" onClick={() => go('letters')} title="Why you see this: the balance of all active approval letters in view. Click for letters & ledger.">
        <Donut size={112} stroke={14} label={`Quota: ${used} used, ${resv} reserved, ${avail} available of ${approved}`}
          parts={[{ v: used, color: 'var(--pri)', name: 'Used' }, { v: resv, color: 'var(--amber)', name: 'Reserved' }, { v: avail, color: 'var(--green)', name: 'Available' }]}
          center={<span className="dn-c"><b><CountUp value={avail} /></b><small>available</small></span>} />
        <span className="qr-leg">
          <span><i style={{ background: 'var(--pri)' }} />Used <b>{used}</b></span>
          <span><i style={{ background: 'var(--amber)' }} />Reserved <b>{resv}</b></span>
          <span><i style={{ background: 'var(--green)' }} />Available <b>{avail}</b></span>
          <span className="muted small">of {approved} approved · {pct}% committed</span>
        </span>
      </button>
      <div className="qr-fc" title="Why you see this: new recruits added in the last 90 days set the pace; at that pace the available slots last this long. It is an estimate, not a rule.">
        <span className="small muted">Forecast</span>
        <b className="qr-fc-v">{days == null ? 'No recent use' : days > 730 ? 'Over 2 years' : `~${days < 60 ? `${days} days` : `${Math.round(days / 30)} months`}`}</b>
        <span className="small muted">{days == null ? 'No new recruits in 90 days' : `Slots run out around ${runOut} at today’s pace`}</span>
        <span className="qr-spark"><Spark data={weeks} w={150} h={30} color="var(--pri)" /><small className="muted">new recruits · 12 weeks</small></span>
      </div>
      <div className="stats stats-4 hero-stats qr-mini">
        <Stat label="In pipeline" value={<CountUp value={sum(tally, 'in_pipeline')} />} icon="plane" onClick={() => go('pipeline')} />
        <Stat label="COM — replaceable" value={<CountUp value={sum(tally, 'repl_eligible')} />} tone="teal" icon="exit" onClick={() => go('claims')} />
        <Stat label="Runaways (no COM)" value={<CountUp value={sum(tally, 'runaways')} />} tone="red" icon="alert" onClick={() => go('exits')} />
        <Stat label="Spent" value={rmFmt(spend)} icon="money" onClick={() => go('costs')} />
      </div>
    </section>
  )
}

function sum(t: Tally[], k: keyof Tally) { return t.reduce((a, x) => a + (Number(x[k]) || 0), 0) }

function Overview({ company }: { company: string }) {
  const ctx = useQCtx()
  const d = useQuota()
  const nav = useNavigate()
  const workers = useWorkers()
  const go = (tab: string) => nav(`/quota?tab=${tab}`)
  const inC = <T extends { company_id: string }>(x: T) => inCompany(company, x.company_id)
  const tally = d.tally.filter(inC).filter((t) => t.status === 'active')
  const spend = d.payments.filter(inC).filter((p) => p.status !== 'void').reduce((a, p) => a + Number(p.amount_rm), 0)
  const alerts = useMemo(() => quotaAlerts(d, workers as never).filter((a) => !a.company || inCompany(company, a.company)), [d, workers, company])
  const waiting = d.requests.filter(inC).filter((r) => canDecide(r, ctx.rank, ctx.profile?.id))
  const myId = ctx.profile?.id
  const myRecruits = d.recruits.filter(inC).filter((r) => r.status === 'active' && (r.owner_id === myId || ctx.rank >= 2))
  const arrivals = d.recruits.filter(inC).filter((r) => r.status === 'active' && r.flight_at && !r.arrived_at && (daysUntil(r.flight_at.slice(0, 10)) ?? 0) <= 14)
  const myReturned = d.requests.filter((r) => r.requested_by === myId && r.status === 'returned')
  const sortedAlerts = [...alerts].sort((a, b) => (a.level === 'red' ? -1 : 1) - (b.level === 'red' ? -1 : 1))
  const alertPage = usePaged(sortedAlerts, 8)
  const taskItems = [
    ...myReturned.map((r) => <li key={r.id}><Chip tone="orange">Returned</Chip> <Link to={`/quota?tab=approvals&open=${r.id}`}>Q-{r.ref_no}: fix and resubmit — {r.close_note || r.gm_note || r.ceo_note}</Link></li>),
    ...arrivals.map((r) => <li key={'a' + r.id}><Chip tone="blue">Arrival</Chip> <Link to={`/quota/recruit/${r.id}`}>{r.full_name} lands {atMyt(r.flight_at)} — hostel bed, pickup, airport letter</Link></li>),
    ...myRecruits.slice(0, 40).flatMap((r) => { const t = tplOf(d, r); const st = nextStep(r, t, stepCtx(d, r)); return st ? [<li key={'r' + r.id}><Chip>{stageLabelIn(t, st.stage)}</Chip> <Link to={`/quota/recruit/${r.id}`}>{r.full_name}: {st.label}</Link></li>] : [] }),
  ]
  const taskPage = usePaged(taskItems, 8)
  return (
    <div className="qr-grid">
      <QuotaHero tally={tally} recruits={d.recruits.filter(inC)} spend={spend} go={go} />

      {ctx.rank >= 3 && (
        <Card fold="open" title={<>Waiting for your approval {waiting.length > 0 && <Chip tone="red">{waiting.length}</Chip>}</>}>
          {waiting.length ? <ul className="alist">{waiting.slice(0, 6).map((r) => (
            <li key={r.id}><Link to={`/quota?tab=approvals&open=${r.id}`}><Chip tone={UR_STATUS[r.status].tone}>Q-{r.ref_no}</Chip>
              <span className="qr-li"><span>{r.slots} × {r.country} — {r.purpose}</span>
                <small className="muted">{ctx.cName(r.company_id)} · {ctx.who(r.requested_by_name, r.requested_by_role)} · {atMyt(r.requested_at)}</small></span></Link></li>
          ))}{waiting.length > 6 && <li><Link to="/quota?tab=approvals">All {waiting.length} waiting in Approvals →</Link></li>}</ul> : <p className="muted">Nothing is waiting for you.</p>}
        </Card>
      )}

      <Card fold="open" title={<>Alerts <Chip tone="gray">{alerts.length}</Chip> {alerts.filter((a) => a.level === 'red').length > 0 && <Chip tone="red">{alerts.filter((a) => a.level === 'red').length} red</Chip>}</>}>
        {alerts.length ? <><ul className="alist">{alertPage.rows.map((a, i) => (
          <li key={i}><RagDot rag={a.level} /> <Link to={a.link}>{a.text}</Link></li>))}</ul>{alertPage.pager('Quota alerts')}</> : <p className="muted">All clear.</p>}
      </Card>

      {ctx.rank >= 3 && <FollowUps company={company} />}
      <MasterTable company={company} />

      <Card fold="closed" title={<>Quota health — per letter and country <Chip tone="gray">{tally.length}</Chip></>}>
        <DataTable label="Quota health" rows={tally} rowKey={(t) => `${t.quota_id}|${t.country}`} dense pageSize={10}
          initialSort={{ key: 'rag', dir: 'asc' }}
          columns={[
            { key: 'rag', label: 'Health', render: (t) => <RagDot rag={quotaRag(t, d.rules).rag} />, sort: (t) => ({ red: 0, amber: 1, green: 2 })[quotaRag(t, d.rules).rag] },
            { key: 'ref', label: 'Letter', main: true, render: (t) => <><b>{t.ref_no}</b> · {t.country}<br /><small className="muted">{ctx.cName(t.company_id)}</small></>, sort: (t) => t.ref_no },
            { key: 'appr', label: 'Approved', align: 'right', hide: 'phone', render: (t) => t.approved, sort: (t) => t.approved },
            { key: 'avail', label: 'Available', align: 'right', render: (t) => <b>{t.available}</b>, sort: (t) => t.available },
            { key: 'resv', label: 'Reserved', align: 'right', hide: 'phone', render: (t) => t.reserved },
            { key: 'used', label: 'Used', align: 'right', hide: 'phone', render: (t) => t.used },
            { key: 'exp', label: 'Expires', hide: 'tablet', render: (t) => (t.expiry_date ? <>{fmtDate(t.expiry_date)} <small className="muted">({(daysUntil(t.expiry_date) ?? 0)} d)</small></> : '—'), sort: (t) => t.expiry_date },
            { key: 'why', label: 'Why', hide: 'wide', render: (t) => quotaRag(t, d.rules).why.join('; ') || 'OK' },
          ]}
          actions={(t) => <Actions><IconAction kind="view" label="Open the ledger for this letter" onClick={() => nav(`/quota?tab=letters&q=${t.quota_id}`)} /></Actions>}
          empty={<Empty title="No open approval letters">Record the first quota approval letter under Letters & ledger.</Empty>} />
      </Card>

      {ctx.rank <= 2 && (
        <Card fold="open" title={<>My tasks <Chip tone="gray">{taskItems.length}</Chip></>}>
          <ul className="alist">
            {taskPage.rows}
            {!taskItems.length && <li className="muted">No open tasks.</li>}
          </ul>{taskPage.pager('My tasks')}
        </Card>
      )}
    </div>
  )
}
