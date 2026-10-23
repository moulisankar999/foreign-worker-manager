import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Btn, Card, Chip, FormModal, type FieldDef } from '../components/ui'
import { db, exportBackup, importBackup } from '../lib/db'
import { SignOutRow } from '../components/userMenu'
import { Icon } from '../components/Icon'
import { SetPasswordForm } from './SetPassword'
import { PendingUsersPanel } from '../components/userApprovals'
import { usePendingUsers } from '../lib/userApprovals'
import { AccountCard, PhoneAlertsCard, UsersCard } from '../components/cloud'
import { ConsentTranslationsCard } from '../components/consentTranslations'
import { ApprovalRulesCard, AuditCard, EmergencyReasonsCard, HrFlagsCard, MyAlertsCard, NotificationsCard, PassportSettingsCard, VaultSettingsCard } from '../components/adminSettings'
import { useAuth } from '../lib/auth'
import { LogoEdit, LogoImg } from '../components/logos'
import { outletLogo } from '../lib/logos'
import { CompaniesCard, UserApprovalRulesCard } from '../components/companies'
import { useConfig } from '../lib/config'
import { companyName, DEFAULT_COMPANY_ID, outletCompany } from '../lib/companies'
import { clearDeviceCopy, syncNow } from '../lib/sync'
import { buildAlerts } from '../lib/calc'
import { useJobs, useOutlets, useSettings, useWorkers } from '../lib/hooks'
import { buildICS } from '../lib/ics'
import { notifySupported, requestNotify } from '../lib/notify'
import { loadSampleData } from '../lib/sample'
import { BUSINESS_TYPES, SKILL_LEVELS, type BusinessType, type Settings } from '../lib/types'
import { download, todayISO, uid } from '../lib/util'
import { ANDROID_APK_URL, APP_VERSION, isNative } from '../lib/platform'

type V = Record<string, unknown>
interface BIPEvent extends Event { prompt: () => Promise<void> }

/* Settings is split into tabs (deep links: #/settings/<tab>). Each tab shows only for roles that can use it. */
export type SettingsTab = 'account' | 'users' | 'org' | 'workers' | 'passport' | 'requests' | 'notifications' | 'data' | 'about'
const TABS: { id: SettingsTab; label: string; icon: string; sub: string }[] = [
  { id: 'account', label: 'Account', icon: 'users', sub: 'My profile, password, sign out' },
  { id: 'users', label: 'Users & Access', icon: 'lock', sub: 'Users, sign-ups, roles, HR Admin permissions, audit log' },
  { id: 'org', label: 'Companies & Outlets', icon: 'store', sub: 'Companies, outlets, logos' },
  { id: 'workers', label: 'Workers & Documents', icon: 'doc', sub: 'Leave / ticket / contract policy, job categories, document vault' },
  { id: 'passport', label: 'Passport & Consent', icon: 'plane', sub: 'Safekeeping, release reasons, consent translations' },
  { id: 'requests', label: 'Requests & Approvals', icon: 'check', sub: 'Who approves which request' },
  { id: 'notifications', label: 'Notifications', icon: 'bell', sub: 'Phone alerts, my alerts, WhatsApp / SMS / email' },
  { id: 'data', label: 'Data & Backup', icon: 'download', sub: 'Backup, restore, sync, calendar export' },
  { id: 'about', label: 'About', icon: 'more', sub: 'Version, install the app' },
]
/** searchable settings: [tab, section id, words] */
const TITLES: Record<string, string> = {"s-account": "Account & cloud sync", "s-password": "Change password", "s-signout": "Sign out", "s-pending": "New users waiting for approval", "s-users": "Users", "s-approvers": "Who may approve new users", "s-hrflags": "HR Admin permissions", "s-audit": "Audit log", "s-companies": "Companies", "s-outlets": "Outlets", "s-policy": "Company & policy", "s-jobs": "Job categories", "s-vault": "Document vault", "s-passport": "Passport safekeeping", "s-reasons": "Emergency release reasons", "s-consent": "Consent form translations", "s-rules": "Approval rules", "s-phone": "Phone alerts", "s-myalerts": "My alerts", "s-notify": "WhatsApp / SMS / email notifications", "s-backup": "Backup & data", "s-calendar": "Calendar & in-app notifications", "s-about": "About"}
const INDEX: [SettingsTab, string, string][] = [
  ['account', 's-account', 'Account & cloud sync signed in role access sync now'],
  ['account', 's-password', 'Change password'],
  ['account', 's-signout', 'Sign out switch user'],
  ['users', 's-pending', 'New users waiting for approval sign-ups approve reject'],
  ['users', 's-users', 'Users pause resume reset password delete user roles outlets companies'],
  ['users', 's-approvers', 'Who may approve new users HR Admin approvals'],
  ['users', 's-hrflags', 'HR Admin permissions salary delete workers audit reset passwords'],
  ['users', 's-audit', 'Audit log history'],
  ['org', 's-companies', 'Companies logos'],
  ['org', 's-outlets', 'Outlets business units outlet logo manager address'],
  ['workers', 's-policy', 'Company & policy alert lead times annual leave carry-forward flight ticket contract penalty grace days'],
  ['workers', 's-jobs', 'Job skill categories'],
  ['workers', 's-vault', 'Document vault categories file size limits'],
  ['passport', 's-passport', 'Passport safekeeping turnaround hours locations form logo'],
  ['passport', 's-reasons', 'Emergency release reasons'],
  ['passport', 's-consent', 'Consent form translations Tamil languages'],
  ['requests', 's-rules', 'Approval rules requests leave advance loan levels'],
  ['notifications', 's-phone', 'Phone alerts push notifications test alert'],
  ['notifications', 's-myalerts', 'My alerts mobile WhatsApp SMS opt out'],
  ['notifications', 's-notify', 'Notifications WhatsApp SMS email providers quiet hours events'],
  ['data', 's-backup', 'Backup restore import export JSON sample data re-download from cloud'],
  ['data', 's-calendar', 'Calendar export expiries ics install notifications'],
  ['about', 's-about', 'About version app download Android APK iPhone'],
]

