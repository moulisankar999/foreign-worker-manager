import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Btn } from '../components/ui'
import { endPrint, printSheets, savePdf } from './export'
import { Sheets, dims, type SheetMeta } from './Sheets'
import type { Block } from './types'

/** Full-screen A4 preview. Print / Save as PDF act on exactly what is shown. */
export function Preview({ blocks, meta, file, onClose, onPrinted, extra }: { blocks: Block[]; meta: SheetMeta; file: string; onClose: () => void; onPrinted?: () => void; extra?: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [busy, setBusy] = useState('')
  const w = dims(meta.landscape).w * (96 / 25.4)

  useEffect(() => {
    const fit = () => { const cw = (scroller.current?.clientWidth || w) - 24; setZoom(Math.min(1, cw / w)) }
    fit(); window.addEventListener('resize', fit)
    document.body.classList.add('modal-open')
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('resize', fit); window.removeEventListener('keydown', esc); document.body.classList.remove('modal-open'); endPrint() }
  }, [w, onClose])

  const act = async (k: 'print' | 'pdf') => {
    if (!root.current) return
    setBusy(k)
    try {
      if (k === 'print') await printSheets(root.current, meta.title, meta.landscape)
      else await savePdf(root.current, file, meta.landscape)
      onPrinted?.()
    } catch (e) { alert((e as Error).message) } finally { setBusy('') }
  }

  return createPortal(
    <div className="rpt-print-root rpt-overlay" role="dialog" aria-label={`Preview: ${meta.title}`}>
      <div className="rpt-bar no-print">
        <Btn small icon="back" onClick={onClose}>Close</Btn>
        <b className="rpt-bar-t">{meta.title}<small> · A4 {meta.landscape ? 'landscape' : 'portrait'}</small></b>
        <span className="spacer" />
        {extra}
        <label className="rpt-zoom"><span className="sr">Zoom</span>
          <select aria-label="Zoom" value={zoom >= 1 ? '1' : String(zoom)} onChange={(e) => setZoom(Number(e.target.value))}>
            {zoom < 1 && ![0.5, 0.75].includes(zoom) && <option value={String(zoom)}>Fit</option>}
            <option value="0.5">50%</option><option value="0.75">75%</option><option value="1">100%</option>
          </select>
        </label>
        <Btn small icon="download" disabled={!!busy} onClick={() => act('pdf')}>{busy === 'pdf' ? 'Making PDF…' : 'Save PDF'}</Btn>
        <Btn small kind="primary" icon="print" disabled={!!busy} onClick={() => act('print')}>{busy === 'print' ? 'Opening…' : 'Print'}</Btn>
      </div>
      <div className="rpt-scroll" ref={scroller}>
        <div className="rpt-pages" ref={root} style={{ ['--z' as string]: zoom }}>
          <Sheets blocks={blocks} meta={meta} />
        </div>
      </div>
    </div>,
    document.body,
  )
}
