/* Exits against the quota: the CMO register (kept for good, fingerprinted) and runaway cases (left without a CMO). */
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Btn, Card, Chip, Empty, Tabs } from '../../components/ui'
import { DataTable, Details } from '../../components/dataTable'
import { Actions, IconAction } from '../../components/iconAction'
import { toast } from '../../components/toast'
import { useWorkers } from '../../lib/hooks'
import type { Worker } from '../../lib/types'
import { daysUntil, fmtDate, todayISO } from '../../lib/util'
import { inCompany, addDaysISO, atMyt, EXIT_KIND, EXIT_STATUS, fileBytes, qcall, rmFmt, RUN_OUTCOME, useQuota, type Exit, type Runaway } from '../../lib/quota'
import { FileField, FileLink, NoteAsk, QForm, s, useQCtx, type V } from './shared'

const docNo = (w: Worker, t: string) => [...(w.documents || [])].reverse().find((d) => d.type === t)?.number || ''
const workerFields = (w: Worker) => ({ worker_id: w.id, worker_no: w.workerNo, worker_name: w.fullName, passport_no: docNo(w, 'Passport'), permit_no: docNo(w, 'Work Permit / PLKS (VP(TE))'), country: w.nationality, quota_id: w.quotaId || '' })

export function ExitsTab({ company }: { company: string }) {
  const [sp, setSp] = useSearchParams()
  const [sub, setSub] = useState<'cmo' | 'run'>(sp.get('run') || sp.get('newrun') ? 'run' : 'cmo')
  useEffect(() => { if (sp.get('run') || sp.get('newrun')) setSub('run') }, [sp])
  return <div className="qr-grid">
    <Tabs tabs={[{ id: 'cmo', label: 'CMO register' }, { id: 'run', label: 'Runaway (no CMO)' }]} value={sub} onChange={(t) => { setSub(t); setSp({ tab: 'exits' }, { replace: true }) }} />
    {sub === 'cmo' ? <CmoRegister company={company} /> : <Runaways company={company} />}
  </div>
}

function CmoRegister({ company }: { company: string }) {
  const ctx = useQCtx()
  const d = useQuota()
  const [form, setForm] = useState<V | null>(null)
  const [voidX, setVoidX] = useState<Exit | null>(null)
  const rows = d.exits.filter((x) => inCompany(company, x.company_id))
  const verify = async (x: Exit) => {
    const f = d.files.find((y) => y.id === x.file_id); if (!f) return toast('No copy stored.', 'err')
    try { const r = await fileBytes(f); toast(r.ok ? `Copy intact — SHA-256 matches (${f.sha256.slice(0, 12)}…)` : 'The stored copy does NOT match its fingerprint — tell the CEO.', r.ok ? 'ok' : 'err') } catch (e) { toast((e as Error).message, 'err') }
  }
  return (
    <Card title="Check Out Memos" actions={<Btn kind="primary" icon="plus" small onClick={() => setForm({ kind: 'cmo', company_id: company || ctx.companies[0]?.id, cmo_date: todayISO() })}>Record CMO / exit</Btn>}>
      <div className="note-box">Every worker leaving Malaysia is recorded here with the Immigration Check Out Memo (MyPASS eCOM). The scan is kept permanently with a SHA-256 fingerprint: it is the evidence for a replacement (gantian) claim when the government opens one.</div>
      <DataTable label="CMO register" rows={rows} rowKey={(x) => x.id} initialSort={{ key: 'd', dir: 'desc' }} search={(x) => `${x.worker_name} ${x.worker_no} ${x.cmo_ref} ${x.passport_no}`}
        filters={[{ key: 's', label: 'Status', options: Object.entries(EXIT_STATUS).map(([value, v]) => ({ value, label: v.label })), match: (x, v) => x.status === v }, { key: 'k', label: 'Kind', options: Object.entries(EXIT_KIND).map(([value, label]) => ({ value, label })), match: (x, v) => x.kind === v }]}
        rowClass={(x) => (x.status === 'void' ? 'strike' : '')}
        columns={[
          { key: 'w', label: 'Worker', main: true, render: (x) => <><b>{x.worker_name}</b> <small className="muted">{x.worker_no}</small><br /><small className="muted">{x.country} · {ctx.cName(x.company_id)}</small></>, sort: (x) => x.worker_name },
          { key: 'c', label: 'CMO', hide: 'phone', render: (x) => x.kind === 'cmo' ? x.cmo_ref : EXIT_KIND[x.kind] },
          { key: 'd', label: 'Date', hide: 'phone', render: (x) => fmtDate(x.cmo_date || x.departure_date || ''), sort: (x) => x.cmo_date || x.departure_date || '' },
          { key: 's', label: 'Replacement', render: (x) => <Chip tone={EXIT_STATUS[x.status].tone}>{EXIT_STATUS[x.status].label}</Chip> },
          { key: 'q', label: 'Letter', hide: 'tablet', render: (x) => d.quotas.find((q) => q.id === x.quota_id)?.ref_no || <Chip tone="amber">Not linked</Chip> },
        ]}
        expand={(x) => <Details items={[['Passport', x.passport_no || '—'], ['PLKS', x.permit_no || '—'], ['Reason', x.exit_reason || '—'], ['Departure', [fmtDate(x.departure_date || ''), x.flight_no].filter(Boolean).join(' · ') || '—'],
          ['Copy', <span key="f"><FileLink f={d.files.find((f) => f.id === x.file_id)} /> {x.file_id && <small className="muted">SHA-256 {d.files.find((f) => f.id === x.file_id)?.sha256.slice(0, 12)}…</small>}</span>],
          ['Claim', d.claims.find((c) => c.id === x.claim_id) ? `C-${d.claims.find((c) => c.id === x.claim_id)!.ref_no}` : '—'], ['Recorded', `${ctx.who(x.created_by_name, null)} · ${atMyt(x.created_at)}`], ['Void reason', x.void_reason || '—']]} />}
        actions={(x) => <Actions>
          {x.file_id && <IconAction kind="refresh" label="Verify the stored copy (checksum)" onClick={() => verify(x)} />}
          {ctx.isGmUp && x.created_by !== ctx.profile?.id && ['eligible', 'not_eligible'].includes(x.status) && <IconAction kind="reject" label="Void (wrong entry — the record and copy stay)" onClick={() => setVoidX(x)} />}
        </Actions>}
        empty={<Empty title="No exits recorded" />} />
      {form && <ExitForm v={form} onClose={() => setForm(null)} />}
      {voidX && <NoteAsk title={`Void ${voidX.cmo_ref || EXIT_KIND[voidX.kind]} — ${voidX.worker_name}`} label="Reason" danger confirm="Void" onClose={() => setVoidX(null)} onOk={(n) => qcall('qr_void_exit', { p_id: voidX.id, p_reason: n })} />}
    </Card>
  )
}

