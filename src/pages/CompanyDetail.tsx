/* v1.4.2 company page: details, SSM copies and directors in three tabs (fits one screen; rows open on tap).
 * What shows depends on the role — the server enforces the same (migration 045). */
import { AttachButton, companySrc, openAttach, saveAttach } from '../components/attach'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Btn, Card, Chip, Empty, KV, Modal, Tabs, Skeleton } from '../components/ui'
import { Actions, IconAction } from '../components/iconAction'
import { DataTable, Details } from '../components/dataTable'
import { FilePick } from '../components/filePick'
import { LogoEdit, LogoImg } from '../components/logos'
import { toast } from '../components/toast'
import { useAuth } from '../lib/auth'
import { useConfig, useConfigLoaded } from '../lib/config'
import { useOutlets } from '../lib/hooks'
import { isSampleCompany, outletCompany } from '../lib/companies'
import { fmtDate } from '../lib/util'
import {
  DESIGNATIONS, SECTOR_OPTIONS, SSM_DOC_TYPES, addDoc, deleteCompany, deleteDirector, deleteDoc, designationLabel, directorIssue, docTypeLabel, emailIssue, fmtIc,
  loadCompany, phoneIssue, saveDetails, saveDirector, ssmIssue, updateBasic, uploadCompanyFile, type CompanyDetails, type CompanyDoc, type Director, type NewDirector,
} from '../lib/companyRecords'

type Tab = 'details' | 'ssm' | 'directors'
const idSrc = (path: string) => companySrc(path, 'IC-passport copy' + (path.match(/\.[a-z0-9]+$/i)?.[0] || ''))
const ssmSrc = (x: CompanyDoc) => companySrc(x.path, x.name, x.mime, x.size)
const expiring = (d?: string | null) => !!d && d < new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10)

