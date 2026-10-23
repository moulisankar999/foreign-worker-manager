/* CEO / HR configuration cards shown in Settings:
 * approval rules, HR Admin powers, document vault, emergency leave reasons, passport safekeeping,
 * notifications (outbound channels OFF until the provider keys are added), my alerts, and the audit log. */
import { useEffect, useState } from 'react'
import { Btn, Card, Chip, FormModal, Modal, type FieldDef } from './ui'
import { useAuth } from '../lib/auth'
import { saveConfig, useConfig, allVaultCategories, type PassportConfig } from '../lib/config'
import { supabase } from '../lib/supabase'
import { compressImage } from '../lib/vault'
import { REQUEST_TYPES, ROLE_LABEL, VAULT_CATEGORIES, type ApprovalRules, type EmergencyReason, type HrAdminFlags, type Level } from '../lib/workflow'
import { CHANNELS, CHANNEL_LABEL, checkSms, type Channel, type NotifyConfig } from '../lib/notifyEvents'
import { fmtDate } from '../lib/util'

type V = Record<string, unknown>
const LEVELS: Level[] = ['hr_manager', 'hr_admin', 'super_admin']
const ALWAYS_SUPER = ['loan', 'salary_increment']
const err = (e: unknown) => alert((e as Error).message)

/* ---------------- Approval rules ---------------- */
export function ApprovalRulesCard() {
  const { top } = useAuth()
  const isSuper = top('requests.rules') // CEO, or a General Manager with this power
  const cfg = useConfig()
  const [edit, setEdit] = useState<ApprovalRules | null>(null)
  const rules = edit || cfg.approval_rules
  const set = (k: string, patch: Partial<ApprovalRules['types'][string]>) => edit && setEdit({ types: { ...edit.types, [k]: { ...{ enabled: true, level: 'hr_admin', limit: null }, ...edit.types[k], ...patch } } })
  const groups = [...new Set(REQUEST_TYPES.map((t) => t.group))]
  return (
    <Card title="Approval rules" actions={isSuper && (edit
      ? <><Btn small onClick={() => setEdit(null)}>Cancel</Btn> <Btn small kind="primary" onClick={() => saveConfig('approval_rules', edit).then(() => setEdit(null), err)}>Save rules</Btn></>
      : <Btn small icon="edit" onClick={() => setEdit(structuredClone(cfg.approval_rules))}>Edit</Btn>)}>
      <p className="muted small">Flow: Outlet manager → HR Manager (return / reject / recommend) → final approver below → HR Manager applies → closed. HR Admin escalates to CEO when a request is above the RM limit. Loans and salary increments always go to the CEO. The database enforces these rules{isSuper ? '' : ' (only the CEO can change them)'}.</p>
      <div className="tbl-wrap"><table className="tbl">
        <thead><tr><th>Request</th><th>On</th><th>Final approver</th><th className="num">CEO above (RM)</th></tr></thead>
        <tbody>{groups.map((g) => [
          <tr key={g} className="grp"><td colSpan={4}><strong>{g}</strong></td></tr>,
          ...REQUEST_TYPES.filter((t) => t.group === g).map((t) => {
            const r = rules.types[t.key] || { enabled: true, level: t.level, limit: t.limit ?? null }
            const lock = ALWAYS_SUPER.includes(t.key)
            return <tr key={t.key}>
              <td>{t.icon} {t.label}</td>
              <td><input type="checkbox" aria-label={`${t.label} enabled`} checked={r.enabled !== false} disabled={!edit} onChange={(e) => set(t.key, { enabled: e.target.checked })} /></td>
              <td>{edit && !lock ? <select aria-label={`${t.label} approver`} value={r.level} onChange={(e) => set(t.key, { level: e.target.value as Level })}>{LEVELS.map((l) => <option key={l} value={l}>{ROLE_LABEL[l]}</option>)}</select> : <>{ROLE_LABEL[lock ? 'super_admin' : r.level]}{lock && <small className="muted"> (always)</small>}</>}</td>
              <td className="num">{t.amountKey && !lock ? (edit ? <input className="num-in" type="number" min={0} aria-label={`${t.label} limit`} value={r.limit ?? ''} disabled={r.level !== 'hr_admin'} onChange={(e) => set(t.key, { limit: e.target.value === '' ? null : Number(e.target.value) })} /> : r.level === 'hr_admin' && r.limit != null ? `> RM ${r.limit}` : '—') : '—'}</td>
            </tr>
          }),
        ])}</tbody>
      </table></div>
    </Card>
  )
}

