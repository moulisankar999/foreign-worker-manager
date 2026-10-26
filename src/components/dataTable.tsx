/* DataTable — the one list layout used across FW Manager.
 * Compact rows with the key columns; tap / click a row to open all its details inline.
 * Sortable headers, optional search + filters for long lists, header sticks under the top bar while the page scrolls.
 * Phones get fewer columns (hide: 'phone') and the row actions move into the opened row, so nothing scrolls sideways. */
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'

export interface Column<T> {
  key: string
  label: ReactNode
  render: (row: T) => ReactNode
  /** value used for sorting; give it to make the header sortable */
  sort?: (row: T) => string | number | null | undefined
  /** hide when the table is narrow: 'phone' (≤ 520 px), 'tablet' (≤ 760 px) or 'wide' (≤ 900 px, e.g. a long note that is also in the opened row) */
  hide?: 'phone' | 'tablet' | 'wide'
  align?: 'right' | 'center'
  /** CSS width, e.g. '30%' or '8rem' */
  width?: string
  /** the main column: never hidden, wraps, gets the chevron */
  main?: boolean
}
export interface Filter<T> { key: string; label: string; options: (string | { value: string; label: string })[]; match: (row: T, value: string) => boolean }

// keep the sticky header just below the top bar (its height changes with safe areas and font size)
let topWatch = false
function watchTopBar() {
  if (topWatch || typeof window === 'undefined') return
  topWatch = true
  const set = () => {
    const top = document.querySelector('.top') as HTMLElement | null
    document.documentElement.style.setProperty('--top-h', `${top ? Math.round(top.getBoundingClientRect().height) : 0}px`)
  }
  set()
  const ro = 'ResizeObserver' in window ? new ResizeObserver(set) : null
  const hook = () => { const t = document.querySelector('.top'); if (t && ro) ro.observe(t); else setTimeout(hook, 500) }
  hook(); window.addEventListener('resize', set)
}

const isInteractive = (t: EventTarget | null, stop: HTMLElement) => {
  let n = t as HTMLElement | null
  if (!n || !stop.contains(n)) return true // clicks inside a dialog opened from the row (portal) never toggle it
  while (n && n !== stop) {
    if (/^(BUTTON|A|INPUT|SELECT|TEXTAREA|LABEL|SUMMARY)$/.test(n.tagName) || n.getAttribute('role') === 'button' || n.dataset.noexpand !== undefined) return true
    n = n.parentElement
  }
  return false
}