export function ExitForm({ v, onClose }: { v: V; onClose: () => void }) {
  const ctx = useQCtx()
  const d = useQuota()
  const workers = useWorkers()
  const taken = new Set(d.exits.filter((x) => x.status !== 'void').map((x) => x.worker_id))
  const pick = workers.filter((w) => !taken.has(w.id)).sort((a, b) => a.fullName.localeCompare(b.fullName))
  return (
    <QForm wide title="Record a CMO / exit" initial={v} onClose={onClose}
      fields={[
        { key: 'company_id', label: 'Company', type: 'select', required: true, options: ctx.companies.map((c) => ({ value: c.id, label: c.name })) },
        { key: 'worker_id', label: 'Worker', type: 'select', options: [{ value: '', label: '— not in FW Manager (type below) —' }, ...pick.map((w) => ({ value: w.id, label: `${w.fullName} (${w.workerNo}) · ${w.status}` }))] },
        { key: 'worker_name', label: 'Worker name', required: true }, { key: 'worker_no', label: 'Worker no.' },
        { key: 'passport_no', label: 'Passport no.', type: 'upper' }, { key: 'permit_no', label: 'PLKS no.' },
        { key: 'country', label: 'Country', required: true },
        { key: 'quota_id', label: 'Approval letter', type: 'select', options: [{ value: '', label: '— unknown —' }, ...d.quotas.filter((q) => q.status !== 'rejected').map((q) => ({ value: q.id, label: `${q.ref_no} (${ctx.cName(q.company_id)})` }))], hint: 'Link the letter so the exit is counted in its tally.' },
        { key: 'kind', label: 'Exit type', type: 'select', required: true, options: Object.entries(EXIT_KIND).map(([value, label]) => ({ value, label })) },
        { key: 'cmo_ref', label: 'CMO reference no.', show: (x) => x.kind === 'cmo' }, { key: 'cmo_date', label: 'CMO date', type: 'date', show: (x) => x.kind === 'cmo' },
        { key: 'departure_date', label: 'Departure date', type: 'date' }, { key: 'flight_no', label: 'Flight no.', type: 'upper' },
        { key: 'eligible', label: 'Eligible for replacement (Immigration confirmed)', type: 'checkbox', show: (x) => x.kind === 'death' },
        { key: 'exit_reason', label: 'Reason', type: 'textarea', full: true, placeholder: 'Contract ended / resigned / terminated / FOMEMA unfit / repatriated' },
      ]}
      onSave={(x) => {
        const p: V = {}; for (const [k, y] of Object.entries(x)) if (y !== '' && y != null) p[k] = y
        if (p.kind === 'cmo' && !p.file_id) throw new Error('Attach the scanned CMO.')
        if (p.kind === 'cmo' && !p.cmo_ref) throw new Error('Enter the CMO reference no.')
        return qcall('qr_record_exit', { p })
      }}>
      {(x, set) => <WorkerAutofill x={x} set={set} workers={workers}><FileField company={s(x.company_id)} kind="cmo" label={x.kind === 'cmo' ? 'Scanned CMO' : 'Supporting document'} required={x.kind === 'cmo'} value={x.file_id as string} onChange={(id) => set({ file_id: id })} /></WorkerAutofill>}
    </QForm>
  )
}

