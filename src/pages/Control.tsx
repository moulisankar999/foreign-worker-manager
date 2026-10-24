// Software Control (v1.3.0) — CEO only. Health monitor, client error list and the private System Map.
// Everything shown here is read from CEO-only tables (RLS: is_ceo()) or the CEO-checked health-check function;
// the System Map text is NOT in the app bundle — it is loaded from the database at run time.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Btn, Card, Chip, Empty, Tabs } from '../components/ui'
import { toast } from '../components/toast'

export type Health = { check_key: string; status: 'green' | 'amber' | 'red' | 'grey'; title: string | null; summary: string | null; advice: string | null; area: string | null; detail: Record<string, unknown>; source: string | null; sort: number; checked_at: string; changed_at: string; prev_status: string | null }
type AppError = { id: number; created_at: string; last_seen: string; count: number; user_role: string | null; kind: string; message: string; detail: string | null; url: string | null; app_version: string | null; platform: string | null }
type Block =
  | { t: 'text'; text: string }
  | { t: 'kv'; rows: [string, string, string?][] }
  | { t: 'list'; items: string[] }
  | { t: 'steps'; items: string[] }
  | { t: 'diagram'; rows: { label: string; sub?: string }[][] }
  | { t: 'secrets'; rows: { name: string; where: string; check?: 'edge' | 'github'; note?: string }[] }
  | { t: 'renewals' }
type MapRow = { key: string; sort: number; title: string; content: { blocks?: Block[]; renewals?: { key: string; title: string; date: string; where: string; advice?: string }[] }; updated_at: string }

