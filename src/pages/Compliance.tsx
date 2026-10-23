/* v1.2.2 Compliance: outlet risk, hostels (Act 446), hiring tracker, grievance channel, PDPA, tracker rules. */
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { Btn, Card, Chip, Empty, FormModal, KV, Modal, Tabs, type FieldDef } from '../components/ui'
import { useAuth } from '../lib/auth'
import { saveFormTranslation, saveTrackerConfig, useConfig } from '../lib/config'
import { useOutlets, useWorkers } from '../lib/hooks'
import { isExited } from '../lib/calc'
import { supabase, IS_TEST_BUILD } from '../lib/supabase'
import { isNative } from '../lib/platform'
import { G_CATEGORY, G_STATUS, grievanceLink, updateGrievance, useGrievances, useOutletRisks, type Grievance } from '../lib/risk'
import { CHECK, HIRING_STEPS, RISK_WEIGHTS, hiringIssues, hiringProgress, hostelIssues, type HiringCase, type Hostel, type TrackersConfig } from '../lib/trackers'
import { ZC_EN, ZC_KEYS, ZC_KEY_LABEL, ZC_TR, type ZcText } from '../lib/zeroCostText'
import { LANGUAGES, langDef } from '../lib/languages'
import { download, fmtDate, todayISO, uid } from '../lib/util'
import { toast } from '../components/toast'

type TabId = 'risk' | 'hostels' | 'hiring' | 'grievances' | 'pdpa' | 'rules'
type V = Record<string, unknown>
const s = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim()
const levelTone = (l: string) => (l === 'High' ? 'red' : l === 'Medium' ? 'amber' : 'green')
export const PUBLIC_BASE = 'https://fw.sunrisebayumas.com/'
export function grievanceUrl(token: string) {
  const base = IS_TEST_BUILD && !isNative() ? `${location.origin}${location.pathname}` : PUBLIC_BASE
  return `${base}#/grievance/${token}`
}

export default function CompliancePage() {
  const { isHr, isOM, canWrite } = useAuth()
  const [sp, setSp] = useSearchParams()
  const gr = useGrievances()
  const cfg = useConfig()
  const workers = useWorkers()
  const tabs: { id: TabId; label: string; badge?: number }[] = [
    { id: 'risk', label: 'Outlet risk' },
    { id: 'hostels', label: 'Hostels', badge: cfg.hostels.items.filter((h) => hostelIssues(h, workers.filter((w) => w.hostelId === h.id && !isExited(w)).length, cfg.trackers).some((i) => i.level === 'red')).length },
    { id: 'hiring', label: 'Hiring', badge: cfg.hiring.items.filter((c) => hiringIssues(c).some((i) => i.level === 'red')).length },
    ...(isHr ? [{ id: 'grievances' as const, label: 'Grievances', badge: (gr || []).filter((g) => g.status === 'new').length }] : []),
    { id: 'pdpa', label: 'PDPA' },
    { id: 'rules', label: 'Rules' },
  ]
  const want = (sp.get('tab') as TabId) || 'risk'
  const tab = tabs.some((t) => t.id === want) ? want : 'risk'
  if (isOM || !canWrite) return <div className="page"><Empty title="Not available">Compliance trackers are for HR and management.</Empty></div>
  return (
    <div className="page">
      <div className="page-h"><div><h1>Compliance</h1><p className="muted">Hostels, hiring, complaints, personal data and the risk score for each outlet.</p></div></div>
      <Tabs tabs={tabs} value={tab} onChange={(t) => setSp({ tab: t }, { replace: true })} />
      {tab === 'risk' && <RiskTab />}
      {tab === 'hostels' && <HostelsTab />}
      {tab === 'hiring' && <HiringTab />}
      {tab === 'grievances' && <GrievancesTab rows={gr} />}
      {tab === 'pdpa' && <PdpaTab />}
      {tab === 'rules' && <RulesTab />}
    </div>
  )
}

/* ---------------- risk ---------------- */
export function RiskTable({ limit }: { limit?: number }) {
  const risks = useOutletRisks()
  const rows = limit ? risks.slice(0, limit) : risks
  if (!rows.length) return <p className="muted">No outlets with active workers.</p>
  return (
    <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Outlet</th><th className="num">Workers</th><th className="num">Score</th><th>Level</th><th>Main reasons</th></tr></thead>
      <tbody>{rows.map((r) => {
        const top = r.parts.filter((p) => p.points > 0).sort((a, b) => b.points - a.points).slice(0, 3)
        return <tr key={r.outletId}><td><Link to={`/workers?outlet=${encodeURIComponent(r.outletId)}`}>{r.name}</Link></td><td className="num">{r.workers}</td><td className="num"><strong>{r.score}</strong></td><td><Chip tone={levelTone(r.level)}>{r.level}</Chip></td>
          <td className="small">{top.length ? top.map((p) => `${p.label} (${p.count})`).join(' · ') : <span className="muted">Nothing found</span>}</td></tr>
      })}</tbody></table></div>
  )
}
function RiskTab() {
  const { canSeeSalary, isHr } = useAuth()
  return (
    <>
      <Card title="Outlet risk score"><RiskTable /></Card>
      <Card title="How the score works">
        <p className="small">Each outlet gets 0–100. Every item below adds points depending on how many of the outlet’s workers it affects. 45 or more = High, 20–44 = Medium. It is a guide for where to look first — not a legal finding.</p>
        <ul className="rows compact">{RISK_WEIGHTS.filter((p) => (canSeeSalary || !p.pay) && (p.key !== 'complaints' || isHr)).map((p) => <li key={p.key}><span>{p.label}</span><Chip>{p.weight} pts max</Chip></li>)}</ul>
        {!canSeeSalary && <p className="muted small">Pay items are left out because you do not have salary access; the score is rescaled.</p>}
      </Card>
    </>
  )
}