export default function CompanyDetailPage() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const cfg = useConfig()
  const cfgLoaded = useConfigLoaded()
  const outlets = useOutlets()
  const auth = useAuth()
  const co = cfg.companies.items.find((c) => c.id === id)
  const [tab, setTab] = useState<Tab>('details')
  const [data, setData] = useState<{ details: CompanyDetails | null; docs: CompanyDoc[]; directors: Director[] } | null>(null)
  const [err, setErr] = useState('')
  const [edit, setEdit] = useState(false)
  const [dirForm, setDirForm] = useState<(Partial<NewDirector> & { id?: string }) | null>(null)
  const reload = useCallback(async () => { if (!auth.canSeeCompanyDetails) return; try { setData(await loadCompany(id)) } catch (e) { setErr((e as Error).message) } }, [id, auth.canSeeCompanyDetails])
  useEffect(() => { void reload() }, [reload])
  if (!co && !cfgLoaded) return <Card title="Company"><Skeleton /></Card>
  if (!co) return <Card title="Company"><Empty title="Company not found">It may have been removed, or it is not one of your companies. <Link to="/settings/org">Back to companies</Link></Empty></Card>
  const nOut = outlets.filter((o) => outletCompany(o) === id).length
  const head = (
    <div className="co-head" data-testid="company-head">
      <LogoImg path={co.logo} size={44} title={co.name} />
      <div style={{ flex: 1, minWidth: 0 }}><h2>{co.name}</h2><small className="muted">{co.sector || 'Sector not set'} · {nOut} outlet{nOut === 1 ? '' : 's'}</small></div>
      {isSampleCompany(id) && <Chip tone="amber">SAMPLE</Chip>}
      <Actions>
        {auth.canSeeCompanyDetails && <IconAction kind="edit" label="Edit company details" onClick={() => setEdit(true)} />}
        {auth.canDeleteCompany && <IconAction kind="delete" label="Delete company (only when it has no outlets, workers or quota letters)" confirm={`Delete ${co.name} with its details, SSM copies and directors?`}
          onClick={() => deleteCompany(id).then(() => { toast('Company deleted'); nav('/settings/org') }, (e) => toast((e as Error).message, 'err'))} />}
      </Actions>
    </div>
  )
  if (!auth.canSeeCompanyDetails) return <Card>{head}<p className="muted small">Company details are shown to HR and management.</p></Card>
  const d = data?.details
  const dirs = data?.directors || [], docs = data?.docs || []
  return (
    <div className="stack">
      <Card>{head}
        <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: 'details', label: 'Details' }, { id: 'ssm', label: 'SSM documents', clip: docs.length }, { id: 'directors', label: 'Directors', badge: dirs.length, clip: dirs.filter((x) => x.id_file).length }]} />
        {err && <p className="err">{err}</p>}
        {tab === 'details' && <div data-testid="company-details">
          <KV items={[['SSM no. (new)', d?.ssm_new], ['SSM no. (old)', d?.ssm_old], ['Incorporated', d?.incorporated_on ? fmtDate(d.incorporated_on) : ''], ['Sector', co.sector],
            ['Registered address', d?.reg_address], ['Business address', d?.biz_address], ['Phone', d?.phone], ['Email', d?.email],
            ['Last change', d?.updated_by_name ? `${d.updated_by_name} · ${fmtDate(d.updated_at?.slice(0, 10) || '')}` : '']]} />
          <div className="mt-s"><span className="small muted">Logo: </span><LogoEdit kind="company" id={co.id} path={co.logo} name={co.name} /></div>
        </div>}
        {tab === 'ssm' && <SsmTab company={id} docs={docs} canAdd={auth.canSeeDirectorIds} canDelete={auth.canDeleteCompany} reload={reload} />}
        {tab === 'directors' && <>
          {!auth.canSeeDirectorIds && <p className="muted small">IC / passport numbers are shown masked to the last 4 digits.</p>}
          <DataTable label="Directors and shareholders" clip={(x) => (x.id_file ? 1 : 0)} rows={dirs} rowKey={(x) => x.id} rowTestId={(x) => `director-${x.full_name}`} searchFrom={10} pageSize={20}
            columns={[
              { key: 'n', label: 'Name', main: true, sort: (x) => x.full_name, render: (x) => <><b>{x.full_name}</b><br /><small className="muted">{designationLabel(x.designation)}</small></> },
              { key: 'id', label: 'IC / passport', render: (x) => x.id_no ? <span className="mono">{x.id_type === 'ic' ? 'IC ' : 'Passport '}{x.id_no}</span> : '—' },
              { key: 'm', label: 'Mobile', hide: 'phone', render: (x) => x.mobile || '—' },
              { key: 'e', label: 'Email', hide: 'tablet', render: (x) => x.email || '—' },
            ]}
            expand={(x) => <Details items={[['Designation', designationLabel(x.designation)], ['ID', x.id_no ? `${x.id_type === 'ic' ? 'MyKad IC' : 'Passport'} ${x.id_no}` : '—'], ['Nationality', x.nationality || '—'],
              ['Email', x.email || '—'], ['Mobile', x.mobile || '—'], ['ID copy', x.id_file ? <AttachButton key="idf" src={idSrc(x.id_file)} label="IC / passport copy" /> : x.has_id_file ? 'Attached (CEO, GM and HR Admin only)' : '—'], ['Last change', x.updated_by_name || '—']]} />}
            actions={(x) => <Actions>
              {x.id_file && <IconAction kind="view" label="Open the IC / passport copy" onClick={() => void openAttach(idSrc(x.id_file!))} />}
              {auth.canSeeDirectorIds && <IconAction kind="edit" label="Edit this person" onClick={() => setDirForm({ ...x, id_no: x.id_no || '', nationality: x.nationality || '', email: x.email || '', mobile: x.mobile || '', id_file: x.id_file || undefined } as never)} />}
              {auth.canDeleteCompany && <IconAction kind="delete" label="Delete this director / shareholder" confirm={`Delete ${x.full_name}?`} onClick={() => deleteDirector(x).then(reload, (e) => toast((e as Error).message, 'err'))} />}
            </Actions>}
            empty={<Empty title="No directors listed">{auth.canSeeDirectorIds ? 'Add the directors and shareholders from Form 49 / e-Info.' : 'HR Admin or above can add them.'}</Empty>} />
          {auth.canSeeDirectorIds && <Btn small icon="plus" onClick={() => setDirForm({ full_name: '', id_type: 'ic', id_no: '', nationality: 'Malaysia', designation: 'director', email: '', mobile: '' })}>Add director / shareholder</Btn>}
        </>}
      </Card>
      {edit && <EditDetails id={id} name={co.name} sector={co.sector || ''} d={d} onClose={() => setEdit(false)} onSaved={reload} />}
      {dirForm && <DirectorForm company={id} v={dirForm} onClose={() => setDirForm(null)} onSaved={reload} />}
    </div>
  )
}

