import Dexie, { type Table } from 'dexie'
import { BUSINESS_TYPES, DEFAULT_JOBS, DEFAULT_SETTINGS, type JobCategory, type Outlet, type Settings, type Worker } from './types'
import { uid } from './util'

class FwmDB extends Dexie {
  workers!: Table<Worker, string>
  outlets!: Table<Outlet, string>
  jobs!: Table<JobCategory, string>
  settings!: Table<Settings, string>
  synced!: Table<{ key: string; ts: number }, string>
  constructor() {
    super('foreign-worker-manager')
    this.version(1).stores({
      workers: 'id, workerNo, fullName, nationality, outletId, businessType, status, joinDate',
      outlets: 'id, name, type',
      jobs: 'id, name, businessType',
      settings: 'id',
    })
    // v2: remembers which records (and which version) came from / went to the cloud
    this.version(2).stores({ synced: 'key' })
  }
}

export const db = new FwmDB()

/** Local defaults only (not pushed to the cloud). Job categories are seeded after the first cloud download. */
export async function ensureSeed() {
  const s = await db.settings.get('app')
  if (!s) await db.transaction('rw', db.settings, async () => {
    (Dexie.currentTransaction as unknown as { __remote?: boolean }).__remote = true
    await db.settings.put(DEFAULT_SETTINGS)
  })
}
export function defaultJobRows(): JobCategory[] {
  const rows: JobCategory[] = []
  for (const bt of BUSINESS_TYPES) for (const name of DEFAULT_JOBS[bt]) rows.push({ id: uid(), name, businessType: bt })
  return rows
}

export async function saveWorker(w: Worker) {
  w.updatedAt = new Date().toISOString()
  await db.workers.put(w)
}

export async function updateWorker(id: string, fn: (w: Worker) => void) {
  const w = await db.workers.get(id)
  if (!w) return
  fn(w)
  await saveWorker(w)
}

export async function exportBackup() {
  return {
    app: 'foreign-worker-manager',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: await db.settings.toArray(),
    outlets: await db.outlets.toArray(),
    jobs: await db.jobs.toArray(),
    workers: await db.workers.toArray(),
  }
}

export async function importBackup(data: unknown, mode: 'replace' | 'merge') {
  const d = data as { app?: string; settings?: Settings[]; outlets?: Outlet[]; jobs?: JobCategory[]; workers?: Worker[] }
  if (!d || d.app !== 'foreign-worker-manager' || !Array.isArray(d.workers)) throw new Error('Not a valid Foreign Worker Manager backup file')
  await db.transaction('rw', db.workers, db.outlets, db.jobs, db.settings, async () => {
    if (mode === 'replace') await Promise.all([db.workers.clear(), db.outlets.clear(), db.jobs.clear(), db.settings.clear()])
    if (d.settings?.length) await db.settings.bulkPut(d.settings.map((s) => ({ ...DEFAULT_SETTINGS, ...s })))
    if (d.outlets) await db.outlets.bulkPut(d.outlets)
    if (d.jobs) await db.jobs.bulkPut(d.jobs)
    await db.workers.bulkPut(d.workers!)
  })
  await ensureSeed()
}


