import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Btn } from '../components/ui'
import { resetRedirect } from '../lib/userAdmin'
import { fmtDate } from '../lib/util'

export default function Login() {
  const [mode, setMode] = useState<'in' | 'up' | 'forgot'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(() => { const m = sessionStorage.getItem('fwm-auth-link-error') || ''; sessionStorage.removeItem('fwm-auth-link-error'); return m })
  const [info, setInfo] = useState('')
  // optional company / outlet for the sign-up (names only, from a minimal public function)
  const [opts, setOpts] = useState<{ companies: { id: string; name: string }[]; outlets: { id: string; name: string; companyId: string }[] } | null>(null)
  const [where, setWhere] = useState('')
  useEffect(() => {
    if (mode !== 'up' || opts) return
    void supabase.rpc('signup_options').then(({ data }) => { if (data) setOpts(data) })
  }, [mode, opts])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setMsg(''); setInfo('')
    try {
      if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: resetRedirect() })
        if (error) throw error
        setInfo('If an account exists for this email, a reset link is on its way. Open it on this device and choose a new password. No email after 10 minutes? Check spam, or ask your admin to reset your password.')
      } else if (mode === 'up') {
        const { error } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { full_name: name.trim(), ...(where.startsWith('o:') ? { outlet_id: where.slice(2) } : where.startsWith('c:') ? { company_id: where.slice(2) } : {}) } } })
        if (error) throw error
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw error
      }
    } catch (err) {
      const m = (err as Error).message
      setMsg(/invalid login/i.test(m) ? 'Wrong email or password.' : /banned/i.test(m) ? 'Your access is paused. Contact your admin.' : /rate limit|too many/i.test(m) ? 'Too many emails were sent just now. Please wait an hour or ask your admin to reset your password.' : /fetch/i.test(m) ? 'No internet connection. Please try again.' : m)
    } finally { setBusy(false) }
  }

  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={52} height={52} />
          <div><h1>FW Manager</h1><p className="muted">Foreign worker management</p></div>
        </div>
        <div className="seg" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'in'} className={mode === 'in' ? 'on' : ''} onClick={() => setMode('in')}>Sign in</button>
          <button type="button" role="tab" aria-selected={mode === 'up'} className={mode === 'up' ? 'on' : ''} onClick={() => setMode('up')}>Create account</button>
        </div>
        {mode === 'up' && (
          <div className="field"><label htmlFor="nm">Your name</label><input id="nm" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" /></div>
        )}
        {mode === 'up' && opts && (opts.companies.length > 0 || opts.outlets.length > 0) && (
          <div className="field">
            <label htmlFor="wh">Company / outlet (optional)</label>
            <select id="wh" value={where} onChange={(e) => setWhere(e.target.value)}>
              <option value="">— Not sure / skip —</option>
              {opts.companies.map((c) => (
                <optgroup key={c.id} label={c.name}>
                  <option value={`c:${c.id}`}>{c.name} (head office / any outlet)</option>
                  {opts.outlets.filter((o) => o.companyId === c.id).map((o) => <option key={o.id} value={`o:${o.id}`}>{o.name}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
        )}
        <div className="field"><label htmlFor="em">Email</label><input id="em" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" inputMode="email" /></div>
        {mode === 'forgot' && <p className="muted small">Enter your email. We will send you a link to choose a new password.</p>}
        {mode !== 'forgot' && <div className="field"><label htmlFor="pw">Password</label><input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete={mode === 'up' ? 'new-password' : 'current-password'} /></div>}
        {mode === 'up' && <p className="muted small">At least 8 characters. The first person to create an account becomes the Admin. Everyone else waits for the Admin to approve them.</p>}
        {msg && <p className="err" role="alert">{msg}</p>}
        {info && <p className="ok small" role="status">{info}</p>}
        <Btn kind="primary" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'forgot' ? 'Send reset link' : mode === 'up' ? 'Create account' : 'Sign in'}</Btn>
        {mode === 'in' && <button type="button" className="link small" onClick={() => { setMode('forgot'); setMsg(''); setInfo('') }}>Forgot password?</button>}
        {mode === 'forgot' && <button type="button" className="link small" onClick={() => { setMode('in'); setMsg(''); setInfo('') }}>← Back to sign in</button>}
      </form>
    </div>
  )
}

export function Pending() {
  const { profile, refreshProfile, signOut, session } = useAuth()
  const inactive = profile?.status === 'inactive'
  const paused = profile?.status === 'paused'
  const at = (d?: string | null) => (d ? `${fmtDate(d.slice(0, 10))} ${new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '')
  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <div className="auth-brand">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={52} height={52} />
          <div><h1>{paused ? 'Access paused' : inactive ? 'Account switched off' : 'Waiting for approval'}</h1><p className="muted">{session?.user.email}</p></div>
        </div>
        {paused && <p>Your access was paused{profile?.paused_by_name ? <> by <strong>{profile.paused_by_name}</strong></> : ''}{profile?.paused_at ? ` on ${at(profile.paused_at)}` : ''}.{profile?.pause_reason ? ` Reason: ${profile.pause_reason}.` : ''} Contact your admin to resume it.</p>}
        {!paused && <p>{inactive ? 'An admin has deactivated this account. Contact your admin if this is a mistake.' : profile ? 'Your account is created. Your admin has been notified and will approve you from the app. Then tap “Check again”.' : 'Could not load your account. Check your internet connection.'}</p>}
        <div className="row gap-s wrap">
          <Btn kind="primary" icon="check" onClick={() => refreshProfile()}>Check again</Btn>
          <Btn kind="ghost" icon="exit" onClick={() => signOut(true)}>Sign out</Btn>
        </div>
      </div>
    </div>
  )
}
