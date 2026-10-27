/* v1.6.0: command palette (Ctrl/Cmd+K, or the search field in the command bar). Jumps to any page, worker, company or recruit
 * this person can already see: workers come from this device's synced (role-scoped) data, recruits from a row-level-secured
 * query, companies follow the same rule as Settings → Companies. Nothing new is revealed. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from './Icon'
import { useAuth } from '../lib/auth'
import { useConfig } from '../lib/config'
import { useOutlets, useWorkers } from '../lib/hooks'
import { outletCompany } from '../lib/companies'
import { isDemoCompany, useHideDemo } from '../lib/demo'
import { qRank } from '../lib/quota'
import { supabase } from '../lib/supabase'
import { setTheme, isDark } from '../lib/theme'

export interface NavItem { to: string; label: string; icon: string }
type Item = { id: string; group: string; label: string; sub?: string; icon: string; run: () => void }

/* recently used & likely next: kept on this device, per signed-in person, only pages they actually opened */
type Visit = { to: string; label: string; n: number; t: number }
const rKey = (uid: string) => `fwm-recent-${uid}`
export function recordVisit(uid: string | undefined, to: string, label: string) {
  if (!uid || !label || to === '/' || to.startsWith('/assistant')) return
  try {
    const list: Visit[] = JSON.parse(localStorage.getItem(rKey(uid)) || '[]')
    const v = list.find((x) => x.to === to)
    if (v) { v.n += 1; v.t = Date.now(); v.label = label } else list.push({ to, label, n: 1, t: Date.now() })
    localStorage.setItem(rKey(uid), JSON.stringify(list.sort((a, b) => b.t - a.t).slice(0, 30)))
  } catch { /* ignore */ }
}
function visits(uid?: string): Visit[] { try { return uid ? JSON.parse(localStorage.getItem(rKey(uid)) || '[]') : [] } catch { return [] } }
/** "likely next": how often × how recently (half-life 3 days) — a simple frequency-recency score */
const score = (v: Visit) => v.n * Math.pow(0.5, (Date.now() - v.t) / (3 * 864e5))

const subs = new Set<(v: boolean) => void>()
export const openPalette = () => subs.forEach((f) => f(true))

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
const hit = (q: string, ...hay: (string | null | undefined)[]) => { const h = norm(hay.filter(Boolean).join(' ')); return norm(q).split(/\s+/).filter(Boolean).every((t) => h.includes(t)) }

export function CommandPalette({ pages }: { pages: NavItem[] }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const f = (v: boolean) => setOpen(v); subs.add(f)
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((v) => !v) } }
    window.addEventListener('keydown', k)
    return () => { subs.delete(f); window.removeEventListener('keydown', k) }
  }, [])
  return open ? <Palette pages={pages} onClose={() => setOpen(false)} /> : null
}

