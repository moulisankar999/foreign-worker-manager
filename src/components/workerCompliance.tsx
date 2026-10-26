/* v1.2.2 worker → Compliance tab: permit & stay, hostel, exit / absconding checklists, cost tracker,
 * zero-cost recruitment declaration and PDPA consent. Plain language; uncertain rules say "check with JTKSM or your agent". */
import { useMemo, useState } from 'react'
import { Btn, Card, Chip, FormModal, KV, sevTone, type FieldDef } from './ui'
import { useAuth } from '../lib/auth'
import { useConfig } from '../lib/config'
import { useOutlets, useSettings, useWorkers } from '../lib/hooks'
import { updateWorker } from '../lib/db'
import { flowAlerts, trackerAlerts } from '../lib/calc'
import { computePayslip } from '../lib/pay'
import { ABSCOND_STEPS, CHECK, COST_TYPES, EXIT_STEPS, RECRUITMENT_COSTS, hostelIssues, stayYears, type CostRec, type ExitFlow } from '../lib/trackers'
import { zeroCostPdf } from '../lib/passport'
import { zeroCostLanguage } from '../lib/zeroCostText'
import { companyName, outletCompany } from '../lib/companies'
import type { Worker } from '../lib/types'
import { download, fmtDate, rm, todayISO, uid } from '../lib/util'
import { DataTable, Details } from './dataTable'
import { Actions, IconAction } from './iconAction'
import { toast } from './toast'

type V = Record<string, unknown>
const s = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim()

export function ComplianceTab({ w }: { w: Worker }) {
  const { canSeeSalary } = useAuth()
  return (
    <>
      <PermitCard w={w} />
      <div className="grid2">
        <HostelCard w={w} />
        <FlowCard w={w} />
      </div>
      {canSeeSalary && <CostsCard w={w} />}
      <div className="grid2">
        <ZeroCostCard w={w} />
        <PdpaCard w={w} />
      </div>
    </>
  )
}

function PermitCard({ w }: { w: Worker }) {
  const cfg = useConfig()
  const st = useSettings()
  const outlets = useOutlets()
  const all = useWorkers()
  const [edit, setEdit] = useState(false)
  const t = cfg.trackers
  const occ = useMemo(() => { const m = new Map<string, number>(); for (const x of all) if (x.hostelId && !['Exited', 'Absconded', 'Deceased'].includes(x.status)) m.set(x.hostelId, (m.get(x.hostelId) || 0) + 1); return m }, [all])
  const alerts = [...flowAlerts(w), ...trackerAlerts(w, st, occ)].filter((a) => !a.id.startsWith('pdpa-') && !a.id.startsWith('zerocost-'))
  const y = stayYears(w)
  const co = companyName(cfg.companies.items, outletCompany(outlets.find((o) => o.id === w.outletId)))
  const fields: FieldDef[] = [
    { key: 'firstArrivalDate', label: 'First arrival in Malaysia (for the 10-year limit)', type: 'date', hint: 'The first time this worker entered Malaysia on a work permit, with any employer. Blank = join date is used.' },
    { key: 'permitEmployer', label: 'Employer named on the work permit', placeholder: co, hint: 'As printed on the PLKS / VP(TE) sticker or i-Kad.' },
    { key: 'permitSector', label: 'Permit sector', type: 'select', options: ['', 'Services', 'Manufacturing', 'Construction', 'Plantation', 'Agriculture', 'Mining & quarrying'] },
  ]
  return (
    <Card title="🛂 Permit, stay & job match" actions={<Btn small icon="edit" onClick={() => setEdit(true)}>Edit</Btn>}>
      <KV items={[
        ['Years in Malaysia', y === null ? '—' : <>{y.toFixed(1)} of {t.stayCapYears} years {y >= t.stayCapYears ? <Chip tone="red">limit reached</Chip> : y >= t.stayHighYears ? <Chip tone="orange">near limit</Chip> : y >= t.stayWarnYears ? <Chip tone="amber">plan ahead</Chip> : null}</>],
        ['Counted from', w.firstArrivalDate ? `First arrival ${fmtDate(w.firstArrivalDate)}` : w.joinDate ? `Join date ${fmtDate(w.joinDate)} (first arrival not recorded)` : '—'],
        ['Permit employer', w.permitEmployer || '—'], ['Company in this app', co || '—'], ['Permit sector', w.permitSector || '—'],
      ]} />
      {alerts.length ? (
        <ul className="rows compact">{alerts.map((a) => <li key={a.id}><div className="r-main"><strong>{a.title}</strong><small>{a.detail}</small></div><Chip tone={sevTone(a.severity)}>{a.severity}</Chip></li>)}</ul>
      ) : <p className="muted small">No permit, stay or job-match warnings.</p>}
      <p className="muted small">Rules used: PLKS renewal from {Math.round(t.plksLeadDays / 30)} months before expiry; passport warning at {t.passportWarnMonths} months (at least {t.passportMinMonths} needed); FOMEMA every {t.fomemaEveryMonths} months; security bond at least {t.bondMinMonths} months at renewal; {t.stayCapYears}-year stay limit. Job-match warnings are soft reminders — {CHECK}.</p>
      {edit && <FormModal title="Permit & stay" fields={fields} initial={{ firstArrivalDate: w.firstArrivalDate || '', permitEmployer: w.permitEmployer || '', permitSector: w.permitSector || '' }} onClose={() => setEdit(false)}
        onSave={(v) => updateWorker(w.id, (x) => { x.firstArrivalDate = s(v.firstArrivalDate) || undefined; x.permitEmployer = s(v.permitEmployer) || undefined; x.permitSector = s(v.permitSector) || undefined })} />}
    </Card>
  )
}

