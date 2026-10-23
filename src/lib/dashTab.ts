import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

/** v1.2.3: the dashboard is split into tabs (deep link #/dashboard/<tab>; last tab remembered on this device). */
export type DashTab = 'overview' | 'expiries' | 'requests' | 'pay' | 'risk' | 'workforce'
const DASH_KEY = 'fwm-dash-tab'
export function useDashTab<T extends string>(ids: readonly T[], fallback: T): [T, (t: T) => void] {
  const { tab } = useParams<{ tab?: string }>()
  const nav = useNavigate()
  const saved = (typeof localStorage !== 'undefined' && localStorage.getItem(DASH_KEY)) || ''
  const cur = (ids as readonly string[]).includes(tab || '') ? (tab as T) : (ids as readonly string[]).includes(saved) ? (saved as T) : fallback
  const set = (t: T) => { try { localStorage.setItem(DASH_KEY, t) } catch { /* private mode */ } nav(`/dashboard/${t}`, { replace: true }); window.scrollTo(0, 0) }
  // keep the selected pill visible in the horizontally scrolling tab bar (phones)
  useEffect(() => { document.querySelector('.dash-tabs [role=tab][aria-selected=true]')?.scrollIntoView?.({ inline: 'center', block: 'nearest' }) }, [cur])
  return [cur, set]
}

