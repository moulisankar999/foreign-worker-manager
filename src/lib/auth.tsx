import { setPayAlertsVisible } from './calc'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { forgetStoredSession, supabase, type Profile, type Role } from './supabase'
import { clearDeviceCopy, startSync, stopSync } from './sync'
import { startConfig, stopConfig, useConfig } from './config'
import { ruleFor } from './companies'
import { disablePush } from './push'
import { isNative } from './platform'
import { cancelNativeAlerts } from './localNotify'
import { withDefaults, type PowerMap } from './powers'
import type { ApprovalRoute } from './workflow'

export interface Perms {
  role: Role | null
  isSuper: boolean // CEO (internal role key super_admin)
  isCeo: boolean // same as isSuper
  isGm: boolean // General Manager
  /** CEO, or a General Manager the CEO allowed this power (see lib/powers.ts). Always false for other roles. */
  can: (power: string) => boolean
  /** CEO or General Manager with this power: the "top" admin checks that used to be Super-Admin-only */
  top: (power: string) => boolean
  powers: PowerMap
  route: ApprovalRoute | null
  isHrAdmin: boolean
  isHr: boolean // HR Manager, HR Admin or CEO (staff who keep worker records)
  isOM: boolean // Outlet Manager (only his outlets)
  canWrite: boolean // edit worker master data, outlets, settings
  isAdmin: boolean // manage users
  canSeeSalary: boolean
  canDeleteWorkers: boolean
  canRequest: boolean // raise requests, add remarks
  canSeeAudit: boolean
  myOutlets: string[]
  myCompanies: string[]
  /** CEO, or an HR Admin the CEO allowed to approve new sign-ups */
  canApproveUsers: boolean
  /** roles I may add with "Add user" (always below my own; the server re-checks) */
  creatableRoles: Role[]
}
interface AuthCtx extends Perms {
  session: Session | null
  profile: Profile | null
  loading: boolean
  refreshProfile: () => Promise<void>
  signOut: (wipe?: boolean) => Promise<void>
}
const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx)
export const useAuth = () => useContext(Ctx)
const PROFILE_CACHE = 'fwm-profile'
/** per-user caches on this device (removed on sign-out so the next person starts clean) */
const USER_CACHES = ['fwm-powers', 'fwm-config', 'fwm-requests', 'fwm-sync-user', 'fwm-native-alerts', 'fwm-last-notified', 'fwm-dirty', 'fwm-cursor']
/** accounts created before roles existed */
export const normRole = (r?: string | null): Role | null => (r === 'admin' ? 'super_admin' : r === 'manager' ? 'hr_manager' : (r as Role) || null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(() => { try { return JSON.parse(localStorage.getItem(PROFILE_CACHE) || 'null') } catch { return null } })
  const [loading, setLoading] = useState(true)
  const cfg = useConfig()

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
  const role = active ? normRole(profile!.role) : null
  // live profile changes (role / outlets switched by an admin) apply without signing out
  useEffect(() => {
    if (!active || !session) return
    const ch = supabase.channel('my-profile').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${session.user.id}` }, () => { void loadProfile(session) }).subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [active, session?.user.id]) // eslint-disable-line react-hooks/exhaustive-deps
  // the sync scope: re-download workers when the role, outlets or companies change
  const outletKey = (profile?.outlet_ids || []).join(',') + (profile?.company_ids?.length ? '/' + profile.company_ids.join(',') : '')
  useEffect(() => {
    if (active && session && role) { startConfig(); void startSync(session.user.id, role, outletKey) }
    else { stopSync(); stopConfig() }
  }, [active, session?.user.id, role, outletKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const signOut = async (wipe = true) => {
    stopSync(); stopConfig()
    if (wipe) {
      // this phone/browser stops receiving the previous user's alerts
      await Promise.race([disablePush().catch(() => {}), new Promise((r) => setTimeout(r, 3000))])
      if (isNative()) await cancelNativeAlerts().catch(() => {})
    }
    const { error } = await supabase.auth.signOut().catch((e) => ({ error: e }))
    if (error) await supabase.auth.signOut({ scope: 'local' }).catch(() => {}) // offline: still forget the session here
    await forgetStoredSession() // belt and braces: no stored login may survive a sign-out
    if (wipe) {
      await clearDeviceCopy().catch(() => {})
      USER_CACHES.forEach((k) => localStorage.removeItem(k))
      sessionStorage.clear()
    }
    setProfile(null)
    setSession(null)
    localStorage.removeItem(PROFILE_CACHE)
    // start fresh at the login screen: drops every in-memory copy of the previous user's data
    if (wipe) window.location.replace(window.location.pathname + window.location.search + '#/')
  }
  // GM powers (my_powers) and who gives final approval (approval_route); refreshed live when the CEO changes them
  const [pw, setPw] = useState<{ powers: PowerMap; route: ApprovalRoute | null }>(() => { try { return JSON.parse(localStorage.getItem('fwm-powers') || 'null') || { powers: {}, route: null } } catch { return { powers: {}, route: null } } })
  const loadPowers = useCallback(async () => {
    const [a, b] = await Promise.all([supabase.rpc('my_powers'), supabase.rpc('approval_route')])
    if (a.error || b.error) return
    const v = { powers: (a.data || {}) as PowerMap, route: (b.data || null) as ApprovalRoute | null }
    setPw(v); localStorage.setItem('fwm-powers', JSON.stringify(v))
  }, [])
  const topRole = role === 'super_admin' || role === 'general_manager'
  useEffect(() => {
    if (!active || !topRole) return
    void loadPowers()
    const ch = supabase.channel('my-powers').on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => { void loadPowers() }).subscribe()
    const t = window.setInterval(() => { void loadPowers() }, 60000)
    const onFocus = () => { void loadPowers() }
    window.addEventListener('focus', onFocus)
    return () => { void supabase.removeChannel(ch); window.clearInterval(t); window.removeEventListener('focus', onFocus) }
  }, [active, topRole, role, loadPowers])
  const flags = cfg.hr_admin
  const isSuper = role === 'super_admin'
  const isGm = role === 'general_manager'
  const isHrAdmin = role === 'hr_admin'
  const gmPowers = withDefaults(isGm ? pw.powers : {})
  const can = (p: string) => isSuper || (isGm && gmPowers[p] !== false)
  const perms: Perms = {
    role, isSuper, isCeo: isSuper, isGm, can, top: can, powers: gmPowers, route: topRole ? pw.route : null, isHrAdmin,
    isHr: isSuper || isGm || isHrAdmin || role === 'hr_manager',
    isOM: role === 'outlet_manager',
    canWrite: isSuper || isHrAdmin || role === 'hr_manager' || (isGm && (can('workers.edit') || can('org.outlets'))),
    isAdmin: isSuper || (isGm && (can('users.roles') || can('users.approve'))) || (isHrAdmin && flags.manageUsers),
    canSeeSalary: isSuper || role === 'hr_manager' || (isGm && can('workers.salary')) || (isHrAdmin && flags.viewSalary),
    canDeleteWorkers: isSuper || (isGm && can('workers.delete')) || (isHrAdmin && flags.deleteWorkers),
    canRequest: isSuper || isGm || isHrAdmin || role === 'hr_manager' || role === 'outlet_manager',
    canSeeAudit: isSuper || (isGm && can('users.audit')) || (isHrAdmin && flags.viewAudit),
    myOutlets: profile?.outlet_ids || [],
    myCompanies: profile?.company_ids || [],
    canApproveUsers: isSuper || (isGm && can('users.approve')) || (isHrAdmin && !!session && ruleFor(cfg.user_approvals, session.user.id).enabled),
    creatableRoles: isSuper ? ['general_manager', 'hr_admin', 'hr_manager', 'outlet_manager', 'viewer']
      : isGm ? (can('users.create') ? ['hr_admin', 'hr_manager', 'outlet_manager', 'viewer'] : [])
      : isHrAdmin ? ['hr_manager', 'outlet_manager', 'viewer'] : role === 'hr_manager' ? ['outlet_manager'] : [],
  }
  setPayAlertsVisible(perms.canSeeSalary)
  return (
    <Ctx.Provider value={{ session, profile, loading, ...perms, refreshProfile: () => loadProfile(session), signOut }}>
      {children}
    </Ctx.Provider>
  )
}
