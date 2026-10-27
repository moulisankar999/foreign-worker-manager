/* v1.6.1: attachments as clear buttons. Every stored file shows as a chip: file-type icon (or a small thumbnail for photos),
 * the file name and "View". Opening always goes through a short-lived private signed link (5 min) created for the
 * signed-in user, so storage access rules decide exactly as before: a chip is only drawn for a file the user's role can
 * already list, and the link is refused for anyone else. PDFs and photos open in an in-app preview; other files download. */
import { useEffect, useRef, useState } from 'react'
import { Modal } from './ui'
import { Icon } from './Icon'
import { toast } from './toast'
import { isNative, openExternal } from '../lib/platform'
import { signedUrl, type DocRow } from '../lib/vault'
import { fileUrl, type QFile } from '../lib/quota'
import { companyFileUrl } from '../lib/companyRecords'
import { supabase } from '../lib/supabase'
import type { Attachment } from '../lib/types'

export type AttachKind = 'pdf' | 'image' | 'other'
export interface AttachSrc {
  /** stable id (thumbnail cache) */
  key: string
  name: string
  mime?: string | null
  size?: number | null
  /** short-lived link; `download` = file name to save as */
  url: (download?: string) => Promise<string>
}
export function attachKind(name?: string | null, mime?: string | null): AttachKind {
  const m = (mime || '').toLowerCase(); const n = (name || '').toLowerCase()
  if (m === 'application/pdf' || n.endsWith('.pdf')) return 'pdf'
  if (m.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|heif|bmp)$/.test(n)) return 'image'
  return 'other'
}
const KIND_ICON: Record<AttachKind, string> = { pdf: 'pdf', image: 'image', other: 'file' }
const KIND_LABEL: Record<AttachKind, string> = { pdf: 'PDF', image: 'Photo', other: 'File' }

/* ---------- adapters for the four places files live ---------- */
const tail = (p: string) => p.split('/').pop()?.replace(/^[0-9a-f-]{36}-/, '') || 'file'
export const docSrc = (d: DocRow): AttachSrc => ({ key: 'd:' + d.id, name: d.file_name || tail(d.file_path), mime: d.mime, size: d.size_bytes, url: (dl) => signedUrl(d.file_path, 300, dl) })
export const quotaSrc = (f: QFile): AttachSrc => ({ key: 'q:' + f.id, name: f.name || tail(f.path), mime: f.mime, size: f.size, url: (dl) => fileUrl(f, !!dl) })
export const companySrc = (path: string, name?: string | null, mime?: string | null, size?: number | null): AttachSrc =>
  ({ key: 'c:' + path, name: name || tail(path), mime, size, url: (dl) => companyFileUrl(path, dl) })
/** older per-record attachment (worker "Expiry docs"): local copy on this device, otherwise the private cloud copy */
export const legacySrc = (a: Attachment, id: string): AttachSrc => ({
  key: 'a:' + (a.path || id), name: a.name || 'attachment', mime: a.type,
  url: async (dl) => {
    if (a.path) {
      const { data, error } = await supabase.storage.from('attachments').createSignedUrl(a.path, 300, dl ? { download: dl } : undefined)
      if (error) throw new Error('File not found or you have no access')
      return data.signedUrl
    }
    if (a.dataUrl) return URL.createObjectURL(await (await fetch(a.dataUrl)).blob())
    throw new Error('File not available')
  },
})

/* ---------- thumbnails: lazily, only when the chip is on screen; links are reused for 4 minutes ---------- */
const thumbs = new Map<string, { u: string; at: number }>()
function useThumb(src: AttachSrc, on: boolean) {
  const ref = useRef<HTMLSpanElement>(null)
  const [u, setU] = useState<string | null>(() => { const c = thumbs.get(src.key); return c && Date.now() - c.at < 240e3 ? c.u : null })
  const [bad, setBad] = useState(false)
  useEffect(() => {
    if (!on || u || bad) return
    const el = ref.current; if (!el) return
    let live = true
    const load = () => { void src.url().then((x) => { thumbs.set(src.key, { u: x, at: Date.now() }); if (live) setU(x) }, () => live && setBad(true)) }
    if (!('IntersectionObserver' in window)) { load(); return () => { live = false } }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); load() } }, { rootMargin: '120px' })
    io.observe(el)
    return () => { live = false; io.disconnect() }
  }, [on, u, bad, src])
  return { ref, u: bad ? null : u, fail: () => setBad(true) }
}

