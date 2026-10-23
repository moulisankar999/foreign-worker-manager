/* Offline-first two-way sync between Dexie (this device) and Supabase `records` (cloud).
 * All reads/writes go through security-definer RPCs (pull_records / push_records), so the server decides
 * what each role may see (outlet managers: only their outlets' workers, no salary data) and change.
 * - Every local change to workers/outlets/jobs/settings is tracked in a small "dirty" list (localStorage).
 * - push(): uploads dirty rows (last-write-wins on client_ts, enforced by a DB trigger).
 * - pull(): downloads rows changed since the last cursor (server_ts) and applies them locally.
 * - Realtime: any change in the cloud triggers a quick pull, so other users' edits appear live.
 */
import Dexie from 'dexie'
import { useSyncExternalStore } from 'react'
import { db, defaultJobRows } from './db'
import { supabase } from './supabase'
import { isNative, openExternal, shareFile } from './platform'
import { type DocRec, type Worker } from './types'

export type Entity = 'workers' | 'outlets' | 'jobs' | 'settings' | 'remarks'
export const ENTITIES: Entity[] = ['workers', 'outlets', 'jobs', 'settings', 'remarks']
const MASTER: Entity[] = ['workers', 'outlets', 'jobs', 'settings']
const DIRTY = 'fwm-dirty'
const CURSOR = 'fwm-cursor'
const SYNC_USER = 'fwm-sync-user'
const BUCKET = 'attachments'

export type SyncState = 'off' | 'offline' | 'syncing' | 'synced' | 'error'
export interface SyncStatus { state: SyncState; pending: number; lastSync?: string; error?: string }

let active = false
let canWrite = false
let canRemark = false
let pushing = false
let pulling: Promise<void> | null = null
let pushTimer: ReturnType<typeof setTimeout> | undefined
let pullTimer: ReturnType<typeof setTimeout> | undefined
let channel: ReturnType<typeof supabase.channel> | null = null
let interval: ReturnType<typeof setInterval> | undefined
let dirty: Record<string, string> = loadDirty()
let status: SyncStatus = { state: 'off', pending: Object.keys(dirty).length }
const listeners = new Set<() => void>()

function loadDirty(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(DIRTY) || '{}') } catch { return {} }
}
function saveDirty() {
  localStorage.setItem(DIRTY, JSON.stringify(dirty))
  setStatus({ pending: Object.keys(dirty).length })
}
function setStatus(p: Partial<SyncStatus>) {
  status = { ...status, ...p }
  listeners.forEach((l) => l())
}
export const getSyncStatus = () => status
export function useSyncStatus() {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb) }, () => status)
}
export const isCloudWriter = () => canWrite
const ms = (t: string) => Date.parse(t) || 0
const keyOf = (e: string, id: unknown) => `${e}:${String(id)}`
const splitKey = (k: string) => { const i = k.indexOf(':'); return [k.slice(0, i) as Entity, k.slice(i + 1)] as const }

/** Run local writes that came FROM the cloud (they must not be pushed back). */
export async function remoteTx(fn: () => Promise<void>) {
  await db.transaction('rw', [db.workers, db.outlets, db.jobs, db.settings, db.remarks, db.synced], async () => {
    (Dexie.currentTransaction as unknown as { __remote?: boolean }).__remote = true
    await fn()
  })
}

function track(e: Entity, id: unknown) {
  const tx = Dexie.currentTransaction as unknown as { __remote?: boolean } | null
  if (tx?.__remote || !active) return
  if (e === 'remarks' ? !canRemark : !canWrite) throw new Error('View-only access: your role cannot change this. Raise a request instead.')
  dirty[keyOf(e, id)] = new Date().toISOString()
  saveDirty()
  schedulePush()
}
for (const e of ENTITIES) {
  const t = db.table(e)
  t.hook('creating', function (pk, obj) { track(e, pk ?? (obj as { id: string }).id) })
  t.hook('updating', function (_m, pk) { track(e, pk) })
  t.hook('deleting', function (pk) { track(e, pk) })
}

