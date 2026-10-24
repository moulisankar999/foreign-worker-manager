/* Demo company for Apple's App Review (id demo-apple, or any company marked "demo": true). Its outlets and workers
 * stay in the database (never deleted) but are left out of the CEO / GM / HR dashboard totals, compliance counts,
 * alerts and reports unless the CEO switches on "Show demo data". People scoped to the demo company (the review
 * login) see it as normal. The server applies the same rule to notifications and daily alerts (migration 019). */
import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useSyncExternalStore } from 'react'
import { db } from './db'
import { getConfig } from './config'
import { useAuth } from './auth'
import type { Outlet } from './types'

export const DEMO_COMPANY_IDS = ['demo-apple']
export const isDemoCompany = (id?: string | null) =>
  !!id && (DEMO_COMPANY_IDS.includes(id) || !!getConfig().companies.items.find((c) => c.id === id)?.demo)
export const isDemoOutlet = (o?: Pick<Outlet, 'companyId'> | null) => !!o && isDemoCompany(o.companyId)

const KEY = 'fwm-show-demo'
let show = (() => { try { return localStorage.getItem(KEY) === '1' } catch { return false } })()
const subs = new Set<() => void>()
export function setShowDemo(v: boolean) {
  show = v
  try { localStorage.setItem(KEY, v ? '1' : '0') } catch { /* ignore */ }
  subs.forEach((f) => f())
}
export const useShowDemo = () => useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb) }, () => show)

/** demo outlet ids on this device (all outlets, including hidden ones) */
export async function demoOutletIds(): Promise<Set<string>> {
  return new Set((await db.outlets.toArray()).filter(isDemoOutlet).map((o) => o.id))
}
export function useDemoOutletIds(): Set<string> {
  const ids = useLiveQuery(async () => [...(await demoOutletIds())].sort().join('|'), [])
  return useMemo(() => new Set((ids || '').split('|').filter(Boolean)), [ids])
}

/** should demo data be left out for me? Yes unless I am the CEO with "Show demo data" on, or my own scope is the demo company. */
export function useHideDemo(): boolean {
  const { isSuper, myCompanies, myOutlets } = useAuth()
  const on = useShowDemo()
  const mine = useLiveQuery(async () => {
    if (myCompanies.some(isDemoCompany)) return true
    if (!myOutlets.length) return false
    const ids = await demoOutletIds()
    return myOutlets.some((o) => ids.has(o))
  }, [myCompanies.join(','), myOutlets.join(',')])
  if (isSuper && on) return false
  return !mine
}
