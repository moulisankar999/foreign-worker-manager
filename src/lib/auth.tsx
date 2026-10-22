import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, type Profile } from './supabase'
import { clearDeviceCopy, startSync, stopSync } from './sync'

interface AuthCtx {
  session: Session | null
  profile: Profile | null
  loading: boolean
  canWrite: boolean
  isAdmin: boolean
  refreshProfile: () => Promise<void>
  signOut: (wipe?: boolean) => Promise<void>
}
const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx)
export const useAuth = () => useContext(Ctx)
const PROFILE_CACHE = 'fwm-profile'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(() => { try { return JSON.parse(localStorage.getItem(PROFILE_CACHE) || 'null') } catch { return null } })
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) { setProfile(null); localStorage.removeItem(PROFILE_CACHE); return }
    const { data, error } = await supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle()
    if (error) {
      // offline: keep the cached profile for this same user so the app still opens
      setProfile((p) => (p?.id === s.user.id ? p : null))
      return
    }
    setProfile(data as Profile | null)
    if (data) localStorage.setItem(PROFILE_CACHE, JSON.stringify(data))
  }, [])

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return
      setSession(data.session)
      await loadProfile(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((ev, s) => {
      setSession(s)
      if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT' || ev === 'USER_UPDATED') void loadProfile(s)
    })
    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [loadProfile])

  const active = !!session && profile?.status === 'active' && profile.id === session.user.id
  const role = active ? profile!.role : null
  useEffect(() => {
    if (active && session && role) void startSync(session.user.id, role)
    else stopSync()
  }, [active, session?.user.id, role]) // eslint-disable-line react-hooks/exhaustive-deps

  const signOut = async (wipe = true) => {
    stopSync()
    await supabase.auth.signOut().catch(() => {})
    if (wipe) await clearDeviceCopy()
    setProfile(null)
    localStorage.removeItem(PROFILE_CACHE)
  }

  return (
    <Ctx.Provider value={{
      session, profile, loading,
      canWrite: role === 'admin' || role === 'manager',
      isAdmin: role === 'admin',
      refreshProfile: () => loadProfile(session),
      signOut,
    }}>
      {children}
    </Ctx.Provider>
  )
}
