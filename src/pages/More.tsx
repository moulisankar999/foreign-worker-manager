import { Link } from 'react-router-dom'
import { Card } from '../components/ui'
import { Icon } from '../components/Icon'
import { useAuth } from '../lib/auth'
import { SignOutRow } from '../components/userMenu'
import { useCeoBadge } from './CeoReview'

export default function More() {
  const { canWrite, isSuper, isGm, isHr } = useAuth()
  const ceoN = useCeoBadge()
  const items: [string, string, string, string][] = [
    ...(isSuper ? [['/ceo-review', 'lock', `CEO review${ceoN ? ` (${ceoN})` : ''}`, 'GM decisions & rejections — overrule, recall, mark reviewed'] as [string, string, string, string]] : []),
    ['/documents', 'doc', 'Document library', 'All scanned documents & expiries'],
    ['/alerts', 'bell', 'Alerts', 'Expiries, overdue passports, proof pending'],
    ['/reports', 'chart', 'Reports', 'Headcount, leave, emergency leave, passport register'],
    ['/inbox', 'bell', 'Notifications', 'Request updates'],
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
