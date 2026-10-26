/* Recruitment pipeline: batches (one agent / one country / one target) and the recruits in them, as a board or a table. */
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Btn, Card, Chip, Empty, SelectFilter, Toolbar } from '../../components/ui'
import { DataTable, Details } from '../../components/dataTable'
import { Actions, IconAction } from '../../components/iconAction'
import { useOutlets } from '../../lib/hooks'
import { fmtDate } from '../../lib/util'
import { inCompany, COUNTRIES, daysInStage, DEFAULT_TEMPLATE, liveStages, nextStep, progress, qcall, recruitStageOf, regAt, rmFmt, stageLabelIn, stageSkipped, stepCtx, tplOf, UR_STATUS, useQuota, type Batch, type QData, type Recruit, type Template } from '../../lib/quota'
import { companyOpts, QForm, s, useQCtx, type V } from './shared'

export const recruitStage = (d: QData, r: Recruit) => recruitStageOf(d, r)
/** flags set by the sector / eligibility rules, shown on the record */
export const RuleFlags = ({ f }: { f?: string[] | null }) => (f && f.length ? <span className="qr-flags">{f.map((x, i) => <span key={i} className="pill warn" title="Flagged by Rules & regulations">⚠ {x}</span>)}</span> : null)
const STALL = 14

