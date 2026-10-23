/* Advice-style dashboard pieces: greeting, today's priorities, health score rings, worker status, expiries timeline, tip of the day. */
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Card, Chip, Modal } from './ui'
import { Icon } from './Icon'
import { LogoImg } from './logos'
import { useAuth } from '../lib/auth'
import { useConfig } from '../lib/config'
import { useOutlets } from '../lib/hooks'
import { isExited, isOnLeave, outletName, type Alert } from '../lib/calc'
import { healthScore, priorities, tipOfDay, type Priority, type Score } from '../lib/compliance'
import { checkTone, type AgencyCheck } from '../lib/agencies'
import { outletCompany } from '../lib/companies'
import { headerLogo, companyLogo } from '../lib/logos'
import { overdueDays } from '../lib/passport'
import { ROLE_LABEL } from '../lib/workflow'
import { fmtDate } from '../lib/util'
import type { Outlet, Worker } from '../lib/types'

const hello = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening' }

export function Greeting({ sub }: { sub?: string }) {
  const { profile, role, myCompanies, myOutlets } = useAuth()
  const cfg = useConfig()
  const outlets = useOutlets()
  const logo = headerLogo(role, myCompanies, myOutlets, outlets) || (cfg.companies.items.length === 1 ? companyLogo(cfg.companies.items[0].id) : null)
  const first = (profile?.full_name || '').split(' ')[0]
  return (
    <div className="greet">
      {logo ? <LogoImg path={logo} size={52} /> : <span className="greet-ic" aria-hidden>👋</span>}
      <div>
        <h1>{hello()}{first ? `, ${first}` : ''}</h1>
        <p className="muted">{ROLE_LABEL[role || ''] || ''}{sub ? ` · ${sub}` : ''} · {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      </div>
    </div>
  )
}

export interface Extra { id: string; icon: string; tone: Priority['tone']; text: string; detail: string; to: string; label: string; rank: number }
export function Priorities({ alerts, workers, outlets, om, extra = [] }: { alerts: Alert[]; workers: Worker[]; outlets: Outlet[]; om?: boolean; extra?: Extra[] }) {
  const cfg = useConfig()
  const nav = useNavigate()
  const list = useMemo(() => {
    const base = priorities(alerts, workers, outlets, cfg.agencies.items, { om })
    const ex: Priority[] = extra.map((e) => ({ id: e.id, rank: e.rank, icon: e.icon, tone: e.tone, text: e.text, detail: e.detail, action: { label: e.label, to: e.to } }))
    return [...ex, ...base].sort((a, b) => a.rank - b.rank).slice(0, 5)
  }, [alerts, workers, outlets, cfg.agencies.items, om, extra])
  return (
    <Card title={<><Icon name="check" /> Today’s priorities</>} className="card-prio">
      {list.length === 0 ? <p className="muted">All clear today 🎉 Nothing needs you right now.</p> : (
        <ol className="prio">
          {list.map((p) => (
            <li key={p.id} className={`prio-${p.tone}`}>
              <span className="prio-ic" aria-hidden>{p.icon}</span>
              <div className="prio-t"><strong>{p.text}</strong><small>{p.detail}</small></div>
              <div className="prio-a">
                {p.action.href ? <a className="btn btn-primary btn-s" href={p.action.href} target="_blank" rel="noopener noreferrer">{p.action.label} ↗</a>
                  : <button className="btn btn-primary btn-s" onClick={() => nav(p.action.to || '/')}>{p.action.label}</button>}
                {p.second && <button className="btn btn-ghost btn-s" onClick={() => nav(p.second!.to || '/')}>{p.second.label}</button>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}

export function Ring({ score, size = 76, tone }: { score: number | null; size?: number; tone: string }) {
  const r = 30, c = 2 * Math.PI * r
  const v = score ?? 0
  return (
    <svg className={`ring ring-${tone}`} width={size} height={size} viewBox="0 0 76 76" role="img" aria-label={score === null ? 'No score' : `Health score ${score} of 100`}>
      <circle cx="38" cy="38" r={r} className="ring-bg" />
      <circle cx="38" cy="38" r={r} className="ring-fg" strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 38 38)" />
      <text x="38" y="43" textAnchor="middle" className="ring-t">{score === null ? '—' : score}</text>
    </svg>
  )
}

export function HealthCard({ workers, alerts, outlets }: { workers: Worker[]; alerts: Alert[]; outlets: Outlet[] }) {
  const cfg = useConfig()
  const [why, setWhy] = useState<{ name: string; s: Score } | null>(null)
  const groups = useMemo(() => {
    const all = { id: 'all', name: 'All workers', s: healthScore(workers, alerts, outlets) }
    const cos = cfg.companies.items.map((c) => {
      const ws = workers.filter((w) => outletCompany(outlets.find((o) => o.id === w.outletId)) === c.id)
      const ids = new Set(ws.map((w) => w.id))
      return { id: c.id, name: c.name, s: healthScore(ws, alerts.filter((a) => ids.has(a.workerId)), outlets) }
    }).filter((g) => g.s.total > 0)
    const outs = outlets.map((o) => {
      const ws = workers.filter((w) => w.outletId === o.id)
      const ids = new Set(ws.map((w) => w.id))
      return { id: o.id, name: o.name, s: healthScore(ws, alerts.filter((a) => ids.has(a.workerId)), outlets) }
    }).filter((g) => g.s.total > 0).sort((a, b) => (a.s.score ?? 100) - (b.s.score ?? 100))
    return { all, cos: cos.length > 1 ? cos : [], outs }
  }, [workers, alerts, outlets, cfg.companies.items])
  const Tile = ({ g, big }: { g: { name: string; s: Score }; big?: boolean }) => (
    <button type="button" className={`h-tile${big ? ' h-big' : ''}`} onClick={() => setWhy(g)} title="Why this score?">
      <Ring score={g.s.score} tone={g.s.tone} size={big ? 92 : 64} />
      <span><strong>{g.name}</strong><small className={`tone-t-${g.s.tone}`}>{g.s.label}</small><small className="muted">{g.s.total} workers · why?</small></span>
    </button>
  )
  return (
    <Card title={<><Icon name="chart" /> Compliance health</>} className="card-health">
      <div className="h-grid">
        <Tile g={groups.all} big />
        {groups.cos.map((g) => <Tile key={g.id} g={g} />)}
      </div>
      {groups.outs.length > 1 && <>
        <h4>By outlet (lowest first)</h4>
        <div className="h-grid h-small">{groups.outs.slice(0, 8).map((g) => <Tile key={g.id} g={g} />)}</div>
      </>}
      <p className="muted small">Score out of 100 from expired / expiring permits, documents, passport consent, overdue returns, profiles and status checks. Tap a ring for the breakdown.</p>
      {why && (
        <Modal title={`Why ${why.s.score ?? '—'}/100 — ${why.name}`} onClose={() => setWhy(null)}>
          <ul className="why">
            {why.s.lines.map((l) => (
              <li key={l.key} className={l.lost ? 'why-lost' : 'why-ok'}>
                <span className="why-n">{l.lost ? `−${l.lost}` : '✓'}</span>
                <div><strong>{l.label}</strong><small>{l.affected ? `${l.affected} of ${why.s.total} workers · ` : 'No problems · '}max −{l.max}</small>{l.lost > 0 && <small className="why-tip">👉 {l.tip}</small>}</div>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </Card>
  )
}

export function StatusGlance({ workers }: { workers: Worker[] }) {
  const nav = useNavigate()
  const cur = workers.filter((w) => !isExited(w))
  const items: [string, number, string, string, string][] = [
    ['🟢', cur.filter((w) => w.status === 'Active-Working').length, 'Working', 'green', '/workers?status=Active-Working'],
    ['🏖️', cur.filter(isOnLeave).length, 'On leave', 'blue', '/workers?status=__leave'],
    ['⏰', cur.filter((w) => overdueDays(w) > 0).length, 'Overdue', 'red', '/alerts?cat=Overdue%20return'],
    ['🚫', cur.filter((w) => w.status === 'Absconded').length, 'Absconded', 'red', '/workers?status=Absconded'],
    ['👋', workers.length - cur.length, 'Exited', 'gray', '/workers?status=__exited'],
  ]
  return (
    <Card title={<><Icon name="users" /> Workers at a glance</>}>
      <div className="glance">
        {items.map(([i, n, l, t, to]) => <button key={l} type="button" className={`gl gl-${t}`} onClick={() => nav(to)}><span aria-hidden>{i}</span><strong>{n}</strong><small>{l}</small></button>)}
      </div>
    </Card>
  )
}

export function ExpiryTimeline({ alerts }: { alerts: Alert[] }) {
  const items = alerts.filter((a) => a.date && a.days !== null && a.days <= 90 && !['Due back', 'Leave approval', 'Status check'].includes(a.category))
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0))
  const buckets: [string, (d: number) => boolean, string][] = [['Expired', (d) => d < 0, 'red'], ['Next 30 days', (d) => d >= 0 && d <= 30, 'orange'], ['31–60 days', (d) => d > 30 && d <= 60, 'amber'], ['61–90 days', (d) => d > 60 && d <= 90, 'teal']]
  return (
    <Card title={<><Icon name="cal" /> Expiries timeline</>} actions={<Link to="/alerts" className="link">All →</Link>}>
      {items.length === 0 ? <p className="muted">Nothing expires in the next 90 days 🎉</p> : (
        <ol className="tl2">
          {buckets.map(([label, f, tone]) => {
            const xs = items.filter((a) => f(a.days!))
            if (!xs.length) return null
            return (
              <li key={label} className={`tl2-${tone}`}>
                <span className="tl2-dot" />
                <div>
                  <strong>{label}</strong> <Chip tone={tone}>{xs.length}</Chip>
                  <ul className="tl2-items">{xs.slice(0, 4).map((a) => <li key={a.id}><Link to={`/workers/${a.workerId}?tab=docs`}>{a.workerName}</Link> <small className="muted">— {a.category.replace(/ \(.*\)$/, '')} · {a.date ? fmtDate(a.date) : ''}</small></li>)}
                    {xs.length > 4 && <li className="muted small">+ {xs.length - 4} more</li>}</ul>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </Card>
  )
}

export function TipCard() {
  const t = tipOfDay()
  return (
    <Card title={<>💡 Tip of the day</>} className="card-tip">
      <p><strong>{t.title}.</strong> {t.text}</p>
      <p className="muted small">Source: {t.source}. General guidance only — check with JTKSM or your agent for your case.</p>
    </Card>
  )
}

export function LatestChecks({ workers }: { workers: Worker[] }) {
  const cfg = useConfig()
  const outlets = useOutlets()
  const list = workers.flatMap((w) => (w.agencyChecks || []).map((c: AgencyCheck) => ({ w, c }))).sort((a, b) => b.c.at.localeCompare(a.c.at)).slice(0, 6)
  if (!list.length) return null
  const ag = (id: string) => cfg.agencies.items.find((a) => a.id === id)
  return (
    <Card title={<>🔎 Latest status checks</>}>
      <ul className="rows compact">{list.map(({ w, c }) => (
        <li key={c.id}><Link className="req-link" to={`/workers/${w.id}?tab=checks`}><span className="req-ic">{ag(c.agency)?.icon || '🔎'}</span>
          <div className="r-main"><strong>{w.fullName}</strong><small>{ag(c.agency)?.short || c.agency} · {fmtDate(c.date)} · by {c.by}{c.ref ? ` · ref ${c.ref}` : ''}{outlets.length > 1 ? ` · ${outletName(outlets, w.outletId)}` : ''}</small></div>
          <Chip tone={checkTone(c.status)}>{c.status}</Chip></Link></li>
      ))}</ul>
    </Card>
  )
}
