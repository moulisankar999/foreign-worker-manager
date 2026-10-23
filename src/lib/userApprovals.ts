/* New sign-ups waiting for approval (CEO: all of them; HR Admin: only the companies the CEO
 * allowed him — the database read policy decides what each person gets). Live-updated through realtime. */
import { useEffect, useState } from 'react'
import { supabase, type Profile, type Role } from './supabase'
import { useAuth } from './auth'

const subs = new Set<() => void>()
let state: { pending: Profile[]; recent: Profile[]; loaded: boolean; error: string } = { pending: [], recent: [], loaded: false, error: '' }
let ch: ReturnType<typeof supabase.channel> | null = null
let busy = false, again = false
const emit = () => subs.forEach((f) => f())

export async function refreshPendingUsers() {
  if (busy) { again = true; return }
  busy = true
  try {
    const since = new Date(Date.now() - 30 * 86400000).toISOString()
    const [p, r] = await Promise.all([
      supabase.from('profiles').select('*').eq('status', 'pending').order('created_at'),
      supabase.from('profiles').select('*').or(`approved_at.gte.${since},rejected_at.gte.${since}`).limit(50),
    ])
    if (p.error) state = { ...state, loaded: true, error: p.error.message }
    else {
      const recent = ((r.data || []) as Profile[]).sort((a, b) => ((b.approved_at || b.rejected_at || '') > (a.approved_at || a.rejected_at || '') ? 1 : -1))
      state = { pending: p.data as Profile[], recent, loaded: true, error: '' }
    }
    emit()
  } finally {
    busy = false
    if (again) { again = false; void refreshPendingUsers() }
  }
}
function start() {
  if (ch) return
  ch = supabase.channel('pending-users')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => { void refreshPendingUsers() })
    .subscribe()
  window.addEventListener('focus', () => { void refreshPendingUsers() })
  setInterval(() => { if (subs.size && document.visibilityState === 'visible') void refreshPendingUsers() }, 120000)
}

/** empty lists for anyone who may not approve sign-ups */
export function usePendingUsers() {
  const { canApproveUsers } = useAuth()
  const [, setT] = useState(0)
  useEffect(() => {
    if (!canApproveUsers) return
    start()
    const f = () => setT((x) => x + 1)
    subs.add(f)
    void refreshPendingUsers()
    return () => { subs.delete(f) }
  }, [canApproveUsers])
  return canApproveUsers ? state : { pending: [], recent: [], loaded: true, error: '' }
}

const clean = (e: { message: string } | null) => { if (e) throw new Error(e.message.replace(/^.*?ERROR:\s*/, '')) }
export async function approveUser(id: string, role: Role, companyIds: string[], outletIds: string[]) {
  const { error } = await supabase.rpc('approve_user', { p_id: id, p_role: role, p_company_ids: companyIds, p_outlet_ids: outletIds })
  clean(error); await refreshPendingUsers()
}
export async function rejectUser(id: string, reason: string | null) {
  const { error } = await supabase.rpc('reject_user', { p_id: id, p_reason: reason })
  clean(error); await refreshPendingUsers()
}