export function PipelineTab({ company }: { company: string }) {
  const ctx = useQCtx()
  const d = useQuota()
  const nav = useNavigate()
  const [view, setView] = useState<'board' | 'table'>(() => (localStorage.getItem('qr.view') as 'board' | 'table') || 'board')
  const [batch, setBatch] = useState('')
  const [bForm, setBForm] = useState<V | null>(null)
  const [rForm, setRForm] = useState<V | null>(null)
  const [showDone, setShowDone] = useState(false)
  const batches = d.batches.filter((b) => inCompany(company, b.company_id))
  const recruits = d.recruits.filter((r) => (inCompany(company, r.company_id)) && (!batch || r.batch_id === batch) && (showDone || r.status === 'active'))
  const spent = (b: Batch) => d.payments.filter((p) => p.batch_id === b.id && p.status !== 'void').reduce((a, p) => a + Number(p.amount_rm), 0)
  const setV = (v: 'board' | 'table') => { setView(v); localStorage.setItem('qr.view', v) }
  const ur = (r: Recruit) => d.requests.find((u) => u.id === r.use_request_id)
  const bCountry = batches.find((b) => b.id === batch)?.country
  const tpl: Template = (regAt(d.reg, 'pipeline', bCountry || 'India')?.value as Template) || DEFAULT_TEMPLATE
  const STAGES = [...liveStages(tpl).map((x) => ({ key: x.key, label: x.label }))]
  for (const r of recruits) { const k = recruitStage(d, r); if (k !== 'converted' && !STAGES.some((x) => x.key === k)) STAGES.splice(STAGES.length - 1, 0, { key: k, label: stageLabelIn(tplOf(d, r), k) }) }
  const counts: Record<string, number> = {}
  for (const r of recruits.filter((x) => x.status === 'active')) { const k = recruitStage(d, r); counts[k] = (counts[k] || 0) + 1 }

  return (
    <div className="qr-grid">
      <Card title="Batches" actions={<Btn kind="primary" icon="plus" small onClick={() => setBForm({ company_id: company || ctx.companies[0]?.id, target_count: 1 })}>New batch</Btn>}>
        <DataTable label="Recruitment batches" rows={batches} rowKey={(b) => b.id} initialSort={{ key: 'arr', dir: 'asc' }}
          columns={[
            { key: 't', label: 'Batch', main: true, render: (b) => <><b>{b.title}</b> {b.status === 'closed' && <Chip tone="gray">Closed</Chip>}<br /><small className="muted">{b.country} · {ctx.cName(b.company_id)}</small></>, sort: (b) => b.title },
            { key: 'n', label: 'Recruits', align: 'right', render: (b) => `${d.recruits.filter((r) => r.batch_id === b.id && r.status !== 'dropped').length} / ${b.target_count}` },
            { key: 'arr', label: 'Expected arrival', hide: 'phone', render: (b) => fmtDate(b.expected_arrival || ''), sort: (b) => b.expected_arrival || '9' },
            { key: 'bud', label: 'Spent / budget', hide: 'tablet', align: 'right', render: (b) => <span className={b.budget_total && spent(b) > b.budget_total ? 'neg' : ''}>{rmFmt(spent(b))} / {rmFmt(b.budget_total)}</span> },
          ]}
          expand={(b) => <Details items={[['Agent', [b.agent_name, b.agent_licence && `licence ${b.agent_licence}`].filter(Boolean).join(' · ') || '—'], ['Source-country agency', b.ra_name || '—'],
            ['Letter', d.quotas.find((q) => q.id === b.quota_id)?.ref_no || '—'], ['Hostel', ctx.cfg.hostels.items.find((h) => h.id === b.hostel_id)?.name || '—'], ['Notes', b.notes || '—'], ['Created by', ctx.who(b.created_by_name, null)]]} />}
          actions={(b) => <Actions>
            <IconAction kind="view" label="Show this batch's recruits" onClick={() => setBatch(b.id)} />
            {b.status === 'open' && <IconAction kind="add" label="Add a recruit to this batch" onClick={() => setRForm({ batch_id: b.id, country: b.country, company_id: b.company_id })} />}
            <IconAction kind="edit" label="Edit batch" onClick={() => setBForm({ ...b })} />
            {b.status === 'open' && ctx.isHraUp && <IconAction kind="close" label="Close batch" confirm="Close this batch? Recruits stay as they are." onClick={() => qcall('qr_save_batch', { p: { id: b.id, status: 'closed' } })} />}
          </Actions>}
          empty={<Empty title="No batches">A batch groups the recruits from one agent and country with a target and budget.</Empty>} />
      </Card>

      <Card title={<>Recruits <span className="qr-stage-counts">{STAGES.filter((x) => counts[x.key]).map((x) => <span key={x.key} className="pill n" title={x.label}>{x.label} <b>{counts[x.key]}</b></span>)}</span></>} actions={<Toolbar>
        <SelectFilter label="Batch" value={batch} onChange={setBatch} options={[{ value: '', label: 'All batches' }, ...batches.map((b) => ({ value: b.id, label: b.title }))]} />
        <label className="check"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Converted / dropped</label>
        <div className="qr-seg" role="group" aria-label="View"><button className={view === 'board' ? 'on' : ''} onClick={() => setV('board')}>Board</button><button className={view === 'table' ? 'on' : ''} onClick={() => setV('table')}>Table</button></div>
        <Btn icon="plus" small onClick={() => setRForm({ company_id: company || ctx.companies[0]?.id, batch_id: batch || undefined, country: batches.find((b) => b.id === batch)?.country })}>Add recruit</Btn>
      </Toolbar>}>
        {view === 'board' ? (
          <div className="qr-board">{[...STAGES, ...(showDone ? [{ key: 'converted', label: 'Converted' }] : [])].map((st) => {
            const list = recruits.filter((r) => recruitStage(d, r) === st.key)
            return <section key={st.key} className="qr-col"><h4>{st.label} <Chip tone="gray">{list.length}</Chip></h4>
              {list.map((r) => { const t = tplOf(d, r); const c = stepCtx(d, r); const p = progress(r, t, c); const u = ur(r); const age = daysInStage(r); return (
                <Link key={r.id} to={`/quota/recruit/${r.id}`} className={`qr-card ${r.status === 'dropped' ? 'dropped' : ''}`}>
                  <b>{r.full_name}</b><small>{r.country}{r.ecr ? ` · ${r.ecr}` : ''} · {r.job || '—'}</small>
                  <div className="qr-bar"><i style={{ width: `${p.pct}%` }} /></div>
                  <small className="muted">{stageSkipped(t, st.key, r.ecr) || nextStep(r, t, c)?.label || 'All steps done'}</small>
                  {r.status === 'active' && <small className={`qr-age ${age > STALL ? 'late' : ''}`}>{age} day{age === 1 ? '' : 's'} in this stage</small>}
                  <RuleFlags f={r.rule_flags} />
                  {u ? <Chip tone={UR_STATUS[u.status].tone}>Q-{u.ref_no} {UR_STATUS[u.status].label}</Chip> : <Chip tone="gray">No quota request</Chip>}
                </Link>) })}
              {!list.length && <small className="muted">—</small>}
            </section>
          })}</div>
        ) : (
          <DataTable label="Recruits" rows={recruits} rowKey={(r) => r.id} search={(r) => `${r.full_name} ${r.passport_no} ${r.job} ${r.country}`}
            filters={[{ key: 'c', label: 'Country', options: COUNTRIES, match: (r, v) => r.country === v }, { key: 'st', label: 'Stage', options: STAGES.map((x) => ({ value: x.key, label: x.label })), match: (r, v) => recruitStage(d, r) === v }]}
            columns={[
              { key: 'n', label: 'Recruit', main: true, render: (r) => <><b>{r.full_name}</b>{r.status !== 'active' && <> <Chip tone={r.status === 'converted' ? 'green' : 'gray'}>{r.status}</Chip></>}<br /><small className="muted">{r.country}{r.ecr ? ` · ${r.ecr}` : ''} · {r.passport_no || 'no passport yet'}</small><RuleFlags f={r.rule_flags} /></>, sort: (r) => r.full_name },
              { key: 'st', label: 'Stage', render: (r) => <>{stageLabelIn(tplOf(d, r), recruitStage(d, r))}{r.status === 'active' && <><br /><small className={`qr-age ${daysInStage(r) > STALL ? 'late' : ''}`}>{daysInStage(r)} d</small></>}</>, sort: (r) => STAGES.findIndex((x) => x.key === recruitStage(d, r)) },
              { key: 'p', label: 'Progress', hide: 'phone', align: 'right', render: (r) => <span className="qr-num">{progress(r, tplOf(d, r), stepCtx(d, r)).pct}%</span>, sort: (r) => progress(r, tplOf(d, r), stepCtx(d, r)).pct },
              { key: 'q', label: 'Quota request', hide: 'tablet', render: (r) => { const u = ur(r); return u ? <Chip tone={UR_STATUS[u.status].tone}>Q-{u.ref_no} {UR_STATUS[u.status].label}</Chip> : '—' } },
              { key: 'f', label: 'Flight', hide: 'wide', render: (r) => r.flight_at ? `${r.flight_no || ''} ${fmtDate(r.flight_at.slice(0, 10))}` : '—', sort: (r) => r.flight_at || '9' },
            ]}
            actions={(r) => <Actions><IconAction kind="view" label="Open recruit" onClick={() => nav(`/quota/recruit/${r.id}`)} /></Actions>}
            empty={<Empty title="No recruits">Add the selected candidates to a batch.</Empty>} />
        )}
      </Card>
      {bForm && <BatchForm v={bForm} onClose={() => setBForm(null)} />}
      {rForm && <RecruitForm v={rForm} onClose={() => setRForm(null)} />}
    </div>
  )
}