/** fill the worker fields when one is picked */
function WorkerAutofill({ x, set, workers, children }: { x: V; set: (p: V) => void; workers: Worker[]; children: React.ReactNode }) {
  const wid = s(x.worker_id)
  useEffect(() => {
    const w = workers.find((y) => y.id === wid)
    if (w && x._for !== wid) set({ ...workerFields(w), departure_date: x.departure_date || w.exitDate || '', _for: wid })
  }, [wid]) // eslint-disable-line react-hooks/exhaustive-deps
  return <>{children}</>
}

const runDue = (r: Runaway, days: number) => addDaysISO(r.last_seen, days)

function Runaways({ company }: { company: string }) {
  const ctx = useQCtx()
  const d = useQuota()
  const workers = useWorkers()
  const [sp] = useSearchParams()
  const [form, setForm] = useState<V | null>(null)
  const [edit, setEdit] = useState<Runaway | null>(null)
  const [fu, setFu] = useState<Runaway | null>(null)
  const rows = d.runaways.filter((r) => inCompany(company, r.company_id))
  const today = todayISO()
  const absNoCase = useMemo(() => workers.filter((w) => w.status === 'Absconded' && !d.runaways.some((r) => r.worker_id === w.id)), [workers, d.runaways])
  useEffect(() => {
    const id = sp.get('newrun'); const w = id && workers.find((y) => y.id === id)
    if (w) setForm({ ...workerFields(w), company_id: company || ctx.companies[0]?.id, last_seen: w.exitDate || today })
  }, [sp.get('newrun'), workers.length]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Card title="Runaway cases (left without a CMO)" actions={<Btn kind="primary" icon="plus" small onClick={() => setForm({ company_id: company || ctx.companies[0]?.id, last_seen: today })}>Open a case</Btn>}>
      <div className="note-box bad">A worker who leaves without a Check Out Memo is a runaway. In the worker record he stays <b>Absconded (runaway)</b>. Report to the police and to Immigration (FWCMS eRUNAWAY) at once — the case turns red after {d.rules.runaway_report_days} days without the Immigration report. The permit is cancelled, the bond may be forfeited, and the slot does not come back.</div>
      {absNoCase.length > 0 && <div className="note-box"><b>{absNoCase.length} Absconded worker(s) with no case:</b> {absNoCase.map((w) => <button key={w.id} className="linkish" onClick={() => setForm({ ...workerFields(w), company_id: company || ctx.companies[0]?.id, last_seen: w.exitDate || today })}>{w.fullName}</button>)}</div>}
      <DataTable label="Runaway cases" rows={rows} rowKey={(r) => r.id} open={sp.get('run') ? { key: sp.get('run')! } : null} initialSort={{ key: 'seen', dir: 'desc' }}
        rowClass={(r) => (r.outcome === 'open' && !r.imm_ref && runDue(r, d.rules.runaway_report_days) < today ? 'row-bad' : '')}
        columns={[
          { key: 'w', label: 'Worker', main: true, render: (r) => <><b>{r.worker_name}</b> <small className="muted">{r.worker_no}</small><br /><small className="muted">{r.country} · {ctx.cName(r.company_id)}</small></>, sort: (r) => r.worker_name },
          { key: 'seen', label: 'Last seen', render: (r) => fmtDate(r.last_seen), sort: (r) => r.last_seen },
          { key: 'rep', label: 'Reports', render: (r) => { const due = runDue(r, d.rules.runaway_report_days); return <>
            <Chip tone={r.police_report_no ? 'green' : 'red'}>Police {r.police_report_no ? '✓' : '✗'}</Chip>{' '}
            <Chip tone={r.imm_ref ? 'green' : due < today ? 'red' : 'amber'}>{r.imm_ref ? 'Immigration ✓' : due < today ? `Immigration OVERDUE ${-(daysUntil(due) ?? 0)}d` : `Immigration due ${fmtDate(due)}`}</Chip></> } },
          { key: 'o', label: 'Outcome', hide: 'phone', render: (r) => <Chip tone={RUN_OUTCOME[r.outcome].tone}>{RUN_OUTCOME[r.outcome].label}</Chip> },
          { key: 'b', label: 'Bond', hide: 'tablet', render: (r) => r.bond_rm ? `${rmFmt(r.bond_rm)} · ${r.bond_status.replace(/_/g, ' ')}` : '—' },
        ]}
        expand={(r) => <>
          <Details items={[['Reported by', `${ctx.who(r.reported_by_name, null)} · ${atMyt(r.reported_at)}`], ['Passport / PLKS', [r.passport_no, r.permit_no].filter(Boolean).join(' · ') || '—'],
            ['Police report', r.police_report_no ? <span key="p">{r.police_report_no} · {fmtDate(r.police_report_date || '')} <FileLink f={d.files.find((f) => f.id === r.police_file)} label="copy" /></span> : '—'],
            ['Immigration report', r.imm_ref ? <span key="i">{r.imm_ref} · {fmtDate(r.imm_date || '')} <FileLink f={d.files.find((f) => f.id === r.imm_file)} label="copy" /></span> : '—'],
            ['Permit', r.permit_cancel], ['Bond', `${rmFmt(r.bond_rm)} · ${r.bond_status.replace(/_/g, ' ')}${r.sita_rm ? ` · sita ${rmFmt(r.sita_rm)}` : ''}`], ['Levy', r.levy_note || '—'],
            ['Money owed', [r.wages_owed_rm ? `wages ${rmFmt(r.wages_owed_rm)}` : '', r.money_owed_note].filter(Boolean).join(' · ') || '—'], ['Outcome', `${RUN_OUTCOME[r.outcome].label}${r.outcome_date ? ` · ${fmtDate(r.outcome_date)}` : ''}${r.outcome_note ? ` · ${r.outcome_note}` : ''}`],
            ['Letter', d.quotas.find((q) => q.id === r.quota_id)?.ref_no || '—']]} />
          {r.followups.length > 0 && <><h4>Follow-ups</h4><ol className="qr-tl">{[...r.followups].reverse().map((f, i) => <li key={i}><small className="muted">{atMyt(f.at)} · {ctx.who(f.by, null)}</small><div className="qr-tl-n">{f.note}</div></li>)}</ol></>}
        </>}
        actions={(r) => <Actions>
          <IconAction kind="edit" label="Update the case (reports, permit, bond, outcome)" onClick={() => setEdit(r)} />
          <IconAction kind="add" label="Add a follow-up" onClick={() => setFu(r)} />
        </Actions>}
        empty={<Empty title="No runaway cases" />} />
      {form && <RunawayNew v={form} onClose={() => setForm(null)} />}
      {edit && <RunawayEdit r={edit} onClose={() => setEdit(null)} />}
      {fu && <NoteAsk title={`Follow-up — ${fu.worker_name}`} label="What happened" confirm="Add" onClose={() => setFu(null)} onOk={(n) => qcall('qr_save_runaway', { p: { id: fu.id, followup: n } })} />}
    </Card>
  )
}

