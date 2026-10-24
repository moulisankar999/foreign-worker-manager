import { useMemo, useState } from 'react'
import { Btn, Card, Modal } from '../components/ui'
import { useAuth } from '../lib/auth'
import { companyName } from '../lib/companies'
import { useConfig } from '../lib/config'
import { isDemoCompany, useHideDemo } from '../lib/demo'
import { fmtDate, todayISO } from '../lib/util'
import { FREQ_LABEL, STATE_LABEL, STATE_TONE, STEPS, canDoStep, deleteSchedule, doStep, periodLabel, periodOf, periodsFor, saveSchedule, subState, type Freq, type Schedule, type StepKey, type Submission } from './subsData'
import type { ReportDef } from './types'

export interface Task { s: Schedule; period: string; sub?: Submission; state: ReturnType<typeof subState> }

/** open tasks (due / overdue / started), newest first, overdue on top */
export function tasksOf(schedules: Schedule[], submissions: Submission[], today = todayISO()): Task[] {
  const out: Task[] = []
  for (const s of schedules.filter((x) => x.active)) for (const period of periodsFor(s, today).slice(0, 12)) {
    const sub = submissions.find((x) => x.schedule_id === s.id && x.period === period)
    const state = subState(s, period, sub, today)
    if (state.state === 'open' && !sub) continue
    out.push({ s, period, sub, state })
  }
  const rank = { overdue: 0, due: 1, open: 2, filed: 3 }
  return out.sort((a, b) => rank[a.state.state] - rank[b.state.state] || a.state.due.localeCompare(b.state.due))
}

export function DueBanner({ tasks, onShow }: { tasks: Task[]; onShow: () => void }) {
  const od = tasks.filter((t) => t.state.state === 'overdue').length
  const due = tasks.filter((t) => t.state.state === 'due').length
  if (!od && !due) return null
  return (
    <div className={'rpt-due no-print' + (od ? ' red' : '')}>
      <b>{od ? `${od} required printed report${od > 1 ? 's are' : ' is'} overdue` : `${due} required printed report${due > 1 ? 's are' : ' is'} due`}</b>
      {od > 0 && due > 0 && <span className="muted">· {due} more due</span>}
      <span className="spacer" style={{ flex: 1 }} />
      <Btn small kind="primary" onClick={onShow}>View submissions</Btn>
    </div>
  )
}

const SIGN_STEPS: StepKey[] = ['prepared', 'verified', 'reviewed', 'approved', 'filed']

