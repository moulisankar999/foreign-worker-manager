/* Quota & Recruitment (v1.4 draft): data access, country checklists, cost categories, helpers.
 * Server: migration 034 (tables qr_*, read-only RLS by company scope, every write through audited RPCs). */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { supabase } from './supabase'
import { daysUntil, todayISO } from './util'
import type { Role } from './supabase'

/* ---------------- rows ---------------- */
export interface QFile { id: string; company_id: string; kind: string; path: string; name: string | null; mime: string | null; size: number | null; sha256: string; uploaded_by_name: string | null; uploaded_at: string }
export interface Quota {
  id: string; company_id: string; ref_no: string; kind: 'new' | 'replacement' | 'transfer'; approval_date: string; expiry_date: string | null
  sector: string | null; subsector: string | null; job_title: string | null; breakdown: Record<string, number>; conditions: string | null; levy_note: string | null; notes: string | null
  section60k_ref: string | null; section60k_expiry: string | null; letter_file: string | null; status: 'pending' | 'active' | 'rejected' | 'closed'
  extensions: { from: string; to: string; ref: string; at: string; by: string }[]; claim_id: string | null
  created_by: string; created_by_name: string | null; created_at: string; opened_by_name: string | null; opened_at: string | null
}
export interface Entry {
  id: number; at: string; company_id: string; quota_id: string; country: string; kind: string; qty: number
  d_avail: number; d_resv: number; d_used: number; d_elig: number; d_claim: number; d_repl: number; d_lapsed: number; d_cmo: number; d_other: number; d_run: number
  use_request_id: string | null; recruit_id: string | null; exit_id: string | null; runaway_id: string | null; claim_id: string | null; reverses: number | null
  ref: string | null; note: string | null; by_id: string | null; by_name: string | null; by_role: string | null
}
export interface TimelineItem { at: string; by: string; role: string; action: string; note?: string | null }
export interface UseReq {
  id: string; ref_no: number; company_id: string; quota_id: string; country: string; slots: number; batch_id: string | null; recruit_ids: string[]; purpose: string
  est_cost_rm: number | null; files: string[]; status: 'pending' | 'gm_approved' | 'approved' | 'returned' | 'rejected' | 'cancelled'
  requested_by: string; requested_by_name: string | null; requested_by_role: string | null; requested_at: string
  gm_by: string | null; gm_by_name: string | null; gm_at: string | null; gm_note: string | null
  ceo_by: string | null; ceo_by_name: string | null; ceo_at: string | null; ceo_note: string | null; gm_skipped: boolean
  closed_by_name: string | null; closed_role: string | null; closed_at: string | null; close_note: string | null; timeline: TimelineItem[]
}
export interface Batch {
  id: string; company_id: string; quota_id: string | null; country: string; title: string; agent_name: string | null; agent_licence: string | null; ra_name: string | null
  target_count: number; outlet_id: string | null; hostel_id: string | null; expected_arrival: string | null; budget: Record<string, number>; budget_total: number
  status: 'open' | 'closed'; notes: string | null; created_by_name: string | null; created_at: string
}
export interface StepVal { done?: boolean; date?: string; ref?: string; note?: string }
export interface Recruit {
  id: string; company_id: string; batch_id: string | null; use_request_id: string | null; country: string; full_name: string; passport_no: string | null; passport_expiry: string | null
  ecr: 'ECR' | 'ECNR' | null; dob: string | null; gender: string | null; job: string | null; phone: string | null; stage: string; steps: Record<string, StepVal>
  vdr_no: string | null; vdr_applied: string | null; vdr_approved: string | null; vdr_expiry: string | null; flight_no: string | null; flight_at: string | null; airport: string | null
  pickup_by: string | null; transport: string | null; arrived_at: string | null; hostel_id: string | null; outlet_id: string | null; owner_id: string | null
  status: 'active' | 'dropped' | 'converted'; drop_reason: string | null; worker_id: string | null; created_at: string; updated_at: string
}
export interface QEvent { id: number; at: string; company_id: string; recruit_id: string | null; batch_id: string | null; use_request_id: string | null; exit_id: string | null; runaway_id: string | null; claim_id: string | null; action: string; note: string | null; by_name: string | null; by_role: string | null }
export interface Payment {
  id: string; company_id: string; quota_id: string | null; batch_id: string | null; recruit_id: string | null; country: string | null; category: string; amount_rm: number; paid_on: string
  payee: string | null; method: string | null; ref: string | null; note: string | null; receipt_file: string | null; status: 'recorded' | 'pending_check' | 'verified' | 'void'
  created_by: string; created_by_name: string | null; checked_by_name: string | null; checked_at: string | null; void_by_name: string | null; void_reason: string | null
}
export interface Exit {
  id: string; company_id: string; quota_id: string | null; country: string | null; worker_id: string | null; worker_no: string | null; worker_name: string; passport_no: string | null; permit_no: string | null
  kind: 'cmo' | 'death' | 'transfer'; cmo_ref: string | null; cmo_date: string | null; exit_reason: string | null; departure_date: string | null; flight_no: string | null; file_id: string | null
  status: 'eligible' | 'claimed' | 'replaced' | 'not_eligible' | 'void'; claim_id: string | null; void_reason: string | null; created_by: string; created_by_name: string | null; created_at: string
}
export interface Runaway {
  id: string; company_id: string; quota_id: string | null; country: string | null; worker_id: string | null; worker_no: string | null; worker_name: string; passport_no: string | null; permit_no: string | null
  last_seen: string; flagged_at: string; reported_by_name: string | null; reported_at: string | null; police_report_no: string | null; police_report_date: string | null; police_file: string | null
  imm_ref: string | null; imm_date: string | null; imm_file: string | null; permit_cancel: 'pending' | 'applied' | 'cancelled'; bond_rm: number | null
  bond_status: 'to_be_forfeited' | 'forfeited' | 'sita_paid' | 'released'; sita_rm: number | null; levy_note: string | null; wages_owed_rm: number | null; money_owed_note: string | null
  followups: { at: string; by: string; note: string }[]; outcome: 'open' | 'found' | 'returned' | 'closed'; outcome_date: string | null; outcome_note: string | null; created_at: string
}
export interface Claim {
  id: string; ref_no: number; company_id: string; title: string; announcement: string | null; notes: string | null; status: 'draft' | 'submitted' | 'approved' | 'partly_approved' | 'rejected'
  submitted_at: string | null; gov_ref: string | null; decided_on: string | null; approved_count: number | null; new_quota_id: string | null; pack_file: string | null
  created_by: string; created_by_name: string | null; created_at: string; decided_by_name: string | null
}
export interface ClaimItem { claim_id: string; exit_id: string; released: boolean; approved: boolean | null }
export interface Rules { cmo_missing_days: number; runaway_report_days: number; expiry_amber_days: number; expiry_red_days: number; util_amber_pct: number; payment_check_rm: number; templates: Record<string, unknown> }
export interface Tally {
  company_id: string; quota_id: string; ref_no: string; kind: string; expiry_date: string | null; status: string; country: string
  approved: number; available: number; reserved: number; used: number; lapsed: number; active_workers: number; in_pipeline: number
  exited_cmo: number; exited_other: number; runaways: number; exited_unrecorded: number; repl_eligible: number; repl_applied: number; repl_approved: number; mismatch: number
}
export interface QData {
  loaded: boolean; error?: string
  quotas: Quota[]; ledger: Entry[]; requests: UseReq[]; batches: Batch[]; recruits: Recruit[]; events: QEvent[]; payments: Payment[]
  exits: Exit[]; runaways: Runaway[]; claims: Claim[]; claimItems: ClaimItem[]; files: QFile[]; tally: Tally[]; rules: Rules
}
export const DEFAULT_RULES: Rules = { cmo_missing_days: 14, runaway_report_days: 14, expiry_amber_days: 90, expiry_red_days: 30, util_amber_pct: 80, payment_check_rm: 5000, templates: {} }
const EMPTY: QData = { loaded: false, quotas: [], ledger: [], requests: [], batches: [], recruits: [], events: [], payments: [], exits: [], runaways: [], claims: [], claimItems: [], files: [], tally: [], rules: DEFAULT_RULES }