function schedulePush(delay = 800) {
  clearTimeout(pushTimer)
  pushTimer = setTimeout(() => { void syncNow() }, delay)
}
function schedulePull(delay = 400) {
  clearTimeout(pullTimer)
  pullTimer = setTimeout(() => { void pull().catch(fail) }, delay)
}
function fail(err: unknown) {
  const msg = (err as Error)?.message || String(err)
  setStatus({ state: navigator.onLine ? 'error' : 'offline', error: msg })
}

/* ---------- Attachments: upload file bytes to Storage, keep only the path in the cloud row ---------- */
const safeName = (n: string) => n.replace(/[^\w.-]+/g, '_').slice(-80)
async function workerToCloud(w: Worker): Promise<Worker> {
  const uploaded: Record<string, string> = {}
  for (const d of w.documents || []) {
    const a = d.attachment
    if (a?.dataUrl && !a.path) {
      const path = `workers/${w.id}/${d.id}/${Date.now()}-${safeName(a.name)}`
      const blob = await (await fetch(a.dataUrl)).blob()
      const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: a.type || blob.type, upsert: true })
      if (error) throw error
      uploaded[d.id] = path
    }
  }
  if (Object.keys(uploaded).length) {
    // remember the storage path locally without marking the record dirty again
    await remoteTx(async () => {
      const cur = await db.workers.get(w.id)
      if (!cur) return
      cur.documents = cur.documents.map((d) => (uploaded[d.id] && d.attachment && !d.attachment.path ? { ...d, attachment: { ...d.attachment, path: uploaded[d.id] } } : d))
      await db.workers.put(cur)
    })
  }
  return {
    ...w,
    documents: (w.documents || []).map((d): DocRec => {
      if (!d.attachment) return d
      const path = d.attachment.path || uploaded[d.id]
      return { ...d, attachment: { name: d.attachment.name, type: d.attachment.type, path } }
    }),
  }
}
function mergeLocalAttachments(remote: Worker, local?: Worker): Worker {
  if (!local) return remote
  const byId = new Map(local.documents.map((d) => [d.id, d]))
  return {
    ...remote,
    documents: (remote.documents || []).map((d) => {
      const l = byId.get(d.id)
      if (d.attachment?.path && l?.attachment?.path === d.attachment.path && l.attachment.dataUrl) return { ...d, attachment: { ...d.attachment, dataUrl: l.attachment.dataUrl } }
      return d
    }),
  }
}
/** Open an attachment (local copy if present, otherwise a short-lived signed link from the cloud). */
export async function openAttachment(a: NonNullable<DocRec['attachment']>) {
  if (isNative()) {
    try {
      if (a.path) {
        const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(a.path, 300)
        if (error) throw error
        await openExternal(data.signedUrl)
      } else if (a.dataUrl) {
        await shareFile(a.name || 'attachment', await (await fetch(a.dataUrl)).blob())
      } else throw new Error('File not available')
    } catch (e) { alert('Could not open attachment: ' + (e as Error).message) }
    return
  }
  const win = window.open('', '_blank')
  try {
    let url = a.dataUrl
    if (!url && a.path) {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(a.path, 300)
      if (error) throw error
      url = data.signedUrl
    }
    if (!url) throw new Error('File not available')
    if (url.startsWith('data:')) {
      const blob = await (await fetch(url)).blob()
      url = URL.createObjectURL(blob)
    }
    if (win) win.location.href = url
    else window.location.href = url
  } catch (e) {
    win?.close()
    alert('Could not open attachment: ' + (e as Error).message)
  }
}

/* ---------- Pull / apply ---------- */
interface Row { entity: Entity; id: string; data: Record<string, unknown>; deleted: boolean; client_ts: string; server_ts: string }
/** roles without salary access get worker rows without pay fields: keep the shape the app expects */
function normWorker(d: Record<string, unknown>): Worker {
  const arr = ['documents', 'family', 'increments', 'allowances', 'loans', 'deductions', 'leaves', 'memos', 'notes', 'statusHistory']
  const w = { ...d } as Record<string, unknown>
  for (const k of arr) if (!Array.isArray(w[k])) w[k] = []
  if (typeof w.initialBasicPay !== 'number') w.initialBasicPay = 0
  return w as unknown as Worker
}