/* ---------------- HR Admin powers ---------------- */
const FLAG_LABEL: Record<keyof HrAdminFlags, string> = { manageUsers: 'Approve users & set roles/outlets (except CEO)', deleteWorkers: 'Delete worker records', viewSalary: 'See salaries, loans & payroll', viewAudit: 'See the audit log', resetPasswords: 'Reset passwords of users in their companies (never CEO / HR Admin)' }
export function HrFlagsCard() {
  const { top } = useAuth()
  const isSuper = top('hr.flags') // CEO, or a General Manager with this power
  const f = useConfig().hr_admin
  return (
    <Card title="HR Admin permissions">
      <p className="muted small">What HR Admins may do in addition to approving requests. {isSuper ? 'Changes apply immediately for everyone.' : 'Set by the CEO.'}</p>
      {(Object.keys(FLAG_LABEL) as (keyof HrAdminFlags)[]).map((k) => (
        <label key={k} className="check"><input type="checkbox" checked={!!f[k]} disabled={!isSuper} onChange={(e) => saveConfig('hr_admin', { ...f, [k]: e.target.checked }).catch(err)} /> {FLAG_LABEL[k]}</label>
      ))}
    </Card>
  )
}

/* ---------------- Document vault ---------------- */
export function VaultSettingsCard() {
  const { top } = useAuth()
  const isSuper = top('workers.vault') // CEO, or a General Manager with this power
  const v = useConfig().vault
  const [open, setOpen] = useState(false)
  const cats = allVaultCategories(v, VAULT_CATEGORIES)
  const fields: FieldDef[] = [
    { key: 'extra', label: 'Extra categories (one per line)', type: 'textarea', full: true },
    { key: 'restricted', label: 'Hidden from outlet managers & viewers (one per line)', type: 'textarea', full: true, hint: 'e.g. Payslip, Bank' },
    { key: 'maxImageKB', label: 'Max size per image page (KB)', type: 'number' },
    { key: 'maxPdfKB', label: 'Max size per PDF (KB)', type: 'number' },
  ]
  const lines = (s: unknown) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean)
  return (
    <Card title="Document vault" actions={isSuper && <Btn small icon="edit" onClick={() => setOpen(true)}>Edit</Btn>}>
      <p className="muted small">Files are private (signed links that expire); every upload keeps older versions. Photos are compressed to about 1600 px. Limits: {Math.round(v.maxImageKB / 1024 * 10) / 10} MB per image, {Math.round(v.maxPdfKB / 1024 * 10) / 10} MB per PDF.</p>
      <div className="chips">{cats.map((c) => <Chip key={c} tone={v.restricted.includes(c) ? 'orange' : 'gray'}>{c}{v.restricted.includes(c) ? ' 🔒' : ''}</Chip>)}</div>
      <p className="muted small">🔒 = hidden from outlet managers and viewers.</p>
      {open && <FormModal title="Document vault settings" fields={fields} initial={{ extra: v.extraCategories.join('\n'), restricted: v.restricted.join('\n'), maxImageKB: v.maxImageKB, maxPdfKB: v.maxPdfKB }} onClose={() => setOpen(false)}
        onSave={async (x: V) => { await saveConfig('vault', { ...v, extraCategories: lines(x.extra), restricted: lines(x.restricted), maxImageKB: Math.max(100, Number(x.maxImageKB) || 1024), maxPdfKB: Math.max(200, Number(x.maxPdfKB) || 5120) }); setOpen(false) }} />}
    </Card>
  )
}

