export const BUSINESS_TYPES = ['Restaurant', 'Convenience Shop', 'Central Store', 'Accounting', 'Management', 'Hotel', 'Jewellery Shop'] as const
export type BusinessType = (typeof BUSINESS_TYPES)[number]

export const NATIONALITIES = ['Bangladesh', 'Nepal', 'India', 'Indonesia', 'Myanmar', 'Pakistan', 'Vietnam', 'Philippines', 'Sri Lanka', 'Thailand', 'Cambodia', 'Other']
export const SKILL_LEVELS = ['Skilled', 'Semi-skilled', 'Unskilled']
export const GENDERS = ['Male', 'Female']
export const RELIGIONS = ['Islam', 'Hindu', 'Buddhist', 'Christian', 'Sikh', 'Other']

export const STATUSES = ['Active-Working', 'On Leave', 'Home Leave', 'Medical Leave', 'Absconded', 'Resigned', 'Terminated', 'Contract Ended', 'Repatriated'] as const
export type WorkerStatus = (typeof STATUSES)[number]
export const EXITED_STATUSES: WorkerStatus[] = ['Absconded', 'Resigned', 'Terminated', 'Contract Ended', 'Repatriated']
export const LEAVE_STATUSES: WorkerStatus[] = ['On Leave', 'Home Leave', 'Medical Leave']

/** display order = the numbered document list (1. Passport, 2. Work permit, ...) */
export const DOC_TYPES = ['Passport', 'Work Permit / PLKS (VP(TE))', 'Visa / VDR', 'FOMEMA Medical', 'Insurance (SPIKPA / Hospitalisation)', 'Hostel / Accommodation', 'SOCSO / PERKESO', 'Levy Payment', 'Security Bond', 'Other'] as const
export const DOC_SHORT: Record<string, string> = {
  Passport: 'Passport', 'Work Permit / PLKS (VP(TE))': 'Work permit (PLKS)', 'Visa / VDR': 'Visa / VDR', 'FOMEMA Medical': 'FOMEMA',
  'Insurance (SPIKPA / Hospitalisation)': 'Insurance (SPIKPA)', 'Hostel / Accommodation': 'Hostel', 'SOCSO / PERKESO': 'SOCSO / PERKESO', 'Levy Payment': 'Levy', 'Security Bond': 'Security bond', Other: 'Other',
}
export const DOC_STAGES = ['In hand (valid)', 'Applied / in process', 'Renewal in progress', 'With immigration', 'With agent', 'Not applicable']
export const REQUIRED_DOCS = ['Passport', 'Work Permit / PLKS (VP(TE))', 'FOMEMA Medical', 'Insurance (SPIKPA / Hospitalisation)']

export const RELATIONS = ['Wife', 'Husband', 'Son', 'Daughter', 'Father', 'Mother', 'Brother', 'Sister', 'Other']
export const LEAVE_TYPES = ['Annual', 'Home Leave', 'Medical', 'Emergency', 'Unpaid'] as const
export const APPROVAL = ['Pending', 'Approved', 'Rejected'] as const
export const TICKET_PAYERS = ['Company', 'Worker', 'Shared', 'Agent']
export const DEDUCTION_TYPES = ['Loan repayment', 'Advance', 'Penalty', 'Damage', 'Other']
export const LOAN_TYPES = ['Loan', 'Advance']
export const EXIT_TYPES: WorkerStatus[] = ['Resigned', 'Terminated', 'Contract Ended', 'Repatriated', 'Absconded']

/** dataUrl = copy on this device; path = file in the private cloud bucket */
export interface Attachment { name: string; type: string; dataUrl?: string; path?: string }