async function applyRows(rows: Row[]) {
  if (!rows.length) return
  const keys = rows.map((r) => keyOf(r.entity, r.id))
  const known = await db.synced.bulkGet(keys)
  let dirtyChanged = false
  await remoteTx(async () => {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      if (!ENTITIES.includes(r.entity)) continue
      const k = keys[i]
      const ts = ms(r.client_ts)
      const d = dirty[k]
      if (d && ms(d) > ts) continue // our unsent local edit is newer
      if (d) { delete dirty[k]; dirtyChanged = true }
      const kn = known[i]
      if (kn && kn.ts >= ts) continue // already have this version
      const t = db.table(r.entity)
      if (r.deleted) await t.delete(r.id)
      else if (r.entity === 'workers') await t.put(mergeLocalAttachments(normWorker(r.data), await db.workers.get(r.id)))
      else await t.put({ ...(r.data as object), id: (r.data as { id?: string })?.id || r.id }) // row id is authoritative
      await db.synced.put({ key: k, ts })
    }
  })
  if (dirtyChanged) saveDirty()
}

export function pull(): Promise<void> {
  if (!active) return Promise.resolve()
  if (pulling) return pulling
  pulling = (async () => {
    setStatus({ state: 'syncing' })
    const saved = localStorage.getItem(CURSOR)
    // small overlap protects against rows committed slightly out of order
    let cursor = saved ? new Date(ms(saved) - 30000).toISOString() : '1970-01-01T00:00:00Z'
    for (;;) {
      const { data, error } = await supabase.rpc('pull_records', { p_since: cursor, p_limit: 500 })
      if (error) throw error
      await applyRows((data || []) as Row[])
      if (data.length) {
        cursor = data[data.length - 1].server_ts
        if (!saved || ms(cursor) > ms(saved)) localStorage.setItem(CURSOR, cursor)
      }
      if (data.length < 500) break
    }
    setStatus({ state: Object.keys(dirty).length ? 'syncing' : 'synced', lastSync: new Date().toISOString(), error: undefined })
  })().finally(() => { pulling = null })
  return pulling
}

/* ---------- Push ---------- */
export async function push() {
  if (!active || !(canWrite || canRemark) || pushing) return
  const keys = Object.keys(dirty)
  if (!keys.length) return
  pushing = true
  setStatus({ state: 'syncing' })
  try {
    for (let i = 0; i < keys.length; i += 25) {
      const chunk = keys.slice(i, i + 25)
      const rows = [] as { entity: Entity; id: string; data: unknown; deleted: boolean; client_ts: string }[]
      const sent: Record<string, string> = {}
      for (const k of chunk) {
        const ts = dirty[k]
        if (!ts) continue
        const [e, id] = splitKey(k)
        let obj = (await db.table(e).get(id)) as Record<string, unknown> | undefined
        if (obj && e === 'workers') obj = (await workerToCloud(obj as unknown as Worker)) as unknown as Record<string, unknown>
        rows.push({ entity: e, id, data: obj ?? {}, deleted: !obj, client_ts: ts })
        sent[k] = ts
      }
      if (!rows.length) continue
      const { data, error } = await supabase.rpc('push_records', { p_rows: rows })
      if (error) throw error
      const rejected = ((data as { rejected?: { entity: string; id: string; reason: string }[] })?.rejected || [])
      const bad = new Set(rejected.map((x) => keyOf(x.entity, x.id)))
      await db.synced.bulkPut(Object.entries(sent).filter(([k]) => !bad.has(k)).map(([key, ts]) => ({ key, ts: ms(ts) })))
      // rejected (no permission / not your outlet): drop the local change and take the cloud copy again
      for (const [k, ts] of Object.entries(sent)) if (dirty[k] === ts) delete dirty[k]
      saveDirty()
      if (rejected.length) {
        await db.synced.bulkDelete([...bad])
        lastRejected = rejected
        setStatus({ error: `${rejected.length} change(s) refused: ${rejected[0].reason}` })
        localStorage.removeItem(CURSOR)
        schedulePull(200)
      }
    }
    setStatus({ state: Object.keys(dirty).length ? 'syncing' : 'synced', lastSync: new Date().toISOString(), error: undefined })
  } finally {
    pushing = false
  }
  if (Object.keys(dirty).length) schedulePush(1500)
}

