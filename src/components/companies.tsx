/* Super Admin: the list of companies, and which HR Admins may approve new sign-ups (companies + roles). */
import { useEffect, useState } from 'react'
import { Btn, Card, Chip } from './ui'
import { saveConfig, useConfig } from '../lib/config'
import { useOutlets } from '../lib/hooks'
import { DEFAULT_HR_RULE, newCompanyId, outletCompany, ruleFor, type HrApprovalRule } from '../lib/companies'
import { ROLE_LABEL } from '../lib/workflow'
import { supabase, type Profile, type Role } from '../lib/supabase'
import { normRole, useAuth } from '../lib/auth'
import { LogoEdit } from './logos'

export function CompaniesCard() {
  const cfg = useConfig()
  const outlets = useOutlets()
  const { isSuper, myCompanies, myOutlets } = useAuth()
  const all = cfg.companies.items
  const items = isSuper || (!myCompanies.length && !myOutlets.length) ? all
    : all.filter((c) => myCompanies.includes(c.id) || outlets.some((o) => myOutlets.includes(o.id) && outletCompany(o) === c.id))
  const [msg, setMsg] = useState('')
  const save = async (next: typeof items) => {
    try { await saveConfig('companies', { items: next.map((c) => ({ ...c, logo: all.find((x) => x.id === c.id)?.logo })) }); setMsg('Saved.') } catch (e) { setMsg('⚠️ ' + (e as Error).message) }
  }
  const add = () => {
    const name = prompt('Company name:')?.trim()
    if (!name) return
    if (all.some((c) => c.name.toLowerCase() === name.toLowerCase())) { alert('That company already exists.'); return }
    void save([...all, { id: newCompanyId(name, all.map((c) => c.id)), name }])
  }
  const rename = (id: string) => {
    const c = all.find((x) => x.id === id)!
    const name = prompt('New name:', c.name)?.trim()
    if (name && name !== c.name) void save(all.map((x) => (x.id === id ? { ...x, name } : x)))
  }
  const remove = (id: string) => {
    if (outlets.some((o) => outletCompany(o) === id)) { alert('Move its outlets to another company first (Settings → Companies & Outlets → edit).'); return }
    if (all.length <= 1) { alert('Keep at least one company.'); return }
    if (confirm('Delete this company?')) void save(all.filter((x) => x.id !== id))
  }
  return (
    <Card title={`Companies (${items.length})`} actions={isSuper && <Btn kind="primary" small icon="plus" onClick={add}>Add company</Btn>}>
      {!isSuper && <p className="muted small">Your companies. You can upload or change their logos (shown in the app and on forms, memos and slips).</p>}
      {isSuper && <p className="muted small">Each outlet belongs to one company. HR Admins / HR Managers / Viewers can be limited to some companies or outlets in Settings → Users (nobody limited = sees all). New staff can pick their company/outlet when they create an account. Logos (PNG/JPEG/SVG, resized to 512 px) appear in the app header, lists, worker profiles and on generated PDFs; only signed-in users of that company see them.</p>}
      <ul className="rows">
        {items.map((c) => {
          const n = outlets.filter((o) => outletCompany(o) === c.id)
          return (
            <li key={c.id}>
              <div className="r-main"><strong>{c.name}</strong><small>{n.length} outlet{n.length === 1 ? '' : 's'}{n.length ? ': ' + n.map((o) => o.name).join(', ') : ''}</small></div>
              <div className="r-act">
                <LogoEdit kind="company" id={c.id} path={c.logo} name={c.name} />
                {isSuper && <Btn small kind="ghost" icon="edit" title="Rename" onClick={() => rename(c.id)} />}
                {isSuper && <Btn small kind="ghost" icon="trash" title="Delete" onClick={() => remove(c.id)} />}
              </div>
            </li>
          )
        })}
      </ul>
      {msg && <p className="small" role="status">{msg}</p>}
    </Card>
  )
}

