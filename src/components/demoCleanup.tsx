import { useEffect, useState } from 'react'
import { Btn, Card, Modal } from './ui'
import { supabase } from '../lib/supabase'
import { syncNow } from '../lib/sync'
import { ROLE_LABEL } from '../lib/workflow'

/** Sample data from "Load sample data" is always named "DEMO …". */
export const isDemoName = (n?: string) => (n || '').startsWith('DEMO ')

interface PreviewUser { id: string; name: string; email: string; role: string; status: string; demoOutlets: string[]; otherOutlets: number }
interface Preview {
  workers: number; outlets: number; outletsKept: string[]; remarks: number; documents: number; requests: number; requestsOpen: number
  notifications: number; jobs: number; realWorkers: number; realOutlets: { id: string; name: string }[]; users: PreviewUser[]
}
type Result = Record<'workers' | 'outlets' | 'remarks' | 'documents' | 'requestsCancelled' | 'notificationsSkipped' | 'usersMoved', number>

/** Settings → Data & Backup: CEO removes the fake DEMO workers/outlets (soft delete, synced to every device). */
export function RemoveDemoCard() {
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState<Result | null>(null)
  return (
    <Card title="Remove sample (DEMO) data">
      <p className="small">Removes only the fake sample records whose name starts with <strong>“DEMO ”</strong> (from “Load sample data”), with their remarks, documents and open requests. Your real workers, outlets and users are not deleted. You see exactly what will be removed before anything happens.</p>
      <Btn kind="danger" icon="trash" onClick={() => { setDone(null); setOpen(true) }}>Remove sample (DEMO) data…</Btn>
      {done && <p className="ok small" role="status" data-testid="demo-done">Removed {done.workers} DEMO workers and {done.outlets} DEMO outlets ({done.remarks} remarks, {done.documents} documents, {done.requestsCancelled} requests cancelled, {done.usersMoved} users moved). Every device updates on its next sync.</p>}
      {open && <RemoveDemoDialog onClose={(r) => { setOpen(false); if (r) setDone(r) }} />}
    </Card>
  )
}

function RemoveDemoDialog({ onClose }: { onClose: (r?: Result) => void }) {
  const [p, setP] = useState<Preview | null>(null)
  const [err, setErr] = useState('')
  const [map, setMap] = useState<Record<string, string>>({})
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    let live = true
    setLoading(true)
    void supabase.rpc('demo_data_preview').then(({ data, error }) => {
      if (!live) return
      setLoading(false)
      if (error) { setErr(error.message); return }
      const pv = data as Preview
      setP(pv)
      // default: move each user to the only real outlet when there is exactly one
      if (pv.realOutlets.length === 1) setMap(Object.fromEntries(pv.users.map((u) => [u.id, pv.realOutlets[0].id])))
    })
    return () => { live = false }
  }, [])
  const nothing = !!p && p.workers + p.outlets === 0
  const unassigned = p ? p.users.filter((u) => !map[u.id] && u.otherOutlets === 0) : []
  const go = async () => {
    setBusy(true); setErr('')
    const reassign = Object.fromEntries((p?.users || []).map((u) => [u.id, map[u.id] || null]))
    const { data, error } = await supabase.rpc('remove_demo_data', { p_reassign: reassign, p_confirm: typed.trim() })
    if (error) { setErr(error.message); setBusy(false); return }
    void syncNow()
    onClose(data as Result)
  }
  return (
    <Modal wide title="Remove sample (DEMO) data" onClose={() => onClose()}
      footer={<><Btn kind="ghost" onClick={() => onClose()} disabled={busy}>Cancel</Btn>
        <Btn kind="danger" icon="trash" onClick={go} disabled={!p || nothing || typed.trim() !== 'REMOVE' || busy}>{busy ? 'Removing…' : 'Remove DEMO data'}</Btn></>}>
      {loading && <p className="muted">Checking what would be removed…</p>}
      {p && <div data-testid="demo-preview">
        {nothing ? <p className="ok">There is no sample (DEMO) data to remove.</p> : <>
          <p className="small"><strong>This will remove:</strong></p>
          <ul className="small plain-list demo-counts">
            <li><strong>{p.workers}</strong> DEMO workers</li>
            <li><strong>{p.outlets}</strong> DEMO outlets</li>
            <li><strong>{p.remarks}</strong> remarks and <strong>{p.documents}</strong> vault documents of DEMO workers</li>
            <li><strong>{p.requests}</strong> requests on DEMO workers ({p.requestsOpen} still open will be <strong>cancelled</strong>; no one is notified)</li>
            {p.notifications > 0 && <li><strong>{p.notifications}</strong> queued alerts about DEMO workers will be skipped</li>}
            <li><strong>0</strong> job categories — Cook, Cashier etc. are standard lists, not sample data, so they stay.</li>
          </ul>
          <p className="small"><strong>Kept (not touched):</strong> {p.realWorkers} real worker{p.realWorkers === 1 ? '' : 's'}, {p.realOutlets.length} real outlet{p.realOutlets.length === 1 ? '' : 's'}{p.realOutlets.length ? ` (${p.realOutlets.map((o) => o.name).join(', ')})` : ''}, all users, settings and the audit log.</p>
          {p.outletsKept.length > 0 && <p className="small warn">Kept because a real worker is still in it: {p.outletsKept.join(', ')}. Move that worker first if you want it removed.</p>}
          {p.users.length > 0 && <div className="demo-users">
            <p className="small"><strong>Users assigned to DEMO outlets</strong> — choose their real outlet:</p>
            {p.users.map((u) => (
              <div key={u.id} className="demo-user">
                <div><strong>{u.name}</strong> <span className="muted small">{ROLE_LABEL[u.role] || u.role}{u.status !== 'active' ? ` · ${u.status}` : ''}</span>
                  <div className="muted small">now: {u.demoOutlets.join(', ')}{u.otherOutlets ? ` + ${u.otherOutlets} real outlet(s)` : ''}</div></div>
                <select aria-label={`New outlet for ${u.name}`} value={map[u.id] || ''} onChange={(e) => setMap({ ...map, [u.id]: e.target.value })}>
                  <option value="">Leave unassigned</option>
                  {p.realOutlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
            ))}
            {unassigned.length > 0 && <p className="small warn" role="alert">⚠ {unassigned.map((u) => u.name).join(', ')} will have <strong>no outlet</strong>. An Outlet Manager / HR Manager with no outlet sees no workers until you set one in Settings → Users &amp; Access.</p>}
          </div>}
          <p className="small err">Removed records disappear from every phone and computer on the next sync. Download a backup first if you are unsure (Data &amp; Backup → Download backup).</p>
          <div className="field"><label htmlFor="demo-confirm">Type <strong>REMOVE</strong> to confirm</label>
            <input id="demo-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" placeholder="REMOVE" /></div>
        </>}
      </div>}
      {err && <p className="err small">{err}</p>}
    </Modal>
  )
}