/* ---------------- hostels ---------------- */
function HostelsTab() {
  const cfg = useConfig()
  const workers = useWorkers()
  const items = cfg.hostels.items
  const [edit, setEdit] = useState<Hostel | null>(null)
  const [insp, setInsp] = useState<Hostel | null>(null)
  const [showArch, setShowArch] = useState(false)
  const save = async (next: Hostel[]) => { try { await saveTrackerConfig('hostels', { items: next }); toast('Saved') } catch (e) { toast((e as Error).message, 'err'); throw e } }
  const occ = (h: Hostel) => workers.filter((w) => w.hostelId === h.id && !isExited(w))
  const fields: FieldDef[] = [
    { key: 'name', label: 'Hostel name', required: true }, { key: 'companyId', label: 'Company', type: 'select', options: cfg.companies.items.map((c) => ({ value: c.id, label: c.name })) },
    { key: 'address', label: 'Address', full: true }, { key: 'state', label: 'State' }, { key: 'landlord', label: 'Landlord / owner' },
    { key: 'certNo', label: 'Certificate for Accommodation no.', hint: 'Issued by JTKSM under Act 446.' }, { key: 'certExpiry', label: 'Certificate valid until', type: 'date' },
    { key: 'capacity', label: 'Approved capacity (persons)', type: 'number' }, { key: 'nextInspection', label: 'Next inspection (planned)', type: 'date' },
    { key: 'notes', label: 'Notes', type: 'textarea', full: true },
  ]
  const shown = items.filter((h) => showArch || !h.archived)
  return (
    <>
      <div className="callout small">Employers must provide accommodation that meets the minimum standards and get a <b>Certificate for Accommodation</b> from JTKSM (Workers’ Minimum Standards of Housing, Accommodations and Amenities Act 1990, Act 446). Housing deductions are capped (RM150/month from 1 March 2026) — {CHECK}.</div>
      <div className="row gap-s wrap" style={{ margin: '12px 0' }}><Btn kind="primary" icon="plus" onClick={() => setEdit({ id: '', name: '', inspections: [], companyId: cfg.companies.items[0]?.id })}>Add hostel</Btn>
        <label className="check small"><input type="checkbox" checked={showArch} onChange={(e) => setShowArch(e.target.checked)} /> Show archived</label></div>
      {!shown.length && <Empty title="No hostels yet">Add each hostel or house where workers live.</Empty>}
      {shown.map((h) => {
        const o = occ(h); const iss = hostelIssues(h, o.length, cfg.trackers)
        const last = [...(h.inspections || [])].sort((a, b) => b.date.localeCompare(a.date))[0]
        return (
          <Card key={h.id} title={<>🏠 {h.name} {h.archived && <Chip>archived</Chip>}</>} actions={<><Btn small icon="plus" onClick={() => setInsp(h)}>Inspection</Btn><Btn small icon="edit" onClick={() => setEdit(h)}>Edit</Btn></>}>
            <KV items={[['Certificate', h.certNo ? `${h.certNo}${h.certExpiry ? ` · ${h.certExpiry < todayISO() ? 'expired' : 'valid until'} ${fmtDate(h.certExpiry)}` : ''}` : '—'], ['Workers living here', `${o.length}${h.capacity ? ` of ${h.capacity}` : ''}`],
              ['Last inspection', last ? `${fmtDate(last.date)} · ${last.result}${last.by ? ` · ${last.by}` : ''}` : '—'], ['Address', [h.address, h.state].filter(Boolean).join(', ') || '—']]} />
            {iss.map((i) => <p key={i.text} className={i.level === 'red' ? 'err small' : 'small'}>⚠️ {i.text}</p>)}
            {o.length > 0 && <p className="small muted">{o.map((w) => <Link key={w.id} to={`/workers/${w.id}?tab=trackers`} style={{ marginRight: 8 }}>{w.fullName}</Link>)}</p>}
          </Card>
        )
      })}
      {edit && <FormModal title={edit.id ? 'Edit hostel' : 'Add hostel'} fields={[...fields, ...(edit.id ? [{ key: 'archived', label: 'Archived (no longer used)', type: 'checkbox' as const, full: true }] : [])]} initial={edit as unknown as V} onClose={() => setEdit(null)}
        onSave={async (v) => {
          const h: Hostel = { ...edit, id: edit.id || uid(), name: s(v.name), companyId: s(v.companyId) || undefined, address: s(v.address) || undefined, state: s(v.state) || undefined, landlord: s(v.landlord) || undefined, certNo: s(v.certNo) || undefined, certExpiry: s(v.certExpiry) || undefined, capacity: Number(v.capacity) || undefined, nextInspection: s(v.nextInspection) || undefined, notes: s(v.notes) || undefined, archived: !!v.archived || undefined }
          await save(edit.id ? items.map((x) => (x.id === h.id ? h : x)) : [...items, h])
        }} />}
      {insp && <FormModal title={`Inspection — ${insp.name}`} fields={[{ key: 'date', label: 'Date', type: 'date', required: true }, { key: 'by', label: 'By (JTKSM officer / internal)' }, { key: 'result', label: 'Result', type: 'select', options: ['Passed', 'Issues found', 'Failed'], required: true }, { key: 'notes', label: 'Notes', type: 'textarea', full: true }]}
        initial={{ date: todayISO(), result: 'Passed' }} onClose={() => setInsp(null)}
        onSave={async (v) => { await save(items.map((x) => (x.id === insp.id ? { ...x, nextInspection: undefined, inspections: [...(x.inspections || []), { id: uid(), date: s(v.date), by: s(v.by) || undefined, result: s(v.result) as 'Passed', notes: s(v.notes) || undefined }] } : x))) }}>
        {() => insp.inspections?.length ? <p className="muted small">Earlier: {[...insp.inspections].sort((a, b) => b.date.localeCompare(a.date)).map((i) => `${fmtDate(i.date)} ${i.result}`).join(' · ')}</p> : null}
      </FormModal>}
    </>
  )
}

