import type { Alert } from './calc'
import { todayISO } from './util'

const KEY = 'fwm-last-notified'

export const notifySupported = () => typeof window !== 'undefined' && 'Notification' in window

export async function requestNotify() {
  if (!notifySupported()) return 'unsupported'
  return Notification.requestPermission()
}

async function show(title: string, body: string) {
  const opts: NotificationOptions = { body, icon: `${import.meta.env.BASE_URL}icon-192.png`, badge: `${import.meta.env.BASE_URL}icon-192.png`, tag: 'fwm-daily' }
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg) return reg.showNotification(title, opts)
  } catch { /* fall back */ }
  new Notification(title, opts)
}

/** Fire one summary notification per day on app open for items due within lead time. */
export async function notifyOnOpen(alerts: Alert[], force = false) {
  if (!notifySupported() || Notification.permission !== 'granted') return
  if (!force && localStorage.getItem(KEY) === todayISO()) return
  const due = alerts.filter((a) => a.severity === 'critical' || a.severity === 'high')
  if (!due.length && !force) return
  localStorage.setItem(KEY, todayISO())
  const expired = due.filter((a) => a.days !== null && a.days < 0).length
  const lines = due.slice(0, 4).map((a) => `• ${a.workerName.replace(/^DEMO /, '')}: ${a.title}`)
  await show(`${due.length} urgent worker alert(s)${expired ? ` · ${expired} overdue/expired` : ''}`, lines.join('\n') + (due.length > 4 ? `\n+${due.length - 4} more` : '') || 'No urgent alerts')
}