function Palette({ pages, onClose }: { pages: NavItem[]; onClose: () => void }) {
  const nav = useNavigate()
  const { role, isSuper, isGm, top, myCompanies, myOutlets, canWrite, canSeeCompanyDetails, session } = useAuth()
  const hist = useMemo(() => visits(session?.user.id), [session?.user.id])
  const workers = useWorkers()
  const outlets = useOutlets()
  const cfg = useConfig()
  const hide = useHideDemo()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [recruits, setRecruits] = useState<{ id: string; full_name: string; country: string; company_id: string }[]>([])
  const inp = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => { inp.current?.focus(); document.body.classList.add('modal-open'); return () => document.body.classList.remove('modal-open') }, [])
  const go = (to: string) => { onClose(); nav(to) }

  // recruits: only for people who can open Approval & Recruitment; the database decides which rows they may read
  useEffect(() => {
    if (qRank(role) <= 0 || q.trim().length < 2) { setRecruits([]); return }
    let live = true
    const t = setTimeout(async () => {
      const like = `%${q.trim().replace(/[%_,()]/g, ' ')}%`
      const r = await supabase.from('qr_recruits').select('id,full_name,country,company_id').ilike('full_name', like).limit(8)
      if (live && !r.error) setRecruits(((r.data || []) as typeof recruits).filter((x) => !(hide && isDemoCompany(x.company_id))))
    }, 180)
    return () => { live = false; clearTimeout(t) }
  }, [q, role, hide])

  const items = useMemo<Item[]>(() => {
    const s = q.trim()
    const out: Item[] = []
    const actions: Item[] = [
      ...(canWrite ? [{ id: 'a-add', group: 'Actions', label: 'Add worker', icon: 'plus', run: () => go('/workers/new') }] : []),
      { id: 'a-req', group: 'Actions', label: 'New request', icon: 'edit', run: () => go('/requests/new') },
      { id: 'a-theme', group: 'Actions', label: isDark() ? 'Switch to light mode' : 'Switch to dark mode', icon: 'spark', run: () => { setTheme(isDark() ? 'light' : 'dark'); onClose() } },
    ]
    const pg: Item[] = pages.map((p) => ({ id: 'p' + p.to, group: 'Pages', label: p.label, icon: p.icon, run: () => go(p.to) }))
    if (qRank(role) > 0) {
      ;[['overview', 'Overview'], ['letters', 'Letters & ledger'], ['approvals', 'Quota use approvals'], ['pipeline', 'Pipeline'], ['arrivals', 'Arrivals & hostel'], ['costs', 'Payments & budget'], ['exits', 'COM & runaways'], ['recon', 'Reconciliation'], ['claims', 'Replacement claims'], ['rules', 'Rules & regulations']]
        .forEach(([id, l]) => pg.push({ id: 'q-' + id, group: 'Pages', label: `Approval & Recruitment · ${l}`, icon: 'plane', run: () => go(`/quota?tab=${id}`) }))
    }
    if (!s) {
      const here = window.location.hash.slice(1)
      const likely = [...hist].filter((v) => v.to !== here).sort((a, b) => score(b) - score(a)).slice(0, 3)
      const recent = hist.filter((v) => v.to !== here && !likely.includes(v)).slice(0, 4)
      const icon = (to: string) => (to.startsWith('/workers/') ? 'users' : to.startsWith('/quota') ? 'plane' : to.startsWith('/companies') ? 'home' : pages.find((p) => to.startsWith(p.to) && p.to !== '/')?.icon || 'doc')
      return [
        ...likely.map((v) => ({ id: 'l' + v.to, group: 'Likely next', label: v.label, sub: `Opened ${v.n}× — you use this often`, icon: icon(v.to), run: () => go(v.to) })),
        ...recent.map((v) => ({ id: 'h' + v.to, group: 'Recent', label: v.label, icon: icon(v.to), run: () => go(v.to) })),
        ...pg.filter((p) => !p.id.startsWith('q-')), ...actions,
      ]
    }
    out.push(...pg.filter((p) => hit(s, p.label)), ...actions.filter((a) => hit(s, a.label)))
    const oName = (id?: string | null) => outlets.find((o) => o.id === id)?.name || ''
    workers.filter((w) => hit(s, w.fullName, w.workerNo, oName(w.outletId))).slice(0, 8)
      .forEach((w) => out.push({ id: 'w' + w.id, group: 'Workers', label: w.fullName, sub: [w.workerNo, oName(w.outletId)].filter(Boolean).join(' · '), icon: 'users', run: () => go(`/workers/${w.id}`) }))
    if (canSeeCompanyDetails) {
      const seeAll = top('org.companies') || isSuper || isGm || (!myCompanies.length && !myOutlets.length)
      cfg.companies.items.filter((c) => seeAll || myCompanies.includes(c.id) || outlets.some((o) => myOutlets.includes(o.id) && outletCompany(o) === c.id))
        .filter((c) => !(hide && isDemoCompany(c.id)) && hit(s, c.name, c.id)).slice(0, 6)
        .forEach((c) => out.push({ id: 'c' + c.id, group: 'Companies', label: c.name, icon: 'home', run: () => go(`/companies/${encodeURIComponent(c.id)}`) }))
    }
    recruits.forEach((r) => out.push({ id: 'r' + r.id, group: 'Recruits', label: r.full_name, sub: r.country, icon: 'plane', run: () => go(`/quota/recruit/${r.id}`) }))
    out.push({ id: 'search', group: 'Search', label: `Search workers for “${s}”`, icon: 'search', run: () => go(`/workers?q=${encodeURIComponent(s)}`) })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, pages, workers, outlets, cfg.companies.items, recruits, role, canWrite, canSeeCompanyDetails, hide, hist])

  useEffect(() => { setSel(0) }, [q])
  useEffect(() => { listRef.current?.querySelector('.cmdk-item.on')?.scrollIntoView({ block: 'nearest' }) }, [sel])
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((v) => Math.min(items.length - 1, v + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((v) => Math.max(0, v - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); items[sel]?.run() }
  }
  const groups: [string, ReactNode[]][] = []
  items.forEach((it, i) => {
    let g = groups.find((x) => x[0] === it.group); if (!g) { g = [it.group, []]; groups.push(g) }
    g[1].push(
      <button key={it.id} type="button" role="option" aria-selected={i === sel} className={'cmdk-item' + (i === sel ? ' on' : '')} onMouseMove={() => setSel(i)} onClick={() => it.run()}>
        <span className="cmdk-ic"><Icon name={it.icon} size={16} /></span>
        <span className="cmdk-l">{it.label}{it.sub && <small>{it.sub}</small>}</span>
        {i === sel && <kbd>↵</kbd>}
      </button>,
    )
  })
  return (
    <div className="cmdk-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Search and jump">
        <div className="cmdk-in">
          <Icon name="search" size={18} />
          <input ref={inp} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={key} placeholder="Search pages, workers, companies, recruits…" aria-label="Search and jump" role="combobox" aria-expanded="true" aria-controls="cmdk-list" />
          <button type="button" className="cmdk-esc" onClick={onClose} aria-label="Close">Esc</button>
        </div>
        <div className="cmdk-list" id="cmdk-list" role="listbox" ref={listRef}>
          {groups.map(([g, els]) => <div key={g} className="cmdk-g"><div className="cmdk-gh">{g}</div>{els}</div>)}
          {!items.length && <p className="muted small cmdk-empty">No matches.</p>}
        </div>
        <div className="cmdk-f muted small"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>Esc</kbd> close</span></div>
      </div>
    </div>
  )
}
