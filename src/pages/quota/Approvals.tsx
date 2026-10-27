/* Quota Use Requests: every use of the quota is approved before the calling visa (VDR) is applied.
 * The approval order and checks are enforced in the database (qr_decide_use); the screen shows neutral status text only. */
import { celebrate } from '../../lib/celebrate'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Btn, Card, Chip, Empty } from '../../components/ui'
import { DataTable, Details, usePaged } from '../../components/dataTable'
import { Actions, IconAction } from '../../components/iconAction'
import { inCompany, atMyt, qcall, rmFmt, UR_STATUS, useQuota, type UseReq } from '../../lib/quota'
import { FileField, FileLink, NoteAsk, QForm, s, useQCtx, type V, fileCount } from './shared'

export const canDecide = (r: UseReq, rank: number, me?: string) =>
  r.requested_by !== me && ((rank >= 4 && (r.status === 'pending' || r.status === 'gm_approved')) || (rank === 3 && r.status === 'pending'))

export function Timeline({ items, who }: { items: { at: string; by: string; role: string; action: string; note?: string | null }[]; who: (n: string, r: string) => string }) {
  return (
    <ol className="qr-tl">{items.map((t, i) => (
      <li key={i} className={/Rejected|Returned/.test(t.action) ? 'bad' : /^Approved(?! by GM| —)/.test(t.action) ? 'good' : ''}>
        <b>{t.action}</b> <small className="muted">{atMyt(t.at)} · {who(t.by, t.role)}</small>{t.note && <div className="qr-tl-n">{t.note}</div>}
      </li>))}</ol>
  )
}