/* ---------------- Emergency leave reasons ---------------- */
export function EmergencyReasonsCard() {
  const { top } = useAuth()
  const isSuper = top('requests.emergency') // CEO, or a General Manager with this power
  const list = useConfig().emergency_reasons
  const [ed, setEd] = useState<{ i: number; v: V } | null>(null)
  const fields: FieldDef[] = [
    { key: 'label', label: 'Reason (shown in the dropdown)', required: true, full: true },
    { key: 'proof', label: 'Proof required', full: true, required: true, hint: 'What the worker must provide, e.g. death certificate' },
    { key: 'proofDays', label: 'Proof may follow within (days)', type: 'number' },
    { key: 'relationship', label: 'Ask which family member', type: 'checkbox' },
    { key: 'detailed', label: 'Needs a detailed explanation (HR Admin decides)', type: 'checkbox' },
  ]
  const save = async (next: EmergencyReason[]) => { await saveConfig('emergency_reasons', next) }
  return (
    <Card title="Emergency leave reasons" actions={isSuper && <Btn small icon="plus" onClick={() => setEd({ i: -1, v: { proofDays: 14, relationship: true } })}>Add</Btn>}>
      <p className="muted small">Emergency leave needs one of these reasons and a flight ticket. Proof may follow later — the request shows “proof pending” until it is uploaded. Annual or home leave must not be filed as emergency leave.</p>
      <ul className="list">{list.map((r, i) => (
        <li key={r.key} className="list-row">
          <div><strong>{r.label}</strong><div className="muted small">Proof: {r.proof} · within {r.proofDays} days{r.relationship ? ' · family member' : ''}{r.detailed ? ' · detailed explanation' : ''}</div></div>
          {isSuper && <span className="col-end"><Btn small kind="ghost" icon="edit" onClick={() => setEd({ i, v: { ...r } })} title="Edit" /><Btn small kind="ghost" icon="trash" title="Remove" onClick={() => confirm(`Remove “${r.label}”?`) && save(list.filter((_, j) => j !== i)).catch(err)} /></span>}
        </li>
      ))}</ul>
      {ed && <FormModal title={ed.i < 0 ? 'Add reason' : 'Edit reason'} fields={fields} initial={ed.v} onClose={() => setEd(null)} onSave={async (x: V) => {
        const r: EmergencyReason = { key: String(ed.v.key || String(x.label).toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30) + '_' + Date.now().toString(36).slice(-3)), label: String(x.label), proof: String(x.proof), proofDays: Math.max(0, Number(x.proofDays) || 14), relationship: !!x.relationship, detailed: !!x.detailed }
        await save(ed.i < 0 ? [...list, r] : list.map((y, j) => (j === ed.i ? r : y))); setEd(null)
      }} />}
    </Card>
  )
}