function HostelCard({ w }: { w: Worker }) {
  const cfg = useConfig()
  const all = useWorkers()
  const [edit, setEdit] = useState(false)
  const hostels = cfg.hostels.items.filter((h) => !h.archived)
  const h = cfg.hostels.items.find((x) => x.id === w.hostelId)
  const occ = all.filter((x) => x.hostelId === h?.id && !['Exited', 'Absconded', 'Deceased'].includes(x.status)).length
  const iss = h ? hostelIssues(h, occ, cfg.trackers) : []
  return (
    <Card title="🏠 Hostel (Act 446)" actions={<Btn small icon="edit" onClick={() => setEdit(true)}>{h ? 'Change' : 'Assign'}</Btn>}>
      {h ? <>
        <KV items={[['Hostel', h.name], ['Certificate', h.certNo ? `${h.certNo}${h.certExpiry ? ` · until ${fmtDate(h.certExpiry)}` : ''}` : '—'], ['Occupancy', `${occ}${h.capacity ? ` of ${h.capacity}` : ''}`]]} />
        {iss.map((i) => <p key={i.text} className={i.level === 'red' ? 'err small' : 'small'}>⚠️ {i.text}</p>)}
      </> : <p className="muted">Not assigned. {hostels.length ? 'Pick the hostel the worker lives in.' : 'Add hostels in Compliance → Hostels first.'}</p>}
      {edit && <FormModal title="Hostel" fields={[{ key: 'hostelId', label: 'Hostel', type: 'select', options: [{ value: '', label: '— Not in a company hostel —' }, ...hostels.map((x) => ({ value: x.id, label: x.name }))] }]}
        initial={{ hostelId: w.hostelId || '' }} onClose={() => setEdit(false)} onSave={(v) => updateWorker(w.id, (x) => { x.hostelId = s(v.hostelId) || undefined })} />}
    </Card>
  )
}

