/* Document vault: private cloud storage (signed links only), versioning, expiry, phone-camera scanning. */
import { useEffect, useState } from 'react'
import { PDFDocument } from 'pdf-lib'
import { supabase } from './supabase'
import { getConfig } from './config'
import { isNative, openExternal, shareFile } from './platform'
import { download, uid } from './util'

export const BUCKET = 'attachments'
export interface DocRow {
  id: string; worker_id: string; category: string; title: string; doc_no: string | null; file_path: string; file_name: string | null
  mime: string | null; size_bytes: number | null; pages: number | null; issue_date: string | null; expiry_date: string | null
  version: number; group_id: string; is_current: boolean; request_id: string | null; source: string; notes: string | null
  uploaded_by: string; uploaded_by_name: string | null; uploaded_at: string; deleted: boolean
}

/* ---------- Compression & limits ---------- */
export const SCAN_MAX_PX = 1600
export const SCAN_QUALITY = 0.7
const kb = (n: number) => Math.round(n / 1024)
export const fmtSize = (n?: number | null) => (!n ? '' : n < 1024 * 1024 ? `${kb(n)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); res(img) }
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('This picture could not be read. Use a JPG or PNG photo.')) }
    img.src = url
  })
}
/** Resize to max 1600 px and save as JPEG 0.7 (≈200–400 KB for a document photo); lowers quality further only if still over the limit. */
export async function compressImage(file: Blob, maxKB = getConfig().vault.maxImageKB): Promise<Blob> {
  const img = await loadImage(file)
  let max = SCAN_MAX_PX
  for (let attempt = 0; attempt < 5; attempt++) {
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale)
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height)
    ctx.drawImage(img, 0, 0, c.width, c.height)
    const q = attempt === 0 ? SCAN_QUALITY : Math.max(0.45, SCAN_QUALITY - attempt * 0.08)
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', q))
    if (blob.size <= maxKB * 1024) return blob
    max = Math.round(max * 0.85)
  }
  throw new Error(`This picture is still larger than ${maxKB} KB after compression. Please retake it closer to the document.`)
}
/** Several scanned pages → one PDF (each page sized to the picture). */
export async function imagesToPdf(images: Blob[]): Promise<Blob> {
  const pdf = await PDFDocument.create()
  for (const b of images) {
    const bytes = new Uint8Array(await b.arrayBuffer())
    const img = b.type === 'image/png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
    // fit on an A4-ish page width (595 pt) keeping the ratio
    const w = 595, h = (img.height / img.width) * w
    const page = pdf.addPage([w, h])
    page.drawImage(img, { x: 0, y: 0, width: w, height: h })
  }
  const out = await pdf.save()
  return new Blob([out as BlobPart], { type: 'application/pdf' })
}
export async function pdfPages(b: Blob): Promise<number> {
  try { return (await PDFDocument.load(new Uint8Array(await b.arrayBuffer()), { ignoreEncryption: true })).getPageCount() } catch { return 1 }
}
export function checkLimit(b: Blob) {
  const v = getConfig().vault
  if (b.type === 'application/pdf' && b.size > v.maxPdfKB * 1024)
    throw new Error(`This PDF is ${fmtSize(b.size)} — the limit is ${v.maxPdfKB / 1024} MB. Scan with the app camera (it compresses automatically) or split the PDF.`)
  if (b.type.startsWith('image/') && b.size > v.maxImageKB * 1024)
    throw new Error(`This picture is ${fmtSize(b.size)} — the limit is ${v.maxImageKB / 1024} MB per image.`)
  if (!b.type.startsWith('image/') && b.type !== 'application/pdf') throw new Error('Only photos (JPG/PNG) and PDF files can be uploaded.')
}
/** Prepare picked/scanned files for upload: images are compressed; several pages can be merged into one PDF. */
export async function prepareFiles(files: Blob[], merge: boolean): Promise<{ blob: Blob; name: string; pages: number }[]> {
  const imgs: Blob[] = []
  const out: { blob: Blob; name: string; pages: number }[] = []
  for (const f of files) {
    if (f.type.startsWith('image/')) imgs.push(await compressImage(f))
    else if (f.type === 'application/pdf') { checkLimit(f); out.push({ blob: f, name: (f as File).name || 'document.pdf', pages: await pdfPages(f) }) }
    else throw new Error('Only photos (JPG/PNG) and PDF files can be uploaded.')
  }
  if (imgs.length > 1 && merge) {
    const pdf = await imagesToPdf(imgs)
    checkLimit(pdf)
    out.unshift({ blob: pdf, name: 'scan.pdf', pages: imgs.length })
  } else imgs.forEach((b, i) => out.push({ blob: b, name: `scan-${i + 1}.jpg`, pages: 1 }))
  return out
}

/* ---------- Upload / list ---------- */
const safe = (n: string) => n.replace(/[^\w.-]+/g, '_').slice(-60)
export interface NewDoc {
  workerId: string; category: string; title?: string; docNo?: string; issueDate?: string; expiryDate?: string
  groupId?: string; requestId?: string; source?: 'upload' | 'scan' | 'memo' | 'generated' | 'request'; notes?: string
}
export async function uploadDoc(meta: NewDoc, file: { blob: Blob; name: string; pages: number }): Promise<DocRow> {
  if (!navigator.onLine) throw new Error('You are offline. Documents are stored only in the cloud — try again when online.')
  checkLimit(file.blob)
  const path = `vault/${meta.workerId}/${Date.now()}-${uid().slice(0, 8)}-${safe(file.name)}`
  const up = await supabase.storage.from(BUCKET).upload(path, file.blob, { contentType: file.blob.type, upsert: false })
  if (up.error) throw new Error(up.error.message.includes('row-level') ? 'Documents for this worker are handled by his outlet and HR' : up.error.message)
  const { data: u } = await supabase.auth.getUser()
  const row = {
    worker_id: meta.workerId, category: meta.category, title: meta.title || file.name, doc_no: meta.docNo || null,
    file_path: path, file_name: file.name, mime: file.blob.type, size_bytes: file.blob.size, pages: file.pages,
    issue_date: meta.issueDate || null, expiry_date: meta.expiryDate || null, group_id: meta.groupId || null,
    request_id: meta.requestId || null, source: meta.source || 'upload', notes: meta.notes || null, uploaded_by: u.user?.id,
  }
  const { data, error } = await supabase.from('documents').insert(row).select().single()
  if (error) throw new Error(error.message.includes('row-level') ? `"${meta.category}" documents are handled by HR` : error.message)
  docsChanged()
  return data as DocRow
}
export async function updateDoc(id: string, patch: Partial<Pick<DocRow, 'title' | 'doc_no' | 'issue_date' | 'expiry_date' | 'notes' | 'category' | 'deleted'>>) {
  const { error } = await supabase.from('documents').update(patch).eq('id', id)
  if (error) throw new Error(error.message.includes('row-level') ? 'Documents are kept up to date by HR' : error.message)
  docsChanged()
}

const subs = new Set<() => void>()
let tick = 0
let ch: ReturnType<typeof supabase.channel> | null = null
function docsChanged() { tick++; subs.forEach((f) => f()) }
function ensureLive() {
  if (ch) return
  ch = supabase.channel('documents-live').on('postgres_changes', { event: '*', schema: 'public', table: 'documents' }, () => docsChanged()).subscribe()
}
export interface DocFilter { workerId?: string; requestId?: string; category?: string; all?: boolean; includeOld?: boolean }
export function useDocs(f: DocFilter): { docs: DocRow[]; loading: boolean; error: string; reload: () => void } {
  const [state, setState] = useState<{ docs: DocRow[]; loading: boolean; error: string }>({ docs: [], loading: true, error: '' })
  const [t, setT] = useState(tick)
  useEffect(() => { ensureLive(); const f2 = () => setT(tick); subs.add(f2); return () => { subs.delete(f2) } }, [])
  const key = JSON.stringify(f)
  useEffect(() => {
    let alive = true
    ;(async () => {
      let q = supabase.from('documents').select('*').eq('deleted', false).order('uploaded_at', { ascending: false }).limit(1000)
      if (f.workerId) q = q.eq('worker_id', f.workerId)
      if (f.requestId) q = q.eq('request_id', f.requestId)
      if (f.category) q = q.eq('category', f.category)
      if (!f.includeOld) q = q.eq('is_current', true)
      const { data, error } = await q
      if (!alive) return
      setState({ docs: (data || []) as DocRow[], loading: false, error: error ? (navigator.onLine ? error.message : 'Offline — documents need an internet connection') : '' })
    })()
    return () => { alive = false }
  }, [key, t]) // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, reload: docsChanged }
}
export async function docVersions(groupId: string): Promise<DocRow[]> {
  const { data } = await supabase.from('documents').select('*').eq('group_id', groupId).order('version', { ascending: false })
  return (data || []) as DocRow[]
}

/* ---------- Open / download / share (short-lived signed links; the bucket is private) ---------- */
export async function signedUrl(path: string, seconds = 300, downloadName?: string) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, seconds, downloadName ? { download: downloadName } : undefined)
  if (error) throw new Error(error.message.includes('not found') || error.message.includes('Object') ? 'File not found or you have no access' : error.message)
  return data.signedUrl
}
export async function fetchDoc(d: Pick<DocRow, 'file_path'>): Promise<Blob> {
  const { data, error } = await supabase.storage.from(BUCKET).download(d.file_path)
  if (error) throw new Error('Could not download: ' + error.message)
  return data
}
const fileName = (d: DocRow) => d.file_name || d.file_path.split('/').pop() || 'document'
export async function openDoc(d: DocRow) {
  if (isNative()) { await openExternal(await signedUrl(d.file_path)); return }
  const win = window.open('', '_blank')
  try { const u = await signedUrl(d.file_path); if (win) win.location.href = u; else window.location.href = u }
  catch (e) { win?.close(); throw e }
}
export async function downloadDoc(d: DocRow) {
  const b = await fetchDoc(d)
  download(fileName(d), b, b.type)
}
export async function shareDoc(d: DocRow) {
  const b = await fetchDoc(d)
  if (isNative()) return shareFile(fileName(d), b)
  const f = new File([b], fileName(d), { type: b.type })
  const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean }
  if (nav.share && nav.canShare?.({ files: [f] })) await nav.share({ files: [f], title: d.title })
  else download(fileName(d), b, b.type)
}
