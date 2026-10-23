import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Btn, Card, Chip } from './ui'
import { db } from '../lib/db'
import { normRole, useAuth } from '../lib/auth'
import { ROLES, ROLE_HELP, ROLE_LABEL } from '../lib/workflow'
import { supabase, type Profile, type Role } from '../lib/supabase'
import { discardLocalData, localOnlyData, syncNow, uploadLocalData, useSyncStatus, type LocalOnly } from '../lib/sync'
import { currentSubscription, disablePush, enablePush, isIOS, isStandalone, pushSupported, sendTestPush } from '../lib/push'
import { isNative } from '../lib/platform'
import { enableNativeAlerts, permissionState, reschedule, scheduleInfo, sendTestNotification } from '../lib/localNotify'
import { useSettings, useWorkers } from '../lib/hooks'
import { useConfig } from '../lib/config'
import { scopeLabel } from '../lib/companies'
import { PendingItem, ScopePicker, byLine } from './userApprovals'

const LABEL = { synced: 'Synced', syncing: 'Syncing…', offline: 'Offline', error: 'Sync error', off: 'Not syncing' } as const

export function SyncPill() {
  const s = useSyncStatus()
  const nav = useNavigate()
  const text = s.state === 'offline' && s.pending ? `Offline · ${s.pending} to send` : LABEL[s.state]
  return (
    <button className={`sync-pill ${s.state}`} title={s.error || text} aria-label={`Cloud sync: ${text}`} onClick={() => { void syncNow(); nav('/settings') }}>
      <i /><span className="lbl">{text}</span>
    </button>
  )
}

function useLocalOnly() {
  // re-check whenever local data changes
  const tick = useLiveQuery(async () => (await db.workers.count()) + (await db.outlets.count()) + (await db.synced.count()), [])
  const [lo, setLo] = useState<LocalOnly | null>(null)
  useEffect(() => { void localOnlyData().then(setLo) }, [tick])
  return lo
}

/** One-time migration of data typed in before cloud sync existed. */
export function LocalDataBanner({ compact }: { compact?: boolean }) {
  const lo = useLocalOnly()
  const { canWrite } = useAuth()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  if (!lo || (lo.workers.length === 0 && lo.outlets.length === 0)) {
    return compact ? null : <p className="muted small">✓ All data on this device is in the cloud.{msg && <span className="ok"> {msg}</span>}</p>
  }
  return (
    <div className="banner amber" role="status">
      <strong>This device has data saved before cloud sync</strong>
      <span className="small">{lo.workers.length} worker(s), {lo.outlets.length} outlet(s) are only on this device. Upload them so your team can see them (records with the same ID are not duplicated).</span>
      <div className="row gap-s wrap">
        {canWrite ? <Btn kind="primary" small icon="upload" disabled={busy} onClick={async () => {
          setBusy(true)
          try { const n = await uploadLocalData(); setMsg(`Uploaded ${n} worker(s) to the cloud.`) } catch (e) { setMsg('Upload failed: ' + (e as Error).message) } finally { setBusy(false) }
        }}>{busy ? 'Uploading…' : "Upload this device's data to the cloud"}</Btn> : <span className="small muted">Ask an Admin/Manager to upload it from their account on this device.</span>}
        <Btn small kind="ghost" icon="trash" disabled={busy} onClick={async () => { if (confirm('Remove these records from this device only? (They are NOT in the cloud, so they will be gone.)')) await discardLocalData() }}>Remove from this device</Btn>
      </div>
      {msg && <span className="small">{msg}</span>}
    </div>
  )
}

