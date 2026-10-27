import { NextSteps, type StepCounts } from './nextSteps'
import { Link, useNavigate } from 'react-router-dom'
import { Card, Chip, Stat, Tabs } from './ui'
import { useDashTab } from '../lib/dashTab'
import { useAuth } from '../lib/auth'
import { useConfig } from '../lib/config'
import { isExited } from '../lib/calc'
import { CONSENT_LABEL, CONSENT_TONE, consentOf, custodyOf, overdueDays } from '../lib/passport'
import { proofState, refNo, useRequests } from '../lib/requests'
import { OPEN_STATUSES, REQUEST_TYPE, STATUS_LABEL, STATUS_TONE, needsMyAction } from '../lib/workflow'
import type { Worker } from '../lib/types'
import { PendingUsersPanel } from './userApprovals'
import { usePendingUsers } from '../lib/userApprovals'
import { useOutlets } from '../lib/hooks'
import { completeness } from '../lib/validate'
import { Greeting, Priorities, StatusGlance, TipCard, type Extra } from './advice'
import { DataTable, Details } from './dataTable'
import { Actions, IconAction } from './iconAction'
import type { Alert } from '../lib/calc'

/** Requests, flight tickets, emergency-leave proof and passport consent — shared by the HR and Outlet-Manager dashboards. */
export function WorkflowPanel({ workers }: { workers: Worker[] }) {
  const { role, session, isOM, canWrite, can, route } = useAuth()
  const outlets = useOutlets()
  const cfg = useConfig()
  const nav = useNavigate()
  const { rows } = useRequests()
  const me = session?.user.id || ''
  const cur = workers.filter((w) => !isExited(w))
  const mine = rows.filter((r) => needsMyAction(r, role || '', me, { can, route }))
  const { pending: newUsers } = usePendingUsers()
  const incomplete = canWrite ? cur.filter((w) => !completeness(w, outlets).complete) : []
  const myCount = mine.length + newUsers.length + incomplete.length
  const open = rows.filter((r) => OPEN_STATUSES.includes(r.status))
  const week = Date.now() - 14 * 86400000
  const tickets = rows.filter((r) => r.data.ticketBooked === true && new Date(r.updated_at).getTime() > week)
  const proof = rows.filter((r) => r.type === 'emergency_leave' && !['rejected', 'cancelled'].includes(r.status)).map((r) => ({ r, st: proofState(r, r.data.proofReceived ? 1 : 0, Number(r.data.proofDays) || cfg.emergency_reasons.find((x) => x.key === r.data.reasonKey)?.proofDays || 14) })).filter((x) => x.st === 'pending' || x.st === 'overdue')
  const pending = cur.filter((w) => consentOf(w) === 'pending')
  const notIssued = cur.filter((w) => consentOf(w) === 'not_issued')
  const toVerify = cur.filter((w) => consentOf(w) === 'uploaded')
  const out = cur.filter((w) => custodyOf(w) === 'released')
  const overdue = cur.filter((w) => overdueDays(w) > 0)
  const wName = (id: string | null) => workers.find((w) => w.id === id)?.fullName || '—'
  return (
    <>
      {pending.length > 0 && (
        <Card title={`🛂 Passport consent PENDING (${pending.length})`} className="card-alert" actions={<Link className="link" to="/reports?r=passport">Register →</Link>}>
          <p className="small">These workers were given the safekeeping consent form but it is not yet signed and uploaded. {isOM ? 'Witness the signing, then scan & upload it from the worker’s Passport tab.' : 'Follow up with the outlet manager.'}</p>
          <div className="row gap-s wrap">{pending.slice(0, 30).map((w) => <Link key={w.id} to={`/workers/${w.id}?tab=passport`}><Chip tone="red">{w.fullName}</Chip></Link>)}</div>
        </Card>
      )}
      {incomplete.length > 0 && (
        <Card title={`📝 Incomplete profiles (${incomplete.length})`} actions={<Link className="link" to="/workers?gap=incomplete">See all →</Link>}>
          <div id="incomplete-profiles" className="small">Saved as draft — some required fields are still missing. Tap a name to finish the profile.</div>
          <div className="row gap-s wrap">{incomplete.slice(0, 30).map((w) => { const c = completeness(w, outlets); return <Link key={w.id} to={`/workers/${w.id}/edit`} title={c.missing.map((m) => m.label).join(', ')}><Chip tone="amber">{w.fullName || '(no name)'} · {c.done}/{c.total}</Chip></Link> })}</div>
        </Card>
      )}
      <div className="stats">
        <Stat label="Needs my action" value={myCount} icon="check" tone={myCount ? 'orange' : 'green'} sub={[newUsers.length ? `${newUsers.length} new user${newUsers.length > 1 ? 's' : ''} to approve` : '', incomplete.length ? `${incomplete.length} incomplete profile${incomplete.length > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ') || undefined}
          onClick={() => { if (newUsers.length && !mine.length) { const el = document.getElementById('pending-users'); if (el) el.scrollIntoView({ behavior: 'smooth' }); else nav('/settings/users') } else if (incomplete.length && !mine.length) document.getElementById('incomplete-profiles')?.scrollIntoView({ behavior: 'smooth' }); else nav('/requests?tab=mine_action') }} />
        <Stat label="Open requests" value={open.length} icon="doc" tone="blue" onClick={() => nav('/requests?tab=open')} />
        <Stat label="Tickets booked (14 d)" value={tickets.length} icon="plane" tone="purple" onClick={() => nav('/requests?tab=all')} />
        <Stat label="Emergency proof pending" value={proof.length} icon="alert" tone={proof.some((p) => p.st === 'overdue') ? 'red' : 'amber'} onClick={() => nav('/reports?r=emergency')} />
        <Stat label="Consent pending" value={pending.length} icon="alert" tone={pending.length ? 'red' : 'green'} sub={!isOM ? `${notIssued.length} not issued · ${toVerify.length} to verify` : undefined} onClick={() => nav('/reports?r=passport')} />
        <Stat label="Passports with worker (released)" value={out.length} icon="doc" tone={overdue.length ? 'red' : 'gray'} sub={overdue.length ? `${overdue.length} overdue` : undefined} onClick={() => nav('/reports?r=passport')} />
      </div>
      <div id="pending-users"><PendingUsersPanel /></div>
      {tickets.length > 0 && (
        <Card title="✈️ Ticket booked — download">
          <DataTable label="Tickets booked" dense rows={tickets.slice(0, 8)} rowKey={(r) => r.id}
            columns={[
              { key: 'w', label: 'Worker', main: true, render: (r) => <Link className="dt-link" to={`/requests/${r.id}`}>{wName(r.worker_id)}</Link> },
              { key: 't', label: 'Request', hide: 'phone', render: (r) => <>{REQUEST_TYPE[r.type]?.label} <small className="muted">{refNo(r)}</small></> },
              { key: 'f', label: 'From', hide: 'tablet', render: (r) => String(r.data.from || '') },
            ]}
            actions={(r) => <Actions><IconAction kind="download" label="Open the request to download the ticket" onClick={() => nav(`/requests/${r.id}`)} /></Actions>}
            expand={(r) => <Details items={[['Request', REQUEST_TYPE[r.type]?.label], ['Reference', refNo(r)], ['From', String(r.data.from || '') || null]]} />} />
        </Card>
      )}
      {mine.length > 0 && (
        <Card title="Waiting for you" actions={<Link className="link" to="/requests">All requests →</Link>}>
          <DataTable label="Waiting for you" dense rows={mine.slice(0, 8)} rowKey={(r) => r.id}
            columns={[
              { key: 't', label: 'Request', main: true, render: (r) => <span className="dt-person"><span className="req-ic" aria-hidden>{REQUEST_TYPE[r.type]?.icon}</span><span><Link className="dt-link" to={`/requests/${r.id}`}>{REQUEST_TYPE[r.type]?.label}</Link><small>{refNo(r)}</small></span></span> },
              { key: 'w', label: 'Worker', render: (r) => wName(r.worker_id) },
              { key: 'by', label: 'Raised by', hide: 'tablet', render: (r) => r.created_by_name },
              { key: 's', label: 'Status', hide: 'phone', render: (r) => <Chip tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Chip> },
            ]}
            actions={(r) => <Actions><IconAction kind="view" label="Open request" onClick={() => nav(`/requests/${r.id}`)} /></Actions>}
            expand={(r) => <Details items={[['Reference', refNo(r)], ['Worker', wName(r.worker_id)], ['Raised by', r.created_by_name], ['Status', STATUS_LABEL[r.status]]]} />} />
        </Card>
      )}
    </>
  )
}

/** Simplified dashboard for an Outlet Manager (his outlets only — enforced by the server). */
const OM_TABS: { id: 'overview' | 'requests' | 'workers'; label: string }[] = [{ id: 'overview', label: 'Overview' }, { id: 'requests', label: 'Requests' }, { id: 'workers', label: 'My workers' }]
export function OmDashboard({ workers, alerts, extra, counts }: { workers: Worker[]; alerts: Alert[]; extra: Extra[]; counts: StepCounts }) {
  const { myOutlets } = useAuth()
  const outlets = useOutlets()
  const nav = useNavigate()
  const cur = workers.filter((w) => !isExited(w))
  const [tab, setTab] = useDashTab(['overview', 'requests', 'workers'] as const, 'overview')
  return (
    <div className="page dash-tabs">
      <div className="page-h"><Greeting sub={`My outlet${myOutlets.length > 1 ? 's' : ''} · ${cur.length} workers`} /></div>
      {myOutlets.length === 0 && <p className="banner warn">No outlets are linked to your account yet. Your admin links them in Settings → Users.</p>}
      <Tabs tabs={OM_TABS.map((t) => ({ ...t, badge: t.id === 'requests' ? extra.length || undefined : undefined }))} value={tab} onChange={setTab} />
      <div role="tabpanel" className="page dash-panel">
        {tab === 'overview' && <>
          <div className="quick">
            {[['annual_leave', '🏖️', 'Annual leave'], ['emergency_leave', '🚨', 'Emergency leave'], ['medical_leave', '🤒', 'MC'], ['home_leave', '✈️', 'Home leave'], ['salary_advance', '💵', 'Advance'], ['passport', '🛂', 'Passport']].map(([k, i, l]) => (
              <button key={k} onClick={() => nav(`/requests/new?type=${k}`)}><span>{i}</span>{l}</button>
            ))}
          </div>
          <NextSteps counts={counts} />
          <Priorities alerts={alerts} workers={workers} outlets={outlets} om extra={extra} />
        </>}
        {tab === 'requests' && <WorkflowPanel workers={workers} />}
        {tab === 'workers' && <>
          <div className="dash-3"><StatusGlance workers={workers} /><TipCard /></div>
          <Card title="My workers" actions={<Link className="link" to="/workers">All →</Link>}>
            <DataTable label="My workers" dense rows={cur.slice(0, 12)} rowKey={(w) => w.id}
              columns={[
                { key: 'n', label: 'Worker', main: true, sort: (w) => w.fullName, render: (w) => <span><Link className="dt-link" to={`/workers/${w.id}`}>{w.fullName}</Link><small className="muted"> {w.workerNo}</small></span> },
                { key: 'j', label: 'Job', hide: 'phone', render: (w) => w.jobCategory },
                { key: 's', label: 'Status', hide: 'tablet', render: (w) => w.status },
                { key: 'c', label: 'Passport consent', hide: 'phone', render: (w) => (consentOf(w) !== 'signed' ? <Chip tone={CONSENT_TONE[consentOf(w)]}>🛂 {CONSENT_LABEL[consentOf(w)]}</Chip> : <span className="muted small">Signed</span>) },
              ]}
              actions={(w) => <Actions><IconAction kind="view" label="Open worker" onClick={() => nav(`/workers/${w.id}`)} /></Actions>}
              expand={(w) => <Details items={[['Worker no.', w.workerNo], ['Job', w.jobCategory], ['Status', w.status], ['Passport consent', CONSENT_LABEL[consentOf(w)]]]} />} />
          </Card>
        </>}
      </div>
    </div>
  )
}