function BatchForm({ v, onClose }: { v: V; onClose: () => void }) {
  const ctx = useQCtx()
  const d = useQuota()
  const outlets = useOutlets()
  const isNew = !v.id
  return (
    <QForm title={isNew ? 'New recruitment batch' : `Edit ${s(v.title)}`} initial={v} onClose={onClose}
      fields={[
        { key: 'company_id', label: 'Company', type: 'select', required: true, options: companyOpts(ctx.companies), show: () => isNew },
        { key: 'title', label: 'Batch name', required: true, placeholder: 'e.g. India cooks — Mar 2027' },
        { key: 'country', label: 'Country', type: 'select', required: true, options: COUNTRIES, show: () => isNew },
        { key: 'quota_id', label: 'Approval letter', type: 'select', options: [{ value: '', label: '—' }, ...d.quotas.filter((q) => q.status === 'active' && q.company_id === v.company_id).map((q) => ({ value: q.id, label: q.ref_no }))], show: () => isNew },
        { key: 'target_count', label: 'Target number', type: 'number' },
        { key: 'expected_arrival', label: 'Expected arrival', type: 'date' },
        { key: 'agent_name', label: 'Malaysian agency' }, { key: 'agent_licence', label: 'Agency licence no.' }, { key: 'ra_name', label: 'Source-country agency (RA / licence)' },
        { key: 'outlet_id', label: 'Outlet', type: 'select', options: [{ value: '', label: '—' }, ...outlets.filter((o) => !v.company_id || o.companyId === v.company_id).map((o) => ({ value: o.id, label: o.name }))] },
        { key: 'hostel_id', label: 'Hostel', type: 'select', options: [{ value: '', label: '—' }, ...ctx.cfg.hostels.items.filter((h) => !h.archived).map((h) => ({ value: h.id, label: h.name }))] },
        { key: 'budget_total', label: 'Budget (whole batch)', type: 'money', hint: 'Compared with the payments recorded against this batch.' },
        { key: 'notes', label: 'Notes', type: 'textarea', full: true },
      ]}
      onSave={(x) => { const p: V = {}; for (const [k, val] of Object.entries(x)) if (val !== '' && val !== undefined && !['created_at', 'created_by_name', 'budget'].includes(k)) p[k] = val; return qcall('qr_save_batch', { p }) }} />
  )
}

