import { db, ensureSeed } from './db'
import { getConfig } from './config'
import type { BusinessType, DocRec, LeaveRec, Outlet, Worker, WorkerStatus } from './types'
import { addDays, addMonths, todayISO, uid } from './util'

/** Clearly FAKE demo data. Names are invented and prefixed "DEMO". */
const OUTLETS: [string, BusinessType][] = [
  ['DEMO Nasi Kandar – Jalan Ampang', 'Restaurant'],
  ['DEMO Banana Leaf – Brickfields', 'Restaurant'],
  ['DEMO Mart 24 – Cheras', 'Convenience Shop'],
  ['DEMO Mart 24 – Klang', 'Convenience Shop'],
  ['DEMO Central Warehouse – Shah Alam', 'Central Store'],
  ['DEMO Finance Office – KL', 'Accounting'],
  ['DEMO HQ Management', 'Management'],
  ['DEMO Grand Hotel – Melaka', 'Hotel'],
  ['DEMO Gold & Jewels – Masjid India', 'Jewellery Shop'],
]

const PEOPLE: [string, string, string, string][] = [
  // name, nationality, gender, religion
  ['DEMO Rahim Uddin', 'Bangladesh', 'Male', 'Islam'], ['DEMO Suman Thapa', 'Nepal', 'Male', 'Hindu'], ['DEMO Arjun Kumar', 'India', 'Male', 'Hindu'],
  ['DEMO Siti Rahayu', 'Indonesia', 'Female', 'Islam'], ['DEMO Aung Kyaw', 'Myanmar', 'Male', 'Buddhist'], ['DEMO Imran Ali', 'Pakistan', 'Male', 'Islam'],
  ['DEMO Nguyen Van An', 'Vietnam', 'Male', 'Buddhist'], ['DEMO Maria Santos', 'Philippines', 'Female', 'Christian'], ['DEMO Nimal Perera', 'Sri Lanka', 'Male', 'Buddhist'],
  ['DEMO Somchai Dee', 'Thailand', 'Male', 'Buddhist'], ['DEMO Sokha Chan', 'Cambodia', 'Female', 'Buddhist'], ['DEMO Karim Hossain', 'Bangladesh', 'Male', 'Islam'],
  ['DEMO Bikash Gurung', 'Nepal', 'Male', 'Hindu'], ['DEMO Ravi Shankar', 'India', 'Male', 'Hindu'], ['DEMO Dewi Lestari', 'Indonesia', 'Female', 'Islam'],
  ['DEMO Min Thu', 'Myanmar', 'Male', 'Buddhist'], ['DEMO Asif Khan', 'Pakistan', 'Male', 'Islam'], ['DEMO Tran Thi Lan', 'Vietnam', 'Female', 'Buddhist'],
  ['DEMO Joseph Reyes', 'Philippines', 'Male', 'Christian'], ['DEMO Kamal Silva', 'Sri Lanka', 'Male', 'Christian'], ['DEMO Shahid Mia', 'Bangladesh', 'Male', 'Islam'],
  ['DEMO Prakash Rai', 'Nepal', 'Male', 'Hindu'], ['DEMO Lakshmi Devi', 'India', 'Female', 'Hindu'], ['DEMO Budi Santoso', 'Indonesia', 'Male', 'Islam'],
]

const JOBS: Record<BusinessType, string[]> = {
  Restaurant: ['Cook', 'Assistant Cook', 'Waiter', 'Cashier', 'Kitchen Helper', 'Dishwasher', 'Supervisor'],
  'Convenience Shop': ['Cashier', 'Stock Keeper', 'Shop Assistant'],
  'Central Store': ['Storekeeper', 'Driver', 'Loader', 'Inventory Clerk'],
  Accounting: ['Account Assistant', 'Clerk'],
  Management: ['Manager', 'Supervisor', 'Admin'],
  Hotel: ['Housekeeping', 'Front Desk', 'Room Attendant', 'Laundry', 'Maintenance'],
  'Jewellery Shop': ['Sales Assistant', 'Goldsmith', 'Polisher', 'Security'],
}

/** 1.6.2: every outlet needs a company. Sample outlets go to the first real (non-demo) company the user may use
 * (`myCompanies` empty = all companies). */