/* ---------------- hiring ---------------- */
function HiringTab() {
  const cfg = useConfig()
  const outlets = useOutlets()
  const items = cfg.hiring.items
  const [edit, setEdit] = useState<HiringCase | null>(null)
  const [step, setStep] = useState<{ c: HiringCase; key: string } | null>(null)
  const [closed, setClosed] = useState(false)
  const save = async (next: HiringCase[]) => { try { await saveTrackerConfig('hiring', { items: next }); toast('Saved') } catch (e) { toast((e as Error).message, 'err'); throw e } }
  const shown = items.filter((c) => closed || !c.closed).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const fields: FieldDef[] = [
    { key: 'title', label: 'Name of this hiring', required: true, placeholder: 'e.g. 4 kitchen helpers — Nepal, 2027' },
    { key: 'outletId', label: 'Outlet', type: 'select', options: [{ value: '', label: '—' }, ...outlets.map((o) => ({ value: o.id, label: o.name }))] },
    { key: 'job', label: 'Job' }, { key: 'count', label: 'Number of workers', type: 'number', required: true }, { key: 'nationality', label: 'Source country' }, { key: 'agent', label: 'Agent' },
    { key: 'candidateNames', label: 'Candidate names', type: 'textarea', full: true }, { key: 'notes', label: 'Notes', type: 'textarea', full: true },
  ]
  const def = step && HIRING_STEPS.find((x) => x.key === step.key)
  return (
    <>
      <div className="callout small">Steps for hiring a new foreign worker: advertise to locals on MYFutureJobs for at least 14 days and keep the interview record → quota and approval in FWCMS (Employment Act s.60K) → VDR / calling visa → arrival → FOMEMA medical within 30 days → PLKS issued. Requirements change often — {CHECK}.</div>
      <div className="row gap-s wrap" style={{ margin: '12px 0' }}><Btn kind="primary" icon="plus" onClick={() => setEdit({ id: '', title: '', count: 1, steps: {}, createdAt: todayISO() })}>New hiring</Btn>
        <label className="check small"><input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} /> Show finished</label></div>
      {!shown.length && <Empty title="No hiring in progress">Start one when you plan to bring in new workers.</Empty>}
      {shown.map((c) => {
        const iss = hiringIssues(c)
        return (
          <Card key={c.id} title={<>🧳 {c.title} {c.closed && <Chip>finished</Chip>}</>} actions={<><Btn small icon="edit" onClick={() => setEdit(c)}>Edit</Btn><Btn small kind="ghost" onClick={() => void save(items.map((x) => (x.id === c.id ? { ...x, closed: !x.closed } : x)))}>{c.closed ? 'Reopen' : 'Finish'}</Btn></>}>
            <p className="small muted">{[c.count && `${c.count} worker(s)`, c.job, c.nationality, c.agent && `agent ${c.agent}`, outlets.find((o) => o.id === c.outletId)?.name].filter(Boolean).join(' · ')} · {hiringProgress(c)} of {HIRING_STEPS.length} steps</p>
            <ul className="rows compact">{HIRING_STEPS.map((st) => { const r = c.steps?.[st.key] || {}; return <li key={st.key}><div className="r-main"><strong>{r.done ? '✅' : '⬜'} {st.label}</strong><small>{r.date || r.ref ? `${fmtDate(r.date)}${r.ref ? ` · ref ${r.ref}` : ''}${r.note ? ` · ${r.note}` : ''}` : st.hint}</small></div><Btn small onClick={() => setStep({ c, key: st.key })}>{r.done ? 'Edit' : 'Update'}</Btn></li> })}</ul>
            {iss.map((i) => <p key={i.text} className={i.level === 'red' ? 'err small' : 'small'}>{i.level === 'info' ? 'ℹ️' : '⚠️'} {i.text}</p>)}
          </Card>
        )
      })}
      {edit && <FormModal title={edit.id ? 'Edit hiring' : 'New hiring'} fields={fields} initial={edit as unknown as V} onClose={() => setEdit(null)}
        onDelete={edit.id ? () => void save(items.filter((x) => x.id !== edit.id)) : undefined}
        onSave={async (v) => {
          const c: HiringCase = { ...edit, id: edit.id || uid(), title: s(v.title), outletId: s(v.outletId) || undefined, companyId: undefined, job: s(v.job) || undefined, count: Number(v.count) || 1, nationality: s(v.nationality) || undefined, agent: s(v.agent) || undefined, candidateNames: s(v.candidateNames) || undefined, notes: s(v.notes) || undefined }
          await save(edit.id ? items.map((x) => (x.id === c.id ? c : x)) : [...items, c])
        }} />}
      {step && def && <FormModal title={def.label} fields={[{ key: 'done', label: 'Done', type: 'checkbox', full: true }, { key: 'date', label: step.key === 'advert' ? 'Advert start date' : step.key === 'arrival' ? 'Arrival date' : 'Date', type: 'date' }, { key: 'ref', label: 'Reference no.' }, { key: 'note', label: 'Note', type: 'textarea', full: true }]}
        initial={{ done: false, date: todayISO(), ...(step.c.steps?.[step.key as 'advert'] || {}) }} onClose={() => setStep(null)}
        onSave={async (v) => { await save(items.map((x) => (x.id === step.c.id ? { ...x, steps: { ...x.steps, [step.key]: { done: !!v.done, date: s(v.date) || undefined, ref: s(v.ref) || undefined, note: s(v.note) || undefined } } } : x))) }}>
        {() => <p className="muted small">{def.hint}</p>}
      </FormModal>}
    </>
  )
}

