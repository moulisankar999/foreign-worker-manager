import { Link } from 'react-router-dom'
import { Card } from '../components/ui'
import { Icon } from '../components/Icon'
import { useAuth } from '../lib/auth'
import { SignOutRow } from '../components/userMenu'
import { useCeoBadge } from './CeoReview'
import { useControlBadge } from './Control'
import { qRank } from '../lib/quota'
import { useAiStatus } from '../lib/ai'
import { useAiSwitchOn } from '../lib/config'

export default function More() {
  const { canWrite, isSuper, isGm, isHr, isOM, role, session } = useAuth()
  const [ai] = useAiStatus(session?.user.id)
  const aiOff = !useAiSwitchOn() || !!ai?.off
  const ceoN = useCeoBadge()
  const ctlN = useControlBadge()
  const items: [string, string, string, string][] = [
    ...(!aiOff && (isSuper || ai?.enabled) ? [['/assistant', 'spark', 'Assistant', ai?.enabled ? 'Ask about workers, expiries, quota, requests and the app' : 'Not switched on yet'] as [string, string, string, string]] : []),
    ...(isSuper ? [['/ceo-review', 'lock', `CEO review${ceoN ? ` (${ceoN})` : ''}`, 'GM decisions & rejections — overrule, recall, mark reviewed'] as [string, string, string, string]] : []),
    ...(isSuper ? [['/permit-compliance', 'shield', 'Permit compliance', 'Workers at an outlet of a different company than their KDN / permit — move plan & fix list'] as [string, string, string, string]] : []),
    ...(isSuper ? [['/control', 'shield', `Software Control${ctlN ? ` (${ctlN})` : ''}`, 'Health monitor, app errors, system map & renewals'] as [string, string, string, string]] : []),
    ...(qRank(role) > 0 ? [['/requests', 'check', 'Requests', 'Leave, passport, transfer and other requests — raise or decide'] as [string, string, string, string]] : []),
    ['/documents', 'doc', 'Document library', 'All scanned documents & expiries'],
    ...(isHr ? [['/birthdays', 'cake', 'Birthdays', 'Send a wish or call'] as [string, string, string, string]] : []),
    ['/reports', 'chart', 'Reports', 'Headcount, leave, emergency leave, passport register'],
    ...(canWrite && !isOM ? [['/compliance', 'shield', 'Compliance', 'Outlet risk, hostels, hiring, complaints, PDPA'] as [string, string, string, string]] : []),
    ...(qRank(role) > 0 ? [['/quota', 'plane', 'Approval & Recruitment', 'Quota balance, approvals, recruits, Check Out Memos (COM), runaways, claims'] as [string, string, string, string]] : []),
    ['/inbox', 'bell', 'Notifications', 'Request updates'],
    ['/help', 'help', 'Help', 'My role, FAQ and the user manual (PDF)'],
    ['/settings', 'gear', 'Settings', isSuper || isGm ? 'Users, approval rules, notifications…' : 'Account & app'],
  ]
  void canWrite
  return (
    <div className="page narrow">
      <h1>More</h1>
      <Card><ul className="rows more-rows">{items.map(([to, ic, l, d]) => <li key={to}><Link to={to} className="req-link"><span className="req-ic"><Icon name={ic} /></span><div className="r-main"><strong>{l}</strong><small>{d}</small></div></Link></li>)}</ul></Card>
      <SignOutRow />
    </div>
  )
}
