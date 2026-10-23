/* Roles, request types and the approval workflow (shared by the app and the daily-alerts function).
 * The database enforces the same rules (supabase/migrations/003_roles_requests_vault.sql). */

export const ROLES = ['super_admin', 'general_manager', 'hr_admin', 'hr_manager', 'outlet_manager', 'viewer'] as const
export type Role = (typeof ROLES)[number]
export const ROLE_LABEL: Record<string, string> = {
  super_admin: 'CEO', general_manager: 'General Manager', hr_admin: 'HR Admin', hr_manager: 'HR Manager', outlet_manager: 'Outlet Manager', viewer: 'Viewer (read only)',
}
export const ROLE_HELP: Record<string, string> = {
  super_admin: 'Owner: everything, reviews and can overrule any decision (only one person should have this)',
  general_manager: 'Final approvals and day-to-day admin, with the powers the CEO allows',
  hr_admin: 'Approves requests within limits; can manage users (if allowed)',
  hr_manager: 'Keeps worker records, reviews requests, applies approved requests',
  outlet_manager: 'Sees only workers of his outlets; raises requests, adds remarks & documents',
  viewer: 'Read only (no salary details)',
}
/** approval authority: higher number can approve more */
export const RANK: Record<string, number> = { hr_manager: 1, hr_admin: 2, general_manager: 3, super_admin: 3 }

export type Level = 'hr_manager' | 'hr_admin' | 'super_admin'
export type Effect = 'passport' | 'leave' | 'increment' | 'advance' | 'loan' | 'deduction' | 'penalty' | 'memo' | 'transfer' | 'exit' | 'absconded' | 'details' | 'letter' | 'note'

export interface ReqField {
  key: string; label: string
  type?: 'text' | 'textarea' | 'date' | 'number' | 'select' | 'checkbox' | 'outlet' | 'emergency_reason'
  options?: string[]; required?: boolean; hint?: string
}
export interface RequestType {
  key: string; label: string; icon: string; group: string
  level: Level; limit?: number | null // default approver; limit = max RM an HR Admin may approve (above → General Manager / CEO)
  amountKey?: string // which field is the RM amount used for limits
  effect: Effect; fields: ReqField[]; docHint?: string; mcCategory?: string
  requiredDoc?: string // a file of this vault category must be attached (checked again by the server before approval)
}

const reason: ReqField = { key: 'reason', label: 'Reason / details', type: 'textarea', required: true }
const fromTo: ReqField[] = [{ key: 'from', label: 'From', type: 'date', required: true }, { key: 'to', label: 'To', type: 'date', required: true }]
const effDate: ReqField = { key: 'date', label: 'Effective date', type: 'date', required: true }

