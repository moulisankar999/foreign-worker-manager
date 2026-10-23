/* Worker remittance accounts (Merchantrade, Western Union, ...). No money moves through this app:
   HR records where the worker sends money, and "Open provider" goes to the provider's official site/app.
   PDPA: the whole `remittance` key is only sent to CEO / HR Admin / HR Manager (server strips it for others,
   migration 009); account numbers are masked in lists. */
import { useState } from 'react'
import { Btn, Card, Chip, Empty, FormModal, type FieldDef } from './ui'
import { RELATIONS, type RemitRec, type Worker } from '../lib/types'
import { saveWorker } from '../lib/db'
import { uid } from '../lib/util'

export const REMIT_PROVIDERS: { name: string; url: string; kind: string }[] = [
  { name: 'Merchantrade', url: 'https://www.merchantrade.com/', kind: 'Money transfer / eWallet' },
  { name: 'Western Union', url: 'https://www.westernunion.com/my/en/home.html', kind: 'Money transfer' },
  { name: 'MoneyGram', url: 'https://www.moneygram.com/', kind: 'Money transfer' },
  { name: 'Tranglo / Sendmoney', url: 'https://www.tranglo.com/', kind: 'Money transfer' },
  { name: 'BigPay', url: 'https://www.bigpayme.com/', kind: 'eWallet / card' },
  { name: 'Wise', url: 'https://wise.com/my/', kind: 'Money transfer' },
  { name: 'Instarem', url: 'https://www.instarem.com/', kind: 'Money transfer' },
  { name: 'CIMB SpeedSend', url: 'https://www.cimb.com.my/en/personal/day-to-day-banking/remittance/speedsend.html', kind: 'Bank remittance' },
  { name: 'Maybank Overseas Transfer', url: 'https://www.maybank2u.com.my/', kind: 'Bank remittance' },
  { name: 'Valyou', url: 'https://www.valyou.com.my/', kind: 'Money transfer / eWallet' },
  { name: 'Other', url: '', kind: '' },
]
export const REMIT_COUNTRIES = ['Nepal', 'Bangladesh', 'Myanmar', 'Indonesia', 'India', 'Pakistan', 'Sri Lanka', 'Vietnam', 'Philippines', 'Thailand', 'Cambodia', 'Other']
export const providerUrl = (p: string) => REMIT_PROVIDERS.find((x) => x.name === p)?.url || ''
export const providerName = (r: RemitRec) => (r.provider === 'Other' ? r.providerOther || 'Other' : r.provider)
/** "•••• 6789" — never show the full number in lists */
export function maskAcct(s?: string) {
  const t = (s || '').replace(/\s/g, '')
  if (!t) return '—'
  return t.length <= 4 ? '••••' : `•••• ${t.slice(-4)}`
}
export const REMIT_FIELDS: FieldDef[] = [
  { key: 'provider', label: 'Provider', type: 'select', options: REMIT_PROVIDERS.map((p) => p.name), required: true },
  { key: 'providerOther', label: 'Provider name', show: (v) => v.provider === 'Other', placeholder: 'e.g. local bank / agent' },
  { key: 'memberId', label: 'Worker’s account / member ID', hint: 'The ID the worker uses with this provider (e.g. Merchantrade member no.)' },
  { key: 'beneficiaryName', label: 'Beneficiary name' },
  { key: 'relationship', label: 'Relationship', type: 'select', options: RELATIONS },
  { key: 'country', label: 'Beneficiary country', type: 'select', options: REMIT_COUNTRIES },
  { key: 'bankOrWallet', label: 'Beneficiary bank / wallet', placeholder: 'e.g. Nabil Bank, bKash, eSewa, BCA' },
  { key: 'accountNo', label: 'Beneficiary account / wallet no.', hint: 'Shown masked in lists; visible only to HR and CEO' },
  { key: 'isPrimary', label: 'Main account the worker uses', type: 'checkbox' },
  { key: 'notes', label: 'Notes', type: 'textarea' },
]
export const PAY_NOTE = 'This app does not send money. Transfers are made by the worker (or HR) in the provider’s own app or counter — use “Open provider”.'

function OpenProvider({ r }: { r: RemitRec }) {
  const url = providerUrl(r.provider)
  if (!url) return null
  return <a className="btn btn-s" href={url} target="_blank" rel="noopener noreferrer" title={`Open ${r.provider} official site`}>Open provider ↗</a>
}

