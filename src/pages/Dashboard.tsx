import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BarList, Btn, Card, Chip, ColumnChart, Empty, Stat, sevTone } from '../components/ui'
import { currentBasic, isExited, isOnLeave, outletName, outstanding, ticketInfo } from '../lib/calc'
import { useAlerts, useOutlets, useSettings, useWorkersLoaded } from '../lib/hooks'
import { loadSampleData } from '../lib/sample'
import { OmDashboard, WorkflowPanel } from '../components/dashExtras'
import { PendingUsersPanel } from '../components/userApprovals'
import { useAuth } from '../lib/auth'
import { missingLanguage } from '../lib/languages'
import { fmtDate, fmtMonth, rm0, todayISO } from '../lib/util'
import { ExpiryTimeline, Greeting, HealthCard, LatestChecks, Priorities, StatusGlance, TipCard, type Extra } from '../components/advice'
import { useCeoBadge } from './CeoReview'
import { useRequests } from '../lib/requests'
import { needsMyAction } from '../lib/workflow'
import { usePendingUsers } from '../lib/userApprovals'
import { RiskTable } from './Compliance'
import { useOutletRisks } from '../lib/risk'

export default function Dashboard() {
  const loaded = useWorkersLoaded()
  const workers = loaded ?? []
  const outlets = useOutlets()
  const s = useSettings()
  const alerts = useAlerts()
  const nav = useNavigate()
  const [busy, setBusy] = useState(false)
  const { isOM, canWrite, canSeeSalary, isSuper, role, session, can, route } = useAuth()
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

  if (isOM) return <OmDashboard workers={workers} alerts={alerts} extra={extra} />
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

  const urgent = alerts.filter((a) => a.severity === 'critical' || a.severity === 'high').slice(0, 8)
  return (
    <div className="page">
      <div className="page-h">
        <Greeting sub={`${k.total} current workers${k.exited ? ` · ${k.exited} exited` : ''}`} />
        <div className="row gap-s wrap">
          {canWrite && <Btn kind="primary" icon="plus" onClick={() => nav('/workers/new')}>Add worker</Btn>}
        </div>
      </div>
      <div className="dash-top">
        <Priorities alerts={alerts} workers={workers} outlets={outlets} extra={extra} />
        <HealthCard workers={workers} alerts={alerts} outlets={outlets} />
      </div>
      <div className="dash-3">
        <StatusGlance workers={workers} />
        <ExpiryTimeline alerts={alerts} />
        <TipCard />
      </div>
      {canWrite && <OutletRiskCard />}
      <WorkflowPanel workers={workers} />
      <LatestChecks workers={workers} />

      <div className="stats">
        <Stat label="Total workers" value={k.total} icon="users" onClick={() => nav('/workers')} />
        <Stat label="Active / working" value={k.active} icon="check" tone="green" onClick={() => nav('/workers?status=Active-Working')} />
        <Stat label="On leave" value={k.leave} icon="plane" tone="blue" onClick={() => nav('/workers?status=__leave')} />
        <Stat label="Expired docs" value={k.expired} icon="alert" tone="red" onClick={() => nav('/alerts?sev=critical')} />
        <Stat label="Expiring ≤ 30 days" value={k.d30} icon="cal" tone="orange" onClick={() => nav('/alerts')} />
        <Stat label="Expiring ≤ 60 days" value={k.d60} icon="cal" tone="amber" onClick={() => nav('/alerts')} />
        <Stat label="Expiring ≤ 90 days" value={k.d90} icon="cal" tone="yellow" onClick={() => nav('/alerts')} />
        <Stat label="Flight ticket eligible" value={k.tickets} icon="plane" tone="purple" onClick={() => nav('/reports?r=tickets')} />
        {canSeeSalary && <Stat label="Outstanding loans" value={rm0(k.loans)} icon="money" tone="pink" onClick={() => nav('/reports?r=loans')} />}
        {canSeeSalary && <Stat label="Monthly basic payroll" value={rm0(k.payroll)} icon="money" tone="teal" onClick={() => nav('/reports?r=payroll')} />}
      </div>

      {canWrite && k.noLang > 0 && (
        <div className="banner amber small datagap" role="status">
          <span>🗣️ <strong>Data gap:</strong> {k.noLang} current worker{k.noLang === 1 ? ' has' : 's have'} no primary language yet. It is needed for the passport consent form in the worker's own language.</span>
          <span><Btn small onClick={() => nav('/workers?gap=lang&status=__current')}>Review {k.noLang === 1 ? 'worker' : 'workers'}</Btn></span>
        </div>
      )}

      <div className="quick">
        {canWrite && <button onClick={() => nav('/workers/new')}><span>➕</span>Add worker</button>}
        <button onClick={() => nav('/requests/new')}><span>📝</span>New request</button>
        <button onClick={() => nav('/alerts')}><span>🔔</span>Alerts</button>
        <button onClick={() => nav('/reports?r=expiry')}><span>📄</span>Expiry report</button>
        <button onClick={() => nav('/reports?r=leave')}><span>🏖️</span>Leave balances</button>
        <button onClick={() => nav('/reports?r=tickets')}><span>✈️</span>Flight tickets</button>
        <button onClick={() => nav('/reports?r=passport')}><span>🛂</span>Passport register</button>
      </div>

      <div className="grid2">
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
        <Card title="Upcoming document expiries (12 months)">
          <ColumnChart data={k.months} />
          <div className="legend"><span><i className="tone-red" />Permit</span><span><i className="tone-amber" />Passport</span><span><i className="tone-teal" />Others</span></div>
        </Card>
        <Card title="By nationality"><BarList data={k.byNat} onClick={(l) => nav(`/workers?nat=${encodeURIComponent(l)}`)} /></Card>
        <Card title="By business type"><BarList data={k.byType} /></Card>
        <Card title="By outlet"><BarList data={k.byOutlet} /></Card>
        <Card title="By status"><BarList data={k.byStatus} onClick={(l) => nav(`/workers?status=${encodeURIComponent(l)}`)} /></Card>
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