export function DataTable<T>({
  rows, rowKey, columns, expand, actions, search, searchLabel = 'Search', filters, initialSort, empty, rowClass, rowTestId, rowId,
  label, className, searchFrom = 8, pageSize = 50, open: openReq, onOpenChange, dense, canExpand,
}: {
  rows: T[]
  rowKey: (r: T) => string
  columns: Column<T>[]
  /** details shown when the row is opened (stays mounted after the first open, so unsaved edits are kept) */
  expand?: (r: T) => ReactNode
  /** icon actions for the row (use <IconAction>); on phones they show inside the opened row */
  actions?: (r: T) => ReactNode
  /** text to search in; shows a search box once the list has `searchFrom` rows */
  search?: (r: T) => string
  searchLabel?: string
  filters?: Filter<T>[]
  initialSort?: { key: string; dir: 'asc' | 'desc' }
  empty?: ReactNode
  rowClass?: (r: T) => string
  rowTestId?: (r: T) => string
  rowId?: (r: T) => string
  /** accessible name of the table */
  label: string
  className?: string
  searchFrom?: number
  pageSize?: number
  /** open (and scroll to) this row — pass a new object each time, e.g. after "Add" found an existing record */
  open?: { key: string } | null
  /** rows that have nothing more to show */
  canExpand?: (r: T) => boolean
  onOpenChange?: (key: string, open: boolean) => void
  dense?: boolean
}) {
  useEffect(watchTopBar, [])
  const [q, setQ] = useState('')
  const [fv, setFv] = useState<Record<string, string>>({})
  const [sort, setSort] = useState(initialSort || null)
  const [open, setOpen] = useState<Set<string>>(() => new Set(openReq ? [openReq.key] : []))
  const [seen, setSeen] = useState<Set<string>>(() => new Set(openReq ? [openReq.key] : []))
  const [limit, setLimit] = useState(pageSize)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!openReq) return
    const k = openReq.key
    setOpen((o) => new Set(o).add(k)); setSeen((o) => new Set(o).add(k))
    setTimeout(() => root.current?.querySelector(`tr[data-key="${CSS.escape(k)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120)
  }, [openReq])
  const toggle = (k: string) => {
    const now = !open.has(k)
    setOpen((o) => { const n = new Set(o); if (now) n.add(k); else n.delete(k); return n })
    if (now) setSeen((o) => new Set(o).add(k))
    onOpenChange?.(k, now)
  }
  const showSearch = !!search && rows.length >= searchFrom
  const showFilters = !!filters?.length && rows.length >= searchFrom
  const shown = useMemo(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    let r = rows.filter((x) => (!terms.length || !search || terms.every((t) => search(x).toLowerCase().includes(t))) &&
      (filters || []).every((f) => !fv[f.key] || f.match(x, fv[f.key])))
    const col = sort && columns.find((c) => c.key === sort.key)
    if (col?.sort) {
      const get = col.sort, dir = sort!.dir === 'asc' ? 1 : -1
      r = [...r].sort((a, b) => {
        const va = get(a), vb = get(b)
        if (va === vb) return 0
        if (va === null || va === undefined || va === '') return 1
        if (vb === null || vb === undefined || vb === '') return -1
        return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' })) * dir
      })
    }
    return r
  }, [rows, q, fv, sort, columns, search, filters])
  const visible = shown.slice(0, limit)
  const hasExpand = !!expand || !!actions
  const nCols = columns.length + (actions ? 1 : 0) + (hasExpand ? 1 : 0)
  const hideCls = (c: Column<T>) => (c.hide ? ` dt-h-${c.hide}` : '')
  return (
    <div ref={root} className={`dt${dense ? ' dt-dense' : ''}${className ? ' ' + className : ''}`}>
      {(showSearch || showFilters) && (
        <div className="dt-tools">
          {showSearch && <div className="dt-search"><Icon name="search" size={16} /><input type="search" value={q} onChange={(e) => { setQ(e.target.value); setLimit(pageSize) }} placeholder={searchLabel + '…'} aria-label={searchLabel} /></div>}
          {showFilters && filters!.map((f) => (
            <select key={f.key} value={fv[f.key] || ''} aria-label={f.label} onChange={(e) => { setFv({ ...fv, [f.key]: e.target.value }); setLimit(pageSize) }}>
              <option value="">{f.label}: All</option>
              {f.options.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
            </select>
          ))}
          {(q || Object.values(fv).some(Boolean)) && <span className="small muted">{shown.length} of {rows.length}</span>}
        </div>
      )}
      {shown.length === 0 ? (empty ?? <p className="muted small dt-empty">{rows.length ? 'Nothing matches.' : 'Nothing here yet.'}</p>) : (
        <table className="dt-t" aria-label={label}>
          <colgroup>
            {columns.map((c) => <col key={c.key} className={hideCls(c).trim() || undefined} style={c.width ? { width: c.width } : undefined} />)}
            {actions && <col className="dt-h-phone dt-c-act" />}
            {hasExpand && <col className="dt-c-chev" />}
          </colgroup>
          <thead>
            <tr>
              {columns.map((c) => {
                const on = sort?.key === c.key
                return (
                  <th key={c.key} scope="col" className={`${hideCls(c)}${c.align ? ' dt-' + c.align : ''}`.trim() || undefined} aria-sort={on ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {c.sort ? (
                      <button type="button" className={`dt-sort${on ? ' on' : ''}`} onClick={() => setSort(on && sort!.dir === 'asc' ? { key: c.key, dir: 'desc' } : on ? null : { key: c.key, dir: 'asc' })}>
                        {c.label}<Icon name={on ? (sort!.dir === 'asc' ? 'sortup' : 'sortdown') : 'sort'} size={13} />
                      </button>
                    ) : c.label}
                  </th>
                )
              })}
              {actions && <th scope="col" className="dt-h-phone dt-act-h"><span className="sr">Actions</span></th>}
              {hasExpand && <th scope="col" className="dt-chev-h"><span className="sr">Details</span></th>}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const k = rowKey(r)
              const isOpen = open.has(k)
              const act = actions?.(r)
              const ex = hasExpand && (!canExpand || canExpand(r))
              return (
                <Fragment key={k}>
                  <tr id={rowId?.(r)} data-testid={rowTestId?.(r)} data-key={k}
                    className={`dt-r${ex ? ' dt-click' : ''}${isOpen ? ' dt-open' : ''}${rowClass ? ' ' + rowClass(r) : ''}`}
                    onClick={ex ? (e) => { if (!isInteractive(e.target, e.currentTarget)) toggle(k) } : undefined}>
                    {columns.map((c) => <td key={c.key} className={`${hideCls(c)}${c.align ? ' dt-' + c.align : ''}${c.main ? ' dt-main' : ''}`.trim() || undefined}>{c.render(r)}</td>)}
                    {actions && <td className="dt-h-phone dt-act">{act}</td>}
                    {hasExpand && !ex && <td className="dt-chev" />}
                    {ex && (
                      <td className="dt-chev">
                        <button type="button" className="dt-xbtn" aria-expanded={isOpen} aria-label={isOpen ? 'Hide details' : 'Show details'} title={isOpen ? 'Hide details' : 'Show details'} onClick={() => toggle(k)}>
                          <Icon name="chev" size={18} />
                        </button>
                      </td>
                    )}
                  </tr>
                  {ex && seen.has(k) && (
                    <tr className="dt-x" hidden={!isOpen}>
                      <td colSpan={nCols}>
                        {act && <div className="dt-x-act dt-only-phone">{act}</div>}
                        {expand?.(r)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      )}
      {shown.length > limit && <button type="button" className="btn btn-secondary btn-s dt-more" onClick={() => setLimit(limit + pageSize)}>Show {Math.min(pageSize, shown.length - limit)} more ({shown.length - limit} left)</button>}
    </div>
  )
}

/** label / value grid used inside an opened row */
export function Details({ items }: { items: [ReactNode, ReactNode][] }) {
  const list = items.filter(([, v]) => v !== undefined && v !== null && v !== false && v !== '')
  return (
    <dl className="dt-kv">
      {list.map(([k, v], i) => <div key={i}><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
  )
}
