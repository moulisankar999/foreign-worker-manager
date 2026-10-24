import type { Perms } from '../lib/auth'
import { ADMIN } from './defs/admin'
import { COMPLIANCE } from './defs/compliance'
import { isLimited } from './defs/helpers'
import { LEAVE } from './defs/leave'
import { PAY } from './defs/pay'
import { WORKFORCE } from './defs/workforce'
import type { ReportDef } from './types'

export const REPORTS: ReportDef[] = [...WORKFORCE, ...COMPLIANCE, ...LEAVE, ...PAY, ...ADMIN]
export const GROUPS = [...new Set(REPORTS.map((r) => r.group))]
/** outlet managers / viewers get only the outlet-level sheets */
const LIMITED = ['headcount', 'master', 'profile', 'expiry', 'remarks']
export function reportsFor(p: Perms) {
  return REPORTS.filter((r) => (isLimited(p) ? LIMITED.includes(r.id) : r.who(p)))
}
export const reportById = (id: string) => REPORTS.find((r) => r.id === id)
