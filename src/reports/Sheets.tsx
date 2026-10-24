import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { isNumFmt, show, tr, type Lang } from './format'
import type { Block, Col, Row } from './types'

/** Everything printed in the page header / footer and the signature block. */
export interface SheetMeta {
  company: string
  logo?: string | null
  title: string
  ref: string
  filters: string
  generated: string // "24 Oct 2026, 08:15 MYT"
  by: string // "Name (Role)"
  landscape?: boolean
  lang: Lang
  band?: string // required-submission line
  signs?: Partial<Record<'prepared' | 'verified' | 'reviewed' | 'approved', { name: string; date: string }>>
}

const MM = 96 / 25.4
/** A4 in mm: 12 mm margins, 30 mm header, 12 mm footer */
export const dims = (landscape?: boolean) => {
  const w = landscape ? 297 : 210, h = landscape ? 210 : 297
  return { w, h, bodyW: w - 24, bodyH: h - 24 - 30 - 12 }
}

type TRow = { t: 'g'; label: string } | { t: 'r'; row: Row; z: boolean } | { t: 'tot'; row: Row }
type Piece =
  | { k: 'block'; b: Block; i: number }
  | { k: 'table'; b: Extract<Block, { kind: 'table' }>; i: number; rows: TRow[]; first: boolean }

function tableRows(b: Extract<Block, { kind: 'table' }>): TRow[] {
  const out: TRow[] = []
  let g: string | undefined, z = false
  for (const r of b.rows) {
    if (b.groupBy) {
      const v = String(r[b.groupBy] ?? '—')
      if (v !== g) { g = v; z = false; const n = b.rows.filter((x) => String(x[b.groupBy!] ?? '—') === v).length; out.push({ t: 'g', label: b.groupLabel ? b.groupLabel(v, n) : `${v} (${n})` }) }
    }
    out.push({ t: 'r', row: r, z }); z = !z
  }
  if (b.totals && b.rows.length) out.push({ t: 'tot', row: b.totals })
  return out
}

/* ---------- block renderers ---------- */
function Table({ b, rows, first }: { b: Extract<Block, { kind: 'table' }>; rows: TRow[]; first: boolean }) {
  const tw = b.cols.reduce((t, c) => t + (c.w || 10), 0)
  return (
    <div className="rpt-blk">
      {b.title && <div className="rpt-ttl">{b.title}{first ? '' : ' (cont.)'}</div>}
      <table className="rpt-tbl">
        <colgroup>{b.cols.map((c) => <col key={c.key} style={{ width: `${((c.w || 10) / tw) * 100}%` }} />)}</colgroup>
        <thead><tr>{b.cols.map((c) => <th key={c.key} className={isNumFmt(c.fmt) ? 'n' : ''}>{c.label}</th>)}</tr></thead>
        <tbody>
          {!b.rows.length && <tr><td colSpan={b.cols.length} className="rpt-empty">{b.empty || 'No records'}</td></tr>}
          {rows.map((r, i) => <TR key={i} r={r} cols={b.cols} />)}
        </tbody>
      </table>
      {b.note && rows.some((r) => r.t === 'tot') && <p className="rpt-tnote">{b.note}</p>}
    </div>
  )
}
function TR({ r, cols }: { r: TRow; cols: Col[] }) {
  if (r.t === 'g') return <tr className="rpt-g"><td colSpan={cols.length}>{r.label}</td></tr>
  const row = r.row
  const cls = r.t === 'tot' ? 'rpt-tot' : [r.z ? 'z' : '', row._tone ? 't-' + row._tone : ''].join(' ')
  return <tr className={cls}>{cols.map((c) => <td key={c.key} className={(isNumFmt(c.fmt) ? 'n' : c.fmt === 'date' ? 'd' : '') + (c.wrap ? ' w' : '')}>{show(row[c.key], c.fmt)}</td>)}</tr>
}

