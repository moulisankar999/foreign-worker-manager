/* 1.6.4 permit-vs-outlet compliance. A worker must work for the company that holds his KDN approval and calling visa
 * (the "permit company"). The worker's own field permitCompanyId wins, else the company of his KDN / quota letter (quotaId),
 * else the "employer named on the work permit" text when it matches a company name. Same order as SQL permit_compliance().
 * The status, colours and the report are for the CEO only; the server refuses the report to everyone else (migration 055). */
import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { Company } from './companies'
import type { Outlet, Worker } from './types'

const norm = (s?: string | null) => (s || '').toLowerCase().replace(/\b(sdn\.?|bhd\.?|berhad|sendirian|enterprise|ent|plt|\(m\))/g, '').replace(/[^a-z0-9]/g, '')
export interface Letter { id: string; ref_no: string; company_id: string; sector?: string | null; subsector?: string | null; job_title?: string | null }
export type PermitSource = 'worker' | 'kdn' | 'permit_employer'

export function permitCompanyOf(w: Pick<Worker, 'permitCompanyId' | 'quotaId' | 'permitEmployer'>, letters: Letter[], cos: Company[]): { id: string; source: PermitSource } | null {
  if (w.permitCompanyId) return { id: w.permitCompanyId, source: 'worker' }
  const l = w.quotaId ? letters.find((x) => x.id === w.quotaId) : undefined
  if (l?.company_id) return { id: l.company_id, source: 'kdn' }
  const n = norm(w.permitEmployer)
  const c = n ? cos.find((x) => norm(x.name) === n) : undefined
  return c ? { id: c.id, source: 'permit_employer' } : null
}
/** CEO colour: ok = permit company is the outlet's company, bad = differs, unknown = no permit company */
export type PermitTone = 'ok' | 'bad' | 'unknown'
export function permitTone(w: Pick<Worker, 'permitCompanyId' | 'quotaId' | 'permitEmployer' | 'outletId'>, letters: Letter[], cos: Company[], outlets: Pick<Outlet, 'id' | 'companyId'>[]): PermitTone {
  const p = permitCompanyOf(w, letters, cos)
  if (!p) return 'unknown'
  return outlets.find((o) => o.id === w.outletId)?.companyId === p.id ? 'ok' : 'bad'
}

// ---------- report (CEO) ----------
export type Risk = 'ok' | 'medium' | 'high' | 'critical' | 'needs_data'
export interface PcWorker {
  id: string; name: string; workerNo?: string; status?: string; nationality?: string; job?: string; business?: string
  outletId?: string; outlet?: string; outletType?: string; outletCompanyId?: string; outletCompany?: string; outletSector?: string
  permitCompanyId?: string; permitCompany?: string; permitSource?: PermitSource | null
  kdnId?: string; kdnRef?: string; kdnSector?: string; kdnSubsector?: string; kdnJob?: string
  sectorMismatch: boolean; jobMismatch: boolean; demo: boolean; status2: 'compliant' | 'mismatch' | 'unknown'; risk: Risk
}
export interface PcOutlet { id: string; name: string; type?: string; companyId?: string; company?: string; state?: string; demo?: boolean }
export interface PcData { generatedAt: string; workers: PcWorker[]; outlets: PcOutlet[]; companies: { id: string; name: string; sector?: string }[] }

export const RISK_LABEL: Record<Risk, string> = { critical: 'Critical', high: 'High', medium: 'Medium', needs_data: 'Needs data', ok: 'OK' }
export const RISK_TONE: Record<Risk, 'red' | 'orange' | 'amber' | 'gray' | 'green'> = { critical: 'red', high: 'orange', medium: 'amber', needs_data: 'gray', ok: 'green' }
export const RISK_ORDER: Risk[] = ['critical', 'high', 'medium', 'needs_data', 'ok']

export function usePermitCompliance(enabled: boolean) {
  const [data, setData] = useState<PcData | null>(null)
  const [err, setErr] = useState('')
  const [n, setN] = useState(0)
  const reload = useCallback(() => setN((x) => x + 1), [])
  useEffect(() => {
    if (!enabled) return
    let live = true
    void supabase.rpc('permit_compliance').then((r) => { if (!live) return; if (r.error) setErr(r.error.message); else { setErr(''); setData(r.data as PcData) } })
    return () => { live = false }
  }, [enabled, n])
  return { data, err, reload }
}

export function summary(ws: PcWorker[]) {
  const total = ws.length
  const compliant = ws.filter((w) => w.status2 === 'compliant').length
  const mismatch = ws.filter((w) => w.status2 === 'mismatch').length
  const unknown = ws.filter((w) => w.status2 === 'unknown').length
  const byRisk = Object.fromEntries(RISK_ORDER.map((r) => [r, ws.filter((w) => w.risk === r).length])) as Record<Risk, number>
  const known = total - unknown
  return { total, compliant, mismatch, unknown, byRisk, pct: total ? Math.round((compliant / total) * 100) : 100, pctKnown: known ? Math.round((compliant / known) * 100) : 100 }
}

