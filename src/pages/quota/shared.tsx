/* Shared bits for the Approval & Recruitment pages. */
import { useMemo, useState, type ReactNode } from 'react'
import { Btn, Chip, FormGrid, Modal, type FieldDef } from '../../components/ui'
import { FilePick } from '../../components/filePick'
import { toast } from '../../components/toast'
import { useAuth } from '../../lib/auth'
import { useConfig } from '../../lib/config'
import { companyLogo, useLogoUrl } from '../../lib/logos'
import { isSampleCompany, outletCompany } from '../../lib/companies'
import { useOutlets } from '../../lib/hooks'
import { fileUrl, qRank, uploadQuotaFile, urLabel, useQuota, whoLabel, type QFile, type UseReq } from '../../lib/quota'
import { ROLE_LABEL } from '../../lib/workflow'
import { mytStamp } from '../../reports/format'
import type { SheetMeta } from '../../reports/Sheets'

export type V = Record<string, unknown>
export const s = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim()
export const n = (v: unknown) => (v === '' || v === undefined || v === null ? undefined : Number(v))

/** who am I in this module, and which companies may I pick */
export function useQCtx() {
  const auth = useAuth()
  const cfg = useConfig()
  const rank = qRank(auth.role)
  const outlets = useOutlets()
  // v1.4.2: same rule as the server (my_company_list / co_in_scope): CEO, GM and unlimited staff pick any company;
  // limited staff pick their companies plus the companies of their outlets (an outlet-only HR Manager used to get none
  // here and fell back to the built-in "Main company")
  const unscoped = rank >= 3 || auth.isSuper || auth.isGm || (!auth.myCompanies.length && !auth.myOutlets.length)
  const outletCos = new Set(outlets.filter((o) => auth.myOutlets.includes(o.id)).map((o) => outletCompany(o)))
  const companies = cfg.companies.items.filter((c) => !c.demo || isSampleCompany(c.id) || cfg.companies.items.length === 1)
    .filter((c) => unscoped || auth.myCompanies.includes(c.id) || outletCos.has(c.id))
  const cName = (id?: string | null) => cfg.companies.items.find((c) => c.id === id)?.name || id || ''
  const who = (name?: string | null, role?: string | null) => whoLabel(name, role, rank)
  return { ...auth, cfg, rank, companies, cName, who, urLabel: (st: UseReq['status']) => urLabel(st, rank), isCeo: rank >= 4, isGmUp: rank >= 3, isHraUp: rank >= 2 }
}
export const canSeeQuota = (role?: string | null) => qRank(role) > 0

/** run an action; a readable toast on error. Returns true on success. */
export async function run(fn: () => Promise<unknown>, ok?: string): Promise<boolean> {
  try { await fn(); if (ok) toast(ok); return true } catch (e) { toast((e as Error).message, 'err'); return false }
}

/** a form in a modal that stays open and shows the server's message if saving fails */
export function QForm({ title, fields, initial, onSave, onClose, children, wide, saveLabel = 'Save', note }: {
  title: string; fields: FieldDef[]; initial: V; onSave: (v: V) => Promise<unknown>; onClose: () => void
  children?: (v: V, set: (p: V) => void) => ReactNode; wide?: boolean; saveLabel?: string; note?: ReactNode
}) {
  const [v, setV] = useState<V>(initial)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    for (const f of fields) if (f.required && (!f.show || f.show(v)) && (v[f.key] === undefined || v[f.key] === '')) return setErr(`${f.label} is required`)
    setBusy(true); setErr(null)
    try { await onSave(v); onClose() } catch (x) { setErr((x as Error).message) } finally { setBusy(false) }
  }
  return (
    <Modal title={title} onClose={onClose} wide={wide}>
      <form onSubmit={submit}>
        {note && <div className="note-box" style={{ marginBottom: 12 }}>{note}</div>}
        <FormGrid fields={fields} value={v} onChange={setV} />
        {children?.(v, (p) => setV((c) => ({ ...c, ...p })))}
        {err && <p className="err" role="alert">{err}</p>}
        <div className="modal-actions"><span className="spacer" /><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" type="submit" icon="check" disabled={busy}>{busy ? 'Saving…' : saveLabel}</Btn></div>
      </form>
    </Modal>
  )
}

