/* Government agencies & portals: quick "Check now" links per worker and a log of each manual status check.
 * There is NO public API for these portals today: staff open the official site, check, then record the result here. */
import { supabase } from './supabase'
import { daysUntil } from './util'
import type { Worker } from './types'

export interface Agency {
  id: string
  name: string
  short: string
  icon: string
  url: string
  enabled: boolean
  notes: string
  /** what to copy before opening the site */
  copy: ('passport' | 'nationality' | 'permit' | 'application' | 'workerNo')[]
  /** remind to re-check every N days (0 = no reminder) */
  remindDays: number
  /** placeholder for a future official API — kept disabled; no keys are stored */
  api?: { endpoint: string; enabled: false }
}
export interface AgenciesConfig { items: Agency[] }

export const API_NOTE = 'No public API is offered by this agency today. This field is a placeholder for a future official integration and stays switched off. Never paste passwords or API keys here.'

export const DEFAULT_AGENCIES: AgenciesConfig = {
  items: [
    { id: 'imi-fomema', name: 'Immigration — FOMEMA status check', short: 'FOMEMA status (IMI)', icon: '🩺', url: 'https://eservices.imi.gov.my/myimms/FomemaStatus?lang=en', enabled: true, notes: 'Check the worker’s FOMEMA medical result with the passport number and nationality.', copy: ['passport', 'nationality'], remindDays: 30 },
    { id: 'imi-app', name: 'Immigration — application status', short: 'Application status (IMI)', icon: '🛂', url: 'https://imigresen-online.imi.gov.my/eservices/main?pra', enabled: true, notes: 'Check a permit / pass application with the application or reference number.', copy: ['application', 'passport'], remindDays: 0 },
    { id: 'imi-epass', name: 'Immigration — ePass validity check', short: 'ePass check (IMI)', icon: '🪪', url: 'https://imigresen-online.imi.gov.my/eservices/checkEpassValid?semakan', enabled: true, notes: 'Check that the worker’s pass (PLKS) is valid.', copy: ['passport', 'nationality', 'permit'], remindDays: 0 },
    { id: 'fwcms', name: 'FWCMS (Foreign Worker Centralised Management System)', short: 'FWCMS', icon: '🏛️', url: 'https://fwcms.com.my/', enabled: true, notes: 'Employer login for PLKS renewals, levy and worker records.', copy: ['passport', 'permit'], remindDays: 0 },
    { id: 'fomema', name: 'FOMEMA employer portal (fomema2u)', short: 'FOMEMA portal', icon: '🏥', url: 'https://www.fomema2u.com.my/', enabled: true, notes: 'Register workers for the medical exam and see results.', copy: ['passport', 'nationality'], remindDays: 0 },
    { id: 'eppax', name: 'ePPAx (Immigration employer portal)', short: 'ePPAx', icon: '🧾', url: 'https://www.eppax.gov.my/eppax/login', enabled: true, notes: 'Employer portal for pass applications and payments.', copy: ['passport', 'application'], remindDays: 0 },
    { id: 'akta446', name: 'Act 446 portal (worker accommodation, JTKSM)', short: 'Act 446 (housing)', icon: '🏠', url: 'https://akta446.mohr.gov.my/login', enabled: true, notes: 'Certificate for Accommodation applications and records.', copy: [], remindDays: 0 },
    { id: 'myfuturejobs', name: 'MYFutureJobs (job adverts before hiring)', short: 'MYFutureJobs', icon: '📣', url: 'https://myfuturejobs.gov.my/', enabled: true, notes: 'Advertise vacancies to locals before applying for foreign workers.', copy: [], remindDays: 0 },
    { id: 'perkeso', name: 'PERKESO ASSIST (SOCSO employer portal)', short: 'PERKESO', icon: '🛡️', url: 'https://assist.perkeso.gov.my/', enabled: true, notes: 'Register workers and pay SOCSO contributions. The site may show a waiting-room queue at busy times.', copy: ['passport', 'workerNo'], remindDays: 0 },
    { id: 'kwsp', name: 'EPF i-Akaun Employer (KWSP)', short: 'EPF (KWSP)', icon: '🏦', url: 'https://secure.kwsp.gov.my/employer/employer/login', enabled: true, notes: 'Register workers and pay EPF contributions.', copy: ['passport', 'workerNo'], remindDays: 0 },
    { id: 'spikpa', name: 'SPIKPA (hospitalisation & surgical insurance)', short: 'SPIKPA', icon: '💊', url: 'https://spikpa.moh.gov.my/', enabled: true, notes: 'Check the worker’s SPIKPA insurance cover.', copy: ['passport', 'nationality'], remindDays: 0 },
  ],
}

/** keep saved settings, add any new default agencies, drop unknown shapes */
export function mergeAgencies(v: unknown): AgenciesConfig {
  const saved = (v && typeof v === 'object' && Array.isArray((v as AgenciesConfig).items)) ? (v as AgenciesConfig).items : []
  const out: Agency[] = DEFAULT_AGENCIES.items.map((d) => {
    const s = saved.find((x) => x && x.id === d.id)
    return s ? { ...d, ...s, copy: Array.isArray(s.copy) ? s.copy : d.copy, api: { endpoint: s.api?.endpoint || '', enabled: false } } : { ...d, api: { endpoint: '', enabled: false } }
  })
  for (const s of saved) if (s && s.id && !out.some((o) => o.id === s.id)) out.push({ ...s, copy: Array.isArray(s.copy) ? s.copy : [], api: { endpoint: s.api?.endpoint || '', enabled: false } })
  return { items: out }
}

export const isSafeUrl = (u: string) => /^https:\/\/[^\s/$.?#].[^\s]*$/i.test(u.trim())

/** CEO or HR Admin (server function, audited) */
export async function saveAgencies(cfg: AgenciesConfig) {
  for (const a of cfg.items) if (!isSafeUrl(a.url)) throw new Error(`${a.short}: the link must start with https://`)
  const { error } = await supabase.rpc('set_agencies', { p_value: cfg })
  if (error) throw new Error(/permission|not allowed|denied/i.test(error.message) ? 'Agency links are managed by the CEO, General Manager and HR Admin' : error.message)
}

/* ---------- per-worker status checks ---------- */
export const CHECK_STATUSES = ['OK / valid', 'Pending / in process', 'Action needed', 'Not found', 'Site not working'] as const
export interface AgencyCheck {
  id: string
  agency: string // Agency.id
  status: string
  date: string // YYYY-MM-DD
  by: string
  ref?: string
  note?: string
  docId?: string // screenshot in the vault
  at: string // ISO time recorded
}
export function lastCheck(w: Worker, agencyId: string): AgencyCheck | undefined {
  return (w.agencyChecks || []).filter((c) => c.agency === agencyId).sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at))[0]
}
/** days since the last check (null = never checked) */
export function daysSinceCheck(w: Worker, agencyId: string): number | null {
  const c = lastCheck(w, agencyId)
  if (!c) return null
  const n = daysUntil(c.date)
  return n === null ? null : -n
}
export const checkTone = (status?: string) => !status ? 'gray' : status.startsWith('OK') ? 'green' : status.startsWith('Pending') ? 'blue' : status.startsWith('Site') ? 'gray' : 'red'