export interface DocRec { id: string; type: string; label?: string; number?: string; issueDate?: string; expiryDate?: string; issuePlace?: string; stage?: string; remarks?: string; attachment?: Attachment }
/** remittance account the worker uses (HR / CEO only; stripped server-side for other roles) */
export interface RemitRec { id: string; provider: string; providerOther?: string; memberId?: string; beneficiaryName?: string; relationship?: string; country?: string; bankOrWallet?: string; accountNo?: string; isPrimary?: boolean; notes?: string }
export interface FamilyRec { id: string; relation: string; name: string; dob?: string; phone?: string; address?: string; isEmergency?: boolean; isNextOfKin?: boolean }
export interface IncrementRec { id: string; date: string; oldPay: number; newPay: number; reason?: string }
export interface AllowanceRec { id: string; name: string; amount: number }
export interface LoanRec { id: string; date: string; type: string; amount: number; purpose?: string; monthlyDeduction?: number }
export interface DeductionRec { id: string; date: string; amount: number; type: string; loanId?: string; remarks?: string }
export interface LeaveRec {
  id: string; type: string; from: string; to: string; days: number; status: string; approvedBy?: string; remarks?: string
  appliedOn?: string; returned?: boolean; returnedOn?: string
  ticketProvided?: boolean; ticketDetails?: string; ticketCost?: number; ticketPaidBy?: string
  /** counts against the worker's company return-ticket entitlement (home leave, or emergency leave when HR decides so) */
  ticketFromEntitlement?: boolean
  requestId?: string; ticketDocId?: string; ticketStatus?: 'needed' | 'booked'
  emergencyReason?: string; relationship?: string; proofStatus?: 'pending' | 'received' | 'waived'
  ticketDecision?: 'reimburse' | 'entitlement' | 'worker_pays'
}
export interface ChecklistItem { label: string; done: boolean; remarks?: string }
export interface MemoRec {
  id: string; kind: 'Home Leave Checkout' | 'Exit Clearance' | 'Return from Leave'; date: string; leaveId?: string
  exitType?: string; lastWorkingDay?: string; expectedReturn?: string
  checklist: ChecklistItem[]; outstandingBalance: number; finalSalary?: number; penalty?: number
  ticketDetails?: string; notes?: string; workerSign?: string; managerSign?: string; hrSign?: string
}
export interface NoteRec { id: string; date: string; text: string }
export interface StatusRec { id: string; date: string; from?: string; to: string; remarks?: string }

export interface Worker {
  id: string
  workerNo: string
  fullName: string
  photo?: string
  nationality: string
  dob?: string
  gender?: string
  religion?: string
  phoneMY?: string
  phoneHome?: string
  email?: string
  /** language codes from lib/languages.ts ('other' + primaryLanguageOther for a typed-in language) */
  primaryLanguage?: string
  primaryLanguageOther?: string
  primaryRead?: boolean
  primaryWrite?: boolean
  languages?: { lang: string; other?: string; speak: boolean; read: boolean; write: boolean }[]
  outletId?: string
  businessType?: string
  jobCategory?: string
  skillLevel?: string
  joinDate: string
  status: WorkerStatus
  statusHistory: StatusRec[]
  overseasAddress?: string
  hostelAddress?: string
  agent?: string
  documents: DocRec[]
  family: FamilyRec[]
  contractStart?: string
  contractEnd?: string
  minContractMonths?: number
  earlyPenalty?: number
  initialBasicPay: number
  increments: IncrementRec[]
  allowances: AllowanceRec[]
  bankName?: string
  bankAccount?: string
  remittance?: RemitRec[]
  loans: LoanRec[]
  deductions: DeductionRec[]
  annualLeaveDays?: number
  /** monthly payslips made with the payslip helper (salary data: hidden from roles that may not see pay) */
  payslips?: import('./pay').PayslipRec[]
  /** minimum-wage check switched off (e.g. not covered by the Order) — reason is kept for audit */
  minWageExempt?: boolean
  minWageExemptReason?: string
  /** accommodation (hostel) deduction set-up for Act 446 checks */
  hostelDeduction?: import('./pay').HostelDeduction
  leaves: LeaveRec[]
  memos: MemoRec[]
  notes: NoteRec[]
  exitDate?: string
  passportSafe?: PassportSafe
  /** manual status checks on government portals (FOMEMA, Immigration, …) */
  agencyChecks?: import('./agencies').AgencyCheck[]
  /** v1.2.2 trackers: first entry to Malaysia (10-year stay cap), employer / sector printed on the PLKS */
  firstArrivalDate?: string
  permitEmployer?: string
  permitSector?: string
  /** hostel from the hostel register (Act 446) */
  hostelId?: string
  /** v1.4 Approval & Recruitment: approval letter this worker uses, and the recruit record he came from */
  quotaId?: string
  recruitId?: string
  /** exit or absconding checklist */
  exitFlow?: import('./trackers').ExitFlow
  /** cost tracker (pay data: hidden from roles that may not see pay) */
  costs?: import('./trackers').CostRec[]
  zeroCost?: import('./trackers').ZeroCostRec
  pdpa?: import('./trackers').PdpaRec
  waOptIn?: boolean // worker agreed to WhatsApp messages (consent form / onboarding)
  waOptInAt?: string
  waOptOutVia?: string
  createdAt: string
  updatedAt: string
}

