/* Quota & Recruitment: the recruitment pipeline, read from the versioned "pipeline" rule (Rules & regulations).
   Pure (no imports) so it is unit-tested directly. Each recruit is pinned to the template version in force when he was
   added (template_id), so a change to the template never moves recruits already in progress. The database enforces the
   same order and documents (qr_pipeline_gate); this module only mirrors it for the screens. */
export const DEFAULT_COUNTRY = 'India'
export interface TplStep { key: string; label: string; req?: boolean; ecr?: 'ECR' | 'ECNR'; requires?: string[]; hint?: string; retired?: boolean }
export interface TplStage { key: string; label: string; owner?: 'hr' | 'gm_ceo' | 'agent' | 'outlet_manager' | string; docs?: string[]; gate?: string; task?: string; skip_label?: string; retired?: boolean; steps: TplStep[] }
export interface Template { use_step: string; stages: TplStage[] }
export interface StepVal { done?: boolean; date?: string | null; at?: string | null; ref?: string; note?: string; override?: boolean; by_name?: string }
export interface RecruitLike {
  country: string; ecr: 'ECR' | 'ECNR' | null; steps: Record<string, StepVal | undefined> | null; created_at?: string; status?: string; stage_at?: string | null
  template_id?: string | null
}
export interface Ctx { quotaApproved?: boolean; agentDocs?: string[] }

const st = (key: string, label: string, steps: TplStep[], extra: Partial<TplStage> = {}): TplStage => ({ key, label, steps, ...extra })
/** used only if the rules could not be loaded (offline first start); the database template is the source of truth */
export const DEFAULT_TEMPLATE: Template = {
  use_step: 'vdr_ok',
  stages: [
    st('quota', 'Quota approval', [{ key: '_quota', label: 'Quota Use Request approved' }], { owner: 'gm_ceo' }),
    st('recruit', 'Overseas recruitment', [{ key: 'ra_check', label: 'Agent licence checked', req: false }, { key: 'selected', label: 'Selected at interview' }, { key: 'trade_test', label: 'Trade test', req: false }, { key: 'offer', label: 'Offer accepted' }], { owner: 'hr' }),
    st('medical', 'Medical overseas', [{ key: 'medical', label: 'Medical done', requires: ['medical_result', 'medical_file|agent:medical'] }], { owner: 'agent' }),
    st('med_gate', 'Medical gate (Fit)', [{ key: 'med_fit', label: 'Medically fit', requires: ['medical_result=fit'] }], { owner: 'hr' }),
    st('vdr', 'Calling visa (VDR) application', [{ key: 'vdr_apply', label: 'VDR applied' }], { owner: 'hr' }),
    st('vdr_gate', 'Calling visa approved', [{ key: 'vdr_ok', label: 'VDR approved', requires: ['vdr_file'] }], { owner: 'hr' }),
    st('sent', 'Sent to India (agent)', [{ key: 'vdr_sent', label: 'VDR downloaded by the agent', requires: ['vdr_file'] }], { owner: 'agent' }),
    st('stamping', 'Visa stamping', [{ key: 'visa_stamp', label: 'Visa stamped', requires: ['stamped_file'] }], { owner: 'agent' }),
    st('emigration', 'India emigration (eMigrate)', [{ key: '_ecr', label: 'Passport type (ECR / ECNR) recorded' },
      { key: 'emigrate_employer', label: 'Employer eMigrate registration', ecr: 'ECR' }, { key: 'agent_poa', label: 'Agent power of attorney and worker count', ecr: 'ECR' },
      { key: 'emigrate_reg', label: 'eMigrate demand raised', ecr: 'ECR' }, { key: 'contract_attest', label: 'Employment contract attested', ecr: 'ECR' },
      { key: 'pbby', label: 'PBBY insurance', ecr: 'ECR' }, { key: 'emig_clear', label: 'Protector of Emigrants clearance', ecr: 'ECR' },
      { key: 'pdot', label: 'Pre-departure orientation (PDOT)', req: false }], { owner: 'agent', skip_label: 'Not required (ECNR)' }),
    st('ticket', 'Air ticket', [{ key: 'ticket', label: 'Ticket booked', requires: ['flight_no', 'flight_at', 'arrival_eta', 'ticket_file'] }], { owner: 'hr' }),
    st('departure', 'Departure', [{ key: 'departed', label: 'Departed', requires: ['flight_at'] }], { owner: 'agent' }),
    st('klia', 'KLIA airport clearance', [{ key: 'klia', label: 'Cleared at KLIA by the employer', requires: ['klia_person'] }], { owner: 'hr' }),
    st('pickup', 'Airport pickup', [{ key: 'pickup', label: 'Picked up', requires: ['pickup_by', 'transport'] }], { owner: 'hr' }),
    st('hq', 'Arrival at HQ', [{ key: 'arrived_hq', label: 'Arrived at HQ', requires: ['arrived_at'] }], { owner: 'hr' }),
    st('hr_brief', 'HR brief', [{ key: 'hr_brief', label: 'HR brief done', requires: ['hr_ack_file'] }], { owner: 'hr' }),
    st('om_brief', 'Outlet manager brief', [{ key: 'om_brief', label: 'Outlet manager confirmed', requires: ['outlet_id'] }], { owner: 'outlet_manager' }),
    st('onboard', 'Onboard', [{ key: 'onboard', label: 'Worker record created' }], { owner: 'hr' }),
  ],
}