/* ---------------- store ---------------- */
let state: QData = EMPTY
let loading: Promise<void> | null = null
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())
async function all<T>(table: string, order = 'created_at'): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select('*').order(order, { ascending: false }).range(from, from + 999)
    if (error) throw error
    out.push(...((data || []) as T[]))
    if (!data || data.length < 1000) return out
  }
}
export function reloadQuota(): Promise<void> {
  if (loading) return loading
  loading = (async () => {
    try {
      const [quotas, ledger, requests, batches, recruits, events, payments, exits, runaways, claims, claimItems, files, tally, rules] = await Promise.all([
        all<Quota>('qr_quotas'), all<Entry>('qr_ledger', 'id'), all<UseReq>('qr_use_requests', 'requested_at'), all<Batch>('qr_batches'), all<Recruit>('qr_recruits'),
        all<QEvent>('qr_events', 'id'), all<Payment>('qr_payments'), all<Exit>('qr_exits'), all<Runaway>('qr_runaways'), all<Claim>('qr_claims'),
        supabase.from('qr_claim_items').select('*').then((r) => { if (r.error) throw r.error; return (r.data || []) as ClaimItem[] }),
        all<QFile>('qr_files', 'uploaded_at'),
        supabase.rpc('qr_tally', { p_company: null }).then((r) => { if (r.error) throw r.error; return (r.data || []) as Tally[] }),
        supabase.from('qr_rules').select('*').maybeSingle().then((r) => (r.data as Rules) || DEFAULT_RULES),
      ])
      state = { loaded: true, quotas, ledger, requests, batches, recruits, events, payments, exits, runaways, claims, claimItems, files, tally, rules }
    } catch (e) {
      state = { ...state, loaded: true, error: (e as Error).message }
    } finally { loading = null; emit() }
  })()
  return loading
}
export function useQuota(): QData & { reload: () => Promise<void> } {
  const s = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f) }, () => state)
  useEffect(() => { if (!state.loaded) void reloadQuota() }, [])
  return { ...s, reload: reloadQuota }
}

