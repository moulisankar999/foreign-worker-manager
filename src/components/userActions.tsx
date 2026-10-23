/* Per-user account actions in Settings → Users: Pause / Resume, Reset password, Delete.
 * The buttons only mirror the rules; the server (Edge Function "user-admin") checks them again. */
import { useState } from 'react'
import { Btn, Chip, Modal } from './ui'
import { normRole, useAuth } from '../lib/auth'
import { useConfig } from '../lib/config'
import { userAdmin } from '../lib/userAdmin'
import { fmtDate } from '../lib/util'
import type { Profile } from '../lib/supabase'

export const at = (d?: string | null) => (d ? `${fmtDate(d.slice(0, 10))} ${new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '')
const nameOf = (u: Profile) => u.full_name || u.email || 'user'

export function StatusChip({ u }: { u: Profile }) {
  if (u.status === 'active') return <Chip tone="green">Active</Chip>
  if (u.status === 'paused') return <Chip tone="amber">Paused</Chip>
  if (u.status === 'pending') return <Chip tone="blue">Pending</Chip>
  if (u.status === 'deleted') return <Chip tone="red">Deleted</Chip>
  return <Chip tone="gray">{u.rejected_at && !u.approved_at ? 'Rejected' : 'Switched off'}</Chip>
}

/** who paused / resumed / reset — one short line */
export function statusLine(u: Profile) {
  const parts: string[] = []
  if (u.status === 'paused' && u.paused_at) parts.push(`Paused by ${u.paused_by_name || '—'} · ${at(u.paused_at)}${u.pause_reason ? ` — ${u.pause_reason}` : ''}`)
  if (u.status === 'active' && u.resumed_at) parts.push(`Resumed by ${u.resumed_by_name || '—'} · ${at(u.resumed_at)}`)
  if (u.pw_reset_at) parts.push(`Password reset by ${u.pw_reset_by_name || '—'} · ${at(u.pw_reset_at)}${u.must_change_password ? ' (must choose a new one at next sign-in)' : ''}`)
  return parts.join(' · ')
}

/** what the signed-in person may do to this user (same rules as the server) */
export function useUserPerms(users: Profile[]) {
  const { session, isSuper, isHrAdmin, myCompanies, myOutlets } = useAuth()
  const flags = useConfig().hr_admin
  const me = session?.user.id
  const activeSupers = users.filter((x) => normRole(x.role) === 'super_admin' && x.status === 'active').length
  const inScope = (u: Profile) => {
    if (!myCompanies.length && !myOutlets.length) return true
    const cos = u.company_ids || [], outs = u.outlet_ids || []
    if (!cos.length && !outs.length) return false
    // outlets are checked exactly on the server (it knows which company each outlet belongs to)
    return cos.every((c) => myCompanies.includes(c)) && (myCompanies.length > 0 || outs.every((o) => myOutlets.includes(o)))
  }
  return (u: Profile) => {
    const tr = normRole(u.role)
    const self = u.id === me
    const highRank = tr === 'super_admin' || tr === 'hr_admin'
    const hrOk = isHrAdmin && flags.manageUsers && !highRank && inScope(u)
    const manage = !self && u.status !== 'deleted' && u.status !== 'pending' && (isSuper || hrOk)
    const lastSuper = tr === 'super_admin' && u.status === 'active' && activeSupers <= 1
    return {
      pause: manage && u.status === 'active' && !lastSuper,
      resume: manage && (u.status === 'paused' || u.status === 'inactive'),
      reset: !self && u.status !== 'deleted' && u.status !== 'pending' && tr !== 'super_admin' && (isSuper || (isHrAdmin && flags.resetPasswords && tr !== 'hr_admin' && inScope(u))),
      del: manage && !lastSuper,
      lastSuper,
    }
  }
}

export function UserActionButtons({ u, may, onDone }: { u: Profile; may: ReturnType<ReturnType<typeof useUserPerms>>; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [dlg, setDlg] = useState<'reset' | 'delete' | null>(null)
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try { await fn(); onDone() } catch (e) { alert((e as Error).message) } finally { setBusy(false) }
  }
  const pause = () => {
    const reason = prompt(`Pause access for ${nameOf(u)}?\n\nThey are signed out at once and cannot sign in or see any data until you resume them. Optional reason:`, '')
    if (reason === null) return
    void run(() => userAdmin('pause', u.id, { note: reason.trim() || undefined }))
  }
  return (
    <>
      {may.pause && <Btn small kind="ghost" icon="pause" disabled={busy} onClick={pause}>Pause</Btn>}
      {may.resume && <Btn small kind="primary" icon="play" disabled={busy} onClick={() => run(() => userAdmin('resume', u.id))}>Resume</Btn>}
      {may.reset && <Btn small kind="ghost" icon="lock" disabled={busy} onClick={() => setDlg('reset')}>Reset password</Btn>}
      {may.del && <Btn small kind="ghost" icon="trash" disabled={busy} onClick={() => setDlg('delete')}>Delete</Btn>}
      {dlg === 'reset' && <ResetDialog u={u} onClose={() => { setDlg(null); onDone() }} />}
      {dlg === 'delete' && <DeleteDialog u={u} onClose={(ok) => { setDlg(null); if (ok) onDone() }} />}
    </>
  )
}

function ResetDialog({ u, onClose }: { u: Profile; onClose: () => void }) {
  const [email, setEmail] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [res, setRes] = useState<{ pw: string; emailed?: boolean } | null>(null)
  const [copied, setCopied] = useState(false)
  const go = async () => {
    setBusy(true); setErr('')
    try { const r = await userAdmin('reset_password', u.id, { sendEmail: email }); setRes({ pw: r.tempPassword || '', emailed: r.emailed }) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Modal title={`Reset password — ${nameOf(u)}`} onClose={onClose}
      footer={res ? <Btn kind="primary" icon="check" onClick={onClose}>Done — I noted it</Btn> : <><Btn kind="ghost" onClick={onClose} disabled={busy}>Cancel</Btn><Btn kind="primary" icon="lock" onClick={go} disabled={busy}>{busy ? 'Resetting…' : 'Reset password'}</Btn></>}>
      {!res ? (
        <>
          <p className="small">This gives <strong>{u.email}</strong> a new <strong>temporary password</strong> and signs them out everywhere. They must choose their own password the next time they sign in.</p>
          <label className="check small"><input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> Also email them a “reset your password” link (the free mailer sends only a few emails per hour)</label>
          {err && <p className="err small">{err}</p>}
        </>
      ) : (
        <>
          <p className="small">Temporary password for <strong>{u.email}</strong> — <strong>shown only this once</strong>. Give it to them in person or by phone:</p>
          <div className="temp-pw" data-testid="temp-pw"><code>{res.pw}</code>
            <Btn small kind="ghost" onClick={() => { void navigator.clipboard?.writeText(res.pw).then(() => setCopied(true)) }}>{copied ? 'Copied ✓' : 'Copy'}</Btn></div>
          {email && <p className="small muted">{res.emailed ? 'A reset link was also emailed.' : 'The reset email could not be sent (mail limit?) — use the temporary password.'}</p>}
        </>
      )}
    </Modal>
  )
}

function DeleteDialog({ u, onClose }: { u: Profile; onClose: (ok: boolean) => void }) {
  const want = (u.full_name || u.email || '').trim()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const ok = typed.trim().toLowerCase() === want.toLowerCase() && !!want
  const go = async () => {
    setBusy(true); setErr('')
    try { const r = await userAdmin('delete', u.id); if (r.warning) alert(r.warning); onClose(true) } catch (e) { setErr((e as Error).message); setBusy(false) }
  }
  return (
    <Modal title={`Delete user — ${nameOf(u)}`} onClose={() => onClose(false)}
      footer={<><Btn kind="ghost" onClick={() => onClose(false)} disabled={busy}>Cancel</Btn><Btn kind="danger" icon="trash" onClick={go} disabled={!ok || busy}>{busy ? 'Deleting…' : 'Delete user'}</Btn></>}>
      <p className="small">This removes the <strong>login</strong> of <strong>{u.email}</strong>. They can no longer sign in.</p>
      <ul className="small plain-list">
        <li>No workers, documents, requests or other business data are deleted.</li>
        <li>History is kept: their past actions will show as <strong>“deleted user {u.full_name || u.email}”</strong>.</li>
        <li>This cannot be undone (they would have to sign up again).</li>
      </ul>
      <div className="field"><label htmlFor="del-name">Type <strong>{want}</strong> to confirm</label>
        <input id="del-name" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" /></div>
      {err && <p className="err small">{err}</p>}
    </Modal>
  )
}
