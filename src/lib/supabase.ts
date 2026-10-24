import { createClient } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { registerErrorClient, trackedFetch } from './errorCapture'

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseConfig'
export { SUPABASE_URL, SUPABASE_ANON_KEY, IS_TEST_BUILD } from './supabaseConfig'
export const VAPID_PUBLIC_KEY = 'BFxWzBVdmHyka3CH10iJ-fvw-QBm_l10dUzRk6NzRvqT7ftoUMIaS5JFEykEpyKoIEM0RbCmx7rQyLZthzr_ZrU'

// In the Android/iOS app keep the login in native storage (survives the OS clearing web storage).
export const AUTH_KEY = 'fwm-auth'
const nativeStorage = {
  getItem: async (key: string) => (await Preferences.get({ key })).value,
  setItem: async (key: string, value: string) => { await Preferences.set({ key, value }) },
  removeItem: async (key: string) => { await Preferences.remove({ key }) },
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: AUTH_KEY, ...(Capacitor.isNativePlatform() ? { storage: nativeStorage } : {}) },
  realtime: { params: { eventsPerSecond: 10 } },
  global: { fetch: trackedFetch },
})
registerErrorClient(supabase)

export type Role = 'super_admin' | 'general_manager' | 'hr_admin' | 'hr_manager' | 'outlet_manager' | 'viewer'
export interface Profile {
  id: string; email: string | null; full_name: string | null; role: Role; status: 'active' | 'pending' | 'inactive' | 'paused' | 'deleted'; created_at: string
  outlet_ids?: string[]; phone?: string | null; notify_optout?: string[]; wa_optin?: boolean; wa_optin_at?: string | null
  company_ids?: string[]; requested_company_id?: string | null; requested_outlet_id?: string | null
  approved_by?: string | null; approved_by_name?: string | null; approved_by_role?: string | null; approved_at?: string | null
  added_by?: string | null; added_by_name?: string | null; added_by_role?: string | null; added_at?: string | null
  rejected_by?: string | null; rejected_by_name?: string | null; rejected_by_role?: string | null; rejected_at?: string | null; reject_reason?: string | null
  paused_at?: string | null; paused_by_name?: string | null; pause_reason?: string | null; resumed_at?: string | null; resumed_by_name?: string | null
  deleted_at?: string | null; deleted_by_name?: string | null; must_change_password?: boolean; pw_reset_at?: string | null; pw_reset_by_name?: string | null
}

/** Remove any stored login token on this device (web storage and the app's native storage). */
export async function forgetStoredSession() {
  for (const k of Object.keys(localStorage)) if (k === AUTH_KEY || k.startsWith(AUTH_KEY + '-') || (k.startsWith('sb-') && k.includes('auth'))) localStorage.removeItem(k)
  if (Capacitor.isNativePlatform()) {
    await nativeStorage.removeItem(AUTH_KEY).catch(() => {})
    await nativeStorage.removeItem(AUTH_KEY + '-code-verifier').catch(() => {})
  }
}
