/* "Add user" (Settings → Users & Access): add a person directly — active at once, temporary password shown once,
 * login details shared by email link / WhatsApp / SMS. Who may add which role is decided on the server
 * (user-admin Edge Function → user_create_check); this dialog only offers the roles the server would allow. */
import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Btn, Card, Modal } from './ui'
import { PhoneInput } from './phoneInput'
import { ScopePicker } from './userApprovals'
import { genTempPassword, tempPwIssue } from './userActions'
import { toast } from './toast'
import { db } from '../lib/db'
import { useAuth } from '../lib/auth'
import { useConfig } from '../lib/config'
import { ROLE_HELP, ROLE_LABEL } from '../lib/workflow'
import { createUser, type CreateResult } from '../lib/userAdmin'
import type { Role } from '../lib/supabase'

export const APP_LINK = 'https://fw.sunrisebayumas.com'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const E164 = /^\+[1-9]\d{7,14}$/

export function loginMessage(name: string, email: string, pw: string) {
  return `Hello ${name}, your Foreign Worker Manager account is ready.\nApp: ${APP_LINK}\nEmail: ${email}\nTemporary password: ${pw}\nPlease change it on first sign-in.`
}

/** card for people who can add users but not manage the full list (e.g. HR Manager) */
export function AddUserCard() {
  const { creatableRoles } = useAuth()
  const [open, setOpen] = useState(false)
  return (
    <Card title="Add user" actions={<Btn small kind="primary" icon="plus" onClick={() => setOpen(true)}>Add user</Btn>}>
      <p className="muted small">You can add: <strong>{creatableRoles.map((r) => ROLE_LABEL[r]).join(', ')}</strong>. They are active at once and must change the temporary password at their first sign-in.</p>
      {open && <AddUserDialog onClose={() => setOpen(false)} />}
    </Card>
  )
}

