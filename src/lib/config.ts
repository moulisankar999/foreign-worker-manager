/* Company-wide configuration kept in the cloud table app_config (Super Admin edits, everyone reads).
 * Cached on the device so the app still works offline. Live-updated through realtime. */
import { useSyncExternalStore } from 'react'
import { supabase } from './supabase'
import { DEFAULT_EMERGENCY_REASONS, DEFAULT_HR_FLAGS, DEFAULT_VAULT, defaultRules, type ApprovalRules, type EmergencyReason, type HrAdminFlags, type VaultConfig } from './workflow'
import { DEFAULT_NOTIFY, type NotifyConfig } from './notifyEvents'
import { DEFAULT_CONSENT_TRANSLATIONS, type ConsentTranslationsConfig } from './consentText'
import { DEFAULT_COMPANIES, DEFAULT_USER_APPROVALS, type CompaniesConfig, type UserApprovalsConfig } from './companies'

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
}
const DEFAULTS: AppConfig = {
  approval_rules: defaultRules(), hr_admin: DEFAULT_HR_FLAGS, vault: DEFAULT_VAULT, emergency_reasons: DEFAULT_EMERGENCY_REASONS,
  notifications: DEFAULT_NOTIFY, passport: DEFAULT_PASSPORT, wa_templates: { items: {}, syncedAt: null },
  companies: DEFAULT_COMPANIES, user_approvals: DEFAULT_USER_APPROVALS, consent_translations: DEFAULT_CONSENT_TRANSLATIONS,
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
/** Super Admin only (the database refuses everyone else). */
export async function saveConfig<K extends keyof AppConfig>(key: K, value: AppConfig[K]) {
  const { error } = await supabase.from('app_config').upsert({ key, value })
  if (error) throw new Error(error.message.includes('row-level') ? 'Only a Super Admin can change this setting' : error.message)
  set({ ...raw, [key]: value })
}
export const getConfig = () => cfg
export function useConfig(): AppConfig {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb) }, () => cfg)
}
export const allVaultCategories = (v: VaultConfig, base: string[]) => [...base.filter((c) => c !== 'Other'), ...v.extraCategories.filter((c) => !base.includes(c)), 'Other']

/** Super Admin or HR Admin: correct the consent-form translation for one language (server function, audited).
 *  Pass null to go back to the built-in translation. */
export async function saveConsentTranslation(lang: string, entry: import('./consentText').ConsentOverride | null) {
  const { data, error } = await supabase.rpc('set_consent_translation', { p_lang: lang, p_text: entry })
  if (error) throw new Error(/permission|not allowed|denied/i.test(error.message) ? 'Only a Super Admin or HR Admin can change translations' : error.message)
  set({ ...raw, consent_translations: data ?? raw.consent_translations })
}
