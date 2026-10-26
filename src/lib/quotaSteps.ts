/* Quota & Recruitment: stages and per-country checklists. Pure (no imports) so it is unit-tested directly.
   India is the default and most detailed: ECR passports go through eMigrate (RA demand, registration, PBBY,
   emigration clearance / POE); ECNR passports skip those steps. The database enforces the ECR flight gate too. */
export const DEFAULT_COUNTRY = 'India'
export interface RecruitLike { country: string; ecr: 'ECR' | 'ECNR' | null; steps: Record<string, { done?: boolean; date?: string | null; at?: string | null } | undefined> | null; created_at?: string; status?: string }

export const STAGES: { key: string; label: string }[] = [
  { key: 'sourcing', label: 'Sourcing' }, { key: 'interview', label: 'Interview / selection' }, { key: 'offer', label: 'Offer & contract' },
  { key: 'passport', label: 'Passport & documents' }, { key: 'medical', label: 'Medical' }, { key: 'vdr', label: 'Calling visa (VDR)' },
  { key: 'clearance', label: 'Home-country clearance' }, { key: 'travel', label: 'Travel' }, { key: 'arrival', label: 'Arrived' },
  { key: 'onboarding', label: 'FOMEMA / PLKS / onboarding' }, { key: 'ready', label: 'Ready to convert' },
]
export const stageLabel = (k: string) => STAGES.find((s) => s.key === k)?.label || (k === 'converted' ? 'Converted to worker' : k)
export interface CStep { key: string; label: string; stage: string; hint?: string; ecr?: boolean; gate?: boolean }
const COMMON_PRE: CStep[] = [
  { key: 'selected', label: 'Candidate selected (agent CV / interview)', stage: 'interview' },
  { key: 'trade_test', label: 'Trade test / skills check passed', stage: 'interview' },
  { key: 'offer', label: 'Offer & employment contract signed (worker\'s language)', stage: 'offer', hint: 'Zero-cost: the worker pays no recruitment fee. Keep the signed contract in the documents.' },
  { key: 'passport_ok', label: 'Passport valid ≥ 18 months, copy on file', stage: 'passport', hint: 'Malaysia needs enough passport validity to cover the PLKS. Renew before applying if short.' },
  { key: 'pre_medical', label: 'Pre-departure medical at an approved clinic — fit', stage: 'medical' },
  { key: 'quota_use', label: 'Quota Use Request approved by CEO', stage: 'vdr', gate: true, hint: 'Raised in Approvals. GM then CEO approve; CEO alone is enough. The database blocks the VDR until this is done.' },
  { key: 'vdr_apply', label: 'Calling visa (VDR) applied in FWCMS', stage: 'vdr', gate: true, hint: 'Uses 1 quota slot. Levy, bond / insurance guarantee and FWCMS fees paid first.' },
  { key: 'vdr_ok', label: 'Calling visa (VDR) approved — copy uploaded', stage: 'vdr', hint: 'Upload the approval copy on the recruit page. The assigned agent downloads it from the agent portal (audited).' },
  { key: 'vdr_sent', label: 'Calling visa copy sent to the agent', stage: 'vdr', hint: 'Ticked automatically when the copy is uploaded and the batch has an agent.' },
]
const VISA_STAMP: CStep = { key: 'visa_stamp', label: 'Visa stamped at the Malaysian mission / VFS', stage: 'clearance', hint: 'Passport endorsed with the Visa with Reference (VDR) at the Malaysian High Commission / VFS centre in the home country.' }
const COMMON_POST: CStep[] = [
  { key: 'ticket', label: 'Flight booked (company pays)', stage: 'travel' },
  { key: 'airport_letter', label: 'Airport authorisation letter issued', stage: 'travel', hint: 'A4 letter for the pickup person and the airport desk — print it from the recruit page.' },
  { key: 'hostel_ready', label: 'Hostel bed confirmed (Act 446 capacity)', stage: 'travel' },
  { key: 'arrived', label: 'Arrived — passport stamped at the airport', stage: 'arrival' },
  { key: 'fomema', label: 'FOMEMA medical within 30 days of arrival — fit', stage: 'onboarding', hint: 'If unfit: Check Out Memo and send home within the time Immigration gives. Keep the CMO copy on file.' },
  { key: 'plks', label: 'PLKS (work permit) endorsed', stage: 'onboarding' },
  { key: 'spikpa', label: 'SPIKPA hospitalisation insurance active', stage: 'onboarding' },
  { key: 'socso', label: 'SOCSO registered', stage: 'onboarding' },
  { key: 'epf', label: 'EPF registered', stage: 'onboarding', hint: 'EPF for non-citizen employees (2% employer + 2% employee) — check the rate in force.' },
  { key: 'sim', label: 'SIM card given', stage: 'onboarding' },
  { key: 'bank', label: 'Bank account opened (salary by bank transfer)', stage: 'onboarding' },
  { key: 'induction', label: 'Induction, rules & grievance channel explained', stage: 'ready' },
]
export const COUNTRY_STEPS: Record<string, CStep[]> = {
  India: [
    { key: 'ra_check', label: 'Recruiting Agent licensed (MEA eMigrate RA number)', stage: 'sourcing', hint: 'Check the RA licence number on emigrate.gov.in before sharing any demand.' },
    ...COMMON_PRE,
    { key: 'ecr_check', label: 'Passport type confirmed: ECR or ECNR', stage: 'clearance', hint: 'Look at the passport\'s ECR stamp / “Emigration Check Required”. ECR adds the eMigrate steps below; ECNR skips them. Set it on the recruit — the database will not book a flight without it.' },
    { key: 'demand_letter', label: 'RA demand letter & power of attorney attested by the Indian mission in KL', stage: 'clearance', ecr: true, hint: 'ECR only. Needed for the demand registration in eMigrate.' },
    { key: 'emigrate_reg', label: 'Employer, demand & contract registered in eMigrate', stage: 'clearance', ecr: true, hint: 'ECR only. The RA uploads the demand; the employer is registered as foreign employer.' },
    { key: 'pbby', label: 'PBBY insurance (Pravasi Bhartiya Bima Yojana)', stage: 'clearance', ecr: true, hint: 'Compulsory for ECR before emigration clearance.' },
    { key: 'emig_clear', label: 'Emigration clearance (POE) granted in eMigrate', stage: 'clearance', ecr: true, hint: 'ECR passports cannot leave India for work without it — the database blocks the flight until it is ticked.' },
    { key: 'pdot', label: 'Pre-departure orientation (PDOT)', stage: 'clearance', hint: 'Compulsory for ECR; recommended for ECNR.' },
    VISA_STAMP,
    ...COMMON_POST,
  ],
  Nepal: [
    { key: 'ra_check', label: 'Recruiting agency licensed by DoFE', stage: 'sourcing' },
    ...COMMON_PRE,
    { key: 'demand_attest', label: 'Demand letter & POA attested by Nepal Embassy KL', stage: 'clearance' },
    { key: 'dofe_pre', label: 'DoFE pre-approval', stage: 'clearance' },
    { key: 'orientation', label: 'Pre-departure orientation', stage: 'clearance' },
    { key: 'insurance_np', label: 'Insurance + Foreign Employment Welfare Fund paid', stage: 'clearance' },
    { key: 'labour_permit', label: 'DoFE labour permit (final approval / sticker)', stage: 'clearance', hint: 'Nepal–Malaysia MoU: employer pays recruitment fee, visa, ticket, medical and security screening.' },
    VISA_STAMP,
    ...COMMON_POST,
  ],
  Bangladesh: [
    { key: 'ra_check', label: 'Recruiting agency on the approved list', stage: 'sourcing', hint: 'Malaysia stopped new Bangladeshi intake under the old approvals on 31 May 2024 — check the current KDN position before starting.' },
    ...COMMON_PRE,
    { key: 'attest_bd', label: 'Demand letter attested by Bangladesh High Commission KL', stage: 'clearance' },
    { key: 'bmet', label: 'BMET registration & emigration clearance (smart card)', stage: 'clearance' },
    { key: 'welfare_bd', label: 'Welfare fund & insurance (Wage Earners\' Welfare Board)', stage: 'clearance' },
    VISA_STAMP,
    ...COMMON_POST,
  ],
  Myanmar: [...COMMON_PRE, { key: 'owic', label: 'Overseas Worker Identification Card (OWIC) / labour clearance', stage: 'clearance' }, VISA_STAMP, ...COMMON_POST],
  Indonesia: [...COMMON_PRE, { key: 'bp2mi', label: 'BP2MI / SISKOP2MI registration & E-KTKLN', stage: 'clearance', hint: 'Recruit through a licensed P3MI agency; check the One Channel System rules for the sector.' }, VISA_STAMP, ...COMMON_POST],
  'Sri Lanka': [...COMMON_PRE, { key: 'slbfe', label: 'SLBFE registration & insurance', stage: 'clearance' }, VISA_STAMP, ...COMMON_POST],
  Pakistan: [...COMMON_PRE, { key: 'beoe', label: 'BE&OE Protector of Emigrants stamp + OEC / insurance', stage: 'clearance' }, VISA_STAMP, ...COMMON_POST],
}
export const COUNTRIES = Object.keys(COUNTRY_STEPS)
export const stepsFor = (country: string, ecr?: string | null, templates?: Record<string, unknown>): CStep[] => {
  const over = templates?.[country] as CStep[] | undefined
  const base = Array.isArray(over) && over.length ? over : COUNTRY_STEPS[country] || [...COMMON_PRE, VISA_STAMP, ...COMMON_POST]
  return base.filter((s) => !(s.ecr && country === 'India' && ecr === 'ECNR'))
}
export const progress = (r: RecruitLike, templates?: Record<string, unknown>) => {
  const st = stepsFor(r.country, r.ecr, templates)
  const done = st.filter((s) => r.steps?.[s.key]?.done).length
  return { done, total: st.length, pct: st.length ? Math.round((done / st.length) * 100) : 0 }
}
/** where a recruit stands: the stage of the first open step */
export const nextStep = (r: RecruitLike, templates?: Record<string, unknown>) => stepsFor(r.country, r.ecr, templates).find((s) => !r.steps?.[s.key]?.done)


/** days since the last recorded step (or since the recruit was added) — "days in this stage" */
export const daysInStage = (r: RecruitLike, today = new Date()) => {
  const ts = Object.values(r.steps || {}).filter((v) => v?.done).map((v) => v?.at || v?.date || '').filter(Boolean).map((x) => new Date(x as string).getTime())
  const last = ts.length ? Math.max(...ts) : r.created_at ? new Date(r.created_at).getTime() : today.getTime()
  return Math.max(0, Math.floor((today.getTime() - last) / 86400000))
}
/** where an approved slot is now: the next open step, or 'Arrived' when travel is done */
export const slotWhere = (r: RecruitLike, templates?: Record<string, unknown>) => {
  const n = nextStep(r, templates)
  return n ? { stage: n.stage, step: n.label, key: n.key } : { stage: 'ready', step: 'All steps done', key: '' }
}
