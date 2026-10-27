/* Add / Edit worker — step-by-step (v1.1.2).
   Personal → Job → Documents → Contract & pay → Family, address & remittance → Review & submit.
   - Partial data can always be saved (Draft / Incomplete); completeness is computed, never stored, so old records stay valid.
   - Format errors block saving only for values typed/changed in this session; warnings never block.
   - The form autosaves to this device (localStorage) while stepping and offers to restore after a reload/close. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Avatar, Btn, Card, FormGrid, type FieldDef } from '../components/ui'
import { FilePick } from '../components/filePick'
import { LanguageFields, languageFieldsOut } from '../components/languageFields'
import { RemitEditor, maskAcct, providerName } from '../components/remittance'
import { db, saveWorker } from '../lib/db'
import { useAuth } from '../lib/auth'
import { inScope, companyName, outletCompanyName } from '../lib/companies'
import { useConfig } from '../lib/config'
import { useAllWorkers, useJobs, useOutlets, useSettings } from '../lib/hooks'
import { expiryTip, learnValidity, nameTip, passportDup, personDup, workerNoDup } from '../lib/smartForm'
import { BUSINESS_TYPES, DOC_SHORT, DOC_STAGES, GENDERS, NATIONALITIES, RELATIONS, RELIGIONS, SKILL_LEVELS, STATUSES, type DocRec, type FamilyRec, type RemitRec, type Worker, type WorkerStatus } from '../lib/types'
import { languagesSummary } from '../lib/languages'
import { qRank, useQuotaLetters } from '../lib/quota'
import { addMonths, fmtDate, resizeImage, rm, todayISO, uid } from '../lib/util'
import {
  NATIONALITY_CC, PERMIT_HINT, completeness, dateIssues, dobIssue, docNumberIssue, emailIssue, fmtPhone, latestDoc, moneyIssue, passportHint, passportIssue, phoneIssue, type Issues,
} from '../lib/validate'

type V = Record<string, unknown>

/** the numbered document cards, in display order: [type, key prefix] */
export const DOC_CARDS: [string, string][] = [
  ['Passport', 'pp'], ['Work Permit / PLKS (VP(TE))', 'vp'], ['Visa / VDR', 'visa'], ['FOMEMA Medical', 'fm'],
  ['Insurance (SPIKPA / Hospitalisation)', 'ins'], ['Hostel / Accommodation', 'hos'], ['SOCSO / PERKESO', 'so'], ['Levy Payment', 'lv'],
]
const DOC_SUBS = ['no', 'issue', 'exp', 'place', 'stage'] as const
const docHas = (v: V, k: string) => DOC_SUBS.some((s) => v[`${k}_${s}`] !== undefined && v[`${k}_${s}`] !== '')
function docsFromV(v: V, base: DocRec[] = []): DocRec[] {
  let out = [...base]
  for (const [type, k] of DOC_CARDS) {
    const patch = {
      number: (v[`${k}_no`] as string) || undefined, issueDate: (v[`${k}_issue`] as string) || undefined, expiryDate: (v[`${k}_exp`] as string) || undefined,
      issuePlace: (v[`${k}_place`] as string) || undefined, stage: (v[`${k}_stage`] as string) || undefined,
    }
    const cur = latestDoc(base, type)
    if (cur) out = out.map((d) => (d.id === cur.id ? { ...d, ...patch } : d))
    else if (docHas(v, k)) out.push({ id: uid(), type, ...patch })
  }
  return out
}
const draftKey = (id?: string) => `fwm.workerDraft.${id || 'new'}`