function Sec({ id, children }: { id: string; children: ReactNode }) {
  return <section id={id} className="set-sec">{children}</section>
}

export default function SettingsPage() {
  const s = useSettings()
  const outlets = useOutlets()
  const jobs = useJobs()
  const workers = useWorkers()
  const { canWrite, isAdmin, isHr, isSuper, myCompanies, canApproveUsers, canSeeAudit } = useAuth()
  const { pending: newUsers } = usePendingUsers()
  const nav = useNavigate()
  const params = useParams<{ tab?: string }>()
  const visible = useMemo(() => TABS.filter((t) => ({
    account: true, users: isAdmin || canApproveUsers || isSuper || canSeeAudit, org: isHr, workers: isHr, passport: isHr, requests: isHr,
    notifications: true, data: true, about: true,
  } as Record<SettingsTab, boolean>)[t.id]), [isAdmin, canApproveUsers, isSuper, canSeeAudit, isHr])
  const legacy = window.location.hash.includes('backup') ? 'data' : ''
  const tab: SettingsTab = (visible.find((t) => t.id === (params.tab || legacy))?.id) || 'account'
  const badges: Partial<Record<SettingsTab, number>> = { users: newUsers.length }
  const [q, setQ] = useState('')
  const hits = q.trim().length < 2 ? [] : INDEX.filter(([t, id, w]) => visible.some((v) => v.id === t) && q.trim().toLowerCase().split(/\s+/).every((x) => (w + ' ' + (TITLES[id] || '')).toLowerCase().includes(x)))
  const jump = (t: SettingsTab, sec?: string) => {
    setQ('')
    nav('/settings/' + t)
    if (sec) setTimeout(() => document.getElementById(sec)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120)
    else window.scrollTo({ top: 0 })
  }
  const companies = useConfig().companies.items
  // a company-limited HR person can only add outlets to his own companies; only the Super Admin moves outlets between companies
  const coOptions = companies.filter((c) => isSuper || !myCompanies.length || myCompanies.includes(c.id)).map((c) => ({ value: c.id, label: c.name }))
  const [policy, setPolicy] = useState(false)
  const [outlet, setOutlet] = useState<V | null>(null)
  const [job, setJob] = useState<V | null>(null)
  const [msg, setMsg] = useState('')
  const [install, setInstall] = useState<BIPEvent | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const backupRef = useRef<HTMLDivElement>(null)

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
    { key: 'ticketValue', label: 'Estimated ticket value', type: 'money' },
    { key: 'defaultMinContractMonths', label: 'Default minimum contract (months)', type: 'number' },
    { key: 'defaultPenalty', label: 'Default early-termination penalty', type: 'money' },
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
      const replace = confirm('Replace ALL current data (for everyone in the cloud) with this backup?\n\nOK = Replace everything\nCancel = Merge (add/update records)')
      await importBackup(data, replace ? 'replace' : 'merge')
      setMsg(`Imported ${data.workers.length} workers (${replace ? 'replaced' : 'merged'}).`)
    } catch (e) { setMsg('Import failed: ' + (e as Error).message) }
  }
  const lastBackup = localStorage.getItem('fwm-last-backup')

  return (
    <div className="page">
      <div className="page-h"><div><h1>Settings</h1><p className="muted">{TABS.find((t) => t.id === tab)?.label} · {TABS.find((t) => t.id === tab)?.sub}</p></div></div>
      <div className="set-layout">
        <nav className="set-nav" aria-label="Settings sections">
          <div className="set-search">
            <Icon name="search" size={16} />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a setting…" aria-label="Find a setting" />
            {hits.length > 0 && (
              <ul className="set-hits" role="listbox">{hits.slice(0, 8).map(([t, id, w]) => (
                <li key={id}><button type="button" onClick={() => jump(t, id)}><strong>{TITLES[id] || w}</strong><small className="muted">{TABS.find((x) => x.id === t)?.label}</small></button></li>
              ))}</ul>
            )}
            {q.trim().length >= 2 && !hits.length && <div className="set-hits"><p className="muted small">No setting matches “{q}”.</p></div>}
          </div>
          <div className="set-tabs" role="tablist">
            {visible.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => jump(t.id)}>
                <Icon name={t.icon} size={18} /><span>{t.label}</span>{!!badges[t.id] && <b className="badge">{badges[t.id]}</b>}
              </button>
            ))}
          </div>
        </nav>
        <div className="set-body" role="tabpanel">
      {tab === 'account' && <>
        <Sec id="s-account"><AccountCard /></Sec>
        <Sec id="s-password"><Card title="Change password"><ChangePasswordInline /></Card></Sec>
        <Sec id="s-signout"><SignOutRow /></Sec>
      </>}

      {tab === 'users' && <>
        {canApproveUsers && !isAdmin && <Sec id="s-pending"><PendingUsersPanel /></Sec>}
        {isAdmin && <Sec id="s-users"><UsersCard /></Sec>}
        {isSuper && <Sec id="s-approvers"><UserApprovalRulesCard /></Sec>}
        {isSuper && <Sec id="s-hrflags"><HrFlagsCard /></Sec>}
        <Sec id="s-audit"><AuditCard /></Sec>
      </>}

      {tab === 'org' && <>
        <Sec id="s-companies"><CompaniesCard /></Sec>
        <Sec id="s-outlets">
      <Card title={`Outlets / business units (${outlets.length})`} actions={canWrite && <Btn kind="primary" small icon="plus" onClick={() => setOutlet({ type: 'Restaurant', companyId: coOptions[0]?.value || DEFAULT_COMPANY_ID })}>Add outlet</Btn>}>
        {outlets.length === 0 ? <p className="muted">No outlets yet. Add your restaurants, shops, hotels…</p> : (
          <ul className="rows">
            {outlets.map((o) => (
              <li key={o.id}>
                <LogoImg path={outletLogo(o)} size={36} title={o.name} />
                <div className="r-main"><strong>{o.name}</strong><small>{companies.length > 1 ? `${companyName(companies, outletCompany(o))} · ` : ''}{o.type}{o.manager ? ` · ${o.manager}` : ''} · {workers.filter((w) => w.outletId === o.id).length} workers</small></div>
                <div className="r-act"><LogoEdit kind="outlet" id={o.id} path={o.logo} name={o.name} /><Btn small kind="ghost" icon="edit" title="Edit outlet" onClick={() => setOutlet(o as unknown as V)} /></div>
              </li>
            ))}
          </ul>
        )}
      </Card>
        </Sec>
      </>}

      {tab === 'workers' && <>
        <Sec id="s-policy">
      <Card title="Company & policy" actions={canWrite && <Btn small icon="edit" onClick={() => setPolicy(true)}>Edit</Btn>}>
        <dl className="kv">
          <div><dt>Company</dt><dd>{s.companyName}</dd></div>
          <div><dt>Alert lead times</dt><dd>{[...s.leadTimes].sort((a, b) => b - a).join(' / ')} days</dd></div>
          <div><dt>Annual leave</dt><dd>{s.annualLeaveDays} days/yr · carry-forward {s.maxCarryForward ? `max ${s.maxCarryForward}` : 'unlimited'}</dd></div>
          <div><dt>Flight ticket</dt><dd>1 per {s.ticketEveryMonths} months (~RM {s.ticketValue}), accumulates</dd></div>
          <div><dt>Contract defaults</dt><dd>{s.defaultMinContractMonths} months min · RM {s.defaultPenalty} penalty (prorated)</dd></div>
        </dl>
      </Card>
        </Sec>
        <Sec id="s-jobs">
      <Card title="Job / skill categories" actions={canWrite && <Btn small icon="plus" onClick={() => setJob({ businessType: 'Restaurant' })}>Add category</Btn>}>
        <p className="muted small">Skill levels: {SKILL_LEVELS.join(', ')}. Tap a category to rename or delete.</p>
        <div className="jobs">
          {BUSINESS_TYPES.map((bt) => (
            <div key={bt} className="jobs-g">
              <h4>{bt}</h4>
              <div className="row wrap gap-s">
                {jobs.filter((j) => j.businessType === bt).sort((a, b) => a.name.localeCompare(b.name)).map((j) => (
                  <button key={j.id} className="chip-btn" onClick={() => setJob(j as unknown as V)}><Chip tone="teal">{j.name}</Chip></button>
                ))}
                {canWrite && <button className="chip-btn" onClick={() => setJob({ businessType: bt })}><Chip>+ add</Chip></button>}
              </div>
            </div>
          ))}
        </div>
      </Card>
        </Sec>
        <Sec id="s-vault"><VaultSettingsCard /></Sec>
      </>}

      {tab === 'passport' && <>
        <Sec id="s-passport"><PassportSettingsCard /></Sec>
        <Sec id="s-reasons"><EmergencyReasonsCard /></Sec>
        <Sec id="s-consent"><ConsentTranslationsCard /></Sec>
      </>}

      {tab === 'requests' && <Sec id="s-rules"><ApprovalRulesCard /></Sec>}

      {tab === 'notifications' && <>
        <Sec id="s-phone"><PhoneAlertsCard /></Sec>
        <Sec id="s-myalerts"><MyAlertsCard /></Sec>
        {isSuper ? <Sec id="s-notify"><NotificationsCard /></Sec> : <p className="muted small">WhatsApp / SMS / email delivery is set up by the Super Admin (off by default).</p>}
      </>}

      {tab === 'data' && <>
      <div ref={backupRef} id="s-backup" className="set-sec">
        <Card title="Backup & data">
          <p className="small">Your data is stored in the cloud and shared with your team. A JSON backup is still a good extra safety copy (it contains personal data — keep it safe). Restoring a backup sends its records to the cloud for everyone.</p>
          <p className="small">Last backup: <strong>{lastBackup || 'never'}</strong> · Workers: {workers.length}</p>
          <div className="row gap-s wrap">
            <Btn kind="primary" icon="download" onClick={doExport}>Download backup (JSON)</Btn>
            {canWrite && <Btn icon="upload" onClick={() => fileRef.current?.click()}>Restore / import backup</Btn>}
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = '' }} />
            {canWrite && <Btn icon="users" onClick={async () => { if (confirm('Load sample (fake DEMO) workers and outlets? Existing data is kept. Everyone on your team will see them.')) { await loadSampleData(); setMsg('Sample data loaded.') } }}>Load sample data</Btn>}
            <Btn kind="ghost" icon="download" onClick={async () => { if (confirm('Remove the copy on this device and download everything again from the cloud? Cloud data is not affected.')) { await clearDeviceCopy(); await syncNow(); setMsg('Re-downloaded from the cloud.') } }}>Re-download from cloud</Btn>
            <Btn kind="ghost" icon="upload" onClick={() => { void syncNow(); setMsg('Sync started.') }}>Sync now</Btn>
          </div>
          {msg && <p className="ok" role="status">{msg}</p>}
        </Card>
      </div>
        <Sec id="s-calendar">
      <Card title="Calendar & in-app notifications">
        {!isNative() && <p className="small">In-app notifications: <strong>{notifySupported() ? Notification.permission : 'not supported'}</strong>. A summary of urgent items also shows when you open the app.</p>}
        <div className="row gap-s wrap">
          {!isNative() && notifySupported() && Notification.permission !== 'granted' && <Btn icon="bell" onClick={async () => { await requestNotify(); setMsg('Notification permission: ' + Notification.permission) }}>Enable notifications</Btn>}
          <Btn icon="cal" onClick={() => download(`all-expiries-${todayISO()}.ics`, buildICS(buildAlerts(workers, { ...s, leadTimes: [100000] }).filter((a) => a.date), Math.max(...s.leadTimes)), 'text/calendar')}>Export all expiries (.ics)</Btn>
        </div>
      </Card>
        </Sec>
      </>}

      {tab === 'about' && <Sec id="s-about">
      <Card title="About FW Manager">
        <p className="small">FW Manager <strong>{APP_VERSION}</strong> — foreign worker records, documents, passport safekeeping and requests, shared live with your team.</p>
        {install && <p><Btn kind="primary" icon="download" onClick={() => install.prompt()}>Install app</Btn></p>}
        {!isNative() && <>
          <p className="muted small"><strong>iPhone:</strong> open in Safari → Share → “Add to Home Screen”. <strong>Android:</strong> install the app below, or in Chrome → menu → “Install app”.</p>
          <p className="small"><a className="btn btn-secondary" href={ANDROID_APK_URL} rel="noopener">⬇ Download Android app (APK)</a></p>
          <p className="muted small">After downloading, open the file and allow “Install unknown apps” for your browser when Android asks.</p>
        </>}
      </Card>
      </Sec>}
        </div>
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
        <FormModal title={outlet.id ? 'Edit outlet' : 'Add outlet'} initial={{ ...outlet, companyId: outlet.companyId || DEFAULT_COMPANY_ID }} onClose={() => setOutlet(null)}
          fields={[{ key: 'name', label: 'Outlet name', required: true, full: true },
            ...(isSuper || !outlet.id ? [{ key: 'companyId', label: 'Company', type: 'select' as const, options: coOptions, required: true }] : []), { key: 'type', label: 'Business type', type: 'select', options: [...BUSINESS_TYPES], required: true }, { key: 'manager', label: 'Manager / PIC' }, { key: 'address', label: 'Address', type: 'textarea' }]}
          onDelete={outlet.id ? () => { if (workers.some((w) => w.outletId === outlet.id)) alert('Workers are assigned to this outlet; they will show “—”.'); db.outlets.delete(String(outlet.id)) } : undefined}
          onSave={(v) => db.outlets.put({ id: (outlet.id as string) || uid(), name: String(v.name), type: v.type as BusinessType, manager: v.manager as string, address: v.address as string, companyId: String(v.companyId || outlet.companyId || DEFAULT_COMPANY_ID), ...(outlet.logo ? { logo: String(outlet.logo) } : {}) }).then(() => {})} />
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

/** Settings → Account → Change password (asks for the current password) */
function ChangePasswordInline() {
  const [done, setDone] = useState(false)
  const [k, setK] = useState(0)
  return done
    ? <div><p className="ok">✅ Your password is changed. Use it next time you sign in.</p><Btn small kind="ghost" onClick={() => { setDone(false); setK(k + 1) }}>Change again</Btn></div>
    : <SetPasswordForm key={k} mode="change" onDone={() => setDone(true)} />
}
