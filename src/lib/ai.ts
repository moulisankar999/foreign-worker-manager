/* AI Assistant (v1.5.0) — client side. The provider key lives only in the ai-assistant edge function's secrets. */
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface AiStatus { enabled: boolean; provider?: string | null; model?: string; limit?: number; used?: number; role?: string; error?: string }
export interface AiTable { title: string; columns: { key: string; label: string }[]; rows: Record<string, unknown>[]; more?: number }
export interface AiDraft { id: string; kind: 'request' | 'note' | 'reminder'; title: string; worker_id: string | null; payload: Record<string, unknown>; state?: 'confirmed' | 'discarded'; ref?: string }
export interface AiMsg { role: 'user' | 'assistant'; text: string; tables?: AiTable[]; drafts?: AiDraft[]; error?: boolean; at: string }
export interface AiReply { reply: string; tables?: AiTable[]; drafts?: AiDraft[]; usage?: { used: number; limit: number }; disabled?: boolean; llm_saw?: string }

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('ai-assistant', { body })
  if (error) {
    let msg = error.message
    try { const ctx = (error as unknown as { context?: Response }).context; if (ctx) { const j = await ctx.json(); if (j?.error) msg = j.error } } catch { /* keep message */ }
    throw new Error(msg)
  }
  return data as T
}

let cached: { uid: string; p: Promise<AiStatus> } | null = null
export function aiStatus(uid: string, fresh = false): Promise<AiStatus> {
  if (!fresh && cached?.uid === uid) return cached.p
  const p = call<AiStatus>({ op: 'status' }).catch((e) => ({ enabled: false, error: (e as Error).message }))
  cached = { uid, p }
  return p
}
export function useAiStatus(uid?: string | null) {
  const [s, setS] = useState<AiStatus | null>(null)
  useEffect(() => { if (!uid) return; let live = true; void aiStatus(uid).then((v) => live && setS(v)); return () => { live = false } }, [uid])
  return [s, async () => { if (uid) setS(await aiStatus(uid, true)) }] as const
}

export const aiChat = (messages: { role: string; text: string }[], lang: string) => call<AiReply>({ op: 'chat', messages, lang })

export async function aiDecideDraft(id: string, status: 'confirmed' | 'discarded', ref?: string) {
  const { error } = await supabase.rpc('ai_draft_decide', { p_id: id, p_status: status, p_ref: ref || null })
  if (error) throw new Error(error.message)
  try { sessionStorage.removeItem(`fwm-ai-draft-${id}`) } catch { /* ignore */ }
}
export async function aiSetLimit(n: number) {
  const { error } = await supabase.rpc('ai_set_limit', { p_limit: n })
  if (error) throw new Error(error.message)
}
/** hand a request draft to the normal New request form (/requests/new?ai=<id>) */
export function stashDraft(d: AiDraft) { try { sessionStorage.setItem(`fwm-ai-draft-${d.id}`, JSON.stringify(d.payload.data || {})) } catch { /* ignore */ } }
export function aiPrefill(id: string | null): Record<string, unknown> {
  if (!id) return {}
  try { return JSON.parse(sessionStorage.getItem(`fwm-ai-draft-${id}`) || '{}') } catch { return {} }
}

/* chat history stays on this device, per user */
const HKEY = (uid: string) => `fwm-ai-chat-${uid}`
export const loadChat = (uid: string): AiMsg[] => { try { return JSON.parse(localStorage.getItem(HKEY(uid)) || '[]') } catch { return [] } }
export const saveChat = (uid: string, m: AiMsg[]) => { try { localStorage.setItem(HKEY(uid), JSON.stringify(m.slice(-60))) } catch { /* full */ } }
export const clearChat = (uid: string) => { try { localStorage.removeItem(HKEY(uid)) } catch { /* ignore */ } }

export const AI_LANGS: { code: string; label: string }[] = [
  { code: 'en', label: 'English' }, { code: 'ms', label: 'Bahasa Melayu' }, { code: 'zh', label: '中文' }, { code: 'ta', label: 'தமிழ்' },
  { code: 'hi', label: 'हिन्दी' }, { code: 'ne', label: 'नेपाली' }, { code: 'bn', label: 'বাংলা' }, { code: 'id', label: 'Bahasa Indonesia' },
  { code: 'my', label: 'မြန်မာ' }, { code: 'ur', label: 'اردو' }, { code: 'te', label: 'తెలుగు' }, { code: 'ml', label: 'മലയാളം' },
]
export function initialAiLang() {
  const saved = localStorage.getItem('fwm-ai-lang')
  if (saved) return saved
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase()
  return AI_LANGS.some((l) => l.code === nav) ? nav : 'en'
}

/* one-event .ics for a reminder draft */
export function reminderIcs(p: { title: string; date: string; time?: string; note?: string | null; worker_name?: string | null }) {
  const [h, m] = (p.time || '09:00').split(':')
  const start = `${p.date.replace(/-/g, '')}T${h}${m}00`
  const endH = String(Math.min(Number(h) + 1, 23)).padStart(2, '0')
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Foreign Worker Manager//Assistant//EN', 'BEGIN:VEVENT', `UID:ai-${Date.now()}@foreign-worker-manager`, `DTSTAMP:${now}`,
    `DTSTART;TZID=Asia/Kuala_Lumpur:${start}`, `DTEND;TZID=Asia/Kuala_Lumpur:${p.date.replace(/-/g, '')}T${endH}${m}00`, `SUMMARY:${esc(p.title + (p.worker_name ? ` — ${p.worker_name}` : ''))}`,
    ...(p.note ? [`DESCRIPTION:${esc(p.note)}`] : []), 'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(p.title)}`, 'TRIGGER:-PT15M', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')
}
