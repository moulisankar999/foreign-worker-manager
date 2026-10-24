import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/auth'
import { isExited, outletName } from '../lib/calc'
import { companyName, outletCompany } from '../lib/companies'
import { useConfig } from '../lib/config'
import { db } from '../lib/db'
import { useOutlets, useSettings, useWorkers } from '../lib/hooks'
import { useRequests } from '../lib/requests'
import { supabase } from '../lib/supabase'
import { fmtDate, todayISO } from '../lib/util'
import { isDemoCompany, useDemoOutletIds, useHideDemo } from '../lib/demo'
import { isLimited } from './defs/helpers'
import type { Ctx, Extra, Filters, ReportDef } from './types'

const iso = (d: Date) => d.toISOString().slice(0, 10)
export const RANGES: { key: string; label: string; get: () => [string, string] | null }[] = [
  { key: 'all', label: 'All dates', get: () => null },
  { key: 'tm', label: 'This month', get: () => { const t = todayISO(); return [t.slice(0, 8) + '01', t] } },
  { key: 'lm', label: 'Last month', get: () => { const d = new Date(todayISO() + 'T00:00:00Z'); const a = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)); const b = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0)); return [iso(a), iso(b)] } },
  { key: 'tq', label: 'This quarter', get: () => { const t = todayISO(); const m = Math.floor((Number(t.slice(5, 7)) - 1) / 3) * 3 + 1; return [`${t.slice(0, 4)}-${String(m).padStart(2, '0')}-01`, t] } },
  { key: 'ty', label: 'This year', get: () => { const t = todayISO(); return [t.slice(0, 4) + '-01-01', t] } },
  { key: 'ly', label: 'Last year', get: () => { const y = Number(todayISO().slice(0, 4)) - 1; return [`${y}-01-01`, `${y}-12-31`] } },
  { key: '12m', label: 'Last 12 months', get: () => { const d = new Date(todayISO() + 'T00:00:00Z'); d.setUTCFullYear(d.getUTCFullYear() - 1); d.setUTCDate(d.getUTCDate() + 1); return [iso(d), todayISO()] } },
  { key: 'custom', label: 'Custom dates', get: () => null },
]

/** Everything a report build needs. Data is already scoped by the server (RLS / pull_records) to the user's role. */
export function useReportData() {
  const all = useWorkers()
  const outlets = useOutlets()
  const s = useSettings()
  const cfg = useConfig()
  const { rows: reqs } = useRequests()
  const rq = useLiveQuery(() => db.remarks.toArray(), [])
  const remarks = useMemo(() => rq || [], [rq])
  // workers / outlets / requests already leave out the demo company (lib/demo.ts); companies too, unless shown
  const hide = useHideDemo()
  const companies = useMemo(() => hide ? cfg.companies.items.filter((c) => !isDemoCompany(c.id)) : cfg.companies.items, [cfg, hide])
  return useMemo(() => ({ all, outlets, s, cfg, reqs, remarks, companies }), [all, outlets, s, cfg, reqs, remarks, companies])
}

export function filterWorkers(d: ReturnType<typeof useReportData>, def: ReportDef, f: Filters) {
  const st = f.status || def.status || 'all'
  return d.all.filter((w) => {
    const o = d.outlets.find((x) => x.id === w.outletId)
    if (f.company && outletCompany(o) !== f.company) return false
    if (f.outlet && w.outletId !== f.outlet) return false
    if (f.btype && w.businessType !== f.btype) return false
    if (f.nat && w.nationality !== f.nat) return false
    if (f.gender && w.gender !== f.gender) return false
    if (st === 'current') return !isExited(w)
    if (st === 'exited') return isExited(w)
    if (st !== 'all') return w.status === st
    return true
  })
}

