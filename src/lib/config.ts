/* Company-wide configuration kept in the cloud table app_config (CEO edits, everyone reads).
 * Cached on the device so the app still works offline. Live-updated through realtime. */
import { useSyncExternalStore } from 'react'
import { supabase } from './supabase'
import { DEFAULT_EMERGENCY_REASONS, DEFAULT_HR_FLAGS, DEFAULT_VAULT, defaultRules, type ApprovalRules, type EmergencyReason, type HrAdminFlags, type VaultConfig } from './workflow'
import { DEFAULT_NOTIFY, type NotifyConfig } from './notifyEvents'
import { DEFAULT_CONSENT_TRANSLATIONS, type ConsentTranslationsConfig } from './consentText'
import { DEFAULT_AGENCIES, mergeAgencies, type AgenciesConfig } from './agencies'
import { DEFAULT_HOLIDAYS, DEFAULT_RATES, type HolidaysConfig, type RatesConfig } from './pay'
import { DEFAULT_COMPANIES, DEFAULT_USER_APPROVALS, type CompaniesConfig, type UserApprovalsConfig } from './companies'
import { DEFAULT_HIRING, DEFAULT_HOSTELS, DEFAULT_TRACKERS, type HiringConfig, type HostelsConfig, type TrackersConfig } from './trackers'
import type { ZcOverride, ZcTranslationsConfig } from './zeroCostText'

export interface PassportConfig { turnaroundHours: number; overdueGraceDays: number; logo?: string; companyShort?: string; witnessTitle?: string }
export const DEFAULT_PASSPORT: PassportConfig = { turnaroundHours: 24, overdueGraceDays: 0, witnessTitle: 'Outlet Manager' }

export interface AppConfig {
  approval_rules: ApprovalRules
  hr_admin: HrAdminFlags
  vault: VaultConfig
  emergency_reasons: EmergencyReason[]
  notifications: NotifyConfig
  passport: PassportConfig
  wa_templates: { items: Record<string, { status: string; reason?: string | null }>; syncedAt: string | null }
  companies: CompaniesConfig
  user_approvals: UserApprovalsConfig
  consent_translations: ConsentTranslationsConfig
  agencies: AgenciesConfig
  /** pay & contribution rates, effective-dated (Settings → Pay & Leave rules) */
  rates: RatesConfig
  /** public holidays per year and state */
  holidays: HolidaysConfig
  /** v1.2.2: hostel register (Act 446), hiring tracker, tracker rules, zero-cost declaration translations */
  hostels: HostelsConfig
  hiring: HiringConfig
  trackers: TrackersConfig
  zerocost_translations: ZcTranslationsConfig
}
const DEFAULTS: AppConfig = {
  approval_rules: defaultRules(), hr_admin: DEFAULT_HR_FLAGS, vault: DEFAULT_VAULT, emergency_reasons: DEFAULT_EMERGENCY_REASONS,
  notifications: DEFAULT_NOTIFY, passport: DEFAULT_PASSPORT, wa_templates: { items: {}, syncedAt: null },
  companies: DEFAULT_COMPANIES, user_approvals: DEFAULT_USER_APPROVALS, consent_translations: DEFAULT_CONSENT_TRANSLATIONS,
  agencies: DEFAULT_AGENCIES, rates: DEFAULT_RATES, holidays: DEFAULT_HOLIDAYS,
  hostels: DEFAULT_HOSTELS, hiring: DEFAULT_HIRING, trackers: DEFAULT_TRACKERS, zerocost_translations: { items: {} },
}
const CACHE = 'fwm-config'
let cfg: AppConfig = load()
const subs = new Set<() => void>()
let channel: ReturnType<typeof supabase.channel> | null = null