/** call an RPC, then reload. Throws a readable message. */
export async function qcall<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message.replace(/^.*?ERROR:\s*/, ''))
  await reloadQuota()
  return data as T
}

/* ---------------- files: SHA-256, private bucket, permanent ---------------- */
export const QUOTA_BUCKET = 'quota-docs'
export async function sha256(buf: ArrayBuffer) {
  const h = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
export async function uploadQuotaFile(company: string, kind: string, file: File | Blob, name = 'file.pdf'): Promise<string> {
  if (file.size > 15 * 1024 * 1024) throw new Error('File is larger than 15 MB.')
  const buf = await file.arrayBuffer()
  const hash = await sha256(buf)
  const safe = (('name' in file && (file as File).name) || name).replace(/[^\w.-]+/g, '_').slice(-80)
  const path = `${company}/${kind}/${crypto.randomUUID()}-${safe}`
  const mime = file.type || 'application/octet-stream'
  const up = await supabase.storage.from(QUOTA_BUCKET).upload(path, file, { contentType: mime, upsert: false })
  if (up.error) throw new Error(up.error.message)
  const { data, error } = await supabase.rpc('qr_add_file', { p_company: company, p_kind: kind, p_path: path, p_name: safe, p_mime: mime, p_size: file.size, p_sha256: hash })
  if (error) throw new Error(error.message)
  return data as string
}
export async function fileUrl(f: QFile, download = false) {
  const { data, error } = await supabase.storage.from(QUOTA_BUCKET).createSignedUrl(f.path, 300, download ? { download: f.name || true } : undefined)
  if (error) throw new Error(error.message)
  return data.signedUrl
}
export async function fileBytes(f: QFile): Promise<{ bytes: ArrayBuffer; ok: boolean }> {
  const { data, error } = await supabase.storage.from(QUOTA_BUCKET).download(f.path)
  if (error || !data) throw new Error(error?.message || 'Download failed')
  const bytes = await data.arrayBuffer()
  return { bytes, ok: (await sha256(bytes)) === f.sha256 }
}

/* ---------------- roles ---------------- */
export const qRank = (r?: Role | string | null) => ({ super_admin: 4, admin: 4, general_manager: 3, hr_admin: 2, hr_manager: 1, manager: 1 } as Record<string, number>)[r || ''] || 0
const RANK_OF_LABEL: Record<string, number> = { CEO: 4, 'General Manager': 3, 'HR Admin': 2, 'HR Manager': 1 }
/** lower roles see a superior's role, not the person's name */
export const whoLabel = (name: string | null | undefined, role: string | null | undefined, myRank: number) =>
  role && (RANK_OF_LABEL[role] || 0) > myRank ? role : [name, role && role !== name ? `(${role})` : ''].filter(Boolean).join(' ')

/* ---------------- labels ---------------- */
export const UR_STATUS: Record<UseReq['status'], { label: string; tone: string }> = {
  pending: { label: 'Waiting for GM / CEO', tone: 'amber' }, gm_approved: { label: 'GM approved — waiting for CEO', tone: 'blue' },
  approved: { label: 'Approved', tone: 'green' }, returned: { label: 'Returned for changes', tone: 'orange' }, rejected: { label: 'Rejected', tone: 'red' }, cancelled: { label: 'Cancelled', tone: 'gray' },
}
export const ENTRY_LABEL: Record<string, string> = {
  approved: 'Approved (letter)', reserve: 'Reserved (use request)', release: 'Released', use: 'Used (calling visa)', use_existing: 'Used (existing worker)', return: 'Returned to balance',
  expire: 'Expired / lapsed', transfer_out: 'Transferred out', transfer_in: 'Transferred in', adjust_up: 'Adjustment +', adjust_down: 'Adjustment −',
  exit_cmo: 'Exited via CMO — replacement-eligible', exit_other: 'Exited (death / transfer)', exit_other_elig: 'Death — replacement-eligible', exit_void: 'Exit record voided',
  runaway: 'Runaway (no CMO)', runaway_void: 'Runaway found / returned', claim_submit: 'Put in replacement claim', claim_release: 'Claim released', claim_approved: 'Replacement approved', reversal: 'Reversal',
}
export const EXIT_KIND: Record<Exit['kind'], string> = { cmo: 'Check Out Memo (CMO)', death: 'Death', transfer: 'Transfer to another employer' }
export const EXIT_STATUS: Record<Exit['status'], { label: string; tone: string }> = {
  eligible: { label: 'Replacement-eligible', tone: 'green' }, claimed: { label: 'In a claim', tone: 'blue' }, replaced: { label: 'Replaced', tone: 'gray' },
  not_eligible: { label: 'Not replaceable', tone: 'gray' }, void: { label: 'Void', tone: 'red' },
}
export const CLAIM_STATUS: Record<Claim['status'], { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: 'gray' }, submitted: { label: 'Submitted', tone: 'blue' }, approved: { label: 'Approved', tone: 'green' }, partly_approved: { label: 'Partly approved', tone: 'amber' }, rejected: { label: 'Rejected', tone: 'red' },
}
export const RUN_OUTCOME: Record<Runaway['outcome'], { label: string; tone: string }> = { open: { label: 'Open', tone: 'red' }, found: { label: 'Found', tone: 'blue' }, returned: { label: 'Returned to work', tone: 'green' }, closed: { label: 'Closed', tone: 'gray' } }

