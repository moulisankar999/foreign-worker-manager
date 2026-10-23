/* Per-user account actions in Settings → Users: Pause / Resume, Reset password, Delete.
 * The buttons only mirror the rules; the server (Edge Function "user-admin") checks them again. */
import { useState } from 'react'
import { Btn, Chip, Modal } from './ui'
import { normRole, useAuth } from '../lib/auth'
import { useConfig } from '../lib/config'
import { userAdmin } from '../lib/userAdmin'
import { toast } from './toast'
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
  const { session, isSuper, isGm, can, isHrAdmin, myCompanies, myOutlets } = useAuth()
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
    const top = tr === 'super_admin' || tr === 'general_manager' // only the CEO touches CEO / GM accounts
    const highRank = top || tr === 'hr_admin'
    const hrOk = isHrAdmin && flags.manageUsers && !highRank && inScope(u)
    const gmOk = isGm && can('users.manage') && !top
    const manage = !self && u.status !== 'deleted' && u.status !== 'pending' && (isSuper || gmOk || hrOk)
    const lastSuper = tr === 'super_admin' && u.status === 'active' && activeSupers <= 1
    return {
      pause: manage && u.status === 'active' && !lastSuper,
      resume: manage && (u.status === 'paused' || u.status === 'inactive'),
      reset: !self && u.status !== 'deleted' && u.status !== 'pending' && tr !== 'super_admin' &&
        (isSuper || (isGm && can('users.reset') && !top) || (isHrAdmin && flags.resetPasswords && !highRank && inScope(u))),
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

/** strong enough for a temporary password: 10+ characters with letters and digits */
export const tempPwIssue = (p: string) => p.length < 10 ? 'At least 10 characters' : !/[A-Za-z]/.test(p) || !/\d/.test(p) ? 'Use letters and numbers' : /\s/.test(p) ? 'No spaces' : p.length > 64 ? 'At most 64 characters' : ''
export function genTempPassword() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ', a = 'abcdefghijkmnpqrstuvwxyz', d = '23456789', all = A + a + d
  const r = crypto.getRandomValues(new Uint32Array(12))
  const ch = Array.from(r, (x, i) => { const set = i === 0 ? A : i === 1 ? a : i === 2 ? d : all; return set[x % set.length] })
  for (let i = ch.length - 1; i > 0; i--) { const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1); [ch[i], ch[j]] = [ch[j], ch[i]] }
  return ch.slice(0, 4).join('') + '-' + ch.slice(4, 8).join('') + '-' + ch.slice(8).join('')
}

function ResetDialog({ u, onClose }: { u: Profile; onClose: () => void }) {
  const [email, setEmail] = useState(false)
  const [mode, setMode] = useState<'generate' | 'choose'>('generate')
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [res, setRes] = useState<{ pw: string; emailed?: boolean } | null>(null)
  const [copied, setCopied] = useState(false)
  const issue = mode === 'choose' ? tempPwIssue(typed) : ''
  const go = async () => {
    if (issue) { setErr(issue); return }
    setBusy(true); setErr('')
    try {
      const r = await userAdmin('reset_password', u.id, { sendEmail: email, tempPassword: mode === 'choose' ? typed : undefined })
      setRes({ pw: r.tempPassword || '', emailed: r.emailed }); setTyped('')
      toast(`Password reset ✓ — ${nameOf(u)} must choose a new one at next sign-in`)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Modal title={`Reset password — ${nameOf(u)}`} onClose={onClose}
      footer={res ? <Btn kind="primary" icon="check" onClick={onClose}>Done — I noted it</Btn> : <><Btn kind="ghost" onClick={onClose} disabled={busy}>Cancel</Btn><Btn kind="primary" icon="lock" onClick={go} disabled={busy || !!issue}>{busy ? 'Resetting…' : 'Reset password'}</Btn></>}>
      {!res ? (
        <>
          <p className="small">This gives <strong>{u.email}</strong> a new <strong>temporary password</strong> and signs them out everywhere. They must choose their own password the next time they sign in.</p>
          <div className="pw-choice" role="radiogroup" aria-label="Temporary password">
            <label className="check small"><input type="radio" name="pwmode" checked={mode === 'generate'} onChange={() => setMode('generate')} /> Generate a strong temporary password for me</label>
            <label className="check small"><input type="radio" name="pwmode" checked={mode === 'choose'} onChange={() => setMode('choose')} /> I’ll type a temporary password</label>
            {mode === 'choose' && <>
              <input type="text" autoComplete="off" spellCheck={false} aria-label="Temporary password" placeholder="e.g. Sunrise-2026-temp" value={typed} onChange={(e) => { setTyped(e.target.value); setErr('') }} />
              <small className={typed && issue ? 'err' : 'muted'}>{typed && issue ? issue : 'At least 10 characters, letters and numbers. They will be asked to change it.'}</small>
              <Btn small kind="ghost" onClick={() => setTyped(genTempPassword())}>Suggest one</Btn>
            </>}
          </div>
          <label className="check small"><input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> Also send a “reset your password” email link (the free mailer sends only a few emails per hour)</label>
          <p className="muted small pw-info">🔒 For security, passwords can’t be viewed — reset gives a new temporary one.</p>
          {err && <p className="err small">{err}</p>}
        </>
      ) : (
        <>
          <p className="small">Temporary password for <strong>{u.email}</strong> — <strong>shown only this once</strong>. Give it to them in person or by phone:</p>
          <div className="temp-pw" data-testid="temp-pw"><code>{res.pw}</code>
            <Btn small kind="ghost" onClick={() => { void navigator.clipboard?.writeText(res.pw).then(() => setCopied(true)) }}>{copied ? 'Copied ✓' : 'Copy'}</Btn></div>
          <p className="small muted">They must change it at their next sign-in. The reset is in the audit log (the password itself is never stored or logged).</p>
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
