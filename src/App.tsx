import { AttachViewer } from './components/attach'
import { Toaster } from './components/toast'
import { useEffect, useState } from 'react'
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Icon } from './components/Icon'
import { Skeleton } from './components/ui'
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
import Birthdays from './pages/Birthdays'
import Reports from './pages/Reports'
import SettingsPage from './pages/Settings'
import CompanyDetailPage from './pages/CompanyDetail'
import MemoPrint from './pages/MemoPrint'
import PayslipPrint from './pages/PayslipPrint'
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
import CompliancePage from './pages/Compliance'
import GrievancePublic from './pages/GrievancePublic'
import ControlPage, { useControlBadge } from './pages/Control'
import HelpPage from './pages/Help'
import QuotaPage from './pages/quota/QuotaPage'
import { qRank } from './lib/quota'
import Assistant from './pages/Assistant'
import { useAiStatus } from './lib/ai'
import { useAiSwitchOn } from './lib/config'
import { Tour } from './components/tour'
import { CommandPalette, openPalette, recordVisit } from './components/commandPalette'

const NAV = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/assistant', label: 'Assistant', icon: 'spark', desk: true, ai: true },
  { to: '/workers', label: 'Workers', icon: 'users' },
  { to: '/requests', label: 'Requests', icon: 'check' },
  { to: '/documents', label: 'Documents', icon: 'doc', desk: true },
  { to: '/alerts', label: 'Alerts', icon: 'alert' },
  { to: '/birthdays', label: 'Birthdays', icon: 'cake', desk: true, bday: true },
  { to: '/reports', label: 'Reports', icon: 'chart', desk: true },
  { to: '/compliance', label: 'Compliance', icon: 'shield', desk: true, hr: true },
  { to: '/quota', label: 'Approval & Recruitment', icon: 'plane', desk: true, quota: true },
  { to: '/ceo-review', label: 'CEO review', icon: 'lock', desk: true, ceo: true },
  { to: '/control', label: 'Software Control', icon: 'shield', desk: true, ceo: true },
  { to: '/settings', label: 'Settings', icon: 'gear', desk: true },
  { to: '/help', label: 'Help', icon: 'help', desk: true },
  { to: '/more', label: 'More', icon: 'more', mobile: true },
]
const RAIL_KEY = 'fwm-rail'
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

export default function App() {
  const { session, profile, loading } = useAuth()
  const gm = /^#\/grievance\/([A-Za-z0-9]{8,64})\/?$/.exec(window.location.hash)
  if (gm) return <GrievancePublic token={gm[1]} />
  if (loading) return <div className="auth-wrap"><Skeleton /></div>
  if (!session) return <Login />
  if (sessionStorage.getItem(RECOVERY_FLAG)) return <SetPasswordScreen mode="recovery" />
  if (!profile || profile.status !== 'active' || profile.id !== session.user.id) return <Pending />
  if (profile.must_change_password) return <SetPasswordScreen mode="forced" />
  return <MainApp />
}