export function RecruitForm({ v, onClose }: { v: V; onClose: () => void }) {
  const ctx = useQCtx()
  const d = useQuota()
  return (
    <QForm title={v.id ? `Edit ${s(v.full_name)}` : 'Add a recruit'} initial={v} onClose={onClose}
      fields={[
        { key: 'batch_id', label: 'Batch', type: 'select', options: [{ value: '', label: '—' }, ...d.batches.filter((b) => b.status === 'open').map((b) => ({ value: b.id, label: `${b.title} (${b.country})` }))], show: () => !v.id },
        { key: 'company_id', label: 'Company', type: 'select', options: companyOpts(ctx.companies), show: (x) => !v.id && !x.batch_id },
        { key: 'country', label: 'Country', type: 'select', required: true, options: COUNTRIES, show: (x) => !v.id && !x.batch_id },
        { key: 'full_name', label: 'Full name (as in passport)', type: 'upper', required: true },
        { key: 'passport_no', label: 'Passport no.', type: 'upper' }, { key: 'passport_expiry', label: 'Passport expiry', type: 'date' },
        { key: 'ecr', label: 'India passport type', type: 'select', options: [{ value: '', label: '—' }, { value: 'ECR', label: 'ECR — emigration check required' }, { value: 'ECNR', label: 'ECNR — no check' }],
          show: (x) => (x.country || d.batches.find((b) => b.id === x.batch_id)?.country) === 'India', hint: 'ECR adds the eMigrate, attestation and emigration-clearance steps.' },
        { key: 'dob', label: 'Date of birth', type: 'date' }, { key: 'gender', label: 'Gender', type: 'select', options: ['', 'Male', 'Female'] },
        { key: 'job', label: 'Job' }, { key: 'phone', label: 'Phone' },
      ]}
      onSave={async (x) => {
        const b = d.batches.find((y) => y.id === x.batch_id)
        const p: V = { ...x, company_id: b?.company_id || x.company_id, country: b?.country || x.country }
        if (!p.company_id) throw new Error('Choose the batch or the company.')
        if (p.country === 'India' && !p.ecr) throw new Error('Choose ECR or ECNR for an Indian passport.')
        for (const k of Object.keys(p)) if (p[k] === '') delete p[k]
        if (p.passport_expiry && String(p.passport_expiry) < new Date(Date.now() + 548 * 864e5).toISOString().slice(0, 10)) {
          if (!confirm('The passport has less than 18 months left. Save anyway? (Renew it before applying the calling visa.)')) throw new Error('Not saved.')
        }
        await qcall('qr_save_recruit', { p })
      }} />
  )
}
