import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Btn, Card, Chip, FormModal, type FieldDef } from '../components/ui'
import { clearAll, db, exportBackup, importBackup } from '../lib/db'
import { buildAlerts } from '../lib/calc'
import { useJobs, useOutlets, useSettings, useWorkers } from '../lib/hooks'
import { buildICS } from '../lib/ics'
import { notifySupported, requestNotify } from '../lib/notify'
import { loadSampleData } from '../lib/sample'
import { BUSINESS_TYPES, SKILL_LEVELS, type BusinessType, type Settings } from '../lib/types'
import { download, todayISO, uid } from '../lib/util'

type V = Record<string, unknown>
interface BIPEvent extends Event { prompt: () => Promise<void> }

export default function SettingsPage() {
  const s = useSettings()
  const outlets = useOutlets()
  const jobs = useJobs()
  const workers = useWorkers()
  const loc = useLocation()
  const [policy, setPolicy] = useState(false)
  const [outlet, setOutlet] = useState<V | null>(null)
  const [job, setJob] = useState<V | null>(null)
  const [msg, setMsg] = useState('')
  const [install, setInstall] = useState<BIPEvent | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const backupRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (loc.hash.includes('backup') || window.location.hash.includes('backup')) backupRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [loc])
  useEffect(() => {
    const h = (e: Event) => { e.preventDefault(); setInstall(e as BIPEvent) }
    window.addEventListener('beforeinstallprompt', h)
    return () => window.removeEventListener('beforeinstallprompt', h)
  }, [])

  const policyFields: FieldDef[] = [
    { key: 'companyName', label: 'Company name (for memos & reports)', full: true, required: true },
    { key: 'leadTimes', label: 'Alert lead times (days, comma separated)', hint: 'e.g. 90,60,30,7 — smallest = critical' },
    { key: 'annualLeaveDays', label: 'Default annual leave (days / year)', type: 'number' },
    { key: 'maxCarryForward', label: 'Max leave carry-forward (days, 0 = no cap)', type: 'number' },
    { key: 'ticketEveryMonths', label: 'Return flight ticket every (months)', type: 'number', hint: 'Default 36 = 3 years; unused tickets accumulate' },
    { key: 'ticketValue', label: 'Estimated ticket value (RM)', type: 'number' },
    { key: 'defaultMinContractMonths', label: 'Default minimum contract (months)', type: 'number' },
    { key: 'defaultPenalty', label: 'Default early-termination penalty (RM)', type: 'number' },
    { key: 'overdueGraceDays', label: 'Grace days before “overdue return” alert', type: 'number' },
  ]

  const doExport = async () => {
    const data = await exportBackup()
    download(`fw-manager-backup-${todayISO()}.json`, JSON.stringify(data), 'application/json')
    localStorage.setItem('fwm-last-backup', todayISO())
    setMsg(`Backup downloaded (${data.workers.length} workers).`)
  }
  const doImport = async (f: File) => {
    try {
      const data = JSON.parse(await f.text())
      const replace = confirm('Replace ALL current data with this backup?\n\nOK = Replace everything\nCancel = Merge (add/update records)')
      await importBackup(data, replace ? 'replace' : 'merge')
      setMsg(`Imported ${data.workers.length} workers (${replace ? 'replaced' : 'merged'}).`)
    } catch (e) { setMsg('Import failed: ' + (e as Error).message) }
  }
  const lastBackup = localStorage.getItem('fwm-last-backup')

  return (
    <div className="page">
      <div className="page-h"><div><h1>Settings</h1><p className="muted">Masters, policies, backup</p></div></div>

      <Card title="Company & policy" actions={<Btn small icon="edit" onClick={() => setPolicy(true)}>Edit</Btn>}>
        <dl className="kv">
          <div><dt>Company</dt><dd>{s.companyName}</dd></div>
          <div><dt>Alert lead times</dt><dd>{[...s.leadTimes].sort((a, b) => b - a).join(' / ')} days</dd></div>
          <div><dt>Annual leave</dt><dd>{s.annualLeaveDays} days/yr · carry-forward {s.maxCarryForward ? `max ${s.maxCarryForward}` : 'unlimited'}</dd></div>
          <div><dt>Flight ticket</dt><dd>1 per {s.ticketEveryMonths} months (~RM {s.ticketValue}), accumulates</dd></div>
          <div><dt>Contract defaults</dt><dd>{s.defaultMinContractMonths} months min · RM {s.defaultPenalty} penalty (prorated)</dd></div>
        </dl>
      </Card>

      <Card title={`Outlets / business units (${outlets.length})`} actions={<Btn kind="primary" small icon="plus" onClick={() => setOutlet({ type: 'Restaurant' })}>Add outlet</Btn>}>
        {outlets.length === 0 ? <p className="muted">No outlets yet. Add your restaurants, shops, hotels…</p> : (
          <ul className="rows">
            {outlets.map((o) => (
              <li key={o.id}>
                <div className="r-main"><strong>{o.name}</strong><small>{o.type}{o.manager ? ` · ${o.manager}` : ''} · {workers.filter((w) => w.outletId === o.id).length} workers</small></div>
                <div className="r-act"><Btn small kind="ghost" icon="edit" title="Edit outlet" onClick={() => setOutlet(o as unknown as V)} /></div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Job / skill categories" actions={<Btn small icon="plus" onClick={() => setJob({ businessType: 'Restaurant' })}>Add category</Btn>}>
        <p className="muted small">Skill levels: {SKILL_LEVELS.join(', ')}. Tap a category to rename or delete.</p>
        <div className="jobs">
          {BUSINESS_TYPES.map((bt) => (
            <div key={bt} className="jobs-g">
              <h4>{bt}</h4>
              <div className="row wrap gap-s">
                {jobs.filter((j) => j.businessType === bt).sort((a, b) => a.name.localeCompare(b.name)).map((j) => (
                  <button key={j.id} className="chip-btn" onClick={() => setJob(j as unknown as V)}><Chip tone="teal">{j.name}</Chip></button>
                ))}
                <button className="chip-btn" onClick={() => setJob({ businessType: bt })}><Chip>+ add</Chip></button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Notifications & app">
        <p className="small">Browser notifications: <strong>{notifySupported() ? Notification.permission : 'not supported'}</strong>. A daily summary of urgent items shows when you open the app.</p>
        <div className="row gap-s wrap">
          {notifySupported() && Notification.permission !== 'granted' && <Btn icon="bell" onClick={async () => { await requestNotify(); setMsg('Notification permission: ' + Notification.permission) }}>Enable notifications</Btn>}
          {install && <Btn kind="primary" icon="download" onClick={() => install.prompt()}>Install app</Btn>}
          <Btn icon="cal" onClick={() => download(`all-expiries-${todayISO()}.ics`, buildICS(buildAlerts(workers, { ...s, leadTimes: [100000] }).filter((a) => a.date), Math.max(...s.leadTimes)), 'text/calendar')}>Export all expiries (.ics)</Btn>
        </div>
        <p className="muted small">To install on phone: open in Chrome/Safari → Share/Menu → “Add to Home Screen”.</p>
      </Card>

      <div ref={backupRef} id="backup">
        <Card title="Backup & data">
          <p className="small">⚠️ All data is stored <strong>only in this browser on this device</strong>. Clearing browser data or switching device loses it. Download a backup regularly and keep it safe (it contains personal data).</p>
          <p className="small">Last backup: <strong>{lastBackup || 'never'}</strong> · Workers: {workers.length}</p>
          <div className="row gap-s wrap">
            <Btn kind="primary" icon="download" onClick={doExport}>Download backup (JSON)</Btn>
            <Btn icon="upload" onClick={() => fileRef.current?.click()}>Restore / import backup</Btn>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = '' }} />
            <Btn icon="users" onClick={async () => { if (confirm('Load sample (fake DEMO) workers and outlets? Existing data is kept.')) { await loadSampleData(); setMsg('Sample data loaded.') } }}>Load sample data</Btn>
            <Btn kind="danger" icon="trash" onClick={async () => { if (confirm('Delete ALL workers, outlets and settings from this browser?') && prompt('Type DELETE to confirm') === 'DELETE') { await clearAll(); setMsg('All data cleared.') } }}>Clear all data</Btn>
          </div>
          {msg && <p className="ok" role="status">{msg}</p>}
        </Card>
      </div>

      {policy && (
        <FormModal title="Company & policy" fields={policyFields} initial={{ ...s, leadTimes: s.leadTimes.join(',') }} onClose={() => setPolicy(false)}
          validate={(v) => String(v.leadTimes).split(',').map(Number).some((n) => !Number.isFinite(n) || n < 0) ? 'Lead times must be numbers' : null}
          onSave={async (v) => {
            const next: Settings = { ...s, ...(v as Partial<Settings>), id: 'app', leadTimes: String(v.leadTimes).split(',').map((x) => Number(x.trim())).filter((n) => n >= 0).sort((a, b) => b - a) }
            for (const k of ['annualLeaveDays', 'maxCarryForward', 'ticketEveryMonths', 'ticketValue', 'defaultMinContractMonths', 'defaultPenalty', 'overdueGraceDays'] as const) next[k] = Number(next[k] ?? 0)
            if (!next.ticketEveryMonths) next.ticketEveryMonths = 36
            await db.settings.put(next)
          }} />
      )}
      {outlet && (
        <FormModal title={outlet.id ? 'Edit outlet' : 'Add outlet'} initial={outlet} onClose={() => setOutlet(null)}
          fields={[{ key: 'name', label: 'Outlet name', required: true, full: true }, { key: 'type', label: 'Business type', type: 'select', options: [...BUSINESS_TYPES], required: true }, { key: 'manager', label: 'Manager / PIC' }, { key: 'address', label: 'Address', type: 'textarea' }]}
          onDelete={outlet.id ? () => { if (workers.some((w) => w.outletId === outlet.id)) alert('Workers are assigned to this outlet; they will show “—”.'); db.outlets.delete(String(outlet.id)) } : undefined}
          onSave={(v) => db.outlets.put({ id: (outlet.id as string) || uid(), name: String(v.name), type: v.type as BusinessType, manager: v.manager as string, address: v.address as string }).then(() => {})} />
      )}
      {job && (
        <FormModal title={job.id ? 'Edit category' : 'Add category'} initial={job} onClose={() => setJob(null)}
          fields={[{ key: 'name', label: 'Category name', required: true }, { key: 'businessType', label: 'Business type', type: 'select', options: [...BUSINESS_TYPES], required: true }]}
          onDelete={job.id ? () => db.jobs.delete(String(job.id)) : undefined}
          onSave={(v) => db.jobs.put({ id: (job.id as string) || uid(), name: String(v.name), businessType: v.businessType as BusinessType }).then(() => {})} />
      )}
    </div>
  )
}
