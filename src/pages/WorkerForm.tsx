import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Avatar, Btn, Card, FormGrid, KV, type FieldDef } from '../components/ui'
import { db, saveWorker } from '../lib/db'
import { useAuth } from '../lib/auth'
import { inScope } from '../lib/companies'
import { useJobs, useOutlets, useSettings } from '../lib/hooks'
import { BUSINESS_TYPES, GENDERS, NATIONALITIES, RELATIONS, RELIGIONS, SKILL_LEVELS, STATUSES, type DocRec, type Worker, type WorkerStatus } from '../lib/types'
import { addMonths, fmtDate, resizeImage, rm, todayISO, uid } from '../lib/util'

type V = Record<string, unknown>

const DOC_QUICK: [string, string][] = [
  ['Passport', 'pp'], ['Work Permit / PLKS (VP(TE))', 'vp'], ['FOMEMA Medical', 'fm'], ['Insurance (SPIKPA / Hospitalisation)', 'ins'], ['SOCSO / PERKESO', 'so'], ['Levy Payment', 'lv'],
]

export default function WorkerForm() {
  const { id } = useParams()
  const editing = !!id
  const nav = useNavigate()
  const s = useSettings()
  const outlets = useOutlets()
  const jobs = useJobs()
  const [step, setStep] = useState(0)
  const [v, setV] = useState<V>({ status: 'Active-Working', joinDate: todayISO(), nationality: '', skillLevel: '' })
  const [orig, setOrig] = useState<Worker | null>(null)
  const { role, myCompanies, myOutlets } = useAuth()
  const [err, setErr] = useState('')

  useEffect(() => {
    if (id) db.workers.get(id).then((w) => { if (w) { setOrig(w); setV({ ...w } as unknown as V) } })
    else db.workers.toArray().then((ws) => {
      const max = ws.reduce((m, w) => Math.max(m, parseInt(w.workerNo.replace(/\D/g, '')) || 0), 1000)
      setV((p) => ({ ...p, workerNo: `FW${max + 1}`, contractStart: todayISO(), contractEnd: addMonths(todayISO(), 24), minContractMonths: undefined, earlyPenalty: undefined, initialBasicPay: undefined }))
    })
  }, [id])
  useEffect(() => {
    if (!editing) setV((p) => ({ ...p, minContractMonths: p.minContractMonths ?? s.defaultMinContractMonths, earlyPenalty: p.earlyPenalty ?? s.defaultPenalty, annualLeaveDays: p.annualLeaveDays ?? s.annualLeaveDays }))
  }, [s, editing])

  const bt = (v.businessType as string) || ''
  const jobOptions = useMemo(() => {
    const list = jobs.filter((j) => !bt || j.businessType === bt).map((j) => j.name)
    return Array.from(new Set(list)).sort()
  }, [jobs, bt])

  const personal: FieldDef[] = [
    { key: 'workerNo', label: 'Worker ID', required: true },
    { key: 'fullName', label: 'Full name (as in passport)', required: true, full: true },
    { key: 'nationality', label: 'Nationality', type: 'select', options: NATIONALITIES, required: true },
    { key: 'gender', label: 'Gender', type: 'select', options: GENDERS },
    { key: 'dob', label: 'Date of birth', type: 'date' },
    { key: 'religion', label: 'Religion', type: 'select', options: RELIGIONS },
    { key: 'phoneMY', label: 'Phone (Malaysia)', type: 'tel', placeholder: '+60 1X-XXX XXXX' },
    { key: 'phoneHome', label: 'Phone (home country)', type: 'tel' },
  ]
  const job: FieldDef[] = [
    { key: 'outletId', label: 'Outlet / business unit', type: 'select', options: outlets.filter((o) => inScope(role, myCompanies, myOutlets, o.id, outlets) || o.id === (v.outletId as string | undefined)).map((o) => ({ value: o.id, label: `${o.name} (${o.type})` })), hint: outlets.length ? undefined : 'Add outlets in Settings first (optional)' },
    { key: 'businessType', label: 'Business type', type: 'select', options: [...BUSINESS_TYPES] },
    { key: 'jobCategory', label: 'Job / skill category', type: 'select', options: jobOptions },
    { key: 'skillLevel', label: 'Skill level', type: 'select', options: SKILL_LEVELS },
    { key: 'joinDate', label: 'Join date', type: 'date', required: true },
    ...(editing ? [] : [{ key: 'status', label: 'Employment status', type: 'select' as const, options: [...STATUSES] }]),
    { key: 'agent', label: 'Recruitment agent', full: true },
  ]
  const docs: FieldDef[] = DOC_QUICK.flatMap(([label, k]) => [
    { key: `${k}_no`, label: `${label.split(' (')[0]} no.` },
    { key: `${k}_issue`, label: 'Issue date', type: 'date' as const },
    { key: `${k}_exp`, label: 'Expiry date', type: 'date' as const },
  ])
  const contract: FieldDef[] = [
    { key: 'contractStart', label: 'Contract start', type: 'date' },
    { key: 'contractEnd', label: 'Contract end', type: 'date' },
    { key: 'minContractMonths', label: 'Minimum contract period (months)', type: 'number', hint: 'Leaving before this attracts a prorated penalty' },
    { key: 'earlyPenalty', label: 'Early-termination penalty (RM)', type: 'number', hint: 'Full amount; prorated on remaining months' },
    { key: 'initialBasicPay', label: editing ? 'Starting basic pay (RM)' : 'Basic pay (RM / month)', type: 'number', required: true, hint: editing ? 'Increments are recorded in the Pay tab' : undefined },
    { key: 'annualLeaveDays', label: 'Annual leave entitlement (days / year)', type: 'number' },
    { key: 'bankName', label: 'Bank' },
    { key: 'bankAccount', label: 'Bank account no.' },
  ]
  const address: FieldDef[] = [
    { key: 'overseasAddress', label: 'Overseas (home) address', type: 'textarea' },
    { key: 'hostelAddress', label: 'Malaysian accommodation / hostel address', type: 'textarea' },
    ...(editing ? [] : [
      { key: 'nok_name', label: 'Next of kin name' },
      { key: 'nok_relation', label: 'Relation', type: 'select' as const, options: RELATIONS },
      { key: 'nok_phone', label: 'Next of kin phone', type: 'tel' as const },
      { key: 'nok_address', label: 'Next of kin address', full: true },
    ]),
  ]
  const steps = [
    { title: 'Personal', fields: personal },
    { title: 'Job', fields: job },
    ...(editing ? [] : [{ title: 'Documents', fields: docs }]),
    { title: 'Contract & pay', fields: contract },
    { title: 'Address & kin', fields: address },
    { title: 'Review', fields: [] as FieldDef[] },
  ]
  const cur = steps[step]

  const change = (nv: V) => {
    if (nv.outletId !== v.outletId && nv.outletId) {
      const o = outlets.find((x) => x.id === nv.outletId)
      if (o) nv.businessType = o.type
    }
    if (nv.businessType !== v.businessType && nv.jobCategory && !jobs.some((j) => j.businessType === nv.businessType && j.name === nv.jobCategory)) nv.jobCategory = ''
    setV(nv)
  }
  const validStep = () => {
    for (const f of cur.fields) if (f.required && (v[f.key] === undefined || v[f.key] === '')) { setErr(`${f.label} is required`); return false }
    setErr('')
    return true
  }
  const save = async () => {
    for (const st of steps) for (const f of st.fields) if (f.required && (v[f.key] === undefined || v[f.key] === '')) { setErr(`${f.label} is required (step "${st.title}")`); return }
    const dup = await db.workers.where('workerNo').equals(String(v.workerNo)).first()
    if (dup && dup.id !== id) { setErr('Worker ID already exists'); return }
    const now = new Date().toISOString()
    const pick = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, v[k] === '' ? undefined : v[k]]))
    const base = pick([...personal, ...job, ...contract, ...address].map((f) => f.key).filter((k) => !k.startsWith('nok_')))
    if (orig) {
      const w: Worker = { ...orig, ...(base as Partial<Worker>), photo: v.photo as string | undefined }
      await saveWorker(w)
      nav(`/workers/${w.id}`, { replace: true })
      return
    }
    const documents: DocRec[] = DOC_QUICK.filter(([, k]) => v[`${k}_no`] || v[`${k}_exp`]).map(([type, k]) => ({
      id: uid(), type, number: (v[`${k}_no`] as string) || undefined, issueDate: (v[`${k}_issue`] as string) || undefined, expiryDate: (v[`${k}_exp`] as string) || undefined,
    }))
    const w: Worker = {
      ...(base as unknown as Worker),
      id: uid(), photo: v.photo as string | undefined,
      status: (v.status as WorkerStatus) || 'Active-Working',
      statusHistory: [{ id: uid(), date: String(v.joinDate), to: (v.status as string) || 'Active-Working', remarks: 'Created' }],
      documents,
      family: v.nok_name ? [{ id: uid(), name: String(v.nok_name), relation: String(v.nok_relation || 'Other'), phone: v.nok_phone as string, address: v.nok_address as string, isNextOfKin: true, isEmergency: true }] : [],
      initialBasicPay: Number(v.initialBasicPay || 0), increments: [], allowances: [], loans: [], deductions: [], leaves: [], memos: [], notes: [],
      createdAt: now, updatedAt: now,
    }
    await saveWorker(w)
    nav(`/workers/${w.id}`, { replace: true })
  }

  return (
    <div className="page narrow">
      <div className="page-h">
        <div className="row gap-s">
          <Btn kind="ghost" icon="back" onClick={() => nav(-1)} title="Back" />
          <h1>{editing ? 'Edit worker' : 'Add worker'}</h1>
        </div>
      </div>
      <ol className="stepper" aria-label="Steps">
        {steps.map((st, i) => (
          <li key={st.title} className={i === step ? 'on' : i < step ? 'done' : ''}>
            <button type="button" onClick={() => (i < step || validStep()) && setStep(i)}><span>{i + 1}</span>{st.title}</button>
          </li>
        ))}
      </ol>
      <Card title={`${step + 1}. ${cur.title}`}>
        {step === 0 && (
          <div className="photo-row">
            <Avatar name={String(v.fullName || '?')} photo={v.photo as string} size={72} />
            <label className="btn btn-secondary">
              <input type="file" accept="image/*" capture="user" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setV({ ...v, photo: await resizeImage(f) }) }} />
              {v.photo ? 'Change photo' : 'Add photo (optional)'}
            </label>
            {!!v.photo && <Btn kind="ghost" onClick={() => setV({ ...v, photo: undefined })}>Remove</Btn>}
          </div>
        )}
        {cur.title === 'Documents' && <p className="muted small">Fill what you have now — you can add more documents and attachments later.</p>}
        {cur.title === 'Review' ? (
          <KV items={[
            ['Worker', `${v.fullName || '—'} (${v.workerNo})`], ['Nationality', String(v.nationality || '—')],
            ['Outlet', outlets.find((o) => o.id === v.outletId)?.name || '—'], ['Job', `${v.jobCategory || '—'} · ${v.skillLevel || '—'}`],
            ['Join date', fmtDate(v.joinDate as string)], ['Contract', `${fmtDate(v.contractStart as string)} → ${fmtDate(v.contractEnd as string)}`],
            ['Minimum period', v.minContractMonths ? `${v.minContractMonths} months · penalty ${rm(v.earlyPenalty as number)}` : '—'],
            ['Basic pay', rm(v.initialBasicPay as number)],
            ...(!editing ? [['Documents', String(DOC_QUICK.filter(([, k]) => v[`${k}_no`] || v[`${k}_exp`]).length)] as [string, string]] : []),
          ]} />
        ) : (
          <FormGrid fields={cur.fields} value={v} onChange={change} />
        )}
        {err && <p className="err" role="alert">{err}</p>}
        <div className="modal-actions">
          {step > 0 && <Btn icon="back" onClick={() => setStep(step - 1)}>Back</Btn>}
          <span className="spacer" />
          {editing && step < steps.length - 1 && <Btn onClick={save}>Save now</Btn>}
          {step < steps.length - 1 ? <Btn kind="primary" onClick={() => validStep() && setStep(step + 1)}>Next</Btn> : <Btn kind="primary" icon="check" onClick={save}>{editing ? 'Save changes' : 'Create worker'}</Btn>}
        </div>
      </Card>
    </div>
  )
}
