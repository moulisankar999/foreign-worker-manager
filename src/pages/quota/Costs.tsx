/* Recruitment money: every payment with its receipt, checked by a second person above the threshold;
 * totals per category, country, batch and worker, budget against actual, and an A4 report with the sign-off. */
import { useMemo, useState } from 'react'
import { Btn, Card, Chip, Empty, SelectFilter, Stat, Toolbar } from '../../components/ui'
import { DataTable, Details } from '../../components/dataTable'
import { Actions, IconAction } from '../../components/iconAction'
import { Preview } from '../../reports/Preview'
import type { Block } from '../../reports/types'
import { fmtDate, todayISO } from '../../lib/util'
import { inCompany, atMyt, COUNTRIES, PAY_CATS, payLabel, qcall, rmFmt, useQuota, type Payment } from '../../lib/quota'
import { companyOpts, run, FileField, FileLink, NoteAsk, QForm, useQCtx, useSheetMeta, type V } from './shared'

const ST = { recorded: { label: 'Recorded', tone: 'blue' }, pending_check: { label: 'To be checked', tone: 'amber' }, verified: { label: 'Checked', tone: 'green' }, void: { label: 'Void', tone: 'gray' } } as const
const sum = (l: Payment[]) => l.reduce((a, p) => a + Number(p.amount_rm), 0)

