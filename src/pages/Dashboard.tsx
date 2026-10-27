import { weeklyTrends } from '../lib/trends'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useDashTab, type DashTab } from '../lib/dashTab'
import { BarList, Btn, Card, Chip, ColumnChart, Empty, Stat, Tabs, sevTone, Skeleton } from '../components/ui'
import { currentBasic, isExited, isOnLeave, outletName, outstanding, ticketInfo } from '../lib/calc'
import { useAlerts, useOutlets, useSettings, useWorkersLoaded } from '../lib/hooks'
import { loadSampleData } from '../lib/sample'
import { OmDashboard, WorkflowPanel } from '../components/dashExtras'
import { PendingUsersPanel } from '../components/userApprovals'
import { useAuth } from '../lib/auth'
import { missingLanguage } from '../lib/languages'
import { fmtDate, fmtMonth, rm0, todayISO } from '../lib/util'
import { CountUp, Ring } from '../components/viz'
import { healthScore } from '../lib/compliance'
import { NextSteps } from '../components/nextSteps'
import { ExpiryTimeline, Greeting, HealthCard, LatestChecks, Priorities, StatusGlance, TipCard, type Extra } from '../components/advice'
import { useCeoBadge } from './CeoReview'
import { setShowDemo, useShowDemo } from '../lib/demo'
import { useRequests } from '../lib/requests'
import { needsMyAction } from '../lib/workflow'
import { usePendingUsers } from '../lib/userApprovals'
import { RiskTable } from './Compliance'
import { useOutletRisks } from '../lib/risk'
import { birthdays } from '../lib/birthdays'

