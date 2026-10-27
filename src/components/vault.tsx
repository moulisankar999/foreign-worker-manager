import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Btn, Card, Chip, Empty, Modal, Toolbar, SelectFilter, Skeleton } from './ui'
import { useAuth } from '../lib/auth'
import { allVaultCategories, useConfig } from '../lib/config'
import { VAULT_CATEGORIES } from '../lib/workflow'
import { docVersions, downloadDoc, fmtSize, openDoc, prepareFiles, shareDoc, updateDoc, uploadDoc, useDocs, type DocRow, type NewDoc } from '../lib/vault'
import { useWorkers } from '../lib/hooks'
import { fmtDate, todayISO } from '../lib/util'
import { DataTable, Details } from './dataTable'
import { Actions, IconAction } from './iconAction'

const daysTo = (d?: string | null) => (d ? Math.round((new Date(d).getTime() - new Date(todayISO()).getTime()) / 86400000) : null)
export function expiryChip(d?: string | null) {
  const n = daysTo(d)
  if (n === null) return null
  if (n < 0) return <Chip tone="red">Expired {fmtDate(d!)}</Chip>
  if (n <= 60) return <Chip tone="amber">Exp. {fmtDate(d!)} ({n}d)</Chip>
  return <Chip tone="green">Exp. {fmtDate(d!)}</Chip>
}
const run = async (f: () => Promise<unknown>) => { try { await f() } catch (e) { alert((e as Error).message) } }

/** Categories the current user may pick (outlet managers / viewers never see restricted ones such as Payslip, Bank). */
export function useCategories() {
  const { isOM, role } = useAuth()
  const v = useConfig().vault
  const all = allVaultCategories(v, VAULT_CATEGORIES)
  return isOM || role === 'viewer' ? all.filter((c) => !v.restricted.includes(c)) : all
}

const docKind = (d: DocRow) => (d.mime === 'application/pdf' ? `PDF${d.pages && d.pages > 1 ? `, ${d.pages} pages` : ''}` : 'Photo')

/** Icon actions for one document: preview, download, share, older versions, edit details (remove lives inside Edit, with its confirm). */
export function DocActions({ d }: { d: DocRow }) {
  const { canWrite } = useAuth()
  const [vers, setVers] = useState<DocRow[] | null>(null)
  const [edit, setEdit] = useState(false)
  const [busy, setBusy] = useState(false)
  const act = (f: () => Promise<unknown>) => () => { setBusy(true); void run(f).finally(() => setBusy(false)) }
  return (
    <Actions>
      <IconAction kind="view" label="Preview" disabled={busy} onClick={act(() => openDoc(d))} />
      <IconAction kind="download" label="Download" disabled={busy} onClick={act(() => downloadDoc(d))} />
      <IconAction kind="send" label="Share" disabled={busy} onClick={act(() => shareDoc(d))} />
      {d.version > 1 && <IconAction kind="more" label="Older versions" onClick={() => void docVersions(d.group_id).then(setVers)} />}
      {canWrite && <IconAction kind="edit" label="Edit details or remove" onClick={() => setEdit(true)} />}
      {vers && (
        <Modal title={`Versions — ${d.title}`} onClose={() => setVers(null)}>
          <DataTable label="Versions" dense rows={vers} rowKey={(v) => v.id}
            columns={[
              { key: 'v', label: 'Version', main: true, render: (v) => <>v{v.version}{v.is_current ? ' (current)' : ''}<small>{v.uploaded_by_name}</small></> },
              { key: 'at', label: 'Uploaded', render: (v) => fmtDate(v.uploaded_at.slice(0, 10)) },
              { key: 'size', label: 'Size', hide: 'phone', render: (v) => fmtSize(v.size_bytes) },
            ]}
            actions={(v) => <Actions><IconAction kind="view" label="Preview" onClick={() => void run(() => openDoc(v))} /><IconAction kind="download" label="Download" onClick={() => void run(() => downloadDoc(v))} /></Actions>} />
        </Modal>
      )}
      {edit && <EditDoc d={d} onClose={() => setEdit(false)} />}
    </Actions>
  )
}

