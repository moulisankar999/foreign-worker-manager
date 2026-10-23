/**
 * Native (Android / iOS app) alerts: notifications are scheduled ON THE PHONE, so they arrive
 * at 08:00 Malaysia time even when the app is closed and offline. They are re-planned every time
 * the data changes (after each sync), so open the app now and then to keep them up to date.
 */
import { LocalNotifications, type LocalNotificationSchema } from '@capacitor/local-notifications'
import { buildAlerts, type Alert } from './calc'
import type { Settings, Worker } from './types'
import { addDays, fmtDate, todayISO, withToday } from './util'
import { platform } from './platform'

const CHANNEL = 'fwm-alerts'
const INFO_KEY = 'fwm-native-alerts'
const SUMMARY_DAYS = { android: 30, ios: 14 }
const MAX_TOTAL = { android: 300, ios: 60 } // iOS keeps at most 64 pending notifications per app

export interface ScheduleInfo { count: number; next?: string; at: string }
export const scheduleInfo = (): ScheduleInfo | null => { try { return JSON.parse(localStorage.getItem(INFO_KEY) || 'null') } catch { return null } }

/** 08:00 in Malaysia (UTC+8) on the given yyyy-mm-dd, whatever the phone's own time zone. */
function at8amMYT(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0))
}
/** "today" in Malaysia time */
function todayMYT() {
  const d = new Date(Date.now() + 8 * 3600 * 1000)
  return d.toISOString().slice(0, 10)
}
const short = (n: string) => n.replace(/^DEMO /, '')

export async function permissionState() {
  try { return (await LocalNotifications.checkPermissions()).display } catch { return 'denied' as const }
}

export async function enableNativeAlerts() {
  let p = await LocalNotifications.checkPermissions()
  if (p.display !== 'granted') p = await LocalNotifications.requestPermissions()
  if (p.display !== 'granted') throw new Error('Notifications are blocked. Open your phone Settings → Apps → FW Manager → Notifications and allow them.')
  await ensureChannel()
}

async function ensureChannel() {
  if (platform() !== 'android') return
  await LocalNotifications.createChannel({ id: CHANNEL, name: 'Worker alerts', description: 'Expiring documents, contracts, leave and tickets', importance: 4, visibility: 1, vibration: true })
}

interface Planned { day: string; title: string; body: string; kind: 'item' | 'summary' }

/** Build the list of future reminders (pure — easy to test). */
export function planReminders(workers: Worker[], s: Settings, today = todayMYT(), days = 30): Planned[] {
  const out: Planned[] = []
  const lead = [...new Set([...s.leadTimes, 0])].filter((n) => n >= 0).sort((a, b) => b - a)
  const last = addDays(today, 400)
  // every dated item, regardless of lead time
  const dated = withToday(today, () => buildAlerts(workers, { ...s, leadTimes: [100000] })).filter((a) => a.date && a.date >= today)
  const add = (day: string, title: string, a: Alert, extra = '') => { if (day >= today && day <= last) out.push({ day, title, body: `${short(a.workerName)} (${a.workerNo}) · ${fmtDate(a.date)}${extra}`, kind: 'item' }) }
  for (const a of dated) {
    const p = a.id.split('-')[0]
    if (p === 'doc' || p === 'contract') {
      const what = p === 'contract' ? 'Contract' : a.title.replace(/ (expiring|expired)$/, '')
      const verb = p === 'contract' ? 'ends' : 'expires'
      for (const t of lead) add(addDays(a.date!, -t), t === 0 ? `${what} ${verb} TODAY` : `${what} ${verb} in ${t} days`, a)
    } else if (p === 'ticketsoon') add(a.date!, 'Eligible for flight ticket today', a)
    else if (p === 'mincontract') add(a.date!, 'Minimum contract completed today', a, ' — no early-exit penalty from now')
    else if (p === 'dueback') {
      add(a.date!, 'Due back from leave today', a)
      add(addDays(a.date!, s.overdueGraceDays + 1), 'Not back from leave?', a, ' — check if the worker has returned')
    }
  }
  // daily morning summary (computed as of each future day)
  for (let i = 0; i < days; i++) {
    const day = addDays(today, i)
    const urgent = withToday(day, () => buildAlerts(workers, s)).filter((a) => a.severity === 'critical' || a.severity === 'high')
    if (!urgent.length) continue
    const lines = urgent.slice(0, 4).map((a) => `• ${short(a.workerName)}: ${a.title}`)
    out.push({ day, kind: 'summary', title: `${urgent.length} urgent worker alert(s)`, body: lines.join('\n') + (urgent.length > 4 ? `\n+${urgent.length - 4} more — open FW Manager` : '') })
  }
  return out
}

let timer: ReturnType<typeof setTimeout> | undefined
/** Debounced re-plan after data changes. Does nothing until the user has allowed notifications. */
export function rescheduleSoon(workers: Worker[], s: Settings) {
  clearTimeout(timer)
  timer = setTimeout(() => { void reschedule(workers, s).catch((e) => console.warn('reschedule failed', e)) }, 2500)
}

export async function reschedule(workers: Worker[], s: Settings) {
  if ((await permissionState()) !== 'granted') return null
  await ensureChannel()
  const plat = platform() === 'ios' ? 'ios' : 'android'
  const now = Date.now() + 60_000
  const planned = planReminders(workers, s, todayMYT(), SUMMARY_DAYS[plat])
    .map((p) => ({ ...p, at: at8amMYT(p.day) }))
    .filter((p) => p.at.getTime() > now)
    .sort((a, b) => a.at.getTime() - b.at.getTime() || (a.kind === 'summary' ? -1 : 1))
  // keep every summary, then the soonest item reminders up to the platform limit
  const summaries = planned.filter((p) => p.kind === 'summary')
  const items = planned.filter((p) => p.kind === 'item').slice(0, Math.max(0, MAX_TOTAL[plat] - summaries.length))
  const chosen = [...summaries, ...items].sort((a, b) => a.at.getTime() - b.at.getTime())
  const pending = await LocalNotifications.getPending()
  if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) })
  const list: LocalNotificationSchema[] = chosen.map((p, i) => ({
    id: i + 1, title: p.title, body: p.body, largeBody: p.body, summaryText: p.kind === 'summary' ? 'Daily summary' : undefined,
    schedule: { at: p.at, allowWhileIdle: true }, channelId: CHANNEL, group: 'fwm', extra: { route: '/alerts' },
  }))
  for (let i = 0; i < list.length; i += 100) await LocalNotifications.schedule({ notifications: list.slice(i, i + 100) })
  const info: ScheduleInfo = { count: list.length, next: chosen[0]?.at.toISOString(), at: new Date().toISOString() }
  localStorage.setItem(INFO_KEY, JSON.stringify(info))
  return info
}

export async function sendTestNotification() {
  await enableNativeAlerts()
  await LocalNotifications.schedule({ notifications: [{ id: 999999, title: 'FW Manager test alert ✅', body: `Phone alerts work. Daily reminders arrive at 8:00 AM Malaysia time. (${todayISO()})`, schedule: { at: new Date(Date.now() + 3000), allowWhileIdle: true }, channelId: CHANNEL, extra: { route: '/alerts' } }] })
}

/** Tapping a notification opens the Alerts page. */
export function listenForTaps() {
  void LocalNotifications.addListener('localNotificationActionPerformed', (e) => {
    const route = (e.notification.extra as { route?: string } | undefined)?.route || '/alerts'
    window.location.hash = '#' + route
  })
}