export default function WorkerForm() {
  const { id } = useParams()
  const editing = !!id
  const nav = useNavigate()
  const s = useSettings()
  const outlets = useOutlets()
  const cosAll = useConfig().companies.items
  const jobs = useJobs()
  const allWorkers = useAllWorkers() // demo workers too: IDs and passports must be unique everywhere
  const validity = useMemo(() => learnValidity(allWorkers), [allWorkers])
  const { role, myCompanies, myOutlets, isHr, canSeeSalary } = useAuth()
  const [step, setStep] = useState(0)
  const [v, setV] = useState<V>({ status: 'Active-Working', joinDate: todayISO(), nationality: '', skillLevel: '' })
  const [init, setInit] = useState<V>({})
  const [orig, setOrig] = useState<Worker | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [warned, setWarned] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const [restore, setRestore] = useState<{ v: V; step: number; at: string } | null>(null)
  const [savedAt, setSavedAt] = useState('')
  const topRef = useRef<HTMLDivElement>(null)

  // ---------- load ----------
  useEffect(() => {
    const done = (nv: V) => {
      setV(nv); setInit(nv); setLoaded(true)
      try {
        const raw = localStorage.getItem(draftKey(id))
        if (raw) { const d = JSON.parse(raw); if (d && d.v && JSON.stringify(d.v) !== JSON.stringify(nv)) setRestore(d) }
      } catch { /* ignore */ }
    }
    if (id) db.workers.get(id).then((w) => {
      if (!w) return
      setOrig(w)
      const nv: V = { ...w } as unknown as V
      for (const [type, k] of DOC_CARDS) {
        const d = latestDoc(w.documents, type)
        if (d) Object.assign(nv, { [`${k}_no`]: d.number, [`${k}_issue`]: d.issueDate, [`${k}_exp`]: d.expiryDate, [`${k}_place`]: d.issuePlace, [`${k}_stage`]: d.stage })
      }
      const nok = w.family.find((f) => f.isNextOfKin)
      if (nok) Object.assign(nv, { nok_name: nok.name, nok_relation: nok.relation, nok_phone: nok.phone, nok_address: nok.address })
      done(nv)
    })
    else db.workers.toArray().then((ws) => {
      const max = ws.reduce((m, w) => Math.max(m, parseInt(w.workerNo.replace(/\D/g, '')) || 0), 1000)
      done({ status: 'Active-Working', joinDate: todayISO(), nationality: '', skillLevel: '', workerNo: `FW${max + 1}`, contractStart: todayISO(), contractEnd: addMonths(todayISO(), s.defaultMinContractMonths || 24),
        minContractMonths: s.defaultMinContractMonths, earlyPenalty: s.defaultPenalty, annualLeaveDays: s.annualLeaveDays })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // ---------- autosave to this device ----------
  useEffect(() => {
    if (!loaded || restore) return
    const t = setTimeout(() => {
      if (JSON.stringify(v) === JSON.stringify(init)) return
      const at = new Date().toISOString()
      try { localStorage.setItem(draftKey(id), JSON.stringify({ v, step, at })); setSavedAt(at) } catch { /* quota: photo too big — ignore */ }
    }, 500)
    return () => clearTimeout(t)
  }, [v, step, loaded, restore, id, init])
  const clearDraft = useCallback(() => { try { localStorage.removeItem(draftKey(id)) } catch { /* ignore */ } }, [id])

  // ---------- fields ----------
  const bt = (v.businessType as string) || ''
  const jobOptions = useMemo(() => Array.from(new Set(jobs.filter((j) => !bt || j.businessType === bt).map((j) => j.name))).sort(), [jobs, bt])
  const nat = String(v.nationality || '')
  const letters = useQuotaLetters(qRank(role) > 0)
  const personal: FieldDef[] = [
    { key: 'workerNo', label: 'Worker ID', required: true },
    { key: 'fullName', label: 'Full name (as in passport)', required: true, full: true },
    { key: 'nationality', label: 'Nationality', type: 'select', options: NATIONALITIES, required: true },
    { key: 'gender', label: 'Gender', type: 'select', options: GENDERS, required: true },
    { key: 'dob', label: 'Date of birth', type: 'date', required: true, max: todayISO(), hint: 'PLKS: 18–45 years' },
    { key: 'religion', label: 'Religion', type: 'select', options: RELIGIONS },
    { key: 'phoneMY', label: 'Mobile (Malaysia)', type: 'phone', defaultCc: 'MY', required: true },
    { key: 'phoneHome', label: 'Phone (home country)', type: 'phone', defaultCc: NATIONALITY_CC[nat] || 'MY' },
    { key: 'email', label: 'Email', type: 'email', placeholder: 'optional' },
  ]
  const job: FieldDef[] = [
    { key: 'outletId', label: 'Outlet', type: 'select', required: true, options: outlets.filter((o) => inScope(role, myCompanies, myOutlets, o.id, outlets) || o.id === (v.outletId as string | undefined)).map((o) => ({ value: o.id, label: `${o.name} (${o.type})${o.companyId ? ' — ' + companyName(cosAll, o.companyId) : ''}` })), hint: outlets.length ? undefined : 'Add outlets in Settings first' },
    { key: '_company', label: 'Company', fixed: outletCompanyName(cosAll, outlets, v.outletId as string | undefined), hint: 'Comes from the outlet (change the outlet to change it)' },
    { key: 'businessType', label: 'Business type', type: 'select', options: [...BUSINESS_TYPES] },
    { key: 'jobCategory', label: 'Job title / category', type: 'select', options: jobOptions, required: true },
    { key: 'skillLevel', label: 'Skill level', type: 'select', options: SKILL_LEVELS },
    { key: 'joinDate', label: 'Start date', type: 'date', required: true },
    ...(editing ? [] : [{ key: 'status', label: 'Employment status', type: 'select' as const, options: [...STATUSES] }]),
    { key: 'agent', label: 'Recruitment agent', full: true },
    ...(letters.length ? [{ key: 'quotaId', label: 'Quota approval letter', type: 'select' as const, options: letters.map((l) => ({ value: l.id, label: l.ref_no })), hint: 'Counts this worker in the letter\'s tally (Approval & Recruitment)' }] : []),
  ]
  const contract: FieldDef[] = [
    { key: 'contractStart', label: 'Contract start', type: 'date' },
    { key: 'contractEnd', label: 'Contract end', type: 'date' },
    { key: 'minContractMonths', label: 'Minimum contract period (months)', type: 'number', hint: 'Leaving before this attracts a prorated penalty' },
    ...(canSeeSalary ? [
      { key: 'earlyPenalty', label: 'Early-termination penalty', type: 'money' as const, hint: 'Full amount; prorated on remaining months' },
      { key: 'initialBasicPay', label: editing ? 'Starting basic salary (RM / month)' : 'Basic salary (RM / month)', type: 'money' as const, required: true, hint: editing ? 'Increments are recorded in the Pay tab' : undefined },
    ] : []),
    { key: 'annualLeaveDays', label: 'Annual leave entitlement (days / year)', type: 'number' },
    ...(canSeeSalary ? [{ key: 'bankName', label: 'Salary bank (Malaysia)' }, { key: 'bankAccount', label: 'Salary bank account no.' }] : []),
  ]
  const address: FieldDef[] = [
    { key: 'overseasAddress', label: 'Overseas (home) address', type: 'textarea' },
    { key: 'hostelAddress', label: 'Malaysian accommodation / hostel address', type: 'textarea' },
    { key: 'nok_name', label: 'Next of kin name' },
    { key: 'nok_relation', label: 'Relation', type: 'select', options: RELATIONS },
    { key: 'nok_phone', label: 'Next of kin phone', type: 'phone', defaultCc: NATIONALITY_CC[nat] || 'MY' },
    { key: 'nok_address', label: 'Next of kin address', full: true },
  ]
  const docFields = (type: string, k: string): FieldDef[] => [
    { key: `${k}_no`, label: k === 'pp' ? 'Passport no.' : k === 'vp' ? 'Permit no.' : 'Number / reference', type: k === 'pp' || k === 'vp' ? 'upper' : 'text', required: k === 'pp' || (k === 'vp' && docHas(v, 'vp')),
      hint: k === 'pp' ? passportHint(nat) : k === 'vp' ? PERMIT_HINT : k === 'so' ? 'Foreign workers: SOCSO no. (often the passport no.)' : undefined },
    { key: `${k}_issue`, label: 'Issue date', type: 'date', max: todayISO(), required: k === 'pp' || (k === 'vp' && docHas(v, 'vp')) },
    { key: `${k}_exp`, label: type === 'Hostel / Accommodation' ? 'Valid until' : 'Expiry date', type: 'date', required: k === 'pp' || (k === 'vp' && docHas(v, 'vp')) },
    { key: `${k}_place`, label: k === 'hos' ? 'Address / certificate ref.' : 'Issuing place / office' },
    { key: `${k}_stage`, label: 'Status', type: 'select', options: DOC_STAGES },
  ]
  const steps = [
    { title: 'Personal', fields: personal },
    { title: 'Job', fields: job },
    { title: 'Documents', fields: DOC_CARDS.flatMap(([t, k]) => docFields(t, k)) },
    { title: 'Contract & pay', fields: contract },
    { title: isHr ? 'Family, address & remittance' : 'Family & address', fields: address },
    { title: editing ? 'Review & save' : 'Review & submit', fields: [] as FieldDef[] },
  ]
  const REVIEW = steps.length - 1
  const stepOfKey = (key: string) => {
    if (key === 'primaryLanguage') return 0
    if (key === 'companyId') return 1
    if (key === 'initialBasicPay') return 3
    const i = steps.findIndex((st) => st.fields.some((f) => f.key === key))
    return i < 0 ? 0 : i
  }

  // ---------- completeness + validation (live) ----------
  const draft: Partial<Worker> = useMemo(() => ({ ...(v as Partial<Worker>), ...languageFieldsOut(v), documents: docsFromV(v, orig?.documents || []),
    initialBasicPay: canSeeSalary ? (v.initialBasicPay as number) : 1 }), [v, orig, canSeeSalary])
  const comp = completeness(draft, outlets)
  const missingKeys = new Set(comp.missing.map((m) => (m.key === 'companyId' ? 'outletId' : m.key)))
  const issues: Issues = {}
  const put = (k: string, i: ReturnType<typeof phoneIssue>) => { if (i) issues[k] = i }
  put('dob', dobIssue(v.dob as string))
  put('phoneMY', phoneIssue(v.phoneMY, 'Mobile'))
  put('phoneHome', phoneIssue(v.phoneHome, 'Phone'))
  put('nok_phone', phoneIssue(v.nok_phone, 'Phone'))
  put('email', emailIssue(v.email))
  put('pp_no', passportIssue(v.pp_no, nat))
  put('vp_no', docNumberIssue(v.vp_no, 'vp'))
  for (const k of ['initialBasicPay', 'earlyPenalty']) put(k, moneyIssue(v[k], k === 'initialBasicPay' ? 'Basic salary' : 'Penalty'))
  if (v.contractStart && v.contractEnd && String(v.contractEnd) <= String(v.contractStart)) issues.contractEnd = { level: 'error', msg: 'Contract end must be after the start' }
  // 1.6.0 smart checks: duplicates, one-tap fixes and rule/record-driven auto-fill (tips never block)
  const changed = (k: string) => JSON.stringify(v[k] ?? null) !== JSON.stringify(init[k] ?? null)
  put('workerNo', workerNoDup(v.workerNo, id, allWorkers))
  if (changed('fullName')) put('fullName', nameTip(v.fullName))
  if (!issues.fullName) put('fullName', personDup(v.fullName, v.dob, id, allWorkers))
  if (!issues.pp_no) put('pp_no', passportDup(v.pp_no, id, allWorkers))
  if (v.contractStart && !v.contractEnd && s.defaultMinContractMonths) {
    const val = addMonths(String(v.contractStart), s.defaultMinContractMonths)
    issues.contractEnd = { level: 'tip', msg: `End after the minimum period: ${fmtDate(val)}?`, fix: { label: 'Use this date', value: val }, why: `Settings → Workers sets the default minimum contract to ${s.defaultMinContractMonths} months.` }
  }
  for (const [type, k] of DOC_CARDS) {
    if (!issues[`${k}_exp`]) put(`${k}_exp`, expiryTip(type, DOC_SHORT[type] || type, v[`${k}_issue`] as string, v[`${k}_exp`] as string, validity))
  }
  for (const [, k] of DOC_CARDS) {
    const d = dateIssues(v[`${k}_issue`] as string, v[`${k}_exp`] as string, { passport: k === 'pp', contractEnd: v.contractEnd as string })
    if (d.issue) issues[`${k}_issue`] = d.issue
    if (d.expiry) issues[`${k}_exp`] = d.expiry
  }
  // errors only block when this session typed/changed the value — old records with legacy values never get stuck
  const blocking = Object.entries(issues).filter(([k, i]) => i.level === 'error' && (k === 'workerNo' ? !editing || changed(k) : changed(k)))
  const stepMissing = (i: number) => comp.missing.filter((m) => stepOfKey(m.key === 'companyId' ? 'outletId' : m.key) === i)
  const stepErrors = (i: number) => Object.entries(issues).filter(([k, x]) => x.level === 'error' && stepOfKey(k) === i)
  const showMissing = (i: number) => checked.has(i) || checked.has(REVIEW)
  const markMissing = showMissing(step) ? missingKeys : undefined

  const change = (nv: V) => {
    if (nv.outletId !== v.outletId && nv.outletId) {
      const o = outlets.find((x) => x.id === nv.outletId)
      if (o) nv.businessType = o.type
    }
    if (nv.businessType !== v.businessType && nv.jobCategory && !jobs.some((j) => j.businessType === nv.businessType && j.name === nv.jobCategory)) nv.jobCategory = ''
    setV(nv)
  }
  const go = (i: number) => {
    setChecked((c) => new Set(c).add(step)); setWarned(null); setErr(''); setStep(i)
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const next = () => {
    const probs = stepMissing(step).length + stepErrors(step).length
    if (probs && warned !== step) {
      setChecked((c) => new Set(c).add(step)); setWarned(step)
      setTimeout(() => document.querySelector('.field.is-missing, .field.is-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
      return
    }
    go(step + 1)
  }

  // ---------- save ----------
  const save = async () => {
    setChecked(new Set(steps.map((_, i) => i)))
    if (!String(v.fullName || '').trim()) { setErr('Enter at least the worker’s name to save.'); setStep(0); return }
    if (!String(v.workerNo || '').trim()) { setErr('Worker ID is needed to save.'); setStep(0); return }
    if (blocking.length) { const [k, i] = blocking[0]; setErr(`Please fix: ${i.msg}`); setStep(stepOfKey(k)); return }
    const dup = await db.workers.where('workerNo').equals(String(v.workerNo)).first()
    if (dup && dup.id !== id) { setErr('Worker ID already exists'); setStep(0); return }
    const now = new Date().toISOString()
    const pick = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, v[k] === '' ? undefined : v[k]]))
    const base = { ...pick([...personal, ...job, ...contract, ...address].map((f) => f.key).filter((k) => !k.startsWith('nok_'))), ...languageFieldsOut(v),
      fullName: String(v.fullName).trim(), ...(isHr ? { remittance: (v.remittance as RemitRec[] | undefined) || [] } : {}) }
    const documents = docsFromV(v, orig?.documents || [])
    const nokPatch = v.nok_name ? { name: String(v.nok_name), relation: String(v.nok_relation || 'Other'), phone: v.nok_phone as string, address: v.nok_address as string } : null
    if (orig) {
      let family: FamilyRec[] = orig.family
      const nok = orig.family.find((f) => f.isNextOfKin)
      if (nok && nokPatch) family = orig.family.map((f) => (f.id === nok.id ? { ...f, ...nokPatch } : f))
      else if (!nok && nokPatch) family = [...orig.family, { id: uid(), ...nokPatch, isNextOfKin: true, isEmergency: true }]
      const w: Worker = { ...orig, ...(base as Partial<Worker>), documents, family, photo: v.photo as string | undefined }
      await saveWorker(w)
      clearDraft()
      nav(`/workers/${w.id}`, { replace: true })
      return
    }
    const w: Worker = {
      ...(base as unknown as Worker),
      id: uid(), photo: v.photo as string | undefined,
      status: (v.status as WorkerStatus) || 'Active-Working',
      joinDate: String(v.joinDate || todayISO()),
      statusHistory: [{ id: uid(), date: String(v.joinDate || todayISO()), to: (v.status as string) || 'Active-Working', remarks: comp.complete ? 'Created' : 'Created (draft — incomplete profile)' }],
      documents,
      family: nokPatch ? [{ id: uid(), ...nokPatch, isNextOfKin: true, isEmergency: true }] : [],
      initialBasicPay: Number(v.initialBasicPay || 0), increments: [], allowances: [], loans: [], deductions: [], leaves: [], memos: [], notes: [],
      createdAt: now, updatedAt: now,
    }
    await saveWorker(w)
    clearDraft()
    nav(`/workers/${w.id}`, { replace: true })
  }

  const pct = Math.round((comp.done / comp.total) * 100)
  const o = outlets.find((x) => x.id === v.outletId)
  const remit = (v.remittance as RemitRec[] | undefined) || []
  const reviewBlocks: { i: number; rows: [string, string][] }[] = [
    { i: 0, rows: [['Name', `${v.fullName || '—'} (${v.workerNo || '—'})`], ['Nationality · gender · DOB', `${v.nationality || '—'} · ${v.gender || '—'} · ${fmtDate(v.dob as string)}`],
      ['Languages', languagesSummary(languageFieldsOut(v) as unknown as Worker) || '—'], ['Mobile', fmtPhone(v.phoneMY as string) || '—'], ['Home phone', fmtPhone(v.phoneHome as string) || '—']] },
    { i: 1, rows: [['Company / outlet', o ? `${o.name}` : '—'], ['Job', `${v.jobCategory || '—'} · ${v.skillLevel || '—'}`], ['Start date', fmtDate(v.joinDate as string)]] },
    { i: 2, rows: DOC_CARDS.filter(([, k]) => docHas(v, k)).map(([t, k], n) => [`${n + 1}. ${DOC_SHORT[t]}`, `${v[`${k}_no`] || '—'} · ${fmtDate(v[`${k}_issue`] as string)} → ${fmtDate(v[`${k}_exp`] as string)}${v[`${k}_stage`] ? ` · ${v[`${k}_stage`]}` : ''}`] as [string, string]) },
    { i: 3, rows: [['Contract', `${fmtDate(v.contractStart as string)} → ${fmtDate(v.contractEnd as string)}`], ...(canSeeSalary ? [['Basic salary', v.initialBasicPay !== undefined ? rm(v.initialBasicPay as number) : '—'] as [string, string]] : [])] },
    { i: 4, rows: [['Next of kin', v.nok_name ? `${v.nok_name} (${v.nok_relation || '—'})` : '—'], ...(isHr ? [['Remittance', remit.length ? remit.map((r) => `${providerName(r)} ${maskAcct(r.accountNo)}`).join(', ') : '—'] as [string, string]] : [])] },
  ]

  return (
    <div className="page narrow wf" ref={topRef}>
      <div className="page-h">
        <div className="row gap-s">
          <Btn kind="ghost" icon="back" onClick={() => nav(-1)} title="Back" />
          <h1>{editing ? 'Edit worker' : 'Add worker'}</h1>
        </div>
        <span className={`chip ${comp.complete ? 'chip-green' : 'chip-amber'}`}>{comp.complete ? 'Complete' : 'Draft / Incomplete'}</span>
      </div>
      {restore && (
        <p className="banner amber small" role="status">💾 Unsaved changes from {new Date(restore.at).toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' })} were found on this device.{' '}
          <button type="button" className="link" onClick={() => { setV(restore.v); setStep(Math.min(restore.step || 0, REVIEW)); setRestore(null) }}>Restore</button> ·{' '}
          <button type="button" className="link" onClick={() => { clearDraft(); setRestore(null) }}>Discard</button></p>
      )}
      <ol className="stepper wf-stepper" aria-label="Steps">
        {steps.map((st, i) => {
          const miss = i < REVIEW ? stepMissing(i).length : comp.missing.length
          const errs = i < REVIEW ? stepErrors(i).length : 0
          const state = errs ? 'err' : miss && showMissing(i) ? 'miss' : checked.has(i) && !miss ? 'done' : ''
          return (
            <li key={st.title} className={`${i === step ? 'on' : ''} ${state}`}>
              <button type="button" onClick={() => go(i)} aria-current={i === step ? 'step' : undefined}
                title={miss ? `${miss} required missing` : undefined}>
                <span>{state === 'done' ? '✓' : state === 'err' || state === 'miss' ? '!' : i + 1}</span>{st.title}
                {state === 'miss' && <em className="wf-badge">{miss}</em>}
              </button>
            </li>
          )
        })}
      </ol>
      <div className="wf-progress" aria-label="Required fields progress">
        <div className="wf-bar"><i style={{ width: `${pct}%` }} /></div>
        <small><strong>{comp.done} of {comp.total}</strong> required done{comp.complete ? ' — profile complete ✓' : ' — you can save as draft and finish later'}{savedAt && ' · draft autosaved on this device'}</small>
      </div>
      <Card title={`${step + 1}. ${steps[step].title}`}>
        {step === 0 && (
          <div className="photo-row">
            <Avatar name={String(v.fullName || '?')} photo={v.photo as string} size={72} />
            <FilePick accept="image/*" facing="environment" allowFlip takeLabel={v.photo ? 'Retake photo' : 'Take photo'} uploadLabel="Upload from device" name="worker-photo"
              onFiles={([f]) => { resizeImage(f).then((photo) => setV((p) => ({ ...p, photo }))).catch(() => setErr('Could not read that image')) }} />
            {!!v.photo && <Btn kind="ghost" onClick={() => setV({ ...v, photo: undefined })}>Remove</Btn>}
          </div>
        )}
        {step === 2 ? (
          <>
            <p className="muted small">Fill what you have now — dates are checked as you type. Renewals and attachments are added later in the worker’s <em>Expiry docs</em> tab.</p>
            <ol className="doc-cards">
              {DOC_CARDS.map(([type, k], n) => (
                <li key={k} className={`doc-card ${docHas(v, k) ? 'has' : ''}`}>
                  <h4><span className="doc-no">{n + 1}.</span> {DOC_SHORT[type]}{(k === 'pp' || (k === 'vp' && docHas(v, 'vp'))) && <span className="req"> *</span>}
                    {k === 'vp' && !docHas(v, 'vp') && <small className="muted"> — required once a permit exists</small>}</h4>
                  <FormGrid fields={docFields(type, k)} value={v} onChange={change} issues={issues} missing={markMissing} />
                </li>
              ))}
            </ol>
          </>
        ) : step === REVIEW ? (
          <div className="wf-review">
            {comp.missing.length > 0 ? (
              <div className="banner amber" role="status">
                <strong>{comp.missing.length} required item{comp.missing.length > 1 ? 's' : ''} missing</strong> — the worker will be saved as <strong>Draft / Incomplete</strong>. Tap to fill:
                <div className="row gap-s wrap mt-s">{comp.missing.map((m) => (
                  <button key={m.key} type="button" className="chip chip-red chip-btn" onClick={() => go(stepOfKey(m.key === 'companyId' ? 'outletId' : m.key))}>{m.label} · {m.step}</button>
                ))}</div>
              </div>
            ) : <p className="banner green small">✓ All {comp.total} required items are filled — the profile will be <strong>Complete</strong>.</p>}
            {Object.values(issues).some((i) => i.level !== 'tip') && (
              <ul className="wf-issues">{Object.entries(issues).filter(([, i]) => i.level !== 'tip').map(([k, i]) => (
                <li key={k} className={i.level}><button type="button" className="link" onClick={() => go(stepOfKey(k))}>{i.level === 'error' ? '⛔' : '⚠️'} {i.msg}</button></li>
              ))}</ul>
            )}
            {reviewBlocks.map((b) => (
              <section key={b.i} className="wf-rv">
                <div className="row"><h4>{b.i + 1}. {steps[b.i].title}</h4><span className="spacer" />
                  {stepMissing(b.i).length > 0 && <span className="chip chip-red">{stepMissing(b.i).length} missing</span>}
                  <button type="button" className="link small ml-s" onClick={() => go(b.i)}>Edit</button></div>
                {b.rows.length ? <dl className="doc-dl">{b.rows.map(([a, c]) => <div key={a}><dt>{a}</dt><dd>{c}</dd></div>)}</dl> : <p className="muted small">Nothing entered yet.</p>}
              </section>
            ))}
          </div>
        ) : (
          <FormGrid fields={steps[step].fields} value={v} onChange={change} issues={issues} missing={markMissing} />
        )}
        {step === 0 && <LanguageFields v={v} setV={setV} required missing={!!markMissing?.has('primaryLanguage') || (editing && !!orig && !orig.primaryLanguage && !v.primaryLanguage)} />}
        {step === 4 && isHr && <RemitEditor list={remit} onChange={(l) => setV((p) => ({ ...p, remittance: l }))} />}
        {warned === step && step < REVIEW && (
          <p className="banner amber small" role="status">{stepMissing(step).length > 0 && `${stepMissing(step).length} required field(s) missing`}{stepMissing(step).length > 0 && stepErrors(step).length > 0 && ' · '}{stepErrors(step).length > 0 && `${stepErrors(step).length} to fix`} — marked in red. You can fill them now or continue and finish later.</p>
        )}
        {err && <p className="err" role="alert">{err}</p>}
      </Card>
      <div className="wf-actions" role="toolbar" aria-label="Form navigation">
        <Btn icon="back" onClick={() => (step > 0 ? go(step - 1) : nav(-1))}>{step > 0 ? 'Back' : 'Cancel'}</Btn>
        <span className="spacer" />
        {editing && step < REVIEW && <Btn onClick={save}>Save</Btn>}
        {step < REVIEW ? <Btn kind="primary" onClick={next}>{warned === step ? 'Continue anyway →' : 'Next →'}</Btn>
          : <Btn kind="primary" icon="check" onClick={save}>{comp.complete ? (editing ? 'Save changes' : 'Submit') : (editing ? 'Save (incomplete)' : 'Save as draft')}</Btn>}
      </div>
    </div>
  )
}
