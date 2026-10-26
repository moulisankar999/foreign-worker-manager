/* Quota extras: master table (company → letters → sector → grand total), HR follow-ups (GM / CEO), replacement applications,
 * government windows, the quota application checklist + levy, and the COM follow-up (departure letter, bond refund). */
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Btn, Card, Empty, Toolbar } from '../../components/ui'
import { DataTable, Details } from '../../components/dataTable'
import { Actions, IconAction } from '../../components/iconAction'
import { Preview } from '../../reports/Preview'
import type { Block } from '../../reports/types'
import { supabase } from '../../lib/supabase'
import { fmtDate, todayISO } from '../../lib/util'
import { inCompany, atMyt, qcall, rmFmt, useQuota, type Exit, type MasterRow, type Quota, type Replacement } from '../../lib/quota'
import { FileField, FileLink, NoteAsk, QForm, run, s, useQCtx, useSheetMeta, type V } from './shared'

const NUMS: [keyof MasterRow | 'pend' | 'pipe', string][] = [['approved', 'Approved'], ['reserved', 'Reserved'], ['used', 'Used'], ['pend', 'Pending cancellation'], ['available', 'Available'], ['pipe', 'In pipeline'], ['active_workers', 'Active workers'], ['runaways', 'Runaways'], ['expiring_unused', 'Expiring unused']]
type MRow = MasterRow & { pend: number; pipe: number }

