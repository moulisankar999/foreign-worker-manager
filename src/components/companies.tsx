/* Companies (v1.4.2: add via the side panel, open details, delete CEO / GM only — server-enforced) and and which HR Admins may approve new sign-ups (companies + roles). */
import { useEffect, useState } from 'react'
import { Btn, Card, Chip } from './ui'
import { saveConfig, useConfig } from '../lib/config'
import { useOutlets } from '../lib/hooks'
import { DEFAULT_HR_RULE, outletCompany, ruleFor, type HrApprovalRule } from '../lib/companies'
import { ROLE_LABEL } from '../lib/workflow'
import { supabase, type Profile, type Role } from '../lib/supabase'
import { normRole, useAuth } from '../lib/auth'
import { LogoEdit, LogoImg } from './logos'
import { DataTable, Details } from './dataTable'
import { Actions, IconAction } from './iconAction'
import { CompanyPanel } from './companyPanel'
import { toast } from './toast'
import { deleteCompany } from '../lib/companyRecords'
import { useNavigate } from 'react-router-dom'

export function CompaniesCard() {
  const cfg = useConfig()
  const outlets = useOutlets()
  const nav = useNavigate()
  const { top, myCompanies, myOutlets, canCreateCompany, canDeleteCompany, canSeeCompanyDetails, isSuper: isCeo, isGm } = useAuth()
  const isSuper = top('org.companies') || isCeo || isGm // CEO / General Manager see every company
  const all = cfg.companies.items
  const items = isSuper || (!myCompanies.length && !myOutlets.length) ? all
    : all.filter((c) => myCompanies.includes(c.id) || outlets.some((o) => myOutlets.includes(o.id) && outletCompany(o) === c.id))
  const [adding, setAdding] = useState(false)
  const nOut = (id: string) => outlets.filter((o) => outletCompany(o) === id).length
  const remove = (id: string) => deleteCompany(id).then(() => toast('Company deleted'), (e) => toast((e as Error).message, 'err'))
  return (
    <Card title={`Companies (${items.length})`} actions={canCreateCompany && <Btn kind="primary" small icon="plus" onClick={() => setAdding(true)}>Add company</Btn>}>
      <p className="muted small">{isSuper ? 'Each outlet belongs to one company. Staff can be limited to some companies or outlets in Settings → Users (nobody limited = sees all). Open a company for its SSM details, documents and directors. Logos appear in the app header, lists, worker profiles and on generated PDFs.'
        : 'Your companies. Open one for its details; you can upload or change logos (shown in the app and on forms, memos and slips).'}</p>
      <DataTable label="Companies" rows={items} rowKey={(c) => c.id} rowTestId={(c) => `company-${c.id}`}
        search={(c) => `${c.name} ${c.sector || ''} ${outlets.filter((o) => outletCompany(o) === c.id).map((o) => o.name).join(' ')}`} searchLabel="Search companies"
        columns={[
          { key: 'name', label: 'Company', main: true, sort: (c) => c.name.toLowerCase(), render: (c) => <span className="dt-person"><LogoImg path={c.logo} size={30} title={c.name} /><span>{c.name}{c.sector && <small>{c.sector}</small>}</span></span> },
          { key: 'n', label: 'Outlets', align: 'right', sort: (c) => nOut(c.id), render: (c) => nOut(c.id) },
          { key: 'list', label: 'Outlet names', hide: 'tablet', render: (c) => <span className="small dt-clip">{outlets.filter((o) => outletCompany(o) === c.id).map((o) => o.name).join(', ') || '—'}</span> },
        ]}
        actions={(c) => <Actions>
          {canSeeCompanyDetails && <IconAction kind="view" label="Open company details (SSM, directors)" onClick={() => nav(`/companies/${encodeURIComponent(c.id)}`)} testId={`open-company-${c.id}`} />}
          {canDeleteCompany && <IconAction kind="delete" label="Delete company (only when it has no outlets, workers or quota letters)" confirm={`Delete ${c.name} with its details, SSM copies and directors?`} onClick={() => remove(c.id)} />}
        </Actions>}
        expand={(c) => (
          <>
            <Details items={[['Sector', c.sector || '—'], ['Outlets', outlets.filter((o) => outletCompany(o) === c.id).map((o) => o.name).join(', ') || 'No outlets yet']]} />
            <div className="mt-s"><span className="small muted">Logo: </span><LogoEdit kind="company" id={c.id} path={c.logo} name={c.name} /></div>
          </>
        )} />
      {adding && <CompanyPanel onClose={() => setAdding(false)} onCreated={(id) => nav(`/companies/${encodeURIComponent(id)}`)} />}
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
    void supabase.from('profiles_v').select('*').eq('status', 'active').in('role', ['hr_admin']).order('full_name').then(({ data }) => setAdmins((data || []) as Profile[]))
  }, [])
  const set = async (uid: string, patch: Partial<HrApprovalRule>) => {
    const cur = ruleFor(cfg.user_approvals, uid)
    try {
      await saveConfig('user_approvals', { hrAdmins: { ...cfg.user_approvals.hrAdmins, [uid]: { ...DEFAULT_HR_RULE, ...cur, ...patch } } })
      setMsg('Saved.')
    } catch (e) { setMsg('⚠️ ' + (e as Error).message) }
  }
  const tog = (list: string[], v: string, on: boolean) => (on ? [...new Set([...list, v])] : list.filter((x) => x !== v))
  const isGmView = useAuth().isGm
  return (
    <Card title="New-user approvals" fold="closed">
      <p className="small">{isGmView ? 'You (General Manager, with the approve power)' : 'You (the CEO)'} always see and can approve <strong>every</strong> new sign-up — they appear on your dashboard under “Needs my action”. You can also let an HR Admin approve sign-ups for some companies. Sign-ups that chose no company (“unassigned”) are for you only.</p>
      {admins.length === 0 && <p className="muted small">No active HR Admins yet. Give someone the HR Admin role in Users first.</p>}
      <DataTable label="HR Admins who may approve new users" rows={admins.filter((a) => normRole(a.role) === 'hr_admin')} rowKey={(a) => a.id}
        columns={[
          { key: 'name', label: 'HR Admin', main: true, sort: (a) => (a.full_name || a.email || '').toLowerCase(), render: (a) => <>{a.full_name || a.email}<small>{a.email}</small></> },
          { key: 'on', label: 'Approves sign-ups', render: (a) => (ruleFor(cfg.user_approvals, a.id).enabled ? <Chip tone="green">Can approve</Chip> : <Chip>Off</Chip>) },
          { key: 'cos', label: 'Companies', hide: 'phone', render: (a) => { const r = ruleFor(cfg.user_approvals, a.id); return <span className="small">{!r.enabled ? '—' : r.companies.includes('*') ? 'All companies' : r.companies.map((id) => companies.find((c) => c.id === id)?.name || id).join(', ') || 'None yet'}</span> } },
        ]}
        expand={(a) => {
          const r = ruleFor(cfg.user_approvals, a.id)
          const all = r.companies.includes('*')
          return (
            <div className="user-row">
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
          )
        }} />
      <p className="muted small">CEO is never grantable by an HR Admin. Every approval is recorded (who / when) in the user list, the dashboard history and the audit log, and you get a notification “User X approved by HR Admin Y”.</p>
      {msg && <p className="small" role="status">{msg}</p>}
    </Card>
  )
}
