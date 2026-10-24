import { Link } from 'react-router-dom'
import { Card } from '../components/ui'
import { Icon } from '../components/Icon'
import { useAuth } from '../lib/auth'
import { SignOutRow } from '../components/userMenu'
import { useCeoBadge } from './CeoReview'
import { useControlBadge } from './Control'

export default function More() {
  const { canWrite, isSuper, isGm, isHr, isOM } = useAuth()
  const ceoN = useCeoBadge()
  const ctlN = useControlBadge()
  const items: [string, string, string, string][] = [
    ...(isSuper ? [['/ceo-review', 'lock', `CEO review${ceoN ? ` (${ceoN})` : ''}`, 'GM decisions & rejections — overrule, recall, mark reviewed'] as [string, string, string, string]] : []),
    ...(isSuper ? [['/control', 'shield', `Software Control${ctlN ? ` (${ctlN})` : ''}`, 'Health monitor, app errors, system map & renewals'] as [string, string, string, string]] : []),
    ['/documents', 'doc', 'Document library', 'All scanned documents & expiries'],
    ['/alerts', 'bell', 'Alerts', 'Expiries, overdue passports, proof pending'],
    ['/reports', 'chart', 'Reports', 'Headcount, leave, emergency leave, passport register'],
    ...(canWrite && !isOM ? [['/compliance', 'shield', 'Compliance', 'Outlet risk, hostels, hiring, complaints, PDPA'] as [string, string, string, string]] : []),
    ['/inbox', 'bell', 'Notifications', 'Request updates'],
    ['/help', 'help', 'Help', 'My role, FAQ and the user manual (PDF)'],
    ['/settings', 'gear', 'Settings', isSuper || isGm ? 'Users, approval rules, notifications…' : 'Account & app'],
  ]
  void canWrite; void isHr
  return (
    <div className="page narrow">
      <h1>More</h1>
      <Card><ul className="rows">{items.map(([to, ic, l, d]) => <li key={to}><Link to={to} className="req-link"><span className="req-ic"><Icon name={ic} /></span><div className="r-main"><strong>{l}</strong><small>{d}</small></div></Link></li>)}</ul></Card>
      <SignOutRow />
    </div>
  )
}
