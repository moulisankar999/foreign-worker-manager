/* Rules & regulations: every regulatory number, list and pipeline the module uses, as versioned rules.
 * Each version has an effective-from date, its source (circular reference, link, PDF) and who set it.
 * Records keep the version in force on their own date; recruits stay on the pipeline version they started with.
 * The CEO and HR Admin edit; an HR Admin change waits for the CEO. Every change shows its impact first and is audited. */
import { useMemo, useState, type ReactNode } from 'react'
import { Btn, Card, Chip, Empty, KV } from '../../components/ui'
import { DataTable } from '../../components/dataTable'
import { Actions, IconAction } from '../../components/iconAction'
import { FilePick } from '../../components/filePick'
import { fmtDate, todayISO } from '../../lib/util'
import { atMyt, COUNTRIES, qcall, rmFmt, uploadGovFile, useQuota, type RegCat, type RegRule, type Template, type TplStage } from '../../lib/quota'
import { supabase } from '../../lib/supabase'
import { FileLink, NoteAsk, QForm, run, s, useQCtx } from './shared'

const GROUPS = ['Quota', 'Deadlines', 'Levy & fees', 'Sector rules', 'Country pipelines', 'Replacement'] as const
const SECTORS = ['Services', 'Services/Restaurant', 'Services/Cleaning', 'Manufacturing', 'Construction', 'Plantation', 'Agriculture']
type Row = { cat: RegCat; scope: string; cur?: RegRule; next?: RegRule; versions: RegRule[] }
type O = Record<string, unknown>
const num = (x: unknown) => (x === null || x === undefined || x === '' ? null : Number(x))
const rm = (x: unknown) => (num(x) === null ? 'not set' : rmFmt(Number(x)))

/** a short, human reading of a rule value, with its unit */
export function fmtRule(cat: RegCat, v: unknown): ReactNode {
  const o = (v || {}) as O
  switch (cat.kind) {
    case 'int': return <><b className="qr-num">{String(v)}</b> <span className="qr-unit">{cat.unit}</span></>
    case 'int_list': return <><b className="qr-num">{(v as number[] || []).join(' · ')}</b> <span className="qr-unit">{cat.unit}</span></>
    case 'money': return <><b className="qr-num">{rm(o.rm)}</b> <span className="qr-unit">{cat.unit}</span>{o.guarantee_min_months ? <span className="qr-unit"> · guarantee ≥ {String(o.guarantee_min_months)} months</span> : null}{o.exempt_note ? <span className="qr-unit"> · {String(o.exempt_note)}</span> : null}</>
    case 'object': return <span>Employer <b>{String(o.employer_pct)}%</b> · employee <b>{String(o.employee_pct)}%</b> · due by day <b>{String(o.due_day)}</b></span>
    case 'levy': return <span>{((o.tiers as O[]) || []).map((t, i) => <span key={i}>{i > 0 && ' · '}<b className="qr-num">{rm(t.rm)}</b> <span className="qr-unit">{String(t.label)}</span></span>)}{o.multi_tier ? <Chip tone="amber">Multi-tier</Chip> : null}</span>
    case 'items': return <span>{((o.items as O[]) || []).map((t, i) => <span key={i}>{i > 0 && ' · '}{String(t.name || t.label)} <b className="qr-num">{rm(t.rm)}</b></span>)}</span>
    case 'sector': return <span>{((o.countries as string[]) || []).length ? `${(o.countries as string[]).length} source countries` : 'Any country'}{o.advert_first === false ? ' · no advert needed' : ' · advert first'}{o.no_front_liner ? ' · no front-liners' : ''}{o.cap ? ` · cap ${String(o.cap)}` : ''}{o.age_min ? ` · age ${String(o.age_min)}–${String(o.age_max)}` : ''} <Chip tone={o.mode === 'block' ? 'red' : 'amber'}>{o.mode === 'block' ? 'Blocks' : 'Warns'}</Chip></span>
    case 'checks': return <span>Age {String(o.age_min)}–{String(o.age_max)} at first entry{((o.conditions as O[]) || []).map((c, i) => <span key={i}> · {String(c.note || '')}</span>)} <Chip tone={o.mode === 'block' ? 'red' : 'amber'}>{o.mode === 'block' ? 'Blocks' : 'Warns'}</Chip></span>
    case 'checklist': return <span>{((o.steps as O[]) || []).map((x) => String(x.label)).join(' → ')}</span>
    case 'pipeline': { const t = v as Template; const live = (t?.stages || []).filter((x) => !x.retired); return <span><b className="qr-num">{live.length}</b> <span className="qr-unit">stages</span> · slot used at <b>{t?.stages.flatMap((x) => x.steps).find((x) => x.key === t.use_step)?.label || t?.use_step}</b></span> }
    case 'replacement': { const k = (o.kinds || {}) as Record<string, O>; return <span>{Object.entries(k).map(([n, x], i) => <span key={n}>{i > 0 && ' · '}{n.replace(/_/g, ' ')} {x.allowed ? <Chip tone="green">Replaceable</Chip> : <Chip tone="gray">No</Chip>}</span>)}</span> }
    default: return <code>{JSON.stringify(v)}</code>
  }
}