/* ---------------- Passport safekeeping ---------------- */
export function PassportSettingsCard() {
  const { top } = useAuth()
  const isSuper = top('passport.settings') // CEO, or a General Manager with this power
  const p = useConfig().passport
  const [open, setOpen] = useState(false)
  const fields: FieldDef[] = [
    { key: 'turnaroundHours', label: 'Return passport on request within (hours)', type: 'number', hint: 'Printed on the consent form' },
    { key: 'overdueGraceDays', label: 'Grace days before “not returned” alert', type: 'number' },
    { key: 'companyShort', label: 'Company name on forms (optional)' },
    { key: 'witnessTitle', label: 'Witness title', hint: 'Default: Outlet Manager' },
  ]
  const logo = async (f?: File) => {
    if (!f) return
    try {
      const b = await compressImage(f, 120)
      const url = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(b) })
      await saveConfig('passport', { ...p, logo: url })
    } catch (e) { err(e) }
  }
  return (
    <Card title="Passport safekeeping" actions={isSuper && <Btn small icon="edit" onClick={() => setOpen(true)}>Edit</Btn>}>
      <p className="muted small">Passports Act 1966 s.12(1)(f): an employer may not hold a worker's passport without his consent. The passport stays with the worker, or in the company safe only with a signed, voluntary consent (EN + BM form). It is returned on request within {p.turnaroundHours} hours, with no deposit or fee, and every movement is recorded.</p>
      <dl className="kv"><div><dt>Return turnaround</dt><dd>{p.turnaroundHours} hours</dd></div><div><dt>Overdue grace</dt><dd>{p.overdueGraceDays} days</dd></div><div><dt>Witness</dt><dd>{p.witnessTitle || 'Outlet Manager'}</dd></div>
        <div><dt>Logo</dt><dd>{p.logo ? <img src={p.logo} alt="Company logo" style={{ maxHeight: 40 }} /> : '—'} {isSuper && <label className="btn btn-secondary btn-s">Upload logo<input type="file" accept="image/png,image/jpeg" hidden onChange={(e) => logo(e.target.files?.[0])} /></label>}{isSuper && p.logo && <Btn small kind="ghost" onClick={() => saveConfig('passport', { ...p, logo: undefined }).catch(err)}>Remove</Btn>}</dd></div></dl>
      {open && <FormModal title="Passport safekeeping settings" fields={fields} initial={p as unknown as V} onClose={() => setOpen(false)} onSave={async (x: V) => {
        const next: PassportConfig = { ...p, turnaroundHours: Math.max(1, Number(x.turnaroundHours) || 24), overdueGraceDays: Math.max(0, Number(x.overdueGraceDays) || 0), companyShort: String(x.companyShort || '') || undefined, witnessTitle: String(x.witnessTitle || '') || 'Outlet Manager' }
        await saveConfig('passport', next); setOpen(false)
      }} />}
    </Card>
  )
}

/* ---------------- Notifications (CEO) ---------------- */
const GUIDE: Record<'whatsapp' | 'sms' | 'email', { title: string; cost: string; steps: string[]; secrets: [string, string][] }> = {
  whatsapp: {
    title: 'WhatsApp — Meta WhatsApp Cloud API', cost: 'about RM0.0564 per utility message (Malaysia)',
    steps: [
      'Create a Meta Business account (business.facebook.com) and verify the business.',
      'In developers.facebook.com create an app (type “Business”) and add the WhatsApp product.',
      'Add and verify a phone number that is NOT used in the WhatsApp app; note the Phone number ID and WhatsApp Business Account ID.',
      'Create a System User with a permanent access token (permissions: whatsapp_business_messaging, whatsapp_business_management).',
      'Submit the message templates (category UTILITY) listed in supabase/functions/_shared/wa-templates.json, or use “Sync templates” below once the keys are in.',
      'Webhook: callback URL https://<project>.supabase.co/functions/v1/whatsapp-webhook, the same verify token as WA_VERIFY_TOKEN, subscribe to “messages”.',
      'Add the secrets below to Supabase (Dashboard → Edge Functions → Secrets), then switch WhatsApp ON here and press “Send test”.',
    ],
    secrets: [['WA_ACCESS_TOKEN', 'Permanent System User token'], ['WA_PHONE_NUMBER_ID', 'Phone number ID'], ['WA_BUSINESS_ACCOUNT_ID', 'WhatsApp Business Account ID (template sync)'], ['WA_APP_SECRET', 'App secret — checks webhook signatures'], ['WA_VERIFY_TOKEN', 'Any random text you also type in the Meta webhook settings']],
  },
  sms: {
    title: 'SMS — OneWaySMS (fallback only)', cost: 'about RM0.115 per SMS; used only for urgent events when WhatsApp fails',
    steps: [
      'Open a OneWaySMS Malaysia account (onewaysms.com.my) and buy credits.',
      'Note the API username and password from the API section.',
      'Messages are sent as “RM0 <sender>: text” — no links or phone numbers (Malaysian carrier rule since 1 Sep 2024).',
      'Add the secrets below to Supabase, then switch SMS ON here and press “Send test”.',
    ],
    secrets: [['SMS_PROVIDER', 'onewaysms (or http / twilio)'], ['ONEWAYSMS_USER', 'API username'], ['ONEWAYSMS_PASS', 'API password'], ['ONEWAYSMS_SENDER', 'Sender ID (optional)']],
  },
  email: {
    title: 'Email — Brevo', cost: 'free up to 300 emails/day',
    steps: [
      'Create a Brevo account (brevo.com) and verify your sender email or domain.',
      'Create an API key (SMTP & API → API keys).',
      'Fill “From email” below with the verified sender.',
      'Add the secrets below to Supabase, then switch Email ON here and press “Send test”. (Resend also works: EMAIL_PROVIDER=resend and RESEND_API_KEY.)',
    ],
    secrets: [['EMAIL_PROVIDER', 'brevo'], ['BREVO_API_KEY', 'Brevo API key'], ['EMAIL_FROM', 'Verified sender, e.g. hr@yourcompany.com']],
  },
}
interface Delivery { id: number; created_at: string; event: string; channel: Channel; recipient: string | null; address: string | null; title: string | null; status: string; attempts: number; last_error: string | null; cost: number | null }

