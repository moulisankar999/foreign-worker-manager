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

export const DOC_TYPES = ['Passport', 'Work Permit / PLKS (VP(TE))', 'FOMEMA Medical', 'Insurance (SPIKPA / Hospitalisation)', 'SOCSO / PERKESO', 'Levy Payment', 'Other'] as const
export const REQUIRED_DOCS = ['Passport', 'Work Permit / PLKS (VP(TE))', 'FOMEMA Medical', 'Insurance (SPIKPA / Hospitalisation)']

export const RELATIONS = ['Wife', 'Husband', 'Son', 'Daughter', 'Father', 'Mother', 'Brother', 'Sister', 'Other']
export const LEAVE_TYPES = ['Annual', 'Home Leave', 'Medical', 'Emergency', 'Unpaid'] as const
export const APPROVAL = ['Pending', 'Approved', 'Rejected'] as const
export const TICKET_PAYERS = ['Company', 'Worker', 'Shared', 'Agent']
export const DEDUCTION_TYPES = ['Loan repayment', 'Advance', 'Penalty', 'Damage', 'Other']
export const LOAN_TYPES = ['Loan', 'Advance']
export const EXIT_TYPES: WorkerStatus[] = ['Resigned', 'Terminated', 'Contract Ended', 'Repatriated', 'Absconded']

export interface Attachment { name: string; type: string; dataUrl: string }

export interface DocRec { id: string; type: string; label?: string; number?: string; issueDate?: string; expiryDate?: string; remarks?: string; attachment?: Attachment }
export interface FamilyRec { id: string; relation: string; name: string; dob?: string; phone?: string; address?: string; isEmergency?: boolean; isNextOfKin?: boolean }
export interface IncrementRec { id: string; date: string; oldPay: number; newPay: number; reason?: string }
export interface AllowanceRec { id: string; name: string; amount: number }
export interface LoanRec { id: string; date: string; type: string; amount: number; purpose?: string; monthlyDeduction?: number }
export interface DeductionRec { id: string; date: string; amount: number; type: string; loanId?: string; remarks?: string }
export interface LeaveRec {
  id: string; type: string; from: string; to: string; days: number; status: string; approvedBy?: string; remarks?: string
  appliedOn?: string; returned?: boolean; returnedOn?: string
  ticketProvided?: boolean; ticketDetails?: string; ticketCost?: number; ticketPaidBy?: string
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
  loans: LoanRec[]
  deductions: DeductionRec[]
  annualLeaveDays?: number
  leaves: LeaveRec[]
  memos: MemoRec[]
  notes: NoteRec[]
  exitDate?: string
  createdAt: string
  updatedAt: string
}

export interface Outlet { id: string; name: string; type: BusinessType; address?: string; manager?: string }
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