export function ApprovalsTab({ company }: { company: string }) {
  const ctx = useQCtx()
  const d = useQuota()
  const [sp] = useSearchParams()
  const [form, setForm] = useState<V | null>(null)
  const [ask, setAsk] = useState<{ r: UseReq; action: 'approve' | 'reject' | 'return' | 'cancel' | 'resubmit' | 'release' } | null>(null)
  const rows = d.requests.filter((r) => inCompany(company, r.company_id))
  const me = ctx.profile?.id
  const qRef = (id: string) => d.quotas.find((q) => q.id === id)?.ref_no || ''
  const resvLeft = (r: UseReq) => d.ledger.filter((e) => e.use_request_id === r.id).reduce((a, e) => a + e.d_resv, 0)
  const waiting = rows.filter((r) => canDecide(r, ctx.rank, me))
  const waitPage = usePaged(waiting, 5)
  const ACT = {
    approve: { t: 'Approve', label: 'Note (optional)', req: false, danger: false },
    reject: { t: 'Reject — the slots go back to the balance', label: 'Reason for the requester', req: true, danger: true },
    return: { t: 'Return for changes', label: 'What needs to change', req: true, danger: false },
    cancel: { t: 'Cancel the request — the slots go back', label: 'Reason', req: false, danger: true },
    resubmit: { t: 'Resubmit', label: 'What you changed', req: false, danger: false },
    release: { t: 'Release unused slots', label: 'Reason', req: true, danger: false },
  }
  return (
    <div className="qr-grid">
      <div className="note-box">
        Every quota slot is used only after its Quota Use Request is approved. The calling visa step opens once the request is approved; the timeline shows each step.
      </div>
      {ctx.isGmUp && waiting.length > 0 && <Card fold="open" title={<>Waiting for your approval <Chip tone="red">{waiting.length}</Chip></>}>
        <ul className="alist">{waitPage.rows.map((r) => <li key={r.id}><Chip tone={UR_STATUS[r.status].tone}>Q-{r.ref_no}</Chip><span className="qr-li"><span>{r.slots} × {r.country} on {qRef(r.quota_id)} — {r.purpose}</span></span>
          <Actions><IconAction kind="approve" label="Approve" onClick={() => setAsk({ r, action: 'approve' })} /><IconAction kind="recall" label="Return for changes" onClick={() => setAsk({ r, action: 'return' })} /><IconAction kind="reject" label="Reject" onClick={() => setAsk({ r, action: 'reject' })} /></Actions></li>)}</ul>
        {waitPage.pager('Waiting for your approval')}
      </Card>}
      <Card title="Quota Use Requests" actions={ctx.rank < 4 ? <Btn kind="primary" icon="plus" small onClick={() => setForm({ slots: 1 })}>New request</Btn> : <small className="muted">Requests are raised by HR or the GM.</small>}>
        <DataTable clip={(r) => fileCount(d.files, r.files)} label="Quota Use Requests" pageSize={10} rows={rows} rowKey={(r) => r.id} open={sp.get('open') ? { key: sp.get('open')! } : null}
          initialSort={{ key: 'at', dir: 'desc' }} search={(r) => `Q-${r.ref_no} ${r.purpose} ${r.country} ${qRef(r.quota_id)}`}
          filters={[{ key: 'st', label: 'Status', options: Object.keys(UR_STATUS).map((value) => ({ value, label: ctx.urLabel(value as UseReq["status"]) })), match: (r, v) => r.status === v }]}
          columns={[
            { key: 'ref', label: 'Request', main: true, render: (r) => <><b>Q-{r.ref_no}</b> · {r.slots} × {r.country}<br /><small className="muted">{qRef(r.quota_id)} · {ctx.cName(r.company_id)}</small></>, sort: (r) => r.ref_no },
            { key: 'st', label: 'Status', render: (r) => <><Chip tone={UR_STATUS[r.status].tone}>{ctx.urLabel(r.status)}</Chip>{ctx.isCeo && r.gm_skipped && r.status === 'approved' && <> <Chip tone="gray">GM step skipped</Chip></>}</>, sort: (r) => r.status },
            { key: 'purpose', label: 'Purpose', hide: 'tablet', render: (r) => r.purpose },
            { key: 'by', label: 'Raised by', hide: 'phone', render: (r) => ctx.who(r.requested_by_name, r.requested_by_role) },
            { key: 'at', label: 'Raised', hide: 'tablet', render: (r) => atMyt(r.requested_at), sort: (r) => r.requested_at },
          ]}
          expand={(r) => <>
            <Details items={[['Purpose', r.purpose], ['Estimated cost', r.est_cost_rm ? rmFmt(r.est_cost_rm) : '—'], ['Batch', d.batches.find((b) => b.id === r.batch_id)?.title || '—'],
              ['Recruits', d.recruits.filter((x) => x.use_request_id === r.id).map((x) => x.full_name).join(', ') || '—'],
              ['Slots still reserved', String(resvLeft(r))], ['Used (VDR applied)', String(d.ledger.filter((e) => e.use_request_id === r.id).reduce((a, e) => a + e.d_used, 0))],
              ['Documents', <span key="f">{r.files.map((id) => <FileLink key={id} f={d.files.find((f) => f.id === id)} />)}</span>]]} />
            <h4>Timeline</h4><Timeline items={r.timeline || []} who={ctx.who} />
          </>}
          actions={(r) => <Actions>
            {canDecide(r, ctx.rank, me) && <>
              <IconAction kind="approve" label="Approve" onClick={() => setAsk({ r, action: 'approve' })} />
              <IconAction kind="recall" label="Return for changes" onClick={() => setAsk({ r, action: 'return' })} />
              <IconAction kind="reject" label="Reject (slots released)" onClick={() => setAsk({ r, action: 'reject' })} />
            </>}
            {r.requested_by === me && r.status === 'returned' && <IconAction kind="send" label="Resubmit" onClick={() => setAsk({ r, action: 'resubmit' })} />}
            {(r.requested_by === me || ctx.rank >= 4) && ['pending', 'gm_approved', 'returned'].includes(r.status) && <IconAction kind="delete" label="Cancel the request" onClick={() => setAsk({ r, action: 'cancel' })} />}
            {r.status === 'approved' && ctx.isHraUp && resvLeft(r) > 0 && <IconAction kind="reset" label="Release unused slots back to the balance" onClick={() => setAsk({ r, action: 'release' })} />}
          </Actions>}
          empty={<Empty title="No requests yet">Raise a Quota Use Request before applying any calling visa.</Empty>} />
      </Card>
      {form && <RequestForm v={form} onClose={() => setForm(null)} />}
      {ask && ask.action === 'release' && <QForm title={`Release unused slots: Q-${ask.r.ref_no}`} initial={{ qty: resvLeft(ask.r) }} onClose={() => setAsk(null)} saveLabel="Release"
        note={`${resvLeft(ask.r)} slot(s) are still reserved on this request. Released slots go back to the available balance.`}
        fields={[{ key: 'qty', label: 'Slots to release', type: 'number', required: true }, { key: 'note', label: 'Reason', type: 'textarea', required: true, full: true }]}
        onSave={(v) => { const q = Number(v.qty) || 0; if (q < 1 || q > resvLeft(ask.r)) throw new Error(`Between 1 and ${resvLeft(ask.r)}.`); return qcall('qr_release_unused', { p_id: ask.r.id, p_qty: q, p_note: v.note }) }} />}
      {ask && ask.action !== 'release' && <NoteAsk title={`${ACT[ask.action].t}: Q-${ask.r.ref_no}`} label={ACT[ask.action].label} required={ACT[ask.action].req} danger={ACT[ask.action].danger}
        confirm={ask.action === 'approve' ? 'Approve' : ACT[ask.action].t.split(' —')[0]} onClose={() => setAsk(null)}
        onOk={async (note) => { const out = await qcall('qr_decide_use', { p_id: ask.r.id, p_action: ask.action, p_note: note || null }); if (ask.action === 'approve' && out === 'approved') celebrate() }} />}
    </div>
  )
}

