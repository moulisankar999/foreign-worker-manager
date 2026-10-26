/* v1.6.0: a short first-run tour per role. Skippable; replay it from Help. Not shown to automated browsers. */
import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { useAuth } from '../lib/auth'

const subs = new Set<() => void>()
export const openTour = () => subs.forEach((f) => f())
const key = (uid: string) => `fwm-tour-${uid}`
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

export function Tour() {
  const { session, role, isSuper, isGm, isOM } = useAuth()
  const uid = session?.user.id || ''
  const [open, setOpen] = useState(false)
  const [i, setI] = useState(0)
  useEffect(() => {
    const f = () => { setI(0); setOpen(true) }; subs.add(f)
    try { if (uid && !navigator.webdriver && !localStorage.getItem(key(uid))) setOpen(true) } catch { /* ignore */ }
    return () => { subs.delete(f) }
  }, [uid])
  if (!open) return null
  const work = isSuper ? ['lock', 'Review and steer', 'Check decisions made for you, decide requests, welcome new users and keep an eye on quota and recruitment.']
    : isGm ? ['check', 'Decide and follow up', 'Requests and quota use come to you. Decide them, then check documents and reports.']
      : isOM ? ['edit', 'Raise and follow requests', 'Ask for leave, MC, salary advance or passports for your workers, and watch their documents.']
        : role === 'viewer' ? ['search', 'Look things up', 'Find any worker you can see and open the reports.']
          : ['users', 'Keep records complete', 'Add workers, keep their documents in date, handle requests and move recruits forward.']
  const steps: [string, string, string][] = [
    ['spark', 'Welcome to FW Manager', 'A quick look around — four steps, under a minute.'],
    ['menu', 'Find your way', 'Use the menu on the left on a computer or tablet, or the tabs at the bottom of your phone. The page title always shows where you are.'],
    ['search', 'Jump anywhere', `Press ${isMac ? '⌘' : 'Ctrl'} K or tap 🔍 to go straight to a page, worker, company or recruit.`],
    [work[0], work[1], work[2] + ' Your home shows these as “What to do next” — tap a step to start.'],
    ['help', 'Help is always here', 'Help has a guide for your role and answers to common questions. You can replay this tour from Help.'],
  ]
  const done = () => { try { localStorage.setItem(key(uid), '1') } catch { /* ignore */ } setOpen(false) }
  const [ic, t, d] = steps[i]
  const last = i === steps.length - 1
  return (
    <div className="tour-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) done() }}>
      <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-t" onKeyDown={(e) => { if (e.key === 'Escape') done() }}>
        <span className="tour-ic"><Icon name={ic} size={26} /></span>
        <h2 id="tour-t">{t}</h2>
        <p>{d}</p>
        <div className="tour-f">
          <span className="tour-dots" aria-label={`Step ${i + 1} of ${steps.length}`}>{steps.map((_, j) => <i key={j} className={j === i ? 'on' : ''} />)}</span>
          <span className="grow" />
          {!last && <button className="btn btn-ghost" onClick={done}>Skip</button>}
          {i > 0 && <button className="btn btn-secondary" onClick={() => setI(i - 1)}>Back</button>}
          <button className="btn btn-primary" autoFocus onClick={() => (last ? done() : setI(i + 1))}>{last ? 'Get started' : 'Next'}</button>
        </div>
      </div>
    </div>
  )
}