/** ask for a note (reject / return / void need one) */
export function NoteAsk({ title, label = 'Note', required = true, confirm = 'Confirm', onOk, onClose, danger }: { title: string; label?: string; required?: boolean; confirm?: string; onOk: (note: string) => Promise<unknown>; onClose: () => void; danger?: boolean }) {
  const [t, setT] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  return (
    <Modal title={title} onClose={onClose} footer={<><span className="spacer" /><Btn onClick={onClose}>Cancel</Btn>
      <Btn kind={danger ? 'danger' : 'primary'} icon="check" disabled={busy || (required && !t.trim())}
        onClick={async () => { setBusy(true); try { await onOk(t.trim()); onClose() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) } }}>{confirm}</Btn></>}>
      <label className="field full"><span className="qr-lbl">{label}{required && ' *'}</span><textarea rows={3} value={t} onChange={(e) => setT(e.target.value)} autoFocus /></label>
      {err && <p className="err" role="alert">{err}</p>}
    </Modal>
  )
}

/** upload a document into the permanent store; returns the file id */
export function FileField({ company, kind, value, onChange, label = 'Scanned copy', required }: { company: string; kind: string; value?: string | null; onChange: (id: string) => void; label?: string; required?: boolean }) {
  const { files } = useQuota()
  const [busy, setBusy] = useState(false)
  const f = files.find((x) => x.id === value)
  return (
    <div className="field full">
      <span className="qr-lbl">{label}{required && ' *'}</span>
      {f ? <div className="row-gap"><FileLink f={f} /><Chip tone="green">SHA-256 {f.sha256.slice(0, 10)}…</Chip></div>
        : <FilePick small disabled={busy || !company} name={label} onFiles={async (l) => {
          if (!company) return toast('Choose the company first.', 'err')
          setBusy(true)
          await run(async () => onChange(await uploadQuotaFile(company, kind, l[0])), 'Copy stored')
          setBusy(false)
        }} />}
      {busy && <small className="muted">Uploading and fingerprinting…</small>}
    </div>
  )
}
export function FileLink({ f, label }: { f?: QFile | null; label?: string }) {
  if (!f) return <span className="muted">—</span>
  return <a href="#" onClick={async (e) => { e.preventDefault(); await run(async () => window.open(await fileUrl(f), '_blank', 'noopener')) }}>{label || f.name || 'file'}</a>
}

/** A4 sheet header details for this module's printouts */
export function useSheetMeta(company: string | null | undefined, title: string, filters = '', landscape = false): SheetMeta {
  const { profile, role, cfg } = useQCtx()
  const logo = useLogoUrl(company ? companyLogo(company) : null)
  return useMemo(() => {
    const now = new Date()
    return {
      company: cfg.companies.items.find((c) => c.id === company)?.name || cfg.companies.items[0]?.name || 'FW Manager', logo, title, landscape, lang: 'en' as const,
      ref: `QR-${now.toLocaleString('sv-SE', { timeZone: 'Asia/Kuala_Lumpur' }).slice(0, 16).replace(/[-: ]/g, '')}`,
      filters, generated: mytStamp(now), by: `${profile?.full_name || profile?.email || 'User'} (${ROLE_LABEL[role || ''] || role})`,
    }
  }, [company, title, filters, landscape, logo, profile, role, cfg.companies.items])
}

export const RagDot = ({ rag }: { rag: 'red' | 'amber' | 'green' }) => <Chip tone={rag}>{rag === 'red' ? 'Red' : rag === 'amber' ? 'Amber' : 'Green'}</Chip>
export const companyOpts = (list: { id: string; name: string }[]) => list.map((c) => ({ value: c.id, label: c.name }))
