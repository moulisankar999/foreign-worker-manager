import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Btn, Card, Chip } from './ui'
import { db } from '../lib/db'
import { normRole, useAuth } from '../lib/auth'
import { ROLES, ROLE_HELP, ROLE_LABEL, rolesUpTo } from '../lib/workflow'
import { supabase, type Profile, type Role } from '../lib/supabase'
import { discardLocalData, localOnlyData, syncNow, uploadLocalData, useSyncStatus, type LocalOnly } from '../lib/sync'
import { currentSubscription, disablePush, enablePush, isIOS, isStandalone, pushSupported, sendTestPush } from '../lib/push'
import { isNative } from '../lib/platform'
import { enableNativeAlerts, permissionState, reschedule, scheduleInfo, sendTestNotification } from '../lib/localNotify'
import { useSettings, useWorkers } from '../lib/hooks'
import { useConfig } from '../lib/config'
import { scopeLabel } from '../lib/companies'
import { useSignOut } from './userMenu'
import { PendingTable, ScopePicker, byLine } from './userApprovals'
import { DataTable, Details } from './dataTable'
import { Actions, IconAction } from './iconAction'
import { StatusChip, UserActionButtons, at, statusLine, useUserPerms } from './userActions'
import { setDirty, toast } from './toast'
import { AddUserDialog } from './addUser'
import type { Outlet } from '../lib/types'

const LABEL = { synced: 'Synced', syncing: 'Syncing…', offline: 'Offline', error: 'Sync error', off: 'Not syncing' } as const

export function SyncPill() {
  const s = useSyncStatus()
  const nav = useNavigate()
  const text = s.state === 'offline' && s.pending ? `Offline · ${s.pending} to send` : LABEL[s.state]
  return (
    <button className={`sync-pill ${s.state}`} title={s.error || text} aria-label={`Cloud sync: ${text}`} onClick={() => { void syncNow(); nav('/settings/data') }}>
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
  const { session, profile, myOutlets } = useAuth()
  const s = useSyncStatus()
  const out = useSignOut()
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
        <Btn kind="ghost" icon="exit" disabled={out.busy} onClick={() => { void out.run() }}>Switch user / Sign out</Btn>
      </div>
    </Card>
  )
}

const ROLE_TONE: Record<string, string> = { super_admin: 'purple', general_manager: 'indigo', hr_admin: 'blue', hr_manager: 'teal', outlet_manager: 'amber', viewer: 'gray' }
const roleName = (r?: string) => ROLE_LABEL[normRole(r) || ''] || '—'

