/* v1.2.2: grievances (read by HR roles; the server decides who sees what) and the outlet risk score. */
import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'
import { useConfig } from './config'
import { useAlerts, useOutlets, useWorkers } from './hooks'
import { isExited, type Alert } from './calc'
import type { Outlet, Worker } from './types'
import { RISK_WEIGHTS, hiringIssues, riskLevel, type OutletRisk } from './trackers'
import { todayISO } from './util'

export interface Grievance {
  id: string; ref_no: string; company_id: string; outlet_id: string | null; category: string; message: string; anonymous: boolean
  name: string | null; contact: string | null; worker_no: string | null; language: string | null
  status: 'new' | 'in_review' | 'action_taken' | 'closed'; public_reply: string | null
  history: { at: string; status: string; by: string; note?: string }[]
  created_at: string; updated_at: string; updated_by: string | null
}
export const G_STATUS: Record<Grievance['status'], string> = { new: 'New', in_review: 'In review', action_taken: 'Action taken', closed: 'Closed' }
export const G_CATEGORY: Record<string, string> = {
  pay: 'Pay / wages', hours: 'Working hours / rest days', passport: 'Passport kept', housing: 'Housing / hostel', safety: 'Safety / health',
  harassment: 'Harassment / abuse', fees: 'Recruitment fees / debt', discrimination: 'Discrimination', other: 'Other',
}

let tick = 0
const subs = new Set<() => void>()
export function grievancesChanged() { tick++; subs.forEach((f) => f()) }

/** HR roles only; outlet managers and viewers never load complaints */
export function useGrievances() {
  const { isHr } = useAuth()
  const [rows, setRows] = useState<Grievance[] | null>(null)
  const [t, setT] = useState(tick)
  useEffect(() => { const f = () => setT(tick); subs.add(f); return () => { subs.delete(f) } }, [])
  useEffect(() => {
    if (!isHr) { setRows(null); return }
    let alive = true
    const load = () => void supabase.from('grievances').select('id,ref_no,company_id,outlet_id,category,message,anonymous,name,contact,worker_no,language,status,public_reply,history,created_at,updated_at,updated_by').order('created_at', { ascending: false }).limit(500).then(({ data, error }) => { if (alive) setRows(error ? [] : ((data || []) as Grievance[])) })
    load()
    const iv = setInterval(load, 120000)
    return () => { alive = false; clearInterval(iv) }
  }, [isHr, t])
  return rows
}

export async function updateGrievance(id: string, p: { status?: string; note?: string; reply?: string }) {
  const { error } = await supabase.rpc('update_grievance', { p_id: id, p_status: p.status ?? null, p_note: p.note ?? null, p_reply: p.reply ?? null })
  if (error) throw new Error(error.message)
  grievancesChanged()
}
export async function grievanceLink(companyId: string, opts: { rotate?: boolean; enabled?: boolean } = {}): Promise<{ ok: boolean; token?: string; enabled?: boolean; canManage?: boolean; reason?: string }> {
  const { data, error } = await supabase.rpc('get_grievance_link', { p_company: companyId, p_rotate: !!opts.rotate, p_enabled: opts.enabled ?? null })
  if (error) throw new Error(error.message)
  return data as { ok: boolean; token?: string; enabled?: boolean; canManage?: boolean; reason?: string }
}

const has = (as: Alert[], f: (a: Alert) => boolean) => as.some(f)
const KEY_DOCS = ['Work Permit / PLKS (VP(TE))', 'Passport', 'FOMEMA Medical', 'Insurance (SPIKPA / Hospitalisation)']

/** one score per outlet, 0 (low) – 100 (high). Each part adds its weight × (0.3 + 0.7 × share of workers affected);
 *  parts the viewer may not see (pay, complaints) are left out and the score is rescaled. */
