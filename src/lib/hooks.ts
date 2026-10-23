import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db } from './db'
import { buildAlerts } from './calc'
import { setOutletCompanies } from './pay'
import { outletCompany } from './companies'
import { useConfig } from './config'
import { useAuth } from './auth'
import { DEFAULT_SETTINGS, type JobCategory, type Outlet, type Settings, type Worker } from './types'

const EMPTY_W: Worker[] = []
const EMPTY_O: Outlet[] = []
const EMPTY_J: JobCategory[] = []

export function useSettings(): Settings {
  const s = useLiveQuery(() => db.settings.get('app'), [])
  return useMemo(() => ({ ...DEFAULT_SETTINGS, ...(s || {}) }), [s])
}
export function useWorkers() {
  return useLiveQuery(() => db.workers.toArray(), []) ?? EMPTY_W
}
export function useWorkersLoaded() {
  return useLiveQuery(() => db.workers.toArray(), [])
}
export function useOutlets() {
  return useLiveQuery(() => db.outlets.orderBy('name').toArray(), []) ?? EMPTY_O
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