export const REQUEST_TYPES: RequestType[] = [
  // Leave
  { key: 'annual_leave', label: 'Annual leave', icon: '🏖️', group: 'Leave', level: 'hr_admin', effect: 'leave', fields: [...fromTo, reason] },
  { key: 'medical_leave', label: 'Medical leave (MC)', icon: '🤒', group: 'Leave', level: 'hr_manager', effect: 'leave', fields: [...fromTo, { key: 'clinic', label: 'Clinic / hospital' }, reason], docHint: 'Attach the MC (photo or PDF)', mcCategory: 'MC' },
  { key: 'emergency_leave', label: 'Emergency / compassionate leave', icon: '🆘', group: 'Leave', level: 'hr_admin', effect: 'leave', fields: [{ key: 'reasonKey', label: 'Emergency reason', type: 'emergency_reason', required: true }, ...fromTo, { key: 'paid', label: 'Paid?', type: 'select', options: ['Paid', 'Unpaid'] }, { key: 'bookedBy', label: 'Flight ticket booked by', type: 'select', options: ['Worker', 'Outlet manager'], required: true }, { key: 'route', label: 'Flight / route (e.g. KUL–DAC, MH196)' }, { key: 'ticketCost', label: 'Ticket cost (RM)', type: 'number', required: true }, { key: 'reimburse', label: 'Ask company to reimburse the ticket', type: 'checkbox' }, reason], requiredDoc: 'Flight ticket', docHint: 'Attach the flight ticket (required). HR decides on reimbursement / ticket entitlement when applying.' },
  { key: 'home_leave', label: 'Home leave (company books ticket)', icon: '✈️', group: 'Leave', level: 'hr_admin', effect: 'leave', fields: [...fromTo, { key: 'ticketNeeded', label: 'Company return ticket needed', type: 'checkbox' }, { key: 'route', label: 'Route / airport (e.g. KUL–DAC)' }, { key: 'ticketCost', label: 'Ticket cost estimate (RM)', type: 'number' }, reason], docHint: 'After approval HR books the ticket and attaches it here; you will see the ticket status.' },
  { key: 'checkout_memo', label: 'Checkout memo', icon: '🧳', group: 'Leave', level: 'hr_manager', effect: 'memo', fields: [{ key: 'kind', label: 'Memo', type: 'select', options: ['Home Leave Checkout', 'Return from Leave', 'Exit Clearance'], required: true }, { key: 'date', label: 'Last working / return day', type: 'date', required: true }, { key: 'expectedReturn', label: 'Expected return', type: 'date' }, { key: 'reason', label: 'Notes', type: 'textarea' }] },
  // Pay & money
  { key: 'salary_increment', label: 'Salary increment', icon: '📈', group: 'Pay & money', level: 'super_admin', amountKey: 'increase', effect: 'increment', fields: [effDate, { key: 'increase', label: 'Increase per month (RM)', type: 'number', required: true }, { key: 'reason', label: 'Reason (performance, promotion…)', type: 'textarea', required: true }] },
  { key: 'salary_advance', label: 'Salary advance', icon: '💵', group: 'Pay & money', level: 'hr_admin', limit: 500, amountKey: 'amount', effect: 'advance', fields: [{ key: 'amount', label: 'Amount (RM)', type: 'number', required: true }, { key: 'instalments', label: 'Repay in (months)', type: 'number', hint: 'Monthly deduction = amount ÷ months' }, reason] },
  { key: 'loan', label: 'Loan', icon: '🏦', group: 'Pay & money', level: 'super_admin', amountKey: 'amount', effect: 'loan', fields: [{ key: 'amount', label: 'Amount (RM)', type: 'number', required: true }, { key: 'instalments', label: 'Repay in (months)', type: 'number', required: true }, { key: 'startDate', label: 'First deduction month', type: 'date' }, reason] },
  { key: 'deduction', label: 'Salary deduction', icon: '➖', group: 'Pay & money', level: 'hr_admin', limit: 200, amountKey: 'amount', effect: 'deduction', fields: [{ key: 'amount', label: 'Amount (RM)', type: 'number', required: true }, { key: 'dtype', label: 'Type', type: 'select', options: ['Damage', 'Shortage', 'Hostel / utilities', 'Other'], required: true }, { key: 'date', label: 'Deduct in month of', type: 'date' }, reason] },
  { key: 'ot_claim', label: 'Overtime / allowance claim', icon: '⏱️', group: 'Pay & money', level: 'hr_admin', limit: 300, amountKey: 'amount', effect: 'note', fields: [{ key: 'claimType', label: 'Claim', type: 'select', options: ['Overtime', 'Public holiday work', 'Meal / transport allowance', 'Other allowance'], required: true }, { key: 'hours', label: 'Hours (if OT)', type: 'number' }, { key: 'amount', label: 'Amount (RM)', type: 'number', required: true }, { key: 'period', label: 'Period / dates' }, reason] },
  // Discipline
  { key: 'penalty', label: 'Penalty / disciplinary action', icon: '⚖️', group: 'Discipline', level: 'hr_admin', limit: 100, amountKey: 'amount', effect: 'penalty', fields: [{ key: 'incidentDate', label: 'Incident date', type: 'date', required: true }, { key: 'amount', label: 'Fine (RM, if any)', type: 'number' }, { key: 'action', label: 'Action', type: 'select', options: ['Fine', 'Suspension', 'Final warning', 'Domestic inquiry'], required: true }, reason], docHint: 'Attach evidence / statements' },
  { key: 'warning_letter', label: 'Warning letter', icon: '⚠️', group: 'Discipline', level: 'hr_admin', effect: 'letter', fields: [{ key: 'incidentDate', label: 'Incident date', type: 'date', required: true }, { key: 'level', label: 'Warning', type: 'select', options: ['Verbal warning (recorded)', '1st written warning', '2nd written warning', 'Final warning'], required: true }, { key: 'reason', label: 'Misconduct details', type: 'textarea', required: true }] },
  { key: 'absconding', label: 'Absconding report', icon: '🚨', group: 'Discipline', level: 'hr_admin', effect: 'absconded', fields: [{ key: 'lastSeen', label: 'Last seen / last day at work', type: 'date', required: true }, { key: 'belongings', label: 'Belongings left at hostel?', type: 'select', options: ['Yes', 'No', 'Unknown'] }, { key: 'policeReport', label: 'Police report no. (if made)' }, reason], docHint: 'Attach police report if available. HR must notify Immigration (JIM) and cancel the permit.' },
  // Medical & welfare
  { key: 'medical_visit', label: 'Medical / FOMEMA / clinic visit', icon: '🩺', group: 'Medical & welfare', level: 'hr_manager', effect: 'note', fields: [{ key: 'kind', label: 'For', type: 'select', options: ['Clinic visit', 'FOMEMA medical check', 'Hospital', 'Follow-up'], required: true }, { key: 'date', label: 'Date', type: 'date' }, reason] },
  { key: 'accident', label: 'Accident / injury (SOCSO / PERKESO)', icon: '🚑', group: 'Medical & welfare', level: 'hr_admin', effect: 'note', fields: [{ key: 'date', label: 'Accident date', type: 'date', required: true }, { key: 'place', label: 'Where', required: true }, { key: 'atWork', label: 'Happened at work / commuting', type: 'checkbox' }, { key: 'hospital', label: 'Clinic / hospital' }, reason], docHint: 'Attach medical report, photos. Report to PERKESO (Borang 34) within 48 hours.' },
  { key: 'insurance_claim', label: 'Insurance claim', icon: '🛡️', group: 'Medical & welfare', level: 'hr_admin', amountKey: 'amount', effect: 'note', fields: [{ key: 'policy', label: 'Policy (SPIKPA / hospitalisation / other)', type: 'select', options: ['SPIKPA hospitalisation', 'Group insurance', 'Other'], required: true }, { key: 'amount', label: 'Claim amount (RM)', type: 'number' }, reason] },
  { key: 'accommodation', label: 'Accommodation / hostel issue', icon: '🏠', group: 'Medical & welfare', level: 'hr_manager', effect: 'note', fields: [{ key: 'issue', label: 'Issue', type: 'select', options: ['Repair', 'Overcrowding', 'Utilities', 'Cleanliness / pests', 'Change hostel', 'Other'], required: true }, reason] },
  { key: 'complaint', label: 'Complaint / grievance', icon: '🗣️', group: 'Medical & welfare', level: 'hr_manager', effect: 'note', fields: [{ key: 'against', label: 'About (person / matter)' }, reason] },
  { key: 'uniform', label: 'Uniform / equipment', icon: '🦺', group: 'Medical & welfare', level: 'hr_manager', amountKey: 'amount', effect: 'note', fields: [{ key: 'items', label: 'Items & sizes', required: true }, { key: 'amount', label: 'Cost (RM, if any)', type: 'number' }, { key: 'chargeWorker', label: 'Charge to worker', type: 'checkbox' }] },
  // Documents & permits
  { key: 'passport', label: 'Passport release / return / copy', icon: '🛂', group: 'Documents & permits', level: 'hr_manager', effect: 'passport', fields: [{ key: 'action', label: 'Request', type: 'select', options: ['Release passport to worker', 'Return passport to safe', 'Passport copy'], required: true }, { key: 'date', label: 'Needed on', type: 'date' }, { key: 'expectedReturn', label: 'Expected back in safe (if released)', type: 'date' }, { key: 'reason', label: 'Reason (optional — the worker does not have to give one)', type: 'textarea' }], docHint: 'The passport belongs to the worker: a release request is honoured promptly by HR (no higher approval). A release / return slip PDF is created automatically.' },
  { key: 'permit_renewal', label: 'Permit / visa (PLKS) renewal', icon: '🪪', group: 'Documents & permits', level: 'hr_admin', effect: 'note', fields: [{ key: 'expiry', label: 'Current expiry', type: 'date' }, { key: 'years', label: 'Renew for (years)', type: 'number' }, reason] },
  { key: 'document_copy', label: 'Document copy request', icon: '📄', group: 'Documents & permits', level: 'hr_manager', effect: 'note', fields: [{ key: 'docs', label: 'Which documents', required: true }, { key: 'purpose', label: 'Purpose' }] },
  { key: 'update_details', label: 'Update personal / family details', icon: '✏️', group: 'Documents & permits', level: 'hr_manager', effect: 'details', fields: [{ key: 'phoneMY', label: 'New phone (MY)' }, { key: 'phoneHome', label: 'New phone (home country)' }, { key: 'hostelAddress', label: 'New hostel address', type: 'textarea' }, { key: 'overseasAddress', label: 'New home address', type: 'textarea' }, { key: 'family', label: 'Family / next-of-kin change', type: 'textarea' }] },
  // Movement & exit
  { key: 'transfer', label: 'Transfer to another outlet', icon: '🔁', group: 'Movement & exit', level: 'hr_admin', effect: 'transfer', fields: [{ key: 'toOutlet', label: 'Move to outlet', type: 'outlet', required: true }, effDate, reason] },
  { key: 'resignation', label: 'Resignation / contract end', icon: '📤', group: 'Movement & exit', level: 'hr_admin', effect: 'exit', fields: [{ key: 'exitType', label: 'Type', type: 'select', options: ['Resigned', 'Contract Ended'], required: true }, { key: 'noticeDate', label: 'Notice given on', type: 'date' }, { key: 'lastDay', label: 'Last working day', type: 'date', required: true }, { key: 'repatriate', label: 'Needs repatriation ticket', type: 'checkbox' }, reason] },
  { key: 'termination', label: 'Termination', icon: '⛔', group: 'Movement & exit', level: 'super_admin', effect: 'exit', fields: [{ key: 'lastDay', label: 'Last working day', type: 'date', required: true }, { key: 'ground', label: 'Ground', type: 'select', options: ['Misconduct (after domestic inquiry)', 'Poor performance', 'Medically unfit (FOMEMA)', 'Redundancy', 'Other'], required: true }, reason], docHint: 'Attach show-cause letter / inquiry notes.' },
  { key: 'other', label: 'Other request', icon: '📝', group: 'Other', level: 'hr_admin', amountKey: 'amount', effect: 'note', fields: [{ key: 'subject', label: 'Subject', required: true }, { key: 'amount', label: 'Amount (RM, if any)', type: 'number' }, reason] },
]
export const REQUEST_TYPE = Object.fromEntries(REQUEST_TYPES.map((t) => [t.key, t])) as Record<string, RequestType>