/** Clean table of documents: compact rows, tap to see all details. */
export function DocTable({ docs, workerName, label = 'Documents' }: { docs: DocRow[]; workerName?: (id: string) => string; label?: string }) {
  const cats = [...new Set(docs.map((d) => d.category))].sort()
  return (
    <DataTable label={label} className="doc-table" rows={docs} rowKey={(d) => d.id} rowTestId={() => 'doc-row'} initialSort={{ key: 'up', dir: 'desc' }}
      search={(d) => `${workerName ? workerName(d.worker_id) : ''} ${d.title} ${d.file_name} ${d.category} ${d.doc_no || ''}`} searchLabel="Search documents"
      filters={!workerName && cats.length > 1 ? [{ key: 'cat', label: 'Category', options: cats, match: (d, v) => d.category === v }] : undefined}
      rowClass={(d) => { const n = daysTo(d.expiry_date); return n === null ? '' : n < 0 ? 'dt-bad' : n <= 60 ? 'dt-warn' : '' }}
      columns={[
        { key: 'title', label: 'Document', main: true, sort: (d) => (d.title || d.file_name || '').toLowerCase(), render: (d) => <>{d.title || d.file_name}<small>{d.category}{d.doc_no ? ` · ${d.doc_no}` : ''}</small></> },
        ...(workerName ? [{ key: 'w', label: 'Worker', hide: 'phone' as const, sort: (d: DocRow) => workerName(d.worker_id), render: (d: DocRow) => <Link className="dt-link" to={`/workers/${d.worker_id}?tab=vault`}>{workerName(d.worker_id)}</Link> }] : []),
        { key: 'exp', label: 'Expiry', sort: (d) => d.expiry_date || '9999', render: (d) => expiryChip(d.expiry_date) || <span className="muted">—</span> },
        { key: 'up', label: 'Uploaded', hide: 'tablet', sort: (d) => d.uploaded_at, render: (d) => <span className="small">{fmtDate(d.uploaded_at.slice(0, 10))}<small>{d.uploaded_by_name || ''}</small></span> },
        { key: 'ver', label: 'Ver.', hide: 'tablet', align: 'center', sort: (d) => d.version, render: (d) => `v${d.version}` },
      ]}
      actions={(d) => <DocActions d={d} />}
      expand={(d) => (
        <>
          <Details items={[
            ...(workerName ? [['Worker', <Link key="w" className="link" to={`/workers/${d.worker_id}?tab=vault`}>{workerName(d.worker_id)} →</Link>] as [string, ReactNode]] : []),
            ['Category', d.category], ['Document no.', d.doc_no], ['Issued', d.issue_date ? fmtDate(d.issue_date) : null], ['Expiry', d.expiry_date ? fmtDate(d.expiry_date) : null],
            ['File', `${docKind(d)} · ${fmtSize(d.size_bytes)}`], ['Version', `v${d.version}`], ['Uploaded', `${d.uploaded_by_name || ''} ${fmtDate(d.uploaded_at.slice(0, 10))}`], ['Notes', d.notes],
          ]} />
          <div className="row gap-s wrap mt-s">{expiryChip(d.expiry_date)}{d.source === 'memo' && <Chip tone="purple">Auto-saved memo</Chip>}{d.request_id && <Chip tone="blue">On a request</Chip>}</div>
        </>
      )} />
  )
}

function EditDoc({ d, onClose }: { d: DocRow; onClose: () => void }) {
  const cats = useCategories()
  const [v, setV] = useState({ title: d.title, doc_no: d.doc_no || '', issue_date: d.issue_date || '', expiry_date: d.expiry_date || '', notes: d.notes || '', category: d.category })
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value })
  return (
    <Modal title="Document details" onClose={onClose} footer={<>
      <Btn kind="danger" icon="trash" onClick={() => { if (confirm('Remove this document? (kept in the audit log and can be restored)')) void run(async () => { await updateDoc(d.id, { deleted: true }); onClose() }) }}>Remove</Btn>
      <span className="grow" />
      <Btn onClick={onClose}>Cancel</Btn>
      <Btn kind="primary" onClick={() => run(async () => { await updateDoc(d.id, { ...v, doc_no: v.doc_no || null, issue_date: v.issue_date || null, expiry_date: v.expiry_date || null, notes: v.notes || null }); onClose() })}>Save</Btn>
    </>}>
      <div className="grid-form">
        <div className="field"><label>Category</label><select value={v.category} onChange={set('category')}>{cats.map((c) => <option key={c}>{c}</option>)}</select></div>
        <div className="field"><label>Title</label><input value={v.title} onChange={set('title')} /></div>
        <div className="field"><label>Document no.</label><input value={v.doc_no} onChange={set('doc_no')} /></div>
        <div className="field"><label>Issue date</label><input type="date" value={v.issue_date} onChange={set('issue_date')} /></div>
        <div className="field"><label>Expiry date</label><input type="date" value={v.expiry_date} onChange={set('expiry_date')} /></div>
        <div className="field full"><label>Notes</label><textarea rows={2} value={v.notes} onChange={set('notes')} /></div>
      </div>
    </Modal>
  )
}

