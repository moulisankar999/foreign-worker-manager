/* v1.4 Quota & Recruitment — CEO, GM, HR Admin, HR Manager only.
 * The quota is kept like a bank account: an approval letter opens it, every movement is an append-only ledger line,
 * every use needs a Quota Use Request approved by the CEO (GM first, or the CEO alone), and exits / runaways reconcile it. */
import { FollowUps, MasterTable } from './Extras'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Card, Chip, Empty, SelectFilter, Stat, Tabs, Toolbar } from '../../components/ui'
import { DataTable } from '../../components/dataTable'
import { Actions, IconAction } from '../../components/iconAction'
import { useWorkers } from '../../lib/hooks'
import { inCompany, OTHER_CO, setKnownCompanies, atMyt, nextStep, quotaAlerts, quotaRag, rmFmt, stageLabelIn, stepCtx, tplOf, UR_STATUS, useQuota, type Tally } from '../../lib/quota'
import { daysUntil, fmtDate } from '../../lib/util'
import { RagDot, useQCtx } from './shared'
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

type TabId = 'overview' | 'letters' | 'approvals' | 'pipeline' | 'arrivals' | 'costs' | 'exits' | 'recon' | 'claims' | 'rules'

export default function QuotaPage() {
  const ctx = useQCtx()
  const d = useQuota()
  const { id } = useParams()
  const [sp, setSp] = useSearchParams()
  const [company, setCompany] = useState('')
  if (!ctx.rank) return <div className="page"><Empty title="Not available">Quota & Recruitment is for the CEO, General Manager, HR Admin and HR Manager.</Empty></div>
  if (id) return <RecruitPage id={id} />
  const waiting = d.requests.filter((r) => canDecide(r, ctx.rank, ctx.profile?.id)).length
  const tabs: { id: TabId; label: string; badge?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'letters', label: 'Letters & ledger', badge: ctx.isGmUp ? d.quotas.filter((q) => q.status === 'pending').length : undefined },
    { id: 'approvals', label: 'Quota use approvals', badge: waiting || undefined },
    { id: 'pipeline', label: 'Pipeline' },
    { id: 'arrivals', label: 'Arrivals & hostel' },
    { id: 'costs', label: 'Payments & budget', badge: d.payments.filter((p) => p.status === 'pending_check').length || undefined },
    { id: 'exits', label: 'CMO & runaways', badge: d.runaways.filter((r) => r.outcome === 'open' && !r.imm_ref).length || undefined },
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
      <div className="page-h"><div><h1>Quota & Recruitment</h1>
        <p className="muted">Approval letters, the quota balance, CEO-approved quota use, recruits until they arrive, payments, CMOs, runaways and replacement claims.</p></div>
        <Toolbar>{companyPick}<IconAction kind="refresh" label="Reload from the server" onClick={() => d.reload()} /></Toolbar>
      </div>
      {d.error && <div className="note-box bad">Could not load: {d.error}</div>}
      {company === OTHER_CO && <div className="note-box">These letters belong to companies that are no longer set up in Settings › Companies. Their ledger stays on record; add the company back to manage them.</div>}
      <Tabs tabs={tabs} value={tab} onChange={(t) => setSp({ tab: t }, { replace: true })} />
      {!d.loaded ? <p className="muted">Loading…</p> : <>
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
  return (
    <div className="qr-grid">
      <div className="stats">
        <Stat label="Approved slots" value={sum(tally, 'approved')} icon="doc" onClick={() => go('letters')} />
        <Stat label="Available" value={sum(tally, 'available')} tone="green" icon="check" onClick={() => go('letters')} />
        <Stat label="Reserved (requests)" value={sum(tally, 'reserved')} tone="amber" icon="lock" onClick={() => go('approvals')} />
        <Stat label="Used" value={sum(tally, 'used')} tone="blue" icon="users" onClick={() => go('recon')} />
        <Stat label="In pipeline" value={sum(tally, 'in_pipeline')} icon="plane" onClick={() => go('pipeline')} />
        <Stat label="CMO — replaceable" value={sum(tally, 'repl_eligible')} tone="teal" icon="exit" onClick={() => go('claims')} />
        <Stat label="Runaways (no CMO)" value={sum(tally, 'runaways')} tone="red" icon="alert" onClick={() => go('exits')} />
        <Stat label="Spent" value={rmFmt(spend)} icon="money" onClick={() => go('costs')} />
      </div>

      {ctx.rank >= 3 && (
        <Card title={<>Waiting for your approval {waiting.length > 0 && <Chip tone="red">{waiting.length}</Chip>}</>}>
          {waiting.length ? <ul className="alist">{waiting.map((r) => (
            <li key={r.id}><Link to={`/quota?tab=approvals&open=${r.id}`}><Chip tone={UR_STATUS[r.status].tone}>Q-{r.ref_no}</Chip>
              <span className="qr-li"><span>{r.slots} × {r.country} — {r.purpose}</span>
                <small className="muted">{ctx.cName(r.company_id)} · {ctx.who(r.requested_by_name, r.requested_by_role)} · {atMyt(r.requested_at)}</small></span></Link></li>
          ))}</ul> : <p className="muted">Nothing is waiting for you.</p>}
        </Card>
      )}

      <Card title={<>Alerts {alerts.filter((a) => a.level === 'red').length > 0 && <Chip tone="red">{alerts.filter((a) => a.level === 'red').length} red</Chip>}</>}>
        {alerts.length ? <ul className="alist">{alerts.sort((a, b) => (a.level === 'red' ? -1 : 1) - (b.level === 'red' ? -1 : 1)).map((a, i) => (
          <li key={i}><RagDot rag={a.level} /> <Link to={a.link}>{a.text}</Link></li>))}</ul> : <p className="muted">All clear.</p>}
      </Card>

      {ctx.rank >= 3 && <FollowUps company={company} />}
      <MasterTable company={company} />

      <Card title="Quota health — per letter and country">
        <DataTable label="Quota health" rows={tally} rowKey={(t) => `${t.quota_id}|${t.country}`} dense
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
        <Card title="My tasks">
          <ul className="alist">
            {myReturned.map((r) => <li key={r.id}><Chip tone="orange">Returned</Chip> <Link to={`/quota?tab=approvals&open=${r.id}`}>Q-{r.ref_no}: fix and resubmit — {r.close_note || r.gm_note || r.ceo_note}</Link></li>)}
            {arrivals.map((r) => <li key={r.id}><Chip tone="blue">Arrival</Chip> <Link to={`/quota/recruit/${r.id}`}>{r.full_name} lands {atMyt(r.flight_at)} — hostel bed, pickup, airport letter</Link></li>)}
            {myRecruits.slice(0, 40).map((r) => { const t = tplOf(d, r); const st = nextStep(r, t, stepCtx(d, r)); return st ? <li key={r.id}><Chip>{stageLabelIn(t, st.stage)}</Chip> <Link to={`/quota/recruit/${r.id}`}>{r.full_name}: {st.label}</Link></li> : null })}
            {!myReturned.length && !arrivals.length && !myRecruits.length && <li className="muted">No open tasks.</li>}
          </ul>
        </Card>
      )}
    </div>
  )
}
