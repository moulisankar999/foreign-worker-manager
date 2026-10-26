/* Approval letters + the ledger (bank-statement style: every movement a line, a running balance per letter × country). */
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Btn, Card, Chip, Empty, KV, SelectFilter, Toolbar } from '../../components/ui'
import { DataTable, Details } from '../../components/dataTable'
import { Actions, IconAction } from '../../components/iconAction'
import { Preview } from '../../reports/Preview'
import type { Block } from '../../reports/types'
import { addMonths, fmtDate, todayISO } from '../../lib/util'
import { inCompany, atMyt, COUNTRIES, ENTRY_LABEL, qcall, useQuota, type Entry, type Quota } from '../../lib/quota'
import { QuotaAppChecklist } from './Extras'
import { CompanyPanel } from '../../components/companyPanel'
import { refreshConfig } from '../../lib/config'
import { companyOpts, FileField, FileLink, NoteAsk, QForm, s, useQCtx, useSheetMeta, type V } from './shared'

const ADD_CO = '__add_company__'
/** runs `run` once each time `when` turns true (opens the add-company panel when "+ Add company…" is picked) */
function OnTrue({ when, run }: { when: boolean; run: () => void }) { useEffect(() => { if (when) run() }, [when]); return null } // eslint-disable-line react-hooks/exhaustive-deps

const KIND_LABEL: Record<string, string> = { new: 'New quota', replacement: 'Replacement (COM / gantian)', transfer: 'Transfer', additional: 'Additional (government window)' }
const ST_TONE = { pending: 'amber', active: 'green', rejected: 'red', closed: 'gray' } as const
const MANUAL = ['approved', 'expire', 'adjust_up', 'adjust_down', 'return', 'use_existing', 'transfer_out', 'transfer_in']

/** ledger lines with the running balance (available) per letter × country, oldest first */
export function withBalance(entries: Entry[]) {
  const bal = new Map<string, number>()
  return [...entries].sort((a, b) => a.id - b.id).map((e) => {
    const k = `${e.quota_id}|${e.country}`
    const b = (bal.get(k) || 0) + e.d_avail
    bal.set(k, b)
    return { ...e, balance: b }
  })
}

