/* Reconciliation: the ledger's "used" against what can be counted — active workers, in the pipeline, CMOs, other exits,
 * runaways and exits with no record. Any difference is a red row to be explained. */
import { useState } from 'react'
import { Card, Chip, Empty, Toolbar } from '../../components/ui'
import { DataTable, Details } from '../../components/dataTable'
import { IconAction } from '../../components/iconAction'
import { Preview } from '../../reports/Preview'
import type { Block } from '../../reports/types'
import { todayISO } from '../../lib/util'
import { inCompany, useQuota, type Tally } from '../../lib/quota'
import { useQCtx, useSheetMeta } from './shared'

const COLS: [keyof Tally, string][] = [['approved', 'Approved'], ['used', 'Used'], ['available', 'Balance'], ['reserved', 'Reserved'], ['active_workers', 'Active'], ['in_pipeline', 'Pipeline'],
  ['exited_cmo', 'CMO'], ['exited_other', 'Other exit'], ['runaways', 'Runaway (no CMO)'], ['exited_unrecorded', 'Exit, no record'], ['repl_eligible', 'Repl. eligible'], ['repl_applied', 'Repl. applied'], ['repl_approved', 'Repl. approved'], ['mismatch', 'Mismatch']]

export function ReconTab({ company }: { company: string }) {
  const ctx = useQCtx()
  const d = useQuota()
  const [print, setPrint] = useState(false)
  const rows = d.tally.filter((t) => inCompany(company, t.company_id))
  const byCo = new Map<string, Tally[]>(); for (const t of rows) byCo.set(t.company_id, [...(byCo.get(t.company_id) || []), t])
  const tot = (l: Tally[], k: keyof Tally) => l.reduce((a, t) => a + Number(t[k] || 0), 0)
  const bad = rows.filter((t) => t.mismatch !== 0 || t.exited_unrecorded > 0)
  const meta = useSheetMeta(company, 'Quota reconciliation', company ? ctx.cName(company) : 'All companies', true)
  const blocks: Block[] = [
    { kind: 'kpis', items: [{ label: 'Approved', value: tot(rows, 'approved') }, { label: 'Used', value: tot(rows, 'used') }, { label: 'Balance', value: tot(rows, 'available'), tone: 'green' }, { label: 'Runaway (no CMO)', value: tot(rows, 'runaways'), tone: 'red' }, { label: 'Rows to explain', value: bad.length, tone: bad.length ? 'red' : 'green' }] },
    { kind: 'table', title: 'Tally per company, letter and country', groupBy: 'co',
      cols: [{ key: 'co', label: 'Company', w: 10 }, { key: 'ref', label: 'Letter', w: 10, wrap: true }, { key: 'country', label: 'Country', w: 7 }, ...COLS.map(([k, label]) => ({ key: k as string, label, w: 5 }))],
      rows: rows.map((t) => ({ ...t, co: ctx.cName(t.company_id), ref: t.ref_no, _tone: t.mismatch !== 0 ? 'red' : undefined })),
      totals: Object.fromEntries([['ref', 'Total'], ...COLS.map(([k]) => [k, tot(rows, k)])]) },
    { kind: 'note', text: 'Used = active workers + in the pipeline + CMO exits + other exits + runaways + exits with no record. A mismatch row must be explained before sign-off.', tone: bad.length ? 'red' : 'gray' },
    { kind: 'signatures' },
  ]
  return (
    <div className="qr-grid">
      {bad.length > 0 && <div className="note-box bad"><b>{bad.length} row(s) do not reconcile.</b> Usual causes: a worker left without a CMO or runaway case, a worker not linked to his letter (Workers › edit › Approval letter), or a manual ledger entry. Fix the record — the tally updates at once.</div>}
      <Card title="Reconciliation" actions={<Toolbar><IconAction kind="print" label="A4 reconciliation with sign-off" onClick={() => setPrint(true)} /></Toolbar>}>
        <DataTable label="Reconciliation" rows={rows} rowKey={(t) => `${t.quota_id}|${t.country}`} dense rowClass={(t) => (t.mismatch !== 0 ? 'row-bad' : '')}
          columns={[
            { key: 'q', label: 'Letter', main: true, render: (t) => <><b>{t.ref_no}</b> · {t.country}<br /><small className="muted">{ctx.cName(t.company_id)}</small></>, sort: (t) => t.ref_no },
            { key: 'a', label: 'Approved', align: 'right', hide: 'phone', render: (t) => t.approved },
            { key: 'u', label: 'Used', align: 'right', render: (t) => t.used },
            { key: 'b', label: 'Balance', align: 'right', render: (t) => <b>{t.available}</b> },
            { key: 'act', label: 'Active', align: 'right', hide: 'phone', render: (t) => t.active_workers },
            { key: 'cmo', label: 'CMO', align: 'right', hide: 'phone', render: (t) => t.exited_cmo },
            { key: 'run', label: 'Runaway (no CMO)', align: 'right', hide: 'phone', render: (t) => t.runaways ? <Chip tone="red">{t.runaways}</Chip> : 0 },
            { key: 'rp', label: 'Replacement', hide: 'tablet', render: (t) => `${t.repl_eligible} / ${t.repl_applied} / ${t.repl_approved}` },
            { key: 'm', label: 'Mismatch', align: 'right', render: (t) => t.mismatch ? <Chip tone="red">{t.mismatch > 0 ? '+' : ''}{t.mismatch}</Chip> : <Chip tone="green">0</Chip>, sort: (t) => Math.abs(t.mismatch) },
          ]}
          expand={(t) => <Details items={COLS.map(([k, label]) => [label, String(t[k])] as [string, string])} />}
          empty={<Empty title="Nothing to reconcile yet">Open an approval letter first.</Empty>} />
      </Card>
      {[...byCo.entries()].length > 1 && <Card title="Per company">
        <DataTable label="Per company" dense rows={[...byCo.entries()]} rowKey={([c]) => c}
          columns={[{ key: 'c', label: 'Company', main: true, render: ([c]) => ctx.cName(c) }, ...(['approved', 'used', 'available', 'active_workers', 'exited_cmo', 'runaways', 'mismatch'] as (keyof Tally)[]).map((k) => ({ key: k as string, label: COLS.find((x) => x[0] === k)![1], align: 'right' as const, render: ([, l]: [string, Tally[]]) => tot(l, k) }))]} />
      </Card>}
      {print && <Preview blocks={blocks} meta={meta} file={`quota-reconciliation-${todayISO()}.pdf`} onClose={() => setPrint(false)} />}
    </div>
  )
}