/* ---------------- master table ---------------- */
export function MasterTable({ company }: { company: string }) {
  const ctx = useQCtx()
  const d = useQuota()
  const [sort, setSort] = useState<{ k: string; dir: 1 | -1 }>({ k: 'expiry_date', dir: 1 })
  const [q, setQ] = useState('')
  const [print, setPrint] = useState(false)
  const extra = (quota: string | null) => { const t = d.tally.filter((x) => x.quota_id === quota); return { pend: t.reduce((a, x) => a + (x.pending_cancel || 0), 0), pipe: t.reduce((a, x) => a + (x.in_pipeline || 0), 0) } }
  const rows: MRow[] = d.master.filter((m) => m.level === 'sector' || m.level === 'total' || inCompany(company, m.company_id || ''))
    .map((m) => ({ ...m, ...(m.level === 'letter' ? extra(m.quota_id) : { pend: 0, pipe: 0 }) }))
  const letters = rows.filter((m) => m.level === 'letter' && (!q || `${m.ref_no} ${m.sector} ${ctx.cName(m.company_id)}`.toLowerCase().includes(q.toLowerCase())))
  const sum = (l: MRow[], k: string) => l.reduce((a, x) => a + Number((x as unknown as Record<string, number>)[k] || 0), 0)
  for (const m of rows) if (m.level !== 'letter') { const l = letters.filter((x) => (m.level === 'company' ? x.company_id === m.company_id : m.level === 'sector' ? x.sector === m.sector : true)); m.pend = sum(l, 'pend'); m.pipe = sum(l, 'pipe') }
  const cos = [...new Set(letters.map((m) => m.company_id || ''))].sort((a, b) => ctx.cName(a).localeCompare(ctx.cName(b)))
  const cmp = (a: MRow, b: MRow) => { const x = (a as unknown as Record<string, string | number | null>)[sort.k] ?? '', y = (b as unknown as Record<string, string | number | null>)[sort.k] ?? ''; return (x < y ? -1 : x > y ? 1 : 0) * sort.dir }
  const sectors = [...new Set(letters.map((m) => m.sector || 'Unspecified'))].sort()
  // totals are recomputed from what is shown, so a search / company filter keeps the totals honest
  const tot = (l: MRow[], label: string): Record<string, string | number> => Object.fromEntries([['label', label], ...NUMS.map(([k]) => [k, sum(l, k as string)])])
  const grand = tot(letters, 'Grand total')
  const th = (k: string, label: string, num = true) => <th className={num ? 'r' : ''} aria-sort={sort.k === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
    <button type="button" className="qr-th" onClick={() => setSort({ k, dir: sort.k === k ? (-sort.dir as 1 | -1) : 1 })}>{label}{sort.k === k ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</button></th>
  const meta = useSheetMeta(company, 'Quota master table', company ? ctx.cName(company) : 'All companies', true)
  const blocks: Block[] = [
    { kind: 'table', title: 'Approved quota per company and letter', groupBy: 'co',
      cols: [{ key: 'co', label: 'Company', w: 10 }, { key: 'ref', label: 'Letter', w: 12, wrap: true }, { key: 'sector', label: 'Sector', w: 8 }, { key: 'exp', label: 'Expires', w: 7, fmt: 'date' }, ...NUMS.map(([k, label]) => ({ key: k as string, label, w: 5, fmt: 'int' as const }))],
      rows: cos.flatMap((c) => letters.filter((m) => m.company_id === c).sort(cmp).map((m) => ({ ...(m as unknown as Record<string, number>), co: ctx.cName(c), ref: m.ref_no || '', sector: m.sector || '', exp: m.expiry_date || '', _tone: m.days_left !== null && m.days_left <= 30 && m.available > 0 ? 'red' as const : undefined }))),
      totals: { ...grand, ref: 'Grand total' } },
    { kind: 'table', title: 'Per sector', cols: [{ key: 'label', label: 'Sector', w: 14 }, ...NUMS.map(([k, label]) => ({ key: k as string, label, w: 5, fmt: 'int' as const }))],
      rows: sectors.map((sc) => tot(letters.filter((m) => (m.sector || 'Unspecified') === sc), sc)), totals: grand },
    { kind: 'signatures' },
  ]
  const Num = ({ v }: { v: number }) => <td className="r qr-num">{v || <span className="muted">0</span>}</td>
  const line = (m: Record<string, string | number>, label: React.ReactNode, cls: string, key: string) => <tr key={key} className={cls}><td colSpan={4}>{label}</td>{NUMS.map(([k]) => <Num key={k} v={Number(m[k as string] || 0)} />)}</tr>
  return (
    <Card title="Master table" actions={<Toolbar><input className="qr-search" placeholder="Search letter / sector" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the master table" />
      <IconAction kind="print" label="A4 master table with sign-off" onClick={() => setPrint(true)} /></Toolbar>}>
      {letters.length ? <div className="qr-scroll"><table className="qr-master qr-sticky">
        <thead><tr>{th('ref_no', 'Letter', false)}{th('sector', 'Sector', false)}{th('expiry_date', 'Expires', false)}{th('days_left', 'Days left')}{NUMS.map(([k, label]) => <th key={k} className="r"><button type="button" className="qr-th" onClick={() => setSort({ k: k as string, dir: sort.k === k ? (-sort.dir as 1 | -1) : -1 })}>{label}{sort.k === k ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</button></th>)}</tr></thead>
        <tbody>{cos.map((c) => { const l = letters.filter((m) => m.company_id === c).sort(cmp); return [
          <tr key={c + 'h'} className="qr-grp"><td colSpan={4 + NUMS.length}>{ctx.cName(c)} <small className="muted">· {l.length} letter{l.length === 1 ? '' : 's'}</small></td></tr>,
          ...l.map((m) => <tr key={m.quota_id || ''}>
            <td><b>{m.ref_no}</b></td><td>{m.sector}</td><td>{fmtDate(m.expiry_date || '')}</td>
            <td className="r qr-num">{m.days_left === null ? '—' : <span className={`pill ${m.days_left <= 30 ? 'bad' : m.days_left <= 90 ? 'warn' : 'n'}`}>{m.days_left} d</span>}</td>
            {NUMS.map(([k]) => <Num key={k} v={Number((m as unknown as Record<string, number>)[k as string] || 0)} />)}</tr>),
          line(tot(l, ''), <>Total {ctx.cName(c)}</>, 'qr-total', c + 't')] })}
          <tr className="qr-grp"><td colSpan={4 + NUMS.length}>Per sector</td></tr>
          {sectors.map((sc) => line(tot(letters.filter((m) => (m.sector || 'Unspecified') === sc), sc), sc, 'qr-sub', 'sec' + sc))}
          {line(grand, <b>Grand total</b>, 'qr-total qr-grand', 'grand')}
        </tbody></table></div> : <Empty title="No approval letters yet">Record a letter in Letters & ledger; it appears here once it is checked against the original and opened.</Empty>}
      {print && <Preview blocks={blocks} meta={meta} file={`quota-master-${todayISO()}.pdf`} onClose={() => setPrint(false)} />}
    </Card>
  )
}

/* ---------------- HR follow-ups (GM / CEO) ---------------- */
export function FollowUps({ company }: { company: string }) {
  const ctx = useQCtx()
  const d = useQuota()
  const [nudge, setNudge] = useState<{ kind: string; ref: string; title: string } | null>(null)
  const [re, setRe] = useState<{ kind: string; ref: string; title: string; company_id: string | null } | null>(null)
  const [hr, setHr] = useState<{ id: string; name: string; role: string; company_ids: string[] | null }[]>([])
  useEffect(() => { if (!re) return; void supabase.from('profiles_v').select('id, full_name, email, role, company_ids').in('role', ['hr_admin', 'hr_manager']).eq('status', 'active')
    .then(({ data }) => setHr((data || []).map((p) => ({ id: p.id, name: p.full_name || p.email, role: p.role, company_ids: p.company_ids })))) }, [re])
  const rows = d.followups.filter((f) => !f.company_id || inCompany(company, f.company_id))
  return (
    <Card title={<>HR follow-ups {rows.filter((f) => f.days_late > 0).length > 0 && <span className="pill bad">{rows.filter((f) => f.days_late > 0).length} late</span>}</>}>
      <DataTable label="HR follow-ups" rows={rows} rowKey={(f) => `${f.kind}|${f.ref}`} dense initialSort={{ key: 'late', dir: 'desc' }}
        search={(f) => `${f.title} ${f.owner_name} ${f.step}`}
        filters={[{ key: 'k', label: 'Type', options: [...new Set(rows.map((f) => f.kind))], match: (f, v) => f.kind === v }]}
        columns={[
          { key: 't', label: 'Task', main: true, render: (f) => <><Link to={`/${f.link.replace(/^\//, '')}`}><b>{f.title}</b></Link><br /><small className="muted">{f.step} · {ctx.cName(f.company_id)}</small></>, sort: (f) => f.title },
          { key: 'o', label: 'Owner', render: (f) => f.owner_name || <span className="pill warn">Unassigned</span>, sort: (f) => f.owner_name || '' },
          { key: 'due', label: 'Due', hide: 'phone', render: (f) => fmtDate(f.due || ''), sort: (f) => f.due || '' },
          { key: 'late', label: 'Late', align: 'right', render: (f) => f.days_late > 0 ? <span className="pill bad">{f.days_late} d</span> : <span className="pill ok">On time</span>, sort: (f) => f.days_late },
          { key: 'n', label: 'Nudges', align: 'right', hide: 'phone', render: (f) => <span className="qr-num">{f.nudges}</span>, sort: (f) => f.nudges },
        ]}
        expand={(f) => <Details items={[['Started', fmtDate(f.started || '')], ['Step', f.step], ['Owner', f.owner_name || '—'], ['Nudges sent', String(f.nudges)]]} />}
        actions={(f) => <Actions>
          <IconAction kind="send" label="Nudge the owner (in-app message)" onClick={() => setNudge(f)} />
          <IconAction kind="assign" label="Reassign to another HR person" onClick={() => setRe(f)} />
          {f.days_late > 0 && <IconAction kind="escalate" label="Escalate: nudge marked urgent" onClick={() => setNudge({ ...f, title: `URGENT: ${f.title}` })} />}
        </Actions>}
        empty={<Empty icon="check" title="No open follow-ups">Every HR task is on time.</Empty>} />
      {nudge && <NoteAsk title={`Nudge: ${nudge.title}`} label="Message to the owner" confirm="Send nudge" onClose={() => setNudge(null)}
        onOk={async (n) => { await qcall('qr_task_nudge', { p_kind: nudge.kind, p_ref: nudge.ref, p_note: nudge.title.startsWith('URGENT') ? `URGENT — ${n}` : n }); await d.reload() }} />}
      {re && <QForm title={`Reassign: ${re.title}`} initial={{}} onClose={() => setRe(null)} saveLabel="Reassign"
        fields={[{ key: 'owner', label: 'New owner', type: 'select', required: true, options: hr.filter((h) => !re.company_id || !h.company_ids?.length || h.company_ids.includes(re.company_id)).map((h) => ({ value: h.id, label: `${h.name} (${h.role === 'hr_admin' ? 'HR Admin' : 'HR Manager'})` })) }]}
        onSave={async (v) => { await qcall('qr_task_reassign', { p_kind: re.kind, p_ref: re.ref, p_owner: v.owner }); await d.reload() }} />}
    </Card>
  )
}

/* ---------------- replacement applications ---------------- */
const REPL_ST: Record<Replacement['status'], { label: string; tone: string }> = {
  to_apply: { label: 'To apply — Pending cancellation', tone: 'warn' }, applied: { label: 'Applied to Immigration', tone: 'b' }, approval_uploaded: { label: 'Approval uploaded — to verify', tone: 'warn' },
  restored: { label: 'Replacement approved by Immigration', tone: 'ok' }, refused: { label: 'Refused', tone: 'bad' }, withdrawn: { label: 'Withdrawn', tone: 'n' } }
export function ReplacementsTab({ company }: { company: string }) {
  const ctx = useQCtx()
  const d = useQuota()
  const [form, setForm] = useState<V | null>(null)
  const [step, setStep] = useState<{ c: Replacement; st: 'applied' | 'upload' | 'refused' | 'withdrawn' } | null>(null)
  const rows = d.replacements.filter((c) => inCompany(company, c.company_id))
  const rec = (id: string | null) => d.recruits.find((r) => r.id === id)
  const usedIds = new Set(d.ledger.filter((l) => l.kind === 'use' && l.recruit_id).map((l) => l.recruit_id))
  const open = new Set(rows.filter((c) => !['refused', 'withdrawn'].includes(c.status)).map((c) => c.recruit_id))
  const candidates = d.recruits.filter((r) => inCompany(company, r.company_id) && usedIds.has(r.id) && !open.has(r.id) && ((r.status === 'dropped' && r.used_not_arrived) || (r.arrived_at && r.fomema_result === 'unfit')))
  return (
    <Card title="Replacement applications (Immigration)" actions={ctx.rank >= 1 && ctx.rank <= 2 ? <Btn kind="primary" icon="plus" small disabled={!candidates.length} onClick={() => setForm({ trigger_date: todayISO() })}>Open application</Btn> : undefined}>
      <div className="note-box">Only two cases qualify: <b>FOMEMA fail after arrival</b>, or <b>VDR approved but he did not arrive</b>. Deaths, transfers and runaways are not replaceable.
        HR applies to Immigration and uploads the approval; a <b>different HR Admin</b> verifies it and the slot is restored as “Replacement approved by Immigration”. Meanwhile the slot shows <b>Pending cancellation</b>.</div>
      <DataTable label="Replacement applications" rows={rows} rowKey={(c) => c.id} initialSort={{ key: 'd', dir: 'desc' }} search={(c) => `R-${c.ref_no} ${rec(c.recruit_id)?.full_name} ${c.imm_ref}`}
        filters={[{ key: 's', label: 'Status', options: Object.entries(REPL_ST).map(([value, x]) => ({ value, label: x.label })), match: (c, v) => c.status === v }]}
        columns={[
          { key: 'w', label: 'Recruit', main: true, render: (c) => <><b>R-{c.ref_no}</b> {rec(c.recruit_id)?.full_name}<br /><small className="muted">{c.country} · {ctx.cName(c.company_id)}</small></>, sort: (c) => c.ref_no },
          { key: 'k', label: 'Reason', hide: 'phone', render: (c) => c.kind === 'fomema_fail' ? 'FOMEMA fail' : 'Did not arrive' },
          { key: 'd', label: 'Since', hide: 'phone', render: (c) => fmtDate(c.trigger_date), sort: (c) => c.trigger_date },
          { key: 'o', label: 'Owner', hide: 'tablet', render: (c) => c.owner_name || '—' },
          { key: 's', label: 'Status', render: (c) => <span className={`pill ${REPL_ST[c.status].tone}`}>{REPL_ST[c.status].label}</span>, sort: (c) => c.status },
        ]}
        expand={(c) => <Details items={[['Reason', c.reason || '—'], ['Applied', c.applied_on ? `${fmtDate(c.applied_on)} · ${c.imm_ref}` : '—'],
          ['Immigration approval', <FileLink key="a" f={d.files.find((f) => f.id === c.approval_file)} />], ['Uploaded by', c.uploaded_by_name ? `${c.uploaded_by_name} · ${atMyt(c.uploaded_at || '')}` : '—'],
          ['Verified by', c.verified_by_name || '—'], ['FOMEMA result', <FileLink key="f" f={d.files.find((f) => f.id === c.fomema_file)} />], ['Note', c.closed_note || '—']]} />}
        actions={(c) => ctx.rank >= 1 && ctx.rank <= 2 ? <Actions>
          {c.status === 'to_apply' && <IconAction kind="send" label="Record the Immigration application" onClick={() => setStep({ c, st: 'applied' })} />}
          {['applied', 'approval_uploaded'].includes(c.status) && <IconAction kind="upload" label="Upload Immigration's approval" onClick={() => setStep({ c, st: 'upload' })} />}
          {c.status === 'approval_uploaded' && ctx.rank === 2 && c.uploaded_by !== ctx.profile?.id && <IconAction kind="approve" label="Verify (restores the slot)" confirm="Verify Immigration's approval and restore the slot?" onClick={() => void run(async () => { await qcall('qr_repl_step', { p_id: c.id, p_step: 'verify', p: {} }); await d.reload() }, 'Slot restored')} />}
          {!['restored', 'refused', 'withdrawn'].includes(c.status) && <IconAction kind="reject" label="Refused by Immigration" onClick={() => setStep({ c, st: 'refused' })} />}
          {!['restored', 'refused', 'withdrawn'].includes(c.status) && <IconAction kind="recall" label="Withdraw" onClick={() => setStep({ c, st: 'withdrawn' })} />}
        </Actions> : null}
        empty={<Empty icon="check" title="No replacement applications">Opened from a recruit whose FOMEMA failed, or who had VDR approval but did not arrive.</Empty>} />
      {form && <QForm title="Open a replacement application" initial={form} onClose={() => setForm(null)}
        fields={[{ key: 'recruit_id', label: 'Recruit', type: 'select', required: true, options: candidates.map((r) => ({ value: r.id, label: `${r.full_name} · ${r.fomema_result === 'unfit' ? 'FOMEMA fail' : 'did not arrive'}` })) },
          { key: 'trigger_date', label: 'Date it happened', type: 'date', required: true }, { key: 'reason', label: 'Reason', full: true, required: true }]}
        onSave={async (v) => { const r = rec(s(v.recruit_id)); await qcall('qr_repl_create', { p: { ...v, kind: r?.fomema_result === 'unfit' ? 'fomema_fail' : 'not_arrived', fomema_file: r?.fomema_file || null } }); await d.reload() }} />}
      {step && (step.st === 'refused' || step.st === 'withdrawn'
        ? <NoteAsk title={`${step.st === 'refused' ? 'Refused' : 'Withdraw'}: R-${step.c.ref_no}`} label="Reason" onClose={() => setStep(null)} onOk={(n) => qcall('qr_repl_step', { p_id: step.c.id, p_step: step.st, p: { note: n } }).then(() => d.reload())} />
        : <QForm title={step.st === 'applied' ? 'Applied to Immigration' : "Upload Immigration's approval"} initial={{ applied_on: todayISO(), approval_date: todayISO() }} onClose={() => setStep(null)}
          fields={step.st === 'applied' ? [{ key: 'applied_on', label: 'Applied on', type: 'date', required: true }, { key: 'imm_ref', label: 'Immigration reference', required: true }]
            : [{ key: 'approval_date', label: 'Approval date', type: 'date', required: true }]}
          onSave={async (v) => { if (step.st === 'upload' && !v.approval_file) throw new Error("Attach Immigration's approval letter."); await qcall('qr_repl_step', { p_id: step.c.id, p_step: step.st, p: v }); await d.reload() }}>
          {(v, set) => step.st === 'upload' ? <>
            <FileField company={step.c.company_id} kind="imm_approval" label="Immigration approval letter" required value={s(v.approval_file) || null} onChange={(id) => set({ approval_file: id })} />
            {step.c.kind === 'fomema_fail' && !step.c.repat_file && !step.c.exit_id && <FileField company={step.c.company_id} kind="repatriation" label="Repatriation proof" required value={s(v.repat_file) || null} onChange={(id) => set({ repat_file: id })} />}
          </> : null}
        </QForm>)}
    </Card>
  )
}

/* ---------------- government windows (low-key) ---------------- */
export function WindowsTab() {
  const ctx = useQCtx()
  const d = useQuota()
  const [form, setForm] = useState<V | null>(null)
  return (
    <Card title="Government windows" actions={ctx.isHraUp ? <IconAction kind="add" label="Record a window (circular)" onClick={() => setForm({})} /> : undefined}>
      <p className="muted">Windows the government opens for additional quota applications. Only an approved application in a window adds an “additional” letter.</p>
      <DataTable label="Government windows" rows={d.windows} rowKey={(w) => w.id} dense initialSort={{ key: 'c', dir: 'desc' }}
        columns={[
          { key: 't', label: 'Window', main: true, render: (w) => <><b>{w.title}</b><br /><small className="muted">{w.circular_ref || '—'}</small></>, sort: (w) => w.title },
          { key: 'o', label: 'Opens', hide: 'phone', render: (w) => fmtDate(w.open_date || ''), sort: (w) => w.open_date || '' },
          { key: 'c', label: 'Closes', render: (w) => fmtDate(w.close_date || ''), sort: (w) => w.close_date || '' },
          { key: 's', label: 'Status', render: (w) => <span className={`pill ${w.status === 'closed' || (w.close_date && w.close_date < todayISO()) ? 'n' : 'ok'}`}>{w.status === 'closed' || (w.close_date && w.close_date < todayISO()) ? 'Closed' : 'Open'}</span> },
        ]}
        expand={(w) => <Details items={[['Conditions', w.rules || '—'], ['Circular', <FileLink key="f" f={d.files.find((f) => f.id === w.file_id)} />], ['Recorded by', `${w.created_by_name || '—'} · ${atMyt(w.created_at)}`]]} />}
        actions={(w) => ctx.isHraUp ? <Actions><IconAction kind="edit" label="Edit" onClick={() => setForm({ ...w })} />{w.status !== 'closed' && <IconAction kind="close" label="Mark closed" confirm="Mark this window closed?" onClick={() => void run(async () => { await qcall('qr_save_window', { p: { id: w.id, title: w.title, close_date: w.close_date, status: 'closed' } }); await d.reload() }, 'Window closed')} />}</Actions> : null}
        empty={<Empty title="No windows recorded" />} />
      {form && <QForm title={form.id ? 'Edit window' : 'Record a government window'} initial={form} onClose={() => setForm(null)}
        fields={[{ key: 'title', label: 'Title', required: true, full: true }, { key: 'circular_ref', label: 'Circular reference', required: true }, { key: 'open_date', label: 'Opens', type: 'date' }, { key: 'close_date', label: 'Closes', type: 'date', required: true }, { key: 'rules', label: 'Conditions', type: 'textarea', full: true }]}
        onSave={async (v) => { await qcall('qr_save_window', { p: { id: v.id, title: v.title, circular_ref: v.circular_ref, open_date: v.open_date || null, close_date: v.close_date, rules: v.rules, file_id: v.file_id || null } }); await d.reload() }} />}
    </Card>
  )
}

/* ---------------- quota application checklist + levy (inside a letter) ---------------- */
type AppStep = { idx: number; key: string; label: string; req: boolean; done: boolean; skipped: boolean; info: Record<string, unknown> | null; hint: string | null; fields: string[] }
export function QuotaAppChecklist({ q }: { q: Quota }) {
  const ctx = useQCtx()
  const d = useQuota()
  const [steps, setSteps] = useState<AppStep[] | null>(null)
  const [open, setOpen] = useState<AppStep | null>(null)
  const [levy, setLevy] = useState(false)
  const load = useMemo(() => async () => { const r = await supabase.rpc('qr_quota_app_list', { p_id: q.id }); setSteps(r.error ? [] : (r.data as AppStep[])) }, [q.id])
  useEffect(() => { void load() }, [load])
  const levyDays = Number(d.reg.find((x) => x.key === 'levy_payment_days' && x.status === 'active')?.value ?? 15)
  const due = q.approval_date ? new Date(new Date(q.approval_date).getTime() + levyDays * 864e5).toISOString().slice(0, 10) : null
  if (!steps) return <small className="muted">Loading the application checklist…</small>
  const FL: Record<string, string> = { ref: 'Reference', date: 'Date', file_id: 'Document', url: 'Link', note: 'Note' }
  return <div className="qr-app">
    <h4 className="qr-h4">Quota application checklist</h4>
    {steps.length ? <ol className="qr-steps">{steps.map((st) => <li key={st.key} className={st.done ? 'done' : ''}>
      <button type="button" className="qr-tick" disabled={st.done || !ctx.isHraUp && ctx.rank < 1} aria-label={`Mark done: ${st.label}`} onClick={() => setOpen(st)}>{st.done ? '✓' : ''}</button>
      <div><span>{st.label}</span>{!st.req && <span className="muted"> ({st.skipped ? 'not needed for this sector' : 'optional'})</span>}
        {st.done && st.info && <small className="muted"> · {[st.info.date && fmtDate(String(st.info.date)), st.info.ref, st.info.by_name].filter(Boolean).join(' · ')}</small>}
        {st.hint && !st.done && <small className="hint">{st.hint}</small>}</div></li>)}</ol> : <p className="muted">No checklist is set (Rules & regulations › Quota application).</p>}
    <div className="row-gap">Levy: {q.levy_paid_on ? <span className="pill ok">Paid {fmtDate(q.levy_paid_on)}</span> : <span className={`pill ${due && due < todayISO() ? 'bad' : 'warn'}`}>Due {due ? fmtDate(due) : `within ${levyDays} days`}</span>}
      {q.levy_file && <FileLink f={d.files.find((f) => f.id === q.levy_file)} label="receipt" />}
      {ctx.isHraUp && !q.levy_paid_on && <IconAction kind="approve" label="Record levy paid" onClick={() => setLevy(true)} />}</div>
    {open && <QForm title={open.label} initial={{ date: todayISO() }} onClose={() => setOpen(null)} note={open.hint || undefined} saveLabel="Mark done"
      fields={[...open.fields.filter((f) => f !== 'file_id').map((f) => ({ key: f, label: FL[f] || f.replace(/_/g, ' '), type: f.includes('date') ? 'date' as const : undefined, required: true })), ...(open.fields.includes('note') ? [] : [{ key: 'note', label: 'Note', full: true }])]}
      onSave={async (v) => { if (open.fields.includes('file_id') && !v.file_id) throw new Error('Attach the document.'); await qcall('qr_quota_app_step', { p_id: q.id, p_key: open.key, p: v }); await load() }}>
      {(v, set) => open.fields.includes('file_id') ? <FileField company={q.company_id} kind={`quota_${open.key}`} label="Document" required value={s(v.file_id) || null} onChange={(id) => set({ file_id: id })} /> : null}
    </QForm>}
    {levy && <QForm title={`Levy paid — ${q.ref_no}`} initial={{ on: todayISO() }} onClose={() => setLevy(false)}
      fields={[{ key: 'on', label: 'Paid on', type: 'date', required: true }, { key: 'note', label: 'Note', full: true }]}
      onSave={async (v) => { await qcall('qr_quota_levy_paid', { p_id: q.id, p_on: v.on, p_file: v.file || null, p_note: s(v.note) || null }); await d.reload() }}>
      {(v, set) => <FileField company={q.company_id} kind="levy" label="Levy receipt" value={s(v.file) || null} onChange={(id) => set({ file: id })} />}
    </QForm>}
  </div>
}

/* ---------------- COM follow-up: Immigration departure letter + bond refund ---------------- */
export function ExitFollowUp({ x, onClose }: { x: Exit; onClose: () => void }) {
  const d = useQuota()
  return <QForm title={`Departure & bond — ${x.worker_name}`} onClose={onClose} note="Immigration's departure confirmation closes the COM; the security bond is refunded after it."
    initial={{ bond_refund_status: x.bond_refund_status || 'pending', bond_refund_rm: x.bond_refund_rm ?? '', bond_refund_on: x.bond_refund_on || '', depart_letter_file: x.depart_letter_file || '' }}
    fields={[{ key: 'bond_refund_status', label: 'Bond refund', type: 'select', options: [{ value: 'pending', label: 'Pending' }, { value: 'applied', label: 'Applied' }, { value: 'refunded', label: 'Refunded' }, { value: 'not_applicable', label: 'Not applicable' }] },
      { key: 'bond_refund_rm', label: 'Amount (RM)', type: 'number' }, { key: 'bond_refund_on', label: 'Refunded on', type: 'date', show: (v) => v.bond_refund_status === 'refunded' }]}
    onSave={async (v) => { await qcall('qr_exit_followup', { p_id: x.id, p: { ...v, bond_refund_rm: v.bond_refund_rm === '' ? null : v.bond_refund_rm, bond_refund_on: v.bond_refund_on || null, depart_letter_file: v.depart_letter_file || null } }); await d.reload() }}>
    {(v, set) => <FileField company={x.company_id} kind="depart_letter" label="Immigration departure letter" value={s(v.depart_letter_file) || null} onChange={(id) => set({ depart_letter_file: id })} />}
  </QForm>
}
export const bondChip = (x: Exit) => x.bond_refund_status === 'refunded' ? <span className="pill ok">Bond refunded {x.bond_refund_rm ? rmFmt(Number(x.bond_refund_rm)) : ''}</span>
  : x.bond_refund_status === 'not_applicable' ? null : <span className="pill warn">Bond refund {x.bond_refund_status || 'pending'}</span>
