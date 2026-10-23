import { createClient } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'

// Public values only (safe in the browser). Secrets live in .secrets.env on the build machine, never here.
export const SUPABASE_URL = 'https://gnepquxtwkyffjmoydnv.supabase.co'
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImduZXBxdXh0d2t5ZmZqbW95ZG52Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2NTU3OTgsImV4cCI6MjEwODIzMTc5OH0.2TBdAtn3VPjOUTAALblkI6QqHMSz-ZbRyh-CPidX2jU'
export const VAPID_PUBLIC_KEY = 'BFxWzBVdmHyka3CH10iJ-fvw-QBm_l10dUzRk6NzRvqT7ftoUMIaS5JFEykEpyKoIEM0RbCmx7rQyLZthzr_ZrU'

// In the Android/iOS app keep the login in native storage (survives the OS clearing web storage).
const nativeStorage = {
  getItem: async (key: string) => (await Preferences.get({ key })).value,
  setItem: async (key: string, value: string) => { await Preferences.set({ key, value }) },
  removeItem: async (key: string) => { await Preferences.remove({ key }) },
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'fwm-auth', ...(Capacitor.isNativePlatform() ? { storage: nativeStorage } : {}) },
  realtime: { params: { eventsPerSecond: 10 } },
})

export type Role = 'admin' | 'manager' | 'viewer'
export interface Profile { id: string; email: string | null; full_name: string | null; role: Role; status: 'active' | 'pending' | 'inactive'; created_at: string }