const GRANTABLE: Role[] = ['hr_admin', 'hr_manager', 'outlet_manager', 'viewer']
export function UserApprovalRulesCard() {
  const cfg = useConfig()
  const companies = cfg.companies.items
  const [admins, setAdmins] = useState<Profile[]>([])
  const [msg, setMsg] = useState('')
  useEffect(() => {
    void supabase.from('profiles').select('*').eq('status', 'active').in('role', ['hr_admin']).order('full_name').then(({ data }) => setAdmins((data || []) as Profile[]))
  }, [])
  const set = async (uid: string, patch: Partial<HrApprovalRule>) => {
    const cur = ruleFor(cfg.user_approvals, uid)
    try {
      await saveConfig('user_approvals', { hrAdmins: { ...cfg.user_approvals.hrAdmins, [uid]: { ...DEFAULT_HR_RULE, ...cur, ...patch } } })
      setMsg('Saved.')
    } catch (e) { setMsg('⚠️ ' + (e as Error).message) }
  }
  const tog = (list: string[], v: string, on: boolean) => (on ? [...new Set([...list, v])] : list.filter((x) => x !== v))
  return (
    <Card title="New-user approvals">
      <p className="small">You (Super Admin) always see and can approve <strong>every</strong> new sign-up — they appear on your dashboard under “Needs my action”. You can also let an HR Admin approve sign-ups for some companies. Sign-ups that chose no company (“unassigned”) are for you only.</p>
      {admins.length === 0 && <p className="muted small">No active HR Admins yet. Give someone the HR Admin role in Users first.</p>}
      <ul className="rows">
        {admins.filter((a) => normRole(a.role) === 'hr_admin').map((a) => {
          const r = ruleFor(cfg.user_approvals, a.id)
          const all = r.companies.includes('*')
          return (
            <li key={a.id} className="user-row">
              <div className="r-main">
                <strong>{a.full_name || a.email}</strong>
                <label className="check"><input type="checkbox" checked={r.enabled} onChange={(e) => set(a.id, { enabled: e.target.checked })} /> Allow this HR Admin to approve new users</label>
                {r.enabled && <>
                  <small className="muted">Companies he may approve for:</small>
                  <div className="row gap-s wrap">
                    <label className="check small"><input type="checkbox" checked={all} onChange={(e) => set(a.id, { companies: e.target.checked ? ['*'] : [] })} /> All companies</label>
                    {!all && companies.map((c) => <label key={c.id} className="check small"><input type="checkbox" checked={r.companies.includes(c.id)} onChange={(e) => set(a.id, { companies: tog(r.companies, c.id, e.target.checked) })} /> {c.name}</label>)}
                  </div>
                  <small className="muted">Roles he may give:</small>
                  <div className="row gap-s wrap">
                    {GRANTABLE.map((role) => <label key={role} className="check small"><input type="checkbox" checked={r.roles.includes(role)} onChange={(e) => set(a.id, { roles: tog(r.roles, role, e.target.checked) as Role[] })} /> {ROLE_LABEL[role]}{role === 'hr_admin' ? ' ⚠️' : ''}</label>)}
                  </div>
                  {!r.companies.length && <small className="warn">Pick at least one company — otherwise he cannot approve anyone.</small>}
                  {r.roles.includes('hr_admin') && <small className="warn">He may create other HR Admins.</small>}
                </>}
              </div>
              <div className="r-act">{r.enabled ? <Chip tone="green">Can approve</Chip> : <Chip>Off</Chip>}</div>
            </li>
          )
        })}
      </ul>
      <p className="muted small">Super Admin is never grantable by an HR Admin. Every approval is recorded (who / when) in the user list, the dashboard history and the audit log, and you get a notification “User X approved by HR Admin Y”.</p>
      {msg && <p className="small" role="status">{msg}</p>}
    </Card>
  )
}