/* ---------------- payments ---------------- */
export const PAY_CATS: { key: string; label: string; workerCost: string; stage: 'quota' | 'source' | 'malaysia' }[] = [
  { key: 'levy', label: 'Levy (Jabatan Tenaga Kerja / Immigration)', workerCost: 'Levy', stage: 'quota' },
  { key: 'bond', label: 'Security bond / insurance guarantee', workerCost: 'Security bond', stage: 'quota' },
  { key: 'processing', label: 'FWCMS / Immigration processing', workerCost: 'Recruitment / processing fee', stage: 'quota' },
  { key: 'vdr', label: 'VDR / calling visa fee', workerCost: 'Visa / VDR', stage: 'quota' },
  { key: 'attestation', label: 'Document attestation (embassy / mission)', workerCost: 'Recruitment / processing fee', stage: 'source' },
  { key: 'agent_fee', label: 'Source-country agent fee', workerCost: 'Agent fee', stage: 'source' },
  { key: 'agent_my', label: 'Malaysian agency fee', workerCost: 'Agent fee', stage: 'quota' },
  { key: 'medical', label: 'Pre-departure medical', workerCost: 'Recruitment / processing fee', stage: 'source' },
  { key: 'emigrate', label: 'India eMigrate / PBBY insurance', workerCost: 'Recruitment / processing fee', stage: 'source' },
  { key: 'dofe', label: 'Nepal DoFE labour permit / welfare fund', workerCost: 'Recruitment / processing fee', stage: 'source' },
  { key: 'clearance', label: 'Other source-country clearance (BMET, BP2MI, SLBFE, BE&OE, OWIC)', workerCost: 'Recruitment / processing fee', stage: 'source' },
  { key: 'ticket', label: 'Flight ticket', workerCost: 'Flight ticket', stage: 'source' },
  { key: 'transport', label: 'Airport pickup / transport', workerCost: 'Other', stage: 'malaysia' },
  { key: 'fomema', label: 'FOMEMA medical', workerCost: 'FOMEMA', stage: 'malaysia' },
  { key: 'plks', label: 'PLKS / work permit', workerCost: 'Work permit (PLKS)', stage: 'malaysia' },
  { key: 'spikpa', label: 'SPIKPA / hospitalisation insurance', workerCost: 'Insurance (SPIKPA / hospitalisation)', stage: 'malaysia' },
  { key: 'socso', label: 'SOCSO registration', workerCost: 'Other', stage: 'malaysia' },
  { key: 'accommodation', label: 'Accommodation set-up', workerCost: 'Other', stage: 'malaysia' },
  { key: 'sim_bank', label: 'SIM card / bank account', workerCost: 'Other', stage: 'malaysia' },
  { key: 'other', label: 'Other', workerCost: 'Other', stage: 'malaysia' },
]
export const payLabel = (k: string) => PAY_CATS.find((c) => c.key === k)?.label || k