function FlowCard({ w }: { w: Worker }) {
  const f = w.exitFlow
  const [step, setStep] = useState<string | null>(null)
  const [start, setStart] = useState<ExitFlow['kind'] | null>(null)
  const steps = f?.kind === 'abscond' ? ABSCOND_STEPS : EXIT_STEPS
  const done = f ? steps.filter((x) => f.steps[x.key]?.done).length : 0
  const def = steps.find((x) => x.key === step)
  return (
    <Card title={f?.kind === 'abscond' ? '🚨 Absconding checklist' : '🚪 Exit checklist'}
      actions={f ? <Btn small kind="ghost" onClick={() => { if (confirm(f.closed ? 'Reopen this checklist?' : 'Close this checklist? (it stays on record)')) void updateWorker(w.id, (x) => { if (x.exitFlow) x.exitFlow.closed = !f.closed }) }}>{f.closed ? 'Reopen' : 'Close'}</Btn> : undefined}>
      {!f ? <>
        <p className="muted small">Start a checklist when the worker leaves for good or goes missing.</p>
        <div className="row gap-s wrap"><Btn small icon="plus" onClick={() => setStart('exit')}>Start exit checklist</Btn><Btn small icon="alert" onClick={() => setStart('abscond')}>Worker absconded</Btn></div>
      </> : <>
        <p className="small">{f.kind === 'abscond' ? `Last seen ${fmtDate(f.lastSeen)} · ` : ''}Started {fmtDate(f.started)} · {done} of {steps.length} done {f.closed && <Chip tone="gray">closed</Chip>}</p>
        <ul className="rows compact">{steps.map((x) => {
          const r = f.steps[x.key] || {}
          return <li key={x.key}><div className="r-main"><strong>{r.done ? '✅' : '⬜'} {x.label}</strong><small>{r.done ? `${fmtDate(r.date)}${r.ref ? ` · ref ${r.ref}` : ''}${r.note ? ` · ${r.note}` : ''}` : x.hint}</small></div><IconAction kind={r.done ? 'edit' : 'approve'} label={r.done ? `Edit: ${x.label}` : `Mark done: ${x.label}`} onClick={() => setStep(x.key)} /></li>
        })}</ul>
        {f.kind === 'abscond' && <p className="muted small">The days for the police and Immigration reports are company targets (Settings in Compliance → Rules), not legal deadlines. Report in FWCMS (eRUNAWAY) or in person; Immigration keeps the security bond — {CHECK}.</p>}
        {f.kind === 'exit' && <p className="muted small">Apply for the Check Out Memo (COM) before the worker flies home; it is also needed to claim back the security bond — {CHECK}.</p>}
      </>}
      {start && <FormModal title={start === 'abscond' ? 'Worker absconded' : 'Start exit checklist'}
        fields={start === 'abscond' ? [{ key: 'lastSeen', label: 'Last day seen at work', type: 'date', required: true }, { key: 'status', label: 'Also set the worker status to “Absconded”', type: 'checkbox', full: true }] : [{ key: 'started', label: 'Start date', type: 'date', required: true }]}
        initial={start === 'abscond' ? { lastSeen: todayISO(), status: true } : { started: todayISO() }} onClose={() => setStart(null)}
        onSave={(v) => updateWorker(w.id, (x) => {
          x.exitFlow = { kind: start, started: start === 'abscond' ? todayISO() : s(v.started), lastSeen: start === 'abscond' ? s(v.lastSeen) : undefined, steps: {} }
          if (start === 'abscond' && v.status) x.status = 'Absconded'
        })} />}
      {step && f && def && <FormModal title={def.label} fields={[{ key: 'done', label: 'Done', type: 'checkbox', full: true }, { key: 'date', label: 'Date', type: 'date' }, { key: 'ref', label: 'Reference no. (report, COM, receipt…)' }, { key: 'note', label: 'Note', type: 'textarea', full: true }]}
        initial={{ done: true, date: todayISO(), ...(f.steps[step] || {}) }} onClose={() => setStep(null)}
        onSave={(v) => updateWorker(w.id, (x) => { if (x.exitFlow) x.exitFlow.steps[step] = { done: !!v.done, date: s(v.date) || undefined, ref: s(v.ref) || undefined, note: s(v.note) || undefined } })}>
        {() => <p className="muted small">{def.hint}</p>}
      </FormModal>}
    </Card>
  )
}

