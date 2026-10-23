/* Settings → Agencies & Integrations, and the worker "Check status" panel.
 * There is no public API for these government portals: staff open the official site, check, and record the result here. */
import { useState } from 'react'
import { Btn, Card, Chip, Modal } from './ui'
import { useAuth } from '../lib/auth'
import { setAgenciesLocal, useConfig } from '../lib/config'
import { API_NOTE, CHECK_STATUSES, checkTone, daysSinceCheck, isSafeUrl, lastCheck, saveAgencies, type Agency, type AgenciesConfig, type AgencyCheck } from '../lib/agencies'
import { updateWorker } from '../lib/db'
import { currentDocs } from '../lib/calc'
import { PERMIT } from '../lib/compliance'
import { prepareFiles, uploadDoc } from '../lib/vault'
import { fmtDate, todayISO, uid } from '../lib/util'
import type { Worker } from '../lib/types'
import { toast } from './toast'

export function AgenciesCard() {
  const cfg = useConfig().agencies
  const [d, setD] = useState<AgenciesConfig>(cfg)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const dirty = JSON.stringify(d) !== JSON.stringify(cfg)
  const set = (i: number, patch: Partial<Agency>) => setD({ items: d.items.map((a, j) => (j === i ? { ...a, ...patch } : a)) })
  const save = async () => {
    setBusy(true); setErr('')
    try { await saveAgencies(d); setAgenciesLocal(d); toast('Saved ✓ — agency links updated') } catch (e) { setErr((e as Error).message); toast((e as Error).message, 'err') } finally { setBusy(false) }
  }
  return (
    <Card title="Agencies & Integrations" actions={<>
      <Btn small kind="ghost" disabled={!dirty || busy} onClick={() => setD(cfg)}>Cancel</Btn>
      <Btn small kind="primary" icon="check" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Btn>
    </>}>
      <p className="muted small">Official portals your team uses to check a worker’s status. Each worker has a <strong>Check status</strong> tab with these buttons, copy buttons for the passport / reference numbers, and a place to record what the site said. Links open the official site in a new tab — sign in there with your own employer account. <strong>No passwords are stored in this app.</strong></p>
      {err && <p className="err small">{err}</p>}
      {d.items.map((a, i) => {
        const bad = !isSafeUrl(a.url)
        return (
          <div key={a.id} className={`agency-row${a.enabled ? '' : ' off'}`} data-testid={`agency-${a.id}`}>
            <div className="a-head">
              <label className="check"><input type="checkbox" checked={a.enabled} onChange={(e) => set(i, { enabled: e.target.checked })} aria-label={`Show ${a.short}`} /> <span aria-hidden>{a.icon}</span> <strong>{a.name}</strong></label>
              {!a.enabled && <Chip>Hidden</Chip>}
            </div>
            <label className="small">Link (https only)
              <input type="url" value={a.url} onChange={(e) => set(i, { url: e.target.value })} aria-invalid={bad} /></label>
            {bad && <small className="err">The link must start with https://</small>}
            <label className="small">Notes for staff
              <textarea rows={2} value={a.notes} onChange={(e) => set(i, { notes: e.target.value })} /></label>
            <label className="small">Re-check reminder (days, 0 = none)
              <input type="number" min={0} max={365} value={a.remindDays} onChange={(e) => set(i, { remindDays: Math.max(0, Math.min(365, Number(e.target.value) || 0)) })} style={{ width: 90 }} /></label>
            <label className="small muted">API integration (future)
              <input type="text" disabled value="" placeholder="Not available — no public API" aria-describedby={`api-${a.id}`} /></label>
            <small className="muted" id={`api-${a.id}`}>{API_NOTE}</small>
          </div>
        )
      })}
    </Card>
  )
}

const COPY_LABEL = { passport: 'Passport no', nationality: 'Nationality', permit: 'Permit (PLKS) no', application: 'Application / ref no', workerNo: 'Worker no' } as const

function copyValues(w: Worker) {
  const docs = currentDocs(w)
  const pp = docs.find((x) => x.type === 'Passport')?.number || ''
  const permit = docs.find((x) => x.type === PERMIT)?.number || ''
  const app = [...(w.agencyChecks || [])].reverse().find((c) => c.ref)?.ref || ''
  return { passport: pp, nationality: w.nationality || '', permit, application: app, workerNo: w.workerNo || '' }
}

export function CheckStatusPanel({ w }: { w: Worker }) {
  const agencies = useConfig().agencies.items.filter((a) => a.enabled)
  const { canWrite, profile } = useAuth()
  const [rec, setRec] = useState<Agency | null>(null)
  const vals = copyValues(w)
  const copy = (label: string, v: string) => { void navigator.clipboard?.writeText(v).then(() => toast(`Copied ✓ — ${label}`)) }
  const checks = [...(w.agencyChecks || [])].sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at))
  return (
    <div className="check-panel">
      <Card title="Check status on official sites">
        <p className="muted small">1. Copy the number you need. 2. Open the official site (new tab) and check. 3. Come back and press <strong>Record result</strong>. There is no automatic link to these sites — they offer no public API.</p>
        <div className="copy-row" aria-label="Copy worker details">
          {(Object.keys(COPY_LABEL) as (keyof typeof COPY_LABEL)[]).map((k) => vals[k] ? (
            <button key={k} type="button" className="copy-chip" onClick={() => copy(COPY_LABEL[k], vals[k])} title={`Copy ${COPY_LABEL[k]}`}>📋 {COPY_LABEL[k]}: <code>{vals[k]}</code></button>
          ) : <span key={k} className="copy-chip muted" aria-disabled>{COPY_LABEL[k]}: —</span>)}
        </div>
        <ul className="rows">
          {agencies.map((a) => {
            const lc = lastCheck(w, a.id)
            const days = daysSinceCheck(w, a.id)
            const late = a.remindDays > 0 && (days === null || days > a.remindDays)
            return (
              <li key={a.id}>
                <div className="r-main">
                  <strong><span aria-hidden>{a.icon}</span> {a.short}</strong>
                  <small className="muted">{a.notes}</small>
                  <small>{lc ? <><Chip tone={checkTone(lc.status)}>{lc.status}</Chip> {fmtDate(lc.date)} · {lc.by}{lc.ref ? ` · ref ${lc.ref}` : ''}{lc.note ? ` — ${lc.note}` : ''}</> : <span className="muted">Never checked</span>}
                    {late && <> <Chip tone="amber">{days === null ? 'Not checked yet' : `Not checked in ${days} days`}</Chip></>}</small>
                </div>
                <div className="r-act">
                  <a className="btn btn-secondary btn-s" href={a.url} target="_blank" rel="noopener noreferrer">Open site ↗</a>
                  {canWrite && <Btn small kind="primary" icon="check" onClick={() => setRec(a)}>Record result</Btn>}
                </div>
              </li>
            )
          })}
        </ul>
        {!agencies.length && <p className="muted small">No agencies switched on (Settings → Agencies & Integrations).</p>}
      </Card>
      <Card title={`Check history (${checks.length})`}>
        {!checks.length ? <p className="muted small">No checks recorded yet.</p> : (
          <ul className="rows compact">{checks.map((c) => {
            const a = agencies.find((x) => x.id === c.agency)
            return <li key={c.id}><div className="r-main"><strong>{a?.short || c.agency} · <Chip tone={checkTone(c.status)}>{c.status}</Chip></strong>
              <small className="muted">{fmtDate(c.date)} · by {c.by}{c.ref ? ` · ref ${c.ref}` : ''}{c.note ? ` — ${c.note}` : ''}{c.docId ? ' · 📎 screenshot in vault' : ''}</small></div></li>
          })}</ul>
        )}
      </Card>
      {rec && <RecordCheck w={w} a={rec} by={profile?.full_name || profile?.email || 'me'} onClose={() => setRec(null)} />}
    </div>
  )
}