export function AccountCard() {
  const { session, profile, signOut, myOutlets } = useAuth()
  const s = useSyncStatus()
  const outlets = useLiveQuery(() => db.outlets.toArray(), [], [])
  const outletName = (id: string) => outlets.find((o) => o.id === id)?.name || id
  return (
    <Card title="Account & cloud sync">
      <dl className="kv">
        <div><dt>Signed in as</dt><dd>{profile?.full_name ? `${profile.full_name} · ` : ''}{session?.user.email}</dd></div>
        <div><dt>Access</dt><dd><Chip tone={ROLE_TONE[normRole(profile?.role) || ''] || 'gray'}>{roleName(profile?.role)}</Chip>{myOutlets.length > 0 && <small className="muted"> · outlets: {myOutlets.map((id) => outletName(id)).join(', ')}</small>}</dd></div>
        <div><dt>Sync</dt><dd>{LABEL[s.state]}{s.pending ? ` · ${s.pending} change(s) waiting` : ''}{s.lastSync ? ` · last ${new Date(s.lastSync).toLocaleTimeString()}` : ''}{s.state === 'error' && s.error ? ` — ${s.error}` : ''}</dd></div>
      </dl>
      <p className="muted small">Your data is saved in the secure cloud and shared live with your team. The app also works offline and sends changes when you are back online.</p>
      <LocalDataBanner />
      <div className="row gap-s wrap mt-s">
        <Btn icon="upload" onClick={() => syncNow()}>Sync now</Btn>
        <Btn kind="ghost" icon="exit" onClick={async () => {
          const warn = s.pending ? `\n\n⚠️ ${s.pending} change(s) are not uploaded yet and will be lost.` : ''
          if (confirm('Sign out? The copy on this device will be removed (it stays in the cloud).' + warn)) await signOut(true)
        }}>Sign out</Btn>
      </div>
    </Card>
  )
}

const ROLE_TONE: Record<string, string> = { super_admin: 'purple', hr_admin: 'blue', hr_manager: 'teal', outlet_manager: 'amber', viewer: 'gray' }
const roleName = (r?: string) => ROLE_LABEL[normRole(r) || ''] || '—'