let lastRejected: { entity: string; id: string; reason: string }[] = []
export const rejectedChanges = () => lastRejected

export async function syncNow() {
  if (!active) return
  if (!navigator.onLine) { setStatus({ state: 'offline' }); return }
  try {
    await push()
    await pull()
  } catch (e) { fail(e) }
}

/* ---------- Self-heal: re-upload local rows the cloud no longer has ---------- */
// Cloud rows are only ever soft-deleted, so a local row that is missing from the cloud
// (e.g. lost in a server-side wipe) and was synced before is re-uploaded from this device.
async function reconcile() {
  if (!active || !canWrite) return
  const server = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.rpc('record_keys').order('entity').order('id').range(from, from + 999)
    if (error) throw error
    const keys = (data || []) as unknown as { entity: string; id: string }[]
    keys.forEach((r) => server.add(keyOf(r.entity, r.id)))
    if (keys.length < 1000) break
  }
  // only rows that were synced before (never auto-upload pre-cloud local data)
  const syncedKeys = new Set((await db.synced.toCollection().primaryKeys()) as string[])
  const now = new Date().toISOString()
  let n = 0
  for (const e of MASTER) {
    const ids = (await db.table(e).toCollection().primaryKeys()) as string[]
    for (const id of ids) {
      const k = keyOf(e, id)
      if (server.has(k) || dirty[k] || !syncedKeys.has(k)) continue
      dirty[k] = now
      n++
    }
  }
  if (n) { saveDirty(); await push() }
}

/* ---------- Start / stop ---------- */
async function seedJobsIfEmpty() {
  if (!canWrite || (await db.jobs.count()) > 0) return
  await db.jobs.bulkPut(defaultJobRows())
}

const onOnline = () => { void syncNow() }
const onVisible = () => { if (document.visibilityState === 'visible') void syncNow() }

export async function startSync(userId: string, role: string, outlets = '') {
  if (active) stopSync()
  canWrite = ['super_admin', 'general_manager', 'hr_admin', 'hr_manager', 'admin', 'manager'].includes(role)
  canRemark = canWrite || role === 'outlet_manager'
  const scope = `${userId}|${role}|${outlets}`
  const prev = localStorage.getItem(SYNC_USER)
  if (prev !== scope) {
    // different account, role or outlets on this device: what this user may see changed → download again
    localStorage.removeItem(CURSOR)
    localStorage.setItem(SYNC_USER, scope)
    if (prev && prev.split('|')[0] !== userId) {
      // another person's copy is still on this device (e.g. the app was closed before sign-out finished): never show it
      await remoteTx(async () => {
        await Promise.all([db.workers.clear(), db.outlets.clear(), db.jobs.clear(), db.settings.clear(), db.remarks.clear(), db.synced.clear()])
      })
      dirty = {}
      saveDirty()
      localStorage.removeItem('fwm-requests')
      try { if ('caches' in window) await caches.delete('fwm-logos-v1') } catch { /* ignore */ }
    } else if (prev && prev.split('|')[0] === userId) {
      await remoteTx(async () => {
        const keep = new Set(Object.keys(dirty))
        await db.synced.where('key').startsWith('workers:').delete()
        await db.synced.where('key').startsWith('remarks:').delete()
        for (const e of ['workers', 'remarks'] as Entity[]) {
          const ids = ((await db.table(e).toCollection().primaryKeys()) as string[]).filter((id) => !keep.has(keyOf(e, id)))
          await db.table(e).bulkDelete(ids)
        }
      })
    }
  }
  active = true
  setStatus({ state: navigator.onLine ? 'syncing' : 'offline' })
  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onVisible)
  interval = setInterval(() => { void syncNow() }, 60000)
  channel = supabase
    .channel('records-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sync_ticks' }, () => schedulePull())
    .subscribe((st) => { if (st === 'SUBSCRIBED') schedulePull(0) })
  if (navigator.onLine) {
    try {
      await pull()
      await seedJobsIfEmpty()
      await push()
      await reconcile()
    } catch (e) { fail(e) }
  }
}

