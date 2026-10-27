import { ClipBadge } from '../components/attach'
import { useDocCounts } from '../lib/vault'
import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { demoOutletIds, setShowDemo, useHideDemo } from '../lib/demo'
import { useAuth } from '../lib/auth'
import { DataTable, Details } from '../components/dataTable'
import { Actions, IconAction } from '../components/iconAction'
import type { Settings } from '../lib/types'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Avatar, Btn, Chip, Empty, SelectFilter, Toolbar, docTone, statusTone, Skeleton } from '../components/ui'
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

function ExpiryChip({ w, s }: { w: Worker; s: Settings }) {
  const nx = nextExpiry(w)
  const st = nx ? docStatus(nx, s) : null
  if (!nx || !st) return <span className="muted small">—</span>
  return <Chip tone={docTone(st)}>{nx.type === 'Other' ? nx.label : nx.type.split(' ')[0]} {fmtDate(nx.expiryDate)}{daysUntil(nx.expiryDate)! < 0 ? ' · expired' : ''}</Chip>
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
  const { canWrite } = useAuth()
  const { byWorker } = useDocCounts()
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }) }

  const list = useMemo(() => {
    const ws = (loaded ?? []).filter((w) =>
      matchesQuery(w, q, outletName(outlets, w.outletId)) &&
      (!status || (status === '__leave' ? isOnLeave(w) : status === '__current' ? !['Absconded', 'Resigned', 'Terminated', 'Contract Ended', 'Repatriated'].includes(w.status) : w.status === status)) &&
      (!outlet || w.outletId === outlet) && (!type || w.businessType === type) && (!nat || w.nationality === nat) && (gap !== 'lang' || missingLanguage(w)) && (gap !== 'incomplete' || !completeness(w, outlets).complete))
    return ws
  }, [loaded, q, status, outlet, type, nat, gap, outlets])

  return (
    <div className="page">
      <div className="page-h">
        <div><h1>Workers</h1><p className="muted">{list.length} of {loaded?.length ?? 0} shown</p></div>
        <Btn kind="primary" icon="plus" onClick={() => nav('/workers/new')}>Add</Btn>
      </div>
      <SampleHint />
      <Toolbar>
        <div className="search">
          <input value={q} onChange={(e) => { setQ(e.target.value); set('q', e.target.value) }} placeholder="Search name, ID, passport, phone, family…" aria-label="Search workers" />
        </div>
        <SelectFilter label="Status" value={status} onChange={(v) => set('status', v)} options={[{ value: '__current', label: 'All current (not exited)' }, { value: '__leave', label: 'Any leave' }, ...STATUSES]} />
        <SelectFilter label="Outlet" value={outlet} onChange={(v) => set('outlet', v)} options={outlets.map((o) => ({ value: o.id, label: o.name }))} />
        <SelectFilter label="Business" value={type} onChange={(v) => set('type', v)} options={[...BUSINESS_TYPES]} />
        <SelectFilter label="Nationality" value={nat} onChange={(v) => set('nat', v)} options={NATIONALITIES} />
        <SelectFilter label="Data gaps" value={gap} onChange={(v) => set('gap', v)} options={[{ value: 'incomplete', label: 'Incomplete profile (draft)' }, { value: 'lang', label: 'Language missing' }]} />
      </Toolbar>
      {!loaded ? <Skeleton rows={8} /> : list.length === 0 ? (
        <Empty icon="users" title="No workers match">{loaded.length === 0 && <Btn kind="primary" icon="plus" onClick={() => nav('/workers/new')}>Add worker</Btn>}</Empty>
      ) : (
        <DataTable label="Workers" rows={list} rowKey={(w) => w.id} rowTestId={() => 'worker-row'} pageSize={20} initialSort={{ key: 'name', dir: 'asc' }}
          rowClass={(w) => (!completeness(w, outlets).complete ? 'dt-warn' : '')}
          columns={[
            { key: 'name', label: 'Worker', main: true, sort: (w) => w.fullName.toLowerCase(),
              render: (w) => <span className="dt-person"><Avatar name={w.fullName} photo={w.photo} size={34} /><span><Link to={`/workers/${w.id}`} className="dt-link">{w.fullName}</Link><ClipBadge n={(byWorker.get(w.id) || 0) + (canWrite ? w.documents.filter((d) => d.attachment).length : 0)} /><small>{w.workerNo}{!completeness(w, outlets).complete ? ' · Draft' : ''}</small></span></span> },
            { key: 'id', label: 'Worker ID', hide: 'tablet', sort: (w) => w.workerNo, render: (w) => w.workerNo },
            { key: 'status', label: 'Status', sort: (w) => w.status, render: (w) => <Chip tone={statusTone(w.status)}>{w.status}</Chip> },
            { key: 'outlet', label: 'Outlet', hide: 'phone', sort: (w) => outletName(outlets, w.outletId), render: (w) => outletName(outlets, w.outletId) },
            { key: 'nat', label: 'Nationality', hide: 'tablet', sort: (w) => w.nationality, render: (w) => w.nationality },
            { key: 'expiry', label: 'Next expiry', hide: 'phone', sort: (w) => nextExpiry(w)?.expiryDate || '9999', render: (w) => <ExpiryChip w={w} s={s} /> },
            { key: 'join', label: 'Service', hide: 'tablet', sort: (w) => w.joinDate, render: (w) => <span className="small">{serviceText(w.joinDate)}</span> },
          ]}
          actions={(w) => (
            <Actions>
              <IconAction kind="view" label="Open worker profile" onClick={() => nav(`/workers/${w.id}`)} />
              {canWrite && <IconAction kind="edit" label="Edit worker" onClick={() => nav(`/workers/${w.id}/edit`)} />}
            </Actions>
          )}
          expand={(w) => {
            const t = ticketInfo(w, s)
            return (
              <>
                <Details items={[
                  ['Worker ID', w.workerNo], ['Nationality', w.nationality], ['Job', w.jobCategory || '—'], ['Outlet', outletName(outlets, w.outletId)],
                  ['Business', w.businessType], ['Phone', w.phoneMY], ['Joined', w.joinDate ? `${fmtDate(w.joinDate)} · ${serviceText(w.joinDate)}` : ''],
                  ['Next expiry', nextExpiry(w) ? <ExpiryChip w={w} s={s} /> : 'No expiry dates'],
                  ['Ticket', t.eligible ? <Chip tone="purple">✈ Ticket ×{t.balance}</Chip> : ''],
                  ['Language', missingLanguage(w) ? <Chip tone="amber">🗣️ Language missing</Chip> : primaryLangName(w)],
                  ['Profile', completeness(w, outlets).complete ? 'Complete' : <Chip tone="amber">Draft — {completeness(w, outlets).missing.map((m) => m.label).join(', ')}</Chip>],
                ]} />
              </>
            )
          }} />
      )}
    </div>
  )
}

/** 1.5.1: the CEO can see that SAMPLE / DEMO workers are hidden and show them in one tap (same switch as the account menu). */
function SampleHint() {
  const { isSuper } = useAuth()
  const hide = useHideDemo()
  const n = useLiveQuery(async () => { const ids = await demoOutletIds(); return ids.size ? (await db.workers.toArray()).filter((w) => ids.has(w.outletId || '')).length : 0 }, []) ?? 0
  if (!isSuper || !hide || !n) return null
  return (
    <div className="note-box sample-hint">
      {n} sample / demo worker{n === 1 ? ' is' : 's are'} hidden (left out of totals, alerts and reports).{' '}
      <Btn small icon="eye" onClick={() => setShowDemo(true)}>Show sample &amp; demo data</Btn>
    </div>
  )
}