export function UsersCard() {
  const { session, isSuper, myCompanies, myOutlets, canApproveUsers } = useAuth()
  const companies = useConfig().companies.items
  const [users, setUsers] = useState<Profile[]>([])
  const [err, setErr] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const outlets = useLiveQuery(() => db.outlets.toArray(), [], [])
  const load = async () => {
    const { data, error } = await supabase.from('profiles').select('*').order('created_at')
    if (error) setErr(error.message); else { setUsers(data as Profile[]); setErr('') }
  }
  useEffect(() => {
    void load()
    const ch = supabase.channel('users-card').on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => { void load() }).subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [])
  const update = async (id: string, patch: Partial<Profile>) => {
    const { error } = await supabase.from('profiles').update(patch).eq('id', id)
    if (error) alert(/at least one active/i.test(error.message) ? 'You need at least one active Super Admin.' : error.message.replace(/^.*?ERROR:\s*/, ''))
    await load()
  }
  const pending = users.filter((u) => u.status === 'pending')
  const others = users.filter((u) => u.status !== 'pending')
  const roles = ROLES.filter((r) => isSuper || (r !== 'super_admin' && r !== 'hr_admin'))
  // what a company-limited HR Admin may hand out: only his own companies
  const allowed: string[] | '*' = isSuper || (!myCompanies.length && !myOutlets.length) ? '*' : myCompanies
  return (
    <Card title={`Users (${users.length})`} actions={<Btn small kind="ghost" icon="upload" title="Refresh" onClick={load} />}>
      <p className="muted small">Staff create their own account on the sign-in page (“Create account”) and can pick their company / outlet there. New sign-ups appear on the dashboard under <strong>Needs my action</strong> and here — approve them, pick their role and the companies / outlets they work for.</p>
      <ul className="small muted role-help">{ROLES.map((r) => <li key={r}><strong>{ROLE_LABEL[r]}</strong>: {ROLE_HELP[r]}</li>)}</ul>
      {err && <p className="err">{err}</p>}
      {pending.length > 0 && <>
        <p className="warn small">{pending.length} person(s) waiting for approval</p>
        {canApproveUsers && <ul className="rows users">{pending.map((u) => <PendingItem key={u.id} u={u} companies={companies} outlets={outlets} />)}</ul>}
      </>}
      <ul className="rows users">
        {others.map((u) => {
          const role = normRole(u.role) || 'viewer'
          const locked = !isSuper && (role === 'super_admin' || role === 'hr_admin')
          const outs = u.outlet_ids || []
          const cos = u.company_ids || []
          const scoped = outs.length + cos.length > 0
          const by = byLine(u)
          return (
            <li key={u.id} className="user-row">
              <div className="r-main">
                <strong>{u.full_name || u.email}{u.id === session?.user.id ? ' (you)' : ''}</strong>
                <small>{u.email} · <Chip tone={u.status === 'active' ? 'green' : 'gray'}>{u.status === 'active' ? 'Active' : u.rejected_at && !u.approved_at ? 'Rejected' : 'Switched off'}</Chip> <Chip tone={ROLE_TONE[role]}>{ROLE_LABEL[role]}</Chip></small>
                {role !== 'super_admin' && (
                  <small className={role === 'outlet_manager' && !scoped ? 'warn' : 'muted'}>
                    {role === 'outlet_manager' ? 'Outlets: ' : 'Sees: '}
                    {scoped ? scopeLabel(companies, outlets, cos, outs) : role === 'outlet_manager' ? 'none yet — he will see no workers' : 'all companies'}
                  </small>
                )}
                {by && <small className="muted">{by}</small>}
              </div>
              <div className="r-act">
                <select aria-label={`Role for ${u.email}`} value={role} disabled={locked} onChange={(e) => update(u.id, { role: e.target.value as Role })}>
                  {(locked ? ROLES : roles).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
                {role !== 'super_admin' && !locked && u.id !== session?.user.id && <Btn small kind="ghost" icon="store" onClick={() => setOpen(open === u.id ? null : u.id)}>{role === 'outlet_manager' ? 'Outlets' : 'Companies'}</Btn>}
                {!locked && u.status !== 'active' && <Btn small kind="primary" icon="check" onClick={() => update(u.id, { status: 'active' })}>Re-activate</Btn>}
                {!locked && u.status === 'active' && u.id !== session?.user.id && <Btn small kind="ghost" icon="x" onClick={() => { if (confirm(`Switch off access for ${u.email}?`)) void update(u.id, { status: 'inactive' }) }}>Deactivate</Btn>}
              </div>
              {open === u.id && (
                <div className="outlet-pick">
                  {outlets.length === 0 && <p className="muted small">Add outlets first (Settings → Outlets).</p>}
                  <p className="muted small">{role === 'outlet_manager' ? 'Tick his outlets.' : 'Tick a whole company or single outlets.'} {role !== 'outlet_manager' && (isSuper ? 'Nothing ticked = all companies.' : 'You can only give your own companies.')}</p>
                  <ScopePicker companies={companies} outlets={outlets} allowed={allowed} outletsOnly={role === 'outlet_manager'}
                    value={{ companies: cos, outlets: outs }} onChange={(v) => update(u.id, { company_ids: v.companies, outlet_ids: v.outlets })} />
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

export function PhoneAlertsCard() {
  return isNative() ? <NativeAlertsCard /> : <WebPushCard />
}

/** Android / iOS app: reminders are scheduled on the phone itself (no server push needed). */
function NativeAlertsCard() {
  const workers = useWorkers()
  const settings = useSettings()
  const [perm, setPerm] = useState<string>('…')
  const [info, setInfo] = useState(scheduleInfo())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => { void permissionState().then(setPerm) }, [])
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setMsg('')
    try { await fn(); setMsg(ok) } catch (e) { setMsg('⚠️ ' + (e as Error).message) } finally { setBusy(false); setPerm(await permissionState()); setInfo(scheduleInfo()) }
  }
  const on = perm === 'granted'
  return (
    <Card title="Phone alerts">
      <p className="small">This app reminds you <strong>at 8:00 AM (Malaysia time)</strong> — even when it is closed and offline: a <strong>daily summary</strong> of urgent items, plus a reminder <strong>{[...settings.leadTimes].sort((a, b) => b - a).join(' / ')} days before</strong> and <strong>on the day</strong> each passport, permit, medical or contract expires, when a worker becomes eligible for a flight ticket, completes the minimum contract, or is due back from leave.</p>
      <p className="small">Status on this phone: <strong>{on ? 'On ✅' : perm === '…' ? '…' : 'Off'}</strong>{on && info ? ` · ${info.count} reminder(s) planned${info.next ? `, next ${new Date(info.next).toLocaleString()}` : ''}` : ''}</p>
      <div className="row gap-s wrap">
        {!on && <Btn kind="primary" icon="bell" disabled={busy} onClick={() => run(async () => { await enableNativeAlerts(); await reschedule(workers, settings) }, 'Phone alerts are on.')}>Turn on phone alerts</Btn>}
        {on && <Btn icon="bell" disabled={busy} onClick={() => run(sendTestNotification, 'Test alert coming in a few seconds…')}>Send me a test alert</Btn>}
        {on && <Btn kind="ghost" icon="upload" disabled={busy} onClick={() => run(() => reschedule(workers, settings), 'Reminders updated.')}>Refresh reminders</Btn>}
      </div>
      <p className="muted small">Reminders update automatically whenever data changes. Open the app at least once every couple of weeks so new items are included. To stop alerts: phone Settings → Apps → FW Manager → Notifications.</p>
      {msg && <p className="small" role="status">{msg}</p>}
    </Card>
  )
}

function WebPushCard() {
  const [on, setOn] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => { void currentSubscription().then((s) => setOn(!!s)) }, [])
  const ios = isIOS()
  const needsHome = ios && !isStandalone()
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setMsg('')
    try { await fn(); setMsg(ok) } catch (e) { setMsg('⚠️ ' + (e as Error).message) } finally { setBusy(false); setOn(!!(await currentSubscription())) }
  }
  return (
    <Card title="Phone alerts">
      <p className="small">Get <strong>one summary alert every morning at 8:00 AM (Malaysia time)</strong> for urgent items — expiring passports, permits and medicals, workers not back from leave, leave waiting for approval, flight tickets, missing checkout memos and contract ends — even when the app is closed.</p>
      {needsHome && (
        <div className="banner small">
          <strong>iPhone: add the app to your Home Screen first</strong>
          <span>1. In Safari tap the Share button (square with arrow) → <strong>Add to Home Screen</strong>.<br />2. Open <strong>FW Manager</strong> from your Home Screen and sign in.<br />3. Come back here and tap <strong>Turn on phone alerts</strong>. (Needs iOS 16.4 or newer.)</span>
        </div>
      )}
      <p className="small">Status on this device: <strong>{on === null ? '…' : on ? 'On ✅' : 'Off'}</strong>{!pushSupported() && !needsHome ? ' (not supported by this browser)' : ''}</p>
      <div className="row gap-s wrap">
        {!on && <Btn kind="primary" icon="bell" disabled={busy || needsHome} onClick={() => run(enablePush, 'Phone alerts are on for this device.')}>Turn on phone alerts</Btn>}
        {on && <Btn icon="bell" disabled={busy} onClick={() => run(async () => { const r = await sendTestPush(); if (!r.sent) throw new Error('No alert was delivered. Try turning alerts off and on again.') }, 'Test alert sent — check your notifications.')}>Send me a test alert</Btn>}
        {on && <Btn kind="ghost" icon="x" disabled={busy} onClick={() => run(disablePush, 'Phone alerts are off for this device.')}>Turn off</Btn>}
      </div>
      {msg && <p className="small" role="status">{msg}</p>}
    </Card>
  )
}