export function LettersTab({ company }: { company: string }) {
  const ctx = useQCtx()
  const d = useQuota()
  const [sp, setSp] = useSearchParams()
  const [form, setForm] = useState<V | null>(null)
  const [move, setMove] = useState<Quota | null>(null)
  const [decide, setDecide] = useState<{ q: Quota; ok: boolean } | null>(null)
  const [rev, setRev] = useState<Entry | null>(null)
  const [print, setPrint] = useState(false)
  const qSel = sp.get('q') || ''
  const quotas = d.quotas.filter((q) => inCompany(company, q.company_id))
  const tallyOf = (q: Quota) => d.tally.filter((t) => t.quota_id === q.id)
  const lines = useMemo(() => withBalance(d.ledger.filter((e) => (inCompany(company, e.company_id)) && (!qSel || e.quota_id === qSel))).reverse(), [d.ledger, company, qSel])
  const qRef = (id: string) => d.quotas.find((q) => q.id === id)?.ref_no || ''
  const selQ = d.quotas.find((q) => q.id === qSel)
  const meta = useSheetMeta(selQ?.company_id || company, 'Quota ledger statement', selQ ? `Letter ${selQ.ref_no}` : 'All letters', true)

  const blocks: Block[] = [
    { kind: 'kpis', items: (selQ ? tallyOf(selQ) : d.tally.filter((t) => inCompany(company, t.company_id))).slice(0, 6).map((t) => ({ label: `${t.ref_no} ${t.country}`, value: `${t.available} / ${t.approved}`, sub: `used ${t.used} · reserved ${t.reserved}` })) },
    { kind: 'table', title: 'Movements (oldest first)', cols: [{ key: 'id', label: '#', fmt: 'int', w: 5 }, { key: 'at', label: 'Date (MYT)', w: 13 }, { key: 'ref', label: 'Letter', w: 12 }, { key: 'country', label: 'Country', w: 9 },
      { key: 'kind', label: 'Movement', w: 18 }, { key: 'qty', label: 'Qty', fmt: 'int', w: 5 }, { key: 'd', label: 'Δ avail.', fmt: 'int', w: 7 }, { key: 'bal', label: 'Balance', fmt: 'int', w: 7 }, { key: 'note', label: 'Reference / note', w: 24, wrap: true }],
      rows: [...lines].reverse().map((e) => ({ id: e.id, at: atMyt(e.at).replace(' MYT', ''), ref: qRef(e.quota_id), country: e.country, kind: ENTRY_LABEL[e.kind] || e.kind, qty: e.qty, d: e.d_avail, bal: e.balance, note: [e.ref, e.note].filter(Boolean).join(' — ') })) },
    { kind: 'signatures' },
  ]

  return (
    <div className="qr-grid">
      <Card title="Approval letters" actions={<Btn kind="primary" icon="plus" small onClick={() => setForm({ company_id: company || ctx.companies[0]?.id, kind: 'new', approval_date: todayISO(), expiry_date: addMonths(todayISO(), 12), breakdown: {} })}>Record a letter</Btn>}>
        <DataTable label="Approval letters" rows={quotas} rowKey={(q) => q.id} pageSize={8}
          initialSort={{ key: 'appr', dir: 'desc' }}
          columns={[
            { key: 'ref', label: 'Letter', main: true, render: (q) => <><b>{q.ref_no}</b> <Chip tone={ST_TONE[q.status]}>{q.status === 'pending' ? (ctx.isCeo ? 'Waiting for GM / CEO' : 'Waiting to be opened') : q.status}</Chip><br /><small className="muted">{ctx.cName(q.company_id)} · {KIND_LABEL[q.kind]}</small></>, sort: (q) => q.ref_no },
            { key: 'bd', label: 'Approved', render: (q) => Object.entries(q.breakdown || {}).map(([c, v]) => `${c} ${v}`).join(', ') },
            { key: 'bal', label: 'Available', align: 'right', render: (q) => tallyOf(q).reduce((a, t) => a + t.available, 0), sort: (q) => tallyOf(q).reduce((a, t) => a + t.available, 0) },
            { key: 'appr', label: 'Approved on', hide: 'tablet', render: (q) => fmtDate(q.approval_date), sort: (q) => q.approval_date },
            { key: 'exp', label: 'Expires', hide: 'phone', render: (q) => fmtDate(q.expiry_date || ''), sort: (q) => q.expiry_date },
          ]}
          expand={(q) => <>
            {q.status !== 'rejected' && <QuotaAppChecklist q={q} />}
            <Details items={[['Sector', [q.sector, q.subsector].filter(Boolean).join(' / ') || '—'], ['Job title', q.job_title || '—'], ['Section 60K', [q.section60k_ref, q.section60k_expiry && `exp ${fmtDate(q.section60k_expiry)}`].filter(Boolean).join(' · ') || '—'],
              ['Conditions', q.conditions || '—'], ['Levy', q.levy_note || '—'], ['Letter copy', <FileLink key="f" f={d.files.find((f) => f.id === q.letter_file)} />],
              ['Recorded by', `${ctx.who(q.created_by_name, null)} · ${atMyt(q.created_at)}`], ['Opened by', q.opened_at ? `${ctx.isGmUp ? q.opened_by_name : 'Approver'} · ${atMyt(q.opened_at)}` : '—'],
              ['Extensions', q.extensions?.length ? q.extensions.map((x) => `${fmtDate(x.from)} → ${fmtDate(x.to)} (${x.ref})`).join('; ') : '—'], ['Notes', q.notes || '—']]} />
            {tallyOf(q).length > 0 && <KV items={tallyOf(q).map((t) => [t.country, `approved ${t.approved} · available ${t.available} · reserved ${t.reserved} · used ${t.used} · lapsed ${t.lapsed}`])} />}
          </>}
          actions={(q) => <Actions>
            <IconAction kind="view" label="Show this letter's ledger" onClick={() => setSp({ tab: 'letters', q: q.id }, { replace: true })} />
            {q.status === 'pending' && ctx.isGmUp && q.created_by !== ctx.profile?.id && <>
              <IconAction kind="approve" label="Checked against the original — open the letter (posts the approved slots)" onClick={() => setDecide({ q, ok: true })} />
              <IconAction kind="reject" label="Do not open this letter" onClick={() => setDecide({ q, ok: false })} />
            </>}
            {q.status !== 'rejected' && <IconAction kind="edit" label="Edit details" onClick={() => setForm({ ...q, breakdown: q.breakdown })} />}
            {q.status === 'active' && ctx.isGmUp && <IconAction kind="more" label="Movement: expire, adjust, transfer, extend, existing workers" onClick={() => setMove(q)} />}
          </Actions>}
          empty={<Empty title="No letters yet">Record each quota approval letter (KDN / FWCMS) with its scanned copy. It is opened after a check against the original.</Empty>} />
      </Card>

      <Card title={<>Ledger {selQ && <Chip tone="blue">{selQ.ref_no}</Chip>}</>} actions={<Toolbar>
        <SelectFilter label="Letter" value={qSel} onChange={(v) => setSp(v ? { tab: 'letters', q: v } : { tab: 'letters' }, { replace: true })} options={[{ value: '', label: 'All letters' }, ...quotas.map((q) => ({ value: q.id, label: q.ref_no }))]} />
        <IconAction kind="print" label="Print the statement (A4, with sign-off)" onClick={() => setPrint(true)} /></Toolbar>}>
        <DataTable label="Quota ledger" rows={lines} rowKey={(e) => String(e.id)} dense pageSize={10} search={(e) => `${e.ref} ${e.note} ${e.by_name} ${e.country} ${qRef(e.quota_id)}`}
          filters={[{ key: 'kind', label: 'Movement', options: Object.entries(ENTRY_LABEL).map(([value, label]) => ({ value, label })), match: (e, v) => e.kind === v },
            { key: 'country', label: 'Country', options: [...new Set(lines.map((e) => e.country))], match: (e, v) => e.country === v }]}
          columns={[
            { key: 'id', label: '#', hide: 'phone', render: (e) => e.id, sort: (e) => e.id, width: '4rem' },
            { key: 'at', label: 'When', hide: 'phone', render: (e) => atMyt(e.at), sort: (e) => e.at },
            { key: 'kind', label: 'Movement', main: true, render: (e) => <>{ENTRY_LABEL[e.kind] || e.kind} · <b>{e.qty}</b> {e.country}<br /><small className="muted">#{e.id} · {qRef(e.quota_id)} {e.ref && `· ${e.ref}`}</small></> },
            { key: 'd', label: 'Δ avail.', align: 'right', render: (e) => <span className={e.d_avail < 0 ? 'neg' : e.d_avail > 0 ? 'pos' : ''}>{e.d_avail > 0 ? '+' : ''}{e.d_avail || '·'}</span> },
            { key: 'bal', label: 'Balance', align: 'right', render: (e) => <b>{e.balance}</b> },
            { key: 'by', label: 'By', hide: 'tablet', render: (e) => ctx.who(e.by_name, e.by_role) },
          ]}
          expand={(e) => <Details items={[['Note', e.note || '—'], ['Buckets', bucketText(e)], ['Reverses', e.reverses ? `#${e.reverses}` : '—'], ['When', atMyt(e.at)], ['By', ctx.who(e.by_name, e.by_role)]]} />}
          actions={(e) => <Actions>{ctx.isGmUp && MANUAL.includes(e.kind) && !d.ledger.some((x) => x.reverses === e.id) && e.by_id !== ctx.profile?.id &&
            <IconAction kind="recall" label="Reverse this entry (a mirror line is added; nothing is deleted)" onClick={() => setRev(e)} />}</Actions>}
          empty={<Empty title="No movements">Movements appear when a letter is opened.</Empty>} />
      </Card>

      {form && <LetterForm v={form} onClose={() => setForm(null)} />}
      {move && <MoveForm q={move} onClose={() => setMove(null)} />}
      {decide && <NoteAsk title={decide.ok ? `Open ${decide.q.ref_no}` : `Do not open ${decide.q.ref_no}`} required={!decide.ok} label={decide.ok ? 'Note (optional)' : 'Why not?'} danger={!decide.ok}
        confirm={decide.ok ? 'Open letter' : 'Reject'} onClose={() => setDecide(null)} onOk={(note) => qcall('qr_open_quota', { p_id: decide.q.id, p_ok: decide.ok, p_note: note || null })} />}
      {rev && <NoteAsk title={`Reverse entry #${rev.id}`} label="Reason" danger confirm="Reverse" onClose={() => setRev(null)} onOk={(note) => qcall('qr_reverse', { p_entry: rev.id, p_note: note })} />}
      {print && <Preview blocks={blocks} meta={meta} file={`quota-ledger-${todayISO()}.pdf`} onClose={() => setPrint(false)} />}
    </div>
  )
}

const bucketText = (e: Entry) => ([['available', e.d_avail], ['reserved', e.d_resv], ['used', e.d_used], ['replaceable', e.d_elig], ['in claim', e.d_claim], ['replaced', e.d_repl], ['lapsed', e.d_lapsed], ['COM exits', e.d_cmo], ['other exits', e.d_other], ['runaways', e.d_run]] as [string, number][])
  .filter(([, v]) => v).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join(' · ') || '—'

function LetterForm({ v, onClose }: { v: V; onClose: () => void }) {
  const ctx = useQCtx()
  const isNew = !v.id
  const locked = !isNew && v.status !== 'pending'
  const [bd, setBd] = useState<Record<string, number>>((v.breakdown as Record<string, number>) || {})
  const [extra, setExtra] = useState('')
  const [addCo, setAddCo] = useState(false)
  useEffect(() => { if (isNew) void refreshConfig() }, [isNew]) // a stale saved company list is refreshed when the form opens
  return (
    <QForm wide title={isNew ? 'Record a quota approval letter' : `Edit ${s(v.ref_no)}`} initial={v} onClose={onClose}
      note={isNew ? 'The numbers come from the approval letter. An approver (not you) checks it against the original and opens it — only then do the slots appear in the balance.' : locked ? 'Numbers and dates of an open letter change only through a ledger movement or an extension.' : undefined}
      fields={[
        { key: 'company_id', label: 'Company', type: 'select', options: [...companyOpts(ctx.companies), ...(ctx.canCreateCompany ? [{ value: ADD_CO, label: '+ Add company…' }] : [])], required: true, show: () => isNew },
        { key: 'ref_no', label: 'Letter reference no.', required: true, show: () => !locked },
        { key: 'kind', label: 'Type', type: 'select', options: Object.entries(KIND_LABEL).filter(([k]) => k !== 'additional').map(([value, label]) => ({ value, label })), show: () => isNew },
        { key: 'approval_date', label: 'Approval date', type: 'date', required: true, show: () => !locked },
        { key: 'expiry_date', label: 'Valid until', type: 'date', show: () => !locked, hint: 'From 15 Apr 2026 FWCMS eQuota letters are valid 12 months; older letters may say 18. Use the date on the letter.' },
        { key: 'sector', label: 'Sector', placeholder: 'Services' }, { key: 'subsector', label: 'Sub-sector', placeholder: 'Restaurant' }, { key: 'job_title', label: 'Job title' },
        { key: 'section60k_ref', label: 'Section 60K approval ref' }, { key: 'section60k_expiry', label: 'Section 60K valid until', type: 'date' },
        { key: 'levy_note', label: 'Levy (rate / due date)', full: true, placeholder: 'Levy payable within 15 days of the approval' },
        { key: 'conditions', label: 'Conditions on the letter', type: 'textarea', full: true }, { key: 'notes', label: 'Notes', type: 'textarea', full: true },
      ]}
      onSave={async (x) => {
        const p: V = { ...x, breakdown: bd }
        if (!locked && !Object.values(bd).some((n) => n > 0)) throw new Error('Enter the approved number for at least one country.')
        for (const k of ['expiry_date', 'section60k_expiry', 'letter_file']) if (p[k] === '') p[k] = null
        delete p.extensions; delete p.created_at
        if (p.company_id === ADD_CO) throw new Error('Choose the company (or finish adding the new one).')
        await qcall('qr_save_quota', { p })
      }}>
      {(val, set) => <>
        <OnTrue when={isNew && val.company_id === ADD_CO && !addCo} run={() => setAddCo(true)} />
        {isNew && ctx.canCreateCompany && <div className="field full picker-add" data-testid="letter-add-company"><small className="muted">Company not in the list?</small>
          <IconAction kind="add" text label="Add company" onClick={() => setAddCo(true)} testId="add-company-btn" /></div>}
        {addCo && <CompanyPanel onClose={() => { setAddCo(false); if (val.company_id === ADD_CO) set({ company_id: ctx.companies[0]?.id || '' }) }}
          onCreated={(id) => { set({ company_id: id }); setAddCo(false) }} />}
        {!locked && <div className="field full"><label>Approved per country *</label>
          <div className="qr-bd">{[...new Set([...COUNTRIES, ...Object.keys(bd)])].map((c) => (
            <label key={c} className="qr-bd-i"><span>{c}</span><input type="number" min={0} value={bd[c] ?? ''} onChange={(e) => setBd({ ...bd, [c]: Math.max(0, Number(e.target.value) || 0) })} /></label>))}
            <span className="qr-bd-i"><input placeholder="Other country" value={extra} onChange={(e) => setExtra(e.target.value)} /><Btn small onClick={() => { if (extra.trim()) { setBd({ ...bd, [extra.trim()]: 0 }); setExtra('') } }}>Add</Btn></span>
          </div><small className="muted">Total {Object.values(bd).reduce((a, n) => a + n, 0)}</small></div>}
        <FileField company={s(val.company_id)} kind="letter" label="Scanned approval letter" value={val.letter_file as string} onChange={(id) => set({ letter_file: id })} />
      </>}
    </QForm>
  )
}

function MoveForm({ q, onClose }: { q: Quota; onClose: () => void }) {
  const d = useQuota()
  const countries = Object.keys(q.breakdown || {})
  const others = d.quotas.filter((x) => x.company_id === q.company_id && x.id !== q.id && x.status === 'active')
  return (
    <QForm title={`Movement on ${q.ref_no}`} onClose={onClose} saveLabel="Post movement"
      note="Every movement is a ledger line with your name; a wrong one is reversed, never deleted."
      initial={{ kind: 'expire', country: countries[0], qty: 1 }}
      fields={[
        { key: 'kind', label: 'Movement', type: 'select', required: true, options: [
          { value: 'expire', label: 'Expire / lapse unused slots' }, { value: 'use_existing', label: 'Existing worker already on this letter (import)' },
          { value: 'return', label: 'Return to balance (VDR cancelled / not used)' }, { value: 'adjust_up', label: 'Adjustment + (letter amended)' },
          { value: 'adjust_down', label: 'Adjustment − (letter amended)' }, { value: 'transfer', label: 'Transfer to another letter' }, { value: 'extend', label: 'Extend validity' }] },
        { key: 'country', label: 'Country', type: 'select', options: countries, show: (v) => v.kind !== 'extend' },
        { key: 'qty', label: 'Slots', type: 'number', show: (v) => v.kind !== 'extend' },
        { key: 'to_quota', label: 'To letter', type: 'select', options: others.map((x) => ({ value: x.id, label: x.ref_no })), show: (v) => v.kind === 'transfer' },
        { key: 'new_expiry', label: 'New expiry', type: 'date', show: (v) => v.kind === 'extend' },
        { key: 'note', label: 'Reason / reference', type: 'textarea', required: true, full: true },
      ]}
      onSave={(v) => qcall('qr_move', { p_quota: q.id, p_country: v.country || countries[0], p_kind: v.kind, p_qty: Number(v.qty) || 0, p_note: v.note, p_to_quota: v.to_quota || null, p_new_expiry: v.new_expiry || null })} />
  )
}
