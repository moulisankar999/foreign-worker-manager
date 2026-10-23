import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Avatar, Btn, Chip, Empty, SelectFilter, Toolbar, docTone, statusTone } from '../components/ui'
import { currentDocs, docStatus, isOnLeave, outletName, ticketInfo } from '../lib/calc'
import { useOutlets, useSettings, useWorkersLoaded } from '../lib/hooks'
import { BUSINESS_TYPES, NATIONALITIES, STATUSES, type Worker } from '../lib/types'
import { missingLanguage, primaryLangName, otherLanguagesText } from '../lib/languages'
import { daysUntil, fmtDate, serviceText } from '../lib/util'
import { completeness } from '../lib/validate'

export function nextExpiry(w: Worker) {
  return currentDocs(w).filter((d) => d.expiryDate).sort((a, b) => a.expiryDate!.localeCompare(b.expiryDate!))[0]
}

export function matchesQuery(w: Worker, q: string, outletLabel: string) {
  if (!q) return true
  const hay = [w.fullName, w.workerNo, w.nationality, primaryLangName(w), otherLanguagesText(w), w.jobCategory, w.phoneMY, w.status, outletLabel, ...w.documents.map((d) => d.number), ...w.family.map((f) => f.name)].join(' ').toLowerCase()
  return q.toLowerCase().split(/\s+/).every((t) => hay.includes(t))
}

export default function Workers() {
  const loaded = useWorkersLoaded()
  const outlets = useOutlets()
  const s = useSettings()
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const [q, setQ] = useState(sp.get('q') || '')
  const status = sp.get('status') || ''
  const outlet = sp.get('outlet') || ''
  const type = sp.get('type') || ''
  const nat = sp.get('nat') || ''
  const gap = sp.get('gap') || ''
  const [sort, setSort] = useState('name')
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }) }

  const list = useMemo(() => {
    const ws = (loaded ?? []).filter((w) =>
      matchesQuery(w, q, outletName(outlets, w.outletId)) &&
      (!status || (status === '__leave' ? isOnLeave(w) : status === '__current' ? !['Absconded', 'Resigned', 'Terminated', 'Contract Ended', 'Repatriated'].includes(w.status) : w.status === status)) &&
      (!outlet || w.outletId === outlet) && (!type || w.businessType === type) && (!nat || w.nationality === nat) && (gap !== 'lang' || missingLanguage(w)) && (gap !== 'incomplete' || !completeness(w, outlets).complete))
    const nx = (w: Worker) => nextExpiry(w)?.expiryDate || '9999'
    return ws.sort((a, b) =>
      sort === 'expiry' ? nx(a).localeCompare(nx(b)) : sort === 'join' ? a.joinDate.localeCompare(b.joinDate) : sort === 'id' ? a.workerNo.localeCompare(b.workerNo, undefined, { numeric: true }) : a.fullName.localeCompare(b.fullName))
  }, [loaded, q, status, outlet, type, nat, gap, sort, outlets])

  return (
    <div className="page">
      <div className="page-h">
        <div><h1>Workers</h1><p className="muted">{list.length} of {loaded?.length ?? 0} shown</p></div>
        <Btn kind="primary" icon="plus" onClick={() => nav('/workers/new')}>Add</Btn>
      </div>
      <Toolbar>
        <div className="search">
          <input value={q} onChange={(e) => { setQ(e.target.value); set('q', e.target.value) }} placeholder="Search name, ID, passport, phone, family…" aria-label="Search workers" />
        </div>
        <SelectFilter label="Status" value={status} onChange={(v) => set('status', v)} options={[{ value: '__current', label: 'All current (not exited)' }, { value: '__leave', label: 'Any leave' }, ...STATUSES]} />
        <SelectFilter label="Outlet" value={outlet} onChange={(v) => set('outlet', v)} options={outlets.map((o) => ({ value: o.id, label: o.name }))} />
        <SelectFilter label="Business" value={type} onChange={(v) => set('type', v)} options={[...BUSINESS_TYPES]} />
        <SelectFilter label="Nationality" value={nat} onChange={(v) => set('nat', v)} options={NATIONALITIES} />
        <SelectFilter label="Data gaps" value={gap} onChange={(v) => set('gap', v)} options={[{ value: 'incomplete', label: 'Incomplete profile (draft)' }, { value: 'lang', label: 'Language missing' }]} />
        <label className="sel-f">
          <span className="sr">Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
            <option value="name">Sort: Name</option><option value="id">Sort: Worker ID</option><option value="expiry">Sort: Nearest expiry</option><option value="join">Sort: Join date</option>
          </select>
        </label>
      </Toolbar>
      {loaded && list.length === 0 ? (
        <Empty icon="users" title="No workers match">{loaded.length === 0 && <Btn kind="primary" icon="plus" onClick={() => nav('/workers/new')}>Add worker</Btn>}</Empty>
      ) : (
        <ul className="wlist">
          {list.map((w) => {
            const nx = nextExpiry(w)
            const st = nx ? docStatus(nx, s) : null
            const t = ticketInfo(w, s)
            return (
              <li key={w.id}>
                <Link to={`/workers/${w.id}`}>
                  <Avatar name={w.fullName} photo={w.photo} />
                  <div className="wl-main">
                    <div className="wl-top"><strong>{w.fullName}</strong><Chip tone={statusTone(w.status)}>{w.status}</Chip>{!completeness(w, outlets).complete && <Chip tone="amber">Draft</Chip>}</div>
                    <small>{w.workerNo} · {w.nationality} · {w.jobCategory || '—'} · {outletName(outlets, w.outletId)}</small>
                    <div className="wl-chips">
                      {nx && st && <Chip tone={docTone(st)}>{nx.type === 'Other' ? nx.label : nx.type.split(' ')[0]} {fmtDate(nx.expiryDate)}{daysUntil(nx.expiryDate)! < 0 ? ' · expired' : ''}</Chip>}
                      {t.eligible && <Chip tone="purple">✈ Ticket ×{t.balance}</Chip>}
                      {missingLanguage(w) && <Chip tone="amber">🗣️ Language missing</Chip>}
                      <Chip>{serviceText(w.joinDate)}</Chip>
                    </div>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