const NO_EXTRA: Extra[] = [] // requests, CEO review and new users are steps in What to do next
export default function Dashboard() {
  const loaded = useWorkersLoaded()
  const workers = loaded ?? []
  const outlets = useOutlets()
  const s = useSettings()
  const alerts = useAlerts()
  const nav = useNavigate()
  const [busy, setBusy] = useState(false)
  const { isOM, canWrite, canSeeSalary, isSuper, isHr, role, session, can, route } = useAuth()
  const ceoN = useCeoBadge()
  const { rows: reqs } = useRequests()
  const { pending: newUsers } = usePendingUsers()
  const mineN = reqs.filter((r) => needsMyAction(r, role || '', session?.user.id || '', { can, route })).length
  const extra = useMemo<Extra[]>(() => [
    ...(mineN ? [{ id: 'req', rank: 1, icon: '📝', tone: 'blue' as const, text: `${mineN} request${mineN === 1 ? '' : 's'} waiting for your decision`, detail: 'Approve, return or reject — the outlet is waiting.', to: '/requests?tab=mine_action', label: 'Open requests' }] : []),
    ...(isSuper && ceoN ? [{ id: 'ceo', rank: 2, icon: '🔒', tone: 'teal' as const, text: `${ceoN} decision${ceoN === 1 ? '' : 's'} to review (CEO)`, detail: 'General Manager decisions and rejections — keep, overrule or recall.', to: '/ceo-review', label: 'Review now' }] : []),
    ...(newUsers.length ? [{ id: 'users', rank: 2, icon: '👤', tone: 'amber' as const, text: `${newUsers.length} new user${newUsers.length === 1 ? '' : 's'} waiting for approval`, detail: 'Give them a role and the outlets they work for.', to: '/settings/users', label: 'Approve' }] : []),
  ], [mineN, isSuper, ceoN, newUsers.length])

  const k = useMemo(() => {
    const cur = workers.filter((w) => !isExited(w))
    const docAlerts = alerts.filter((a) => a.date && a.days !== null && !['Flight ticket', 'Due back', 'Leave approval', 'Minimum contract'].includes(a.category) && a.category !== 'Overdue return')
    const within = (n: number) => docAlerts.filter((a) => a.days! >= 0 && a.days! <= n).length
    const by = (fn: (w: (typeof cur)[number]) => string) => {
      const m = new Map<string, number>()
      cur.forEach((w) => m.set(fn(w) || '—', (m.get(fn(w) || '—') || 0) + 1))
      return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
    }
    // expiries by month, next 12 months
    const months: { label: string; value: number; parts: { value: number; tone: string }[] }[] = []
    const t = new Date()
    for (let i = 0; i < 12; i++) {
      const d = new Date(t.getFullYear(), t.getMonth() + i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      let pp = 0, pm = 0, other = 0
      cur.forEach((w) => w.documents.forEach((doc) => {
        if (doc.expiryDate?.startsWith(key) && doc.expiryDate >= todayISO().slice(0, 7)) {
          if (doc.type.startsWith('Passport')) pp++
          else if (doc.type.startsWith('Work Permit')) pm++
          else other++
        }
      }))
      months.push({ label: fmtMonth(key), value: pp + pm + other, parts: [{ value: pm, tone: 'red' }, { value: pp, tone: 'amber' }, { value: other, tone: 'teal' }] })
    }
    return {
      total: cur.length,
      active: cur.filter((w) => w.status === 'Active-Working').length,
      leave: cur.filter(isOnLeave).length,
      d30: within(30), d60: within(60), d90: within(90),
      expired: docAlerts.filter((a) => a.days! < 0).length,
      tickets: cur.filter((w) => ticketInfo(w, s).eligible).length,
      loans: cur.reduce((a, w) => a + outstanding(w), 0),
      payroll: cur.reduce((a, w) => a + currentBasic(w), 0),
      byNat: by((w) => w.nationality),
      byType: by((w) => w.businessType || ''),
      byOutlet: by((w) => outletName(outlets, w.outletId)),
      byStatus: by((w) => w.status).map((d) => ({ ...d, tone: d.label === 'Active-Working' ? 'green' : d.label === 'Absconded' ? 'red' : 'blue' })),
      months,
      exited: workers.length - cur.length,
      noLang: cur.filter(missingLanguage).length,
    }
  }, [workers, alerts, outlets, s])

  const tabIds = (canSeeSalary ? ['overview', 'expiries', 'requests', 'pay', 'risk', 'workforce'] : ['overview', 'expiries', 'requests', 'risk', 'workforce']) as DashTab[]
  const [tab, setTab] = useDashTab(tabIds, 'overview')
  const trend = useMemo(() => (loaded ? weeklyTrends(workers) : undefined), [loaded, workers])
  const health = useMemo(() => healthScore(workers, alerts, outlets, { pay: !!canSeeSalary }), [workers, alerts, outlets, canSeeSalary])
  if (isOM) return <OmDashboard workers={workers} alerts={alerts} extra={extra} counts={{ mine: mineN, ceo: 0, users: 0, expiring: k.expired + k.d30, noLang: 0 }} />
  if (loaded && workers.length === 0 && canWrite)
    return (
      <div className="page">
        <h1>Welcome 👋</h1>
        <PendingUsersPanel />
        <Card>
          <Empty icon="users" title="No workers yet">
            <p className="muted">Add your outlets in Settings, then add workers. Or explore with fake demo data first.</p>
            <div className="row gap-s wrap center">
              <Btn kind="primary" icon="plus" onClick={() => nav('/workers/new')}>Add first worker</Btn>
              {!outlets.some((o) => !o.name.startsWith('DEMO ')) && <Btn icon="download" disabled={busy} onClick={async () => { setBusy(true); await loadSampleData(); setBusy(false) }}>Load sample data</Btn>}
              <Btn icon="gear" onClick={() => nav('/settings/org')}>Set up outlets</Btn>
            </div>
          </Empty>
        </Card>
      </div>
    )

  const bdays = birthdays(workers, 'today')
  const urgent = alerts.filter((a) => a.severity === 'critical' || a.severity === 'high').slice(0, 8)
  const labels: Record<DashTab, string> = { overview: 'Overview', expiries: 'Expiries', requests: 'Requests', pay: 'Pay', risk: 'Risk & checks', workforce: 'Workforce' }
  const actionN = mineN + newUsers.length + (isSuper ? ceoN : 0), expiringN = k.expired + k.d30
  return (
      <div className="page dash-tabs">
        <section className="hero160" aria-label="Today">
          <div className="hero-top">
            <Greeting sub={`${k.total} current workers${k.exited ? ` · ${k.exited} exited` : ''}`} />
            {isSuper && <DemoChip />}
            {isHr && bdays.length > 0 && <Link to="/birthdays" className="chip chip-pink bd-chip" data-testid="bd-chip" title="Why you see this: workers in your scope with a birthday today (Malaysia time). Tap to send a wish.">🎂 {bdays.length} birthday{bdays.length > 1 ? 's' : ''} today</Link>}
            <button type="button" className="hero-ring" onClick={() => setTab('risk')} title={`Why you see this: your compliance health score — ${health.label}. It weighs expired documents, passports held, levy, insurance and more. Click for the breakdown.`}>
              <Ring value={health.score} size={58} stroke={6} tone={`var(--${health.tone === 'gray' ? 'muted' : health.tone})`} label={`Compliance health ${health.score ?? 'not available'}`} />
              <span><b><span className="hr-long">Compliance health</span><span className="hr-short">Compliance</span></b><small>{health.label}</small></span>
            </button>
            <div className="row gap-s wrap dash-add">
              {canWrite && <Btn kind="primary" icon="plus" onClick={() => nav('/workers/new')}>Add worker</Btn>}
            </div>
          </div>
          {tab === 'overview' && !loaded && <Skeleton kind="tiles" rows={4} />}
          {tab === 'overview' && loaded && <div className="stats stats-4 hero-stats">
            <Stat label="Total workers" value={<CountUp value={k.total} />} trend={trend?.total} icon="users" onClick={() => nav('/workers')} />
            <Stat label="Active / working" value={<CountUp value={k.active} />} trend={trend?.active} icon="check" tone="green" onClick={() => nav('/workers?status=Active-Working')} />
            <Stat label="On leave" value={<CountUp value={k.leave} />} trend={trend?.leave} icon="plane" tone="blue" onClick={() => nav('/workers?status=__leave')} />
            <Stat label="Expired docs" value={<CountUp value={k.expired} />} trend={trend?.expired} icon="alert" tone="red" onClick={() => nav('/alerts?sev=critical')} />
          </div>}
        </section>
        <Tabs tabs={tabIds.map((id) => ({ id, label: labels[id], badge: id === 'requests' ? actionN : id === 'expiries' ? expiringN : undefined }))} value={tab} onChange={setTab} />
        <div role="tabpanel" className="page dash-panel">
          {tab === 'overview' && <>
            <NextSteps counts={{ mine: mineN, ceo: ceoN, users: newUsers.length, expiring: k.expired + k.d30, noLang: canWrite ? k.noLang : 0 }}
              extra={<div className="nx-short small"><span className="muted">Shortcuts:</span>
                {canWrite && <button className="chip chip-gray" onClick={() => nav('/workers/new')}>➕ Add worker</button>}
                <button className="chip chip-gray" onClick={() => nav('/requests/new')}>📝 New request</button>
                <button className="chip chip-gray" onClick={() => nav('/reports?r=expiry')}>📄 Expiry report</button>
                <button className="chip chip-gray" onClick={() => nav('/reports?r=tickets')}>✈️ Flight tickets</button>
                <button className="chip chip-gray" onClick={() => nav('/reports?r=passport')}>🛂 Passport register</button></div>} />
            <Priorities alerts={alerts} workers={workers} outlets={outlets} extra={NO_EXTRA} />
          </>}
          {tab === 'expiries' && <>
            <div className="stats stats-4">
              <Stat label="Expired docs" value={k.expired} icon="alert" tone="red" onClick={() => nav('/alerts?sev=critical')} />
              <Stat label="Expiring ≤ 30 days" value={k.d30} icon="cal" tone="orange" onClick={() => nav('/alerts')} />
              <Stat label="Expiring ≤ 60 days" value={k.d60} icon="cal" tone="amber" onClick={() => nav('/alerts')} />
              <Stat label="Expiring ≤ 90 days" value={k.d90} icon="cal" tone="yellow" onClick={() => nav('/alerts')} />
            </div>
            <Card title="Needs attention" actions={<Link to="/alerts" className="link">All alerts →</Link>}>
              {urgent.length === 0 ? <p className="muted">Nothing urgent 🎉</p> : (
                <ul className="alist">
                  {urgent.map((a) => (
                    <li key={a.id}>
                      <Link to={`/workers/${a.workerId}`}>
                        <Chip tone={sevTone(a.severity)}>{a.days !== null ? (a.days < 0 ? `${-a.days}d late` : `${a.days}d`) : a.severity}</Chip>
                        <span className="al-t"><strong>{a.title}</strong><small>{a.workerName} · {a.workerNo}</small></span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <ExpiryTimeline alerts={alerts} />
            <Card title="Upcoming document expiries (12 months)">
              <ColumnChart data={k.months} />
              <div className="legend"><span><i className="tone-red" />Permit</span><span><i className="tone-amber" />Passport</span><span><i className="tone-teal" />Others</span></div>
            </Card>
          </>}
          {tab === 'requests' && <>
            <WorkflowPanel workers={workers} />
            <div className="quick small-q">
              <button onClick={() => nav('/requests/new')}><span>📝</span>New request</button>
              <button onClick={() => nav('/requests?tab=mine_action')}><span>✅</span>My decisions</button>
              {isSuper ? <button onClick={() => nav('/ceo-review')}><span>🔒</span>CEO review</button> : <button onClick={() => nav('/requests')}><span>📋</span>All requests</button>}
            </div>
          </>}
          {tab === 'pay' && canSeeSalary && <>
            <div className="stats stats-4">
              <Stat label="Monthly basic payroll" value={rm0(k.payroll)} icon="money" tone="teal" onClick={() => nav('/reports?r=payroll')} />
              <Stat label="Outstanding loans" value={rm0(k.loans)} icon="money" tone="pink" onClick={() => nav('/reports?r=loans')} />
              <Stat label="Flight ticket eligible" value={k.tickets} icon="plane" tone="purple" onClick={() => nav('/reports?r=tickets')} />
              <Stat label="On leave" value={k.leave} icon="plane" tone="blue" onClick={() => nav('/workers?status=__leave')} />
            </div>
            <div className="quick small-q">
              <button onClick={() => nav('/reports?r=payroll')}><span>💵</span>Payroll</button>
              <button onClick={() => nav('/reports?r=loans')}><span>🏦</span>Loans</button>
              <button onClick={() => nav('/reports?r=tickets')}><span>✈️</span>Flight tickets</button>
              <button onClick={() => nav('/reports?r=leave')}><span>🏖️</span>Leave balances</button>
              <button onClick={() => nav('/settings/pay')}><span>⚖️</span>Pay rules</button>
              <button onClick={() => nav('/alerts')}><span>🔔</span>Pay alerts</button>
            </div>
          </>}
          {tab === 'risk' && <>
            <HealthCard workers={workers} alerts={alerts} outlets={outlets} />
            {canWrite && <OutletRiskCard />}
            <LatestChecks workers={workers} />
          </>}
          {tab === 'workforce' && <>
            <div className="stats stats-4">
              <Stat label="Total workers" value={k.total} icon="users" onClick={() => nav('/workers')} />
              <Stat label="Active / working" value={k.active} icon="check" tone="green" onClick={() => nav('/workers?status=Active-Working')} />
              <Stat label="On leave" value={k.leave} icon="plane" tone="blue" onClick={() => nav('/workers?status=__leave')} />
              <Stat label="Flight ticket eligible" value={k.tickets} icon="plane" tone="purple" onClick={() => nav('/reports?r=tickets')} />
            </div>
            <StatusGlance workers={workers} />
            <div className="grid2">
              <Card title="By status"><BarList data={k.byStatus} onClick={(l) => nav(`/workers?status=${encodeURIComponent(l)}`)} /></Card>
              <Card title="By nationality"><BarList data={k.byNat} onClick={(l) => nav(`/workers?nat=${encodeURIComponent(l)}`)} /></Card>
              <Card title="By outlet"><BarList data={k.byOutlet} /></Card>
              <Card title="By business type"><BarList data={k.byType} /></Card>
            </div>
            <TipCard />
          </>}
        </div>
        <p className="muted small center">Data syncs to the company cloud and stays available offline on this device. Today: {fmtDate(todayISO())}</p>
      </div>
    )
}

/** v1.2.2: outlet risk score (HR / management dashboard; outlet managers have their own dashboard) */
function OutletRiskCard() {
  const risks = useOutletRisks()
  const nav = useNavigate()
  if (!risks.length) return null
  const hi = risks.filter((r) => r.level === 'High').length, med = risks.filter((r) => r.level === 'Medium').length
  return (
    <Card title="Outlet risk" actions={<Btn small onClick={() => nav('/compliance?tab=risk')}>Details</Btn>}>
      <p className="small muted" style={{ marginTop: 0 }}>{hi ? <Chip tone="red">{hi} high</Chip> : null} {med ? <Chip tone="amber">{med} medium</Chip> : null} {!hi && !med ? <Chip tone="green">All low</Chip> : null} Combines passports held, late pay, overtime, deductions, hostel, complaints and expiring documents.</p>
      <RiskTable limit={5} />
    </Card>
  )
}

/** CEO: "Show sample & demo data" switch (SAMPLE and DEMO companies are left out of totals, alerts and reports by default) */
function DemoChip() {
  const on = useShowDemo()
  return (
    <label className={`demo-chip${on ? ' on' : ''}`} title="SAMPLE and DEMO companies (sample data and the app-review demo) are left out of totals, alerts and reports unless this is on">
      <input type="checkbox" checked={on} onChange={(e) => setShowDemo(e.target.checked)} /> Show sample &amp; demo data
    </label>
  )
}