const RuleChips = ({ r }: { r?: RegRule }) => r ? <span className="qr-chips">
  <span className="pill b" title="Effective from">From {fmtDate(r.effective_from)}</span>
  {r.source_ref && <span className={`pill ${r.verified ? 'ok' : 'warn'}`} title={r.verified ? 'Source verified' : 'Source not verified yet'}>{r.verified ? '✓ ' : '? '}{r.source_ref.length > 48 ? `${r.source_ref.slice(0, 46)}…` : r.source_ref}</span>}
</span> : null

export function RulesTab() {
  const ctx = useQCtx()
  const d = useQuota()
  const canEdit = ctx.isCeo || ctx.role === 'hr_admin'
  const [ed, setEd] = useState<{ cat: RegCat; scope: string; base?: RegRule; newScope?: boolean } | null>(null)
  const [decide, setDecide] = useState<{ r: RegRule; approve: boolean } | null>(null)
  const [oldEdit, setOldEdit] = useState(false)
  const today = todayISO()
  const rows = useMemo(() => {
    const out: Row[] = []
    for (const cat of d.regCat) {
      const scopes = [...new Set(d.reg.filter((x) => x.key === cat.key).map((x) => x.scope))]
      if (!scopes.length) scopes.push(cat.scope_kind === 'none' ? '' : '*')
      for (const scope of scopes.sort()) {
        const versions = d.reg.filter((x) => x.key === cat.key && x.scope === scope)
        const cur = versions.filter((x) => x.status === 'active' && x.effective_from <= today).sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0]
        const next = versions.filter((x) => x.status === 'active' && x.effective_from > today).sort((a, b) => (a.effective_from > b.effective_from ? 1 : -1))[0]
        out.push({ cat, scope, cur, next, versions })
      }
    }
    return out
  }, [d.reg, d.regCat, today])
  const pending = d.reg.filter((x) => x.status === 'pending')
  const catOf = (k: string) => d.regCat.find((c) => c.key === k)
  const r = d.rules

  if (!d.regCat.length) return <Empty title="Rules not available">The rules and regulations need the latest database update.</Empty>
  return (
    <div className="qr-grid qr-rr">
      <div className="note-box">Every regulatory number used in this module is kept here as a rule with the date it takes effect and its source. Records use the version in force on their own date, so a change never rewrites history. {canEdit ? (ctx.isCeo ? 'Your changes take effect on their date.' : 'Your changes wait for approval before they take effect.') : 'Rule changes are made by the rule owners; ask HR Admin if a number looks wrong.'}</div>

      {pending.length > 0 && <Card fold="open" title={<>{ctx.isCeo ? 'Waiting for your approval' : 'Waiting for approval'} <Chip tone="amber">{pending.length}</Chip></>}>
        <DataTable label="Rule changes waiting" rows={pending} rowKey={(x) => x.id} dense
          columns={[
            { key: 'r', label: 'Rule', main: true, render: (x) => <><b>{catOf(x.key)?.label || x.key}</b>{x.scope && <> <Chip tone="gray">{x.scope}</Chip></>}<br /><small className="muted">{ctx.who(x.created_by_name, x.created_role)} · {atMyt(x.created_at)}</small></> },
            { key: 'v', label: 'New value', render: (x) => { const c = catOf(x.key); return c ? fmtRule(c, x.value) : '' } },
            { key: 'f', label: 'From', hide: 'phone', render: (x) => <RuleChips r={x} /> },
          ]}
          expand={(x) => <KV items={[['Source', x.source_ref || '—'], ['Link', x.source_url ? <a key="u" href={x.source_url} target="_blank" rel="noopener">{x.source_url}</a> : '—'], ['Circular', <FileLink key="f" f={d.files.find((f) => f.id === x.file_id)} />], ['Note', x.note || '—']]} />}
          actions={(x) => <Actions>
            {ctx.isCeo && <IconAction kind="approve" label="Approve this change" onClick={() => setDecide({ r: x, approve: true })} />}
            {ctx.isCeo && <IconAction kind="reject" label="Reject this change" onClick={() => setDecide({ r: x, approve: false })} />}
            {x.created_by === ctx.profile?.id && !ctx.isCeo && <IconAction kind="recall" label="Withdraw my proposal" confirm="Withdraw this proposed change?" onClick={() => run(() => qcall('qr_reg_decide', { p_id: x.id, p_approve: false, p_note: 'Withdrawn' }), 'Withdrawn')} />}
          </Actions>} />
      </Card>}

      {GROUPS.filter((g) => rows.some((x) => x.cat.grp === g)).map((g, gi) => {
        const list = rows.filter((x) => x.cat.grp === g)
        if (!list.length) return null
        const scoped = list[0].cat.scope_kind !== 'none' || list.some((x) => x.cat.scope_kind !== 'none')
        return <Card key={g} fold={gi === 0 ? 'open' : 'closed'} title={<>{g} <Chip tone="gray">{list.length}</Chip></>} actions={canEdit && scoped ? <IconAction kind="add" label={`Add a ${g === 'Country pipelines' ? 'country pipeline' : 'sector or country version'}`} onClick={() => { const c = list.find((x) => x.cat.scope_kind !== 'none')!.cat; setEd({ cat: c, scope: '', newScope: true, base: list.find((x) => x.cat.key === c.key)?.cur }) }} /> : undefined}>
          <DataTable label={`${g} rules`} rows={list} rowKey={(x) => `${x.cat.key}|${x.scope}`} dense className="qr-sticky"
            columns={[
              { key: 'r', label: 'Rule', main: true, width: '30%', render: (x) => <><b>{x.cat.label}</b>{x.scope && x.scope !== '*' && <> <span className="pill n">{x.scope}</span></>}{x.scope === '*' && <> <span className="pill n">Default</span></>}<br /><small className="muted">{x.cat.help}</small></>, sort: (x) => x.cat.ord },
              { key: 'v', label: 'Value', render: (x) => x.cur ? <>{fmtRule(x.cat, x.cur.value)}{x.next && <div><span className="pill warn">From {fmtDate(x.next.effective_from)}:</span> {fmtRule(x.cat, x.next.value)}</div>}</> : <span className="muted">Not set</span> },
              { key: 's', label: 'In force', hide: 'tablet', render: (x) => <RuleChips r={x.cur} /> },
            ]}
            expand={(x) => <History row={x} />}
            actions={(x) => <Actions>
              {canEdit && <IconAction kind="edit" label="New version of this rule" onClick={() => setEd({ cat: x.cat, scope: x.scope, base: x.next || x.cur })} />}
            </Actions>}
            empty={<Empty title="No rules in this group" />} />
        </Card>
      })}

      <Card fold="closed" title="Module settings" actions={ctx.isCeo ? <IconAction kind="edit" label="Change module settings" onClick={() => setOldEdit(true)} /> : undefined}>
        <KV items={[
          ['COM missing alert', `${r.cmo_missing_days} days after a worker leaves with no COM recorded`],
          ['Utilisation amber', `${r.util_amber_pct}% of the approved slots used`],
          ['Second check on payments', `${rmFmt(r.payment_check_rm)} and above`],
        ]} />
      </Card>

      {ed && <RuleEditor {...ed} onClose={() => setEd(null)} />}
      {decide && <NoteAsk title={decide.approve ? 'Approve rule change' : 'Reject rule change'} required={!decide.approve} confirm={decide.approve ? 'Approve' : 'Reject'} danger={!decide.approve}
        label={decide.approve ? 'Note (optional)' : 'Reason'} onClose={() => setDecide(null)} onOk={(n) => qcall('qr_reg_decide', { p_id: decide.r.id, p_approve: decide.approve, p_note: n || null })} />}
      {oldEdit && <QForm title="Module settings" initial={{ ...r }} onClose={() => setOldEdit(false)}
        fields={[{ key: 'cmo_missing_days', label: 'COM missing alert (days)', type: 'number', required: true }, { key: 'util_amber_pct', label: 'Utilisation amber (%)', type: 'number', required: true }, { key: 'payment_check_rm', label: 'Second check from', type: 'money', required: true }]}
        onSave={(v) => qcall('qr_set_rules', { p: { cmo_missing_days: v.cmo_missing_days, runaway_report_days: r.runaway_report_days, expiry_amber_days: r.expiry_amber_days, expiry_red_days: r.expiry_red_days, util_amber_pct: v.util_amber_pct, payment_check_rm: v.payment_check_rm } })} />}
    </div>
  )
}