export function outletRisks(workers: Worker[], outlets: Outlet[], alerts: Alert[], grievances: Grievance[] | null, pay: boolean): OutletRisk[] {
  const byW = new Map<string, Alert[]>()
  for (const a of alerts) { const l = byW.get(a.workerId); if (l) l.push(a); else byW.set(a.workerId, [a]) }
  const parts = RISK_WEIGHTS.filter((p) => (pay || !p.pay) && (p.key !== 'complaints' || grievances))
  const maxSum = parts.reduce((s, p) => s + p.weight, 0)
  const out: OutletRisk[] = []
  for (const o of outlets) {
    const ws = workers.filter((w) => w.outletId === o.id && !isExited(w))
    if (!ws.length) continue
    const count = (key: string): number => {
      if (key === 'complaints') return (grievances || []).filter((g) => g.outlet_id === o.id && g.status !== 'closed' && g.status !== 'action_taken').length
      return ws.filter((w) => {
        const as = byW.get(w.id) || []
        switch (key) {
          case 'passport': return w.passportSafe?.custody === 'in_safe' || has(as, (a) => a.id.startsWith('ppnoconsent-'))
          case 'latepay': return has(as, (a) => a.id.startsWith('pay-late-') || a.id.startsWith('pay-noslip-') && a.severity === 'medium')
          case 'ot': return has(as, (a) => a.id.startsWith('pay-ot-'))
          case 'deduct': return has(as, (a) => a.id.startsWith('pay-deduct-') || a.id.startsWith('pay-hostel-'))
          case 'hostel': return has(as, (a) => a.category === 'Hostel')
          case 'expiry': return has(as, (a) => (KEY_DOCS.includes(a.category) && a.days !== null && a.days <= 30) || a.category === 'Missing document' || a.id.startsWith('stay-cap-') && a.severity === 'critical')
          default: return false
        }
      }).length
    }
    const ps = parts.map((p) => {
      const c = count(p.key)
      // passports held WITH consent are legal: they count half; held without consent counts in full
      let share = Math.min(1, c / ws.length)
      if (p.key === 'passport') {
        const bad = ws.filter((w) => has(byW.get(w.id) || [], (a) => a.id.startsWith('ppnoconsent-'))).length
        share = Math.min(1, (bad + (c - bad) * 0.3) / ws.length)
        const points = c ? Math.round(p.weight * (bad ? 0.3 + 0.7 * share : 0.5 * share) * 10) / 10 : 0
        return { key: p.key, label: p.label, count: c, weight: p.weight, points }
      }
      const points = c ? Math.round(p.weight * Math.min(1, 0.3 + 0.7 * share) * 10) / 10 : 0
      return { key: p.key, label: p.label, count: c, weight: p.weight, points }
    })
    const score = Math.round((ps.reduce((s, p) => s + p.points, 0) * 100) / (maxSum || 1))
    out.push({ outletId: o.id, name: o.name, workers: ws.length, score, level: riskLevel(score), parts: ps })
  }
  return out.sort((a, b) => b.score - a.score)
}

export function useOutletRisks() {
  const workers = useWorkers()
  const outlets = useOutlets()
  const alerts = useAlerts()
  const gr = useGrievances()
  const { canSeeSalary } = useAuth()
  return useMemo(() => outletRisks(workers, outlets, alerts, gr, !!canSeeSalary), [workers, outlets, alerts, gr, canSeeSalary])
}

/** dashboard extras for today's priorities */
export function useTrackerExtra() {
  const gr = useGrievances()
  const risks = useOutletRisks()
  const hiring = useConfig().hiring
  return useMemo(() => ({
    grievancesNew: (gr || []).filter((g) => g.status === 'new').length,
    highRisk: risks.filter((r) => r.level === 'High').length,
    hiringFomema: (hiring.items || []).filter((c) => hiringIssues(c, todayISO()).some((i) => i.text.startsWith('FOMEMA medical due'))).length,
  }), [gr, risks, hiring])
}