export function NotificationsCard() {
  const { top } = useAuth()
  const isSuper = top('notifications.settings') // CEO, or a General Manager with this power
  const n = useConfig().notifications
  const [guide, setGuide] = useState<keyof typeof GUIDE | null>(null)
  const [matrix, setMatrix] = useState(false)
  const [general, setGeneral] = useState(false)
  const [log, setLog] = useState<Delivery[] | null>(null)
  const [stats, setStats] = useState<{ channel: string; status: string; n: number; cost: number }[]>([])
  const [busy, setBusy] = useState('')
  const save = (next: NotifyConfig) => saveConfig('notifications', next).catch(err)
  const loadLog = async () => {
    const { data, error } = await supabase.from('notification_deliveries').select('id,created_at,event,channel,recipient,address,title,status,attempts,last_error,cost').neq('channel', 'in_app').order('id', { ascending: false }).limit(50)
    if (error) return err(error)
    setLog(data as Delivery[])
    const s = await supabase.rpc('notify_summary', { p_months: 1 })
    setStats(((s.data || []) as { channel: string; status: string; n: number; cost: number }[]))
  }
  useEffect(() => { if (isSuper) void loadLog() }, [isSuper]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!isSuper) return null
  const test = async (c: Channel) => {
    setBusy(c)
    const { error } = await supabase.rpc('notify_test', { p_channel: c })
    setBusy('')
    if (error) return err(error)
    alert('Test queued. See the delivery log below in a few seconds' + (c === 'push' ? '' : ' (without keys it shows “skipped: provider not configured”).'))
    setTimeout(loadLog, 4000)
  }
  const outbound = ['whatsapp', 'email', 'sms'] as const
  const gen: FieldDef[] = [
    { key: 'appUrl', label: 'App link used in messages', full: true },
    { key: 'smsSender', label: 'SMS sender name (after “RM0 ”)' },
    { key: 'fromName', label: 'Email from name' }, { key: 'fromEmail', label: 'Email from address', type: 'email' },
    { key: 'qh', label: 'Quiet hours (non-urgent messages wait)', type: 'checkbox' }, { key: 'qs', label: 'Quiet from', placeholder: '22:00' }, { key: 'qe', label: 'Quiet until', placeholder: '07:00' },
    { key: 'dg', label: 'Daily email digest', type: 'checkbox' }, { key: 'dt', label: 'Digest time', placeholder: '08:00' },
    { key: 'fb', label: 'Send SMS when WhatsApp fails (urgent only)', type: 'checkbox' },
    { key: 'optin', label: 'WhatsApp only to people who opted in', type: 'checkbox' },
  ]
  const sum = (c: string) => stats.filter((x) => x.channel === c && x.status === 'sent').reduce((a, x) => ({ n: a.n + Number(x.n), cost: a.cost + Number(x.cost) }), { n: 0, cost: 0 })
  return (
    <Card title="Notifications" actions={<><Btn small icon="gear" onClick={() => setGeneral(true)}>General</Btn> <Btn small icon="bell" onClick={() => setMatrix(true)}>Events</Btn></>}>
      <p className="muted small">In-app and phone (push) alerts are ON. WhatsApp, email and SMS stay OFF until you add the provider keys — nothing is sent or charged until then.</p>
      <div className="notif-grid">
        {(['in_app', 'push'] as Channel[]).map((c) => (
          <div key={c} className="notif-ch card-ok"><div><strong>{CHANNEL_LABEL[c]}</strong> <Chip tone={n.enabled[c] ? 'green' : 'gray'}>{n.enabled[c] ? 'On' : 'Off'}</Chip></div>
            <label className="check"><input type="checkbox" checked={n.enabled[c]} onChange={(e) => save({ ...n, enabled: { ...n.enabled, [c]: e.target.checked } })} /> Enabled</label>
            {c === 'push' && <Btn small disabled={busy === c} onClick={() => test(c)}>Send test</Btn>}</div>
        ))}
        {outbound.map((c) => {
          const s = sum(c)
          return <div key={c} className={`notif-ch ${n.enabled[c] ? 'card-ok' : 'card-off'}`}>
            <div><strong>{CHANNEL_LABEL[c]}</strong> <Chip tone={n.enabled[c] ? 'green' : 'gray'}>{n.enabled[c] ? 'On' : 'Not configured'}</Chip></div>
            <label className="check"><input type="checkbox" checked={n.enabled[c]} onChange={(e) => { if (e.target.checked && !confirm(`Switch ${CHANNEL_LABEL[c]} ON?\n\nOnly do this after the ${GUIDE[c].title.split(' —')[0]} keys are added in Supabase. Without keys, messages are logged as “skipped: provider not configured”.`)) return; void save({ ...n, enabled: { ...n.enabled, [c]: e.target.checked } }) }} /> Enabled</label>
            <div className="muted small">{GUIDE[c].cost}{s.n ? ` · this month ${s.n} sent, RM ${s.cost.toFixed(2)}` : ''}</div>
            <span><Btn small onClick={() => setGuide(c)}>Setup guide</Btn> <Btn small disabled={!n.enabled[c] || busy === c} onClick={() => test(c)}>Send test</Btn></span>
          </div>
        })}
      </div>

      <h3 className="h3">Delivery log <Btn small kind="ghost" onClick={loadLog}>Refresh</Btn></h3>
      {!log ? <p className="muted small">Loading…</p> : !log.length ? <p className="muted small">No outbound messages yet.</p> : (
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>When</th><th>Event</th><th>Channel</th><th>To</th><th>Status</th><th></th></tr></thead>
          <tbody>{log.map((d) => <tr key={d.id}><td>{fmtDate(d.created_at.slice(0, 10))} {d.created_at.slice(11, 16)}</td><td>{n.events[d.event]?.label || d.event}</td><td>{CHANNEL_LABEL[d.channel]}</td><td>{d.recipient || d.address || '—'}</td>
            <td><Chip tone={d.status === 'sent' || d.status === 'delivered' || d.status === 'read' ? 'green' : d.status === 'failed' ? 'red' : 'gray'}>{d.status}</Chip>{d.last_error && <div className="muted small">{d.last_error}</div>}</td>
            <td>{(d.status === 'failed' || d.status === 'skipped') && <Btn small kind="ghost" onClick={() => supabase.rpc('notify_retry', { p_id: d.id }).then(({ error }) => (error ? err(error) : setTimeout(loadLog, 3000)))}>Retry</Btn>}</td></tr>)}</tbody></table></div>
      )}

      {guide && <Modal title={GUIDE[guide].title} onClose={() => setGuide(null)} footer={<Btn kind="primary" onClick={() => setGuide(null)}>Close</Btn>}>
        <p className="muted small">Cost: {GUIDE[guide].cost}.</p>
        <ol className="guide">{GUIDE[guide].steps.map((s) => <li key={s}>{s}</li>)}</ol>
        <h4>Secrets needed (Supabase → Edge Functions → Secrets)</h4>
        <p className="muted small">Never paste these into the app or share them in chat — only in the Supabase dashboard.</p>
        <table className="tbl"><tbody>{GUIDE[guide].secrets.map(([k, d]) => <tr key={k}><td><code>{k}</code></td><td>{d}</td></tr>)}</tbody></table>
      </Modal>}

      {matrix && <EventMatrix n={n} onClose={() => setMatrix(false)} onSave={async (x) => { await saveConfig('notifications', x); setMatrix(false) }} />}
      {general && <FormModal title="Notification settings" fields={gen} onClose={() => setGeneral(false)}
        initial={{ appUrl: n.appUrl, smsSender: n.smsSender, fromName: n.email.fromName, fromEmail: n.email.fromEmail, qh: n.quietHours.enabled, qs: n.quietHours.start, qe: n.quietHours.end, dg: n.digest.enabled, dt: n.digest.time, fb: n.fallback.enabled, optin: n.whatsapp.requireOptIn }}
        onSave={async (x: V) => {
          const sender = String(x.smsSender || 'FWM').replace(/[^A-Za-z0-9 ]/g, '').slice(0, 20) || 'FWM'
          await saveConfig('notifications', { ...n, appUrl: String(x.appUrl || n.appUrl), smsSender: sender, email: { fromName: String(x.fromName || ''), fromEmail: String(x.fromEmail || '') }, quietHours: { enabled: !!x.qh, start: String(x.qs || '22:00'), end: String(x.qe || '07:00') }, digest: { enabled: !!x.dg, time: String(x.dt || '08:00') }, fallback: { ...n.fallback, enabled: !!x.fb }, whatsapp: { ...n.whatsapp, requireOptIn: !!x.optin } })
          setGeneral(false)
        }} />}
    </Card>
  )
}

