import { useEffect, useState } from 'react'
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Icon } from './components/Icon'
import { useAlerts, useSettings } from './lib/hooks'
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
import { useAuth } from './lib/auth'
import { LocalDataBanner, SyncPill } from './components/cloud'

const NAV = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/workers', label: 'Workers', icon: 'users' },
  { to: '/alerts', label: 'Alerts', icon: 'bell' },
  { to: '/reports', label: 'Reports', icon: 'chart' },
  { to: '/settings', label: 'Settings', icon: 'gear' },
]

export default function App() {
  const { session, profile, loading } = useAuth()
  if (loading) return <div className="auth-wrap"><p className="muted">Loading…</p></div>
  if (!session) return <Login />
  if (!profile || profile.status !== 'active' || profile.id !== session.user.id) return <Pending />
  return <MainApp />
}

function MainApp() {
  const { canWrite, profile } = useAuth()
  const alerts = useAlerts()
  const settings = useSettings()
  const urgent = alerts.filter((a) => a.severity === 'critical' || a.severity === 'high').length
  const nav = useNavigate()
  const loc = useLocation()
  const [q, setQ] = useState('')

  useEffect(() => { if (alerts.length) notifyOnOpen(alerts) }, [alerts])
  useEffect(() => { window.scrollTo(0, 0) }, [loc.pathname])

  if (loc.pathname.startsWith('/print/')) return <Routes><Route path="/print/memo/:wid/:mid" element={<MemoPrint />} /></Routes>

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={34} height={34} />
          <div>
            <strong>FW Manager</strong>
            <small>{settings.companyName}</small>
          </div>
        </div>
        <nav aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'on' : '')}>
              <Icon name={n.icon} />
              <span>{n.label === 'Home' ? 'Dashboard' : n.label}</span>
              {n.to === '/alerts' && urgent > 0 && <span className="badge">{urgent}</span>}
            </NavLink>
          ))}
        </nav>
        {canWrite && <button className="btn btn-primary side-add" onClick={() => nav('/workers/new')}><Icon name="plus" /> Add worker</button>}
      </aside>
      <div className="main">
        <header className="top">
          <form className="gsearch" role="search" onSubmit={(e) => { e.preventDefault(); nav(`/workers?q=${encodeURIComponent(q)}`) }}>
            <Icon name="search" size={18} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, ID, passport, permit no…" aria-label="Global search" />
          </form>
          <SyncPill />
          <NavLink to="/alerts" className="top-bell" aria-label={`Alerts (${urgent} urgent)`}>
            <Icon name="bell" />
            {urgent > 0 && <span className="badge">{urgent}</span>}
          </NavLink>
        </header>
        <main className="content">
          {profile?.role === 'viewer' && <p className="banner small" style={{ marginBottom: 12 }}>You have <strong>view-only</strong> access. Ask an Admin for Manager access to add or edit.</p>}
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
            <Route path="*" element={<Dashboard />} />
          </Routes>
        </main>
      </div>
      <nav className="bottom" aria-label="Main mobile">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'on' : '')}>
            <span className="bi">
              <Icon name={n.icon} size={22} />
              {n.to === '/alerts' && urgent > 0 && <span className="badge">{urgent}</span>}
            </span>
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
