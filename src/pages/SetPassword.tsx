/* Set a new password:
 *  - "recovery": opened from the "reset your password" email link
 *  - "forced":   an admin gave this person a temporary password; he must choose his own before using the app
 *  - "change":   from the account menu (asks for the current password first) */
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { passwordProblem } from '../lib/userAdmin'
import { Btn } from '../components/ui'

export const RECOVERY_FLAG = 'fwm-recovery'

export function SetPasswordForm({ mode, onDone, onCancel }: { mode: 'recovery' | 'forced' | 'change'; onDone: () => void; onCancel?: () => void }) {
  const { session, profile, refreshProfile } = useAuth()
  const [cur, setCur] = useState('')
  const [pw, setPw] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const p = passwordProblem(pw, again)
    if (p) { setMsg(p); return }
    if (mode !== 'recovery' && pw === cur) { setMsg('Choose a password different from the current / temporary one.'); return }
    setBusy(true); setMsg('')
    try {
      const email = session?.user.email || ''
      if (mode !== 'recovery') {
        // prove it is really him (the temporary password counts as the current one)
        const { error } = await supabase.auth.signInWithPassword({ email, password: cur })
        if (error) throw new Error(/invalid login/i.test(error.message) ? (mode === 'forced' ? 'The temporary password is not correct.' : 'Your current password is not correct.') : error.message)
      }
      const { error } = await supabase.auth.updateUser({ password: pw })
      if (error) throw new Error(/should be different/i.test(error.message) ? 'Choose a password different from the old one.' : error.message)
      if (profile?.must_change_password) {
        const { error: pe } = await supabase.rpc('password_changed')
        if (pe) throw new Error('Password changed, but your account could not be updated: ' + pe.message)
      }
      sessionStorage.removeItem(RECOVERY_FLAG)
      await refreshProfile()
      onDone()
    } catch (err) {
      setMsg((err as Error).message)
    } finally { setBusy(false) }
  }
  return (
    <form onSubmit={submit} className="setpw">
      {mode === 'forced' && <p className="banner small warn">An admin reset your password. Please choose your own password now — enter the <strong>temporary password</strong> you were given, then your new password.</p>}
      {mode === 'recovery' && <p className="small">Choose a new password for <strong>{session?.user.email}</strong>.</p>}
      {mode !== 'recovery' && (
        <div className="field"><label htmlFor="pw-cur">{mode === 'forced' ? 'Temporary password' : 'Current password'}</label>
          <input id="pw-cur" type="password" value={cur} onChange={(e) => setCur(e.target.value)} required autoComplete="current-password" /></div>
      )}
      <div className="field"><label htmlFor="pw-new">New password</label>
        <input id="pw-new" type="password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={8} autoComplete="new-password" /></div>
      <div className="field"><label htmlFor="pw-again">New password again</label>
        <input id="pw-again" type="password" value={again} onChange={(e) => setAgain(e.target.value)} required minLength={8} autoComplete="new-password" /></div>
      <p className="muted small">At least 8 characters, with letters and a number.</p>
      {msg && <p className="err" role="alert">{msg}</p>}
      <div className="row gap-s wrap">
        <Btn kind="primary" type="submit" icon="check" disabled={busy}>{busy ? 'Please wait…' : 'Save new password'}</Btn>
        {onCancel && <Btn kind="ghost" onClick={onCancel} disabled={busy}>Cancel</Btn>}
      </div>
    </form>
  )
}

/** full screen (before the app opens): after the reset email link, or when a password change is required */
export default function SetPasswordScreen({ mode }: { mode: 'recovery' | 'forced' }) {
  const { signOut } = useAuth()
  const [done, setDone] = useState(false)
  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <div className="auth-brand">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={52} height={52} />
          <div><h1>{mode === 'recovery' ? 'Reset your password' : 'Choose a new password'}</h1><p className="muted">FW Manager</p></div>
        </div>
        {done ? (
          <>
            <p>✅ Your password is changed.</p>
            <Btn kind="primary" icon="check" onClick={() => window.location.replace(window.location.pathname + '#/')}>Continue</Btn>
          </>
        ) : (
          <>
            <SetPasswordForm mode={mode} onDone={() => setDone(true)} />
            <button type="button" className="link small" onClick={() => { sessionStorage.removeItem(RECOVERY_FLAG); void signOut(true) }}>Cancel and sign out</button>
          </>
        )}
      </div>
    </div>
  )
}