/* ---------------- grievances ---------------- */
function GrievanceLinkCard() {
  const cfg = useConfig()
  const { myCompanies, isSuper, isGm } = useAuth()
  const cos = cfg.companies.items.filter((c) => isSuper || isGm || !myCompanies.length || myCompanies.includes('*') || myCompanies.includes(c.id))
  const [co, setCo] = useState(cos[0]?.id || '')
  const [link, setLink] = useState<{ token?: string; enabled?: boolean; canManage?: boolean } | null>(null)
  const [qr, setQr] = useState('')
  const [err, setErr] = useState('')
  const load = async (opts: { rotate?: boolean; enabled?: boolean } = {}) => {
    setErr('')
    try { const r = await grievanceLink(co, opts); if (!r.ok) throw new Error(r.reason || 'Not allowed'); setLink(r) } catch (e) { setErr((e as Error).message); setLink(null) }
  }
  useEffect(() => { if (co) void load() }, [co]) // eslint-disable-line react-hooks/exhaustive-deps
  const url = link?.token ? grievanceUrl(link.token) : ''
  useEffect(() => { if (url) void QRCode.toDataURL(url, { margin: 1, width: 360 }).then(setQr); else setQr('') }, [url])
  return (
    <Card title="Worker complaint link & QR code">
      <p className="small">Put the QR code on the hostel and staff-room notice board. Workers can send a complaint in their own language, with or without their name, and check the answer with a tracking code. Complaints go to HR (never to outlet managers).</p>
      {cos.length > 1 && <label className="field" style={{ maxWidth: 320 }}><span>Company</span><select value={co} onChange={(e) => setCo(e.target.value)}>{cos.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
      {err && <p className="err small">{err}</p>}
      {link?.token && <div className="row gap-s wrap" style={{ alignItems: 'flex-start', marginTop: 8 }}>
        {qr && <img src={qr} alt="QR code for the complaint link" width={180} height={180} style={{ border: '1px solid var(--line)', borderRadius: 8, opacity: link.enabled ? 1 : 0.3 }} />}
        <div className="grow">
          <p className="small"><Chip tone={link.enabled ? 'green' : 'red'}>{link.enabled ? 'Link is on' : 'Link is off'}</Chip></p>
          <p className="small" style={{ wordBreak: 'break-all' }}><code>{url}</code></p>
          <div className="row gap-s wrap">
            <Btn small onClick={() => { void navigator.clipboard?.writeText(url); toast('Link copied') }}>Copy link</Btn>
            {qr && <Btn small icon="download" onClick={() => { const a = document.createElement('a'); a.href = qr; a.download = `complaint-qr-${co}.png`; a.click() }}>Download QR</Btn>}
            {link.canManage && <Btn small onClick={() => { if (confirm('Make a new link? The old link and QR code stop working.')) void load({ rotate: true }) }}>New link</Btn>}
            {link.canManage && <Btn small kind={link.enabled ? 'danger' : 'primary'} onClick={() => void load({ enabled: !link.enabled })}>{link.enabled ? 'Turn off' : 'Turn on'}</Btn>}
          </div>
        </div>
      </div>}
    </Card>
  )
}
function GrievancesTab({ rows }: { rows: Grievance[] | null }) {
  const outlets = useOutlets()
  const cfg = useConfig()
  const [f, setF] = useState<'open' | 'all' | Grievance['status']>('open')
  const [open, setOpen] = useState<Grievance | null>(null)
  const list = (rows || []).filter((g) => (f === 'all' ? true : f === 'open' ? g.status !== 'closed' : g.status === f))
  return (
    <>
      <GrievanceLinkCard />
      <Card title="Complaints received" actions={<select value={f} onChange={(e) => setF(e.target.value as 'open')} aria-label="Filter"><option value="open">Open</option><option value="all">All</option>{Object.entries(G_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}>
        {rows === null ? <p className="muted">Loading…</p> : !list.length ? <p className="muted">No complaints{f !== 'all' ? ' in this view' : ''}.</p> : (
          <ul className="rows">{list.map((g) => <li key={g.id}>
            <div className="r-main"><strong>{g.ref_no} · {G_CATEGORY[g.category] || g.category}</strong>
              <small>{fmtDate(g.created_at.slice(0, 10))} · {g.anonymous ? 'Anonymous' : g.name || 'Named'}{g.outlet_id ? ` · ${outlets.find((o) => o.id === g.outlet_id)?.name || g.outlet_id}` : ''}{cfg.companies.items.length > 1 ? ` · ${cfg.companies.items.find((c) => c.id === g.company_id)?.name || ''}` : ''}</small>
              <small style={{ color: 'inherit' }}>{g.message.length > 140 ? `${g.message.slice(0, 140)}…` : g.message}</small></div>
            <Chip tone={g.status === 'new' ? 'red' : g.status === 'in_review' ? 'amber' : g.status === 'action_taken' ? 'blue' : 'green'}>{G_STATUS[g.status]}</Chip>
            <Btn small onClick={() => setOpen(g)}>Open</Btn></li>)}</ul>)}
        <p className="muted small">Retaliating against a worker for complaining is not allowed. Keep the worker’s identity confidential.</p>
      </Card>
      {open && <GrievanceModal g={open} onClose={() => setOpen(null)} />}
    </>
  )
}
function GrievanceModal({ g, onClose }: { g: Grievance; onClose: () => void }) {
  const outlets = useOutlets()
  const [status, setStatus] = useState<Grievance['status']>(g.status === 'new' ? 'in_review' : g.status)
  const [note, setNote] = useState('')
  const [reply, setReply] = useState(g.public_reply || '')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try { await updateGrievance(g.id, { status, note: note.trim() || undefined, reply: reply.trim() !== (g.public_reply || '') ? reply : undefined }); toast('Saved'); onClose() } catch (e) { toast((e as Error).message, 'err') } finally { setBusy(false) }
  }
  return (
    <Modal wide title={`${g.ref_no} · ${G_CATEGORY[g.category] || g.category}`} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Btn></>}>
      <KV items={[['Received', new Date(g.created_at).toLocaleString()], ['From', g.anonymous ? 'Anonymous' : [g.name, g.worker_no, g.contact].filter(Boolean).join(' · ') || '—'], ['Outlet', g.outlet_id ? outlets.find((o) => o.id === g.outlet_id)?.name || g.outlet_id : '—'], ['Language', langDef(g.language || '')?.name || g.language || '—']]} />
      <div className="banner" style={{ whiteSpace: 'pre-wrap', margin: '10px 0' }}>{g.message}</div>
      <div className="grid-form">
        <label className="field"><span>Status</span><select value={status} onChange={(e) => setStatus(e.target.value as 'new')}>{Object.entries(G_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field full"><span>Reply the worker sees (with the tracking code)</span><textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Short, plain answer. Do not include other workers’ details." /></label>
        <label className="field full"><span>Internal note (HR only)</span><textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      {g.history?.length > 0 && <><h4>History</h4><ul className="rows compact">{g.history.map((h, i) => <li key={i}><div className="r-main"><strong>{G_STATUS[h.status as 'new'] || h.status}</strong><small>{new Date(h.at).toLocaleString()} · {h.by}{h.note ? ` · ${h.note}` : ''}</small></div></li>)}</ul></>}
    </Modal>
  )
}

/* ---------------- PDPA ---------------- */
interface Breach { id: string; found_at: string; occurred_at?: string | null; title: string; description?: string | null; data_types?: string | null; people_affected?: number | null; severity: string; actions?: string | null; commissioner_notified: boolean; commissioner_notified_at?: string | null; people_notified: boolean; people_notified_at?: string | null; status: string }
function PdpaTab() {
  const { isSuper, isHrAdmin, top } = useAuth()
  const canLog = isSuper || isHrAdmin || top('compliance.settings')
  const workers = useWorkers().filter((w) => !isExited(w))
  const [rows, setRows] = useState<Breach[] | null>(null)
  const [edit, setEdit] = useState<Partial<Breach> | null>(null)
  const [t, setT] = useState(0)
  useEffect(() => { if (!canLog) return; void supabase.from('pdpa_breaches').select('*').order('found_at', { ascending: false }).then(({ data }) => setRows((data || []) as Breach[])) }, [canLog, t])
  const c = useMemo(() => ({
    given: workers.filter((w) => w.pdpa?.status === 'given').length, withdrawn: workers.filter((w) => w.pdpa?.status === 'withdrawn').length,
    none: workers.filter((w) => !w.pdpa || w.pdpa.status === 'not_recorded').length,
    zc: workers.filter((w) => w.zeroCost?.status === 'signed').length,
  }), [workers])
  const fields: FieldDef[] = [
    { key: 'title', label: 'What happened (short)', required: true, full: true }, { key: 'found_at', label: 'Date found', type: 'date', required: true }, { key: 'occurred_at', label: 'Date it happened (if known)', type: 'date' },
    { key: 'description', label: 'Details', type: 'textarea', full: true }, { key: 'data_types', label: 'Data involved (e.g. passport copies, medical, salary)', full: true },
    { key: 'people_affected', label: 'People affected', type: 'number' }, { key: 'severity', label: 'Seriousness', type: 'select', options: ['low', 'medium', 'high'], required: true },
    { key: 'actions', label: 'Actions taken', type: 'textarea', full: true },
    { key: 'commissioner_notified', label: 'PDP Commissioner notified', type: 'checkbox' }, { key: 'commissioner_notified_at', label: 'Date notified', type: 'date', show: (v) => !!v.commissioner_notified },
    { key: 'people_notified', label: 'Affected people told', type: 'checkbox' }, { key: 'people_notified_at', label: 'Date told', type: 'date', show: (v) => !!v.people_notified },
    { key: 'status', label: 'Status', type: 'select', options: ['open', 'contained', 'closed'], required: true },
  ]
  return (
    <>
      <Card title="Consent & notices (current workers)">
        <KV items={[['PDPA notice & consent recorded', `${c.given} of ${workers.length}`], ['Consent withdrawn', String(c.withdrawn)], ['Not recorded yet', String(c.none)], ['Zero-cost declaration signed', `${c.zc} of ${workers.length}`]]} />
        <p className="muted small">Record each worker’s notice / consent in the worker → Compliance tab. Medical documents are only visible to HR and management (not outlet managers or view-only users). Personal Data Protection Act 2010 (amended 2024) — check with the PDP Commissioner (JPDP) or your adviser.</p>
      </Card>
      {canLog ? (
        <Card title="Data breach log" actions={<Btn small icon="plus" onClick={() => setEdit({ found_at: todayISO(), severity: 'medium', status: 'open' })}>Log a breach</Btn>}>
          <div className="callout warn small">If personal data is lost, stolen or seen by the wrong people: contain it, then notify the Personal Data Protection Commissioner as soon as practicable — the guideline is within <b>72 hours</b> — and tell the affected people without undue delay if they could suffer significant harm. Check with the PDP Commissioner (JPDP) or your adviser.</div>
          {rows === null ? <p className="muted">Loading…</p> : !rows.length ? <p className="muted">No breaches logged.</p> : (
            <ul className="rows">{rows.map((b) => {
              const hrs = Math.floor((Date.now() - new Date(b.found_at).getTime()) / 3600000)
              return <li key={b.id}><div className="r-main"><strong>{b.title}</strong><small>Found {fmtDate(b.found_at)} · {b.severity}{b.people_affected ? ` · ${b.people_affected} people` : ''} · Commissioner {b.commissioner_notified ? `notified ${fmtDate(b.commissioner_notified_at || '')}` : hrs > 72 ? 'NOT notified (over 72 h)' : 'not notified yet'}</small></div>
                <Chip tone={b.status === 'closed' ? 'green' : b.status === 'contained' ? 'amber' : 'red'}>{b.status}</Chip><Btn small icon="edit" onClick={() => setEdit(b)}>Edit</Btn></li>
            })}</ul>)}
          <Btn small icon="download" onClick={() => download(`pdpa-breach-log-${todayISO()}.json`, JSON.stringify(rows || [], null, 2), 'application/json')}>Export</Btn>
        </Card>
      ) : <p className="muted small">The data breach log is kept by the CEO, HR Admin or a General Manager with compliance settings.</p>}
      {edit && <FormModal title={edit.id ? 'Edit breach' : 'Log a data breach'} fields={fields} initial={edit as V} onClose={() => setEdit(null)}
        onSave={async (v) => { const { error } = await supabase.rpc('save_breach', { p: { ...v, id: edit.id || '' } }); if (error) { toast(error.message, 'err'); throw new Error(error.message) } toast('Saved'); setT((x) => x + 1) }} />}
    </>
  )
}

/* ---------------- rules ---------------- */
function RulesTab() {
  const cfg = useConfig()
  const { isSuper, isHrAdmin, top } = useAuth()
  const can = isSuper || isHrAdmin || top('compliance.settings')
  const t = cfg.trackers
  const [edit, setEdit] = useState(false)
  const fields: FieldDef[] = [
    { key: 'jobMatchOn', label: 'Show job-permit match warnings', type: 'checkbox', full: true },
    { key: 'officeTypes', label: 'Outlet types treated as an office (one per line)', type: 'textarea' }, { key: 'frontRoles', label: 'Jobs treated as front-of-house (one per line)', type: 'textarea' },
    { key: 'stayCapYears', label: 'Total stay limit (years)', type: 'number' }, { key: 'stayWarnYears', label: 'First warning at (years)', type: 'number' }, { key: 'stayHighYears', label: 'Urgent warning at (years)', type: 'number' },
    { key: 'plksLeadDays', label: 'PLKS renewal reminder (days before expiry)', type: 'number' }, { key: 'passportWarnMonths', label: 'Passport warning (months before expiry)', type: 'number' }, { key: 'passportMinMonths', label: 'Passport validity needed for renewal (months)', type: 'number' },
    { key: 'fomemaEveryMonths', label: 'FOMEMA every (months)', type: 'number' }, { key: 'bondMinMonths', label: 'Security bond validity at renewal (months)', type: 'number' }, { key: 'inspectEveryMonths', label: 'Hostel inspection every (months)', type: 'number' },
    { key: 'abscondPoliceDays', label: 'Absconding: police report target (days)', type: 'number' }, { key: 'abscondImmigrationDays', label: 'Absconding: Immigration report target (days)', type: 'number' },
    { key: 'levy', label: 'Default levy per year (RM)', type: 'money', hint: 'RM1,850 Peninsular Malaysia; RM1,490 Sabah & Sarawak — ' + CHECK + '.' },
  ]
  const init: V = { ...t, officeTypes: t.officeTypes.join('\n'), frontRoles: t.frontRoles.join('\n'), levy: t.costDefaults.Levy ?? 1850 }
  const lines = (v: unknown) => s(v).split('\n').map((x) => x.trim()).filter(Boolean)
  return (
    <>
      <Card title="Tracker rules" actions={can ? <Btn small icon="edit" onClick={() => setEdit(true)}>Edit</Btn> : undefined}>
        <KV items={[['Job-permit warnings', t.jobMatchOn ? 'On' : 'Off'], ['Office outlet types', t.officeTypes.join(', ') || '—'], ['Front-of-house jobs', t.frontRoles.join(', ') || '—'],
          ['10-year stay', `limit ${t.stayCapYears} y · warn at ${t.stayWarnYears} y and ${t.stayHighYears} y`], ['PLKS renewal', `${t.plksLeadDays} days ahead`], ['Passport', `warn ${t.passportWarnMonths} months ahead · ${t.passportMinMonths} months needed`],
          ['FOMEMA', `every ${t.fomemaEveryMonths} months`], ['Security bond', `${t.bondMinMonths} months at renewal`], ['Absconding targets', `police ${t.abscondPoliceDays} d · Immigration ${t.abscondImmigrationDays} d (company targets)`], ['Default levy', `RM${t.costDefaults.Levy ?? 1850}`]]} />
        <p className="muted small">These follow the Immigration Department’s published conditions for the Temporary Employment Visit Pass (PLKS). Conditions change — {CHECK}.</p>
      </Card>
      <ZeroCostTranslationsCard />
      {edit && <FormModal title="Tracker rules" fields={fields} initial={init} onClose={() => setEdit(false)}
        validate={(v) => (Number(v.stayWarnYears) > Number(v.stayCapYears) ? 'The warning must come before the limit' : null)}
        onSave={async (v) => {
          const num = (k: keyof TrackersConfig) => Number(v[k]) || (t[k] as number)
          const next: TrackersConfig = { ...t, jobMatchOn: !!v.jobMatchOn, officeTypes: lines(v.officeTypes), frontRoles: lines(v.frontRoles), stayCapYears: num('stayCapYears'), stayWarnYears: num('stayWarnYears'), stayHighYears: num('stayHighYears'), plksLeadDays: num('plksLeadDays'), passportWarnMonths: num('passportWarnMonths'), passportMinMonths: num('passportMinMonths'), fomemaEveryMonths: num('fomemaEveryMonths'), bondMinMonths: num('bondMinMonths'), inspectEveryMonths: num('inspectEveryMonths'), abscondPoliceDays: num('abscondPoliceDays'), abscondImmigrationDays: num('abscondImmigrationDays'), costDefaults: { ...t.costDefaults, Levy: Number(v.levy) || 1850 } }
          try { await saveTrackerConfig('trackers', next); toast('Saved') } catch (e) { toast((e as Error).message, 'err'); throw e }
        }} />}
    </>
  )
}

const EDITABLE = LANGUAGES.filter((l) => l.code !== 'en' && l.code !== 'other')
function ZeroCostTranslationsCard() {
  const { isSuper, isHrAdmin, profile, top } = useAuth()
  const items = useConfig().zerocost_translations?.items || {}
  const [edit, setEdit] = useState<string | null>(null)
  if (!isSuper && !isHrAdmin && !top('compliance.settings')) return null
  return (
    <Card title="Zero-cost declaration translations">
      <p className="muted small">The zero-cost recruitment declaration prints in <b>English + the worker’s language</b> (English + Bahasa Malaysia when there is no translation). The built-in translations have <b>not been checked by native speakers</b> — please have each one checked and corrected here.</p>
      <ul className="rows">{EDITABLE.map((l) => {
        const ov = items[l.code]; const n = ov ? Object.values(ov.text || {}).filter((v) => (v || '').trim()).length : 0
        return <li key={l.code}><div className="r-main"><strong>{l.name}{l.native && l.native !== l.name ? ` — ${l.native}` : ''}</strong><small>{ZC_TR[l.code] ? 'Built-in translation' : 'No built-in translation — type every field to enable it'}{n ? ` · ${n} field(s) corrected` : ''}</small></div>
          {ov?.checked ? <Chip tone="green">Checked{ov.checkedBy ? ` · ${ov.checkedBy}` : ''}</Chip> : <Chip tone="amber">Not native-checked</Chip>}<Btn small icon="edit" onClick={() => setEdit(l.code)}>Edit</Btn></li>
      })}</ul>
      {edit && <ZcEditModal code={edit} me={profile?.full_name || profile?.email || ''} onClose={() => setEdit(null)} />}
    </Card>
  )
}
function ZcEditModal({ code, me, onClose }: { code: string; me: string; onClose: () => void }) {
  const ov = useConfig().zerocost_translations?.items?.[code]
  const base: Partial<ZcText> = ZC_TR[code] || {}
  const [text, setText] = useState<Partial<ZcText>>({ ...(ov?.text || {}) })
  const [checked, setChecked] = useState(!!ov?.checked)
  const [checkedBy, setCheckedBy] = useState(ov?.checkedBy || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const d = langDef(code)
  const save = async (reset?: boolean) => {
    setBusy(true); setErr('')
    try {
      const clean = Object.fromEntries(Object.entries(text).filter(([, v]) => (v || '').trim()).map(([k, v]) => [k, (v || '').trim()]))
      if (!base.title && !reset && !ZC_KEYS.every((k) => clean[k])) throw new Error('This language has no built-in translation: fill in every field (or leave it all blank).')
      await saveFormTranslation('zerocost', code, reset ? null : { text: clean, checked, checkedBy: checked ? checkedBy.trim() : undefined, updatedAt: new Date().toISOString(), updatedBy: me })
      onClose()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Modal wide title={`Zero-cost declaration — ${d?.name || code}`} onClose={onClose} footer={<>
      {ov && <Btn onClick={() => { if (confirm('Go back to the built-in translation?')) void save(true) }} disabled={busy}>Reset to built-in</Btn>}
      <Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Btn></>}>
      <p className="muted small">Leave a box empty to keep the built-in text (shown greyed). English reference is under each box.</p>
      {err && <div className="banner red">{err}</div>}
      <div className="grid-form">{ZC_KEYS.map((k) => (
        <label key={k} className="field full"><span>{ZC_KEY_LABEL[k]}</span>
          <textarea dir={d?.rtl ? 'rtl' : undefined} rows={k === 'title' || k === 'reference' ? 1 : 2} value={text[k] || ''} placeholder={base[k] || ''} onChange={(e) => setText({ ...text, [k]: e.target.value })} />
          <small className="muted">EN: {ZC_EN[k]}</small></label>))}</div>
      <label className="check"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> A native speaker has checked this translation</label>
      {checked && <label className="field"><span>Checked by (name)</span><input value={checkedBy} onChange={(e) => setCheckedBy(e.target.value)} /></label>}
    </Modal>
  )
}