export interface TypeRule { enabled: boolean; level: Level; limit: number | null }
export interface HrAdminFlags { manageUsers: boolean; deleteWorkers: boolean; viewSalary: boolean; viewAudit: boolean; resetPasswords: boolean }
export interface ApprovalRules { types: Record<string, TypeRule> }
export const DEFAULT_HR_FLAGS: HrAdminFlags = { manageUsers: true, deleteWorkers: false, viewSalary: true, viewAudit: true, resetPasswords: false }
export function defaultRules(): ApprovalRules {
  return { types: Object.fromEntries(REQUEST_TYPES.map((t) => [t.key, { enabled: true, level: t.level, limit: t.limit ?? null }])) }
}
export function ruleFor(rules: ApprovalRules | undefined, type: string): TypeRule {
  const d = REQUEST_TYPE[type]
  const r = rules?.types?.[type]
  return { enabled: r?.enabled ?? true, level: (r?.level || d?.level || 'hr_admin') as Level, limit: r ? r.limit ?? null : d?.limit ?? null }
}
/** who must give the final approval (same rule as the database function request_required_level) */
export function requiredLevel(rules: ApprovalRules | undefined, type: string, amount?: number | null): Level {
  const r = ruleFor(rules, type)
  if (type === 'loan' || type === 'salary_increment') return 'super_admin' // company rule, also enforced by the database
  if (r.level === 'hr_admin' && r.limit !== null && r.limit !== undefined && amount !== null && amount !== undefined && Number(amount) > Number(r.limit)) return 'super_admin'
  return r.level
}

