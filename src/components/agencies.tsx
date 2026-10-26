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
import { DataTable, Details } from './dataTable'
import { Actions, IconAction } from './iconAction'
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
        <DataTable label="Official sites to check" rows={agencies} rowKey={(a) => a.id}
          rowClass={(a) => (a.remindDays > 0 && (daysSinceCheck(w, a.id) === null || (daysSinceCheck(w, a.id) as number) > a.remindDays) ? 'dt-warn' : '')}
          columns={[
            { key: 'a', label: 'Agency', main: true, render: (a) => <><span aria-hidden>{a.icon}</span> {a.short}</> },
            { key: 'last', label: 'Last check', render: (a) => { const lc = lastCheck(w, a.id); return lc ? <span className="row gap-s wrap"><Chip tone={checkTone(lc.status)}>{lc.status}</Chip><span className="small">{fmtDate(lc.date)}</span></span> : <span className="muted small">Never checked</span> } },
            { key: 'due', label: 'Reminder', hide: 'phone', render: (a) => { const days = daysSinceCheck(w, a.id); const late = a.remindDays > 0 && (days === null || days > a.remindDays); return late ? <Chip tone="amber">{days === null ? 'Not checked yet' : `Not checked in ${days} days`}</Chip> : <span className="muted small">—</span> } },
          ]}
          actions={(a) => <Actions><IconAction kind="view" label={`Open ${a.short} official site`} href={a.url} />{canWrite && <IconAction kind="approve" tone="pri" label="Record result" onClick={() => setRec(a)} />}</Actions>}
          expand={(a) => { const lc = lastCheck(w, a.id)
            return <>
              <Details items={[['About', a.notes], ['Last check', lc ? `${lc.status} · ${fmtDate(lc.date)} · ${lc.by}` : 'Never checked'], ['Reference', lc?.ref], ['Note', lc?.note], ['Remind every', a.remindDays ? `${a.remindDays} days` : null]]} />
              <div className="row gap-s wrap mt-s"><a className="btn btn-secondary btn-s" href={a.url} target="_blank" rel="noopener noreferrer">Open site ↗</a>{canWrite && <Btn small kind="primary" icon="check" onClick={() => setRec(a)}>Record result</Btn>}</div>
            </> }} />
        {!agencies.length && <p className="muted small">No agencies switched on (Settings → Agencies & Integrations).</p>}
      </Card>
      <Card title={`Check history (${checks.length})`}>
        {!checks.length ? <p className="muted small">No checks recorded yet.</p> : (
          <DataTable label="Check history" dense rows={checks} rowKey={(c) => c.id}
            columns={[
              { key: 'a', label: 'Agency', main: true, render: (c) => agencies.find((x) => x.id === c.agency)?.short || c.agency },
              { key: 's', label: 'Result', render: (c) => <Chip tone={checkTone(c.status)}>{c.status}</Chip> },
              { key: 'd', label: 'Date', hide: 'phone', sort: (c) => c.date, render: (c) => fmtDate(c.date) },
              { key: 'by', label: 'By', hide: 'tablet', render: (c) => c.by },
            ]}
            expand={(c) => <Details items={[['Date', fmtDate(c.date)], ['By', c.by], ['Reference', c.ref], ['Note', c.note], ['Screenshot', c.docId ? 'Saved in the vault' : null]]} />} />
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
