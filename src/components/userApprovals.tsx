/* "Needs my action": new sign-ups with quick Approve (role + companies/outlets) / Reject, plus a short history. */
import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Btn, Card, Chip } from './ui'
import { db } from '../lib/db'
import { useAuth } from '../lib/auth'
import { useConfig } from '../lib/config'
import { ROLES, ROLE_LABEL } from '../lib/workflow'
import { companyName, outletCompany, ruleFor, scopeLabel, type Company } from '../lib/companies'
import { approveUser, usePendingUsers } from '../lib/userApprovals'
import { userAdmin } from '../lib/userAdmin'
import { fmtDate } from '../lib/util'
import { DataTable, Details } from './dataTable'
import { Actions, IconAction } from './iconAction'
import { toast } from './toast'
import type { Profile, Role } from '../lib/supabase'
import type { Outlet } from '../lib/types'

const when = (s?: string | null) => (s ? `${fmtDate(s.slice(0, 10))} ${new Date(s).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '')
const roleOf = (r?: string | null) => ROLE_LABEL[r || ''] || r || ''
// the server leaves out who did it when that person is above the viewer: then only the action and the date show
export const byLine = (u: Profile) =>
  u.added_at && !u.rejected_at ? `Added${u.added_by_name ? ` by ${roleOf(u.added_by_role)} ${u.added_by_name}` : ''} · ${when(u.added_at)}`
  : u.approved_at && u.status !== 'pending' && !u.rejected_at
    ? `Approved${u.approved_by_name ? ` by ${u.approved_by_name} (${roleOf(u.approved_by_role) || '—'})` : ''} · ${when(u.approved_at)}`
    : u.rejected_at ? `Rejected${u.rejected_by_name ? ` by ${u.rejected_by_name} (${roleOf(u.rejected_by_role) || '—'})` : ''} · ${when(u.rejected_at)}${u.reject_reason ? ` — ${u.reject_reason}` : ''}` : ''

/** company + outlet checkboxes, limited to the companies the current person may hand out */
export function ScopePicker({ companies, outlets, value, onChange, allowed, outletsOnly }: {
  companies: Company[]; outlets: Outlet[]; value: { companies: string[]; outlets: string[] }
  onChange: (v: { companies: string[]; outlets: string[] }) => void; allowed: string[] | '*'; outletsOnly?: boolean
}) {
  const ok = (cid: string) => allowed === '*' || allowed.includes(cid)
  const toggle = (list: string[], id: string, on: boolean) => (on ? [...new Set([...list, id])] : list.filter((x) => x !== id))
  return (
    <div className="scope-pick">
      {companies.filter((c) => ok(c.id)).map((c) => {
        const outs = outlets.filter((o) => outletCompany(o) === c.id)
        const whole = value.companies.includes(c.id)
        return (
          <div key={c.id} className="scope-co">
            {outletsOnly ? <strong className="small">{c.name}</strong> : (
              <label className="check"><input type="checkbox" checked={whole} onChange={(e) => onChange({ ...value, companies: toggle(value.companies, c.id, e.target.checked) })} /> <strong>{c.name}</strong> <span className="muted small">(all outlets)</span></label>
            )}
            <div className="scope-outs">
              {outs.map((o) => (
                <label key={o.id} className="check small"><input type="checkbox" disabled={whole} checked={whole || value.outlets.includes(o.id)} onChange={(e) => onChange({ ...value, outlets: toggle(value.outlets, o.id, e.target.checked) })} /> {o.name}</label>
              ))}
              {!outs.length && <span className="muted small">no outlets yet</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** approve / reject rules for one pending sign-up (same as before; the server checks again) */
function usePending(u: Profile, outlets: Outlet[]) {
  const { isSuper: ceo, isGm, can, session } = useAuth()
  const isSuper = ceo || (isGm && can('users.approve')) // CEO, or a General Manager with this power
  const cfg = useConfig()
  const rule = ruleFor(cfg.user_approvals, session?.user.id || '')
  // always below the approver: CEO never another CEO; GM never CEO / GM
  const roles: Role[] = ceo ? ROLES.filter((r) => r !== 'super_admin') : isGm ? ROLES.filter((r) => r !== 'super_admin' && r !== 'general_manager') : ROLES.filter((r) => rule.roles.includes(r) && r !== 'super_admin' && r !== 'general_manager')
  const allowed: string[] | '*' = isSuper || rule.companies.includes('*') ? '*' : rule.companies
  const reqOutlet = outlets.find((o) => o.id === u.requested_outlet_id)
  const reqCompany = u.requested_company_id || (reqOutlet ? outletCompany(reqOutlet) : '')
  return { isSuper, roles, allowed, reqOutlet, reqCompany }
}

const requestedChip = (companies: Company[], reqCompany: string, reqOutlet?: Outlet) =>
  reqOutlet ? <Chip tone="blue">{companyName(companies, reqCompany)} · {reqOutlet.name}</Chip> : reqCompany ? <Chip tone="blue">{companyName(companies, reqCompany)}</Chip> : <Chip tone="gray">Unassigned</Chip>

/** row icons: Approve (opens the row to pick role + outlets), Reject, Delete sign-up */
function PendingActions({ u, onApprove }: { u: Profile; onApprove: () => void }) {
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn() } catch (e) { toast((e as Error).message, 'err') } finally { setBusy(false) } }
  const reject = () => {
    const reason = prompt(`Reject ${u.full_name || u.email}?\n\nThe request and its login are removed (it is noted in the audit log). Optional reason:`, '')
    if (reason === null) return
    void run(async () => { await userAdmin('reject_pending', u.id, { note: reason.trim() || undefined }) })
  }
  const remove = () => {
    if (!confirm(`Delete the sign-up of ${u.email}?\n\nUse this for spam or duplicate sign-ups. The request and its login are removed; the email address can sign up again later.`)) return
    void run(async () => { await userAdmin('delete_pending', u.id) })
  }
  return (
    <Actions>
      <IconAction kind="approve" label="Approve — choose role and outlets" disabled={busy} onClick={onApprove} />
      <IconAction kind="reject" label="Reject sign-up" disabled={busy} onClick={reject} />
      <IconAction kind="delete" label="Delete sign-up (spam / duplicate)" disabled={busy} onClick={remove} />
    </Actions>
  )
}

/** opened row: choose role + companies / outlets, then Approve */
export function PendingItem({ u, companies, outlets }: { u: Profile; companies: Company[]; outlets: Outlet[] }) {
  const { isSuper, roles, allowed, reqOutlet, reqCompany } = usePending(u, outlets)
  const [role, setRole] = useState<Role>(reqOutlet && roles.includes('outlet_manager') ? 'outlet_manager' : roles.includes('viewer') ? 'viewer' : roles[0])
  const [scope, setScope] = useState<{ companies: string[]; outlets: string[] }>(() =>
    reqOutlet ? { companies: [], outlets: [reqOutlet.id] } : reqCompany ? { companies: [reqCompany], outlets: [] } : { companies: [], outlets: [] })
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const needsScope = role !== 'super_admin'
  const omScope = role === 'outlet_manager'
  const effective = omScope ? { companies: [], outlets: [...new Set([...scope.outlets, ...outlets.filter((o) => scope.companies.includes(outletCompany(o))).map((o) => o.id)])] } : scope
  const empty = !effective.companies.length && !effective.outlets.length
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(''); try { await fn() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) } }
  const approve = () => {
    if (needsScope && empty && (!isSuper || omScope)) { setOpen(true); setErr(omScope ? 'Choose the outlet(s) for this outlet manager.' : 'Choose the company / outlets this person works for.'); return }
    if (role === 'super_admin' && !confirm(`Make ${u.full_name || u.email} the CEO (full access to everything)?`)) return
    void run(() => approveUser(u.id, role, role === 'super_admin' ? [] : effective.companies, role === 'super_admin' ? [] : effective.outlets))
  }
  return (
    <div className="pending-user">
      <Details items={[['Signed up', when(u.created_at)], ['Asked for', requestedChip(companies, reqCompany, reqOutlet)]]} />
      <div className="user-edit">
        <label className="small">Role{' '}
          <select aria-label={`Role for ${u.email}`} value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={busy}>
            {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </label>
        {needsScope && <Btn small kind="ghost" icon="store" onClick={() => setOpen(!open)}>{empty ? (isSuper && !omScope ? 'All companies' : 'Choose…') : scopeLabel(companies, outlets, effective.companies, effective.outlets).slice(0, 40)}</Btn>}
        <Btn small kind="primary" icon="check" disabled={busy} onClick={approve}>Approve</Btn>
      </div>
      {open && needsScope && (
        <div className="outlet-pick">
          <p className="muted small">{omScope ? 'Outlets he manages (ticking a company gives all its outlets):' : isSuper ? 'Companies / outlets this person may see. Leave everything empty for ALL companies.' : 'Companies / outlets this person may see:'}</p>
          <ScopePicker companies={companies} outlets={outlets} value={scope} onChange={setScope} allowed={allowed} />
        </div>
      )}
      {err && <p className="err small">{err}</p>}
    </div>
  )
}

/** pending sign-ups as a table: click a row (or the Approve icon) to choose role + outlets and approve */
export function PendingTable({ users, companies, outlets }: { users: Profile[]; companies: Company[]; outlets: Outlet[] }) {
  const [open, setOpen] = useState<{ key: string } | null>(null)
  return (
    <DataTable label="New users waiting for approval" rows={users} rowKey={(u) => u.id} open={open} rowTestId={(u) => `pending-${u.email}`}
      search={(u) => `${u.full_name} ${u.email}`} searchLabel="Search sign-ups" initialSort={{ key: 'when', dir: 'asc' }}
      columns={[
        { key: 'name', label: 'Name', main: true, sort: (u) => (u.full_name || u.email || '').toLowerCase(), render: (u) => <>{u.full_name || '(no name)'}<small>{u.email}</small></> },
        { key: 'asked', label: 'Asked for', hide: 'phone', render: (u) => <ReqChip u={u} companies={companies} outlets={outlets} /> },
        { key: 'when', label: 'Signed up', hide: 'tablet', sort: (u) => u.created_at || '', render: (u) => <span className="small">{when(u.created_at)}</span> },
      ]}
      actions={(u) => <PendingActions u={u} onApprove={() => setOpen({ key: u.id })} />}
      expand={(u) => <PendingItem u={u} companies={companies} outlets={outlets} />} />
  )
}
function ReqChip({ u, companies, outlets }: { u: Profile; companies: Company[]; outlets: Outlet[] }) {
  const reqOutlet = outlets.find((o) => o.id === u.requested_outlet_id)
  return requestedChip(companies, u.requested_company_id || (reqOutlet ? outletCompany(reqOutlet) : ''), reqOutlet)
}

/** shown at the top of the dashboard for the CEO and for HR Admins allowed to approve sign-ups */
export function PendingUsersPanel() {
  const { canApproveUsers } = useAuth()
  const cfg = useConfig()
  const { pending, recent, error } = usePendingUsers()
  const outlets = useLiveQuery(() => db.outlets.toArray(), [], [] as Outlet[])
  const [hist, setHist] = useState(false)
  const inSettings = useLocation().pathname.startsWith('/settings')
  if (!canApproveUsers || (!pending.length && !recent.length && !error)) return null
  const companies = cfg.companies.items
  return (
    <Card title={pending.length ? `👤 New users waiting for approval (${pending.length})` : '👤 New users'} className={pending.length ? 'card-alert' : ''}
      actions={<span className="row gap-s">{recent.length > 0 && <button className="link" onClick={() => setHist(!hist)}>{hist ? 'Hide history' : `History (${recent.length})`}</button>}{!inSettings && <Link className="link" to="/settings/users">All users →</Link>}</span>}>
      {error && <p className="err small">{error}</p>}
      {pending.length > 0 && <PendingTable users={pending} companies={companies} outlets={outlets} />}
      {!pending.length && <p className="muted small">Nobody is waiting.</p>}
      {hist && (
        <DataTable label="Sign-up history" dense rows={recent.slice(0, 15)} rowKey={(u) => u.id}
          columns={[
            { key: 'name', label: 'Name', main: true, render: (u) => <>{u.full_name || u.email}<small>{u.email}</small></> },
            { key: 'out', label: 'Outcome', render: (u) => u.status === 'active' ? <Chip tone="green">{ROLE_LABEL[u.role] || u.role}</Chip> : u.rejected_at ? <Chip tone="red">Rejected</Chip> : <Chip tone="gray">{u.status}</Chip> },
            { key: 'by', label: 'By', hide: 'phone', render: (u) => <span className="small">{byLine(u)}</span> },
          ]}
          expand={(u) => <Details items={[['Email', u.email], ['Role', u.status === 'active' ? ROLE_LABEL[u.role] || u.role : ''], ['Sees', (u.company_ids?.length || u.outlet_ids?.length) ? scopeLabel(companies, outlets, u.company_ids, u.outlet_ids) : ''], ['History', byLine(u)]]} />} />
      )}
    </Card>
  )
}