function History({ row }: { row: Row }) {
  const ctx = useQCtx()
  const d = useQuota()
  const tone = { active: 'ok', pending: 'warn', rejected: 'bad', withdrawn: 'n', superseded: 'n' } as const
  const vs = [...row.versions].sort((a, b) => (a.effective_from < b.effective_from ? 1 : a.effective_from > b.effective_from ? -1 : a.created_at < b.created_at ? 1 : -1))
  return <div>
    {row.cat.kind === 'pipeline' && row.cur && <PipelineView t={row.cur.value as Template} />}
    <h4 className="qr-h4">Versions</h4>
    <ol className="qr-tl">{vs.map((v) => <li key={v.id} className={v.status === 'active' ? 'good' : v.status === 'rejected' ? 'bad' : ''}>
      <span className={`pill ${tone[v.status]}`}>{v.status === 'active' ? (v.id === row.cur?.id ? 'In force' : v.effective_from > todayISO() ? 'Scheduled' : 'Earlier') : v.status}</span> <b>From {fmtDate(v.effective_from)}</b> — {fmtRule(row.cat, v.value)}
      <div className="muted"><small>{v.source_ref || 'No source'}{v.source_url && <> · <a href={v.source_url} target="_blank" rel="noopener">link</a></>}{v.file_id && <> · <FileLink f={d.files.find((f) => f.id === v.file_id)} label="circular" /></>} · {ctx.who(v.created_by_name, v.created_role)} {atMyt(v.created_at)}{v.decided_by_name && ` · decided by ${v.decided_by_name}`}{v.decide_note && ` — ${v.decide_note}`}</small></div>
      {v.note && <div className="qr-tl-n">{v.note}</div>}
    </li>)}</ol>
  </div>
}

