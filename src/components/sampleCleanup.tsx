import { useEffect, useState } from 'react'
import { Btn, Card, Modal } from './ui'
import { supabase } from '../lib/supabase'
import { syncNow } from '../lib/sync'
import { reloadQuota } from '../lib/quota'

/* v1.4.2: Settings → Data → Remove sample data. The Approval & Recruitment sample set lives in companies whose id starts
   "sample-" (letters, requests, recruits, payments, COMs, runaways, claims, their files and the sample workers, outlets,
   hostel and sample users). remove_sample_data() deletes the rows; the files are then removed through the Storage API. */
type Preview = Record<string, number> & { companies: string[] }
type Result = Record<string, number> & { paths: string[]; attachments: string[]; company_files?: string[] }

const LABELS: [string, string][] = [
  ['qr_quotas', 'approval letters'], ['qr_ledger', 'ledger lines'], ['qr_use_requests', 'quota use requests'], ['qr_batches', 'batches'],
  ['qr_recruits', 'recruits'], ['qr_payments', 'payments'], ['qr_exits', 'COMs / exits'], ['qr_runaways', 'runaway cases'], ['qr_claims', 'replacement applications'],
  ['qr_replacements', 'replacements'], ['qr_events', 'timeline events'], ['qr_files', 'document records'], ['workers', 'sample workers'], ['outlets', 'sample outlets'],
  ['hostels', 'sample hostels'], ['users', 'sample users'], ['company_details', 'company details'], ['company_docs', 'SSM copies'], ['company_directors', 'directors'], ['files', 'stored files (PDF / images)'],
]

export function RemoveSampleCard() {
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState<string>('')
  return (
    <Card title="Remove sample data (Approval & Recruitment)">
      <p className="small">Removes the SAMPLE companies and everything in them: approval letters, requests, recruits, payments, COMs, runaways, replacement applications, their sample documents and photos, the sample SSM copies and directors, and the sample workers and users. Your real companies and data are not touched. You see exactly what will be removed first.</p>
      <Btn kind="danger" icon="trash" onClick={() => { setDone(''); setOpen(true) }} data-testid="sample-remove">Remove sample data…</Btn>
      {done && <p className="ok small" role="status" data-testid="sample-done">{done}</p>}
      {open && <RemoveSampleDialog onClose={(m) => { setOpen(false); if (m) setDone(m) }} />}
    </Card>
  )
}

function RemoveSampleDialog({ onClose }: { onClose: (msg?: string) => void }) {
  const [p, setP] = useState<Preview | null>(null)
  const [err, setErr] = useState('')
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    void supabase.rpc('sample_data_preview').then(({ data, error }) => { if (!live) return; if (error) setErr(error.message); else setP(data as Preview) })
    return () => { live = false }
  }, [])
  const nothing = !!p && !p.total
  const go = async () => {
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('remove_sample_data', { p_confirm: typed.trim() })
    if (error) { setErr(error.message); setBusy(false); return }
    const r = data as Result
    let left = 0
    for (const [bucket, list] of [['quota-docs', r.paths || []], ['attachments', r.attachments || []], ['company-docs', r.company_files || []]] as [string, string[]][]) {
      for (let i = 0; i < list.length; i += 100) {
        const { error: e } = await supabase.storage.from(bucket).remove(list.slice(i, i + 100))
        if (e) left += list.slice(i, i + 100).length
      }
    }
    void syncNow(); void reloadQuota()
    onClose(`Removed the sample data: ${r.qr_quotas ?? 0} letters, ${r.qr_recruits ?? 0} recruits, ${r.qr_use_requests ?? 0} requests, ${r.records ?? 0} workers / outlets, ${r.company_directors ?? 0} directors, ${(r.paths?.length || 0) + (r.attachments?.length || 0) + (r.company_files?.length || 0) - left} files.${left ? ` ${left} file(s) could not be removed — try again.` : ''}`)
  }
  return (
    <Modal wide title="Remove sample data" onClose={() => onClose()}
      footer={<><Btn kind="ghost" onClick={() => onClose()} disabled={busy}>Cancel</Btn>
        <Btn kind="danger" icon="trash" onClick={go} disabled={!p || nothing || typed.trim() !== 'REMOVE' || busy}>{busy ? 'Removing…' : 'Remove sample data'}</Btn></>}>
      {!p && !err && <p className="muted">Checking what would be removed…</p>}
      {p && <div data-testid="sample-preview">
        {nothing ? <p className="ok">There is no sample data to remove.</p> : <>
          <p className="small"><strong>Companies:</strong> {p.companies.join(', ')}</p>
          <ul className="small plain-list demo-counts">
            {LABELS.filter(([k]) => p[k]).map(([k, l]) => <li key={k}><strong>{p[k]}</strong> {l}</li>)}
          </ul>
          <p className="small"><strong>Kept:</strong> every real company, worker, user, setting and the audit log.</p>
          <div className="field"><label htmlFor="sample-confirm">Type <strong>REMOVE</strong> to confirm</label>
            <input id="sample-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" placeholder="REMOVE" /></div>
        </>}
      </div>}
      {err && <p className="err small">{err}</p>}
    </Modal>
  )
}