/** read-only list with masked numbers; reveal toggle per row */
export function RemitList({ list, onEdit }: { list: RemitRec[]; onEdit?: (r: RemitRec) => void }) {
  const [show, setShow] = useState<Record<string, boolean>>({})
  if (!list.length) return <Empty title="No remittance account recorded" />
  return (
    <ul className="remit-list">
      {list.map((r, i) => (
        <li key={r.id} className="remit-item">
          <div className="remit-h">
            <span className="doc-no">{i + 1}.</span>
            <strong>{providerName(r)}</strong>
            {r.isPrimary && <Chip tone="green">Main</Chip>}
            <span className="spacer" />
            <OpenProvider r={r} />
            {onEdit && <Btn small kind="ghost" icon="edit" title="Edit" onClick={() => onEdit(r)} />}
          </div>
          <dl className="doc-dl">
            <div><dt>Member / account ID</dt><dd>{r.memberId || '—'}</dd></div>
            <div><dt>Beneficiary</dt><dd>{r.beneficiaryName || '—'}{r.relationship ? ` (${r.relationship})` : ''}</dd></div>
            <div><dt>Country</dt><dd>{r.country || '—'}</dd></div>
            <div><dt>Bank / wallet</dt><dd>{r.bankOrWallet || '—'}</dd></div>
            <div><dt>Account no.</dt><dd className="mono">{show[r.id] ? r.accountNo || '—' : maskAcct(r.accountNo)}
              {!!r.accountNo && <button type="button" className="link small ml-s" onClick={() => setShow({ ...show, [r.id]: !show[r.id] })}>{show[r.id] ? 'Hide' : 'Show'}</button>}</dd></div>
          </dl>
          {r.notes && <small className="muted">{r.notes}</small>}
        </li>
      ))}
    </ul>
  )
}

/** worker detail tab (HR / CEO only) */
export function RemittanceTab({ w }: { w: Worker }) {
  const [edit, setEdit] = useState<Partial<RemitRec> | null>(null)
  const list = w.remittance || []
  const save = async (r: RemitRec | null, delId?: string) => {
    let next = list.filter((x) => x.id !== (delId || r?.id))
    if (r) {
      const idx = list.findIndex((x) => x.id === r.id)
      next = idx >= 0 ? list.map((x) => (x.id === r.id ? r : x)) : [...list, r]
      if (r.isPrimary) next = next.map((x) => (x.id === r.id ? x : { ...x, isPrimary: false }))
    }
    await saveWorker({ ...w, remittance: next })
  }
  return (
    <Card title="💸 Remittance" actions={<Btn kind="primary" small icon="plus" onClick={() => setEdit({ provider: 'Merchantrade', country: w.nationality, isPrimary: !list.length })}>Add</Btn>}>
      <p className="banner blue small" role="note">ℹ️ {PAY_NOTE}</p>
      <RemitList list={list} onEdit={setEdit} />
      <p className="muted small">🔒 Visible only to CEO, HR Admin and HR Manager (personal data, PDPA). Outlet managers never receive these details.</p>
      {edit && (
        <FormModal title={edit.id ? 'Edit remittance account' : 'Add remittance account'} fields={REMIT_FIELDS} initial={edit as Record<string, unknown>}
          onClose={() => setEdit(null)} onDelete={edit.id ? () => save(null, edit.id) : undefined}
          validate={(v) => (v.provider === 'Other' && !String(v.providerOther || '').trim() ? 'Type the provider name' : null)}
          onSave={(v) => save({ ...(v as unknown as RemitRec), id: (edit.id as string) || uid(), accountNo: String(v.accountNo || '').replace(/\s+/g, ' ').trim() || undefined })} />
      )}
    </Card>
  )
}

/** inline editor used inside the Add/Edit worker stepper */
export function RemitEditor({ list, onChange }: { list: RemitRec[]; onChange: (l: RemitRec[]) => void }) {
  const [edit, setEdit] = useState<Partial<RemitRec> | null>(null)
  return (
    <section className="remit-section mt-s" aria-label="Remittance">
      <div className="row gap-s"><h3 className="h-sub">💸 Remittance (optional)</h3><span className="spacer" />
        <Btn small icon="plus" onClick={() => setEdit({ provider: 'Merchantrade', isPrimary: !list.length })}>Add account</Btn></div>
      <p className="muted small">{PAY_NOTE}</p>
      {list.length > 0 && <RemitList list={list} onEdit={setEdit} />}
      {edit && (
        <FormModal title={edit.id ? 'Edit remittance account' : 'Add remittance account'} fields={REMIT_FIELDS} initial={edit as Record<string, unknown>}
          onClose={() => setEdit(null)} onDelete={edit.id ? () => onChange(list.filter((x) => x.id !== edit.id)) : undefined}
          validate={(v) => (v.provider === 'Other' && !String(v.providerOther || '').trim() ? 'Type the provider name' : null)}
          onSave={(v) => {
            const r = { ...(v as unknown as RemitRec), id: (edit.id as string) || uid() }
            let next = list.some((x) => x.id === r.id) ? list.map((x) => (x.id === r.id ? r : x)) : [...list, r]
            if (r.isPrimary) next = next.map((x) => (x.id === r.id ? x : { ...x, isPrimary: false }))
            onChange(next)
          }} />
      )}
    </section>
  )
}
