import { useEffect, useId, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import { fmtDate } from '../lib/util'
import { PhoneInput } from './phoneInput'
import { fmtMoneyInput, moneyIssue, parseMoney, type Issue, type Issues } from '../lib/validate'

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-h">
          {title && <h3>{title}</h3>}
          {actions && <div className="row gap-s">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

export function Chip({ tone = 'gray', children }: { tone?: string; children: ReactNode }) {
  return <span className={`chip chip-${tone}`}>{children}</span>
}

export const docTone = (s: string) => ({ Valid: 'green', 'Expiring soon': 'amber', Expired: 'red', 'No expiry': 'gray' })[s] || 'gray'
export const sevTone = (s: string) => ({ critical: 'red', high: 'orange', medium: 'amber', low: 'blue', info: 'gray' })[s] || 'gray'
export const statusTone = (s: string) =>
  s === 'Active-Working' ? 'green' : ['On Leave', 'Home Leave', 'Medical Leave'].includes(s) ? 'blue' : s === 'Absconded' ? 'red' : 'gray'

export function Btn({ children, onClick, kind = 'secondary', icon, type = 'button', disabled, small, title }: {
  children?: ReactNode; onClick?: () => void; kind?: 'primary' | 'secondary' | 'danger' | 'ghost'; icon?: string; type?: 'button' | 'submit'; disabled?: boolean; small?: boolean; title?: string
}) {
  return (
    <button type={type} className={`btn btn-${kind}${small ? ' btn-s' : ''}`} onClick={onClick} disabled={disabled} title={title} aria-label={title}>
      {icon && <Icon name={icon} size={small ? 16 : 18} />}
      {children && <span>{children}</span>}
    </button>
  )
}

export type FieldType = 'text' | 'date' | 'number' | 'select' | 'textarea' | 'checkbox' | 'tel' | 'email' | 'money' | 'phone' | 'upper'
export interface FieldDef { key: string; label: string; type?: FieldType; options?: string[] | { value: string; label: string }[]; required?: boolean; placeholder?: string; full?: boolean; hint?: string; show?: (v: Record<string, unknown>) => boolean; defaultCc?: string; max?: string }

function MoneyInput({ id, value, onChange, required, placeholder }: { id: string; value: unknown; onChange: (v: unknown) => void; required?: boolean; placeholder?: string }) {
  const [txt, setTxt] = useState<string | null>(null)
  return (
    <div className="money-in">
      <span className="money-pre" aria-hidden="true">RM</span>
      <input id={id} type="text" inputMode="decimal" autoComplete="off" required={required} placeholder={placeholder || '0.00'}
        value={txt ?? fmtMoneyInput(value)}
        onFocus={() => setTxt(value === undefined || value === null || value === '' ? '' : String(value))}
        onChange={(e) => { const t = e.target.value.replace(/[^\d.,-]/g, ''); setTxt(t); onChange(parseMoney(t)) }}
        onBlur={() => setTxt(null)} />
    </div>
  )
}

export function Field({ def, value, onChange, issue, missing }: { def: FieldDef; value: unknown; onChange: (v: unknown) => void; issue?: Issue; missing?: boolean }) {
  const id = useId()
  const t = def.type || 'text'
  if (t === 'checkbox')
    return (
      <label className={`check ${def.full ? 'full' : ''}`}>
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> <span>{def.label}</span>
      </label>
    )
  return (
    <div className={`field ${def.full || t === 'textarea' ? 'full' : ''} ${missing ? 'is-missing' : ''} ${issue ? `is-${issue.level}` : ''}`}>
      <label htmlFor={id}>
        {def.label}
        {def.required && <span className="req"> *</span>}
      </label>
      {t === 'select' ? (
        <select id={id} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} required={def.required}>
          <option value="">— Select —</option>
          {(def.options || []).map((o) => (typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
        </select>
      ) : t === 'money' ? (
        <MoneyInput id={id} value={value} onChange={onChange} required={def.required} placeholder={def.placeholder} />
      ) : t === 'phone' ? (
        <PhoneInput id={id} value={value as string | undefined} onChange={onChange} defaultCc={def.defaultCc} />
      ) : t === 'upper' ? (
        <input id={id} type="text" autoCapitalize="characters" autoComplete="off" spellCheck={false} value={String(value ?? '')} placeholder={def.placeholder}
          onChange={(e) => onChange(e.target.value.toUpperCase().replace(/[^A-Z0-9/-]/g, ''))} />
      ) : t === 'textarea' ? (
        <textarea id={id} rows={3} value={String(value ?? '')} placeholder={def.placeholder} onChange={(e) => onChange(e.target.value)} required={def.required} />
      ) : (
        <input
          id={id} type={t} max={def.max} inputMode={t === 'number' ? 'decimal' : undefined} step={t === 'number' ? 'any' : undefined}
          value={value === undefined || value === null ? '' : String(value)} placeholder={def.placeholder} required={def.required}
          onChange={(e) => onChange(t === 'number' ? (e.target.value === '' ? undefined : Number(e.target.value)) : e.target.value)}
        />
      )}
      {issue ? <small className={`fmsg ${issue.level}`} role={issue.level === 'error' ? 'alert' : undefined}>{issue.level === 'error' ? '⛔ ' : '⚠️ '}{issue.msg}</small>
        : missing ? <small className="fmsg missing">Required to complete the profile</small> : null}
      {def.hint && <small className="hint">{def.hint}</small>}
    </div>
  )
}

export function FormGrid({ fields, value, onChange, issues, missing }: { fields: FieldDef[]; value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void; issues?: Issues; missing?: Set<string> }) {
  return (
    <div className="grid-form">
      {fields.filter((f) => !f.show || f.show(value)).map((f) => (
        <Field key={f.key} def={f} value={value[f.key]} issue={issues?.[f.key]} missing={missing?.has(f.key)} onChange={(v) => onChange({ ...value, [f.key]: v })} />
      ))}
    </div>
  )
}

export function Modal({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    document.body.classList.add('modal-open')
    return () => { window.removeEventListener('keydown', h); document.body.classList.remove('modal-open') }
  }, [onClose])
  // Portal to <body>: a modal opened from the sticky top bar (backdrop-filter) was positioned against the bar and cut off.
  return createPortal(
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <header className="modal-h">
          <h3>{title}</h3>
          <Btn kind="ghost" icon="x" onClick={onClose} title="Close" />
        </header>
        <div className="modal-b">{children}</div>
        {footer && <footer className="modal-f">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}

export function FormModal({ title, fields, initial, onSave, onClose, onDelete, children, validate }: {
  title: string; fields: FieldDef[]; initial: Record<string, unknown>; onSave: (v: Record<string, unknown>) => void | Promise<void>; onClose: () => void; onDelete?: () => void; children?: (v: Record<string, unknown>, set: (p: Record<string, unknown>) => void) => ReactNode; validate?: (v: Record<string, unknown>) => string | null
}) {
  const [v, setV] = useState(initial)
  const [err, setErr] = useState<string | null>(null)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    for (const f of fields) if (f.required && (!f.show || f.show(v)) && (v[f.key] === undefined || v[f.key] === '')) return setErr(`${f.label} is required`)
    for (const f of fields) if (f.type === 'money' && (!f.show || f.show(v))) { const mi = moneyIssue(v[f.key], f.label); if (mi) return setErr(mi.msg) }
    const msg = validate?.(v)
    if (msg) return setErr(msg)
    await onSave(v)
    onClose()
  }
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit}>
        <FormGrid fields={fields} value={v} onChange={setV} />
        {children?.(v, (p) => setV((cur) => ({ ...cur, ...p })))}
        {err && <p className="err" role="alert">{err}</p>}
        <div className="modal-actions">
          {onDelete && <Btn kind="danger" icon="trash" onClick={() => { if (confirm('Delete this record?')) { onDelete(); onClose() } }}>Delete</Btn>}
          <span className="spacer" />
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" type="submit" icon="check">Save</Btn>
        </div>
      </form>
    </Modal>
  )
}

export function Empty({ icon = 'doc', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={36} />
      <p className="empty-t">{title}</p>
      {children}
    </div>
  )
}

export function Stat({ label, value, tone = 'teal', icon, onClick, sub }: { label: string; value: ReactNode; tone?: string; icon?: string; onClick?: () => void; sub?: string }) {
  return (
    <button type="button" className={`stat stat-${tone}`} onClick={onClick} disabled={!onClick}>
      {icon && <span className="stat-i"><Icon name={icon} size={18} /></span>}
      <span className="stat-v">{value}</span>
      <span className="stat-l">{label}</span>
      {sub && <span className="stat-s">{sub}</span>}
    </button>
  )
}

export function BarList({ data, onClick }: { data: { label: string; value: number; tone?: string }[]; onClick?: (label: string) => void }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  if (!data.length) return <p className="muted small">No data yet</p>
  return (
    <ul className="barlist">
      {data.map((d) => (
        <li key={d.label} onClick={onClick ? () => onClick(d.label) : undefined} className={onClick ? 'clickable' : ''}>
          <span className="bl-l">{d.label}</span>
          <span className="bl-bar"><span className={`bl-fill tone-${d.tone || 'teal'}`} style={{ width: `${(d.value / max) * 100}%` }} /></span>
          <span className="bl-v">{d.value}</span>
        </li>
      ))}
    </ul>
  )
}

export function ColumnChart({ data }: { data: { label: string; value: number; parts?: { value: number; tone: string }[] }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <div className="colchart" role="img" aria-label="Upcoming expiries by month">
      {data.map((d) => (
        <div key={d.label} className="col">
          <span className="col-v">{d.value || ''}</span>
          <div className="col-bar" style={{ height: `${(d.value / max) * 100}%` }}>
            {(d.parts || [{ value: d.value, tone: 'teal' }]).map((p, i) => <span key={i} className={`tone-${p.tone}`} style={{ flex: p.value }} />)}
          </div>
          <span className="col-l">{d.label}</span>
        </div>
      ))}
    </div>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; badge?: number }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={value === t.id ? 'on' : ''} onClick={() => onChange(t.id)}>
          {t.label}
          {!!t.badge && <span className="tab-b">{t.badge}</span>}
        </button>
      ))}
    </div>
  )
}

export function KV({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v === undefined || v === null || v === '' ? '—' : v}</dd>
        </div>
      ))}
    </dl>
  )
}

export const D = ({ d }: { d?: string }) => <>{fmtDate(d)}</>

export function Avatar({ name, photo, size = 44 }: { name: string; photo?: string; size?: number }) {
  return photo ? (
    <img className="avatar" src={photo} alt="" width={size} height={size} />
  ) : (
    <span className="avatar avatar-i" style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">
      {name.replace(/^DEMO\s+/, '').split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase()}
    </span>
  )
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="toolbar">{children}</div>
}

export function SelectFilter({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: (string | { value: string; label: string })[] }) {
  return (
    <label className="sel-f">
      <span className="sr">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        <option value="">{label}: All</option>
        {options.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
      </select>
    </label>
  )
}
