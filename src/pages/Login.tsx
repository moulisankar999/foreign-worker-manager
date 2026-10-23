import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Btn } from '../components/ui'

export default function Login() {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  // optional company / outlet for the sign-up (names only, from a minimal public function)
  const [opts, setOpts] = useState<{ companies: { id: string; name: string }[]; outlets: { id: string; name: string; companyId: string }[] } | null>(null)
  const [where, setWhere] = useState('')
  useEffect(() => {
    if (mode !== 'up' || opts) return
    void supabase.rpc('signup_options').then(({ data }) => { if (data) setOpts(data) })
  }, [mode, opts])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setMsg('')
    try {
      if (mode === 'up') {
        const { error } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { full_name: name.trim(), ...(where.startsWith('o:') ? { outlet_id: where.slice(2) } : where.startsWith('c:') ? { company_id: where.slice(2) } : {}) } } })
        if (error) throw error
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw error
      }
    } catch (err) {
      const m = (err as Error).message
      setMsg(/invalid login/i.test(m) ? 'Wrong email or password.' : /fetch/i.test(m) ? 'No internet connection. Please try again.' : m)
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
        <div className="field"><label htmlFor="pw">Password</label><input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete={mode === 'up' ? 'new-password' : 'current-password'} /></div>
        {mode === 'up' && <p className="muted small">At least 8 characters. The first person to create an account becomes the Admin. Everyone else waits for the Admin to approve them.</p>}
        {msg && <p className="err" role="alert">{msg}</p>}
        <Btn kind="primary" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'up' ? 'Create account' : 'Sign in'}</Btn>
      </form>
    </div>
  )
}

export function Pending() {
  const { profile, refreshProfile, signOut, session } = useAuth()
  const inactive = profile?.status === 'inactive'
  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <div className="auth-brand">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={52} height={52} />
          <div><h1>{inactive ? 'Account switched off' : 'Waiting for approval'}</h1><p className="muted">{session?.user.email}</p></div>
        </div>
        <p>{inactive ? 'An admin has deactivated this account. Contact your admin if this is a mistake.' : profile ? 'Your account is created. Your Super Admin (or your company’s HR Admin) has been notified and will approve you from the app. Then tap “Check again”.' : 'Could not load your account. Check your internet connection.'}</p>
        <div className="row gap-s wrap">
          <Btn kind="primary" icon="check" onClick={() => refreshProfile()}>Check again</Btn>
          <Btn kind="ghost" icon="exit" onClick={() => signOut(true)}>Sign out</Btn>
        </div>
      </div>
    </div>
  )
}