export async function loadSampleData(myCompanies: string[] = []) {
  await ensureSeed()
  const t = todayISO()
  const cos = getConfig().companies.items.filter((c) => !myCompanies.length || myCompanies.includes(c.id))
  const co = cos.find((c) => !c.demo && !c.sample)?.id || cos[0]?.id
  if (!co) throw new Error('Add a company first: every outlet needs a company.')
  const outlets: Outlet[] = OUTLETS.map(([name, type]) => ({ id: uid(), name, type, address: 'DEMO address, Malaysia', manager: 'DEMO Manager', companyId: co }))
  await db.outlets.bulkPut(outlets)
  // expiry offsets (days from today) to create a mix of expired / expiring / valid
  const expOffsets = [-12, 5, 18, 25, 40, 55, 75, 88, 120, 200, 300, 400, -3, 9, 33, 64, 150, 260, 365, 500, 28, 70, 180, 15]
  const workers: Worker[] = PEOPLE.map(([fullName, nationality, gender, religion], i) => {
    const o = outlets[i % outlets.length]
    const jobs = JOBS[o.type]
    const joinMonthsAgo = [8, 14, 26, 37, 40, 50, 75, 6, 30, 44, 20, 39][i % 12]
    const joinDate = addMonths(t, -joinMonthsAgo)
    const basic = 1700 + (i % 6) * 100
    const exp = expOffsets[i]
    const docs: DocRec[] = [
      { id: uid(), type: 'Passport', number: `DEMO${100000 + i * 37}`, issueDate: addMonths(t, -40), expiryDate: addDays(t, exp + 300) },
      { id: uid(), type: 'Work Permit / PLKS (VP(TE))', number: `VP${200000 + i * 11}`, issueDate: addMonths(addDays(t, exp), -12), expiryDate: addDays(t, exp) },
      { id: uid(), type: 'FOMEMA Medical', number: `FM${3000 + i}`, issueDate: addMonths(addDays(t, exp + 20), -12), expiryDate: addDays(t, exp + 20) },
      { id: uid(), type: 'SOCSO / PERKESO', number: `SO${5000 + i}`, issueDate: joinDate },
      { id: uid(), type: 'Levy Payment', number: `LV${7000 + i}`, issueDate: addMonths(addDays(t, exp), -12), expiryDate: addDays(t, exp) },
    ]
    if (i % 5 !== 3) docs.push({ id: uid(), type: 'Insurance (SPIKPA / Hospitalisation)', number: `IN${9000 + i}`, issueDate: addMonths(addDays(t, exp + 10), -12), expiryDate: addDays(t, exp + 10) })
    if (i % 7 === 2) docs.push({ id: uid(), type: 'Other', label: 'Food Handler Certificate', number: `FH${i}`, expiryDate: addDays(t, 45) })
    let status: WorkerStatus = 'Active-Working'
    const leaves: LeaveRec[] = [
      { id: uid(), type: 'Annual', from: addMonths(t, -5), to: addDays(addMonths(t, -5), 2), days: 3, status: 'Approved', approvedBy: 'DEMO Manager', appliedOn: addMonths(t, -6), returned: true, returnedOn: addDays(addMonths(t, -5), 3) },
    ]
    if (i === 4) { status = 'Home Leave'; leaves.push({ id: uid(), type: 'Home Leave', from: addDays(t, -25), to: addDays(t, -2), days: 24, status: 'Approved', approvedBy: 'DEMO HR', ticketProvided: true, ticketDetails: 'KUL → Yangon return, DEMO Air', ticketCost: 1450, ticketPaidBy: 'Company' }) }
    if (i === 6) { status = 'On Leave'; leaves.push({ id: uid(), type: 'Emergency', from: addDays(t, -3), to: addDays(t, 4), days: 8, status: 'Approved', approvedBy: 'DEMO Manager', remarks: 'Family emergency' }) }
    if (i === 9) leaves.push({ id: uid(), type: 'Home Leave', from: addDays(t, 14), to: addDays(t, 44), days: 31, status: 'Approved', approvedBy: 'DEMO HR', ticketProvided: false, ticketPaidBy: 'Company' })
    if (i === 11) leaves.push({ id: uid(), type: 'Annual', from: addDays(t, 10), to: addDays(t, 13), days: 4, status: 'Pending' })
    if (i === 13) { status = 'Medical Leave'; leaves.push({ id: uid(), type: 'Medical', from: addDays(t, -2), to: addDays(t, 5), days: 8, status: 'Approved', approvedBy: 'DEMO Manager' }) }
    if (i === 5) leaves.push({ id: uid(), type: 'Home Leave', from: addMonths(t, -14), to: addDays(addMonths(t, -14), 30), days: 31, status: 'Approved', returned: true, returnedOn: addDays(addMonths(t, -14), 30), ticketProvided: true, ticketDetails: 'KUL → Lahore return', ticketCost: 1600, ticketPaidBy: 'Company' })
    const loanId = uid()
    const hasLoan = i % 3 === 0
    const w: Worker = {
      id: uid(), workerNo: `FW${String(1001 + i)}`, fullName, nationality, gender, religion,
      dob: addMonths(t, -12 * (24 + (i % 15)) - i),
      phoneMY: `+60 12-000 ${String(1000 + i).slice(-4)}`, phoneHome: '+000 0000 0000 (demo)',
      outletId: o.id, businessType: o.type, jobCategory: jobs[i % jobs.length], skillLevel: ['Skilled', 'Semi-skilled', 'Unskilled'][i % 3],
      joinDate, status,
      statusHistory: [{ id: uid(), date: joinDate, to: 'Active-Working', remarks: 'Joined' }, ...(status !== 'Active-Working' ? [{ id: uid(), date: addDays(t, -3), from: 'Active-Working', to: status }] : [])],
      overseasAddress: `DEMO Village ${i + 1}, DEMO District, ${nationality}`,
      hostelAddress: `DEMO Hostel Block ${String.fromCharCode(65 + (i % 4))}-${10 + i}, Kuala Lumpur`,
      agent: 'DEMO Recruitment Agency Sdn Bhd',
      documents: docs,
      family: [
        { id: uid(), relation: gender === 'Male' ? 'Wife' : 'Husband', name: `DEMO Spouse ${i + 1}`, phone: '+000 0000 0001', address: `DEMO Village ${i + 1}`, isEmergency: true, isNextOfKin: true },
        { id: uid(), relation: 'Mother', name: `DEMO Mother ${i + 1}`, phone: '+000 0000 0002' },
        ...(i % 2 === 0 ? [{ id: uid(), relation: 'Son', name: `DEMO Child ${i + 1}`, dob: addMonths(t, -12 * (3 + (i % 8))) }] : []),
      ],
      contractStart: joinDate, contractEnd: i % 8 === 1 ? addDays(t, 20 + i) : addMonths(joinDate, 24 * (Math.floor(joinMonthsAgo / 24) + 1)), minContractMonths: 24, earlyPenalty: 3000,
      initialBasicPay: basic,
      increments: joinMonthsAgo > 13 ? [{ id: uid(), date: addMonths(joinDate, 12), oldPay: basic, newPay: basic + 100, reason: 'Annual increment' }, ...(joinMonthsAgo > 25 ? [{ id: uid(), date: addMonths(joinDate, 24), oldPay: basic + 100, newPay: basic + 200, reason: 'Annual increment' }] : [])] : [],
      allowances: [{ id: uid(), name: 'Attendance', amount: 100 }, ...(i % 2 ? [{ id: uid(), name: 'Meal', amount: 150 }] : [])],
      loans: hasLoan ? [{ id: loanId, date: addMonths(t, -4), type: i % 2 ? 'Advance' : 'Loan', amount: 1200, purpose: 'Family remittance (demo)', monthlyDeduction: 200 }] : [],
      deductions: hasLoan ? [1, 2, 3].map((m) => ({ id: uid(), date: addMonths(t, -4 + m), amount: 200, type: 'Loan repayment', loanId })) : [],
      leaves, memos: [],
      notes: [{ id: uid(), date: joinDate, text: 'DEMO record — sample data, not a real person.' }],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }
    return w
  })
  // an exited worker
  const ex = workers[workers.length - 1]
  ex.status = 'Resigned'; ex.exitDate = addMonths(t, -1)
  ex.statusHistory.push({ id: uid(), date: ex.exitDate, from: 'Active-Working', to: 'Resigned', remarks: 'Resigned before minimum period' })
  await db.workers.bulkPut(workers)
}
