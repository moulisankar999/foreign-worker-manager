/* Role-based PDF manuals. The PDFs live in the private "manuals" storage bucket (migration 033):
 * the database lets each person read only the manual for their own role (CEO: all; staff: own + worker manual). */
import { supabase } from './supabase'
import { isNative, openExternal } from './platform'

export const MANUALS_BUCKET = 'manuals'

export async function manualUrl(file: string, seconds = 600) {
  const { data, error } = await supabase.storage.from(MANUALS_BUCKET).createSignedUrl(file, seconds, { download: file })
  if (error || !data) throw new Error(/not.?found|object/i.test(error?.message || '') ? 'The manual is not available yet. Please ask the CEO.' : error?.message || 'Could not open the manual')
  return data.signedUrl
}

export async function openManual(file: string) {
  if (isNative()) { await openExternal(await manualUrl(file)); return }
  const win = window.open('', '_blank')
  try { const u = await manualUrl(file); if (win) win.location.href = u; else window.location.href = u }
  catch (e) { win?.close(); throw e }
}
