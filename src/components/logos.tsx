/* Logo display (square, "contain") and the upload / replace / remove control. */
import { useState } from 'react'
import { Btn } from './ui'
import { useAuth } from '../lib/auth'
import { inScope } from '../lib/companies'
import { useOutlets } from '../lib/hooks'
import { db } from '../lib/db'
import { removeLogoFile, setCompanyLogo, uploadLogo, useLogoUrl } from '../lib/logos'

export function LogoImg({ path, size = 40, fallback = true, title }: { path?: string | null; size?: number; fallback?: boolean; title?: string }) {
  const url = useLogoUrl(path)
  if (!url && !fallback) return null
  return (
    <span className="logo-box" style={{ width: size, height: size }} title={title}>
      {url ? <img src={url} alt={title ? `${title} logo` : 'Logo'} /> : <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" className="logo-default" />}
    </span>
  )
}

/** Super Admin anywhere; HR Admin / HR Manager only inside their companies / outlets (the server checks again) */
export function useCanEditLogo() {
  const { isSuper, role, myCompanies, myOutlets } = useAuth()
  const outlets = useOutlets()
  return (kind: 'company' | 'outlet', id: string) => {
    if (isSuper) return true
    if (role !== 'hr_admin' && role !== 'hr_manager') return false
    if (!myCompanies.length && !myOutlets.length) return true
    return kind === 'company' ? myCompanies.includes(id) : inScope(role, myCompanies, myOutlets, id, outlets)
  }
}

export function LogoEdit({ kind, id, path, name }: { kind: 'company' | 'outlet'; id: string; path?: string | null; name: string }) {
  const can = useCanEditLogo()(kind, id)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const save = async (next: string | null) => {
    if (kind === 'company') await setCompanyLogo(id, next)
    else await db.outlets.update(id, { logo: next || undefined })
  }
  const pick = async (f?: File) => {
    if (!f) return
    setBusy(true); setMsg('')
    try {
      const p = await uploadLogo(kind, id, f)
      await save(p)
      await removeLogoFile(path)
      setMsg('Logo saved.')
    } catch (e) { setMsg('⚠️ ' + (e as Error).message) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!confirm(`Remove the logo of ${name}?`)) return
    setBusy(true); setMsg('')
    try { await save(null); await removeLogoFile(path); setMsg('Logo removed.') } catch (e) { setMsg('⚠️ ' + (e as Error).message) } finally { setBusy(false) }
  }
  return (
    <span className="logo-edit">
      <LogoImg path={path} size={40} title={name} />
      {can && (
        <span className="row gap-s">
          <label className={`btn btn-secondary btn-s${busy ? ' disabled' : ''}`} aria-label={`${path ? 'Replace' : 'Upload'} logo of ${name}`}>
            {busy ? 'Saving…' : path ? 'Replace' : 'Logo'}
            <input type="file" accept="image/png,image/jpeg,image/svg+xml" hidden disabled={busy} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = '' }} />
          </label>
          {path && !busy && <Btn small kind="ghost" onClick={() => void remove()}>Remove</Btn>}
        </span>
      )}
      {msg && <small role="status">{msg}</small>}
    </span>
  )
}