function merge(raw: Partial<Record<keyof AppConfig, unknown>>): AppConfig {
  const out = { ...DEFAULTS } as Record<string, unknown>
  for (const k of Object.keys(DEFAULTS) as (keyof AppConfig)[]) {
    const v = raw[k]
    if (v === undefined || v === null) continue
    const d = DEFAULTS[k]
    out[k] = Array.isArray(d) ? v : { ...(d as object), ...(v as object) }
  }
  const n = out.notifications as NotifyConfig
  out.notifications = { ...DEFAULT_NOTIFY, ...n, enabled: { ...DEFAULT_NOTIFY.enabled, ...(n.enabled || {}) }, events: { ...DEFAULT_NOTIFY.events, ...(n.events || {}) } }
  const c = out.companies as CompaniesConfig
  if (!Array.isArray(c.items) || !c.items.length) out.companies = DEFAULT_COMPANIES
  const ct = out.consent_translations as ConsentTranslationsConfig
  if (!ct.items || typeof ct.items !== 'object') out.consent_translations = DEFAULT_CONSENT_TRANSLATIONS
  out.agencies = mergeAgencies(raw.agencies)
  const r = out.rates as RatesConfig
  out.rates = { ...DEFAULT_RATES, ...r, leave: { ...DEFAULT_RATES.leave, ...(r.leave || {}) } }
  for (const k of ['minWage', 'epf', 'socso', 'lindung', 'hostelCap', 'ot'] as const) if (!Array.isArray((out.rates as RatesConfig)[k])) ((out.rates as unknown) as Record<string, unknown>)[k] = DEFAULT_RATES[k]
  // add new built-in rate steps (e.g. the announced 2027 minimum wage) to a saved list once; a deleted step stays deleted
  const rr = out.rates as RatesConfig & { knownDefaults?: string[] }
  const known = Array.isArray(rr.knownDefaults) ? rr.knownDefaults : []
  const mwKnown = DEFAULT_RATES.minWage.filter((d) => !known.includes('minWage:' + d.from) && !rr.minWage.some((x) => x.from === d.from) && d.from > '2026-10-01')
  if (mwKnown.length) rr.minWage = [...rr.minWage, ...mwKnown]
  rr.knownDefaults = [...new Set([...known, ...DEFAULT_RATES.minWage.map((d) => 'minWage:' + d.from)])]
  if (!Array.isArray(rr.smeCompanies)) rr.smeCompanies = []
  for (const k of ['hostels', 'hiring'] as const) { const v = out[k] as { items?: unknown }; if (!Array.isArray(v?.items)) out[k] = { items: [] } }
  const t = out.trackers as TrackersConfig
  out.trackers = { ...DEFAULT_TRACKERS, ...t, costDefaults: { ...DEFAULT_TRACKERS.costDefaults, ...(t.costDefaults || {}) } }
  const zc = out.zerocost_translations as { items?: unknown }
  if (!zc.items || typeof zc.items !== 'object') out.zerocost_translations = { items: {} }
  const h = out.holidays as HolidaysConfig
  if (!h.years || typeof h.years !== 'object') out.holidays = DEFAULT_HOLIDAYS
  return out as unknown as AppConfig
}
function load(): AppConfig {
  try { return merge(JSON.parse(localStorage.getItem(CACHE) || '{}')) } catch { return DEFAULTS }
}
let raw: Record<string, unknown> = (() => { try { return JSON.parse(localStorage.getItem(CACHE) || '{}') } catch { return {} } })()
function set(next: Record<string, unknown>) {
  raw = next
  localStorage.setItem(CACHE, JSON.stringify(raw))
  cfg = merge(raw)
  subs.forEach((f) => f())
}

export async function refreshConfig() {
  const { data, error } = await supabase.from('app_config').select('key,value')
  if (error || !data) return
  set(Object.fromEntries(data.map((r) => [r.key, r.value])))
}
export function startConfig() {
  void refreshConfig()
  if (channel) return
  channel = supabase.channel('config-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'app_config' }, (p) => {
      const row = p.new as { key?: string; value?: unknown }
      if (row?.key) set({ ...raw, [row.key]: row.value })
    })
    .subscribe()
}
export function stopConfig() {
  if (channel) { void supabase.removeChannel(channel); channel = null }
}
/** CEO only (the database refuses everyone else). */
export async function saveConfig<K extends keyof AppConfig>(key: K, value: AppConfig[K]) {
  const { error } = await supabase.from('app_config').upsert({ key, value })
  if (error) throw new Error(error.message.includes('row-level') ? 'Only the CEO (or a General Manager allowed to) can change this setting' : error.message)
  set({ ...raw, [key]: value })
}
export const getConfig = () => cfg
export function useConfig(): AppConfig {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb) }, () => cfg)
}
export const allVaultCategories = (v: VaultConfig, base: string[]) => [...base.filter((c) => c !== 'Other'), ...v.extraCategories.filter((c) => !base.includes(c)), 'Other']

/** CEO or HR Admin: correct the consent-form translation for one language (server function, audited).
 *  Pass null to go back to the built-in translation. */
/** after the server saved the agency list (set_agencies) */
export function setAgenciesLocal(v: AgenciesConfig) { set({ ...raw, agencies: v }) }

export async function saveConsentTranslation(lang: string, entry: import('./consentText').ConsentOverride | null) {
  const { data, error } = await supabase.rpc('set_consent_translation', { p_lang: lang, p_text: entry })
  if (error) throw new Error(/permission|not allowed|denied/i.test(error.message) ? 'Only the CEO, General Manager or HR Admin can change translations' : error.message)
  set({ ...raw, consent_translations: data ?? raw.consent_translations })
}

/** CEO, HR Admin or a General Manager with the compliance power: save pay rates or the holiday list (server function, audited). */
export async function savePayConfig<K extends 'rates' | 'holidays'>(key: K, value: AppConfig[K]) {
  const { data, error } = await supabase.rpc('set_pay_config', { p_key: key, p_value: value })
  if (error) throw new Error(/permission|not allowed|denied/i.test(error.message) ? 'Only the CEO, HR Admin or a General Manager with this power can change pay rules' : error.message)
  set({ ...raw, [key]: data ?? value })
}

/** HR / CEO: save the hostel register, the hiring tracker or (CEO / HR Admin / GM) the tracker rules (server function, audited). */
export async function saveTrackerConfig<K extends 'hostels' | 'hiring' | 'trackers'>(key: K, value: AppConfig[K]) {
  const { error } = await supabase.rpc('set_tracker_config', { p_key: key, p_value: value })
  if (error) throw new Error(error.message)
  set({ ...raw, [key]: value })
}
/** CEO / HR Admin / GM: correct a translation of the zero-cost declaration (null = back to the built-in text). */
export async function saveFormTranslation(form: 'zerocost', lang: string, entry: ZcOverride | null) {
  const { error } = await supabase.rpc('set_form_translation', { p_form: form, p_lang: lang, p_text: entry })
  if (error) throw new Error(error.message)
  await refreshConfig()
}
