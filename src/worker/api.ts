/* FW Worker data layer: its own Supabase client (separate login storage from FW Manager) and the worker RPCs.
 * Everything here runs as the signed-in worker; the database only lets a worker read and request for himself. */
import { createClient, type Session } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../lib/supabaseConfig'

const nativeStorage = {
  getItem: async (key: string) => (await Preferences.get({ key })).value,
  setItem: async (key: string, value: string) => { await Preferences.set({ key, value }) },
  removeItem: async (key: string) => { await Preferences.remove({ key }) },
}
export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storageKey: 'fww-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false,
          ...(Capacitor.isNativePlatform() ? { storage: nativeStorage } : {}) },
})

export class ApiError extends Error {
  code: string
  constructor(code: string, message?: string) { super(message || code); this.code = code }
}
const isSessionError = (e: { message?: string; code?: string; status?: number } | null) =>
  !!e && (e.code === '42501' || e.status === 401 || /session ended|jwt|not authenticated/i.test(e.message || ''))

async function authFn(action: string, payload: Record<string, unknown>, token?: string) {
  let r: Response
  try {
    r = await fetch(`${SUPABASE_URL}/functions/v1/worker-auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token || SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ action, ...payload }),
    })
  } catch { throw new ApiError('offline') }
  let j: { error?: string; session?: Session | null; ok?: boolean } = {}
  try { j = await r.json() } catch { /* empty */ }
  if (!r.ok) throw new ApiError(j.error === 'wrong_or_locked' ? 'wrong_or_locked' : j.error === 'busy' ? 'busy' : j.error || 'error')
  return j
}

export async function login(passport: string, pin: string) {
  const j = await authFn('login', { passport, pin })
  if (!j.session) throw new ApiError('error')
  const { error } = await sb.auth.setSession({ access_token: j.session.access_token, refresh_token: j.session.refresh_token })
  if (error) throw new ApiError('error')
}

export async function changePin(currentPin: string, newPin: string) {
  const { data } = await sb.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new ApiError('signed_out')
  const j = await authFn('change_pin', { currentPin, newPin }, token)
  // the server signs every old session out and gives this device a fresh one
  if (j.session) await sb.auth.setSession({ access_token: j.session.access_token, refresh_token: j.session.refresh_token })
  else throw new ApiError('signed_out')
}

export async function logout() { await sb.auth.signOut({ scope: 'local' }).catch(() => {}) }

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new ApiError('offline')
  const { data, error } = await sb.rpc(fn, args)
  if (error) {
    if (isSessionError(error)) throw new ApiError('signed_out')
    throw new ApiError('server', error.message)
  }
  return data as T
}

export type Doc = { type: string; expiryDate: string | null; number?: string | null }
export type Me = {
  id: string; name: string; workerNo: string | null; job: string | null; nationality: string | null; joinDate: string | null; status: string | null
  language: string | null; outlet: string | null; company: string | null; leadDays: number; docs: Doc[]
  basicPay: number | null; loanBalance: number; renewals: { type: string; status: string; title: string }[]
}
export type ReqEvent = { at: string; action: string; to: string | null; role: string | null; comment: string | null }
export type WReq = {
  id: string; ref: string; type: string; status: string; source: string; createdAt: string; updatedAt: string; amount: number | null
  overdue: boolean; mine: boolean; from: string | null; to: string | null; lastDay: string | null; confidential: boolean; events: ReqEvent[]
  /** who has it now (simple, no names): manager | hr_manager | hr_admin | gm | ceo — older servers omit it */
  with?: string | null
}
export const getMe = () => rpc<Me>('worker_me')
export const getRequests = () => rpc<WReq[]>('worker_requests')
export const createRequest = (type: string, data: Record<string, unknown>) => rpc<{ id: string; ref: string; status: string }>('worker_request_create', { p_type: type, p_data: data })
export const cancelRequest = (id: string) => rpc<void>('worker_request_cancel', { p_id: id })
export const resubmitRequest = (id: string, note: string) => rpc<void>('worker_request_resubmit', { p_id: id, p_note: note })

/* 1.6.0 birthday wishes (company auto wish + personal wishes from HR / GM / CEO); in-app only */
export type Wish = { id: number; kind: 'auto' | 'personal'; at: string; read: boolean; from: string | null; role: string | null; message: string | null; messages: Record<string, string> | null }
export type Wishes = { today: boolean; name: string; company: string; wishes: Wish[] }
export const getWishes = () => rpc<Wishes>('worker_wishes')
export const markWishesRead = (ids: number[]) => rpc<number>('worker_wish_read', { p_ids: ids })
