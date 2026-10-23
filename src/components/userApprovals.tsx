/* "Needs my action": new sign-ups with quick Approve (role + companies/outlets) / Reject, plus a short history. */
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Btn, Card, Chip } from './ui'
import { db } from '../lib/db'
import { useAuth } from '../lib/auth'
import { useConfig } from '../lib/config'
import { ROLES, ROLE_LABEL } from '../lib/workflow'
import { companyName, outletCompany, ruleFor, scopeLabel, type Company } from '../lib/companies'
import { approveUser, rejectUser, usePendingUsers } from '../lib/userApprovals'
import { fmtDate } from '../lib/util'
import type { Profile, Role } from '../lib/supabase'
import type { Outlet } from '../lib/types'

const when = (s?: string | null) => (s ? `${fmtDate(s.slice(0, 10))} ${new Date(s).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '')
export const byLine = (u: Profile) =>
  u.approved_at && u.status !== 'pending' && !u.rejected_at
    ? `Approved by ${u.approved_by_name || '—'} (${ROLE_LABEL[u.approved_by_role || ''] || u.approved_by_role || '—'}) · ${when(u.approved_at)}`
    : u.rejected_at ? `Rejected by ${u.rejected_by_name || '—'} (${ROLE_LABEL[u.rejected_by_role || ''] || u.rejected_by_role || '—'}) · ${when(u.rejected_at)}${u.reject_reason ? ` — ${u.reject_reason}` : ''}` : ''

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

export function PendingItem({ u, companies, outlets }: { u: Profile; companies: Company[]; outlets: Outlet[] }) {
  const { isSuper, session } = useAuth()
  const cfg = useConfig()
  const rule = ruleFor(cfg.user_approvals, session?.user.id || '')
  const roles: Role[] = isSuper ? [...ROLES] : ROLES.filter((r) => rule.roles.includes(r))
  const allowed: string[] | '*' = isSuper || rule.companies.includes('*') ? '*' : rule.companies
  const reqOutlet = outlets.find((o) => o.id === u.requested_outlet_id)
  const reqCompany = u.requested_company_id || (reqOutlet ? outletCompany(reqOutlet) : '')
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
    if (role === 'super_admin' && !confirm(`Make ${u.full_name || u.email} a Super Admin (full access to everything)?`)) return
    void run(() => approveUser(u.id, role, role === 'super_admin' ? [] : effective.companies, role === 'super_admin' ? [] : effective.outlets))
  }
  const reject = () => {
    const reason = prompt(`Reject ${u.full_name || u.email}? Optional reason:`, '')
    if (reason === null) return
    void run(() => rejectUser(u.id, reason.trim() || null))
  }
  return (
    <li className="pending-user">
      <div className="r-main">
        <strong>{u.full_name || '(no name)'}</strong>
        <small>{u.email} · signed up {when(u.created_at)}</small>
        <small>{reqOutlet ? <Chip tone="blue">{companyName(companies, reqCompany)} · {reqOutlet.name}</Chip> : reqCompany ? <Chip tone="blue">{companyName(companies, reqCompany)}</Chip> : <Chip tone="gray">Unassigned</Chip>}</small>
      </div>
      <div className="r-act">
        <select aria-label={`Role for ${u.email}`} value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={busy}>
          {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
        {needsScope && <Btn small kind="ghost" icon="store" onClick={() => setOpen(!open)}>{empty ? (isSuper && !omScope ? 'All companies' : 'Choose…') : scopeLabel(companies, outlets, effective.companies, effective.outlets).slice(0, 40)}</Btn>}
        <Btn small kind="primary" icon="check" disabled={busy} onClick={approve}>Approve</Btn>
        <Btn small kind="ghost" icon="x" disabled={busy} onClick={reject}>Reject</Btn>
      </div>
      {open && needsScope && (
        <div className="outlet-pick">
          <p className="muted small">{omScope ? 'Outlets he manages (ticking a company gives all its outlets):' : isSuper ? 'Companies / outlets this person may see. Leave everything empty for ALL companies.' : 'Companies / outlets this person may see:'}</p>
          <ScopePicker companies={companies} outlets={outlets} value={scope} onChange={setScope} allowed={allowed} />
        </div>
      )}
      {err && <p className="err small">{err}</p>}
    </li>
  )
}

/** shown at the top of the dashboard for the Super Admin and for HR Admins allowed to approve sign-ups */
export function PendingUsersPanel() {
  const { canApproveUsers } = useAuth()
  const cfg = useConfig()
  const { pending, recent, error } = usePendingUsers()
  const outlets = useLiveQuery(() => db.outlets.toArray(), [], [] as Outlet[])
  const [hist, setHist] = useState(false)
  if (!canApproveUsers || (!pending.length && !recent.length && !error)) return null
  const companies = cfg.companies.items
  return (
    <Card title={pending.length ? `👤 New users waiting for approval (${pending.length})` : '👤 New users'} className={pending.length ? 'card-alert' : ''}
      actions={recent.length > 0 ? <button className="link" onClick={() => setHist(!hist)}>{hist ? 'Hide history' : `History (${recent.length})`}</button> : undefined}>
      {error && <p className="err small">{error}</p>}
      {pending.length > 0 && <ul className="rows users">{pending.map((u) => <PendingItem key={u.id} u={u} companies={companies} outlets={outlets} />)}</ul>}
      {!pending.length && <p className="muted small">Nobody is waiting.</p>}
      {hist && (
        <ul className="rows compact">{recent.slice(0, 15).map((u) => (
          <li key={u.id}><div className="r-main"><strong>{u.full_name || u.email}</strong><small>{u.status === 'active' ? `${ROLE_LABEL[u.role] || u.role}${(u.company_ids?.length || u.outlet_ids?.length) ? ' · ' + scopeLabel(companies, outlets, u.company_ids, u.outlet_ids) : ''} · ` : ''}{byLine(u)}</small></div></li>
        ))}</ul>
      )}
    </Card>
  )
}
