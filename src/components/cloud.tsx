import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Btn, Card, Chip } from './ui'
import { db } from '../lib/db'
import { useAuth } from '../lib/auth'
import { supabase, type Profile, type Role } from '../lib/supabase'
import { discardLocalData, localOnlyData, syncNow, uploadLocalData, useSyncStatus, type LocalOnly } from '../lib/sync'
import { currentSubscription, disablePush, enablePush, isIOS, isStandalone, pushSupported, sendTestPush } from '../lib/push'
import { isNative } from '../lib/platform'
import { enableNativeAlerts, permissionState, reschedule, scheduleInfo, sendTestNotification } from '../lib/localNotify'
import { useSettings, useWorkers } from '../lib/hooks'

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
  const { session, profile, signOut } = useAuth()
  const s = useSyncStatus()
  return (
    <Card title="Account & cloud sync">
      <dl className="kv">
        <div><dt>Signed in as</dt><dd>{profile?.full_name ? `${profile.full_name} · ` : ''}{session?.user.email}</dd></div>
        <div><dt>Access</dt><dd><Chip tone={profile?.role === 'admin' ? 'purple' : profile?.role === 'manager' ? 'teal' : 'gray'}>{roleName(profile?.role)}</Chip></dd></div>
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

const roleName = (r?: string) => ({ admin: 'Admin (full control)', manager: 'Manager (add & edit)', viewer: 'Viewer (read only)' })[r || ''] || '—'

export function UsersCard() {
  const { session } = useAuth()
  const [users, setUsers] = useState<Profile[]>([])
  const [err, setErr] = useState('')
  const load = async () => {
    const { data, error } = await supabase.from('profiles').select('*').order('created_at')
    if (error) setErr(error.message); else { setUsers(data as Profile[]); setErr('') }
  }
  useEffect(() => { void load() }, [])
  const update = async (id: string, patch: Partial<Profile>) => {
    const { error } = await supabase.from('profiles').update(patch).eq('id', id)
    if (error) alert(error.message.includes('at least one active admin') ? 'You need at least one active Admin.' : error.message)
    await load()
  }
  const pending = users.filter((u) => u.status === 'pending')
  return (
    <Card title={`Users (${users.length})`} actions={<Btn small kind="ghost" icon="upload" title="Refresh" onClick={load} />}>
      <p className="muted small">Staff create their own account on the sign-in page (“Create account”). They appear here as <strong>Waiting</strong> — approve them and pick their access. Admin = everything incl. users · Manager = add & edit data · Viewer = read only.</p>
      {pending.length > 0 && <p className="warn small">{pending.length} person(s) waiting for approval</p>}
      {err && <p className="err">{err}</p>}
      <ul className="rows users">
        {users.map((u) => (
          <li key={u.id}>
            <div className="r-main">
              <strong>{u.full_name || u.email}{u.id === session?.user.id ? ' (you)' : ''}</strong>
              <small>{u.email} · <Chip tone={u.status === 'active' ? 'green' : u.status === 'pending' ? 'amber' : 'gray'}>{u.status === 'pending' ? 'Waiting' : u.status === 'active' ? 'Active' : 'Switched off'}</Chip></small>
            </div>
            <div className="r-act">
              <select aria-label={`Access for ${u.email}`} value={u.role} onChange={(e) => update(u.id, { role: e.target.value as Role })}>
                <option value="admin">Admin</option><option value="manager">Manager</option><option value="viewer">Viewer</option>
              </select>
              {u.status !== 'active' && <Btn small kind="primary" icon="check" onClick={() => update(u.id, { status: 'active' })}>Approve</Btn>}
              {u.status === 'active' && u.id !== session?.user.id && <Btn small kind="ghost" icon="x" onClick={() => { if (confirm(`Switch off access for ${u.email}?`)) void update(u.id, { status: 'inactive' }) }}>Deactivate</Btn>}
            </div>
          </li>
        ))}
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