/* ---------------- pipeline: stages + country checklists ---------------- */
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
  { key: 'vdr_ok', label: 'Calling visa approved / visa issued', stage: 'vdr' },
]
const COMMON_POST: CStep[] = [
  { key: 'ticket', label: 'Flight booked (company pays)', stage: 'travel' },
  { key: 'airport_letter', label: 'Airport authorisation letter issued', stage: 'travel', hint: 'A4 letter for the pickup person and the airport desk — print it from the recruit page.' },
  { key: 'hostel_ready', label: 'Hostel bed confirmed (Act 446 capacity)', stage: 'travel' },
  { key: 'arrived', label: 'Arrived — passport stamped at the airport', stage: 'arrival' },
  { key: 'fomema', label: 'FOMEMA medical within 30 days of arrival — fit', stage: 'onboarding', hint: 'If unfit: Check Out Memo and send home within the time Immigration gives; the slot may be replaced.' },
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
    { key: 'ra_check', label: 'Recruiting Agent licensed (MEA eMigrate RA number)', stage: 'sourcing' },
    ...COMMON_PRE,
    { key: 'demand_letter', label: 'Demand letter / power of attorney attested by Indian mission in KL', stage: 'clearance', ecr: true, hint: 'ECR only. Needed for the employer registration in eMigrate.' },
    { key: 'emigrate_reg', label: 'Employer & contract registered in eMigrate', stage: 'clearance', ecr: true },
    { key: 'pbby', label: 'PBBY insurance (Pravasi Bhartiya Bima Yojana)', stage: 'clearance', hint: 'Compulsory for ECR; recommended for ECNR.' },
    { key: 'emig_clear', label: 'Emigration clearance (POE) granted in eMigrate', stage: 'clearance', ecr: true, hint: 'ECR passports cannot leave India for work without it. Adds about 1–3 weeks and the attestation / PBBY costs.' },
    { key: 'pdot', label: 'Pre-departure orientation (PDOT)', stage: 'clearance' },
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
    ...COMMON_POST,
  ],
  Bangladesh: [
    { key: 'ra_check', label: 'Recruiting agency on the approved list', stage: 'sourcing', hint: 'Malaysia stopped new Bangladeshi intake under the old approvals on 31 May 2024 — check the current KDN position before starting.' },
    ...COMMON_PRE,
    { key: 'attest_bd', label: 'Demand letter attested by Bangladesh High Commission KL', stage: 'clearance' },
    { key: 'bmet', label: 'BMET registration & emigration clearance (smart card)', stage: 'clearance' },
    { key: 'welfare_bd', label: 'Welfare fund & insurance (Wage Earners\' Welfare Board)', stage: 'clearance' },
    ...COMMON_POST,
  ],
  Myanmar: [...COMMON_PRE, { key: 'owic', label: 'Overseas Worker Identification Card (OWIC) / labour clearance', stage: 'clearance' }, ...COMMON_POST],
  Indonesia: [...COMMON_PRE, { key: 'bp2mi', label: 'BP2MI / SISKOP2MI registration & E-KTKLN', stage: 'clearance', hint: 'Recruit through a licensed P3MI agency; check the One Channel System rules for the sector.' }, ...COMMON_POST],
  'Sri Lanka': [...COMMON_PRE, { key: 'slbfe', label: 'SLBFE registration & insurance', stage: 'clearance' }, ...COMMON_POST],
  Pakistan: [...COMMON_PRE, { key: 'beoe', label: 'BE&OE Protector of Emigrants stamp + OEC / insurance', stage: 'clearance' }, ...COMMON_POST],
}
export const COUNTRIES = Object.keys(COUNTRY_STEPS)
export const stepsFor = (country: string, ecr?: string | null, templates?: Record<string, unknown>): CStep[] => {
  const over = templates?.[country] as CStep[] | undefined
  const base = Array.isArray(over) && over.length ? over : COUNTRY_STEPS[country] || [...COMMON_PRE, ...COMMON_POST]
  return base.filter((s) => !(s.ecr && country === 'India' && ecr === 'ECNR'))
}
export const progress = (r: Recruit, templates?: Record<string, unknown>) => {
  const st = stepsFor(r.country, r.ecr, templates)
  const done = st.filter((s) => r.steps?.[s.key]?.done || (s.key === 'quota_use' && false)).length
  return { done, total: st.length, pct: st.length ? Math.round((done / st.length) * 100) : 0 }
}
/** where a recruit stands: the stage of the first open step */
export const nextStep = (r: Recruit, templates?: Record<string, unknown>) => stepsFor(r.country, r.ecr, templates).find((s) => !r.steps?.[s.key]?.done)