function SsmTab({ company, docs, canAdd, canDelete, reload }: { company: string; docs: CompanyDoc[]; canAdd: boolean; canDelete: boolean; reload: () => void }) {
  const [type, setType] = useState('form9'), [exp, setExp] = useState('')
  const add = async (f: File) => {
    try { const path = await uploadCompanyFile(company, 'ssm', f); await addDoc(company, { doc_type: type, title: docTypeLabel(type), path, name: f.name, mime: f.type, size: f.size, expiry_date: exp || undefined }); setExp(''); toast('SSM copy stored'); reload() }
    catch (e) { toast((e as Error).message, 'err') }
  }
  return <>
    <DataTable label="SSM documents" rows={docs} rowKey={(x) => x.id} searchFrom={10} pageSize={20} initialSort={{ key: 'up', dir: 'desc' }}
      columns={[
        { key: 't', label: 'Document', main: true, sort: (x) => x.doc_type, render: (x) => <><span className="dt-p-show att-float"><AttachButton src={ssmSrc(x)} compact mini /></span><b>{docTypeLabel(x.doc_type)}</b><br /><small className="muted">{x.name}</small></> },
        { key: 'f', label: 'File', hide: 'phone', render: (x) => <AttachButton src={ssmSrc(x)} compact /> },
        { key: 'up', label: 'Uploaded', sort: (x) => x.uploaded_at, render: (x) => fmtDate(x.uploaded_at.slice(0, 10)) },
        { key: 'exp', label: 'Expires', hide: 'phone', sort: (x) => x.expiry_date || '', render: (x) => x.expiry_date ? <span className={expiring(x.expiry_date) ? 'warn' : ''}>{fmtDate(x.expiry_date)}</span> : '—' },
      ]}
      expand={(x) => <Details items={[['Type', docTypeLabel(x.doc_type)], ['File', <AttachButton key="f" src={ssmSrc(x)} />], ['Uploaded by', `${x.uploaded_by_name || '—'} · ${fmtDate(x.uploaded_at.slice(0, 10))}`], ['Expires', x.expiry_date ? fmtDate(x.expiry_date) : 'No expiry']]} />}
      actions={(x) => <Actions><IconAction kind="download" label="Download" onClick={() => void saveAttach(ssmSrc(x)).catch((e) => toast((e as Error).message, 'err'))} />
        {canDelete && <IconAction kind="delete" label="Delete this document" confirm="Delete this SSM copy?" onClick={() => deleteDoc(x).then(reload, (e) => toast((e as Error).message, 'err'))} />}</Actions>}
      empty={<Empty title="No SSM copies yet">Form 9 / 24 / 49, e-Info or the company profile, as PDF or image.</Empty>} />
    {canAdd && <div className="row gap-s wrap mt-s" data-testid="ssm-add">
      <select aria-label="Document type" value={type} onChange={(e) => setType(e.target.value)}>{SSM_DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
      <label className="small">Expiry <input type="date" value={exp} onChange={(e) => setExp(e.target.value)} /></label>
      <FilePick small name="SSM copy" accept="application/pdf,image/*" onFiles={(l) => l[0] && add(l[0])} />
    </div>}
  </>
}

function EditDetails({ id, name, sector, d, onClose, onSaved }: { id: string; name: string; sector: string; d?: CompanyDetails | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ name, sector, ssm_new: d?.ssm_new || '', ssm_old: d?.ssm_old || '', incorporated_on: d?.incorporated_on || '', reg_address: d?.reg_address || '', biz_address: d?.biz_address || '', phone: d?.phone || '', email: d?.email || '' })
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const f = (k: keyof typeof v, label: string, extra: Record<string, unknown> = {}) => <label className="field"><span>{label}</span><input value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} {...extra} /></label>
  const save = async () => {
    const issue = !v.name.trim() ? 'Enter the company name.' : ssmIssue(v.ssm_new, v.ssm_old) || phoneIssue(v.phone, 'Phone') || emailIssue(v.email)
    if (issue) return setErr(issue)
    setBusy(true); setErr('')
    try {
      if (v.name.trim() !== name || v.sector !== sector) await updateBasic(id, { name: v.name.trim(), sector: v.sector })
      await saveDetails(id, { ssm_new: v.ssm_new || null, ssm_old: v.ssm_old || null, incorporated_on: v.incorporated_on || null, reg_address: v.reg_address || null, biz_address: v.biz_address || null, phone: v.phone || null, email: v.email || null })
      toast('Saved'); onSaved(); onClose()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return <Modal title={`Edit ${name}`} onClose={onClose} footer={<><span className="spacer" /><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" icon="check" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Btn></>}>
    <div className="grid-form">
      {f('name', 'Company name *')}
      <label className="field"><span>Sector</span><input list="co-sectors2" value={v.sector} onChange={(e) => setV({ ...v, sector: e.target.value })} /><datalist id="co-sectors2">{SECTOR_OPTIONS.map((s) => <option key={s} value={s} />)}</datalist></label>
      {f('ssm_new', 'SSM no. (new, 12 digits)', { inputMode: 'numeric' })}{f('ssm_old', 'SSM no. (old format)')}{f('incorporated_on', 'Incorporation date', { type: 'date' })}
      {f('phone', 'Phone', { type: 'tel' })}{f('email', 'Email', { type: 'email' })}
      <label className="field full"><span>Registered address</span><textarea rows={2} value={v.reg_address} onChange={(e) => setV({ ...v, reg_address: e.target.value })} /></label>
      <label className="field full"><span>Business address</span><textarea rows={2} value={v.biz_address} onChange={(e) => setV({ ...v, biz_address: e.target.value })} /></label>
    </div>
    {err && <p className="err" role="alert">{err}</p>}
  </Modal>
}

function DirectorForm({ company, v: v0, onClose, onSaved }: { company: string; v: Partial<NewDirector> & { id?: string }; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState(v0 as NewDirector & { id?: string })
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const save = async () => {
    const issue = directorIssue(v); if (issue) return setErr(issue)
    setBusy(true); setErr('')
    try { await saveDirector(company, v); toast('Saved'); onSaved(); onClose() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return <Modal title={v.id ? `Edit ${v0.full_name}` : 'Add director / shareholder'} onClose={onClose} footer={<><span className="spacer" /><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" icon="check" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Btn></>}>
    <div className="grid-form">
      <label className="field full"><span>Full name *</span><input value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} /></label>
      <label className="field"><span>Designation</span><select value={v.designation} onChange={(e) => setV({ ...v, designation: e.target.value })}>{DESIGNATIONS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select></label>
      <label className="field"><span>ID type</span><select value={v.id_type} onChange={(e) => setV({ ...v, id_type: e.target.value as 'ic' | 'passport', nationality: e.target.value === 'ic' ? 'Malaysia' : '' })}><option value="ic">MyKad IC</option><option value="passport">Passport</option></select></label>
      <label className="field"><span>{v.id_type === 'ic' ? 'IC no. (YYMMDD-PB-###G)' : 'Passport no.'}</span><input value={v.id_no} onChange={(e) => setV({ ...v, id_no: v.id_type === 'ic' ? fmtIc(e.target.value) : e.target.value.toUpperCase() })} /></label>
      <label className="field"><span>Nationality</span><input value={v.nationality} disabled={v.id_type === 'ic'} onChange={(e) => setV({ ...v, nationality: e.target.value })} /></label>
      <label className="field"><span>Email</span><input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></label>
      <label className="field"><span>Mobile (+60)</span><input type="tel" value={v.mobile} onChange={(e) => setV({ ...v, mobile: e.target.value })} /></label>
      <div className="field full"><span>IC / passport copy</span>
        {v.id_file ? <span className="row gap-s"><AttachButton src={idSrc(v.id_file)} label="IC / passport copy" compact /><IconAction kind="close" label="Detach (the file stays until a GM / CEO deletes it)" onClick={() => setV({ ...v, id_file: undefined })} /></span>
          : <FilePick small name="ID copy" accept="application/pdf,image/*" onFiles={(l) => l[0] && uploadCompanyFile(company, 'directors', l[0]).then((p) => setV((c) => ({ ...c, id_file: p })), (e) => toast((e as Error).message, 'err'))} />}</div>
    </div>
    {err && <p className="err" role="alert">{err}</p>}
  </Modal>
}