/** Remark on a worker by an outlet manager / HR (a separate synced record so outlet managers can add them without editing the worker). */
export interface Remark { id: string; workerId: string; text: string; kind?: 'remark' | 'performance' | 'incident' | 'praise'; at: string; by?: string; byId?: string; byRole?: string }

export type ConsentStatus = 'not_issued' | 'pending' | 'uploaded' | 'signed' | 'withdrawn'
export interface PassportMove {
  id: string; kind: 'deposit' | 'release' | 'return'; date: string; by?: string; reason?: string; expectedReturn?: string
  requestId?: string; slipDocId?: string; remarks?: string
}
/** Voluntary passport safekeeping (Passports Act 1966 s.12(1)(f): employers may not withhold a passport without consent). */
export interface PassportSafe {
  consent: ConsentStatus
  issuedAt?: string; issuedBy?: string
  uploadedAt?: string; uploadedBy?: string; consentDocId?: string
  signedAt?: string; verifiedBy?: string; withdrawnAt?: string; withdrawnReason?: string
  custody?: 'with_worker' | 'in_safe' | 'released'
  moves?: PassportMove[]
}

export interface Outlet { id: string; name: string; type: BusinessType; address?: string; manager?: string; companyId?: string; logo?: string; /** Malaysian state (public holidays, Act 446 scope) */ state?: string; /** weekly rest day, default Sunday */ restDay?: string }
export interface JobCategory { id: string; name: string; businessType: BusinessType }

export interface Settings {
  id: 'app'
  companyName: string
  leadTimes: number[]
  annualLeaveDays: number
  maxCarryForward: number // 0 = unlimited
  ticketEveryMonths: number
  ticketValue: number
  defaultMinContractMonths: number
  defaultPenalty: number
  overdueGraceDays: number
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'app',
  companyName: 'My Company Sdn Bhd',
  leadTimes: [90, 60, 30, 7],
  annualLeaveDays: 8,
  maxCarryForward: 0,
  ticketEveryMonths: 36,
  ticketValue: 1500,
  defaultMinContractMonths: 24,
  defaultPenalty: 3000,
  overdueGraceDays: 0,
}

export const DEFAULT_JOBS: Record<BusinessType, string[]> = {
  Restaurant: ['Cook', 'Assistant Cook', 'Waiter', 'Cashier', 'Kitchen Helper', 'Dishwasher', 'Supervisor'],
  'Convenience Shop': ['Cashier', 'Stock Keeper', 'Shop Assistant'],
  'Central Store': ['Storekeeper', 'Driver', 'Loader', 'Inventory Clerk'],
  Accounting: ['Account Assistant', 'Clerk'],
  Management: ['Manager', 'Supervisor', 'Admin'],
  Hotel: ['Housekeeping', 'Front Desk', 'Room Attendant', 'Laundry', 'Maintenance'],
  'Jewellery Shop': ['Sales Assistant', 'Goldsmith', 'Polisher', 'Security'],
}