/* ---------- one viewer for the whole app ---------- */
type Open = { src: AttachSrc; kind: AttachKind; url: string } | null
const viewSubs = new Set<(o: Open) => void>()
export async function openAttach(src: AttachSrc) {
  const kind = attachKind(src.name, src.mime)
  try {
    if (kind === 'other') return void (await saveAttach(src))
    // phone app: the system viewer renders PDFs; photos use the in-app preview
    if (kind === 'pdf' && isNative()) return void (await openExternal(await src.url()))
    const url = await src.url()
    viewSubs.forEach((f) => f({ src, kind, url }))
  } catch (e) { toast((e as Error).message || 'Could not open the file', 'err') }
}
export async function saveAttach(src: AttachSrc) {
  const u = await src.url(src.name)
  if (isNative()) return openExternal(u)
  const a = document.createElement('a'); a.href = u; a.download = src.name; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove()
}
export function AttachViewer() {
  const [o, setO] = useState<Open>(null)
  useEffect(() => { viewSubs.add(setO); return () => { viewSubs.delete(setO) } }, [])
  if (!o) return null
  return (
    <Modal wide title={<span className="att-vh"><Icon name={KIND_ICON[o.kind]} size={18} /> {o.src.name}</span>} onClose={() => setO(null)}
      footer={<>
        <span className="muted small grow">Private copy · link valid for 5 minutes</span>
        <button type="button" className="btn btn-secondary" onClick={() => void saveAttach(o.src).catch((e) => toast((e as Error).message, 'err'))}><Icon name="download" size={16} /> Download</button>
        <button type="button" className="btn btn-primary" onClick={() => setO(null)}>Close</button>
      </>}>
      <div className="att-view" data-testid="attach-viewer">
        {o.kind === 'image' ? <img src={o.url} alt={o.src.name} /> : <iframe src={o.url} title={o.src.name} />}
      </div>
    </Modal>
  )
}

/** the attachment button: [icon or thumbnail] name · View. `label` names what the file is (e.g. "Air ticket"). */
export function AttachButton({ src, label, compact, mini, testId }: { src: AttachSrc; label?: string; compact?: boolean; mini?: boolean; testId?: string }) {
  const kind = attachKind(src.name, src.mime)
  const th = useThumb(src, kind === 'image')
  const [busy, setBusy] = useState(false)
  const verb = kind === 'other' ? 'Download' : 'View'
  const go = async () => { setBusy(true); try { await openAttach(src) } finally { setBusy(false) } }
  return (
    <button type="button" className={`att${compact ? ' att-c' : ''}${mini ? ' att-m' : ''} att-${kind}`} disabled={busy} data-testid={testId || (mini ? 'attach-mini' : 'attach-btn')} data-kind={kind}
      title={`${verb} ${label ? label + ' — ' : ''}${src.name}`} aria-label={`${verb} ${label ? label + ': ' : ''}${src.name} (${KIND_LABEL[kind]})`}
      onClick={(e) => { e.stopPropagation(); void go() }}>
      <span className="att-ic" ref={th.ref}>{th.u ? <img src={th.u} alt="" onError={th.fail} /> : <Icon name={KIND_ICON[kind]} size={compact ? 15 : 17} />}</span>
      <span className="att-t">{label && <b>{label}</b>}<span className="att-n">{src.name}</span></span>
      <span className="att-v">{busy ? '…' : verb}</span>
    </button>
  )
}
export function AttachList({ items, compact }: { items: { src: AttachSrc; label?: string }[]; compact?: boolean }) {
  if (!items.length) return <span className="muted">—</span>
  return <span className="att-list">{items.map((x) => <AttachButton key={x.src.key} src={x.src} label={x.label} compact={compact} />)}</span>
}

/** paperclip + count for a row, card or section that holds files; nothing when there are none */
export function ClipBadge({ n, className = '' }: { n?: number | null; className?: string }) {
  if (!n) return null
  return <span className={`clip-b ${className}`} title={`${n} attachment${n > 1 ? 's' : ''}`} aria-label={`${n} attachment${n > 1 ? 's' : ''}`} data-testid="clip-badge"><Icon name="clip" size={12} />{n}</span>
}
