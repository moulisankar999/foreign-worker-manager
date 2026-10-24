import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db } from './db'
import { buildAlerts } from './calc'
import { setOutletCompanies } from './pay'
import { outletCompany } from './companies'
import { useConfig } from './config'
import { useAuth } from './auth'
import { demoOutletIds, isDemoOutlet, useHideDemo } from './demo'
import { DEFAULT_SETTINGS, type JobCategory, type Outlet, type Settings, type Worker } from './types'

const EMPTY_W: Worker[] = []
const EMPTY_O: Outlet[] = []
const EMPTY_J: JobCategory[] = []

export function useSettings(): Settings {
  const s = useLiveQuery(() => db.settings.get('app'), [])
  return useMemo(() => ({ ...DEFAULT_SETTINGS, ...(s || {}) }), [s])
}
/** workers on this device; the demo company's workers are left out unless useHideDemo() says otherwise */
async function loadWorkers(hide: boolean) {
  const ws = await db.workers.toArray()
  if (!hide) return ws
  const demo = await demoOutletIds()
  return demo.size ? ws.filter((w) => !demo.has(w.outletId || '')) : ws
}
export function useWorkers() {
  const hide = useHideDemo()
  return useLiveQuery(() => loadWorkers(hide), [hide]) ?? EMPTY_W
}
export function useWorkersLoaded() {
  const hide = useHideDemo()
  return useLiveQuery(() => loadWorkers(hide), [hide])
}
export function useOutlets() {
  const hide = useHideDemo()
  return useLiveQuery(async () => {
    const os = await db.outlets.orderBy('name').toArray()
    return hide ? os.filter((o) => !isDemoOutlet(o)) : os
  }, [hide]) ?? EMPTY_O
}
export function useJobs() {
  return useLiveQuery(() => db.jobs.toArray(), []) ?? EMPTY_J
}
export function useAlerts() {
  const w = useWorkers()
  const s = useSettings()
  const cfg = useConfig()
  const ag = cfg.agencies
  const outlets = useOutlets()
  const { canSeeSalary } = useAuth()
  return useMemo(() => {
    setOutletCompanies(Object.fromEntries(outlets.map((o) => [o.id, outletCompany(o)])))
    return buildAlerts(w, s, ag.items)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, s, ag, canSeeSalary, cfg.rates, cfg.hostels, cfg.trackers, cfg.companies, outlets])
}