export function AddUserDialog({ onClose, onEditExisting }: { onClose: () => void; onEditExisting?: (id: string) => void }) {
  const { creatableRoles, isSuper, isGm, isHrAdmin, role: myRole, myCompanies, myOutlets } = useAuth()
  const cfg = useConfig()
  const companies = cfg.companies.items
  const outlets = useLiveQuery(() => db.outlets.toArray(), [], [])
  const smsOn = !!cfg.notifications.enabled.sms
  const isHrm = myRole === 'hr_manager'
  const [f, setF] = useState({ name: '', email: '', phone: undefined as string | undefined, role: (creatableRoles.includes('outlet_manager') && isHrm ? 'outlet_manager' : creatableRoles[0] || '') as Role | '' })
  const [scope, setScope] = useState<{ companies: string[]; outlets: string[] }>({ companies: [], outlets: [] })
  const [pwMode, setPwMode] = useState<'generate' | 'choose'>('generate')
  const [typed, setTyped] = useState('')
  const [send, setSend] = useState({ email: true, whatsapp: true, sms: false })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<CreateResult | null>(null)
  const [done, setDone] = useState<{ pw: string; emailed?: boolean; emailNote?: string; name: string; email: string; phone?: string } | null>(null)
  // companies I may hand out (the server checks again)
  const allowed: string[] | '*' = isSuper || isGm || ((isHrAdmin || isHrm) && !myCompanies.length && !myOutlets.length) ? '*' : myCompanies
  const visOutlets = useMemo(() => (isHrm && myOutlets.length && !myCompanies.length ? outlets.filter((o) => myOutlets.includes(o.id)) : outlets), [isHrm, myOutlets, myCompanies, outlets])
  const needScope = f.role === 'outlet_manager'
  const noScope = f.role === 'general_manager'
  const problems = [
    f.name.trim().length < 2 && 'Enter the full name',
    !EMAIL_RE.test(f.email.trim()) && 'Enter a valid email',
    f.phone && !E164.test(f.phone) && 'Mobile number is not complete for the chosen country',
    !f.role && 'Choose a role',
    needScope && !scope.outlets.length && 'Choose at least one outlet',
    pwMode === 'choose' && tempPwIssue(typed),
  ].filter(Boolean) as string[]

  const go = async () => {
    if (problems.length) return
    setBusy(true); setErr(null)
    const channels = (Object.keys(send) as (keyof typeof send)[]).filter((k) => send[k] && (k !== 'sms' || smsOn))
    const r = await createUser({ email: f.email.trim(), fullName: f.name.trim(), phone: f.phone, role: f.role, companyIds: noScope || isHrm ? [] : scope.companies,
      outletIds: noScope ? [] : scope.outlets, tempPassword: pwMode === 'choose' ? typed : undefined, sendEmail: send.email, channels })
    setBusy(false)
    if (!r.ok || !r.tempPassword) { setErr(r); return }
    setTyped('')
    setDone({ pw: r.tempPassword, emailed: r.emailed, emailNote: r.emailNote, name: f.name.trim(), email: f.email.trim().toLowerCase(), phone: f.phone })
    toast(`Added ✓ — ${f.name.trim()} is now ${ROLE_LABEL[f.role]} (active)`)
  }

  if (done) return <LoginDetails d={done} send={send} smsOn={smsOn} onClose={onClose} />
  return (
    <Modal wide title="Add user" onClose={onClose}
      footer={<><Btn kind="ghost" onClick={onClose} disabled={busy}>Cancel</Btn><Btn kind="primary" icon="plus" onClick={go} disabled={busy || problems.length > 0}>{busy ? 'Adding…' : 'Add user'}</Btn></>}>
      <p className="muted small">The person is <strong>active at once</strong> (no approval queue) and is marked “Added by {ROLE_LABEL[myRole || ''] || ''} …”. You can add roles below your own only.</p>
      <div className="grid2">
        <div className="field"><label htmlFor="au-name">Full name *</label><input id="au-name" value={f.name} autoComplete="off" onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="field"><label htmlFor="au-email">Email *</label><input id="au-email" type="email" autoComplete="off" value={f.email} onChange={(e) => { setF({ ...f, email: e.target.value }); setErr(null) }} /></div>
        <div className="field"><label htmlFor="au-phone">Mobile (for WhatsApp / SMS)</label><PhoneInput id="au-phone" value={f.phone} onChange={(v) => setF({ ...f, phone: v })} /></div>
        <div className="field"><label htmlFor="au-role">Role *</label>
          <select id="au-role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
            {creatableRoles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
          {f.role && <small className="muted">{ROLE_HELP[f.role]}</small>}
        </div>
      </div>
      {!noScope && <div className="field"><label>{isHrm ? 'Outlets *' : needScope ? 'Outlets * (or a whole company)' : 'Companies / outlets'}</label>
        <ScopePicker companies={companies} outlets={visOutlets} value={scope} onChange={setScope} allowed={allowed} outletsOnly={isHrm} />
        {!needScope && !scope.companies.length && !scope.outlets.length && <small className="muted">None chosen = {isSuper || isGm ? 'all companies' : 'the same companies as you'}.</small>}
      </div>}
      {noScope && <p className="small muted">A General Manager works across all companies.</p>}
      <fieldset className="pw-choice"><legend className="small"><strong>Temporary password</strong></legend>
        <label className="check small"><input type="radio" name="au-pw" checked={pwMode === 'generate'} onChange={() => setPwMode('generate')} /> Generate a strong one</label>
        <label className="check small"><input type="radio" name="au-pw" checked={pwMode === 'choose'} onChange={() => setPwMode('choose')} /> I’ll type one</label>
        {pwMode === 'choose' && <><input type="text" aria-label="Temporary password" autoComplete="off" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} />
          <small className={typed && tempPwIssue(typed) ? 'err' : 'muted'}>{(typed && tempPwIssue(typed)) || 'At least 10 characters, letters and numbers.'}</small>
          <Btn small kind="ghost" onClick={() => setTyped(genTempPassword())}>Suggest one</Btn></>}
        <small className="muted">Shown to you once after adding. They must change it at their first sign-in.</small>
      </fieldset>
      <fieldset className="pw-choice"><legend className="small"><strong>Send login details</strong></legend>
        <label className="check small"><input type="checkbox" checked={send.email} onChange={(e) => setSend({ ...send, email: e.target.checked })} /> Email — a secure “set your password” link (no password in the email). The free mailer sends only a few emails per hour.</label>
        <label className="check small"><input type="checkbox" checked={send.whatsapp} onChange={(e) => setSend({ ...send, whatsapp: e.target.checked })} /> WhatsApp — opens WhatsApp on <em>your</em> phone with the message ready; you press Send (free).</label>
        <label className={`check small${smsOn ? '' : ' is-disabled'}`}><input type="checkbox" disabled={!smsOn} checked={smsOn && send.sms} onChange={(e) => setSend({ ...send, sms: e.target.checked })} /> SMS {smsOn ? '— opens your phone’s SMS app with the message ready' : <span className="muted">— off. Set up SMS in Settings → Notifications (you can still use “Open SMS app” on the next screen)</span>}</label>
      </fieldset>
      {problems.length > 0 && (f.name || f.email) && <p className="muted small">To add: {problems.join(' · ')}</p>}
      {err && <div className="err small" role="alert">{err.error}
        {err.duplicate && err.editable && onEditExisting && <> <Btn small kind="ghost" icon="edit" onClick={() => onEditExisting(err.duplicate!)}>Edit the existing user</Btn></>}
      </div>}
    </Modal>
  )
}