export type ReqStatus = 'submitted' | 'returned' | 'recommended' | 'escalated' | 'approved' | 'rejected' | 'completed' | 'cancelled'
export const STATUS_LABEL: Record<ReqStatus, string> = {
  submitted: 'Waiting HR review', returned: 'Returned for info', recommended: 'Waiting HR Admin', escalated: 'Waiting General Manager',
  approved: 'Approved – to apply', rejected: 'Rejected', completed: 'Done', cancelled: 'Cancelled',
}
export const STATUS_TONE: Record<ReqStatus, string> = {
  submitted: 'amber', returned: 'orange', recommended: 'amber', escalated: 'purple', approved: 'teal', rejected: 'red', completed: 'green', cancelled: 'gray',
}
export const OPEN_STATUSES: ReqStatus[] = ['submitted', 'returned', 'recommended', 'escalated', 'approved']
export const STAGE_RANK: Partial<Record<ReqStatus, number>> = { submitted: 1, recommended: 2, escalated: 3 }

export interface RequestRow {
  id: string; ref_no: number; type: string; worker_id: string | null; outlet_id: string | null; title: string
  data: Record<string, unknown>; amount: number | null; priority: 'low' | 'normal' | 'high' | 'urgent'; status: ReqStatus
  required_level: Level; created_by: string; created_by_name: string | null; created_at: string; updated_at: string
  decided_by_name?: string | null; decided_by_role?: string | null; decided_at?: string | null; ceo_locked?: boolean; ceo_updated_at?: string | null; applied_by_name?: string | null; applied_at?: string | null; result?: Record<string, unknown> | null
}

