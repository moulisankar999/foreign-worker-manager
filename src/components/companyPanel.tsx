/* v1.4.2: "Add company" side panel — opened from the approval-letter form, Settings › Companies and the company picker.
 * One call to the server (company_create) saves the company, its details, SSM copies and directors; the new company
 * is handed back so the caller can select it at once. Sections fold so the panel fits one screen. */
import { useEffect, useState, type ReactNode } from 'react'
import { companyDup } from '../lib/smartForm'
import { Btn } from './ui'
import { Actions, IconAction } from './iconAction'
import { FilePick } from './filePick'
import { toast } from './toast'
import { useConfig } from '../lib/config'
import { useAuth } from '../lib/auth'
import { DESIGNATIONS, SECTOR_OPTIONS, SSM_DOC_TYPES, createCompany, directorIssue, ssmTaken, docTypeLabel, emailIssue, fmtIc, phoneIssue, ssmIssue, uploadStaging, type NewDirector, type NewDoc } from '../lib/companyRecords'
import '../pages/quota/quota.css'

export function Fold({ title, sub, open: open0 = false, children, testId }: { title: ReactNode; sub?: ReactNode; open?: boolean; children: ReactNode; testId?: string }) {
  const [open, setOpen] = useState(open0)
  return (
    <section className={`fold${open ? ' on' : ''}`} data-testid={testId}>
      <button type="button" className="fold-h" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="fold-t">{title}</span>{sub && <span className="fold-s">{sub}</span>}<span className="fold-c" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="fold-b">{children}</div>}
    </section>
  )
}

const blankDir = (): NewDirector => ({ full_name: '', id_type: 'ic', id_no: '', nationality: 'Malaysia', designation: 'director', email: '', mobile: '' })

