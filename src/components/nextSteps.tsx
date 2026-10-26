/* v1.6.0: the home "What to do next" guide. A short, role-shaped, start-to-finish list; each step says in plain words what to
 * do and opens the right page in one tap. Counts come only from data this person can already see on the dashboard. */
import { Link } from 'react-router-dom'
import { Card } from './ui'
import { Icon } from './Icon'
import { useAuth } from '../lib/auth'
import { qRank } from '../lib/quota'

export interface StepCounts { mine: number; ceo: number; users: number; expiring: number; noLang: number }
interface Step { id: string; title: string; tip: string; to: string; n: number | null; icon: string }

export function useNextSteps(c: StepCounts): Step[] {
  const { role, isSuper, isGm, isOM, canWrite } = useAuth()
  const q = qRank(role) > 0
  const docs: Step = { id: 'docs', icon: 'alert', title: 'Renew documents', n: c.expiring, to: '/alerts', tip: c.expiring ? 'Permits or passports have expired or are due within 30 days.' : 'Nothing expiring in the next 30 days.' }
  const reqs: Step = { id: 'req', icon: 'check', title: 'Decide requests', n: c.mine, to: '/requests?tab=mine_action', tip: c.mine ? 'Someone is waiting for your answer — approve, return or reject.' : 'No requests are waiting for you.' }
  const users: Step = { id: 'users', icon: 'users', title: 'Welcome new users', n: c.users, to: '/settings/users', tip: c.users ? 'Give each new person a role and the outlets they work at.' : 'Nobody is waiting to be let in.' }
  const quota: Step = { id: 'quota', icon: 'plane', title: 'Approval & Recruitment', n: null, to: '/quota?tab=overview', tip: 'Quota balance, recruits on the way and arrivals.' }
  const reports: Step = { id: 'rep', icon: 'chart', title: 'Share reports', n: null, to: '/reports', tip: 'Expiry list, flight tickets and passport register.' }
  if (isSuper) return [{ id: 'ceo', icon: 'lock', title: 'Review decisions', n: c.ceo, to: '/ceo-review', tip: c.ceo ? 'Keep, overrule or recall decisions made for you.' : 'You are up to date.' }, reqs, users, docs, ...(q ? [quota] : [reports])]
  if (isGm) return [reqs, users, docs, ...(q ? [quota] : []), reports]
  if (isOM) return [
    { id: 'new', icon: 'plus', title: 'Raise a request', n: null, to: '/requests/new', tip: 'Leave, MC, advance or passport — pick a type and send.' },
    { ...reqs, title: 'Follow my requests', to: '/requests', tip: c.mine ? 'Some requests need something from you.' : 'Track what you sent and see answers.' },
    { ...docs, title: "My workers' documents", tip: c.expiring ? 'Tell HR early about expiring permits or passports.' : 'All papers are in date.' },
  ]
  if (role === 'viewer') return [{ id: 'find', icon: 'search', title: 'Find a worker', n: null, to: '/workers', tip: 'Search by name, ID, passport or permit number.' }, docs, reports]
  // HR Admin / HR Manager: register → keep in date → requests → recruits → reports
  return [
    canWrite && c.noLang
      ? { id: 'gap', icon: 'users', title: 'Complete worker details', n: c.noLang, to: '/workers?gap=lang&status=__current', tip: 'Add the primary language — needed for consent forms in the worker’s own language.' }
      : { id: 'add', icon: 'users', title: canWrite ? 'Add new workers' : 'Check workers', n: canWrite ? 0 : null, to: canWrite ? '/workers/new' : '/workers', tip: 'Register each arrival so nothing is missed.' },
    docs, reqs, ...(c.users ? [users] : []), ...(q ? [{ ...quota, title: 'Move recruits forward', to: '/quota?tab=pipeline', tip: 'Follow each recruit from approval letter to arrival.' }] : []), reports,
  ]
}

export function NextSteps({ counts, extra }: { counts: StepCounts; extra?: React.ReactNode }) {
  const steps = useNextSteps(counts)
  const firstTodo = steps.find((s) => !!s.n)?.id
  const clear = steps.filter((s) => s.n === 0).length, counted = steps.filter((s) => s.n !== null).length
  return (
    <Card className="nx-card">
      <div className="nx-h">
        <h3><Icon name="spark" size={18} /> What to do next</h3>
        {counted > 0 && <span className="row gap-s small muted" title={`${clear} of ${counted} clear`}>{clear} of {counted} clear <span className="nx-prog" aria-hidden="true"><i style={{ width: `${(clear / counted) * 100}%` }} /></span></span>}
      </div>
      <ol className="nx" aria-label="What to do next">
        {steps.map((s, i) => (
          <li key={s.id} className={s.n === 0 ? 'nx-done' : s.id === firstTodo ? 'nx-first' : ''}>
            <Link to={s.to} title={`Why you see this: ${s.n ? `${s.n} item${s.n === 1 ? ' is' : 's are'} waiting in your list.` : s.n === 0 ? 'nothing is waiting here right now.' : 'it is a regular step of your work.'}`} aria-label={`Step ${i + 1}: ${s.title}${s.n ? `, ${s.n} to do` : s.n === 0 ? ', all clear' : ''}`}>
              <span className="nx-n">{s.n === 0 ? <Icon name="check" size={14} /> : i + 1}</span>
              <span className="nx-t"><span>{s.title}</span>{s.n ? <span className="nx-c">{s.n}</span> : s.n === 0 ? <span className="nx-c">All clear</span> : null}</span>
              <span className="nx-tip">{s.id === firstTodo && <b className="nx-start">Start here · </b>}{s.tip}</span>
            </Link>
          </li>
        ))}
      </ol>
      {extra}
    </Card>
  )
}