function CostsCard({ w }: { w: Worker }) {
  const cfg = useConfig()
  const [edit, setEdit] = useState<CostRec | null>(null)
  const costs = [...(w.costs || [])].sort((a, b) => b.date.localeCompare(a.date))
  const stat = useMemo(() => {
    let epf = 0, socso = 0
    for (const p of w.payslips || []) { const r = computePayslip(p, cfg.rates, w); epf += r.epfEr; socso += r.socsoEr }
    return { epf, socso, n: (w.payslips || []).length }
  }, [w, cfg.rates])
  const company = costs.filter((c) => c.paidBy === 'Company').reduce((t, c) => t + c.amount, 0)
  const workerPaid = costs.filter((c) => c.paidBy === 'Worker' && RECRUITMENT_COSTS.includes(c.type) && !c.refunded)
  const fields: FieldDef[] = [
    { key: 'type', label: 'Cost', type: 'select', options: [...COST_TYPES], required: true },
    { key: 'amount', label: 'Amount', type: 'money', required: true },
    { key: 'date', label: 'Date paid', type: 'date', required: true },
    { key: 'paidBy', label: 'Paid by', type: 'select', options: ['Company', 'Worker', 'Agent'], required: true },
    { key: 'refunded', label: 'Refunded to the worker', type: 'checkbox', show: (v) => v.paidBy === 'Worker' },
    { key: 'notes', label: 'Notes / receipt no.', full: true },
  ]
  const lv = cfg.trackers.costDefaults.Levy ?? 1850
  return (
    <Card title="💵 Cost tracker" actions={<Btn small icon="plus" onClick={() => setEdit({ id: '', date: todayISO(), type: 'Levy', amount: lv, paidBy: 'Company' })}>Add cost</Btn>}>
      <KV items={[['Paid by the company (recorded)', rm(company)], [`Employer EPF + PERKESO (from ${stat.n} payslip${stat.n === 1 ? '' : 's'})`, `${rm(stat.epf)} + ${rm(stat.socso)}`], ['Total cost of this worker', rm(company + stat.epf + stat.socso)]]} />
      {workerPaid.length > 0 && <div className="banner red small">The worker paid {workerPaid.map((c) => c.type.toLowerCase()).join(', ')} ({rm(workerPaid.reduce((t, c) => t + c.amount, 0))}). These are employer costs — refund them and record the refund ({CHECK}).</div>}
      {costs.length ? (
        <DataTable label="Costs" rows={costs} rowKey={(c) => c.id} initialSort={{ key: 'd', dir: 'desc' }} rowClass={(c) => (c.paidBy === 'Worker' && !c.refunded ? 'dt-bad' : '')}
          columns={[
            { key: 'd', label: 'Date', sort: (c) => c.date, render: (c) => <span className="nowrap">{fmtDate(c.date)}</span> },
            { key: 't', label: 'Cost', main: true, sort: (c) => c.type, render: (c) => c.type },
            { key: 'p', label: 'Paid by', hide: 'phone', sort: (c) => c.paidBy, render: (c) => `${c.paidBy}${c.refunded ? ' (refunded)' : ''}` },
            { key: 'a', label: 'Amount', align: 'right', sort: (c) => c.amount, render: (c) => rm(c.amount) },
          ]}
          actions={(c) => <Actions><IconAction kind="edit" label="Edit cost" onClick={() => setEdit(c)} /></Actions>}
          expand={(c) => <Details items={[['Date', fmtDate(c.date)], ['Cost', c.type], ['Paid by', `${c.paidBy}${c.refunded ? ' (refunded)' : ''}`], ['Amount', rm(c.amount)], ['Notes', c.notes]]} />} />
      ) : <p className="muted small">No costs recorded. Levy default is {rm(lv)} a year (Peninsular Malaysia; Sabah and Sarawak differ) — editable in Compliance → Rules.</p>}
      {edit && <FormModal title={edit.id ? 'Edit cost' : 'Add cost'} fields={fields} initial={edit as unknown as V} onClose={() => setEdit(null)}
        onDelete={edit.id ? () => void updateWorker(w.id, (x) => { x.costs = (x.costs || []).filter((c) => c.id !== edit.id) }) : undefined}
        onSave={(v) => updateWorker(w.id, (x) => {
          const rec: CostRec = { id: edit.id || uid(), date: s(v.date), type: s(v.type), amount: Number(v.amount) || 0, paidBy: s(v.paidBy) as CostRec['paidBy'], notes: s(v.notes) || undefined, refunded: v.paidBy === 'Worker' && v.refunded ? true : undefined }
          x.costs = edit.id ? (x.costs || []).map((c) => (c.id === edit.id ? rec : c)) : [...(x.costs || []), rec]
        })} />}
    </Card>
  )
}

