/* Approval & Recruitment (v1.4 draft): data access, country checklists, cost categories, helpers.
 * Server: migrations 036-038 (tables qr_*, read-only RLS by company scope, every write through audited RPCs). */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { supabase } from './supabase'
import { daysUntil, todayISO } from './util'
import type { Role } from './supabase'

/* ---------------- rows ---------------- */
export interface QFile { id: string; company_id: string; kind: string; path: string; name: string | null; mime: string | null; size: number | null; sha256: string; uploaded_by_name: string | null; uploaded_at: string }
export interface Quota {
  id: string; company_id: string; ref_no: string; kind: 'new' | 'replacement' | 'transfer' | 'additional'; approval_date: string; expiry_date: string | null
  sector: string | null; subsector: string | null; job_title: string | null; breakdown: Record<string, number>; conditions: string | null; levy_note: string | null; notes: string | null
  section60k_ref: string | null; section60k_expiry: string | null; letter_file: string | null; status: 'pending' | 'active' | 'rejected' | 'closed'
  extensions: { from: string; to: string; ref: string; at: string; by: string }[]; claim_id: string | null
  expiry_auto?: boolean; rule_flags?: string[]; advert_ref?: string | null; advert_date?: string | null; app_steps?: Record<string, Record<string, unknown>>; levy_paid_on?: string | null; levy_file?: string | null
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
export interface StepVal { done?: boolean; date?: string; ref?: string; note?: string; override?: boolean; by_name?: string }
export interface Recruit {
  id: string; company_id: string; batch_id: string | null; use_request_id: string | null; country: string; full_name: string; passport_no: string | null; passport_expiry: string | null
  ecr: 'ECR' | 'ECNR' | null; dob: string | null; gender: string | null; job: string | null; phone: string | null; stage: string; steps: Record<string, StepVal>
  vdr_no: string | null; vdr_applied: string | null; vdr_approved: string | null; vdr_expiry: string | null; flight_no: string | null; flight_at: string | null; airport: string | null
  pickup_by: string | null; transport: string | null; arrived_at: string | null; hostel_id: string | null; outlet_id: string | null; owner_id: string | null
  status: 'active' | 'dropped' | 'converted'; drop_reason: string | null; worker_id: string | null; created_at: string; updated_at: string
  vdr_file: string | null; stamped_on: string | null
  medical_result: 'fit' | 'unfit' | null; medical_file: string | null; stamped_file: string | null; arrival_eta: string | null; ticket_file: string | null; klia_person: string | null
  hr_ack_file: string | null; om_by_name: string | null; out_kind: string | null; out_at: string | null; used_not_arrived: boolean; stage_at: string | null; template_id: string | null
  rule_flags: string[]; fomema_on: string | null; fomema_result: 'fit' | 'unfit' | null; fomema_file: string | null; accom_address: string | null; accom_confirmed_on: string | null; imm_cleared_at: string | null
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
  depart_letter_file?: string | null; bond_refund_status?: 'not_applicable' | 'pending' | 'applied' | 'refunded' | null; bond_refund_on?: string | null; bond_refund_rm?: number | null
}
export interface Runaway {
  id: string; company_id: string; quota_id: string | null; country: string | null; worker_id: string | null; worker_no: string | null; worker_name: string; passport_no: string | null; permit_no: string | null
  last_seen: string; flagged_at: string; reported_by_name: string | null; reported_at: string | null; police_report_no: string | null; police_report_date: string | null; police_file: string | null
  imm_ref: string | null; imm_date: string | null; imm_file: string | null; permit_cancel: 'pending' | 'applied' | 'cancelled'; bond_rm: number | null
  bond_status: 'to_be_forfeited' | 'forfeited' | 'sita_paid' | 'released'; sita_rm: number | null; levy_note: string | null; wages_owed_rm: number | null; money_owed_note: string | null
  followups: { at: string; by: string; note: string }[]; outcome: 'open' | 'found' | 'returned' | 'closed'; outcome_date: string | null; outcome_note: string | null; created_at: string
}
export interface Claim {
  id: string; ref_no: number; company_id: string; title: string; announcement: string | null; notes: string | null; status: 'draft' | 'submitted' | 'approved' | 'partly_approved' | 'rejected' | 'no_outcome'; window_id: string | null; outcome_note: string | null
  submitted_at: string | null; gov_ref: string | null; decided_on: string | null; approved_count: number | null; new_quota_id: string | null; pack_file: string | null
  created_by: string; created_by_name: string | null; created_at: string; decided_by_name: string | null
}
export interface QWindow { id: string; title: string; circular_ref: string | null; open_date: string | null; close_date: string | null; rules: string | null; file_id: string | null; status: 'recorded' | 'closed'; created_by_name: string | null; created_at: string }
export interface Agent {
  id: string; agency: string; country: string; licence: string | null; contact_name: string | null; phone: string | null; email: string | null; user_id: string | null
  active: boolean; revoked_at: string | null; revoked_by_name: string | null; revoke_reason: string | null; created_by_name: string | null; created_at: string
}
export interface AgentBatch { agent_id: string; batch_id: string; company_id: string; assigned_by_name: string | null; assigned_at: string }
export interface AgentDoc {
  id: string; company_id: string; batch_id: string; recruit_id: string; agent_id: string; kind: 'passport' | 'photo' | 'medical' | 'police' | 'other'
  path: string; name: string | null; mime: string | null; size: number | null; sha256: string; note: string | null; status: 'submitted' | 'accepted' | 'rejected'
  submitted_at: string; reviewed_by_name: string | null; reviewed_at: string | null; review_note: string | null
}
export interface MasterRow {
  level: 'letter' | 'company' | 'sector' | 'total'; company_id: string | null; sector: string | null; quota_id: string | null; ref_no: string | null; expiry_date: string | null
  days_left: number | null; letters: number; approved: number; reserved: number; used: number; available: number; lapsed: number; expiring_unused: number; runaways: number; active_workers: number
  pending_cancel?: number; used_not_arrived?: number; in_pipeline?: number
}
export interface ServerAlert { level: 'red' | 'amber'; kind: string; company_id: string | null; ref_id: string; text: string; link: string }
export interface ClaimItem { claim_id: string; exit_id: string; released: boolean; approved: boolean | null }
/* ---------------- rules & regulations (versioned) ---------------- */
export interface RegRule {
  id: string; key: string; scope: string; value: unknown; effective_from: string; source_ref: string | null; source_url: string | null; file_id: string | null; note: string | null; verified: boolean
  status: 'pending' | 'active' | 'rejected' | 'withdrawn' | 'superseded'; created_by: string | null; created_by_name: string | null; created_role: string | null; created_at: string
  decided_by_name: string | null; decided_at: string | null; decide_note: string | null
}
export interface RegCat { key: string; grp: string; label: string; unit: string; kind: string; scope_kind: 'none' | 'sector' | 'country'; help: string; ord: number }
export interface FollowUp { kind: string; ref: string; company_id: string | null; title: string; step: string; owner_id: string | null; owner_name: string | null; started: string | null; due: string | null; days_late: number; link: string; nudges: number }
export interface Replacement {
  id: string; ref_no: number; company_id: string; recruit_id: string | null; quota_id: string | null; country: string | null; worker_id: string | null; kind: 'not_arrived' | 'fomema_fail'; reason: string | null
  trigger_date: string; fomema_file: string | null; repat_file: string | null; exit_id: string | null; status: 'to_apply' | 'applied' | 'approval_uploaded' | 'restored' | 'refused' | 'withdrawn'
  applied_on: string | null; imm_ref: string | null; approval_file: string | null; approval_date: string | null; uploaded_by: string | null; uploaded_by_name?: string | null; uploaded_at: string | null
  verified_by: string | null; verified_by_name?: string | null; ledger_id: number | null; owner_id: string | null; owner_name: string | null; closed_note: string | null; created_at: string
}
export interface Rules {
  cmo_missing_days: number; runaway_report_days: number; expiry_amber_days: number; expiry_mid_days: number; expiry_red_days: number; util_amber_pct: number; payment_check_rm: number
  default_country: string; letter_valid_months: number; stall_days: number; window_warn_days: number; templates: Record<string, unknown>
}
export interface Tally {
  company_id: string; quota_id: string; ref_no: string; kind: string; expiry_date: string | null; status: string; country: string
  approved: number; available: number; reserved: number; used: number; lapsed: number; active_workers: number; in_pipeline: number
  exited_cmo: number; exited_other: number; runaways: number; exited_unrecorded: number; repl_eligible: number; repl_applied: number; repl_approved: number; mismatch: number
  pending_cancel?: number; used_not_arrived?: number; imm_restored?: number
}
export interface QData {
  loaded: boolean; error?: string
  quotas: Quota[]; ledger: Entry[]; requests: UseReq[]; batches: Batch[]; recruits: Recruit[]; events: QEvent[]; payments: Payment[]
  exits: Exit[]; runaways: Runaway[]; claims: Claim[]; claimItems: ClaimItem[]; files: QFile[]; tally: Tally[]; rules: Rules
  windows: QWindow[]; agents: Agent[]; agentBatches: AgentBatch[]; agentDocs: AgentDoc[]; master: MasterRow[]; alerts: ServerAlert[]
  reg: RegRule[]; regCat: RegCat[]; followups: FollowUp[]; replacements: Replacement[]
}
export const DEFAULT_RULES: Rules = { cmo_missing_days: 14, runaway_report_days: 14, expiry_amber_days: 90, expiry_mid_days: 60, expiry_red_days: 30, util_amber_pct: 80, payment_check_rm: 5000,
  default_country: 'India', letter_valid_months: 12, stall_days: 14, window_warn_days: 14, templates: {} }
const EMPTY: QData = { loaded: false, quotas: [], ledger: [], requests: [], batches: [], recruits: [], events: [], payments: [], exits: [], runaways: [], claims: [], claimItems: [], files: [], tally: [], rules: DEFAULT_RULES,
  windows: [], agents: [], agentBatches: [], agentDocs: [], master: [], alerts: [], reg: [], regCat: [], followups: [], replacements: [] }

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
/** v1.4.2: older stored texts said "CMO" — shown as COM (Check Out Memo). Display only; stored data is unchanged. */
export const com = <T,>(x: T): T => (typeof x === 'string' ? x.replace(/\bCMO(s?)\b/g, 'COM$1') as T : x)
const comRows = <T extends object,>(list: T[], keys: (keyof T)[]): T[] => list.map((r) => { const o = { ...r }; for (const k of keys) o[k] = com(o[k]); return o })
export function reloadQuota(): Promise<void> {
  if (loading) return loading
  loading = (async () => {
    try {
      const [quotas, ledger, requests, batches, recruits, events, payments, exits, runaways, claims, claimItems, files, tally, rules] = await Promise.all([
        all<Quota>('qr_quotas'), all<Entry>('qr_ledger', 'id'), all<UseReq>('qr_use_requests_v', 'requested_at'), all<Batch>('qr_batches'), all<Recruit>('qr_recruits'),
        all<QEvent>('qr_events_v', 'id'), all<Payment>('qr_payments'), all<Exit>('qr_exits'), all<Runaway>('qr_runaways'), all<Claim>('qr_claims'),
        supabase.from('qr_claim_items').select('*').then((r) => { if (r.error) throw r.error; return (r.data || []) as ClaimItem[] }),
        all<QFile>('qr_files', 'uploaded_at'),
        supabase.rpc('qr_tally', { p_company: null }).then((r) => { if (r.error) throw r.error; return (r.data || []) as Tally[] }),
        supabase.from('qr_rules').select('*').maybeSingle().then((r) => ({ ...DEFAULT_RULES, ...((r.data as Rules) || {}) })),
      ])
      const rows = <T,>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>) => Promise.resolve(q).then((r) => { if (r.error) throw r.error; return (r.data || []) as T[] })
      const soft = <T,>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>) => Promise.resolve(q).then((r) => (r.error ? [] : (r.data || []) as T[]))
      const [reg, regCat, followups, replacements] = await Promise.all([
        soft<RegRule>(supabase.from('qr_reg_rules').select('*').order('effective_from', { ascending: false })), soft<RegCat>(supabase.rpc('qr_reg_catalog')),
        soft<FollowUp>(supabase.rpc('qr_followups')), soft<Replacement>(supabase.from('qr_replacements').select('*').order('created_at', { ascending: false })),
      ])
      const [windows, agents, agentBatches, agentDocs, master, alerts] = await Promise.all([
        rows<QWindow>(supabase.from('qr_windows').select('*').order('close_date', { ascending: false })), rows<Agent>(supabase.from('qr_agents').select('*').order('agency')),
        rows<AgentBatch>(supabase.from('qr_agent_batches').select('*')), all<AgentDoc>('qr_agent_docs', 'submitted_at'),
        rows<MasterRow>(supabase.rpc('qr_master', { p_company: null })), rows<ServerAlert>(supabase.rpc('qr_alerts')),
      ])
      state = { loaded: true, quotas, ledger: comRows(ledger, ['note']), requests, batches, recruits, events: comRows(events, ['action', 'note']), payments, exits, runaways, claims, claimItems, files, tally, rules, windows, agents, agentBatches, agentDocs, master, alerts: comRows(alerts, ['text' as keyof ServerAlert]), reg, regCat, followups: comRows(followups, ['title' as keyof FollowUp]), replacements }
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
/** a government circular (shared by all companies; HR Admin and above) */
export async function uploadGovFile(file: File): Promise<string> {
  if (file.size > 15 * 1024 * 1024) throw new Error('File is larger than 15 MB.')
  const buf = await file.arrayBuffer()
  const hash = await sha256(buf)
  const safe = file.name.replace(/[^\w.-]+/g, '_').slice(-80)
  const path = `_gov/circular/${crypto.randomUUID()}-${safe}`
  const mime = file.type || 'application/pdf'
  const up = await supabase.storage.from(QUOTA_BUCKET).upload(path, file, { contentType: mime, upsert: false })
  if (up.error) throw new Error(up.error.message)
  const { data, error } = await supabase.rpc('qr_add_gov_file', { p_path: path, p_name: safe, p_mime: mime, p_size: file.size, p_sha256: hash })
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
/** lower roles never see who a superior is or which role they hold: just "Approver" (the 1.4.2 views mask it server-side too) */
export const whoLabel = (name: string | null | undefined, role: string | null | undefined, myRank: number) =>
  (role && (RANK_OF_LABEL[role] || 0) > myRank) || role === 'Approver' ? 'Approver' : [name, role && role !== name ? `(${role})` : ''].filter(Boolean).join(' ')

/* ---------------- labels ---------------- */
export const UR_STATUS: Record<UseReq['status'], { label: string; tone: string }> = {
  pending: { label: 'Sent for approval', tone: 'amber' }, gm_approved: { label: 'At the next approval step', tone: 'blue' },
  approved: { label: 'Approved', tone: 'green' }, returned: { label: 'Returned for changes', tone: 'orange' }, rejected: { label: 'Rejected', tone: 'red' }, cancelled: { label: 'Cancelled', tone: 'gray' },
}
/** status label as the viewer may read it: HR sees neutral steps, the GM never sees CEO powers, the CEO sees all */
export const urLabel = (s: UseReq['status'], rank: number) =>
  rank >= 4 ? ({ pending: 'Waiting for GM / CEO', gm_approved: 'GM approved — waiting for CEO' } as Record<string, string>)[s] || UR_STATUS[s].label
    : rank === 3 ? ({ pending: 'Waiting for approval', gm_approved: 'Approved by GM — in progress' } as Record<string, string>)[s] || UR_STATUS[s].label
      : UR_STATUS[s].label
export const ENTRY_LABEL: Record<string, string> = {
  approved: 'Approved (letter)', reserve: 'Reserved (use request)', release: 'Released', use: 'Used (calling visa)', use_existing: 'Used (existing worker)', return: 'Returned to balance',
  expire: 'Expired / lapsed', transfer_out: 'Transferred out', transfer_in: 'Transferred in', adjust_up: 'Adjustment +', adjust_down: 'Adjustment −',
  exit_cmo: 'Exited via COM (copy on file)', exit_other: 'Exited (death / transfer)', exit_other_elig: 'Exit (earlier record)', exit_void: 'Exit record voided',
  runaway: 'Runaway (no COM)', runaway_void: 'Runaway found / returned', claim_submit: 'In an additional quota application', claim_release: 'Back on file', claim_approved: 'Used in an approved application', reversal: 'Reversal',
}
export const EXIT_KIND: Record<Exit['kind'], string> = { cmo: 'Check Out Memo (COM)', death: 'Death', transfer: 'Transfer to another employer' }
export const EXIT_STATUS: Record<Exit['status'], { label: string; tone: string }> = {
  eligible: { label: 'COM on file', tone: 'green' }, claimed: { label: 'In an application', tone: 'blue' }, replaced: { label: 'Used in an application', tone: 'gray' },
  not_eligible: { label: 'Recorded', tone: 'gray' }, void: { label: 'Void', tone: 'red' },
}
export const CLAIM_STATUS: Record<Claim['status'], { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: 'gray' }, submitted: { label: 'Submitted', tone: 'blue' }, approved: { label: 'Approved', tone: 'green' }, partly_approved: { label: 'Partly approved', tone: 'amber' }, rejected: { label: 'Rejected', tone: 'red' },
  no_outcome: { label: 'No outcome', tone: 'gray' },
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

/* ---------------- pipeline: stages + country checklists (pure module, unit-tested) ---------------- */
export { DEFAULT_TEMPLATE, stepsOf, stageOf, nextStep, progress, daysInStage, stageSkipped, stageLabelIn, missingFor, reqOk, stepDone, stageCounts, slotUsed, liveStages, isReq, DEFAULT_COUNTRY } from './quotaSteps'
export type { Template, TplStage, TplStep, Ctx as StepCtx } from './quotaSteps'
import { DEFAULT_TEMPLATE, stageOf as stageOfT, type Ctx as StepCtx2, type Template as Tpl } from './quotaSteps'

/** the version of a rule in force on a date (scope falls back Sector/Sub → Sector → * → '') */
export function regAt<T = unknown>(reg: RegRule[], key: string, scope = '', at = todayISO()): RegRule & { value: T } | undefined {
  const cands = [scope, scope.split('/')[0], '*', ''].filter((x, i, a) => a.indexOf(x) === i)
  for (const sc of cands) {
    const r = reg.filter((x) => x.key === key && x.scope === sc && x.status === 'active' && x.effective_from <= at).sort((a, b) => (a.effective_from < b.effective_from ? 1 : a.effective_from > b.effective_from ? -1 : a.created_at < b.created_at ? 1 : -1))[0]
    if (r) return r as RegRule & { value: T }
  }
  return undefined
}
export const regNum = (reg: RegRule[], key: string, fallback: number, at?: string, scope = '') => { const v = regAt(reg, key, scope, at)?.value; return typeof v === 'number' ? v : Number(v ?? fallback) || fallback }
/** the pipeline template a recruit is pinned to (falls back to the one in force for his country) */
export function tplOf(d: Pick<QData, 'reg'>, r: { template_id?: string | null; country: string; created_at?: string }): Tpl {
  const pinned = r.template_id ? d.reg.find((x) => x.id === r.template_id) : undefined
  return ((pinned || regAt(d.reg, 'pipeline', r.country, (r.created_at || todayISO()).slice(0, 10)))?.value as Tpl) || DEFAULT_TEMPLATE
}
export function stepCtx(d: Pick<QData, 'requests' | 'agentDocs'>, r: Recruit): StepCtx2 {
  return { quotaApproved: d.requests.find((u) => u.id === r.use_request_id)?.status === 'approved', agentDocs: d.agentDocs.filter((a) => a.recruit_id === r.id && a.status === 'accepted').map((a) => a.kind) }
}
export const recruitStageOf = (d: QData, r: Recruit) => stageOfT(r as never, tplOf(d, r), stepCtx(d, r))
export const COUNTRIES = ['India', 'Nepal', 'Bangladesh', 'Myanmar', 'Indonesia', 'Sri Lanka', 'Pakistan', 'Vietnam', 'Cambodia', 'Laos', 'Thailand', 'Philippines', 'Uzbekistan', 'Kazakhstan', 'Turkmenistan']
export const pipelineCountries = (reg: RegRule[]) => [...new Set(reg.filter((x) => x.key === 'pipeline' && x.status === 'active' && x.scope !== '*').map((x) => x.scope))]

/* ---------------- RAG + alerts ---------------- */
export type Rag = 'red' | 'amber' | 'green'
export function quotaRag(t: { approved: number; available: number; reserved: number; used: number; mismatch: number; expiry_date: string | null }, rules: Rules, warn?: number[]): { rag: Rag; why: string[] } {
  const why: string[] = []
  let rag: Rag = 'green'
  const d = t.expiry_date ? (daysUntil(t.expiry_date) ?? 0) : null
  const util = t.approved ? Math.round(((t.used + t.reserved) / t.approved) * 100) : 0
  if (t.mismatch !== 0) { rag = 'red'; why.push(`Reconciliation off by ${t.mismatch}`) }
  if (d !== null && d < 0 && t.available > 0) { rag = 'red'; why.push(`${t.available} unused slot(s) on an expired letter`) }
  else if (d !== null && d <= (warn?.[2] ?? rules.expiry_red_days) && t.available > 0) { rag = 'red'; why.push(`Expires in ${d} days with ${t.available} unused`) }
  else if (d !== null && d <= (warn?.[0] ?? rules.expiry_amber_days) && t.available > 0) { if (rag === 'green') rag = 'amber'; why.push(`Expires in ${d} days`) }
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
    const due = addDaysISO(r.last_seen, regNum(d.reg, 'runaway_report_days', d.rules.runaway_report_days, r.last_seen))
    if (!r.imm_ref) out.push({ level: due < today ? 'red' : 'amber', text: `${r.worker_name}: Immigration runaway report (FWCMS eRUNAWAY) ${due < today ? 'OVERDUE since' : 'due by'} ${due}`, link: `/quota?tab=exits&run=${r.id}`, company: r.company_id })
    if (!r.police_report_no) out.push({ level: 'red', text: `${r.worker_name}: police report not recorded`, link: `/quota?tab=exits&run=${r.id}`, company: r.company_id })
  }
  // departed with no COM after N days
  const withExit = new Set(d.exits.filter((x) => x.status !== 'void').map((x) => x.worker_id))
  const withRun = new Set(d.runaways.map((x) => x.worker_id))
  for (const w of workers) {
    if (!['Resigned', 'Terminated', 'Contract Ended', 'Repatriated'].includes(w.status) || withExit.has(w.id)) continue
    const since = w.exitDate ? -(daysUntil(w.exitDate) ?? 0) : 999
    if (since >= d.rules.cmo_missing_days) out.push({ level: 'red', text: `${w.fullName} (${w.workerNo}) left ${since >= 999 ? '' : since + ' days ago '}with no COM in the register`, link: `/workers/${w.id}`, company: '' })
  }
  for (const w of workers.filter((x) => x.status === 'Absconded' && !withRun.has(x.id))) out.push({ level: 'red', text: `${w.fullName} (${w.workerNo}) is Absconded with no runaway case`, link: `/quota?tab=exits&newrun=${w.id}`, company: '' })
  // anti-misuse (server, same scope as the user): use without approval, workers beyond recorded use, expiry 90/60/30 with unused balance,
  // approved requests idle, decisions waiting, and — only when one is recorded and open — a government window closing
  for (const a of d.alerts) out.push({ level: a.level, text: a.text, link: '/' + a.link, company: a.company_id || '' })
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
