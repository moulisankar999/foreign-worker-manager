import type { Alert } from './calc'
import { addDays } from './util'

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
const d8 = (iso: string) => iso.replace(/-/g, '').slice(0, 8)

export function buildICS(alerts: Alert[], reminderDays = 30) {
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
  const events = alerts.filter((a) => a.date).map((a) => [
    'BEGIN:VEVENT',
    `UID:${a.id}@foreign-worker-manager`,
    `DTSTAMP:${now}`,
    `DTSTART;VALUE=DATE:${d8(a.date!)}`,
    `DTEND;VALUE=DATE:${d8(addDays(a.date!, 1))}`,
    `SUMMARY:${esc(`${a.title} — ${a.workerName} (${a.workerNo})`)}`,
    `DESCRIPTION:${esc(a.detail)}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(a.title)}`, `TRIGGER:-P${reminderDays}D`, 'END:VALARM',
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(a.title)}`, 'TRIGGER:-P7D', 'END:VALARM',
    'END:VEVENT',
  ].join('\r\n'))
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Foreign Worker Manager//EN', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR'].join('\r\n')
}
