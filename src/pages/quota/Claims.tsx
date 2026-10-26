/* Replacement (gantian) claims: pick eligible COMs, print one merged claim pack, submit, record the result.
 * An approved claim becomes a new replacement letter in the ledger. A COM cannot sit in two claims. */
import { useState } from 'react'
import { Btn, Card, Chip, Empty } from '../../components/ui'
import { DataTable, Details } from '../../components/dataTable'
import { Actions, IconAction } from '../../components/iconAction'
import { toast } from '../../components/toast'
import { Preview } from '../../reports/Preview'
import { sheetsToPdf } from '../../reports/export'
import type { Block } from '../../reports/types'
import { download, fmtDate, todayISO } from '../../lib/util'
import { addMonths } from '../../lib/util'
import { inCompany, CLAIM_STATUS, EXIT_KIND, fileBytes, qcall, useQuota, type Claim } from '../../lib/quota'
import { FileField, FileLink, NoteAsk, QForm, s, useQCtx, useSheetMeta, type V } from './shared'

export function ClaimsTab({ company }: { company: string }) {
  const ctx = useQCtx()
  const d = useQuota()
  const [form, setForm] = useState<V | null>(null)
  const [pack, setPack] = useState<Claim | null>(null)
  const [submit, setSubmit] = useState<Claim | null>(null)
  const [result, setResult] = useState<Claim | null>(null)
  const [reject, setReject] = useState<Claim | null>(null)
  const rows = d.claims.filter((c) => inCompany(company, c.company_id))
  const elig = d.exits.filter((x) => x.status === 'eligible' && (inCompany(company, x.company_id)))
  const items = (c: Claim) => d.claimItems.filter((i) => i.claim_id === c.id).map((i) => ({ i, x: d.exits.find((x) => x.id === i.exit_id)! })).filter((r) => r.x)
  return (
    <div className="qr-grid">
      <div className="note-box">Replacement quota (gantian) is opened by the government from time to time — the most recent window ran 19 Jan – 31 Mar 2026. Keep every COM here; when a window opens, select the eligible ones, print the pack and submit. <b>{elig.length}</b> COM(s) are eligible and not yet claimed.</div>
      <Card title="Replacement claims" actions={ctx.isHraUp && <Btn kind="primary" icon="plus" small disabled={!elig.length} onClick={() => setForm({ company_id: company || elig[0]?.company_id, title: `Replacement claim ${todayISO().slice(0, 7)}`, exit_ids: [] })}>New claim</Btn>}>
        <DataTable label="Replacement claims" rows={rows} rowKey={(c) => c.id} initialSort={{ key: 'n', dir: 'desc' }}
          columns={[
            { key: 'n', label: 'Claim', main: true, render: (c) => <><b>C-{c.ref_no}</b> {c.title}<br /><small className="muted">{ctx.cName(c.company_id)}</small></>, sort: (c) => c.ref_no },
            { key: 'k', label: 'COMs', align: 'right', render: (c) => `${items(c).filter((r) => !r.i.released || r.i.approved).length}${c.approved_count != null ? ` · ${c.approved_count} approved` : ''}` },
            { key: 's', label: 'Status', render: (c) => <Chip tone={CLAIM_STATUS[c.status].tone}>{CLAIM_STATUS[c.status].label}</Chip> },
            { key: 'g', label: 'Gov ref', hide: 'phone', render: (c) => c.gov_ref || '—' },
          ]}
          expand={(c) => <>
            <Details items={[['Announcement', c.announcement || '—'], ['Submitted', c.submitted_at ? fmtDate(c.submitted_at) : '—'], ['Decided', c.decided_on ? `${fmtDate(c.decided_on)} · ${ctx.who(c.decided_by_name, null)}` : '—'],
              ['New letter', d.quotas.find((q) => q.id === c.new_quota_id)?.ref_no || '—'], ['Pack', <FileLink key="p" f={d.files.find((f) => f.id === c.pack_file)} label="Submitted pack" />], ['Notes', c.notes || '—'], ['Created by', ctx.who(c.created_by_name, null)]]} />
            <ul className="alist">{items(c).map(({ i, x }) => <li key={x.id} className={i.released ? 'strike' : ''}>{x.worker_name} · {x.cmo_ref || EXIT_KIND[x.kind]} · {x.country} {i.approved === true && <Chip tone="green">approved</Chip>}{i.approved === false && <Chip tone="gray">not approved</Chip>}</li>)}</ul>
          </>}
          actions={(c) => <Actions>
            <IconAction kind="print" label="Claim pack (A4 + COM copies)" onClick={() => setPack(c)} />
            {c.status === 'draft' && ctx.isHraUp && <IconAction kind="send" label="Mark as submitted" onClick={() => setSubmit(c)} />}
            {['draft', 'submitted'].includes(c.status) && ctx.isGmUp && c.created_by !== ctx.profile?.id && <>
              <IconAction kind="approve" label="Record approval (new replacement letter)" onClick={() => setResult(c)} />
              <IconAction kind="reject" label="Record rejection (COMs become eligible again)" onClick={() => setReject(c)} /></>}
          </Actions>}
          empty={<Empty title="No claims yet" />} />
      </Card>
      {form && <QForm wide title="New replacement claim" initial={form} onClose={() => setForm(null)} saveLabel="Create claim"
        fields={[{ key: 'company_id', label: 'Company', type: 'select', required: true, options: ctx.companies.filter((c) => elig.some((x) => x.company_id === c.id)).map((c) => ({ value: c.id, label: c.name })) },
          { key: 'title', label: 'Title', required: true }, { key: 'announcement', label: 'Government announcement / circular', full: true }, { key: 'notes', label: 'Notes', full: true }]}
        onSave={(v) => { const ids = (v.exit_ids as string[]).filter((id) => elig.find((x) => x.id === id)?.company_id === v.company_id); if (!ids.length) throw new Error('Select at least one COM.'); return qcall('qr_claim_create', { p: { ...v, exit_ids: ids } }) }}>
        {(v, set) => { const l = elig.filter((x) => x.company_id === v.company_id); const sel = v.exit_ids as string[]; return <div className="qr-picks">
          <div className="row-gap"><b>Eligible COMs ({sel.filter((id) => l.some((x) => x.id === id)).length}/{l.length})</b><button type="button" className="linkish" onClick={() => set({ exit_ids: l.map((x) => x.id) })}>Select all</button></div>
          {l.map((x) => <label key={x.id}><input type="checkbox" checked={sel.includes(x.id)} onChange={(e) => set({ exit_ids: e.target.checked ? [...sel, x.id] : sel.filter((y) => y !== x.id) })} /> {x.worker_name} · {x.cmo_ref || EXIT_KIND[x.kind]} · {x.country} · {fmtDate(x.cmo_date || x.departure_date || '')}</label>)}
        </div> }}
      </QForm>}
      {pack && <ClaimPack c={pack} onClose={() => setPack(null)} />}
      {submit && <QForm title={`Submit C-${submit.ref_no}`} initial={{ submitted_at: todayISO() }} onClose={() => setSubmit(null)} saveLabel="Mark submitted"
        fields={[{ key: 'submitted_at', label: 'Submitted on', type: 'date', required: true }, { key: 'gov_ref', label: 'Submission / application ref' }]}
        onSave={(v) => qcall('qr_claim_status', { p_id: submit.id, p: { status: 'submitted', ...v } })}>
        {(v, set) => <FileField company={submit.company_id} kind="claim" label="Submitted pack (PDF)" value={v.pack_file as string} onChange={(id) => set({ pack_file: id })} />}
      </QForm>}
      {result && <QForm wide title={`Result of C-${result.ref_no}`} initial={{ decided_on: todayISO(), expiry_date: addMonths(todayISO(), 12), ok: items(result).filter((r) => !r.i.released).map((r) => r.x.id) }} onClose={() => setResult(null)} saveLabel="Record approval"
        note="The approved COMs become a new replacement letter, opened at once. COMs not approved become eligible again."
        fields={[{ key: 'gov_ref', label: 'Replacement approval letter ref', required: true }, { key: 'decided_on', label: 'Letter date', type: 'date', required: true }, { key: 'expiry_date', label: 'Letter expiry', type: 'date' }]}
        onSave={(v) => { const ok = v.ok as string[]; const all = items(result).filter((r) => !r.i.released); if (!ok.length) throw new Error('None approved — record a rejection instead.')
          return qcall('qr_claim_status', { p_id: result.id, p: { status: ok.length === all.length ? 'approved' : 'partly_approved', gov_ref: v.gov_ref, decided_on: v.decided_on, expiry_date: s(v.expiry_date) || null, letter_file: v.letter_file || null, approved_exit_ids: ok } }) }}>
        {(v, set) => { const ok = v.ok as string[]; return <>
          <FileField company={result.company_id} kind="letter" label="Approval letter" value={v.letter_file as string} onChange={(id) => set({ letter_file: id })} />
          <div className="qr-picks"><b>Approved COMs</b>{items(result).filter((r) => !r.i.released).map(({ x }) => <label key={x.id}><input type="checkbox" checked={ok.includes(x.id)} onChange={(e) => set({ ok: e.target.checked ? [...ok, x.id] : ok.filter((y) => y !== x.id) })} /> {x.worker_name} · {x.cmo_ref} · {x.country}</label>)}</div></> }}
      </QForm>}
      {reject && <NoteAsk title={`Reject C-${reject.ref_no}`} label="Reason / government reply" danger confirm="Record rejection" onClose={() => setReject(null)} onOk={(n) => qcall('qr_claim_status', { p_id: reject.id, p: { status: 'rejected', note: n } })} />}
    </div>
  )
}

