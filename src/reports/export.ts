import { platform, printPage } from '../lib/platform'
import { download } from '../lib/util'

/** Render every A4 sheet in `root` to a PDF (one page per sheet). Works the same on web, Android and iOS. */
export async function sheetsToPdf(root: HTMLElement, landscape?: boolean): Promise<Blob> {
  const [{ toJpeg }, { PDFDocument }] = await Promise.all([import('html-to-image'), import('pdf-lib')])
  const sheets = Array.from(root.querySelectorAll<HTMLElement>('.rpt-sheet'))
  if (!sheets.length) throw new Error('Nothing to export yet — wait for the pages to finish laying out.')
  const pdf = await PDFDocument.create()
  const W = landscape ? 841.89 : 595.28, H = landscape ? 595.28 : 841.89
  for (const el of sheets) {
    // render at true size (the preview may be zoomed on screen)
    const url = await toJpeg(el, { quality: 0.92, pixelRatio: 2.5, backgroundColor: '#ffffff', style: { zoom: '1', transform: 'none', margin: '0', boxShadow: 'none' } })
    const img = await pdf.embedJpg(url)
    pdf.addPage([W, H]).drawImage(img, { x: 0, y: 0, width: W, height: H })
  }
  pdf.setProducer('FW Manager'); pdf.setCreator('FW Manager Reports')
  return new Blob([(await pdf.save()) as BlobPart], { type: 'application/pdf' })
}

export async function savePdf(root: HTMLElement, filename: string, landscape?: boolean) {
  download(filename, await sheetsToPdf(root, landscape), 'application/pdf')
}

/** Print the sheets. Web + Android: the system print dialog (also "Save as PDF").
 *  iOS app: WKWebView has no window.print, so make the PDF and open the share sheet (Print is one of its options). */
export async function printSheets(root: HTMLElement, title: string, landscape?: boolean) {
  if (platform() === 'ios') return savePdf(root, title.replace(/\s+/g, '-') + '.pdf', landscape)
  const st = document.createElement('style')
  st.id = 'rpt-page-size'
  st.textContent = `@page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 0 }`
  document.getElementById('rpt-page-size')?.remove()
  document.head.appendChild(st)
  document.body.classList.add('rpt-printing')
  const old = document.title
  document.title = title
  const done = () => { document.body.classList.remove('rpt-printing'); document.title = old; window.removeEventListener('afterprint', done) }
  window.addEventListener('afterprint', done)
  // Android prints asynchronously: the preview's close button clears the class (endPrint)
  try { await printPage(title) } finally { if (platform() !== 'android') setTimeout(done, 500) }
}

export const endPrint = () => document.body.classList.remove('rpt-printing')