const ZC_LABEL = { not_issued: 'Not issued', issued: 'Waiting for signature', signed: 'Signed' } as const
function ZeroCostCard({ w }: { w: Worker }) {
  const cfg = useConfig()
  const st = useSettings()
  const outlets = useOutlets()
  const [sign, setSign] = useState(false)
  const z = w.zeroCost || { status: 'not_issued' as const }
  const lang = zeroCostLanguage(w.primaryLanguage, cfg.zerocost_translations, cfg.consent_translations)
  const print = async () => {
    try {
      download(`zero-cost-declaration-${w.workerNo}.pdf`, await zeroCostPdf([w], outlets, st.companyName), 'application/pdf')
      if (z.status === 'not_issued') await updateWorker(w.id, (x) => { x.zeroCost = { ...(x.zeroCost || { status: 'not_issued' }), status: 'issued', issuedAt: todayISO(), language: lang.code } })
    } catch (e) { toast((e as Error).message, 'err') }
  }
  return (
    <Card title="🤝 Zero-cost recruitment declaration">
      <p className="small"><Chip tone={z.status === 'signed' ? 'green' : z.status === 'issued' ? 'amber' : 'gray'}>{ZC_LABEL[z.status]}</Chip>{z.signedAt ? ` · signed ${fmtDate(z.signedAt)}` : z.issuedAt ? ` · printed ${fmtDate(z.issuedAt)}` : ''}</p>
      {z.paidDeclared && <p className={/^(none|tiada|-)$/i.test(z.paidDeclared.trim()) ? 'small' : 'err small'}>Declared as paid: {z.paidDeclared}</p>}
      <p className="muted small">The worker confirms he paid no recruitment fee. Prints in English + {lang.code === 'ms' ? 'Bahasa Malaysia' : 'the worker’s language'}{lang.fallback ? ` (${lang.fallback})` : ''}.</p>
      <div className="row gap-s wrap"><Btn small icon="download" onClick={() => void print()}>Print form</Btn><Btn small icon="check" onClick={() => setSign(true)}>Record signed form</Btn></div>
      {sign && <FormModal title="Signed zero-cost declaration" fields={[{ key: 'signedAt', label: 'Date signed', type: 'date', required: true }, { key: 'paidDeclared', label: 'Money the worker wrote down as paid', placeholder: 'None', full: true, hint: 'Copy what the worker wrote in the box. If he paid anything, follow up with the agent and record a refund in the cost tracker.' }]}
        initial={{ signedAt: z.signedAt || todayISO(), paidDeclared: z.paidDeclared || '' }} onClose={() => setSign(false)}
        onSave={(v) => updateWorker(w.id, (x) => { x.zeroCost = { ...(x.zeroCost || { status: 'not_issued' }), status: 'signed', signedAt: s(v.signedAt), paidDeclared: s(v.paidDeclared) || 'None', language: x.zeroCost?.language || lang.code } })} />}
    </Card>
  )
}

const PDPA_LABEL = { not_recorded: 'Not recorded', given: 'Notice given & consent recorded', withdrawn: 'Consent withdrawn' } as const
function PdpaCard({ w }: { w: Worker }) {
  const [edit, setEdit] = useState(false)
  const p = w.pdpa || { status: 'not_recorded' as const }
  return (
    <Card title="🔐 Personal data (PDPA)" actions={<Btn small icon="edit" onClick={() => setEdit(true)}>Record</Btn>}>
      <p className="small"><Chip tone={p.status === 'given' ? 'green' : p.status === 'withdrawn' ? 'red' : 'gray'}>{PDPA_LABEL[p.status]}</Chip>{p.date ? ` · ${fmtDate(p.date)}` : ''}{p.method ? ` · ${p.method}` : ''}</p>
      <p className="muted small">Tell the worker, in a language he understands, what personal data you keep, why, who sees it and how to ask for a copy or a correction. Medical records are only shown to HR and management. Personal Data Protection Act 2010 — check with the PDP Commissioner (JPDP) or your adviser.</p>
      {edit && <FormModal title="PDPA notice & consent" fields={[
        { key: 'status', label: 'Status', type: 'select', options: [{ value: 'given', label: 'Notice given & consent recorded' }, { value: 'withdrawn', label: 'Consent withdrawn' }, { value: 'not_recorded', label: 'Not recorded' }], required: true },
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'method', label: 'How', type: 'select', options: ['', 'Signed form', 'Contract clause', 'Explained verbally with witness', 'Electronic'] },
        { key: 'noticeLanguage', label: 'Language of the notice' },
        { key: 'notes', label: 'Notes', full: true },
      ]} initial={{ status: p.status === 'not_recorded' ? 'given' : p.status, date: p.date || todayISO(), method: p.method || '', noticeLanguage: p.noticeLanguage || '', notes: p.notes || '' }} onClose={() => setEdit(false)}
        onSave={(v) => updateWorker(w.id, (x) => { x.pdpa = { status: s(v.status) as 'given', date: s(v.date) || undefined, method: s(v.method) || undefined, noticeLanguage: s(v.noticeLanguage) || undefined, notes: s(v.notes) || undefined, withdrawnAt: v.status === 'withdrawn' ? s(v.date) || todayISO() : undefined } })} />}
    </Card>
  )
}