function BlockView({ b, meta }: { b: Block; meta: SheetMeta }): ReactNode {
  switch (b.kind) {
    case 'kpis': return <div className="rpt-blk rpt-kpis">{b.items.map((k, i) => <div key={i} className={'rpt-kpi ' + (k.tone ? 't-' + k.tone : '')}><span>{k.label}</span><b>{k.value}</b>{k.sub && <small>{k.sub}</small>}</div>)}</div>
    case 'fields': return (
      <div className="rpt-blk">
        {b.title && <div className="rpt-ttl">{b.title}</div>}
        <div className="rpt-fields" style={{ gridTemplateColumns: `repeat(${b.cols || 3}, 1fr)` }}>{b.items.map(([l, v], i) => <div key={i}><span>{l}</span><b>{show(v)}</b></div>)}</div>
      </div>
    )
    case 'note': return <div className={'rpt-blk rpt-note ' + (b.tone ? 't-' + b.tone : '')}>{b.text}</div>
    case 'heading': return <div className="rpt-blk rpt-h"><b>{b.text}</b>{b.sub && <span>{b.sub}</span>}</div>
    case 'person': return (
      <div className="rpt-blk rpt-person">
        {b.photo ? <img src={b.photo} alt="" /> : <div className="rpt-ph">{b.name.slice(0, 1)}</div>}
        <div><b>{b.name}</b>{b.lines.map((l, i) => <div key={i}>{l}</div>)}</div>
        {b.badge && <span className={'rpt-badge t-' + (b.tone || 'gray')}>{b.badge}</span>}
      </div>
    )
    case 'signatures': return <Signatures meta={meta} />
    case 'table': return <Table b={b} rows={tableRows(b)} first />
    default: return null
  }
}

export function Signatures({ meta }: { meta: SheetMeta }) {
  const L = (s: string) => tr(s, meta.lang)
  const boxes: [string, string, keyof NonNullable<SheetMeta['signs']>][] = [['Prepared by', 'HR Manager', 'prepared'], ['Verified by', 'HR Admin', 'verified'], ['Reviewed by', 'General Manager', 'reviewed'], ['Approved by', 'Chief Executive Officer', 'approved']]
  return (
    <div className="rpt-blk rpt-sign">
      <p className="rpt-decl">I confirm this report is complete and correct to the best of my knowledge, and was checked against the records in FW Manager.</p>
      <div className="rpt-sgrid">
        {boxes.map(([h, role, k]) => { const s = meta.signs?.[k]; return (
          <div key={k} className="rpt-sbox">
            <div className="rpt-sh">{L(h)}<small>{role}</small></div>
            <div className="rpt-sline"><span>{L('Signature')}</span></div>
            <div className="rpt-sf"><span>{L('Name')}</span><b>{s?.name || ''}</b></div>
            <div className="rpt-sf"><span>{L('Date')}</span><b>{s?.date || ''}</b></div>
          </div>) })}
      </div>
      <div className="rpt-sfoot">
        <div className="rpt-stamp">{L('Company stamp')}</div>
        <div className="rpt-filing"><div className="rpt-sh">{L('Filing record')}</div>
          <div className="rpt-sf"><span>File no.</span><b /></div><div className="rpt-sf"><span>Filed on</span><b /></div><div className="rpt-sf"><span>Filed by</span><b /></div>
        </div>
      </div>
    </div>
  )
}

/* ---------- page chrome ---------- */
function Header({ meta }: { meta: SheetMeta }) {
  return (
    <header className="rpt-hd">
      <div className="rpt-hl">
        {meta.logo ? <img src={meta.logo} alt="" /> : <div className="rpt-lg">{meta.company.slice(0, 2).toUpperCase()}</div>}
        <div><div className="rpt-co">{meta.company}</div><div className="rpt-title">{meta.title}</div></div>
      </div>
      <div className="rpt-hr"><div>Ref: <b>{meta.ref}</b></div><div>{tr('Generated', meta.lang)}: {meta.generated}</div><div>By: {meta.by}</div></div>
      <div className="rpt-flt">{meta.band && <b className="rpt-band">{meta.band}</b>}<span>{meta.filters}</span></div>
    </header>
  )
}
const Footer = ({ meta, n, of }: { meta: SheetMeta; n: number; of: number }) => (
  <footer className="rpt-ft">
    <span>{tr('Confidential', meta.lang).toUpperCase()} — personal data under the PDPA 2010; for internal use only. Do not copy or share.</span>
    <span>{meta.ref}</span>
    <b>{tr('Page', meta.lang)} {n} {tr('of', meta.lang)} {of}</b>
  </footer>
)