export interface Move { kind: 'swap' | 'move' | 'none'; worker: PcWorker; to?: PcOutlet; with?: PcWorker; why: string }
/** Emergency move plan: every worker at another company's outlet goes back to an outlet of his permit company.
 *  1. Swaps first (A at X wants Y's company, B at Y wants X's company): headcount at both outlets stays the same.
 *  2. Then single moves to the permit company's outlet: same business type first, same state next, fewest planned arrivals last.
 *  3. No outlet of the permit company: needs an employer transfer, or a new quota at the outlet's company. */
export function movePlan(ws: PcWorker[], outlets: PcOutlet[]): Move[] {
  const bad = ws.filter((w) => w.status2 === 'mismatch' && w.permitCompanyId).sort((a, b) => RISK_ORDER.indexOf(a.risk) - RISK_ORDER.indexOf(b.risk) || a.name.localeCompare(b.name))
  const oById = new Map(outlets.map((o) => [o.id, o]))
  const used = new Set<string>()
  const out: Move[] = []
  for (const a of bad) {
    if (used.has(a.id)) continue
    const ao = a.outletId ? oById.get(a.outletId) : undefined
    const cands = bad.filter((b) => !used.has(b.id) && b.id !== a.id && b.permitCompanyId === a.outletCompanyId && b.outletCompanyId === a.permitCompanyId && b.outletId)
    const pick = cands.sort((x, y) => score(ao, x.outletId ? oById.get(x.outletId) : undefined, a) - score(ao, y.outletId ? oById.get(y.outletId) : undefined, a))[0]
    if (!pick) continue
    used.add(a.id); used.add(pick.id)
    const bo = oById.get(pick.outletId!)
    out.push({ kind: 'swap', worker: a, to: bo, with: pick, why: `Swap with ${pick.name}: headcount at ${a.outlet || '—'} and ${pick.outlet || '—'} stays the same` })
    if (ao) out.push({ kind: 'swap', worker: pick, to: ao, with: a, why: `Swap with ${a.name}` })
  }
  const arrivals = new Map<string, number>()
  for (const a of bad) {
    if (used.has(a.id)) continue
    const ao = a.outletId ? oById.get(a.outletId) : undefined
    const cands = outlets.filter((o) => o.companyId === a.permitCompanyId)
    if (!cands.length) { out.push({ kind: 'none', worker: a, why: `${a.permitCompany || a.permitCompanyId} has no outlet: needs employer transfer, or new quota at the outlet's company (${a.outletCompany || '—'})` }); continue }
    const best = [...cands].sort((x, y) => score(ao, x, a) - score(ao, y, a) || (arrivals.get(x.id) || 0) - (arrivals.get(y.id) || 0) || x.name.localeCompare(y.name))[0]
    arrivals.set(best.id, (arrivals.get(best.id) || 0) + 1)
    out.push({ kind: 'move', worker: a, to: best, why: `${best.type && best.type === (a.outletType || a.business) ? 'Same business type' : 'Outlet of the permit company'}${ao?.state && best.state === ao.state ? ', same state' : ''}. ${a.outlet || 'Current outlet'} −1, ${best.name} +1` })
  }
  return out
}
const score = (from: PcOutlet | undefined, to: PcOutlet | undefined, w: PcWorker) =>
  !to ? 9 : (to.type && to.type === (w.outletType || w.business) ? 0 : 2) + (from?.state && to.state === from.state ? 0 : 1)

export interface Fix { worker: PcWorker; risk: Risk; action: string }
export function fixList(ws: PcWorker[], plan: Move[]): Fix[] {
  const pm = new Map(plan.map((m) => [m.worker.id, m]))
  const out: Fix[] = []
  for (const w of ws) {
    if (w.risk === 'ok') continue
    const parts: string[] = []
    if (w.status2 === 'unknown') parts.push('Set the permit company (worker → Edit → Job) or link his KDN approval letter')
    if (w.status2 === 'mismatch') { const m = pm.get(w.id); parts.push(m?.kind === 'none' ? m.why : m?.to ? `Move to ${m.to.name}${m.kind === 'swap' ? ' (swap)' : ''}` : 'Move to an outlet of the permit company') }
    if (w.sectorMismatch) parts.push(`Sector: KDN ${w.kdnSector || '—'} vs company ${w.outletSector || '—'}`)
    if (w.jobMismatch) parts.push(`Occupation: KDN ${w.kdnJob || '—'} vs job ${w.job || '—'}`)
    out.push({ worker: w, risk: w.risk, action: parts.join(' · ') })
  }
  return out.sort((a, b) => RISK_ORDER.indexOf(a.risk) - RISK_ORDER.indexOf(b.risk) || a.worker.name.localeCompare(b.worker.name))
}
