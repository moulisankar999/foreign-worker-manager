/* Settings → Users & Access → "General Manager powers" (CEO only). Changes apply at once and are audited. */
import { useEffect, useState } from 'react'
import { Btn, Card } from './ui'
import { supabase } from '../lib/supabase'
import { ALL_POWERS, POWER_GROUPS, withDefaults, type PowerMap } from '../lib/powers'
import { toast } from './toast'

export function GmPowersCard() {
  const [p, setP] = useState<PowerMap | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const load = async () => {
    const { data, error } = await supabase.rpc('get_gm_powers')
    if (error) setErr(error.message); else { setP(withDefaults(data as PowerMap)); setErr('') }
  }
  useEffect(() => { void load() }, [])
  const save = async (next: PowerMap, what: string) => {
    const prev = p
    setP(next); setBusy(true)
    const { data, error } = await supabase.rpc('set_gm_powers', { p_powers: next })
    setBusy(false)
    if (error) { setP(prev); toast('Not saved — ' + error.message, 'err'); return }
    setP(withDefaults(data as PowerMap)); toast(`Saved ✓ — ${what}`)
  }
  const setMany = (keys: string[], on: boolean, what: string) => p && save({ ...p, ...Object.fromEntries(keys.map((k) => [k, on])) }, what)
  const onCount = p ? ALL_POWERS.filter((k) => p[k]).length : 0
  return (
    <Card title="General Manager powers" className="gm-powers" actions={p && <>
      <Btn small kind="ghost" disabled={busy || onCount === ALL_POWERS.length} onClick={() => setMany(ALL_POWERS, true, 'all powers on')}>Select all</Btn>
      <Btn small kind="ghost" disabled={busy || onCount === 0} onClick={() => setMany(ALL_POWERS, false, 'all powers off')}>Clear all</Btn>
    </>}>
      <p className="muted small">Only you (the CEO) see this. A General Manager has the same powers as you unless you switch them off here. Changes apply <strong>immediately</strong>, are checked by the server and recorded in the audit log. A General Manager can never change the CEO, another General Manager, or these settings.</p>
      {err && <p className="err small">{err}</p>}
      {p && <p className="small"><strong>{onCount}</strong> of {ALL_POWERS.length} powers on</p>}
      {p && POWER_GROUPS.map((g) => {
        const keys = g.powers.map((x) => x.key)
        const n = keys.filter((k) => p[k]).length
        return (
          <fieldset key={g.key} className="power-group">
            <legend><span aria-hidden>{g.icon}</span> {g.label} <small className="muted">({n}/{keys.length})</small></legend>
            <div className="row gap-s small">
              <button type="button" className="link" disabled={busy || n === keys.length} onClick={() => setMany(keys, true, `${g.label}: all on`)}>Select all</button>
              <button type="button" className="link" disabled={busy || n === 0} onClick={() => setMany(keys, false, `${g.label}: all off`)}>Clear all</button>
            </div>
            {g.powers.map((x) => (
              <label key={x.key} className="check power">
                <input type="checkbox" checked={!!p[x.key]} disabled={busy} onChange={(e) => save({ ...p, [x.key]: e.target.checked }, `${x.label}: ${e.target.checked ? 'on' : 'off'}`)} />
                <span>{x.label}{x.help && <small className="muted"> — {x.help}</small>}</span>
              </label>
            ))}
          </fieldset>
        )
      })}
    </Card>
  )
}