export function CostsTab({ company }: { company: string }) {
  const ctx = useQCtx()
  const d = useQuota()
  const [form, setForm] = useState<V | null>(null)
  const [voidP, setVoidP] = useState<Payment | null>(null)
  const [group, setGroup] = useState<'category' | 'country' | 'batch' | 'company'>('category')
  const [print, setPrint] = useState(false)
  const all = d.payments.filter((p) => inCompany(company, p.company_id))
  const live = all.filter((p) => p.status !== 'void')
  const recruitsOf = (pred: (r: { company_id: string; country: string; batch_id: string | null }) => boolean) => d.recruits.filter((r) => r.status !== 'dropped' && pred(r)).length
  const groups = useMemo(() => {
    const key = (p: Payment) => group === 'category' ? p.category : group === 'country' ? p.country || '—' : group === 'batch' ? p.batch_id || '' : p.company_id
    const m = new Map<string, Payment[]>()
    for (const p of live) m.set(key(p), [...(m.get(key(p)) || []), p])
    return [...m.entries()].map(([k, l]) => {
      const b = d.batches.find((x) => x.id === k)
      const heads = group === 'country' ? recruitsOf((r) => r.country === k && (inCompany(company, r.company_id))) : group === 'batch' ? recruitsOf((r) => r.batch_id === k) : group === 'company' ? recruitsOf((r) => r.company_id === k) : 0
      return { k, label: group === 'category' ? payLabel(k) : group === 'batch' ? (b?.title || 'No batch') : group === 'company' ? ctx.cName(k) : k, total: sum(l), n: l.length, budget: group === 'batch' ? b?.budget_total || 0 : 0, heads }
    }).sort((a, b) => b.total - a.total)
  }, [live, group, d.batches, d.recruits]) // eslint-disable-line react-hooks/exhaustive-deps
  const heads = d.recruits.filter((r) => r.status !== 'dropped' && (inCompany(company, r.company_id))).length
  const budget = d.batches.filter((b) => inCompany(company, b.company_id)).reduce((a, b) => a + Number(b.budget_total || 0), 0)
  const meta = useSheetMeta(company, 'Recruitment cost report', company ? ctx.cName(company) : 'All companies')
  const blocks: Block[] = [
    { kind: 'kpis', items: [{ label: 'Spent', value: rmFmt(sum(live)) }, { label: 'Budget (batches)', value: rmFmt(budget) }, { label: 'Recruits', value: heads }, { label: 'Per recruit', value: heads ? rmFmt(sum(live) / heads) : '—' }, { label: 'Waiting for check', value: all.filter((p) => p.status === 'pending_check').length, tone: 'amber' }] },
    ...(['category', 'country', 'batch'] as const).map((g): Block => {
      const key = (p: Payment) => g === 'category' ? payLabel(p.category) : g === 'country' ? p.country || '—' : d.batches.find((b) => b.id === p.batch_id)?.title || 'No batch'
      const m = new Map<string, number>(); for (const p of live) m.set(key(p), (m.get(key(p)) || 0) + Number(p.amount_rm))
      return { kind: 'table', title: `By ${g}`, cols: [{ key: 'k', label: g[0].toUpperCase() + g.slice(1), w: 60 }, { key: 'v', label: 'Amount', fmt: 'rm', w: 25 }], rows: [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ k, v })), totals: { k: 'Total', v: sum(live) } }
    }),
    { kind: 'pagebreak' },
    { kind: 'table', title: 'Payments', cols: [{ key: 'd', label: 'Paid', fmt: 'date', w: 10 }, { key: 'c', label: 'Category', w: 22 }, { key: 'who', label: 'For', w: 18 }, { key: 'payee', label: 'Payee', w: 16 }, { key: 'ref', label: 'Ref', w: 12 }, { key: 'st', label: 'Status', w: 9 }, { key: 'a', label: 'RM', fmt: 'rm', w: 13 }],
      rows: all.map((p) => ({ d: p.paid_on, c: payLabel(p.category), who: d.recruits.find((r) => r.id === p.recruit_id)?.full_name || d.batches.find((b) => b.id === p.batch_id)?.title || p.country || '', payee: p.payee, ref: p.ref, st: ST[p.status].label, a: p.status === 'void' ? 0 : p.amount_rm, _tone: p.status === 'void' ? 'gray' : p.status === 'pending_check' ? 'amber' : undefined })), totals: { c: 'Total', a: sum(live) } },
    { kind: 'signatures' },
  ]

  return (
    <div className="qr-grid">
      <div className="stats">
        <Stat label="Spent" value={rmFmt(sum(live))} icon="money" />
        <Stat label="Budget (batches)" value={rmFmt(budget)} tone={budget && sum(live) > budget ? 'red' : 'teal'} icon="chart" sub={budget ? `${Math.round((sum(live) / budget) * 100)}% used` : undefined} />
        <Stat label="Per recruit" value={heads ? rmFmt(sum(live) / heads) : '—'} icon="users" sub={`${heads} recruit(s)`} />
        <Stat label="To be checked" value={all.filter((p) => p.status === 'pending_check').length} tone="amber" icon="check" />
      </div>
      <Card title="Totals" actions={<Toolbar><SelectFilter label="Group by" value={group} onChange={(v) => setGroup(v as typeof group)} options={[{ value: 'category', label: 'Category' }, { value: 'country', label: 'Country' }, { value: 'batch', label: 'Batch' }, { value: 'company', label: 'Company' }]} />
        <IconAction kind="print" label="A4 cost report with sign-off" onClick={() => setPrint(true)} /></Toolbar>}>
        <DataTable label="Cost totals" rows={groups} rowKey={(g) => g.k || '-'} dense
          columns={[
            { key: 'l', label: group[0].toUpperCase() + group.slice(1), main: true, render: (g) => g.label },
            { key: 'n', label: 'Payments', align: 'right', hide: 'phone', render: (g) => g.n },
            { key: 't', label: 'Amount', align: 'right', render: (g) => <b>{rmFmt(g.total)}</b>, sort: (g) => g.total },
            ...(group === 'batch' ? [{ key: 'b', label: 'Budget', align: 'right' as const, render: (g: typeof groups[number]) => g.budget ? <span className={g.total > g.budget ? 'neg' : ''}>{rmFmt(g.budget)} ({Math.round((g.total / g.budget) * 100)}%)</span> : '—' }] : []),
            ...(group !== 'category' ? [{ key: 'h', label: 'Per recruit', align: 'right' as const, hide: 'tablet' as const, render: (g: typeof groups[number]) => g.heads ? rmFmt(g.total / g.heads) : '—' }] : []),
          ]} empty={<Empty title="No payments yet" />} />
      </Card>
      <Card title="Payments" actions={<Btn kind="primary" icon="plus" small onClick={() => setForm({ company_id: company || ctx.companies[0]?.id, paid_on: todayISO() })}>Record payment</Btn>}>
        <DataTable label="Payments" rows={all} rowKey={(p) => p.id} initialSort={{ key: 'd', dir: 'desc' }} search={(p) => `${p.payee} ${p.ref} ${p.note} ${payLabel(p.category)}`}
          filters={[{ key: 'c', label: 'Category', options: PAY_CATS.map((c) => ({ value: c.key, label: c.label })), match: (p, v) => p.category === v }, { key: 's', label: 'Status', options: Object.entries(ST).map(([value, x]) => ({ value, label: x.label })), match: (p, v) => p.status === v }]}
          rowClass={(p) => (p.status === 'void' ? 'strike' : '')}
          columns={[
            { key: 'd', label: 'Paid', render: (p) => fmtDate(p.paid_on), sort: (p) => p.paid_on, hide: 'phone' },
            { key: 'c', label: 'Payment', main: true, render: (p) => <>{payLabel(p.category)}<br /><small className="muted">{d.recruits.find((r) => r.id === p.recruit_id)?.full_name || d.batches.find((b) => b.id === p.batch_id)?.title || p.country || ctx.cName(p.company_id)}</small></> },
            { key: 'a', label: 'Amount', align: 'right', render: (p) => <b>{rmFmt(p.amount_rm)}</b>, sort: (p) => Number(p.amount_rm) },
            { key: 's', label: 'Status', render: (p) => <Chip tone={ST[p.status].tone}>{ST[p.status].label}</Chip> },
            { key: 'r', label: 'Receipt', hide: 'tablet', render: (p) => p.receipt_file ? <FileLink f={d.files.find((f) => f.id === p.receipt_file)} label="Receipt" /> : <Chip tone="red">Missing</Chip> },
          ]}
          expand={(p) => <Details items={[['Payee', p.payee || '—'], ['Method / ref', [p.method, p.ref].filter(Boolean).join(' · ') || '—'], ['Note', p.note || '—'], ['Recorded by', ctx.who(p.created_by_name, null)],
            ['Checked', p.checked_at ? `${ctx.who(p.checked_by_name, null)} · ${atMyt(p.checked_at)}` : '—'], ['Void', p.void_reason ? `${p.void_reason} (${ctx.who(p.void_by_name, null)})` : '—']]} />}
          actions={(p) => <Actions>{ctx.isHraUp && p.created_by !== ctx.profile?.id && p.status !== 'void' && <>
            {p.status !== 'verified' && <IconAction kind="approve" label="Checked against the receipt" onClick={() => run(() => qcall('qr_check_payment', { p_id: p.id, p_void: false }), 'Payment checked')} />}
            <IconAction kind="reject" label="Void this payment" onClick={() => setVoidP(p)} /></>}</Actions>}
          empty={<Empty title="No payments">Record levy, bond, VDR, agency, ticket and other payments with the receipt.</Empty>} />
      </Card>
      {form && <PaymentForm initial={form} onClose={() => setForm(null)} />}
      {voidP && <NoteAsk title={`Void ${payLabel(voidP.category)} ${rmFmt(voidP.amount_rm)}`} label="Reason" danger confirm="Void" onClose={() => setVoidP(null)} onOk={(n) => qcall('qr_check_payment', { p_id: voidP.id, p_void: true, p_reason: n })} />}
      {print && <Preview blocks={blocks} meta={meta} file={`recruitment-costs-${todayISO()}.pdf`} onClose={() => setPrint(false)} />}
    </div>
  )
}

