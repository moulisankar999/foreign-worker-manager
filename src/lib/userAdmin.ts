/* Account actions that need the server (Edge Function "user-admin", which checks the caller's role itself):
 * pause / resume, reset password, delete, and reject / delete a pending sign-up. */
import { supabase } from './supabase'
import { refreshPendingUsers } from './userApprovals'
import { isNative } from './platform'

export type UserAdminAction = 'pause' | 'resume' | 'reset_password' | 'delete' | 'reject_pending' | 'delete_pending'
export interface UserAdminResult { ok: boolean; tempPassword?: string; emailed?: boolean; warning?: string }

/** where a password-reset email link should land: this web app, or the public site from the Android/iOS app */
export function resetRedirect(): string {
  return isNative() ? 'https://fw.sunrisebayumas.com/' : window.location.origin + window.location.pathname
}

export async function userAdmin(action: UserAdminAction, userId: string, opts: { note?: string; sendEmail?: boolean } = {}): Promise<UserAdminResult> {
  const { data, error } = await supabase.functions.invoke('user-admin', { body: { action, userId, ...opts, redirectTo: resetRedirect() } })
  if (error) {
    let msg = error.message
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') { try { const j = await ctx.json(); if (j?.error) msg = j.error } catch { /* keep the generic message */ } }
    throw new Error(/failed to send|fetch/i.test(msg) ? 'No internet connection. Please try again.' : msg)
  }
  void refreshPendingUsers()
  return data as UserAdminResult
}

/** password rules shared by every "set a password" screen */
export function passwordProblem(pw: string, again: string): string {
  if (pw.length < 8) return 'Use at least 8 characters.'
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Use letters and at least one number.'
  if (pw !== again) return 'The two passwords do not match.'
  return ''
}