export function CompanyPanel({ onClose, onCreated }: { onClose: () => void; onCreated?: (id: string, name: string) => void }) {
  const cfg = useConfig()
  const { canSeeDirectorIds, role } = useAuth()
  const [v, setV] = useState({ name: '', sector: '', ssm_new: '', ssm_old: '', incorporated_on: '', reg_address: '', biz_address: '', same: true, phone: '', email: '' })
  const [docs, setDocs] = useState<(NewDoc & { busy?: boolean })[]>([])
  const [docType, setDocType] = useState('form9'), [docExp, setDocExp] = useState('')
  const [dirs, setDirs] = useState<NewDirector[]>([])
  const [openDir, setOpenDir] = useState<number | null>(null)
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const set = (p: Partial<typeof v>) => setV((c) => ({ ...c, ...p }))
  // 1.6.0 live duplicate checks: similar name (ignores Sdn Bhd, punctuation, capitals) and the same SSM no.
  const dupName = companyDup(v.name, undefined, cfg.companies.items)
  const [dupSsm, setDupSsm] = useState<string | null>(null)
  useEffect(() => { let on = true; const t = setTimeout(() => { void ssmTaken(v.ssm_new).then((c) => on && setDupSsm(c)).catch(() => {}) }, 350); return () => { on = false; clearTimeout(t) } }, [v.ssm_new])
  const coName = (id: string) => cfg.companies.items.find((c) => c.id === id)?.name || 'another company'
  const setDir = (i: number, p: Partial<NewDirector>) => setDirs((l) => l.map((d, j) => (j === i ? { ...d, ...p } : d)))
  const addDoc = async (f: File) => {
    try { const path = await uploadStaging('ssm', f); setDocs((l) => [...l, { doc_type: docType, path, name: f.name, mime: f.type, size: f.size, expiry_date: docExp || undefined, title: docTypeLabel(docType) }]); setDocExp('') }
    catch (e) { toast((e as Error).message, 'err') }
  }
  const addIdCopy = async (i: number, f: File) => {
    try { const path = await uploadStaging('directors', f); setDir(i, { id_file: path, file_name: f.name }) } catch (e) { toast((e as Error).message, 'err') }
  }
  const save = async () => {
    setErr('')
    const name = v.name.trim()
    if (!name) return setErr('Enter the company name.')
    if (cfg.companies.items.some((c) => c.name.toLowerCase() === name.toLowerCase())) return setErr('A company with this name already exists.')
    const issue = ssmIssue(v.ssm_new, v.ssm_old) || phoneIssue(v.phone, 'Phone') || emailIssue(v.email) || dirs.map(directorIssue).find(Boolean)
    if (issue) return setErr(issue)
    setBusy(true)
    try {
      const out = await createCompany({ name, sector: v.sector || undefined, docs, directors: dirs,
        details: { ssm_new: v.ssm_new || null, ssm_old: v.ssm_old || null, incorporated_on: v.incorporated_on || null, reg_address: v.reg_address || null, biz_address: (v.same ? v.reg_address : v.biz_address) || null, phone: v.phone || null, email: v.email || null } })
      toast(role === 'hr_manager' ? 'Company created. Details are saved securely — directors\' ID numbers are shown masked to you.' : 'Company created. Details are saved securely.')
      onCreated?.(out.id, out.name); onClose()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const inp = (k: keyof typeof v, label: string, extra: Record<string, unknown> = {}) => (
    <label className="field"><span className="qr-lbl">{label}</span><input value={v[k] as string} onChange={(e) => set({ [k]: e.target.value } as never)} {...extra} /></label>)
  return (
    <div className="qr-side-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <aside className="qr-side" role="dialog" aria-label="Add company" data-testid="company-panel">
        <header><div><h3>Add company</h3><small className="muted">Name and sector are enough to start; the rest can be filled in now or later.</small></div><IconAction kind="close" label="Close without saving" onClick={onClose} /></header>
        <div className="qr-side-b">
          <Fold title="Company" sub={v.name || 'Name, sector'} open testId="fold-basic">
            <div className="qr-form2">
              <label className="field full"><span className="qr-lbl">Company name *</span><input autoFocus value={v.name} placeholder="e.g. Seri Rasa Restaurant Sdn Bhd" onChange={(e) => set({ name: e.target.value })} />
                {dupName && <small className="fmsg warn" data-testid="co-dup" title="Why you see this: names are compared without “Sdn Bhd”, punctuation and capitals.">⚠️ Looks like <b>{dupName.name}</b> is already here. <a className="fmsg-link" href={`#/companies/${dupName.id}`}>Open it</a></small>}</label>
              <label className="field full"><span className="qr-lbl">Sector</span><input list="co-sectors" value={v.sector} placeholder="Services/Restaurant" onChange={(e) => set({ sector: e.target.value })} />
                <datalist id="co-sectors">{SECTOR_OPTIONS.map((s) => <option key={s} value={s} />)}</datalist></label>
            </div>
          </Fold>
          <Fold title="Registration (SSM)" sub={v.ssm_new || v.ssm_old || 'SSM no., incorporation date'}>
            <div className="qr-form2">
              {inp('ssm_new', 'SSM no. (new, 12 digits)', { inputMode: 'numeric', placeholder: '201901012345', maxLength: 14 })}
              {dupSsm && <small className="fmsg warn full" data-testid="ssm-dup">⚠️ This SSM no. is already saved for <b>{coName(dupSsm)}</b>. <a className="fmsg-link" href={`#/companies/${dupSsm}`}>Open it</a></small>}
              {inp('ssm_old', 'SSM no. (old format)', { placeholder: '1234567-X' })}
              {inp('incorporated_on', 'Incorporation date', { type: 'date' })}
            </div>
          </Fold>
          <Fold title="Address & contact" sub={[v.phone, v.email].filter(Boolean).join(' · ') || 'Registered / business address, phone, email'}>
            <div className="qr-form2">
              <label className="field full"><span className="qr-lbl">Registered address</span><textarea rows={2} value={v.reg_address} onChange={(e) => set({ reg_address: e.target.value })} /></label>
              <label className="check full"><input type="checkbox" checked={v.same} onChange={(e) => set({ same: e.target.checked })} /> Business address is the same</label>
              {!v.same && <label className="field full"><span className="qr-lbl">Business address</span><textarea rows={2} value={v.biz_address} onChange={(e) => set({ biz_address: e.target.value })} /></label>}
              {inp('phone', 'Phone', { type: 'tel', placeholder: '+60 3-1234 5678' })}
              {inp('email', 'Email', { type: 'email', placeholder: 'office@company.com.my' })}
            </div>
          </Fold>
          <Fold title="SSM documents" sub={docs.length ? `${docs.length} attached` : 'Form 9 / 24 / 49, e-Info, profile'}>
            {docs.length > 0 && <ul className="co-list">{docs.map((d, i) => <li key={d.path}><span><b>{docTypeLabel(d.doc_type)}</b><small className="muted"> · {d.name}{d.expiry_date ? ` · expires ${d.expiry_date}` : ''}</small></span>
              <IconAction kind="delete" label="Remove this attachment" onClick={() => setDocs((l) => l.filter((_, j) => j !== i))} /></li>)}</ul>}
            <div className="qr-form2">
              <label className="field"><span className="qr-lbl">Type</span><select value={docType} onChange={(e) => setDocType(e.target.value)}>{SSM_DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
              <label className="field"><span className="qr-lbl">Expiry (optional)</span><input type="date" value={docExp} onChange={(e) => setDocExp(e.target.value)} /></label>
              <div className="field full"><FilePick small name="SSM copy" accept="application/pdf,image/*" onFiles={(l) => l[0] && addDoc(l[0])} /></div>
            </div>
          </Fold>
          <Fold title="Directors & shareholders" sub={dirs.length ? `${dirs.length} listed` : 'Name, IC / passport, email, mobile'}>
            {dirs.map((d, i) => (
              <div key={i} className={`co-dir${openDir === i ? ' on' : ''}`}>
                <div className="co-dir-h">
                  <button type="button" className="linkish" onClick={() => setOpenDir(openDir === i ? null : i)} aria-expanded={openDir === i}>{d.full_name || 'New director'} <small className="muted">· {DESIGNATIONS.find((x) => x.value === d.designation)?.label}{d.id_no ? ` · ${d.id_type === 'ic' ? 'IC' : 'Passport'} ••••${d.id_no.replace(/\W/g, '').slice(-4)}` : ''}</small></button>
                  <Actions><IconAction kind="edit" label={openDir === i ? 'Fold' : 'Edit this person'} onClick={() => setOpenDir(openDir === i ? null : i)} /><IconAction kind="delete" label="Remove from the list" onClick={() => { setDirs((l) => l.filter((_, j) => j !== i)); setOpenDir(null) }} /></Actions>
                </div>
                {openDir === i && <div className="qr-form2">
                  <label className="field full"><span className="qr-lbl">Full name *</span><input value={d.full_name} onChange={(e) => setDir(i, { full_name: e.target.value })} /></label>
                  <label className="field"><span className="qr-lbl">Designation</span><select value={d.designation} onChange={(e) => setDir(i, { designation: e.target.value })}>{DESIGNATIONS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select></label>
                  <label className="field"><span className="qr-lbl">ID type</span><select value={d.id_type} onChange={(e) => setDir(i, { id_type: e.target.value as 'ic' | 'passport', nationality: e.target.value === 'ic' ? 'Malaysia' : '' })}><option value="ic">MyKad IC</option><option value="passport">Passport</option></select></label>
                  <label className="field"><span className="qr-lbl">{d.id_type === 'ic' ? 'IC no. (YYMMDD-PB-###G)' : 'Passport no.'}</span><input value={d.id_no} inputMode={d.id_type === 'ic' ? 'numeric' : undefined} placeholder={d.id_type === 'ic' ? '800101-14-5678' : 'A1234567'}
                    onChange={(e) => setDir(i, { id_no: d.id_type === 'ic' ? fmtIc(e.target.value) : e.target.value.toUpperCase() })} /></label>
                  <label className="field"><span className="qr-lbl">Nationality</span><input value={d.nationality} disabled={d.id_type === 'ic'} onChange={(e) => setDir(i, { nationality: e.target.value })} /></label>
                  <label className="field"><span className="qr-lbl">Email</span><input type="email" value={d.email} onChange={(e) => setDir(i, { email: e.target.value })} /></label>
                  <label className="field"><span className="qr-lbl">Mobile (+60)</span><input type="tel" value={d.mobile} placeholder="+60 12-345 6789" onChange={(e) => setDir(i, { mobile: e.target.value })} /></label>
                  <div className="field full"><span className="qr-lbl">IC / passport copy (optional)</span>
                    {d.id_file ? <span className="small">{d.file_name} <IconAction kind="delete" label="Remove the copy" onClick={() => setDir(i, { id_file: undefined, file_name: undefined })} /></span>
                      : <FilePick small name="ID copy" accept="application/pdf,image/*" onFiles={(l) => l[0] && addIdCopy(i, l[0])} />}
                    {!canSeeDirectorIds && <small className="muted">After saving, you will see ID numbers masked to the last 4 digits.</small>}</div>
                </div>}
              </div>))}
            <Btn small icon="plus" onClick={() => { setDirs((l) => [...l, blankDir()]); setOpenDir(dirs.length) }}>Add director / shareholder</Btn>
          </Fold>
          {err && <p className="err" role="alert">{err}</p>}
        </div>
        <footer><span className="small muted">Logo can be added on the company page after saving.</span><span className="spacer" /><Btn onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" icon="check" disabled={busy || docs.some((d) => d.busy)} onClick={save}>{busy ? 'Saving…' : 'Save company'}</Btn></footer>
      </aside>
    </div>
  )
}