export function stopSync() {
  active = false
  clearTimeout(pushTimer); clearTimeout(pullTimer); clearInterval(interval)
  window.removeEventListener('online', onOnline)
  document.removeEventListener('visibilitychange', onVisible)
  if (channel) { void supabase.removeChannel(channel); channel = null }
  setStatus({ state: 'off' })
}

/** Wipe this device's copy (cloud data is untouched). */
export async function clearDeviceCopy() {
  await remoteTx(async () => {
    await Promise.all([db.workers.clear(), db.outlets.clear(), db.jobs.clear(), db.settings.clear(), db.remarks.clear(), db.synced.clear()])
  })
  dirty = {}
  saveDirty()
  localStorage.removeItem(CURSOR)
  try { if ('caches' in window) await caches.delete('fwm-logos-v1') } catch { /* ignore */ }
}

/* ---------- One-time migration of data entered before cloud sync ---------- */
export interface LocalOnly { workers: string[]; outlets: string[]; jobs: string[]; dupJobs: string[]; settings: boolean }
export async function localOnlyData(): Promise<LocalOnly> {
  const syncedKeys = new Set((await db.synced.toCollection().primaryKeys()) as string[])
  const isLocal = (e: Entity, id: string) => !syncedKeys.has(keyOf(e, id)) && !dirty[keyOf(e, id)]
  const workers = (await db.workers.toCollection().primaryKeys()).filter((id) => isLocal('workers', id))
  const outlets = (await db.outlets.toCollection().primaryKeys()).filter((id) => isLocal('outlets', id))
  const allJobs = await db.jobs.toArray()
  const cloudJobNames = new Set(allJobs.filter((j) => !isLocal('jobs', j.id)).map((j) => `${j.businessType}|${j.name.toLowerCase()}`))
  const localJobs = allJobs.filter((j) => isLocal('jobs', j.id))
  const jobs = localJobs.filter((j) => !cloudJobNames.has(`${j.businessType}|${j.name.toLowerCase()}`)).map((j) => j.id)
  const dupJobs = localJobs.filter((j) => cloudJobNames.has(`${j.businessType}|${j.name.toLowerCase()}`)).map((j) => j.id)
  const settings = !syncedKeys.has('settings:app') && !!(await db.settings.get('app'))
  return { workers, outlets, jobs, dupJobs, settings }
}
export async function uploadLocalData() {
  if (!canWrite) throw new Error('Only HR staff can upload data')
  const lo = await localOnlyData()
  const now = new Date().toISOString()
  const workers = await db.workers.bulkGet(lo.workers)
  workers.forEach((w) => { if (w) dirty[keyOf('workers', w.id)] = w.updatedAt && ms(w.updatedAt) ? w.updatedAt : now })
  lo.outlets.forEach((id) => { dirty[keyOf('outlets', id)] = now })
  lo.jobs.forEach((id) => { dirty[keyOf('jobs', id)] = now })
  if (lo.settings) dirty['settings:app'] = now
  // same job category already in the cloud: drop the local duplicate
  if (lo.dupJobs.length) await remoteTx(async () => { await db.jobs.bulkDelete(lo.dupJobs) })
  saveDirty()
  await push()
  await pull()
  return lo.workers.length
}
export async function discardLocalData() {
  const lo = await localOnlyData()
  await remoteTx(async () => {
    await db.workers.bulkDelete(lo.workers)
    await db.outlets.bulkDelete(lo.outlets)
    await db.jobs.bulkDelete([...lo.jobs, ...lo.dupJobs])
  })
}
