/* Light / dark / follow-the-phone theme (kept on this device). */
import { useSyncExternalStore } from 'react'
export type ThemePref = 'light' | 'dark' | 'system'
const KEY = 'fwm-theme'
const subs = new Set<() => void>()
const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null
export const getTheme = (): ThemePref => (localStorage.getItem(KEY) as ThemePref) || 'light'
export function applyTheme() {
  const p = getTheme()
  const dark = p === 'dark' || (p === 'system' && !!mq?.matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b1220' : '#0f766e')
}
export function setTheme(p: ThemePref) { localStorage.setItem(KEY, p); applyTheme(); subs.forEach((f) => f()) }
mq?.addEventListener?.('change', () => { applyTheme(); subs.forEach((f) => f()) })
export const isDark = () => document.documentElement.dataset.theme === 'dark'
export function useTheme(): ThemePref { return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb) }, getTheme) }
