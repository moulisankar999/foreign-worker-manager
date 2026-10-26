/* "App access" on the worker profile: the FW Worker self-service login (passport no. + 6-digit PIN).
 * Only CEO / General Manager / HR Admin / HR Manager see this; the server (edge function worker-access + RLS) enforces it again.
 * The PIN is shown ONCE here and never stored in plain text anywhere. */
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Btn, Card, Chip, KV, Modal } from './ui'
import { toast } from './toast'
import { IconAction } from './iconAction'
import type { Worker } from '../lib/types'

type Action = 'generate' | 'reset' | 'revoke' | 'restore' | 'unlock'
interface AccessStatus {
  status: 'never_set' | 'active' | 'revoked' | 'locked'; hasPassport: boolean; lastLoginAt?: string | null; pinSetAt?: string | null; pinSetByName?: string | null
  workerChangedPinAt?: string | null; lockedUntil?: string | null; hardLocked?: boolean; failedCount?: number; revokedAt?: string | null; revokedByName?: string | null
}
const TONE = { never_set: 'gray', active: 'green', revoked: 'red', locked: 'orange' } as const
const LABEL = { never_set: 'Never set', active: 'Active', revoked: 'Revoked', locked: 'Locked' } as const
const CONFIRM: Record<Action, string> = {
  generate: 'Create a login PIN for this worker? You will see the PIN once — give it to the worker in person.',
  reset: 'Make a NEW PIN? The old PIN stops working and the worker is signed out on all phones.',
  revoke: 'Revoke app access now? The worker is signed out immediately and cannot sign in until restored.',
  restore: 'Restore app access? The worker can sign in again with the current PIN.',
  unlock: 'Unlock the login (after too many wrong PINs)?',
}
export const WORKER_APP_URL = (import.meta.env.VITE_WORKER_APP_URL as string | undefined) || `${location.origin}${import.meta.env.BASE_URL}worker/`
const when = (s?: string | null) => (s ? new Date(s).toLocaleString() : '—')

async function call(action: Action, workerId: string): Promise<{ ok?: boolean; pin?: string }> {
  const { data, error } = await supabase.functions.invoke('worker-access', { body: { action, workerId } })
  if (error) {
    let msg = error.message
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') { try { const j = await ctx.json(); if (j?.error) msg = j.error } catch { /* generic */ } }
    throw new Error(/failed to send|fetch/i.test(msg) ? 'No internet connection. Please try again.' : msg)
  }
  return data
}

export function AppAccessPanel({ w }: { w: Worker }) {
  const [st, setSt] = useState<AccessStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<Action | ''>('')
  const [pin, setPin] = useState<string | null>(null)
  const load = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('worker_access_status', { p_worker: w.id })
    if (e) setError(navigator.onLine ? e.message.replace(/^.*?ERROR:\s*/, '') : 'Offline — app access needs an internet connection')
    else { setError(''); setSt(data as AccessStatus) }
  }, [w.id])
  useEffect(() => { void load() }, [load])
  const run = async (a: Action) => {
    if (!confirm(CONFIRM[a])) return
    setBusy(a)
    try {
      const r = await call(a, w.id)
      if (r.pin) setPin(r.pin)
      else toast({ revoke: 'Access revoked — signed out everywhere', restore: 'Access restored', unlock: 'Login unlocked', generate: 'Done', reset: 'Done' }[a] + ' ✓')
      await load()
    } catch (e) { alert((e as Error).message) } finally { setBusy('') }
  }
  const s = st?.status
  return (
    <Card title="FW Worker app access" actions={s && <Chip tone={TONE[s]}>{LABEL[s]}{s === 'locked' && st?.hardLocked ? ' (admin unlock needed)' : ''}</Chip>}>
      <p className="muted small">The worker signs in to the FW Worker app with the <strong>passport number</strong> and a <strong>6-digit PIN</strong>, sees own details and expiry dates, and sends requests to the outlet manager. Link: <a href={WORKER_APP_URL} target="_blank" rel="noreferrer">{WORKER_APP_URL}</a></p>
      {error && <p className="warn small">{error}</p>}
      {st && (
        <>
          <KV items={[
            ['Status', LABEL[st.status]],
            ['Last login', when(st.lastLoginAt)],
            ['PIN set', st.pinSetAt ? `${when(st.pinSetAt)}${st.pinSetByName ? ' by ' + st.pinSetByName : ''}` : '—'],
            ...(st.workerChangedPinAt ? [['Worker changed PIN', when(st.workerChangedPinAt)] as [string, string]] : []),
            ...(st.status === 'locked' ? [['Locked', st.hardLocked ? 'Until an admin unlocks' : `Until ${when(st.lockedUntil)}`] as [string, string]] : []),
            ...(st.status === 'revoked' ? [['Revoked', `${when(st.revokedAt)}${st.revokedByName ? ' by ' + st.revokedByName : ''}`] as [string, string]] : []),
          ]} />
          {!st.hasPassport && <p className="warn small">Add the passport number (Expiry docs → Passport) before creating a login.</p>}
          <div className="row gap-s wrap mt-s">
            {s === 'never_set' && <IconAction kind="reset" tone="pri" text label="Generate PIN" disabled={!!busy || !st.hasPassport} onClick={() => run('generate')} />}
            {(s === 'active' || s === 'locked') && <IconAction kind="reset" text label="Reset PIN" disabled={!!busy} onClick={() => run('reset')} />}
            {s === 'locked' && <IconAction kind="unlock" text label="Unlock login" disabled={!!busy} onClick={() => run('unlock')} />}
            {(s === 'active' || s === 'locked') && <IconAction kind="revoke" text label="Revoke app access" disabled={!!busy} onClick={() => run('revoke')} />}
            {s === 'revoked' && <IconAction kind="resume" text label="Restore app access" disabled={!!busy} onClick={() => run('restore')} />}
          </div>
        </>
      )}
      {pin && (
        <Modal title="Worker PIN — shown only once" onClose={() => setPin(null)} footer={<Btn kind="primary" onClick={() => setPin(null)}>I have given it to the worker</Btn>}>
          <p className="muted small">Give this PIN to <strong>{w.fullName}</strong> in person. It is not saved anywhere and cannot be shown again (use Reset PIN if it is lost). The worker should change it after first sign-in.</p>
          <p className="pin-once" aria-label="PIN" style={{ fontSize: '2.4rem', letterSpacing: '0.4em', fontWeight: 700, textAlign: 'center', margin: '16px 0', fontVariantNumeric: 'tabular-nums' }}>{pin}</p>
          <p className="small">Sign in at <strong>{WORKER_APP_URL}</strong> with the passport number + this PIN.</p>
        </Modal>
      )}
    </Card>
  )
}