export function UsersCard() {
  const { session, isSuper, isGm, myCompanies, myOutlets, canApproveUsers, creatableRoles, role: myRole } = useAuth()
  const seeRoles = rolesUpTo(myRole)
  const [adding, setAdding] = useState(false)
  const [focus, setFocus] = useState<{ key: string } | null>(null)
  const [dirtyIds, setDirtyIds] = useState<string[]>([])
  const companies = useConfig().companies.items
  const [users, setUsers] = useState<Profile[]>([])
  const [err, setErr] = useState('')
  const outlets = useLiveQuery(() => db.outlets.toArray(), [], [])
  const load = async () => {
    const { data, error } = await supabase.from('profiles_v').select('*').order('created_at')
    if (error) setErr(error.message); else { setUsers(data as Profile[]); setErr('') }
  }
  useEffect(() => {
    void load()
    const ch = supabase.channel('users-card').on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => { void load() }).subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [])
  const pending = users.filter((u) => u.status === 'pending')
  const others = users.filter((u) => u.status !== 'pending' && u.status !== 'deleted')
  const deleted = users.filter((u) => u.status === 'deleted')
  const [showDel, setShowDel] = useState(false)
  const permsFor = useUserPerms(users)
  const counts = { active: others.filter((u) => u.status === 'active').length, paused: others.filter((u) => u.status === 'paused').length }
  // roles I may hand out: always below my own (CEO: never another CEO; GM: never CEO / GM; HR Admin: never CEO / GM / HR Admin)
  const roles = ROLES.filter((r) => r !== 'super_admin' && (isSuper || (r !== 'general_manager' && (isGm || r !== 'hr_admin'))))
  // what a company-limited HR Admin may hand out: only his own companies
  const allowed: string[] | '*' = isSuper || isGm || (!myCompanies.length && !myOutlets.length) ? '*' : myCompanies
  // the CEO's row is only "name + CEO" for everyone else
  const hiddenCeo = (u: Profile) => !isSuper && normRole(u.role) === 'super_admin'
  return (
    <Card title={`Users (${users.length})`} actions={<>{creatableRoles.length > 0 && <Btn small kind="primary" icon="plus" onClick={() => setAdding(true)}>Add user</Btn>}<IconAction kind="refresh" label="Refresh the list" onClick={() => void load()} /></>}>
      <p className="muted small">Staff can create their own account on the sign-in page (“Create account”) and wait for approval{creatableRoles.length > 0 ? <> — or press <strong>Add user</strong> to add someone directly (active at once, with a temporary password)</> : ''}. New sign-ups appear on the dashboard under <strong>Needs my action</strong> and here — approve them, pick their role and the companies / outlets they work for.</p>
      {adding && <AddUserDialog onClose={() => { setAdding(false); void load() }} onEditExisting={(id) => { setAdding(false); setFocus({ key: id }) }} />}
      <ul className="small muted role-help">{seeRoles.map((r) => <li key={r}><strong>{ROLE_LABEL[r]}</strong>: {ROLE_HELP[r]}</li>)}</ul>
      {err && <p className="err">{err}</p>}
      <div className="row gap-s wrap small"><Chip tone="green">Active {counts.active}</Chip><Chip tone="amber">Paused {counts.paused}</Chip><Chip tone="blue">Pending {pending.length}</Chip>{deleted.length > 0 && <Chip tone="red">Deleted {deleted.length}</Chip>}</div>
      {pending.length > 0 && <>
        <p className="warn small">{pending.length} person(s) waiting for approval</p>
        {canApproveUsers && <PendingTable users={pending} companies={companies} outlets={outlets} />}
      </>}
      <DataTable label="Users" rows={others} rowKey={(u) => u.id} rowId={(u) => 'user-' + u.id} rowTestId={(u) => `user-${u.email}`} open={focus}
        rowClass={(u) => `${dirtyIds.includes(u.id) ? 'is-dirty' : ''}${focus?.key === u.id ? ' is-focus' : ''}${u.status === 'paused' ? ' dt-warn' : ''}`}
        search={(u) => hiddenCeo(u) ? (u.full_name || u.email || '') : `${u.full_name} ${u.email} ${roleName(u.role)} ${u.status}`} searchLabel="Search users"
        filters={[
          { key: 'role', label: 'Role', options: seeRoles.map((r) => ({ value: r, label: ROLE_LABEL[r] })), match: (u, v) => normRole(u.role) === v },
          { key: 'status', label: 'Status', options: [{ value: 'active', label: 'Active' }, { value: 'paused', label: 'Paused' }, { value: 'inactive', label: 'Switched off' }], match: (u, v) => !hiddenCeo(u) && u.status === v },
        ]}
        initialSort={{ key: 'name', dir: 'asc' }}
        canExpand={(u) => !hiddenCeo(u)}
        columns={[
          { key: 'name', label: 'Name', main: true, sort: (u) => (u.full_name || u.email || '').toLowerCase(),
            render: (u) => <>{u.full_name || u.email || 'user'}{u.id === session?.user.id ? ' (you)' : ''}{!hiddenCeo(u) && <small>{u.email}</small>}</> },
          { key: 'role', label: 'Role', sort: (u) => ROLES.indexOf(normRole(u.role) as Role), render: (u) => <><Chip tone={ROLE_TONE[normRole(u.role) || ''] || 'gray'}>{hiddenCeo(u) ? 'CEO' : roleName(u.role)}</Chip>{!hiddenCeo(u) && LEGACY[u.role as string] && <> <Chip tone="amber">{LEGACY[u.role as string]}</Chip></>}</> },
          { key: 'status', label: 'Status', hide: 'phone', sort: (u) => (hiddenCeo(u) ? '' : u.status), render: (u) => (hiddenCeo(u) ? null : <StatusChip u={u} />) },
          { key: 'scope', label: 'Sees', hide: 'tablet', render: (u) => (hiddenCeo(u) ? null : <ScopeText u={u} companies={companies} outlets={outlets} />) },
        ]}
        actions={(u) => (hiddenCeo(u) ? null : <Actions><UserActionButtons u={u} may={permsFor(u)} onDone={load} /></Actions>)}
        expand={(u) => <UserRow u={u} me={session?.user.id} roles={roles} allowed={allowed} companies={companies} outlets={outlets} may={permsFor(u)} onSaved={load}
          onDirty={(on) => setDirtyIds((l) => (on ? (l.includes(u.id) ? l : [...l, u.id]) : l.filter((x) => x !== u.id)))} />} />
      {deleted.length > 0 && <>
        <button type="button" className="link small" onClick={() => setShowDel(!showDel)}>{showDel ? 'Hide deleted users' : `Deleted users (${deleted.length})`}</button>
        {showDel && <DataTable label="Deleted users" dense rows={deleted} rowKey={(u) => u.id} initialSort={{ key: 'when', dir: 'desc' }}
          rowClass={() => 'dt-muted'}
          columns={[
            { key: 'name', label: 'Name', main: true, sort: (u) => (u.full_name || u.email || '').toLowerCase(), render: (u) => <>{u.full_name || u.email}<small>history kept</small></> },
            { key: 'by', label: 'Removed by', hide: 'phone', render: (u) => u.deleted_by_name || '—' },
            { key: 'when', label: 'When', sort: (u) => u.deleted_at || '', render: (u) => <span className="small">{at(u.deleted_at)}</span> },
          ]} />}
      </>}
    </Card>
  )
}