export function PaymentForm({ initial, onClose }: { initial: V; onClose: () => void }) {
  const ctx = useQCtx()
  const d = useQuota()
  return (
    <QForm title="Record a payment" initial={initial} onClose={onClose}
      note={`Attach the receipt. Payments of ${rmFmt(d.rules.payment_check_rm)} or more are checked by a second person (HR Admin or above).`}
      fields={[
        { key: 'company_id', label: 'Company', type: 'select', required: true, options: companyOpts(ctx.companies), show: () => !initial.recruit_id },
        { key: 'category', label: 'Category', type: 'select', required: true, options: PAY_CATS.map((c) => ({ value: c.key, label: c.label })) },
        { key: 'amount_rm', label: 'Amount', type: 'money', required: true }, { key: 'paid_on', label: 'Paid on', type: 'date', required: true },
        { key: 'batch_id', label: 'Batch', type: 'select', options: [{ value: '', label: '—' }, ...d.batches.map((b) => ({ value: b.id, label: b.title }))], show: () => !initial.recruit_id },
        { key: 'quota_id', label: 'Approval letter (levy / bond)', type: 'select', options: [{ value: '', label: '—' }, ...d.quotas.filter((q) => q.status === 'active').map((q) => ({ value: q.id, label: q.ref_no }))], show: () => !initial.recruit_id },
        { key: 'country', label: 'Country', type: 'select', options: ['', ...COUNTRIES], show: () => !initial.recruit_id },
        { key: 'payee', label: 'Paid to' }, { key: 'method', label: 'Method', type: 'select', options: ['Bank transfer', 'FPX / online', 'Bank draft', 'Cheque', 'Cash', 'Card'] },
        { key: 'ref', label: 'Receipt / transaction ref' }, { key: 'note', label: 'Note', full: true },
      ]}
      onSave={(v) => {
        const p: V = {}; for (const [k, x] of Object.entries(v)) if (x !== '' && x != null) p[k] = x
        if (!(Number(p.amount_rm) > 0)) throw new Error('Enter the amount.')
        const b = d.batches.find((x) => x.id === p.batch_id); if (b && !p.country) p.country = b.country
        return qcall('qr_add_payment', { p })
      }}>
      {(v, set) => <FileField company={String(v.company_id || '')} kind="receipt" label="Receipt" value={v.receipt_file as string} onChange={(id) => set({ receipt_file: id })} />}
    </QForm>
  )
}