export const isReq = (s: TplStep) => s.req !== false
/** live stages of a template (retired stages stay on older versions only) */
export const liveStages = (t: Template) => t.stages.filter((s) => !s.retired)
/** the steps that apply to this passport type, in order, with their stage */
export function stepsOf(t: Template, ecr: string | null | undefined): (TplStep & { stage: string; stageLabel: string; idx: number })[] {
  const out: (TplStep & { stage: string; stageLabel: string; idx: number })[] = []
  liveStages(t).forEach((s, i) => s.steps.filter((x) => !x.retired && (!x.ecr || x.ecr === ecr)).forEach((x) => out.push({ ...x, stage: s.key, stageLabel: s.label, idx: i })))
  return out
}
/** one requirement token: col | col=value | agent:<kind> | a|b (any of) */
export function reqOk(r: RecruitLike, tok: string, c: Ctx = {}): boolean {
  return tok.split('|').some((t) => {
    if (t.startsWith('agent:')) return !!c.agentDocs?.includes(t.slice(6))
    if (t.includes('=')) { const [k, v] = t.split('='); return String((r as unknown as Record<string, unknown>)[k] ?? '') === v }
    const v = (r as unknown as Record<string, unknown>)[t]; return v !== null && v !== undefined && v !== ''
  })
}
export function stepDone(r: RecruitLike, key: string, c: Ctx = {}): boolean {
  if (key === '_quota') return !!c.quotaApproved
  if (key === '_ecr') return !!r.ecr
  return !!r.steps?.[key]?.done
}
/** stage key where the recruit stands (first stage with an open required step) */
export function stageOf(r: RecruitLike, t: Template, c: Ctx = {}): string {
  if (r.status === 'converted') return 'converted'
  const open = stepsOf(t, r.ecr).find((x) => isReq(x) && !stepDone(r, x.key, c))
  return open ? open.stage : liveStages(t)[liveStages(t).length - 1]?.key || 'onboard'
}
export const nextStep = (r: RecruitLike, t: Template, c: Ctx = {}) => stepsOf(t, r.ecr).find((x) => isReq(x) && !stepDone(r, x.key, c))
export function progress(r: RecruitLike, t: Template, c: Ctx = {}) {
  const list = stepsOf(t, r.ecr).filter(isReq)
  const done = list.filter((x) => stepDone(r, x.key, c)).length
  return { done, total: list.length, pct: list.length ? Math.round((done / list.length) * 100) : 0 }
}
/** a stage that is all-optional for this passport type (India ECNR emigration) shows its skip label */
export function stageSkipped(t: Template, stageKey: string, ecr: string | null | undefined) {
  const s = t.stages.find((x) => x.key === stageKey)
  if (!s || !s.skip_label || !ecr) return null
  const real = s.steps.filter((x) => !x.retired && !x.key.startsWith('_') && isReq(x) && (!x.ecr || x.ecr === ecr))
  return real.length ? null : s.skip_label
}
export const stageLabelIn = (t: Template | null | undefined, k: string) => (k === 'converted' ? 'Onboarded (worker)' : t?.stages.find((s) => s.key === k)?.label || DEFAULT_TEMPLATE.stages.find((s) => s.key === k)?.label || k)
/** fields the user must fill to complete a step (requirements not yet met; "a|b" asks for the first) */
export function missingFor(r: RecruitLike, s: TplStep, c: Ctx = {}) {
  return (s.requires || []).filter((tok) => !reqOk(r, tok, c)).map((tok) => tok.split('|')[0])
}
/** days in the current stage (stage_at from the server, else the last step, else when added) */
export function daysInStage(r: RecruitLike, today = new Date()) {
  let last = r.stage_at ? new Date(r.stage_at).getTime() : NaN
  if (Number.isNaN(last)) {
    const ts = Object.values(r.steps || {}).filter((v) => v?.done).map((v) => v?.at || v?.date || '').filter(Boolean).map((x) => new Date(x as string).getTime())
    last = ts.length ? Math.max(...ts) : r.created_at ? new Date(r.created_at).getTime() : today.getTime()
  }
  return Math.max(0, Math.floor((today.getTime() - last) / 86400000))
}
/** stage counts for a list of recruits; template looked up per recruit */
export function stageCounts(rs: RecruitLike[], tplOf: (r: RecruitLike) => Template, ctxOf: (r: RecruitLike) => Ctx = () => ({})) {
  const m: Record<string, number> = {}
  for (const r of rs) { const k = stageOf(r, tplOf(r), ctxOf(r)); m[k] = (m[k] || 0) + 1 }
  return m
}
/** is the quota slot used for this recruit (the template's use step done) */
export const slotUsed = (r: RecruitLike, t: Template) => !!r.steps?.[t.use_step]?.done