/** Upload / scan dialog. Phone camera: take several pages → merged into one PDF (1600 px, JPEG 70 %). */
export function UploadDoc({ workerId, requestId, category, lockCategory, groupId, title, onClose, onDone, hint }: {
  workerId: string; requestId?: string; category?: string; lockCategory?: boolean; groupId?: string; title?: string; hint?: string
  onClose: () => void; onDone?: (d: DocRow) => void
}) {
  const cats = useCategories()
  const v = useConfig().vault
  const [meta, setMeta] = useState<NewDoc>({ workerId, requestId, category: category || '', title: title || '', groupId })
  const [files, setFiles] = useState<File[]>([])
  const [merge, setMerge] = useState(true)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const cam = useRef<HTMLInputElement>(null)
  const pick = useRef<HTMLInputElement>(null)
  const thumbs = useMemo(() => files.map((f) => (f.type.startsWith('image/') ? URL.createObjectURL(f) : '')), [files])
  const add = (l: FileList | null) => { if (l) setFiles((x) => [...x, ...Array.from(l)]); setErr('') }
  const save = async () => {
    setErr('')
    if (!meta.category) return setErr('Choose a category')
    if (!files.length) return setErr('Scan or choose at least one file')
    try {
      setBusy('Compressing…')
      const prepared = await prepareFiles(files, merge)
      let last: DocRow | null = null
      for (let i = 0; i < prepared.length; i++) {
        setBusy(`Uploading ${i + 1}/${prepared.length}…`)
        last = await uploadDoc({ ...meta, title: meta.title ? (prepared.length > 1 ? `${meta.title} (${i + 1})` : meta.title) : `${meta.category} ${fmtDate(todayISO())}`, groupId: i === 0 ? meta.groupId : undefined, source: files.some((f) => f.name.startsWith('scan') || f.type.startsWith('image/')) ? 'scan' : 'upload' }, prepared[i])
      }
      if (last) onDone?.(last)
      onClose()
    } catch (e) { setErr((e as Error).message) } finally { setBusy('') }
  }
  return (
    <Modal title={groupId ? 'Upload new version' : 'Add document'} onClose={onClose} footer={<>
      <Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" icon="upload" disabled={!!busy} onClick={save}>{busy || 'Save to vault'}</Btn>
    </>}>
      {hint && <p className="banner small">{hint}</p>}
      <div className="grid-form">
        <div className="field"><label>Category <span className="req">*</span></label>
          <select value={meta.category} disabled={lockCategory} onChange={(e) => setMeta({ ...meta, category: e.target.value })}>
            <option value="">— Select —</option>{[...new Set([...(category ? [category] : []), ...cats])].map((c) => <option key={c}>{c}</option>)}
          </select></div>
        <div className="field"><label>Title</label><input value={meta.title} placeholder="e.g. Passport bio page" onChange={(e) => setMeta({ ...meta, title: e.target.value })} /></div>
        <div className="field"><label>Document no.</label><input value={meta.docNo || ''} onChange={(e) => setMeta({ ...meta, docNo: e.target.value })} /></div>
        <div className="field"><label>Expiry date</label><input type="date" value={meta.expiryDate || ''} onChange={(e) => setMeta({ ...meta, expiryDate: e.target.value })} /></div>
      </div>
      <div className="row gap-s wrap mt-s">
        <Btn kind="primary" icon="plus" onClick={() => cam.current?.click()}>📷 Scan page{files.length ? ' +' : ''}</Btn>
        <Btn icon="upload" onClick={() => pick.current?.click()}>Choose file</Btn>
        <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { add(e.target.files); e.target.value = '' }} />
        <input ref={pick} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = '' }} />
      </div>
      {files.length > 0 && (
        <div className="scan-strip">
          {files.map((f, i) => (
            <div key={i} className="scan-th">
              {thumbs[i] ? <img src={thumbs[i]} alt={`Page ${i + 1}`} /> : <span>PDF<br /><small>{f.name}</small></span>}
              <button type="button" aria-label="Remove page" onClick={() => setFiles(files.filter((_, j) => j !== i))}>×</button>
              <small>{i + 1}</small>
            </div>
          ))}
        </div>
      )}
      {files.filter((f) => f.type.startsWith('image/')).length > 1 && <label className="check mt-s"><input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} /> Merge the pages into one PDF</label>}
      <p className="muted small mt-s">Photos are reduced to 1600 px (JPEG 70 %) automatically. Limits: {v.maxImageKB / 1024} MB per photo, {v.maxPdfKB / 1024} MB per PDF. Files are private — only people allowed to see this worker can open them (links expire after 5 minutes).</p>
      {err && <p className="err" role="alert">{err}</p>}
    </Modal>
  )
}