function ClaimPack({ c, onClose }: { c: Claim; onClose: () => void }) {
  const ctx = useQCtx()
  const d = useQuota()
  const [busy, setBusy] = useState(false)
  const list = d.claimItems.filter((i) => i.claim_id === c.id && (!i.released || i.approved)).map((i) => d.exits.find((x) => x.id === i.exit_id)!).filter(Boolean)
  const meta = useSheetMeta(c.company_id, `Replacement quota claim C-${c.ref_no}`, c.title)
  const byC = new Map<string, number>(); for (const x of list) byC.set(x.country || '—', (byC.get(x.country || '—') || 0) + 1)
  const blocks: Block[] = [
    { kind: 'heading', text: `Application for replacement foreign workers (gantian) — ${ctx.cName(c.company_id)}`, sub: c.announcement || undefined },
    { kind: 'kpis', items: [{ label: 'Workers who left (COM)', value: list.length }, ...[...byC.entries()].map(([k, v]) => ({ label: k, value: v }))] },
    { kind: 'table', title: 'Workers who left Malaysia with a Check Out Memo', cols: [{ key: 'i', label: '#', w: 4 }, { key: 'n', label: 'Name', w: 24, wrap: true }, { key: 'p', label: 'Passport', w: 12 }, { key: 'k', label: 'PLKS', w: 12 }, { key: 'c', label: 'Country', w: 10 }, { key: 'r', label: 'COM ref', w: 16 }, { key: 'd', label: 'COM date', fmt: 'date', w: 10 }, { key: 'q', label: 'Original letter', w: 12 }],
      rows: list.map((x, i) => ({ i: i + 1, n: x.worker_name, p: x.passport_no, k: x.permit_no, c: x.country, r: x.cmo_ref || EXIT_KIND[x.kind], d: x.cmo_date || x.departure_date, q: d.quotas.find((q) => q.id === x.quota_id)?.ref_no || '' })) },
    { kind: 'note', text: 'Copies of each Check Out Memo follow this page in the merged PDF, in the same order. Each copy is kept permanently and verified against its SHA-256 fingerprint.' },
    { kind: 'signatures' },
  ]
  const merged = async () => {
    setBusy(true)
    try {
      const { PDFDocument } = await import('pdf-lib')
      const root = document.querySelector('.rpt-overlay .rpt-pages') as HTMLElement | null
      if (!root) throw new Error('The pages are still laying out — try again in a moment.')
      const out = await PDFDocument.load(await (await sheetsToPdf(root)).arrayBuffer())
      let missing = 0
      for (const x of list) {
        const f = d.files.find((y) => y.id === x.file_id); if (!f) { missing++; continue }
        const { bytes, ok } = await fileBytes(f); if (!ok) throw new Error(`The stored COM for ${x.worker_name} does not match its fingerprint.`)
        if ((f.mime || '').includes('pdf')) { const src = await PDFDocument.load(bytes, { ignoreEncryption: true }); for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p) }
        else { const img = (f.mime || '').includes('png') ? await out.embedPng(bytes) : await out.embedJpg(bytes); const page = out.addPage([595.28, 841.89]); const sc = Math.min(555 / img.width, 800 / img.height); page.drawImage(img, { x: (595.28 - img.width * sc) / 2, y: (841.89 - img.height * sc) / 2, width: img.width * sc, height: img.height * sc }) }
      }
      const pdfBytes = await out.save()
      download(`replacement-claim-C${c.ref_no}.pdf`, new Blob([pdfBytes as BlobPart], { type: "application/pdf" }))
      if (missing) toast(`${missing} COM(s) have no stored copy — attach them in the COM register.`, 'err')
    } catch (e) { toast((e as Error).message, 'err') } finally { setBusy(false) }
  }
  return <Preview blocks={blocks} meta={meta} file={`replacement-claim-C${c.ref_no}-cover.pdf`} onClose={onClose}
    extra={<Btn kind="primary" icon="download" disabled={busy} onClick={merged}>{busy ? 'Merging…' : 'Merged pack with COM copies'}</Btn>} />
}