/** Who takes the final ("top") decision: the General Manager if one is active with the matching power, otherwise the CEO. */
export interface ApprovalRoute { gmFinal?: boolean; gmLoans?: boolean; gmIncrements?: boolean }
export const requestPower = (type: string) => (type === 'loan' || type === 'salary_advance' ? 'requests.loans' : type === 'salary_increment' ? 'requests.increments' : 'requests.final')
export function gmDecides(route: ApprovalRoute | null | undefined, type: string): boolean {
  const p = requestPower(type)
  return !!(p === 'requests.loans' ? route?.gmLoans : p === 'requests.increments' ? route?.gmIncrements : route?.gmFinal)
}
export interface ActCtx { role: string; userId: string; can?: (p: string) => boolean; route?: ApprovalRoute | null }
/** may this user take the top-level decision for this type (same as can_top_decide in the database) */
export function canTop(type: string, c: ActCtx): boolean {
  if (c.role === 'super_admin') return true
  return c.role === 'general_manager' && !!c.can?.(requestPower(type))
}
const rankFor = (type: string, c: ActCtx) => (canTop(type, c) ? 3 : c.role === 'general_manager' ? 0 : RANK[c.role] || 0)

/** Is this request waiting for ME to do something? (drives badges and the daily alert) */
export function needsMyAction(r: Pick<RequestRow, 'status' | 'created_by' | 'required_level' | 'type' | 'ceo_locked'>, role: string, userId: string, c?: Partial<ActCtx>): boolean {
  const ctx: ActCtx = { role, userId, ...c }
  if (r.status === 'returned') return r.created_by === userId
  if (r.status === 'approved') return role === 'hr_manager'
  if (r.ceo_locked && role !== 'super_admin') return false
  if (r.ceo_locked && r.status === 'escalated') return true // recalled by the CEO: his own decision
  const stage = STAGE_RANK[r.status]
  const rank = rankFor(r.type, ctx)
  if (!stage || !rank) return false
  if (r.created_by === userId && role !== 'super_admin') return false
  if (rank === 3) {
    // the final decider: escalated requests (and those that need the top level). The CEO only when the GM does not decide this type.
    if (role === 'super_admin' && gmDecides(ctx.route, r.type)) return false
    return r.status === 'escalated' || r.status === 'recommended' || (r.status === 'submitted' && RANK[r.required_level] >= 3)
  }
  return rank === stage || (rank > stage && RANK[r.required_level] <= rank && r.status !== 'submitted')
}