/* ---------------- RAG + alerts ---------------- */
export type Rag = 'red' | 'amber' | 'green'
export function quotaRag(t: { approved: number; available: number; reserved: number; used: number; mismatch: number; expiry_date: string | null }, rules: Rules): { rag: Rag; why: string[] } {
  const why: string[] = []
  let rag: Rag = 'green'
  const d = t.expiry_date ? (daysUntil(t.expiry_date) ?? 0) : null
  const util = t.approved ? Math.round(((t.used + t.reserved) / t.approved) * 100) : 0
  if (t.mismatch !== 0) { rag = 'red'; why.push(`Reconciliation off by ${t.mismatch}`) }
  if (d !== null && d < 0 && t.available > 0) { rag = 'red'; why.push(`${t.available} unused slot(s) on an expired letter`) }
  else if (d !== null && d <= rules.expiry_red_days && t.available > 0) { rag = 'red'; why.push(`Expires in ${d} days with ${t.available} unused`) }
  else if (d !== null && d <= rules.expiry_amber_days && t.available > 0) { if (rag === 'green') rag = 'amber'; why.push(`Expires in ${d} days`) }
  if (t.approved && t.available === 0 && t.reserved === 0) { if (rag === 'green') rag = 'amber'; why.push('Fully used') }
  else if (util >= rules.util_amber_pct) { if (rag === 'green') rag = 'amber'; why.push(`${util}% used`) }
  return { rag, why }
}
export interface QAlert { level: Rag; text: string; link: string; company: string }
export function quotaAlerts(d: QData, workers: { id: string; fullName: string; workerNo: string; status: string; exitDate?: string; quotaId?: string }[]): QAlert[] {
  const out: QAlert[] = []
  const today = todayISO()
  // runaway: Immigration report not filed within the deadline
  for (const r of d.runaways.filter((x) => x.outcome === 'open')) {
    const due = addDaysISO(r.last_seen, d.rules.runaway_report_days)
    if (!r.imm_ref) out.push({ level: due < today ? 'red' : 'amber', text: `${r.worker_name}: Immigration runaway report (FWCMS eRUNAWAY) ${due < today ? 'OVERDUE since' : 'due by'} ${due}`, link: `/quota?tab=exits&run=${r.id}`, company: r.company_id })
    if (!r.police_report_no) out.push({ level: 'red', text: `${r.worker_name}: police report not recorded`, link: `/quota?tab=exits&run=${r.id}`, company: r.company_id })
  }
  // departed with no CMO after N days
  const withExit = new Set(d.exits.filter((x) => x.status !== 'void').map((x) => x.worker_id))
  const withRun = new Set(d.runaways.map((x) => x.worker_id))
  for (const w of workers) {
    if (!['Resigned', 'Terminated', 'Contract Ended', 'Repatriated'].includes(w.status) || withExit.has(w.id)) continue
    const since = w.exitDate ? -(daysUntil(w.exitDate) ?? 0) : 999
    if (since >= d.rules.cmo_missing_days) out.push({ level: 'red', text: `${w.fullName} (${w.workerNo}) left ${since >= 999 ? '' : since + ' days ago '}with no CMO in the register`, link: `/workers/${w.id}`, company: '' })
  }
  for (const w of workers.filter((x) => x.status === 'Absconded' && !withRun.has(x.id))) out.push({ level: 'red', text: `${w.fullName} (${w.workerNo}) is Absconded with no runaway case`, link: `/quota?tab=exits&newrun=${w.id}`, company: '' })
  // CMOs not yet claimed
  const el = d.exits.filter((x) => x.status === 'eligible')
  if (el.length) out.push({ level: 'amber', text: `${el.length} CMO(s) replacement-eligible and not yet claimed`, link: '/quota?tab=claims', company: '' })
  for (const t of d.tally) { const g = quotaRag(t, d.rules); if (g.rag !== 'green' && g.why.some((x) => !/used$|Fully/.test(x))) out.push({ level: g.rag, text: `${t.ref_no} ${t.country}: ${g.why.join('; ')}`, link: `/quota?tab=letters&q=${t.quota_id}`, company: t.company_id }) }
  for (const r of d.recruits.filter((x) => x.status === 'active' && x.vdr_expiry && !x.arrived_at)) {
    const n = (daysUntil(r.vdr_expiry!) ?? 0)
    if (n <= 14) out.push({ level: n < 0 ? 'red' : 'amber', text: `${r.full_name}: calling visa ${n < 0 ? 'expired' : `expires in ${n} days`} before arrival`, link: `/quota/recruit/${r.id}`, company: r.company_id })
  }
  return out
}
export const addDaysISO = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
export const rmFmt = (n?: number | null) => `RM\u00a0${(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
export const atMyt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' MYT' : '')

/** light list of open letters for the worker form (only fetched for quota roles) */
export function useQuotaLetters(enabled: boolean) {
  const [list, setList] = useState<{ id: string; ref_no: string; company_id: string }[]>([])
  useEffect(() => {
    if (!enabled) return
    let live = true
    void supabase.from('qr_quotas').select('id, ref_no, company_id').in('status', ['active', 'closed']).order('approval_date', { ascending: false })
      .then((r) => { if (live && !r.error) setList((r.data || []) as typeof list) })
    return () => { live = false }
  }, [enabled])
  return list
}

/** company filter: '' = every company set up in Settings; OTHER_CO = rows whose company is no longer in Settings */
export const OTHER_CO = '__other'
let known = new Set<string>()
export const setKnownCompanies = (ids: string[]) => { known = new Set(ids) }
export const inCompany = (sel: string, id: string | null | undefined) =>
  sel === OTHER_CO ? !!id && !known.has(id) : sel ? id === sel : !id || !known.size || known.has(id)