const GH_ACTIONS = 'https://github.com/moulisankar999/foreign-worker-manager/actions/workflows/health-report.yml'
const ago = (iso?: string | null) => {
  if (!iso) return 'never'
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`
}
const ist = (iso?: string | null) => iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
const LABEL = { green: 'OK', amber: 'Attention', red: 'Action needed', grey: 'Unknown' }
const TONE = { green: 'green', amber: 'amber', red: 'red', grey: 'gray' }
const SRC: Record<string, string> = { db: 'database', edge: 'server', manual: 'run by you', github: 'GitHub robot', cron: 'server' }

let cache: Health[] | null = null
export async function loadHealth(): Promise<Health[]> {
  const { data, error } = await supabase.from('health_latest').select('*').order('sort').order('check_key')
  if (error) throw error
  cache = (data || []) as Health[]
  window.dispatchEvent(new Event('fwm-health'))
  return cache
}

/** red + amber tiles, for the CEO's nav badge (0 for everyone else; the table is CEO-only anyway). */
export function useControlBadge() {
  const { isSuper } = useAuth()
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!isSuper) return
    const upd = () => setN((cache || []).filter((h) => h.status === 'red' || h.status === 'amber').length)
    window.addEventListener('fwm-health', upd)
    if (!cache) loadHealth().catch(() => {}); else upd()
    const t = setInterval(() => loadHealth().catch(() => {}), 10 * 60_000)
    return () => { window.removeEventListener('fwm-health', upd); clearInterval(t) }
  }, [isSuper])
  return isSuper ? n : 0
}

type Tab = 'health' | 'errors' | 'map'
export default function ControlPage() {
  const { isSuper } = useAuth()
  const { tab: tp } = useParams()
  const nav = useNavigate()
  const tab: Tab = tp === 'errors' || tp === 'map' ? tp : 'health'
  const [health, setHealth] = useState<Health[]>(cache || [])
  const [errs, setErrs] = useState<AppError[] | null>(null)
  const refresh = useCallback(() => loadHealth().then(setHealth).catch((e) => toast('Could not load health: ' + e.message, 'err')), [])
  useEffect(() => { if (isSuper) void refresh() }, [isSuper, refresh])
  useEffect(() => {
    if (!isSuper || tab !== 'errors') return
    supabase.from('app_errors').select('id,created_at,last_seen,count,user_role,kind,message,detail,url,app_version,platform').order('last_seen', { ascending: false }).limit(200)
      .then(({ data }) => setErrs((data || []) as AppError[]))
  }, [isSuper, tab])
  if (!isSuper) return <div className="page"><Empty icon="lock" title="Not available">Software Control is only for the CEO.</Empty></div>
  const bad = health.filter((h) => h.status === 'red' || h.status === 'amber').length
  const e24 = Number((health.find((h) => h.check_key === 'app_errors')?.detail as { count24h?: number } | undefined)?.count24h || 0)
  return (
    <div className="page ctl">
      <h1>Software Control</h1>
      <Tabs tabs={[{ id: 'health' as Tab, label: 'Control Center', badge: bad || undefined }, { id: 'errors' as Tab, label: 'Errors', badge: e24 || undefined }, { id: 'map' as Tab, label: 'Know-how / System Map' }]}
        value={tab} onChange={(t) => nav(t === 'health' ? '/control' : '/control/' + t, { replace: true })} />
      {tab === 'health' && <HealthBoard health={health} onChange={setHealth} refresh={refresh} />}
      {tab === 'errors' && <ErrorList rows={errs} onClear={() => setErrs([])} />}
      {tab === 'map' && <SystemMap health={health} />}
    </div>
  )
}

function HealthBoard({ health, refresh }: { health: Health[]; onChange: (h: Health[]) => void; refresh: () => Promise<unknown> }) {
  const [busy, setBusy] = useState<string>('')
  const run = async (only?: string) => {
    setBusy(only || '*')
    try {
      const { data, error } = await supabase.functions.invoke('health-check', { body: only ? { only } : {} })
      if (error) throw error
      if (data?.note) toast(data.note)
      await refresh()
      if (!data?.note) toast(only ? 'Checked ✓' : 'All server checks done ✓')
    } catch (e) { toast('Check failed: ' + ((e as Error).message || e), 'err') } finally { setBusy('') }
  }
  const counts = { red: 0, amber: 0, green: 0, grey: 0 }
  health.forEach((h) => { counts[h.status]++ })
  const last = health.reduce((m, h) => (h.checked_at > m ? h.checked_at : m), '')
  return (
    <>
      <div className="hc-sum">
        <span className="chip chip-red">{counts.red} action needed</span>
        <span className="chip chip-amber">{counts.amber} attention</span>
        <span className="chip chip-green">{counts.green} OK</span>
        {counts.grey > 0 && <span className="chip chip-gray">{counts.grey} unknown</span>}
        <small className="muted">Checked automatically every 30 min · latest {ago(last)}</small>
        <Btn kind="primary" small onClick={() => run()} disabled={!!busy}>{busy === '*' ? 'Checking…' : 'Run all checks now'}</Btn>
      </div>
      {!health.length && <Empty icon="shield" title="No results yet">Press “Run all checks now”.</Empty>}
      <div className="hc-grid">
        {health.map((h) => (
          <div key={h.check_key} className={`hc-tile hc-${h.status}`}>
            <div className="hc-head"><strong>{h.title || h.check_key}</strong><Chip tone={TONE[h.status]}>{LABEL[h.status]}</Chip></div>
            <p className="hc-sumtxt">{h.summary}</p>
            {h.advice && h.advice !== 'Nothing to do.' && <p className="hc-adv"><b>What to do:</b> {h.advice}</p>}
            {h.area && <p className="hc-where"><b>Where:</b> {h.area}</p>}
            <div className="hc-foot">
              <small className="muted" title={ist(h.checked_at)}>Checked {ago(h.checked_at)} · {SRC[h.source || ''] || h.source}{h.prev_status && h.prev_status !== h.status ? ` · was ${LABEL[h.prev_status as keyof typeof LABEL] || h.prev_status} until ${ist(h.changed_at)}` : ''}</small>
              {h.check_key.startsWith('gh_')
                ? <a className="btn btn-secondary btn-s" href={GH_ACTIONS} target="_blank" rel="noreferrer">Run check now</a>
                : <Btn small onClick={() => run(h.check_key)} disabled={!!busy}>{busy === h.check_key ? 'Checking…' : 'Run check now'}</Btn>}
            </div>
          </div>
        ))}
      </div>
      <p className="small muted" style={{ marginTop: 12 }}>Tiles marked “GitHub robot” (TestFlight, Apple certificate & profile, GitHub Actions, HTTPS certificate, build secrets) are checked by the scheduled <i>health-report</i> workflow on GitHub, which holds the Apple key. “Run check now” on those opens the workflow — press <i>Run workflow</i> there. You get an in-app alert and a phone notification whenever a tile turns amber or red.</p>
    </>
  )
}

function ErrorList({ rows, onClear }: { rows: AppError[] | null; onClear: () => void }) {
  const [open, setOpen] = useState<number | null>(null)
  const clear = async () => {
    if (!confirm('Clear the whole error list?')) return
    const { error } = await supabase.rpc('clear_client_errors')
    if (error) toast(error.message, 'err'); else { onClear(); toast('Cleared ✓') }
  }
  if (!rows) return <p className="muted">Loading…</p>
  return (
    <Card title={`Errors from users' devices (${rows.length})`} actions={rows.length ? <Btn small onClick={clear}>Clear list</Btn> : undefined}>
      {!rows.length ? <Empty icon="check" title="No errors reported">JavaScript errors and failed server calls from any user's app appear here.</Empty> : (
        <ul className="rows err-list">
          {rows.map((r) => (
            <li key={r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
              <div className="r-main">
                <strong className="err-msg">{r.message}</strong>
                <small>{ist(r.last_seen)} · {r.kind}{r.count > 1 ? ` · ×${r.count}` : ''} · screen {r.url || '-'} · {r.user_role === 'super_admin' ? 'CEO' : r.user_role || '?'} · {r.platform || ''} {r.app_version || ''}</small>
                {open === r.id && r.detail && <pre className="err-detail">{r.detail}</pre>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function SystemMap({ health }: { health: Health[] }) {
  const [rows, setRows] = useState<MapRow[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    supabase.from('system_map').select('*').order('sort').then(({ data, error }) => { if (error) setErr(error.message); setRows((data || []) as MapRow[]) })
  }, [])
  const present = useMemo(() => {
    const p = (k: string) => ((health.find((h) => h.check_key === k)?.detail as { present?: Record<string, boolean> } | undefined)?.present) || {}
    return { edge: p('edge_secrets'), github: p('gh_secrets') }
  }, [health])
  if (err) return <p className="banner warn">{err}</p>
  if (!rows) return <p className="muted">Loading…</p>
  if (!rows.length) return <Empty icon="doc" title="System map not loaded yet" />
  const renewals = rows.find((r) => r.key === 'renewals')?.content.renewals || []
  return (
    <div className="smap">
      <p className="small muted">Private to the CEO — stored in the database, not in the app download. Passwords, keys and tokens are never stored here: only their <b>name</b> and <b>where they are kept</b>.</p>
      {rows.map((r) => (
        <Card key={r.key} title={r.title}>
          {(r.content.blocks || []).map((b, i) => <MapBlock key={i} b={b} present={present} health={health} renewals={renewals} />)}
        </Card>
      ))}
    </div>
  )
}

function MapBlock({ b, present, health, renewals }: { b: Block; present: { edge: Record<string, boolean>; github: Record<string, boolean> }; health: Health[]; renewals: NonNullable<MapRow['content']['renewals']> }) {
  switch (b.t) {
    case 'text': return <p>{b.text}</p>
    case 'list': return <ul className="smap-list">{b.items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    case 'steps': return <ol className="smap-list">{b.items.map((x, i) => <li key={i}>{x}</li>)}</ol>
    case 'kv': return (
      <dl className="smap-kv">{b.rows.map(([k, v, href], i) => <div key={i}><dt>{k}</dt><dd>{href ? <a href={href} target="_blank" rel="noreferrer">{v}</a> : v}</dd></div>)}</dl>
    )
    case 'diagram': return (
      <div className="smap-diag">{b.rows.map((row, i) => (
        <div key={i} className="smap-drow">{row.map((n, j) => <div key={j} className="smap-node"><strong>{n.label}</strong>{n.sub && <small>{n.sub}</small>}</div>)}</div>
      ))}</div>
    )
    case 'secrets': return (
      <table className="smap-tab"><thead><tr><th>Secret (name only)</th><th>Where it is kept</th><th>Status</th></tr></thead><tbody>
        {b.rows.map((s) => {
          const v = s.check ? present[s.check][s.name] : undefined
          return <tr key={s.name + s.where}><td><code>{s.name}</code>{s.note && <small className="muted"> — {s.note}</small>}</td><td>{s.where}</td>
            <td>{v === true ? <Chip tone="green">present</Chip> : v === false ? <Chip tone="red">missing</Chip> : <Chip tone="gray">not checkable</Chip>}</td></tr>
        })}
      </tbody></table>
    )
    case 'renewals': {
      const tiles: [string, string, string, string][] = [
        ...renewals.map((r) => ['renew_' + r.key, r.title, r.date, r.where] as [string, string, string, string]),
        ['gh_apple_cert', 'Apple distribution certificate', '', 'Apple Developer → Certificates'],
        ['gh_apple_profile', 'App Store provisioning profile', '', 'Apple Developer → Profiles'],
        ['domain', 'Domain sunrisebayumas.com', '', 'eNom'],
        ['gh_ssl', 'HTTPS certificate', '', 'GitHub Pages (automatic)'],
        ['gh_testflight', 'TestFlight build (testers can install 90 days)', '', 'GitHub Actions → iOS TestFlight'],
      ]
      return (
        <table className="smap-tab"><thead><tr><th>What</th><th>When</th><th>Where</th><th>Status</th></tr></thead><tbody>
          {tiles.map(([k, t, d, w]) => {
            const h = health.find((x) => x.check_key === k)
            const det = (h?.detail || {}) as { expires?: string; date?: string; days?: number; expires_days?: number }
            const when = d || det.date || det.expires || ''
            const n = det.days ?? det.expires_days
            return <tr key={k}><td>{t}</td><td>{when ? new Date(when).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}{n != null ? ` (${n} days)` : ''}</td><td>{w}</td>
              <td>{h ? <Chip tone={TONE[h.status]}>{LABEL[h.status]}</Chip> : <Chip tone="gray">not checked yet</Chip>}</td></tr>
          })}
        </tbody></table>
      )
    }
    default: return null
  }
}
