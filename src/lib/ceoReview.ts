import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { requestsChanged, useTick } from './requests'

export interface CeoReview {
  request_id: string; reason: string; decided_by_name: string | null; decided_by_role: string | null; decided_at: string
  reviewed_at: string | null; reviewed_by_name: string | null; outcome: string | null
}
export interface HrTask {
  id: string; request_id: string | null; worker_id: string | null; kind: string; title: string; details: string | null; status: 'open' | 'done'
  created_at: string; created_by_name: string | null; done_at: string | null; done_by_name: string | null; done_note: string | null
}
export interface Effect { kind: string; effect: string; task: string }
export type CeoDecision = 'approve' | 'amend' | 'reject' | 'cancel' | 'recall' | 'reviewed'

export const REVIEW_REASON: Record<string, string> = {
  gm_approved: 'Approved by General Manager', gm_rejected: 'Rejected by General Manager', rejected: 'Rejected', recalled: 'You recalled it', manual: 'Reviewed', gm_assigned: 'Assigned / escalated by General Manager',
}

/** CEO only: the server returns nothing to anybody else (RLS) */
export function useCeoReviews(enabled: boolean) {
  const t = useTick()
  const [rows, setRows] = useState<CeoReview[]>([])
  useEffect(() => {
    if (!enabled) return
    let alive = true
    void supabase.from('ceo_reviews').select('*').order('decided_at', { ascending: false }).limit(500).then(({ data }) => { if (alive && data) setRows(data as CeoReview[]) })
    return () => { alive = false }
  }, [enabled, t])
  return rows
}
export function useHrTasks(enabled: boolean, requestId?: string) {
  const t = useTick()
  const [rows, setRows] = useState<HrTask[]>([])
  useEffect(() => {
    if (!enabled) return
    let alive = true
    let q = supabase.from('hr_tasks').select('*').order('created_at', { ascending: false }).limit(300)
    if (requestId) q = q.eq('request_id', requestId)
    void q.then(({ data }) => { if (alive && data) setRows(data as HrTask[]) })
    return () => { alive = false }
  }, [enabled, t, requestId])
  return rows
}
export async function requestEffects(id: string): Promise<Effect[]> {
  const { data, error } = await supabase.rpc('request_effects', { p_id: id })
  if (error) throw error
  return (data || []) as Effect[]
}
export async function ceoDecide(id: string, decision: CeoDecision, reason?: string, patch?: Record<string, unknown>) {
  const { data, error } = await supabase.rpc('ceo_decide', { p_id: id, p_decision: decision, p_reason: reason || null, p_patch: patch || null })
  if (error) throw error
  requestsChanged()
  return data
}
export async function hrTaskDone(id: string, note?: string) {
  const { error } = await supabase.rpc('hr_task_done', { p_id: id, p_note: note || null })
  if (error) throw error
  requestsChanged()
}
