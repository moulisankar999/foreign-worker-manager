/* Companies (Mouli runs several businesses): every outlet belongs to one company; staff can be scoped to
 * companies and/or outlets. The list lives in app_config 'companies' (CEO edits). The server enforces
 * the scope (migration 007); these helpers only mirror it for the screens. */
import type { Outlet } from './types'
import type { Role } from './supabase'

export interface Company { id: string; name: string; logo?: string; /** demo company (e.g. for App Review): left out of totals, alerts and reports */ demo?: boolean
  /** v1.4.2 sample company (id "sample-…") for Approval & Recruitment: shown there with a SAMPLE tag, removed by Settings → Remove sample data */ sample?: boolean
  /** v1.4.2: business sector (shown to everyone who sees the company) */ sector?: string }
export interface CompaniesConfig { items: Company[] }
export const DEFAULT_COMPANY_ID = 'main'
export const DEFAULT_COMPANIES: CompaniesConfig = { items: [{ id: DEFAULT_COMPANY_ID, name: 'Main company' }] }

/** per HR Admin: may he approve new sign-ups, for which companies ('*' = all), giving which roles */
export interface HrApprovalRule { enabled: boolean; companies: string[]; roles: Role[] }
export interface UserApprovalsConfig { hrAdmins: Record<string, HrApprovalRule> }
export const DEFAULT_USER_APPROVALS: UserApprovalsConfig = { hrAdmins: {} }
export const DEFAULT_HR_RULE: HrApprovalRule = { enabled: false, companies: [], roles: ['outlet_manager', 'viewer'] }
export const ruleFor = (cfg: UserApprovalsConfig, uid: string): HrApprovalRule => ({ ...DEFAULT_HR_RULE, ...(cfg.hrAdmins?.[uid] || {}) })

export const outletCompany = (o?: Pick<Outlet, 'companyId'> | null) => o?.companyId || DEFAULT_COMPANY_ID
export const companyName = (items: Company[], id?: string | null) => (id ? items.find((c) => c.id === id)?.name || id : '')
/** 1.6.3: the company (display name) a worker belongs to, from his outlet ('' when the outlet or its company is unknown) */
export const outletCompanyName = (items: Company[], outlets: Pick<Outlet, 'id' | 'companyId'>[], outletId?: string | null) => {
  const o = outletId ? outlets.find((x) => x.id === outletId) : undefined
  return o?.companyId ? companyName(items, o.companyId) : ''
}

/** same rule as SQL scope_ok(): CEO everything; HR/viewer with no scope everything; else his outlets + his companies' outlets */
export function inScope(role: Role | null, companies: string[], outlets: string[], outletId: string | undefined, all: Outlet[]): boolean {
  if (!role) return false
  if (role === 'super_admin') return true
  if (role !== 'outlet_manager' && !companies.length && !outlets.length) return true
  if (!outletId) return false
  return outlets.includes(outletId) || companies.includes(outletCompany(all.find((o) => o.id === outletId)))
}
export const scopeLabel = (items: Company[], outletsAll: Outlet[], companies: string[] = [], outlets: string[] = []) =>
  [...companies.map((c) => companyName(items, c)), ...outlets.map((id) => outletsAll.find((o) => o.id === id)?.name || id)].join(', ')
export const newCompanyId = (name: string, taken: string[]) => {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'company'
  let id = base, i = 2
  while (taken.includes(id)) id = `${base}-${i++}`
  return id
}
/** v1.4.2: sample companies for Approval & Recruitment always have an id starting "sample-" (removed by Remove sample data) */
export const isSampleCompany = (id?: string | null) => !!id && id.startsWith('sample-')
