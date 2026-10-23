import { Toaster } from './components/toast'
import { useEffect, useState } from 'react'
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Icon } from './components/Icon'
import { useAlerts, useOutlets, useSettings, useWorkers } from './lib/hooks'
import { headerLogo } from './lib/logos'
import { useConfig } from './lib/config'
import { LogoImg } from './components/logos'
import { isNative } from './lib/platform'
import { rescheduleSoon } from './lib/localNotify'
import { notifyOnOpen } from './lib/notify'
import Dashboard from './pages/Dashboard'
import Workers from './pages/Workers'
import WorkerDetail from './pages/WorkerDetail'
import WorkerForm from './pages/WorkerForm'
import Alerts from './pages/Alerts'
import Reports from './pages/Reports'
import SettingsPage from './pages/Settings'
import MemoPrint from './pages/MemoPrint'
import Login, { Pending } from './pages/Login'
import SetPasswordScreen, { RECOVERY_FLAG } from './pages/SetPassword'
import { useAuth } from './lib/auth'
import { LocalDataBanner, SyncPill } from './components/cloud'
import RequestsPage, { NewRequest, RequestDetail } from './pages/Requests'
import Inbox from './pages/Inbox'
import More from './pages/More'
import { DocumentLibrary } from './components/vault'
import { useInbox } from './lib/inbox'
import { useRequests } from './lib/requests'
import { needsMyAction } from './lib/workflow'
import { usePendingUsers } from './lib/userApprovals'
import { IS_TEST_BUILD } from './lib/supabase'
import { UserMenu } from './components/userMenu'
import CeoReviewPage, { useCeoBadge } from './pages/CeoReview'

const NAV = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/workers', label: 'Workers', icon: 'users' },
  { to: '/requests', label: 'Requests', icon: 'check' },
  { to: '/documents', label: 'Documents', icon: 'doc', desk: true },
  { to: '/alerts', label: 'Alerts', icon: 'alert' },
  { to: '/reports', label: 'Reports', icon: 'chart', desk: true },
  { to: '/ceo-review', label: 'CEO review', icon: 'lock', desk: true, ceo: true },
  { to: '/settings', label: 'Settings', icon: 'gear', desk: true },
  { to: '/more', label: 'More', icon: 'more', mobile: true },
]

export default function App() {
  const { session, profile, loading } = useAuth()
  if (loading) return <div className="auth-wrap"><p className="muted">Loading…</p></div>
  if (!session) return <Login />
  if (sessionStorage.getItem(RECOVERY_FLAG)) return <SetPasswordScreen mode="recovery" />
  if (!profile || profile.status !== 'active' || profile.id !== session.user.id) return <Pending />
  if (profile.must_change_password) return <SetPasswordScreen mode="forced" />
  return <MainApp />
}

function MainApp() {
  const { canWrite, role, session, myCompanies, myOutlets, can, route, isSuper } = useAuth()
  const ceoBadge = useCeoBadge()
  const allOutlets = useOutlets()
  useConfig() // re-render when a company logo changes
  const myLogo = headerLogo(role, myCompanies, myOutlets, allOutlets)
  const inbox = useInbox()
  const { rows: reqs } = useRequests()
  const myReq = reqs.filter((r) => needsMyAction(r, role || '', session?.user.id || '', { can, route })).length
  const { pending: newUsers } = usePendingUsers()
  const badge = (to: string) => (to === '/alerts' ? urgent : to === '/requests' ? myReq : to === '/ceo-review' ? ceoBadge : to === '/' || to === '/settings' || to === '/more' ? newUsers.length : 0)
  const alerts = useAlerts()
  const settings = useSettings()
  const urgent = alerts.filter((a) => a.severity === 'critical' || a.severity === 'high').length
  const nav = useNavigate()
  const loc = useLocation()
  const [q, setQ] = useState('')

  const workers = useWorkers()
  useEffect(() => { if (!isNative() && alerts.length) notifyOnOpen(alerts) }, [alerts])
  // Android/iOS app: re-plan the on-phone 8 AM reminders whenever data changes (after every sync)
  useEffect(() => { if (isNative()) rescheduleSoon(workers, settings) }, [workers, settings])
  useEffect(() => { window.scrollTo(0, 0) }, [loc.pathname])

  if (loc.pathname.startsWith('/print/')) return <Routes><Route path="/print/memo/:wid/:mid" element={<MemoPrint />} /></Routes>

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          {myLogo ? <LogoImg path={myLogo} size={34} /> : <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={34} height={34} />}
          <div>
            <strong>FW Manager</strong>
            <small>{settings.companyName}</small>
          </div>
        </div>
        <nav aria-label="Main">
          {NAV.filter((n) => !n.mobile && (!n.ceo || isSuper)).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'on' : '')}>
              <Icon name={n.icon} />
              <span>{n.label === 'Home' ? 'Dashboard' : n.label}</span>
              {badge(n.to) > 0 && <span className="badge">{badge(n.to)}</span>}
            </NavLink>
          ))}
        </nav>
        {canWrite && <button className="btn btn-primary side-add" onClick={() => nav('/workers/new')}><Icon name="plus" /> Add worker</button>}
      </aside>
      <div className="main">
        <header className="top">
          {myLogo && <span className="top-logo"><LogoImg path={myLogo} size={32} fallback={false} /></span>}
          <form className="gsearch" role="search" onSubmit={(e) => { e.preventDefault(); nav(`/workers?q=${encodeURIComponent(q)}`) }}>
            <Icon name="search" size={18} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, ID, passport, permit no…" aria-label="Global search" />
          </form>
          <SyncPill />
          <NavLink to="/inbox" className="top-bell" aria-label={`Notifications (${inbox.unread} unread)`}>
            <Icon name="bell" />
            {inbox.unread > 0 && <span className="badge">{inbox.unread}</span>}
          </NavLink>
          <UserMenu />
        </header>
        <main className="content">
          {IS_TEST_BUILD && <p className="banner small warn" style={{ marginBottom: 12 }}>TEST BUILD — connected to the test project, not live data.</p>}
          {role === 'viewer' && <p className="banner small" style={{ marginBottom: 12 }}>You have <strong>view-only</strong> access. Ask your CEO for more access to add or edit.</p>}
          {loc.pathname === '/' && <div style={{ marginBottom: 12 }}><LocalDataBanner compact /></div>}
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/workers" element={<Workers />} />
            <Route path="/workers/new" element={<WorkerForm />} />
            <Route path="/workers/:id" element={<WorkerDetail />} />
            <Route path="/workers/:id/edit" element={<WorkerForm />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/:tab" element={<SettingsPage />} />
            <Route path="/requests" element={<RequestsPage />} />
            <Route path="/requests/new" element={<NewRequest />} />
            <Route path="/requests/:id" element={<RequestDetail />} />
            <Route path="/ceo-review" element={<CeoReviewPage />} />
            <Route path="/documents" element={<DocumentLibrary />} />
            <Route path="/inbox" element={<Inbox />} />
            <Route path="/more" element={<More />} />
            <Route path="*" element={<Dashboard />} />
          </Routes>
        </main>
        <Toaster />
      </div>
      <nav className="bottom" aria-label="Main mobile">
        {NAV.filter((n) => !n.desk).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'on' : '')}>
            <span className="bi">
              <Icon name={n.icon} size={22} />
              {badge(n.to) > 0 && <span className="badge">{badge(n.to)}</span>}
            </span>
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