function PipelineView({ t }: { t: Template }) {
  const ctx = useQCtx()
  return <ol className="qr-pipe">{t.stages.map((s, i) => <li key={s.key} className={s.retired ? 'strike' : ''}>
    <span className="qr-pipe-n">{i + 1}</span><div><b>{s.label}</b> <span className="pill n">{ownerLabel(s.owner || 'hr', ctx.rank)}</span>{s.skip_label && <span className="pill b">{s.skip_label}</span>}
      <div className="muted"><small>{s.steps.filter((x) => !x.retired).map((x) => `${x.label}${x.ecr ? ` (${x.ecr})` : ''}${x.req === false ? ' (optional)' : ''}${x.key === t.use_step ? ' — uses the slot' : ''}`).join(' · ')}</small></div></div>
  </li>)}</ol>
}
const OWNER: Record<string, string> = { hr: 'HR', gm_ceo: 'GM / CEO', agent: 'Agent', outlet_manager: 'Outlet manager' }
const ownerLabel = (o: string, rank: number) => o === 'gm_ceo' && rank < 4 ? 'Approvers' : OWNER[o] || o

/* ---------------- side-panel editor ---------------- */
function RuleEditor({ cat, scope: scope0, base, newScope, onClose }: { cat: RegCat; scope: string; base?: RegRule; newScope?: boolean; onClose: () => void }) {
  const ctx = useQCtx()
  const d = useQuota()
  const [scope, setScope] = useState(newScope ? '' : scope0)
  const [val, setVal] = useState<unknown>(() => structuredClone(base?.value ?? (cat.kind === 'int' ? 0 : {})))
  const [meta, setMeta] = useState({ effective_from: todayISO(), source_ref: '', source_url: '', note: '', verified: false, file_id: '' })
  const [impact, setImpact] = useState<{ level: string; text: string; n: number }[] | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [json, setJson] = useState(() => JSON.stringify(base?.value ?? {}, null, 2))
  const advanced = ['checks', 'checklist', 'replacement'].includes(cat.kind)
  const value = advanced ? (() => { try { return JSON.parse(json) } catch { return undefined } })() : val
  const p = { key: cat.key, scope, value, ...meta, file_id: meta.file_id || null, source_url: meta.source_url || null, note: meta.note || null }
  const touch = <T,>(f: (x: T) => void) => (x: T) => { f(x); setImpact(null) }
  const preview = async () => {
    setErr('')
    if (value === undefined) return setErr('The value is not valid JSON.')
    const { data, error } = await supabase.rpc('qr_reg_impact', { p })
    if (error) return setErr(error.message)
    setImpact((data || []) as never)
  }
  const save = async () => {
    setBusy(true); setErr('')
    try { await qcall('qr_reg_propose', { p }); onClose() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const scopes = cat.scope_kind === 'sector' ? SECTORS : cat.scope_kind === 'country' ? ['*', ...COUNTRIES] : []
  return (
    <div className="qr-side-bg" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <aside className="qr-side" role="dialog" aria-label={`Edit ${cat.label}`}>
        <header><div><h3>{cat.label}</h3><small className="muted">{cat.help}</small></div><IconAction kind="close" label="Close without saving" onClick={onClose} /></header>
        <div className="qr-side-b">
          {cat.scope_kind !== 'none' && <label className="field full"><span className="qr-lbl">{cat.scope_kind === 'sector' ? 'Sector (or Sector/Sub-sector)' : 'Source country'} *</span>
            {newScope ? <input list="qr-scopes" value={scope} onChange={(e) => touch(setScope)(e.target.value)} placeholder={cat.scope_kind === 'sector' ? 'e.g. Services/Restaurant' : 'e.g. Nepal'} /> : <input value={scope === '*' ? 'Default (all others)' : scope} disabled />}
            <datalist id="qr-scopes">{scopes.map((x) => <option key={x} value={x} />)}</datalist></label>}
          <h4 className="qr-h4">Value {cat.unit && <span className="qr-unit">({cat.unit})</span>}</h4>
          {advanced ? <label className="field full"><span className="qr-lbl">Rule details (JSON) — {cat.kind === 'checklist' ? 'steps in order' : cat.kind === 'checks' ? 'age range and conditions' : 'exit kinds and documents'}</span>
            <textarea rows={12} className="mono" value={json} onChange={(e) => { setJson(e.target.value); setImpact(null) }} /></label>
            : <ValueEditor cat={cat} v={val} set={touch(setVal)} />}
          <h4 className="qr-h4">Source and date</h4>
          <div className="qr-form2">
            <label className="field"><span className="qr-lbl">Effective from *</span><input type="date" value={meta.effective_from} onChange={(e) => touch(setMeta)({ ...meta, effective_from: e.target.value })} /></label>
            <label className="field"><span className="qr-lbl">Circular / source reference *</span><input value={meta.source_ref} placeholder="e.g. JTKSM circular PA 2/13" onChange={(e) => setMeta({ ...meta, source_ref: e.target.value })} /></label>
            <label className="field full"><span className="qr-lbl">Link</span><input type="url" value={meta.source_url} placeholder="https://…" onChange={(e) => setMeta({ ...meta, source_url: e.target.value })} /></label>
            <div className="field full"><span className="qr-lbl">Circular PDF</span>
              {meta.file_id ? <FileLink f={d.files.find((f) => f.id === meta.file_id)} label="Circular attached" /> : <FilePick small name="Circular" onFiles={(l) => run(async () => { const id = await uploadGovFile(l[0]); await d.reload?.(); setMeta((m) => ({ ...m, file_id: id })) }, 'Circular stored')} />}</div>
            <label className="field full"><span className="qr-lbl">Note</span><textarea rows={2} value={meta.note} onChange={(e) => setMeta({ ...meta, note: e.target.value })} /></label>
            <label className="check full"><input type="checkbox" checked={meta.verified} onChange={(e) => setMeta({ ...meta, verified: e.target.checked })} /> I have checked this against the official source</label>
          </div>
          <h4 className="qr-h4">Impact</h4>
          {impact ? <ul className="qr-impact">{impact.length ? impact.map((x, i) => <li key={i}><span className={`pill ${x.level === 'red' ? 'bad' : x.level === 'amber' ? 'warn' : 'b'}`}>{x.level === 'red' ? 'Blocks' : x.level === 'amber' ? 'Check' : 'Info'}</span> {x.text}</li>) : <li className="muted">No records are affected.</li>}</ul>
            : <p className="muted">Preview the impact before saving.</p>}
          {err && <p className="err" role="alert">{err}</p>}
        </div>
        <footer>
          <small className="muted">{ctx.isCeo ? 'Takes effect on its date.' : 'Goes for approval before it takes effect.'}</small><span className="spacer" />
          <Btn icon="eye" onClick={preview}>Preview impact</Btn>
          <Btn kind="primary" icon="check" disabled={!impact || busy || !meta.source_ref.trim() || (cat.scope_kind !== 'none' && !scope)} title={!impact ? 'Preview the impact first' : undefined} onClick={save}>{busy ? 'Saving…' : ctx.isCeo ? 'Save version' : 'Send to CEO'}</Btn>
        </footer>
      </aside>
    </div>
  )
}

function NumIn({ label, v, set, unit, step }: { label: string; v: unknown; set: (n: number | null) => void; unit?: string; step?: string }) {
  return <label className="field"><span className="qr-lbl">{label}</span><span className="qr-in-u"><input type="number" step={step || 'any'} value={v === null || v === undefined ? '' : String(v)} onChange={(e) => set(e.target.value === '' ? null : Number(e.target.value))} />{unit && <i>{unit}</i>}</span></label>
}

function ValueEditor({ cat, v, set }: { cat: RegCat; v: unknown; set: (v: unknown) => void }) {
  const o = (v || {}) as O
  const up = (patch: O) => set({ ...o, ...patch })
  switch (cat.kind) {
    case 'int': return <div className="qr-form2"><NumIn label={cat.label} v={v} unit={cat.unit} step="1" set={(n) => set(n ?? 0)} /></div>
    case 'int_list': return <div className="qr-form2">{[0, 1, 2].map((i) => <NumIn key={i} label={['First warning', 'Second warning', 'Last (red)'][i]} unit="days" step="1" v={(v as number[])?.[i]} set={(n) => { const a = [...((v as number[]) || [])]; a[i] = n ?? 0; set(a) }} />)}</div>
    case 'money': return <div className="qr-form2"><NumIn label="Amount" unit="RM" v={o.rm} set={(n) => up({ rm: n })} />
      {cat.key === 'bond' && <NumIn label="Guarantee valid at least" unit="months" step="1" v={o.guarantee_min_months} set={(n) => up({ guarantee_min_months: n })} />}
      {cat.key === 'min_wage' && <label className="field full"><span className="qr-lbl">Exemption</span><input value={s(o.exempt_note)} onChange={(e) => up({ exempt_note: e.target.value || undefined })} /></label>}</div>
    case 'object': return <div className="qr-form2"><NumIn label="Employer" unit="%" v={o.employer_pct} set={(n) => up({ employer_pct: n })} /><NumIn label="Employee" unit="%" v={o.employee_pct} set={(n) => up({ employee_pct: n })} /><NumIn label="Due by day" unit="of month" step="1" v={o.due_day} set={(n) => up({ due_day: n })} /></div>
    case 'levy': {
      const tiers = ((o.tiers as O[]) || [])
      return <div className="qr-form2">{tiers.map((t, i) => <NumIn key={i} label={s(t.label)} unit="RM / year" v={t.rm} set={(n) => up({ tiers: tiers.map((x, j) => (j === i ? { ...x, rm: n } : x)) })} />)}
        <label className="check full"><input type="checkbox" checked={!!o.multi_tier} onChange={(e) => up({ multi_tier: e.target.checked })} /> Multi-tier levy in force</label>
        <label className="field full"><span className="qr-lbl">Note</span><input value={s(o.note)} onChange={(e) => up({ note: e.target.value || undefined })} /></label></div>
    }
    case 'items': {
      const items = ((o.items as O[]) || []); const nameKey = cat.key === 'insurance' ? 'name' : 'label'
      return <div><table className="qr-mini"><thead><tr><th>Item</th><th className="r">RM</th><th /></tr></thead><tbody>{items.map((t, i) => <tr key={i}>
        <td><input value={s(t[nameKey])} onChange={(e) => up({ items: items.map((x, j) => (j === i ? { ...x, [nameKey]: e.target.value } : x)) })} /></td>
        <td className="r"><input type="number" className="num" value={t.rm === null || t.rm === undefined ? '' : String(t.rm)} onChange={(e) => up({ items: items.map((x, j) => (j === i ? { ...x, rm: e.target.value === '' ? null : Number(e.target.value) } : x)) })} /></td>
        <td><IconAction kind="delete" label="Remove this item" onClick={() => up({ items: items.filter((_, j) => j !== i) })} /></td></tr>)}</tbody></table>
        <Btn small icon="plus" onClick={() => up({ items: [...items, { [nameKey]: '', rm: null, ...(cat.key === 'fee_schedule' ? { category: 'other' } : {}) }] })}>Add item</Btn></div>
    }
    case 'sector': return <div className="qr-form2">
      <label className="field full"><span className="qr-lbl">Allowed source countries (empty = any)</span><input value={((o.countries as string[]) || []).join(', ')} onChange={(e) => up({ countries: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></label>
      <label className="field full"><span className="qr-lbl">Allowed job types (empty = any)</span><input value={((o.jobs as string[]) || []).join(', ')} onChange={(e) => up({ jobs: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></label>
      <label className="field full"><span className="qr-lbl">Indian workers only as (job types)</span><input value={((o.india_jobs as string[]) || []).join(', ')} onChange={(e) => up({ india_jobs: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></label>
      <NumIn label="Cap (slots)" step="1" v={o.cap} set={(n) => up({ cap: n })} /><NumIn label="Age from" unit="years" step="1" v={o.age_min} set={(n) => up({ age_min: n })} /><NumIn label="Age to" unit="years" step="1" v={o.age_max} set={(n) => up({ age_max: n })} />
      <label className="check full"><input type="checkbox" checked={o.advert_first !== false} onChange={(e) => up({ advert_first: e.target.checked })} /> MyFutureJobs advert needed before applying</label>
      <label className="check full"><input type="checkbox" checked={!!o.no_front_liner} onChange={(e) => up({ no_front_liner: e.target.checked })} /> No front-liner jobs (cashier, waiter, receptionist…)</label>
      <label className="field"><span className="qr-lbl">When broken</span><select value={s(o.mode) || 'warn'} onChange={(e) => up({ mode: e.target.value })}><option value="warn">Warn and flag the record</option><option value="block">Block the save</option></select></label>
    </div>
    case 'pipeline': return <TemplateEditor t={v as Template} set={set} />
    default: return null
  }
}

/* pipeline template: rename, reorder, retire, add stages; steps per stage */
function TemplateEditor({ t, set }: { t: Template; set: (t: Template) => void }) {
  const [open, setOpen] = useState<number | null>(null)
  const stages = t?.stages || []
  const put = (i: number, st: TplStage) => set({ ...t, stages: stages.map((x, j) => (j === i ? st : x)) })
  const move = (i: number, dir: -1 | 1) => { const a = [...stages]; const j = i + dir; if (j < 1 || j >= a.length - 1) return; [a[i], a[j]] = [a[j], a[i]]; set({ ...t, stages: a }) }
  const fixed = (i: number) => i === 0 || i === stages.length - 1
  const allSteps = stages.flatMap((x) => x.steps)
  return <div>
    <p className="muted"><small>Quota approval stays first and Onboard last. Retired stages stay in older recruits’ history. Recruits already in progress keep their current version.</small></p>
    <ol className="qr-pipe edit">{stages.map((st, i) => <li key={st.key + i} className={st.retired ? 'retired' : ''}>
      <span className="qr-pipe-n">{i + 1}</span>
      <div className="qr-pipe-b">
        <input aria-label={`Stage ${i + 1} name`} value={st.label} onChange={(e) => put(i, { ...st, label: e.target.value })} />
        <select aria-label="Owner" value={st.owner || 'hr'} onChange={(e) => put(i, { ...st, owner: e.target.value })}>{Object.entries(OWNER).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        {open === i && <div className="qr-steps-ed">{st.steps.map((x, k) => <div key={k} className="row-gap">
          <input aria-label="Step name" value={x.label} onChange={(e) => put(i, { ...st, steps: st.steps.map((y, m) => (m === k ? { ...y, label: e.target.value } : y)) })} />
          <select aria-label="Applies to" value={x.ecr || ''} onChange={(e) => put(i, { ...st, steps: st.steps.map((y, m) => (m === k ? { ...y, ecr: (e.target.value || undefined) as never } : y)) })}><option value="">All</option><option value="ECR">ECR only</option><option value="ECNR">ECNR only</option></select>
          <label className="check"><input type="checkbox" checked={x.req !== false} onChange={(e) => put(i, { ...st, steps: st.steps.map((y, m) => (m === k ? { ...y, req: e.target.checked ? undefined : false } : y)) })} /> Required</label>
          {!x.key.startsWith('_') && x.key !== t.use_step && <IconAction kind="delete" label="Remove this step" onClick={() => put(i, { ...st, steps: st.steps.filter((_, m) => m !== k) })} />}
        </div>)}
          <Btn small icon="plus" onClick={() => put(i, { ...st, steps: [...st.steps, { key: `step_${Date.now().toString(36)}`, label: 'New step' }] })}>Add step</Btn></div>}
      </div>
      <Actions>
        <IconAction kind="view" label={open === i ? 'Hide steps' : `Steps (${st.steps.length})`} onClick={() => setOpen(open === i ? null : i)} />
        {!fixed(i) && <IconAction kind="escalate" label="Move up" disabled={i <= 1} onClick={() => move(i, -1)} />}
        {!fixed(i) && <IconAction kind="recall" label="Move down" disabled={i >= stages.length - 2} onClick={() => move(i, 1)} />}
        {!fixed(i) && !st.steps.some((x) => x.key === t.use_step) && <IconAction kind={st.retired ? 'resume' : 'pause'} label={st.retired ? 'Bring this stage back' : 'Retire this stage'} onClick={() => put(i, { ...st, retired: !st.retired })} />}
      </Actions>
    </li>)}</ol>
    <div className="row-gap">
      <Btn small icon="plus" onClick={() => { const a = [...stages]; const k = `stage_${Date.now().toString(36)}`; a.splice(a.length - 1, 0, { key: k, label: 'New stage', owner: 'hr', steps: [{ key: `${k}_done`, label: 'Done' }] }); set({ ...t, stages: a }) }}>Add stage</Btn>
      <label className="field"><span className="qr-lbl">Quota slot is used at</span><select value={t.use_step} onChange={(e) => set({ ...t, use_step: e.target.value })}>{allSteps.filter((x) => !x.key.startsWith('_')).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></label>
    </div>
  </div>
}