function EventMatrix({ n, onClose, onSave }: { n: NotifyConfig; onClose: () => void; onSave: (n: NotifyConfig) => Promise<void> }) {
  const [ev, setEv] = useState(structuredClone(n.events))
  const [busy, setBusy] = useState(false)
  const keys = Object.keys(ev)
  const bad = keys.filter((k) => ev[k].channels.sms && ev[k].sms && !checkSms(ev[k].sms, n.smsSender).ok)
  return (
    <Modal wide title="Who gets what" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={busy} onClick={async () => { setBusy(true); try { await onSave({ ...n, events: ev }) } catch (e) { err(e) } setBusy(false) }}>Save</Btn></>}>
      <p className="muted small">Tick the channels per event. Channels that are switched off (Not configured) are skipped. ⚡ = urgent: ignores quiet hours and personal opt-outs.</p>
      {bad.length > 0 && <p className="neg small">SMS text breaks Malaysian carrier rules for: {bad.map((k) => ev[k].label).join(', ')}</p>}
      <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Event</th><th>On</th><th>⚡</th>{CHANNELS.map((c) => <th key={c} className={n.enabled[c] ? '' : 'muted'}>{CHANNEL_LABEL[c]}</th>)}</tr></thead>
        <tbody>{keys.map((k) => { const e = ev[k]; const up = (p: Partial<typeof e>) => setEv({ ...ev, [k]: { ...e, ...p } })
          return <tr key={k}><td>{e.label}<div className="muted small">{e.group}</div></td>
            <td><input type="checkbox" aria-label={`${e.label} on`} checked={e.enabled} onChange={(x) => up({ enabled: x.target.checked })} /></td>
            <td><input type="checkbox" aria-label={`${e.label} urgent`} checked={e.critical} onChange={(x) => up({ critical: x.target.checked })} /></td>
            {CHANNELS.map((c) => <td key={c}><input type="checkbox" aria-label={`${e.label} ${CHANNEL_LABEL[c]}`} checked={!!e.channels[c]} onChange={(x) => up({ channels: { ...e.channels, [c]: x.target.checked } })} /></td>)}</tr> })}</tbody></table></div>
    </Modal>
  )
}