function RecordCheck({ w, a, by, onClose }: { w: Worker; a: Agency; by: string; onClose: () => void }) {
  const [v, setV] = useState({ status: CHECK_STATUSES[0] as string, date: todayISO(), by, ref: '', note: '' })
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const save = async () => {
    if (!v.date) return setErr('Choose the date of the check')
    setBusy(true); setErr('')
    try {
      let docId: string | undefined
      if (file) {
        const [p] = await prepareFiles([file], false)
        const d = await uploadDoc({ workerId: w.id, category: 'Other', title: `${a.short} check ${fmtDate(v.date)}`, notes: `${v.status}${v.ref ? ` · ref ${v.ref}` : ''}`, source: 'upload' }, p)
        docId = d.id
      }
      const c: AgencyCheck = { id: uid(), agency: a.id, status: v.status, date: v.date, by: v.by.trim() || by, ref: v.ref.trim() || undefined, note: v.note.trim() || undefined, docId, at: new Date().toISOString() }
      await updateWorker(w.id, (x) => { x.agencyChecks = [...(x.agencyChecks || []), c] })
      toast(`Saved ✓ — ${a.short}: ${v.status}`)
      onClose()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Modal title={`Record result — ${a.short}`} onClose={onClose}
      footer={<><Btn kind="ghost" onClick={onClose} disabled={busy}>Cancel</Btn><Btn kind="primary" icon="check" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save result'}</Btn></>}>
      <div className="field"><label>Result</label><select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>{CHECK_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></div>
      <div className="field"><label>Date checked</label><input type="date" value={v.date} max={todayISO()} onChange={(e) => setV({ ...v, date: e.target.value })} /></div>
      <div className="field"><label>Checked by</label><input value={v.by} onChange={(e) => setV({ ...v, by: e.target.value })} /></div>
      <div className="field"><label>Reference / application no (optional)</label><input value={v.ref} onChange={(e) => setV({ ...v, ref: e.target.value })} /></div>
      <div className="field"><label>Note (optional)</label><textarea rows={2} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="What did the site say?" /></div>
      <div className="field"><label>Screenshot (optional — saved to the worker’s vault)</label><input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} /></div>
      {err && <p className="err small">{err}</p>}
    </Modal>
  )
}