function MainApp() {
  const { canWrite, role, session, myCompanies, myOutlets, can, route, isSuper, isOM, isHr } = useAuth()
  const ceoBadge = useCeoBadge()
  const ctlBadge = useControlBadge()
  const [aiSt] = useAiStatus(session?.user.id)
  // 1.6.1: the CEO's switch hides the Assistant for everyone, the CEO included (it lives in Settings → AI Assistant)
  const aiOff = !useAiSwitchOn() || !!aiSt?.off
  const aiOn = aiSt?.enabled && !aiOff
  const allOutlets = useOutlets()
  useConfig() // re-render when a company logo changes
  const myLogo = headerLogo(role, myCompanies, myOutlets, allOutlets)
  const inbox = useInbox()
  const { rows: reqs } = useRequests()
  const myReq = reqs.filter((r) => needsMyAction(r, role || '', session?.user.id || '', { can, route })).length
  const { pending: newUsers } = usePendingUsers()
  const badge = (to: string) => (to === '/alerts' ? urgent : to === '/requests' ? myReq : to === '/ceo-review' ? ceoBadge : to === '/control' ? ctlBadge : to === '/more' ? newUsers.length + ctlBadge : to === '/' || to === '/settings' ? newUsers.length : 0)
  const alerts = useAlerts()
  const settings = useSettings()
  const urgent = alerts.filter((a) => a.severity === 'critical' || a.severity === 'high').length
  const nav = useNavigate()
  const loc = useLocation()
  const [rail, setRail] = useState(() => { try { return localStorage.getItem(RAIL_KEY) === '1' } catch { return false } })
  const toggleRail = () => setRail((v) => { try { localStorage.setItem(RAIL_KEY, v ? '0' : '1') } catch { /* ignore */ } return !v })
  // phone: the large page title collapses into the bar once it scrolls away (iOS style)
  const [mini, setMini] = useState('')
  useEffect(() => {
    const f = () => { const h = document.querySelector<HTMLElement>('.content h1'); const top = document.querySelector('header.top')?.getBoundingClientRect().bottom ?? 56; setMini(h && h.getBoundingClientRect().bottom < top ? (h.textContent || '').replace(/[👋]/gu, '').trim() : '') }
    f(); window.addEventListener('scroll', f, { passive: true })
    // remember this page for "Recent" / "Likely next" in the palette, and show where you are (breadcrumb)
    const t = setTimeout(() => {
      const h = (document.querySelector<HTMLElement>('.content h1')?.textContent || '').replace(/[👋]/gu, '').trim()
      setCrumb(h)
      recordVisit(session?.user.id, loc.pathname + loc.search, h)
    }, 900)
    return () => { window.removeEventListener('scroll', f); clearTimeout(t) }
  }, [loc.pathname, loc.search, session?.user.id])
  const [crumb, setCrumb] = useState('')
  const section = NAV.find((n) => n.to !== '/' && loc.pathname.startsWith(n.to)) || (loc.pathname.startsWith('/companies') ? { to: '/settings/org', label: 'Settings' } : null)
  const aiShow = !aiOff && (isSuper || !!aiOn) && !loc.pathname.startsWith('/assistant')
  const askAi = () => nav(`/assistant?q=${encodeURIComponent(crumb ? `About "${crumb}"${section && section.label !== crumb ? ` (${section.label})` : ''}: what needs my attention, and what should I do next?` : 'What needs my attention today?')}`)

  const quotaOn = qRank(role) > 0
  const visible = NAV.filter((n) => !n.mobile && (!n.ceo || isSuper) && (!n.hr || (canWrite && !isOM)) && (!n.quota || quotaOn) && (!n.ai || (!aiOff && (isSuper || !!aiOn))) && (!n.bday || isHr))
  // phone tab bar: Home, Workers, Approval & Recruitment (or Requests), Alerts, More
  const TABS = [NAV[0], NAV[2], quotaOn ? NAV.find((n) => n.to === '/quota')! : NAV[3], NAV.find((n) => n.to === '/alerts')!, NAV[NAV.length - 1]]
  const tabBadge = (to: string) => badge(to) + (to === '/more' && quotaOn ? myReq : 0)
  const workers = useWorkers()
  useEffect(() => { if (!isNative() && alerts.length) notifyOnOpen(alerts) }, [alerts])
  // Android/iOS app: re-plan the on-phone 8 AM reminders whenever data changes (after every sync)
  useEffect(() => { if (isNative()) rescheduleSoon(workers, settings) }, [workers, settings])
  useEffect(() => { window.scrollTo(0, 0) }, [loc.pathname])

  if (loc.pathname.startsWith('/print/')) return <Routes><Route path="/print/memo/:wid/:mid" element={<MemoPrint />} /><Route path="/print/payslip/:wid/:pid" element={<PayslipPrint />} /></Routes>

  return (
    <div className="shell">
      <Tour />
      <CommandPalette pages={visible.map((n) => ({ to: n.to, label: n.label === 'Home' ? 'Dashboard' : n.label, icon: n.icon })).concat([{ to: '/inbox', label: 'Notifications', icon: 'bell' }])} />
      <aside className={'side' + (rail ? ' is-rail' : '')} aria-label="Navigation">
        <div className="brand">
          {myLogo ? <LogoImg path={myLogo} size={34} /> : <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={34} height={34} />}
          <div>
            <strong>FW Manager</strong>
            <small>{settings.companyName}</small>
          </div>
          <button type="button" className="rail-btn" onClick={toggleRail} aria-label={rail ? 'Expand navigation' : 'Collapse navigation'} aria-expanded={!rail} title={rail ? 'Expand navigation' : 'Collapse navigation'}><Icon name="menu" size={18} /></button>
        </div>
        <nav aria-label="Main">
          {visible.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} title={rail ? (n.label === 'Home' ? 'Dashboard' : n.label) : undefined} className={({ isActive }) => (isActive || (n.to === '/' && loc.pathname.startsWith('/dashboard')) ? 'on' : '')}>
              <Icon name={n.icon} />
              <span>{n.label === 'Home' ? 'Dashboard' : n.label}</span>
              {badge(n.to) > 0 && <span className="badge">{badge(n.to)}</span>}
            </NavLink>
          ))}
        </nav>
        {canWrite && <button className="btn btn-primary side-add" onClick={() => nav('/workers/new')} title="Add worker"><Icon name="plus" /> <span>Add worker</span></button>}
      </aside>
      <div className={'main' + (rail ? ' with-rail' : '')}>
        <header className="top">
          {myLogo && <span className="top-logo"><LogoImg path={myLogo} size={32} fallback={false} /></span>}
          <span className={'top-title' + (mini ? ' on' : '')} aria-hidden={!mini}>{mini}</span>
          <nav className="crumb" aria-label="You are here">
            <NavLink to="/">Home</NavLink>
            {section && <><Icon name="chevr" size={12} />{crumb && crumb !== section.label ? <NavLink to={section.to}>{section.label}</NavLink> : <b>{section.label}</b>}</>}
            {section && crumb && crumb !== section.label && <><Icon name="chevr" size={12} /><b>{crumb}</b></>}
          </nav>
          <button type="button" className="gsearch" onClick={openPalette} aria-label="Search and jump (Ctrl+K)" aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}>
            <Icon name="search" size={18} />
            <span className="gs-ph">Search or jump to…</span>
            <kbd className="gs-k">{isMac ? '⌘' : 'Ctrl'} K</kbd>
          </button>
          {aiShow && <button type="button" className="btn btn-secondary btn-s ask-ai" onClick={askAi} title="Ask the Assistant about this page — it drafts, you decide"><Icon name="spark" size={16} /><span>Ask Assistant</span></button>}
          <SyncPill />
          <NavLink to="/inbox" className="top-bell" aria-label={`Notifications (${inbox.unread} unread)`}>
            <Icon name="bell" />
            {inbox.unread > 0 && <span className="badge">{inbox.unread}</span>}
          </NavLink>
          <UserMenu />
        </header>
        <main className="content">
          {IS_TEST_BUILD && <p className="banner small warn" style={{ marginBottom: 12 }}>TEST BUILD — connected to the test project, not live data.</p>}
          {role === 'viewer' && <p className="banner small" style={{ marginBottom: 12 }}>You have <strong>view-only</strong> access for looking things up and printing reports.</p>}
          {(loc.pathname === '/' || loc.pathname.startsWith('/dashboard')) && <div style={{ marginBottom: 12 }}><LocalDataBanner compact /></div>}
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/dashboard/:tab" element={<Dashboard />} />
            <Route path="/workers" element={<Workers />} />
            <Route path="/workers/new" element={<WorkerForm />} />
            <Route path="/workers/:id" element={<WorkerDetail />} />
            <Route path="/workers/:id/edit" element={<WorkerForm />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/birthdays" element={<Birthdays />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/:tab" element={<SettingsPage />} />
            <Route path="/companies/:id" element={<CompanyDetailPage />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="/help/:tab" element={<HelpPage />} />
            <Route path="/requests" element={<RequestsPage />} />
            <Route path="/requests/new" element={<NewRequest />} />
            <Route path="/requests/:id" element={<RequestDetail />} />
            <Route path="/ceo-review" element={<CeoReviewPage />} />
            <Route path="/compliance" element={<CompliancePage />} />
            {qRank(role) > 0 && <Route path="/quota" element={<QuotaPage />} />}
            {qRank(role) > 0 && <Route path="/quota/recruit/:id" element={<QuotaPage />} />}
            {isSuper && <Route path="/control" element={<ControlPage />} />}
            {isSuper && <Route path="/control/:tab" element={<ControlPage />} />}
            <Route path="/documents" element={<DocumentLibrary />} />
            <Route path="/inbox" element={<Inbox />} />
            <Route path="/assistant" element={<Assistant />} />
            <Route path="/more" element={<More />} />
            <Route path="*" element={<Dashboard />} />
          </Routes>
        </main>
        <Toaster />
        <AttachViewer />
      </div>
      <nav className="bottom" aria-label="Main mobile">
        {TABS.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} aria-label={n.label} className={({ isActive }) => (isActive || (n.to === '/' && loc.pathname.startsWith('/dashboard')) || (n.to === '/more' && /^\/(more|requests|settings|help|reports|documents|compliance|ceo-review|control|inbox|assistant)/.test(loc.pathname) && !TABS.some((t) => t.to !== '/more' && t.to !== '/' && loc.pathname.startsWith(t.to))) ? 'on' : '')}>
            <span className="bi">
              <Icon name={n.icon} size={22} />
              {tabBadge(n.to) > 0 && <span className="badge">{tabBadge(n.to)}</span>}
            </span>
            <span className="bl">{n.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