export function SubmissionsPanel({ defs, schedules, submissions, error, onOpen }: { defs: ReportDef[]; schedules: Schedule[]; submissions: Submission[]; error?: string; onOpen: (t: Task) => void }) {
  const { role, isCeo, can, session } = useAuth()
  const canSchedule = isCeo || can('compliance.settings')
  const companies = useConfig().companies.items // scoped users only get their own companies (my_company_list, migration 019)
  const tasks = useMemo(() => tasksOf(schedules, submissions), [schedules, submissions])
  const [edit, setEdit] = useState<Partial<Schedule> | null>(null)
  const [showFiled, setShowFiled] = useState(false)
  const [busy, setBusy] = useState('')

  const step = async (t: Task, k: StepKey | 'reset') => {
    let ref: string | undefined, note: string | undefined
    if (k === 'filed') { ref = prompt('File / folder reference for the signed copy (e.g. HR/RPT/2026/10):') || undefined; if (!ref) return }
    if (k === 'reset' && !confirm('Reset this submission? All sign-offs for this period are cleared (kept in the audit log).')) return
    if (k !== 'filed' && k !== 'reset' && !confirm(`Confirm: "${STEPS.find((s) => s.key === k)!.label}" for ${t.s.title}, ${periodLabel(t.period)}.\n\nOnly confirm after you have signed the printed copy.`)) return
    if (k === 'reset') note = prompt('Reason for reset:') || undefined
    setBusy(t.s.id + t.period + k)
    try { await doStep(t.s.id, t.period, k, note, ref) } catch (e) { alert((e as Error).message) } finally { setBusy('') }
  }

  const list = tasks.filter((t) => showFiled || t.state.state !== 'filed')
  const n = (st: string) => tasks.filter((t) => t.state.state === st).length
  return (
    <>
      {error && <Card><p className="neg">{error}</p></Card>}
      <Card title={<>Required printed submissions <small className="muted">· {n('overdue')} overdue · {n('due')} due · {n('filed')} filed</small></>}
        actions={<label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={showFiled} onChange={(e) => setShowFiled(e.target.checked)} /> Show filed</label>}>
        <p className="muted small">Print the report, collect the signatures in order (HR Manager → HR Admin → General Manager → CEO), then file the signed copy. Each step is recorded with the name and time.</p>
        {!list.length && <p className="muted center">Nothing due right now.</p>}
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Report</th><th>Period</th><th>Due</th><th>Status</th><th>Progress</th><th /></tr></thead>
            <tbody>{list.map((t) => (
              <tr key={t.s.id + t.period}>
                <td><b>{t.s.title}</b><div className="muted small">{FREQ_LABEL[t.s.frequency]}</div></td>
                <td>{periodLabel(t.period)}</td>
                <td>{fmtDate(t.state.due)}<div className={'small ' + (t.state.days < 0 ? 'neg' : 'muted')}>{t.state.state === 'filed' ? '' : t.state.days < 0 ? `${-t.state.days} days late` : `in ${t.state.days} days`}</div></td>
                <td><span className={'rpt-tag ' + STATE_TONE[t.state.state]}>{STATE_LABEL[t.state.state]}</span></td>
                <td><div className="rpt-steps">{STEPS.map((s) => { const d = t.sub?.steps[s.key]; return <span key={s.key} className={'rpt-step' + (d ? ' done' : '')} title={d ? `${d.by_name || ''} · ${new Date(d.at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })} MYT${d.note ? ' · ' + d.note : ''}` : s.who}>{s.label}</span> })}</div>
                  {t.sub?.file_ref && <div className="muted small">File: {t.sub.file_ref}</div>}</td>
                <td><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <Btn small icon="print" onClick={() => onOpen(t)}>Open &amp; print</Btn>
                  {SIGN_STEPS.filter((k) => canDoStep(k, role, t.sub?.steps || {}, session?.user.id).ok && !(k === 'filed' && t.sub?.steps.filed)).slice(0, 1).map((k) => (
                    <Btn key={k} small kind="primary" disabled={!!busy} onClick={() => step(t, k)}>{k === 'filed' ? 'Mark filed' : `Sign: ${STEPS.find((s) => s.key === k)!.label.replace(' & signed', '')}`}</Btn>
                  ))}
                  {isCeo && t.sub && <Btn small kind="ghost" disabled={!!busy} onClick={() => step(t, 'reset')}>Reset</Btn>}
                </div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Card>

      {(canSchedule || schedules.length > 0) && (
        <Card title="Schedules" actions={canSchedule ? <Btn small kind="primary" icon="plus" onClick={() => setEdit({ frequency: 'monthly', due_day: 7, active: true, filters: {} })}>Add required report</Btn> : undefined}>
          {!schedules.length && <p className="muted">No required printed reports yet. {canSchedule ? 'Add one to ask HR to print, sign and file it on a routine.' : ''}</p>}
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Report</th><th>Every</th><th>Due</th><th>Company</th><th>Set by</th><th /></tr></thead>
            <tbody>{schedules.map((s) => (
              <tr key={s.id} className={s.active ? '' : 'muted'}>
                <td><b>{s.title}</b>{!s.active && <span className="rpt-tag"> paused</span>}{s.notes && <div className="muted small">{s.notes}</div>}</td>
                <td>{FREQ_LABEL[s.frequency]}</td><td>Day {s.due_day} after the period</td><td>{s.company_id ? companyName(companies, s.company_id) : 'All companies'}</td><td>{s.created_by_name}</td>
                <td>{canSchedule && <Btn small onClick={() => setEdit(s)}>Edit</Btn>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </Card>
      )}
      {edit && <ScheduleForm defs={defs} init={edit} onClose={() => setEdit(null)} />}
    </>
  )
}

function ScheduleForm({ defs, init, onClose }: { defs: ReportDef[]; init: Partial<Schedule>; onClose: () => void }) {
  const cfg = useConfig()
  const hide = useHideDemo()
  const [v, setV] = useState<Partial<Schedule>>(init)
  const [busy, setBusy] = useState(false)
  const set = (p: Partial<Schedule>) => setV((x) => ({ ...x, ...p }))
  const save = async () => {
    if (!v.report_id) return alert('Choose a report')
    setBusy(true)
    try { await saveSchedule({ ...v, title: v.title || defs.find((d) => d.id === v.report_id)?.title, start_period: v.start_period || periodOf(v.frequency as Freq) }); onClose() } catch (e) { alert((e as Error).message) } finally { setBusy(false) }
  }
  const del = async () => { if (!v.id || !confirm('Delete this schedule? Past sign-offs stay in the audit log.')) return; try { await deleteSchedule(v.id); onClose() } catch (e) { alert((e as Error).message) } }
  return (
    <Modal title={v.id ? 'Edit required report' : 'Add required printed report'} onClose={onClose}
      footer={<>{v.id && <Btn kind="danger" onClick={del}>Delete</Btn>}<span style={{ flex: 1 }} /><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={busy} onClick={save}>Save</Btn></>}>
      <div className="rpt-filters" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <label style={{ gridColumn: '1 / -1' }}><span>Report</span>
          <select aria-label="Report" value={v.report_id || ''} onChange={(e) => { const d = defs.find((x) => x.id === e.target.value); set({ report_id: e.target.value, title: d?.title, frequency: (d?.routine || v.frequency || 'monthly') as Freq }) }}>
            <option value="">Choose…</option>{defs.filter((d) => !d.soon).map((d) => <option key={d.id} value={d.id}>{d.group} — {d.title}</option>)}
          </select></label>
        <label style={{ gridColumn: '1 / -1' }}><span>Title on the printed copy</span><input value={v.title || ''} onChange={(e) => set({ title: e.target.value })} /></label>
        <label><span>Frequency</span><select aria-label="Frequency" value={v.frequency} onChange={(e) => set({ frequency: e.target.value as Freq })}>{(Object.keys(FREQ_LABEL) as Freq[]).map((f) => <option key={f} value={f}>{FREQ_LABEL[f]}</option>)}</select></label>
        <label><span>Due on day (of the month after the period)</span><input type="number" min={1} max={28} value={v.due_day ?? 7} onChange={(e) => set({ due_day: Math.max(1, Math.min(28, Number(e.target.value) || 7)) })} /></label>
        <label><span>Company</span><select aria-label="Company" value={v.company_id || ''} onChange={(e) => set({ company_id: e.target.value || null })}><option value="">All companies</option>{cfg.companies.items.filter((c) => !hide || !isDemoCompany(c.id) || c.id === v.company_id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label><span>Signature labels</span><select aria-label="Signature labels" value={v.filters?.lang || 'en'} onChange={(e) => set({ filters: { ...(v.filters || {}), lang: e.target.value } })}><option value="en">English</option><option value="ms">English + Bahasa Melayu</option><option value="ta">English + Tamil</option></select></label>
        <label style={{ gridColumn: '1 / -1' }}><span>Instructions for HR (optional)</span><textarea rows={2} value={v.notes || ''} onChange={(e) => set({ notes: e.target.value })} /></label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={v.active !== false} onChange={(e) => set({ active: e.target.checked })} /> Active</label>
      </div>
    </Modal>
  )
}
