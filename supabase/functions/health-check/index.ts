// health-check (v1.3.0): the CEO's Software Control health monitor.
//   * every 30 min from pg_cron (header x-cron-secret)          -> runs all server checks
//   * "Run check now" from the app (CEO JWT only)                 -> POST {only?: key}; returns the fresh results
//   * results from the scheduled GitHub workflow (x-health-secret) -> POST {items:[...]} (Apple / GitHub / SSL data)
// Results go to public.health_latest / health_checks (CEO-only RLS). Alerts are raised in SQL (health_record).
// No secret value is ever returned or logged — only whether a named secret is PRESENT.
import { createClient } from 'npm:@supabase/supabase-js@2'

const env = (k: string) => (Deno.env.get(k) || '').trim()
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const SITE = 'https://fw.sunrisebayumas.com'
const DOMAIN = 'sunrisebayumas.com'
const GH_REPO = 'moulisankar999/foreign-worker-manager'

type Item = { key: string; status: 'green' | 'amber' | 'red' | 'grey'; title: string; summary: string; advice: string; area: string; detail?: Record<string, unknown>; sort?: number }
const days = (iso: string) => Math.floor((new Date(iso).getTime() - Date.now()) / 86400000)
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' })
const eqSecret = (a: string, b: string) => { if (!a || !b || a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0 }

async function timed<T>(f: () => Promise<T>, ms = 15000): Promise<{ v?: T; err?: string; t: number }> {
  const t0 = performance.now()
  try {
    const v = await Promise.race([f(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timed out after ' + ms / 1000 + ' s')), ms))])
    return { v, t: Math.round(performance.now() - t0) }
  } catch (e) { return { err: String((e as Error)?.message || e).slice(0, 200), t: Math.round(performance.now() - t0) } }
}

// deno-lint-ignore no-explicit-any
const CHECKS: Record<string, (db: any) => Promise<Item>> = {
  async website() {
    const r = await timed(async () => {
      const res = await fetch(SITE + '/version.json?t=' + Date.now(), { redirect: 'follow', headers: { 'cache-control': 'no-cache' } })
      const body = res.ok ? await res.json().catch(() => null) : null
      const home = await fetch(SITE + '/', { redirect: 'follow' })
      return { status: res.status, home: home.status, version: body?.version as string | undefined, built: body?.built as string | undefined }
    })
    const base = { key: 'website', title: 'Website ' + SITE.replace('https://', ''), area: 'GitHub Pages (gh-pages branch) at the custom domain', sort: 10 }
    if (r.err || r.v?.home !== 200) return { ...base, status: 'red', summary: `The website did not open (${r.err || 'HTTP ' + r.v?.home}).`, advice: 'Check GitHub → repository → Settings → Pages (custom domain fw.sunrisebayumas.com, HTTPS on) and the DNS tile below. Re-deploy the gh-pages branch if it is empty.', detail: { error: r.err, ms: r.t } }
    if (!r.v?.version) return { ...base, status: 'amber', summary: `The website opens (${r.t} ms) but does not report its version.`, advice: 'Re-deploy the web app (npm run build, push dist to gh-pages) so version.json is published.', detail: { ms: r.t } }
    return { ...base, status: r.t > 8000 ? 'amber' : 'green', summary: `Online — version ${r.v.version}${r.v.built ? ', published ' + fmtDate(r.v.built) : ''} (${r.t} ms).`, advice: r.t > 8000 ? 'The site is slow; GitHub Pages may be having problems (githubstatus.com).' : 'Nothing to do.', detail: { version: r.v.version, built: r.v.built, ms: r.t } }
  },
  async database(db) {
    const runs: number[] = []; let err = ''
    for (let i = 0; i < 3; i++) {
      const r = await timed(async () => { const { error } = await db.from('app_config').select('key').limit(1); if (error) throw new Error(error.message) })
      if (r.err) { err = r.err; break } runs.push(r.t)
    }
    const base = { key: 'database', title: 'Supabase database', area: 'Supabase project (Singapore) → Database', sort: 20 }
    if (err) return { ...base, status: 'red', summary: 'The database did not answer: ' + err, advice: 'Open the Supabase dashboard → project status. A free project pauses after 7 days without use — press "Restore project".', detail: { error: err } }
    const ms = runs.sort((a, b) => a - b)[1]
    return { ...base, status: ms > 4000 ? "red" : ms > 1500 ? "amber" : "green", summary: `Answering — a typical query takes ${ms} ms.`, advice: ms > 1500 ? 'The database is slow. Check Supabase → Reports → Database for heavy load.' : 'Nothing to do.', detail: { ms, runs } }
  },
  async auth() {
    const r = await timed(async () => { const res = await fetch(env('SUPABASE_URL') + '/auth/v1/health', { headers: { apikey: env('SUPABASE_SERVICE_ROLE_KEY') } }); return res.status })
    const base = { key: 'auth', title: 'Sign-in service (Supabase Auth)', area: 'Supabase → Authentication', sort: 25 }
    if (r.err || r.v !== 200) return { ...base, status: 'red', summary: 'The sign-in service is not answering (' + (r.err || 'HTTP ' + r.v) + '). Users may not be able to log in.', advice: 'Check status.supabase.com and the Supabase dashboard → Authentication.', detail: { error: r.err, http: r.v } }
    return { ...base, status: 'green', summary: `Working (${r.t} ms).`, advice: 'Nothing to do.', detail: { ms: r.t } }
  },
  async storage(db) {
    const r = await timed(async () => { const { data, error } = await db.storage.listBuckets(); if (error) throw new Error(error.message); return data.length })
    const base = { key: 'storage', title: 'File storage (Supabase Storage)', area: 'Supabase → Storage (worker documents / vault)', sort: 30 }
    if (r.err) return { ...base, status: 'red', summary: 'File storage is not answering: ' + r.err, advice: 'Uploads and document downloads will fail. Check status.supabase.com and Supabase → Storage.', detail: { error: r.err } }
    return { ...base, status: 'green', summary: `Working — ${r.v} bucket(s), ${r.t} ms.`, advice: 'Nothing to do.', detail: { buckets: r.v, ms: r.t } }
  },
  async domain() {
    const r = await timed(async () => {
      const res = await fetch('https://rdap.verisign.com/com/v1/domain/' + DOMAIN, { headers: { accept: 'application/rdap+json' } })
      if (!res.ok) throw new Error('RDAP HTTP ' + res.status)
      const d = await res.json()
      // deno-lint-ignore no-explicit-any
      const exp = (d.events || []).find((e: any) => e.eventAction === 'expiration')?.eventDate as string | undefined
      // deno-lint-ignore no-explicit-any
      const reg = (d.entities || []).find((e: any) => (e.roles || []).includes('registrar'))?.vcardArray?.[1]?.find((x: any) => x[0] === 'fn')?.[3] as string | undefined
      return { exp, reg }
    })
    const base = { key: 'domain', title: 'Domain ' + DOMAIN + ' (registration)', area: 'eNom (registrar & DNS) — access.enom.com', sort: 120 }
    if (r.err || !r.v?.exp) return { ...base, status: 'grey', summary: 'Could not read the domain expiry date from the public registry (' + (r.err || 'no date') + ').', advice: 'Try again later, or log in to eNom (your eNom account, password in your password manager) and check the expiry date.', detail: { error: r.err } }
    const n = days(r.v.exp)
    return { ...base, status: n < 14 ? 'red' : n < 60 ? 'amber' : 'green', summary: `${n} day(s) left — registered at ${r.v.reg || 'eNom'}, expires ${fmtDate(r.v.exp)}.`, advice: n < 60 ? 'Renew the domain at eNom now (access.enom.com → your eNom account, password in your password manager). If it lapses the website and app links stop working.' : 'Nothing to do yet. Keep auto-renew on at eNom.', detail: { expires: r.v.exp, days: n, registrar: r.v.reg } }
  },
  async dns() {
    const r = await timed(async () => {
      const res = await fetch('https://dns.google/resolve?name=fw.' + DOMAIN + '&type=CNAME', { headers: { accept: 'application/dns-json' } })
      const d = await res.json()
      // deno-lint-ignore no-explicit-any
      return ((d.Answer || []) as any[]).filter((a) => a.type === 5).map((a) => String(a.data))
    })
    const base = { key: 'dns', title: 'DNS: fw.' + DOMAIN + ' → GitHub Pages', area: 'eNom DNS (Host Records)', sort: 125 }
    if (r.err) return { ...base, status: 'grey', summary: 'Could not look up DNS (' + r.err + ').', advice: 'Try again later.', detail: { error: r.err } }
    const ok = r.v!.some((c) => c.replace(/\.$/, '').toLowerCase() === 'moulisankar999.github.io')
    return ok ? { ...base, status: 'green', summary: 'fw.' + DOMAIN + ' points to moulisankar999.github.io (CNAME) as it should.', advice: 'Nothing to do.', detail: { cname: r.v } }
      : { ...base, status: 'red', summary: 'fw.' + DOMAIN + ' does NOT point to GitHub Pages (found: ' + (r.v!.join(', ') || 'nothing') + ').', advice: 'In eNom → Host Records set "fw" as CNAME to moulisankar999.github.io. (your eNom account, password in your password manager).', detail: { cname: r.v } }
  },
  async edge_secrets() {
    const names = ['SUPABASE_SERVICE_ROLE_KEY', 'CRON_SECRET', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'HEALTH_INGEST_SECRET']
    const optional = ['EMAIL_PROVIDER', 'EMAIL_FROM', 'SMS_PROVIDER', 'WA_ACCESS_TOKEN']
    const present = Object.fromEntries(names.concat(optional).map((n) => [n, env(n).length > 0]))
    const missing = names.filter((n) => !present[n])
    const email = present.EMAIL_PROVIDER ? 'email alerts: ' + env('EMAIL_PROVIDER') : 'email alerts: not set up (no email provider)'
    const sms = present.SMS_PROVIDER ? 'SMS: ' + env('SMS_PROVIDER') : 'SMS: not set up'
    return { key: 'edge_secrets', title: 'Server secrets (Supabase Edge Functions)', area: 'Supabase → Edge Functions → Secrets', sort: 170, status: missing.length ? 'red' : 'green',
      summary: (missing.length ? 'Missing: ' + missing.join(', ') + '.' : `All ${names.length} required secrets are present (values are never shown).`) + ' Optional: ' + email + '; ' + sms + '.',
      advice: missing.length ? 'Add the missing secret(s) in Supabase → Edge Functions → Secrets (values are in the build machine\'s .secrets.env).' : present.EMAIL_PROVIDER ? 'Nothing to do.' : 'Nothing required. To also get alerts by email, add an email provider (EMAIL_PROVIDER + its API key + EMAIL_FROM) in Supabase → Edge Functions → Secrets.', detail: { present } }
  },
  async android_release() {
    const r = await timed(async () => {
      const res = await fetch(`https://api.github.com/repos/${GH_REPO}/releases/latest`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'fw-manager-health' } })
      if (!res.ok) throw new Error('GitHub HTTP ' + res.status)
      const d = await res.json()
      // deno-lint-ignore no-explicit-any
      const apk = (d.assets || []).find((a: any) => a.name === 'FW-Manager.apk')
      const site = await fetch(SITE + '/version.json?t=' + Date.now()).then((x) => x.ok ? x.json() : null).catch(() => null)
      return { tag: d.tag_name as string, at: d.published_at as string, apk: !!apk, size: apk?.size, web: site?.version as string | undefined }
    })
    const base = { key: 'android_release', title: 'Android app (APK download)', area: 'GitHub → Releases (latest/download/FW-Manager.apk)', sort: 90 }
    if (r.err) return { ...base, status: 'grey', summary: 'Could not read GitHub releases (' + r.err + ').', advice: 'Try again later (GitHub limits anonymous requests).', detail: { error: r.err } }
    const v = (r.v!.tag || '').replace(/^v/, '').replace(/-android$/, '')
    const same = !r.v!.web || v === r.v!.web
    const st = !r.v!.apk ? 'red' : same ? 'green' : 'amber'
    return { ...base, status: st, summary: !r.v!.apk ? `The latest release ${r.v!.tag} has no FW-Manager.apk file — the download link is broken.` : `Latest APK is ${v} (published ${fmtDate(r.v!.at)})${same ? ' — same as the website.' : ', but the website is ' + r.v!.web + '.'}`,
      advice: st === 'green' ? 'Nothing to do.' : !r.v!.apk ? 'Upload FW-Manager.apk to the latest GitHub release.' : 'Build and publish the Android release for the current version so phone users get the same features.', detail: { ...r.v, version: v } }
  },
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
  // deno-lint-ignore no-explicit-any
  const body: any = await req.json().catch(() => ({}))

  // 1) results pushed by the GitHub workflow
  const ingest = req.headers.get('x-health-secret') || ''
  if (ingest) {
    if (!eqSecret(ingest, env('HEALTH_INGEST_SECRET'))) return json({ error: 'forbidden' }, 403)
    const items = (Array.isArray(body.items) ? body.items : []).slice(0, 40)
      // deno-lint-ignore no-explicit-any
      .filter((i: any) => typeof i?.key === 'string' && /^gh_[a-z0-9_]{1,40}$/.test(i.key) && ['green', 'amber', 'red', 'grey'].includes(i.status))
      // deno-lint-ignore no-explicit-any
      .map((i: any) => ({ key: i.key, status: i.status, title: String(i.title || i.key).slice(0, 120), summary: String(i.summary || '').slice(0, 600), advice: String(i.advice || '').slice(0, 600), area: String(i.area || '').slice(0, 200), detail: typeof i.detail === 'object' && i.detail ? i.detail : {}, sort: Number(i.sort) || 100 }))
    const { data, error } = await db.rpc('health_record_many', { p_items: items, p_source: 'github' })
    if (error) return json({ error: 'could not save' }, 500)
    return json({ ok: true, saved: data })
  }

  // 2) the 30-minute schedule, or 3) the CEO pressing "Run check now"
  let who = 'cron'
  if (!eqSecret(req.headers.get('x-cron-secret') || '', env('CRON_SECRET'))) {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    const { data: u } = token ? await db.auth.getUser(token) : { data: null }
    if (!u?.user) return json({ error: 'Please sign in again' }, 401)
    const { data: p } = await db.from('profiles').select('role,status').eq('id', u.user.id).maybeSingle()
    if (!p || p.status !== 'active' || !['super_admin', 'admin'].includes(p.role)) return json({ error: 'Only the CEO can run health checks' }, 403)
    who = 'ceo'
  }
  const only = typeof body.only === 'string' ? body.only : ''
  const DB_KEYS = ['db_size', 'storage_size', 'row_counts', 'cron', 'push', 'backup', 'app_errors']
  const runDb = !only || DB_KEYS.includes(only) || only.startsWith('renew_')
  const keys = only ? (CHECKS[only] ? [only] : []) : Object.keys(CHECKS).filter((k) => k !== 'android_release' || who === 'ceo' || new Date().getUTCMinutes() < 30)
  const items = await Promise.all(keys.map(async (k) => {
    try { return await CHECKS[k](db) } catch (e) { return { key: k, status: 'grey', title: k, summary: 'The check itself failed: ' + String((e as Error)?.message || e).slice(0, 200), advice: 'Try again; if it keeps failing look at Supabase → Edge Functions → health-check → Logs.', area: 'health-check function' } as Item }
  }))
  if (items.length) { const { error } = await db.rpc('health_record_many', { p_items: items, p_source: who === 'ceo' ? 'manual' : 'edge' }); if (error) return json({ error: 'could not save results' }, 500) }
  if (runDb) { const { error } = await db.rpc('health_db_checks'); if (error) return json({ error: 'database checks failed' }, 500) }
  if (only.startsWith('gh_')) return json({ ok: true, note: 'This tile is checked by the scheduled GitHub workflow "health-report" (every 30 min). Run it from GitHub → Actions → health-report → Run workflow.' })
  return json({ ok: true, ran: items.map((i) => i.key).concat(runDb ? ['db'] : []) })
})
