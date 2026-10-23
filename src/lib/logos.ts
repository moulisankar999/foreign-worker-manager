/* Company / outlet logos. Private storage bucket 'logos' (only signed-in users of that company / outlet can
 * read; Super Admin, HR Admin and HR Manager within their scope can change — enforced by storage policies).
 * Object names carry a version (company/<id>/<time>.png) so a downloaded logo never changes: it is cached on
 * the device (Cache Storage) and shows offline and in the Android app. */
import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { getConfig } from './config'
import { outletCompany } from './companies'
import type { Outlet } from './types'

const BUCKET = 'logos'
const CACHE = 'fwm-logos-v1'
const MAX_SIDE = 512
const MAX_BYTES = 200 * 1024
const urls = new Map<string, string>()
const inflight = new Map<string, Promise<Blob | null>>()
const cacheKey = (path: string) => `https://fwm.local/logos/${path}`

async function fromCache(path: string): Promise<Blob | null> {
  try { if (!('caches' in window)) return null; const r = await (await caches.open(CACHE)).match(cacheKey(path)); return r ? await r.blob() : null } catch { return null }
}
async function toCache(path: string, b: Blob) {
  try { if ('caches' in window) await (await caches.open(CACHE)).put(cacheKey(path), new Response(b, { headers: { 'content-type': b.type } })) } catch { /* storage full / unsupported: fine */ }
}
/** the logo image (device cache first, then the private bucket); null if missing or not allowed */
export function logoBlob(path?: string | null): Promise<Blob | null> {
  if (!path) return Promise.resolve(null)
  let p = inflight.get(path)
  if (!p) {
    p = (async () => {
      const c = await fromCache(path)
      if (c) return c
      if (!navigator.onLine) return null
      const { data, error } = await supabase.storage.from(BUCKET).download(path)
      if (error || !data) return null
      await toCache(path, data)
      return data
    })()
    inflight.set(path, p)
    void p.then((b) => { if (!b) inflight.delete(path) })
  }
  return p
}
export function useLogoUrl(path?: string | null): string | null {
  const [url, setUrl] = useState<string | null>(() => (path ? urls.get(path) || null : null))
  useEffect(() => {
    if (!path) { setUrl(null); return }
    if (urls.has(path)) { setUrl(urls.get(path)!); return }
    let alive = true
    setUrl(null)
    void logoBlob(path).then((b) => {
      if (!b || !alive) return
      if (!urls.has(path)) urls.set(path, URL.createObjectURL(b))
      setUrl(urls.get(path)!)
    })
    return () => { alive = false }
  }, [path])
  return url
}

/* ---------- which logo applies ---------- */
export const companyLogo = (companyId?: string | null) => getConfig().companies.items.find((c) => c.id === companyId)?.logo || null
/** outlet logo, else its company's logo */
export const outletLogo = (o?: Outlet | null) => (o ? o.logo || companyLogo(outletCompany(o)) : null)
/** logo for the app header: a single outlet → its logo; a single company → its logo; otherwise the app default (null) */
export function headerLogo(role: string | null, companies: string[], outletIds: string[], outlets: Outlet[]): string | null {
  if (!role || role === 'super_admin') return null
  if (outletIds.length === 1 && !companies.length) return outletLogo(outlets.find((o) => o.id === outletIds[0]))
  const set = new Set([...companies, ...outletIds.map((id) => outletCompany(outlets.find((o) => o.id === id)))])
  return set.size === 1 ? companyLogo([...set][0]) : null
}

/* ---------- upload: resized in the browser to ≤512 px, ≤200 KB, stored as PNG or JPEG (SVG is rasterised) ---------- */
async function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    await new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(new Error('This file is not an image we can read (use PNG, JPEG or SVG).')); img.src = url })
    return img
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000) }
}
const toBlob = (c: HTMLCanvasElement, type: string, q?: number) => new Promise<Blob>((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error('Could not convert the image'))), type, q))
export async function prepareLogo(file: File): Promise<{ blob: Blob; ext: 'png' | 'jpg' }> {
  if (!/^image\/(png|jpeg|svg\+xml|webp|gif)$/.test(file.type)) throw new Error('Use a PNG, JPEG or SVG image.')
  if (file.size > 10 * 1024 * 1024) throw new Error('Image is too large (max 10 MB before resizing).')
  const img = await loadImage(file)
  const w0 = img.naturalWidth || 512, h0 = img.naturalHeight || 512
  let side = Math.min(MAX_SIDE, Math.max(w0, h0))
  for (let attempt = 0; attempt < 6; attempt++) {
    const k = side / Math.max(w0, h0)
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k))
    const g = c.getContext('2d')!
    g.drawImage(img, 0, 0, c.width, c.height)
    const png = await toBlob(c, 'image/png')
    if (png.size <= MAX_BYTES) return { blob: png, ext: 'png' }
    // photo-like logo: JPEG on white
    const j = document.createElement('canvas'); j.width = c.width; j.height = c.height
    const jg = j.getContext('2d')!; jg.fillStyle = '#fff'; jg.fillRect(0, 0, j.width, j.height); jg.drawImage(c, 0, 0)
    for (const q of [0.85, 0.7, 0.55]) { const jp = await toBlob(j, 'image/jpeg', q); if (jp.size <= MAX_BYTES) return { blob: jp, ext: 'jpg' } }
    side = Math.round(side * 0.75)
  }
  throw new Error('Could not make this image small enough (max 200 KB).')
}
const clean = (e: { message: string } | null) => { if (e) throw new Error(/row-level|not allowed|unauthori/i.test(e.message) ? 'You are not allowed to change this logo.' : e.message.replace(/^.*?ERROR:\s*/, '')) }
export async function uploadLogo(kind: 'company' | 'outlet', id: string, file: File): Promise<string> {
  if (!navigator.onLine) throw new Error('You are offline. Logos need an internet connection.')
  const { blob, ext } = await prepareLogo(file)
  const path = `${kind}/${id}/${Date.now()}.${ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: ext === 'png' ? 'image/png' : 'image/jpeg', upsert: false })
  clean(error)
  await toCache(path, blob)
  return path
}
export async function removeLogoFile(path?: string | null) {
  if (path) await supabase.storage.from(BUCKET).remove([path]).catch(() => {})
}
export async function setCompanyLogo(companyId: string, path: string | null) {
  const { error } = await supabase.rpc('set_company_logo', { p_company: companyId, p_path: path })
  clean(error)
}

/** bytes for pdf-lib: the worker's outlet logo → company logo → the passport-form logo (Settings) → none */
export async function pdfLogoFor(outlet?: Outlet | null): Promise<{ bytes: Uint8Array; png: boolean } | null> {
  const path = outletLogo(outlet)
  const b = await logoBlob(path).catch(() => null)
  if (b) return { bytes: new Uint8Array(await b.arrayBuffer()), png: b.type === 'image/png' || /\.png$/.test(path || '') }
  return null
}