/* ---------------- My alerts (everyone) ---------------- */
export function MyAlertsCard() {
  const { profile, refreshProfile } = useAuth()
  const n = useConfig().notifications
  const [phone, setPhone] = useState(profile?.phone || '')
  const [out, setOut] = useState<string[]>(profile?.notify_optout || [])
  const [msg, setMsg] = useState('')
  useEffect(() => { setPhone(profile?.phone || ''); setOut(profile?.notify_optout || []) }, [profile])
  if (!profile) return null
  const optional = Object.entries(n.events).filter(([, e]) => e.enabled && !e.critical && e.recipients.length)
  const toggle = (k: string) => setOut(out.includes(k) ? out.filter((x) => x !== k) : [...out, k])
  return (
    <Card title="My alerts">
      <label className="field"><span>My mobile (WhatsApp / SMS)</span><input type="tel" value={phone} placeholder="+60123456789" onChange={(e) => setPhone(e.target.value)} /></label>
      <p className="muted small">Urgent alerts always reach you. Untick the ones you don't want (in-app inbox still keeps them).</p>
      <div className="opt-grid">{optional.map(([k, e]) => <label key={k} className="check"><input type="checkbox" checked={!out.includes(k)} onChange={() => toggle(k)} /> {e.label}</label>)}</div>
      <Btn small kind="primary" onClick={async () => {
        const { error } = await supabase.rpc('update_my_contact', { p_phone: phone, p_optout: out })
        if (error) return setMsg(error.message)
        await refreshProfile(); setMsg('Saved.')
      }}>Save</Btn> <span className="muted small">{msg}</span>
    </Card>
  )
}