function RunawayNew({ v, onClose }: { v: V; onClose: () => void }) {
  const ctx = useQCtx()
  const d = useQuota()
  const workers = useWorkers()
  return (
    <QForm title="Open a runaway case" initial={v} onClose={onClose} saveLabel="Open case"
      note="Set the worker's status to Absconded in his record as well (exit checklist). The GM, CEO and HR Admin are told now."
      fields={[
        { key: 'company_id', label: 'Company', type: 'select', required: true, options: ctx.companies.map((c) => ({ value: c.id, label: c.name })) },
        { key: 'worker_id', label: 'Worker', type: 'select', options: [{ value: '', label: '—' }, ...workers.filter((w) => !d.runaways.some((r) => r.worker_id === w.id && r.outcome === 'open')).map((w) => ({ value: w.id, label: `${w.fullName} (${w.workerNo})` }))] },
        { key: 'worker_name', label: 'Worker name', required: true }, { key: 'worker_no', label: 'Worker no.' }, { key: 'passport_no', label: 'Passport no.', type: 'upper' }, { key: 'permit_no', label: 'PLKS no.' },
        { key: 'country', label: 'Country', required: true },
        { key: 'quota_id', label: 'Approval letter', type: 'select', options: [{ value: '', label: '— unknown —' }, ...d.quotas.filter((q) => q.status !== 'rejected').map((q) => ({ value: q.id, label: q.ref_no }))] },
        { key: 'last_seen', label: 'Last seen', type: 'date', required: true }, { key: 'reported_by_name', label: 'Reported by (outlet manager / supervisor)' },
        { key: 'bond_rm', label: 'Security bond / guarantee', type: 'money' },
      ]}
      onSave={(x) => { const p: V = {}; for (const [k, y] of Object.entries(x)) if (y !== '' && y != null && !k.startsWith('_')) p[k] = y; return qcall('qr_save_runaway', { p }) }}>
      {(x, set) => <WorkerAutofill x={x} set={set} workers={workers}>{null}</WorkerAutofill>}
    </QForm>
  )
}

