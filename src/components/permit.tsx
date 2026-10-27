/* 1.6.4: the worker's permit company (KDN approval / calling visa holder). Everyone who sees the worker sees the name;
 * only the CEO sees the colour (green = same company as the outlet, red = different, grey = unknown). */
import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { useConfig } from '../lib/config'
import { useOutlets } from '../lib/hooks'
import { companyName } from '../lib/companies'
import { qRank } from '../lib/quota'
import { supabase } from '../lib/supabase'
import { permitCompanyOf, permitTone, type Letter } from '../lib/permit'
import type { Worker } from '../lib/types'

let cache: Promise<Letter[]> | null = null, cacheAt = 0
/** KDN / quota letters (quota roles only; the server's qr_scope decides which) — one fetch shared by every row, refreshed after 5 min */
export function useLetters(): Letter[] {
  const { role } = useAuth()
  const on = qRank(role) > 0
  const [list, setList] = useState<Letter[]>([])
  useEffect(() => {
    if (!on) return
    if (!cache || Date.now() - cacheAt > 300000) {
      cacheAt = Date.now()
      cache = Promise.resolve(supabase.from('qr_quotas').select('id, ref_no, company_id, sector, subsector, job_title').in('status', ['active', 'closed']).order('approval_date', { ascending: false }))
        .then((r) => { if (r.error) { cache = null; return [] } return (r.data || []) as Letter[] }, () => { cache = null; return [] })
    }
    let live = true
    void cache.then((l) => { if (live) setList(l) })
    return () => { live = false }
  }, [on])
  return list
}

const TIP = { ok: 'Same company as the outlet', bad: 'Different from the outlet\'s company', unknown: 'Permit company not known' }
export function PermitCo({ w, prefix }: { w: Worker; prefix?: string }) {
  const { isSuper } = useAuth()
  const cos = useConfig().companies.items
  const outlets = useOutlets()
  const letters = useLetters()
  const p = permitCompanyOf(w, letters, cos)
  const name = p ? companyName(cos, p.id) : ''
  if (!isSuper) return <span className="pc" data-testid="pc">{prefix}{name || '—'}</span>
  const t = permitTone(w, letters, cos, outlets)
  return <span className={'pc pc-' + t} data-testid="pc" data-tone={t} title={TIP[t]}>{prefix}{name || 'Unknown'}</span>
}
/** KDN letter text: "ref · sector · job" (quota roles only) */
export function KdnText({ w }: { w: Worker }) {
  const letters = useLetters()
  const l = w.quotaId ? letters.find((x) => x.id === w.quotaId) : undefined
  if (!l) return <>{w.permitSector ? `Sector ${w.permitSector}` : '—'}</>
  return <>{[l.ref_no, l.sector, l.job_title].filter(Boolean).join(' · ')}</>
}