/** audit trail / users / submissions are fetched only for the reports that need them (RLS limits them again) */
export function useExtra(def: ReportDef | undefined, f: Filters, subs: Extra['subs'], subsErr?: string): Extra & { loading: boolean } {
  const [x, set] = useState<Extra & { loading: boolean }>({ loading: false })
  const need = def?.needs
  const hide = useHideDemo()
  const demoOutlets = useDemoOutletIds()
  useEffect(() => {
    let alive = true
    if (need === 'audit') {
      set({ loading: true })
      let q = supabase.from('audit_log').select('id,at,user_name,user_role,action,entity,summary').order('id', { ascending: false }).limit(5000)
      if (f.from) q = q.gte('at', f.from + 'T00:00:00+08:00')
      if (f.to) q = q.lte('at', f.to + 'T23:59:59+08:00')
      void q.then(({ data, error }) => { if (alive) set({ loading: false, audit: (data || []) as Extra['audit'], error: error?.message }) })
    } else if (need === 'users') {
      set({ loading: true })
      void supabase.from('profiles').select('id,email,full_name,role,status,outlet_ids,company_ids,approved_by_name,approved_at,created_at').order('full_name').then(({ data, error }) => {
        if (!alive) return
        if (error && /approved_by_name|approved_at|column/i.test(error.message)) {
          void supabase.from('profiles').select('id,email,full_name,role,status,outlet_ids,company_ids,created_at').order('full_name').then((r) => { if (alive) set({ loading: false, users: (r.data || []) as Extra['users'], error: r.error?.message }) })
        } else set({ loading: false, users: (data || []) as Extra['users'], error: error?.message })
      })
    } else set({ loading: false })
    return () => { alive = false }
  }, [need, f.from, f.to])
  // users whose whole scope is the demo company (the App Review login) are left out unless demo data is shown
  const users = useMemo(() => !hide || !x.users ? x.users : x.users.filter((u) => {
    const cos = u.company_ids || [], outs = u.outlet_ids || []
    if (!cos.length && !outs.length) return true
    return !(cos.every(isDemoCompany) && outs.every((o) => demoOutlets.has(o)))
  }), [x.users, hide, demoOutlets])
  return need === 'subs' ? { loading: false, subs, error: subsErr } : x.users === users ? x : { ...x, users }
}

export function buildCtx(d: ReturnType<typeof useReportData>, def: ReportDef, f: Filters, p: ReturnType<typeof useAuth>, mask: boolean, extra: Extra): Ctx {
  return {
    workers: filterWorkers(d, def, f), all: d.all, outlets: d.outlets, companies: d.companies, s: d.s, cfg: d.cfg, reqs: d.reqs, remarks: d.remarks,
    f, p, mask: mask || isLimited(p), extra,
    inRange: (x) => !f.from && !f.to ? true : !!x && (!f.from || x.slice(0, 10) >= f.from) && (!f.to || x.slice(0, 10) <= f.to),
  }
}

/** one line for the page header */
export function filterText(d: ReturnType<typeof useReportData>, def: ReportDef, f: Filters, rangeLabel?: string) {
  const out: string[] = []
  out.push(f.company ? 'Company: ' + companyName(d.companies, f.company) : 'All companies')
  if (def.filters.includes('outlet')) out.push(f.outlet ? 'Outlet: ' + outletName(d.outlets, f.outlet) : 'All outlets')
  if (f.btype) out.push('Business: ' + f.btype)
  if (f.nat) out.push('Nationality: ' + f.nat)
  if (f.gender) out.push('Gender: ' + f.gender)
  const st = f.status || def.status
  if (def.filters.includes('status') || def.status) out.push('Workers: ' + (st === 'current' ? 'current' : st === 'exited' ? 'exited' : !st || st === 'all' ? 'all' : st))
  if (def.filters.includes('range')) out.push('Period: ' + (f.from || f.to ? `${f.from ? fmtDate(f.from) : '…'} – ${f.to ? fmtDate(f.to) : '…'}` : rangeLabel || 'all dates'))
  if (def.filters.includes('month')) out.push('Month: ' + (f.month || todayISO().slice(0, 7)))
  if (f.within) out.push(f.within === 'expired' ? 'Expired only' : `Within ${f.within} days`)
  if (f.docType) out.push('Document: ' + f.docType)
  if (f.worker) out.push('Worker: ' + (d.all.find((w) => w.id === f.worker)?.fullName || ''))
  return out.join('  ·  ')
}
