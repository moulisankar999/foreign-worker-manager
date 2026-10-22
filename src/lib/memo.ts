import type { ChecklistItem, MemoRec } from './types'

const items = (labels: string[]): ChecklistItem[] => labels.map((label) => ({ label, done: false }))

export function defaultChecklist(kind: MemoRec['kind']): ChecklistItem[] {
  if (kind === 'Exit Clearance')
    return items([
      'Uniforms returned',
      'Keys / access cards returned',
      'Tools, equipment & company property returned',
      'Outstanding loan / advance settled or deducted',
      'Final salary computed and paid',
      'Prorated early-termination penalty applied (if any)',
      'Passport with worker (returned / in worker custody)',
      'Return flight ticket booked',
      'Work permit / PLKS cancellation submitted (Immigration / FWCMS)',
      'Levy refund / cancellation processed',
      'Check-out memo / special pass arranged (if required)',
      'FOMEMA & insurance closed / noted',
      'SOCSO / EIS records updated',
      'Accommodation (hostel) cleared & inspected',
      'Exit interview done',
    ])
  if (kind === 'Return from Leave')
    return items([
      'Reported back to work on date',
      'Passport sighted (remains with worker)',
      'Work permit still valid',
      'FOMEMA / insurance still valid',
      'Accommodation re-assigned',
      'Uniforms / keys re-issued',
      'Leave days & ticket recorded in system',
      'Supervisor informed',
    ])
  return items([
    'Leave approved by manager',
    'Return flight ticket booked (to & from)',
    'Return date confirmed with worker',
    'Passport with worker for travel',
    'Work permit valid beyond return date',
    'FOMEMA / insurance valid beyond return date',
    'Salary paid up to last working day',
    'Outstanding loan / advance acknowledged',
    'Keys / tools handed to supervisor',
    'Accommodation arrangement noted (kept / vacated)',
    'Emergency contact & home phone confirmed',
    'Handover of duties completed',
  ])
}