/* ---------- paginate ---------- */
export function Sheets({ blocks, meta }: { blocks: Block[]; meta: SheetMeta }) {
  const d = dims(meta.landscape)
  const mref = useRef<HTMLDivElement>(null)
  const [pages, setPages] = useState<Piece[][] | null>(null)

  useLayoutEffect(() => {
    let dead = false
    setPages(null)
    const run = () => {
      const root = mref.current
      if (!root || dead) return
      const H = (d.bodyH - 3 - 1) * MM // minus the sheet body 3 mm top padding and 1 mm safety
      const out: Piece[][] = [[]]
      let used = 0
      const gap = 3 * MM
      const push = (p: Piece, h: number) => {
        if (used > 0 && used + h > H) { out.push([]); used = 0 }
        out[out.length - 1].push(p); used += h + gap
      }
      blocks.forEach((b, i) => {
        const el = root.querySelector<HTMLElement>(`[data-b="${i}"]`)
        if (!el) return
        if (b.kind === 'pagebreak') { if (used > 0) { out.push([]); used = 0 } return }
        if (b.kind !== 'table' || !b.rows.length) { push({ k: 'block', b, i }, el.offsetHeight); return }
        const head = (el.querySelector<HTMLElement>('.rpt-ttl')?.offsetHeight || 0) + (el.querySelector<HTMLElement>('thead')?.offsetHeight || 0) + 2
        const trs = Array.from(el.querySelectorAll<HTMLElement>('tbody tr')).map((x) => x.offsetHeight)
        const tail = el.querySelector<HTMLElement>('.rpt-tnote')?.offsetHeight || 0
        const all = tableRows(b)
        let start = 0, first = true
        const need = (j: number) => trs[j] + (all[j].t === 'g' && j + 1 < all.length ? trs[j + 1] : 0) + (j === all.length - 1 ? tail : 0)
        while (start < all.length) {
          if (used > 0 && head + need(start) > H - used) { out.push([]); used = 0 }
          const room = H - used - head
          let end = start, acc = 0
          while (end < all.length && (end === start || acc + need(end) <= room)) { acc += trs[end]; end++ }
          if (end < all.length && all[end].t === 'tot' && end - start > 1) end-- // keep totals with the last row
          if (all[end - 1].t === 'g' && end - start > 1) end-- // never end a page on a group heading
          const h = head + trs.slice(start, end).reduce((x, y) => x + y, 0) + (end === all.length ? tail : 0)
          out[out.length - 1].push({ k: 'table', b, i, rows: all.slice(start, end), first }); used += h + gap
          first = false; start = end
          if (start < all.length) { out.push([]); used = 0 }
        }
      })
      const pg = out.filter((p, i) => p.length || i === 0)
      if (!dead) setPages(pg)
    }
    const f = (document as Document & { fonts?: FontFaceSet }).fonts
    const imgs = Array.from(mref.current?.querySelectorAll('img') || []).filter((x) => !x.complete).map((x) => new Promise((r) => { x.onload = x.onerror = r }))
    Promise.all([f ? f.ready : null, ...imgs]).then(() => requestAnimationFrame(run))
    return () => { dead = true }
  }, [blocks, meta.landscape, d.bodyH, meta.lang, meta.signs])

  return (
    <>
      <div ref={mref} className="rpt-measure rpt-body" style={{ width: `${d.bodyW}mm` }} aria-hidden>
        {blocks.map((b, i) => <div key={i} data-b={i}>{b.kind === 'pagebreak' ? null : <BlockView b={b} meta={meta} />}</div>)}
      </div>
      {!pages ? <div className="rpt-wait">Laying out A4 pages…</div> : pages.map((pg, n) => (
        <section key={n} className={'rpt-sheet' + (meta.landscape ? ' land' : '')} style={{ width: `${d.w}mm`, height: `${d.h}mm` }}>
          <Header meta={meta} />
          <div className="rpt-body" style={{ height: `${d.bodyH}mm` }}>
            {pg.map((p, j) => <Fragment key={j}>{p.k === 'table' ? <Table b={p.b} rows={p.rows} first={p.first} /> : <BlockView b={p.b} meta={meta} />}</Fragment>)}
          </div>
          <Footer meta={meta} n={n + 1} of={pages.length} />
        </section>
      ))}
    </>
  )
}
