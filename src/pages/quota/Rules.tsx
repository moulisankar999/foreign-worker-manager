/* Module rules (CEO sets; everyone else reads) and the per-country checklists. */
import { Card, KV } from '../../components/ui'
import { COUNTRY_STEPS, qcall, rmFmt, useQuota } from '../../lib/quota'
import { useState } from 'react'
import { Btn } from '../../components/ui'
import { DataTable } from '../../components/dataTable'
import { QForm, useQCtx } from './shared'

export function RulesTab() {
  const ctx = useQCtx()
  const d = useQuota()
  const [edit, setEdit] = useState(false)
  const r = d.rules
  return (
    <div className="qr-grid">
      <Card title="Rules" actions={ctx.isCeo && <Btn small icon="edit" onClick={() => setEdit(true)}>Change</Btn>}>
        <KV items={[
          ['CMO missing alert', `${r.cmo_missing_days} days after a worker leaves with no CMO recorded`],
          ['Runaway report deadline', `${r.runaway_report_days} days from last seen (Immigration eRUNAWAY report)`],
          ['Letter expiry', `amber at ${r.expiry_amber_days} days, red at ${r.expiry_red_days} days`],
          ['Utilisation amber', `${r.util_amber_pct}% of the approved slots used`],
          ['Second check on payments', `${rmFmt(r.payment_check_rm)} and above`],
          ['Approval of quota use', 'GM, then CEO. The CEO alone is final; the GM alone is never enough. Nobody approves their own request.'],
        ]} />
      </Card>
      <Card title="Country checklists">
        <DataTable label="Country checklists" rows={Object.entries(COUNTRY_STEPS)} rowKey={([c]) => c} dense
          columns={[{ key: 'c', label: 'Country', main: true, render: ([c]) => c }, { key: 'n', label: 'Steps', align: 'right', render: ([, l]) => l.length }]}
          expand={([, l]) => <ol className="alist">{l.map((s) => <li key={s.key}><b>{s.label}</b>{s.ecr ? ' (ECR only)' : ''}{s.gate ? ' — needs the approved quota use' : ''}{s.hint && <div className="muted"><small>{s.hint}</small></div>}</li>)}</ol>} />
      </Card>
      {edit && <QForm title="Quota rules" initial={{ ...r }} onClose={() => setEdit(false)}
        fields={[{ key: 'cmo_missing_days', label: 'CMO missing alert (days)', type: 'number', required: true }, { key: 'runaway_report_days', label: 'Runaway report deadline (days)', type: 'number', required: true },
          { key: 'expiry_amber_days', label: 'Expiry amber (days)', type: 'number', required: true }, { key: 'expiry_red_days', label: 'Expiry red (days)', type: 'number', required: true },
          { key: 'util_amber_pct', label: 'Utilisation amber (%)', type: 'number', required: true }, { key: 'payment_check_rm', label: 'Second check from', type: 'money', required: true }]}
        onSave={(v) => qcall('qr_set_rules', { p: { cmo_missing_days: v.cmo_missing_days, runaway_report_days: v.runaway_report_days, expiry_amber_days: v.expiry_amber_days, expiry_red_days: v.expiry_red_days, util_amber_pct: v.util_amber_pct, payment_check_rm: v.payment_check_rm } })} />}
    </div>
  )
}