function RunawayEdit({ r, onClose }: { r: Runaway; onClose: () => void }) {
  const ctx = useQCtx()
  return (
    <QForm wide title={`Runaway case — ${r.worker_name}`} onClose={onClose}
      initial={{ ...r, followup: '' } as unknown as V}
      fields={[
        { key: 'police_report_no', label: 'Police report no.' }, { key: 'police_report_date', label: 'Police report date', type: 'date' },
        { key: 'imm_ref', label: 'Immigration (FWCMS eRUNAWAY) ref' }, { key: 'imm_date', label: 'Reported to Immigration on', type: 'date' },
        { key: 'permit_cancel', label: 'Work permit', type: 'select', options: [{ value: 'pending', label: 'Not yet cancelled' }, { value: 'applied', label: 'Cancellation applied' }, { value: 'cancelled', label: 'Cancelled' }] },
        { key: 'bond_rm', label: 'Bond', type: 'money' },
        { key: 'bond_status', label: 'Bond status', type: 'select', options: [{ value: 'to_be_forfeited', label: 'To be forfeited' }, { value: 'forfeited', label: 'Forfeited' }, { value: 'sita_paid', label: 'Sita (bank draft) paid' }, { value: 'released', label: 'Released' }] },
        { key: 'sita_rm', label: 'Sita amount', type: 'money' }, { key: 'levy_note', label: 'Levy (refund / balance)', full: true },
        { key: 'wages_owed_rm', label: 'Wages owed to him', type: 'money', hint: 'Unpaid wages stay his; keep them for when he is found or as Immigration directs.' }, { key: 'money_owed_note', label: 'Money he owes (loans / advances)', full: true },
        ...(ctx.isHraUp ? [{ key: 'outcome', label: 'Outcome', type: 'select' as const, options: Object.entries(RUN_OUTCOME).map(([value, x]) => ({ value, label: x.label })) },
          { key: 'outcome_date', label: 'Outcome date', type: 'date' as const, show: (x: V) => x.outcome !== 'open' }, { key: 'outcome_note', label: 'Outcome note', full: true, show: (x: V) => x.outcome !== 'open' }] : []),
        { key: 'followup', label: 'Follow-up note (optional)', type: 'textarea', full: true },
      ]}
      onSave={(x) => {
        const keep = ['police_report_no', 'police_report_date', 'police_file', 'imm_ref', 'imm_date', 'imm_file', 'permit_cancel', 'bond_rm', 'bond_status', 'sita_rm', 'levy_note', 'wages_owed_rm', 'money_owed_note', 'followup', 'outcome_date', 'outcome_note']
        const p: V = { id: r.id }
        for (const k of keep) if (x[k] !== '' && x[k] != null && x[k] !== (r as unknown as V)[k]) p[k] = x[k]
        if (x.outcome !== r.outcome) p.outcome = x.outcome
        return qcall('qr_save_runaway', { p })
      }}>
      {(x, set) => <div className="row-gap wrap">
        <FileField company={r.company_id} kind="police" label="Police report copy" value={x.police_file as string} onChange={(id) => set({ police_file: id })} />
        <FileField company={r.company_id} kind="immigration" label="Immigration report copy" value={x.imm_file as string} onChange={(id) => set({ imm_file: id })} />
      </div>}
    </QForm>
  )
}