/** Per-worker document vault (cloud). */
export function VaultPanel({ workerId }: { workerId: string }) {
  const { canWrite, isOM } = useAuth()
  const { docs, loading, error } = useDocs({ workerId })
  const [up, setUp] = useState<{ category?: string; groupId?: string; title?: string } | null>(null)
  const [cat, setCat] = useState('')
  const cats = [...new Set(docs.map((d) => d.category))].sort()
  const shown = cat ? docs.filter((d) => d.category === cat) : docs
  return (
    <Card title={`Document vault (${docs.length})`} actions={(canWrite || isOM) && <Btn small kind="primary" icon="plus" onClick={() => setUp({})}>Add / scan</Btn>}>
      {cats.length > 1 && <Toolbar><SelectFilter label="Category" value={cat} onChange={setCat} options={[{ value: '', label: 'All categories' }, ...cats]} /></Toolbar>}
      {error && <p className="warn small">{error}</p>}
      {loading ? <Skeleton /> : shown.length === 0 ? <Empty title="No documents in the vault yet"><p className="muted small">Scan passport, permit, FOMEMA, contract, tickets… with the phone camera.</p></Empty> : (
        <DocTable docs={shown} label="Document vault" />
      )}
      {canWrite && shown.length > 0 && <p className="muted small">To replace a document with a newer copy, open the document's details or use “Add / scan” with the same category — older versions stay available.</p>}
      {up && <UploadDoc workerId={workerId} {...up} onClose={() => setUp(null)} />}
    </Card>
  )
}

/** Global library: every document the user may see, with expiry filter. */
export function DocumentLibrary() {
  const workers = useWorkers()
  const { docs, loading, error } = useDocs({ all: true })
  const [cat, setCat] = useState('')
  const [q, setQ] = useState('')
  const [exp, setExp] = useState('')
  const name = (id: string) => { const w = workers.find((x) => x.id === id); return w ? `${w.fullName} (${w.workerNo})` : id }
  const cats = [...new Set(docs.map((d) => d.category))].sort()
  const shown = docs.filter((d) => (!cat || d.category === cat) && (!q || `${name(d.worker_id)} ${d.title} ${d.doc_no || ''}`.toLowerCase().includes(q.toLowerCase()))
    && (!exp || (exp === 'expired' ? (daysTo(d.expiry_date) ?? 1) < 0 : (daysTo(d.expiry_date) ?? 999) <= Number(exp) && (daysTo(d.expiry_date) ?? -1) >= 0)))
  return (
    <div className="page">
      <div className="page-h"><div><h1>Document library</h1><p className="muted">{docs.length} documents · private cloud vault</p></div></div>
      <Toolbar>
        <input className="search-in" placeholder="Search worker, title, number…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search documents" />
        <SelectFilter label="Category" value={cat} onChange={setCat} options={[{ value: '', label: 'All categories' }, ...cats]} />
        <SelectFilter label="Expiry" value={exp} onChange={setExp} options={[{ value: '', label: 'Any expiry' }, { value: 'expired', label: 'Expired' }, { value: '30', label: 'Expiring ≤ 30 days' }, { value: '60', label: 'Expiring ≤ 60 days' }, { value: '90', label: 'Expiring ≤ 90 days' }]} />
      </Toolbar>
      {error && <p className="warn small">{error}</p>}
      <Card>
        {loading ? <Skeleton /> : shown.length === 0 ? <Empty title="No documents match" /> : (
          <DocTable docs={shown} workerName={name} label="Document library" />
        )}
      </Card>
    </div>
  )
}