const LEGACY: Record<string, string> = { admin: 'Admin (old role)', manager: 'Manager (old role)' }
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))

/** One user's opened row in Settings → Users: details + edit role / companies / outlets, then press "Update" (nothing saves on change). */
function UserRow({ u, me, roles, allowed, companies, outlets, may, onSaved, onDirty }: {
  onDirty: (on: boolean) => void; u: Profile; me?: string; roles: Role[]; allowed: string[] | '*'; companies: ReturnType<typeof useConfig>['companies']['items']
  outlets: Outlet[]; may: ReturnType<ReturnType<typeof useUserPerms>>; onSaved: () => Promise<void> | void
}) {
  const { isSuper, isGm, can } = useAuth()
  const saved = { role: (normRole(u.role) || 'viewer') as Role, companies: u.company_ids || [], outlets: u.outlet_ids || [] }
  const legacy = LEGACY[u.role as string]
  const [d, setD] = useState(saved)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const key = `${u.id}|${u.role}|${saved.companies.join(',')}|${saved.outlets.join(',')}`
  useEffect(() => { setD(saved) }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const changed = d.role !== saved.role || !sameSet(d.companies, saved.companies) || !sameSet(d.outlets, saved.outlets)
  const dirty = changed || !!legacy
  const name = u.full_name || u.email || 'user'
  useEffect(() => { setDirty('user:' + u.id, changed, name, '#/settings/users'); onDirty(changed); return () => { setDirty('user:' + u.id, false); onDirty(false) } }, [changed, name, u.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const self = u.id === me
  // the CEO's row is only "name + CEO" for everyone else; GM rows are CEO-only
  const target = saved.role
  if (!isSuper && target === 'super_admin') return null
  const locked = self || (isGm && !can('users.roles')) || (!isSuper && (target === 'general_manager' || (!isGm && target === 'hr_admin')))
  const scoped = d.outlets.length + d.companies.length > 0
  const by = byLine(u)
  const sl = statusLine(u)
  const save = async () => {
    setBusy(true); setMsg(null)
    const patch: Partial<Profile> = {}
    if (d.role !== saved.role || legacy) patch.role = d.role
    if (!sameSet(d.companies, saved.companies) || !sameSet(d.outlets, saved.outlets) || d.role === 'super_admin' || d.role === 'general_manager') {
      patch.company_ids = d.role === 'super_admin' || d.role === 'general_manager' ? [] : d.companies
      patch.outlet_ids = d.role === 'super_admin' || d.role === 'general_manager' ? [] : d.outlets
    }
    if ((d.role === 'super_admin' || d.role === 'general_manager') && d.role !== saved.role &&
        !confirm(`Make ${name} ${d.role === 'super_admin' ? 'a CEO (full access to everything)' : 'General Manager (final approvals, with the powers you allow)'}?`)) { setBusy(false); return }
    const { data, error } = await supabase.from('profiles').update(patch).eq('id', u.id).select('role, company_ids, outlet_ids').maybeSingle()
    setBusy(false)
    if (error || !data) {
      const t = !error ? 'Not saved — this user is managed by another user manager.' : /at least one active/i.test(error.message) ? 'Not saved — you need at least one active CEO.' : 'Not saved — ' + error.message.replace(/^.*?ERROR:\s*/, '')
      setMsg({ ok: false, text: t }); toast(t, 'err'); return
    }
    const nowRole = ROLE_LABEL[normRole((data as Profile).role) || ''] || (data as Profile).role
    const scopeTxt = d.role === 'super_admin' || d.role === 'general_manager' ? '' : ` · ${scoped ? scopeLabel(companies, outlets, d.companies, d.outlets) : d.role === 'outlet_manager' ? 'no outlets yet' : 'all companies'}`
    const t = `Updated ✓ — ${name} is now ${nowRole}${scopeTxt}`
    setMsg({ ok: true, text: t }); toast(t)
    setDirty('user:' + u.id, false)
    setOpen(false)
    await onSaved()
  }
  return (
    <div className="user-row">
      <Details items={[
        ['Email', u.email],
        ['Status', <StatusChip u={u} />],
        [saved.role === 'outlet_manager' ? 'Outlets' : 'Sees', saved.role !== 'super_admin' && saved.role !== 'general_manager' && <ScopeText u={u} companies={companies} outlets={outlets} />],
        ['History', [by, sl].filter(Boolean).join(' · ')],
      ]} />
      {may.lastSuper && !self && <p className="small muted">Last active CEO — cannot be paused or deleted.</p>}
      {locked && self && <p className="small muted">This is you — someone else changes your own role.</p>}
      {!locked && (
        <div className="user-edit">
          <label className="small">Role{' '}
            <select aria-label={`Role for ${u.email}`} value={d.role} disabled={busy} onChange={(e) => { setMsg(null); setD({ ...d, role: e.target.value as Role }) }}>
              {(roles.includes(saved.role) ? roles : [saved.role, ...roles]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </label>
          {d.role !== 'super_admin' && d.role !== 'general_manager' && <Btn small kind="ghost" icon="store" onClick={() => setOpen(!open)}>{d.role === 'outlet_manager' ? 'Outlets' : 'Companies'}{scoped ? ` (${d.companies.length + d.outlets.length})` : ''}</Btn>}
        </div>
      )}
      {!locked && open && d.role !== 'super_admin' && d.role !== 'general_manager' && (
        <div className="outlet-pick">
          {outlets.length === 0 && <p className="muted small">Add outlets first (Settings → Companies & Outlets).</p>}
          <p className="muted small">{d.role === 'outlet_manager' ? 'Tick his outlets.' : 'Tick a whole company or single outlets.'} {d.role !== 'outlet_manager' && (allowed === '*' ? 'Nothing ticked = all companies.' : 'You can only give your own companies.')}</p>
          <ScopePicker companies={companies} outlets={outlets} allowed={allowed} outletsOnly={d.role === 'outlet_manager'}
            value={{ companies: d.companies, outlets: d.outlets }} onChange={(v) => { setMsg(null); setD({ ...d, companies: v.companies, outlets: v.outlets }) }} />
        </div>
      )}
      {!locked && (
        <div className="user-save">
          <Btn small kind="primary" icon="check" disabled={!dirty || busy} onClick={() => void save()}>{busy ? 'Updating…' : 'Update'}</Btn>
          <Btn small kind="ghost" disabled={!changed || busy} onClick={() => { setD(saved); setMsg(null); setOpen(false) }}>Cancel</Btn>
          {changed && !msg && <span className="small dirty-note">Unsaved changes — press Update to save</span>}
          {!changed && legacy && !msg && <span className="small dirty-note">Old role “{legacy}” — press Update to save it as {ROLE_LABEL[saved.role]}</span>}
          {msg && <span className={`small ${msg.ok ? 'saved-tick' : 'err'}`} role="status">{msg.ok ? '✓ ' : ''}{msg.text}</span>}
        </div>
      )}
    </div>
  )
}

/** "Sees: …" / "Outlets: …" for a user */
function ScopeText({ u, companies, outlets }: { u: Profile; companies: ReturnType<typeof useConfig>['companies']['items']; outlets: Outlet[] }) {
  const r = normRole(u.role)
  if (r === 'super_admin' || r === 'general_manager') return <span className="small muted">All companies</span>
  const n = (u.outlet_ids?.length || 0) + (u.company_ids?.length || 0)
  return <span className={`small${r === 'outlet_manager' && !n ? ' warn' : ''}`}>{n ? scopeLabel(companies, outlets, u.company_ids || [], u.outlet_ids || []) : r === 'outlet_manager' ? 'No outlets yet — he sees no workers' : 'All companies'}</span>
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