function RequestForm({ v, onClose }: { v: V; onClose: () => void }) {
  const ctx = useQCtx()
  const d = useQuota()
  const [picked, setPicked] = useState<string[]>([])
  const [files, setFiles] = useState<string[]>([])
  const open = d.quotas.filter((q) => q.status === 'active' && ctx.companies.some((c) => c.id === q.company_id))
  const avail = (qid: unknown, c: unknown) => d.tally.find((t) => t.quota_id === qid && t.country === c)?.available ?? 0
  return (
    <QForm wide title="New Quota Use Request" initial={v} onClose={onClose} saveLabel="Send for approval"
      note="It is sent for approval. The slots are reserved now and released if it is rejected or cancelled."
      fields={[
        { key: 'quota_id', label: 'Approval letter', type: 'select', required: true, options: open.map((q) => ({ value: q.id, label: `${q.ref_no} — ${ctx.cName(q.company_id)}` })) },
        { key: 'country', label: 'Country', type: 'select', required: true, options: (v2Countries(open, v)) },
        { key: 'slots', label: 'Slots', type: 'number', required: true },
        { key: 'batch_id', label: 'Batch', type: 'select', options: [{ value: '', label: '—' }, ...d.batches.filter((b) => b.status === 'open').map((b) => ({ value: b.id, label: `${b.title} (${b.country})` }))] },
        { key: 'est_cost_rm', label: 'Estimated cost (all slots)', type: 'money' },
        { key: 'purpose', label: 'Purpose / justification', type: 'textarea', required: true, full: true, placeholder: 'e.g. 5 cooks for the new Bangsar outlet opening in March' },
      ]}
      onSave={async (x) => {
        const q = open.find((o) => o.id === x.quota_id)
        if (!q) throw new Error('Choose the approval letter.')
        const slots = Number(x.slots) || 0
        if (slots < 1) throw new Error('At least 1 slot.')
        if (slots > avail(x.quota_id, x.country)) throw new Error(`Only ${avail(x.quota_id, x.country)} slot(s) available for ${s(x.country)} on ${q.ref_no}.`)
        if (picked.length > slots) throw new Error('More recruits picked than slots.')
        await qcall('qr_request_use', { p: { quota_id: x.quota_id, country: x.country, slots, batch_id: x.batch_id || null, recruit_ids: picked, purpose: x.purpose, est_cost_rm: x.est_cost_rm || null, files } })
      }}>
      {(val, set) => {
        const rs = d.recruits.filter((r) => r.status === 'active' && !r.use_request_id && r.country === val.country && (!val.batch_id || r.batch_id === val.batch_id) && d.quotas.find((q) => q.id === val.quota_id)?.company_id === r.company_id)
        return <>
          {val.quota_id && val.country ? <p className="muted">Available now: <b>{avail(val.quota_id, val.country)}</b></p> : null}
          {rs.length > 0 && <div className="field full"><label>Recruits covered (optional — you can link them later)</label>
            <div className="qr-picks">{rs.map((r) => <label key={r.id} className="check"><input type="checkbox" checked={picked.includes(r.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, r.id] : picked.filter((x) => x !== r.id))} /> {r.full_name} {r.passport_no && <small className="muted">{r.passport_no}</small>}</label>)}</div></div>}
          <FileField company={d.quotas.find((q) => q.id === val.quota_id)?.company_id || ''} kind="request" label="Supporting document (optional)" value={files[files.length - 1]} onChange={(id) => { setFiles([...files, id]); set({}) }} />
        </>
      }}
    </QForm>
  )
}
const v2Countries = (open: { breakdown: Record<string, number> }[], _v: V) => [...new Set(open.flatMap((q) => Object.keys(q.breakdown || {})))]