/* ---------------- Audit log ---------------- */
interface Audit { id: number; at: string; user_name: string | null; user_role: string | null; action: string; entity: string | null; summary: string | null }
export function AuditCard() {
  const { canSeeAudit } = useAuth()
  const [rows, setRows] = useState<Audit[] | null>(null)
  const [q, setQ] = useState('')
  const load = async () => {
    const { data, error } = await supabase.from('audit_log').select('id,at,user_name,user_role,action,entity,summary').order('id', { ascending: false }).limit(200)
    if (error) return err(error)
    setRows(data as Audit[])
  }
  if (!canSeeAudit) return null
  const f = (rows || []).filter((r) => !q || `${r.user_name} ${r.action} ${r.summary}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <Card title="Audit log" actions={<Btn small onClick={load}>{rows ? 'Refresh' : 'Show'}</Btn>}>
      <p className="muted small">Every approval, role change, document and settings change is recorded by the database and cannot be edited.</p>
      {rows && <>
        <div className="search"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" aria-label="Filter audit log" /></div>
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead>
          <tbody>{f.map((r) => <tr key={r.id}><td>{fmtDate(r.at.slice(0, 10))} {new Date(r.at).toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' })}</td><td>{r.user_name || '—'}<div className="muted small">{ROLE_LABEL[r.user_role || ''] || r.user_role}</div></td><td>{r.action}</td><td>{r.summary}</td></tr>)}</tbody></table></div>
      </>}
    </Card>
  )
}
