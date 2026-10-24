import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { normRole, useAuth } from '../lib/auth'
import { useConfig } from '../lib/config'
import { scopeLabel } from '../lib/companies'
import { ROLE_LABEL } from '../lib/workflow'
import { getSyncStatus } from '../lib/sync'
import { Icon } from './Icon'
import { Modal } from './ui'
import { SetPasswordForm } from '../pages/SetPassword'
import { setTheme, useTheme, type ThemePref } from '../lib/theme'
import { setShowDemo, useShowDemo } from '../lib/demo'

export function ThemeSwitch() {
  const t = useTheme()
  const opts: [ThemePref, string][] = [['light', '☀️ Light'], ['dark', '🌙 Dark'], ['system', '📱 Auto']]
  return (
    <div className="theme-sw" role="radiogroup" aria-label="Theme">
      {opts.map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={t === v} className={t === v ? 'on' : ''} onClick={() => setTheme(v)}>{l}</button>)}
    </div>
  )
}

export const initialsOf = (name?: string | null, email?: string | null) => {
  const src = (name || '').trim() || (email || '').split('@')[0] || '?'
  const parts = src.split(/[\s._-]+/).filter(Boolean)
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

/** Ask (warning about unsent changes), then sign out, wipe this device's copy and return to the login screen. */
export function useSignOut() {
  const { signOut } = useAuth()
  const [busy, setBusy] = useState(false)
  const run = async () => {
    const pending = getSyncStatus().pending
    const warn = pending ? `\n\n⚠️ ${pending} change(s) are not uploaded yet and will be lost.` : ''
    if (!confirm('Sign out? The copy on this device will be removed (it stays in the cloud) and the next person can sign in.' + warn)) return
    setBusy(true)
    try { await signOut(true) } finally { setBusy(false) }
  }
  return { run, busy }
}

/** Who am I: name, role and company/outlet scope */
function useWhoAmI() {
  const { session, profile, role, myCompanies, myOutlets } = useAuth()
  const cfg = useConfig()
  const outlets = useLiveQuery(() => db.outlets.toArray(), [], [])
  const name = profile?.full_name || session?.user.email || ''
  const scope = myCompanies.length || myOutlets.length ? scopeLabel(cfg.companies.items, outlets, myCompanies, myOutlets) : 'All companies & outlets'
  return { name, email: session?.user.email || '', role: ROLE_LABEL[normRole(role) || ''] || '—', scope }
}

/** Avatar button in the top app bar (every role, every screen size) */
export function UserMenu() {
  const me = useWhoAmI()
  const { profile, isSuper } = useAuth()
  const showDemo = useShowDemo()
  const { run, busy } = useSignOut()
  const [open, setOpen] = useState(false)
  const [pwOpen, setPwOpen] = useState(false)
  const [pwDone, setPwDone] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown); document.addEventListener('touchstart', onDown); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  return (
    <div className="umenu" ref={box}>
      <button type="button" className="avatar" aria-haspopup="menu" aria-expanded={open} aria-label={`Account: ${me.name}. Open menu to sign out`} title={me.name} onClick={() => setOpen((v) => !v)}>
        {initialsOf(profile?.full_name, me.email)}
      </button>
      {open && (
        <div className="umenu-pop" role="menu" aria-label="Account">
          <div className="umenu-who">
            <span className="avatar big" aria-hidden="true">{initialsOf(profile?.full_name, me.email)}</span>
            <div>
              <strong>{me.name}</strong>
              {profile?.full_name && <small className="muted">{me.email}</small>}
              <small>{me.role}</small>
              <small className="muted">{me.scope}</small>
            </div>
          </div>
          <ThemeSwitch />
          {isSuper && (
            <label className="umenu-item umenu-check" title="The demo company for Apple's app review is left out of totals, alerts and reports unless this is on">
              <input type="checkbox" role="menuitemcheckbox" aria-checked={showDemo} checked={showDemo} onChange={(e) => setShowDemo(e.target.checked)} />
              <span>Show demo data <small className="muted">(Apple review company)</small></span>
            </label>
          )}
          <Link role="menuitem" to="/settings/account" className="umenu-item" onClick={() => setOpen(false)}><Icon name="gear" size={18} /> Account &amp; settings</Link>
          <button role="menuitem" type="button" className="umenu-item" onClick={() => { setOpen(false); setPwDone(false); setPwOpen(true) }}><Icon name="lock" size={18} /> Change password</button>
          <button role="menuitem" type="button" className="umenu-item danger" disabled={busy} onClick={() => { void run() }}>
            <Icon name="exit" size={18} /> {busy ? 'Signing out…' : 'Switch user / Sign out'}
          </button>
        </div>
      )}
      {pwOpen && (
        <Modal title="Change password" onClose={() => setPwOpen(false)}>
          {pwDone ? <p className="ok">✅ Your password is changed. Use it next time you sign in.</p> : <SetPasswordForm mode="change" onDone={() => setPwDone(true)} onCancel={() => setPwOpen(false)} />}
        </Modal>
      )}
    </div>
  )
}

/** A full-width "Sign out" row for the bottom of More and Settings */
export function SignOutRow() {
  const me = useWhoAmI()
  const { run, busy } = useSignOut()
  return (
    <div className="card signout-row">
      <button type="button" className="req-link" disabled={busy} onClick={() => { void run() }}>
        <span className="req-ic danger"><Icon name="exit" /></span>
        <div className="r-main"><strong>{busy ? 'Signing out…' : 'Switch user / Sign out'}</strong><small>Signed in as {me.name} · {me.role}</small></div>
      </button>
    </div>
  )
}