/** Buttons the current user should see (the server re-checks everything). */
export function availableActions(r: RequestRow, role: string, userId: string, c?: Partial<ActCtx>): string[] {
  const ctx: ActCtx = { role, userId, ...c }
  const out: string[] = []
  const rank = rankFor(r.type, ctx)
  const top = rank === 3
  const mine = r.created_by === userId
  const ceo = role === 'super_admin'
  const open = OPEN_STATUSES.includes(r.status)
  const stage = STAGE_RANK[r.status]
  if (r.ceo_locked && !ceo) {
    if (r.status === 'approved' && (RANK[role] || 0) >= 1) out.push('apply')
    out.push('comment')
    return out
  }
  // chain: HR manager reviews → HR admin → General Manager (final; CEO if none). GM / CEO may act at any stage.
  if (stage && (top || rank === stage)) {
    if (!mine || ceo) {
      if (rank >= RANK[r.required_level]) out.push('approve')
      else out.push('forward')
    }
    out.push('return', 'reject')
  }
  if (r.status === 'approved' && (RANK[role] || 0) >= 1) out.push('apply')
  if (r.status === 'returned' && mine) out.push('resubmit')
  if (open && r.status !== 'approved' && (mine || ceo || (role === 'general_manager' && ctx.can?.('requests.cancel')))) out.push('cancel')
  out.push('comment')
  return out
}
/** history line, e.g. "Approved by General Manager Aisyah" */
export const decidedLine = (r: Pick<RequestRow, 'status' | 'decided_by_name' | 'decided_by_role'>) =>
  `${r.status === 'rejected' ? 'Rejected' : 'Approved'} by ${r.decided_by_role ? (ROLE_LABEL[r.decided_by_role] || r.decided_by_role) + ' ' : ''}${r.decided_by_name || ''}`.trim()
export const ACTION_LABEL: Record<string, string> = {
  approve: 'Approve', forward: 'Recommend & send up', return: 'Return for info', reject: 'Reject', apply: 'Apply to worker record & close',
  resubmit: 'Resubmit', cancel: 'Cancel request', comment: 'Add comment', ceo_overrule: 'Overruled by CEO', ceo_recall: 'Recalled by CEO', ceo_reviewed: 'Reviewed by CEO',
}

export const VAULT_CATEGORIES = ['Photo', 'Passport (bio page)', 'Passport (full copy)', 'PLKS / Visa', 'FOMEMA / Medical', 'Insurance', 'SOCSO / PERKESO', 'Contract / Offer letter', 'Checkout memo', 'Return memo', 'Exit clearance memo', 'Warning letter', 'MC', 'Payslip', 'Bank', 'IC / i-Kad', 'Police report', 'Flight ticket', 'Passport safekeeping consent', 'Passport release slip', 'Emergency leave proof', 'Other']
export interface VaultConfig { maxImageKB: number; maxPdfKB: number; restricted: string[]; extraCategories: string[] }
export const DEFAULT_VAULT: VaultConfig = { maxImageKB: 1024, maxPdfKB: 5120, restricted: ['Payslip', 'Bank'], extraCategories: [] }

/* ---------- Emergency leave: qualifying reasons (CEO can edit the list in Settings) ---------- */
export interface EmergencyReason {
  key: string; label: string
  relationship: boolean // ask which family member
  proof: string // supporting documents expected
  proofDays: number // proof may follow within N days after the leave starts ("proof pending" until uploaded)
  detailed?: boolean // needs a detailed explanation (min 40 characters)
}
export const IMMEDIATE_FAMILY = ['Spouse', 'Child', 'Father', 'Mother', 'Brother', 'Sister', 'Father-in-law', 'Mother-in-law', 'Grandfather', 'Grandmother']
export const DEFAULT_EMERGENCY_REASONS: EmergencyReason[] = [
  { key: 'death', label: 'Death of immediate family member', relationship: true, proof: 'Death certificate, burial/cremation permit or official letter (photo is fine)', proofDays: 14 },
  { key: 'critical_illness', label: 'Critical illness / hospitalisation of immediate family member', relationship: true, proof: 'Hospital letter, admission slip or doctor’s note', proofDays: 14 },
  { key: 'accident', label: 'Serious accident or injury of immediate family member', relationship: true, proof: 'Hospital letter, police report or photo proof', proofDays: 14 },
  { key: 'own_medical', label: 'Own medical emergency needing treatment in home country', relationship: false, proof: 'Doctor’s note / referral letter', proofDays: 7 },
  { key: 'childbirth', label: 'Spouse childbirth / pregnancy complication', relationship: false, proof: 'Hospital letter or birth certificate', proofDays: 30 },
  { key: 'disaster', label: 'Natural disaster or fire affecting family home', relationship: false, proof: 'Local authority letter, news report or photos', proofDays: 30 },
  { key: 'legal', label: 'Family security emergency / legal matter needing personal presence', relationship: false, proof: 'Court summons, police or official letter', proofDays: 14 },
  { key: 'other', label: 'Other (explain in detail — HR Admin decides)', relationship: false, proof: 'Any supporting document', proofDays: 14, detailed: true },
]
export const EMERGENCY_PROOF_CATEGORY = 'Emergency leave proof'