function LoginDetails({ d, send, smsOn, onClose }: { d: { pw: string; emailed?: boolean; emailNote?: string; name: string; email: string; phone?: string }; send: { email: boolean; whatsapp: boolean; sms: boolean }; smsOn: boolean; onClose: () => void }) {
  const [copied, setCopied] = useState('')
  const msg = loginMessage(d.name, d.email, d.pw)
  const digits = (d.phone || '').replace(/\D/g, '')
  const wa = `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`
  const sms = `sms:${d.phone || ''}?body=${encodeURIComponent(msg)}`
  const copy = (what: string, text: string) => { void navigator.clipboard?.writeText(text).then(() => setCopied(what)) }
  return (
    <Modal title={`Login details — ${d.name}`} onClose={onClose} footer={<Btn kind="primary" icon="check" onClick={onClose}>Done — I shared it</Btn>}>
      <p className="small"><strong>{d.name}</strong> ({d.email}) is <strong>active</strong>. Temporary password — <strong>shown only this once</strong>:</p>
      <div className="temp-pw" data-testid="temp-pw"><code>{d.pw}</code><Btn small kind="ghost" onClick={() => copy('pw', d.pw)}>{copied === 'pw' ? 'Copied ✓' : 'Copy'}</Btn></div>
      <p className="small muted">They must change it at their first sign-in. Not stored or logged anywhere — if it’s lost, use Reset password.</p>
      <ul className="rows share-rows">
        <li><div className="r-main"><strong>📧 Email</strong><small>{!send.email ? 'Not chosen' : d.emailed ? 'Email sent ✓ — a “set your password” link (no password inside)' : (d.emailNote || 'Email not sent') + ' — share the password another way'}</small></div></li>
        <li><div className="r-main"><strong>🟢 WhatsApp</strong><small>{digits ? `To ${d.phone}` : 'No mobile entered — you’ll pick the contact in WhatsApp'}</small></div>
          <div className="r-act"><a className={`btn ${send.whatsapp ? 'btn-primary' : 'btn-secondary'} btn-s`} href={wa} target="_blank" rel="noopener noreferrer">Open WhatsApp</a></div></li>
        <li><div className="r-main"><strong>💬 SMS</strong><small>{smsOn ? 'Opens your phone’s SMS app with the message' : 'SMS sending is off (Settings → Notifications) — this opens your own SMS app instead'}</small></div>
          <div className="r-act"><a className="btn btn-secondary btn-s" href={sms}>Open SMS app</a></div></li>
      </ul>
      <details className="small"><summary>Message preview</summary><pre className="msg-preview">{msg}</pre>
        <Btn small kind="ghost" onClick={() => copy('msg', msg)}>{copied === 'msg' ? 'Copied ✓' : 'Copy message'}</Btn></details>
    </Modal>
  )
}
