// Client error capture (v1.3.0): JavaScript errors, unhandled promise rejections and failed Supabase calls are sent to
// the CEO-only error list (Software Control → Errors) via the log_client_error RPC. Only the error text, the screen
// (route without query) and app version/platform are sent — never request bodies, tokens or form data.
import { APP_VERSION, isNative, platform } from './platform'

// deno-lint-ignore no-explicit-any
type Client = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<any>; auth: { getSession: () => Promise<{ data: { session: unknown } }> } }
let client: Client | null = null
let sent = 0
const recent = new Map<string, number>()
const MAX_PER_SESSION = 25

export function registerErrorClient(c: Client) { client = c }

const screen = () => (window.location.hash || '#/').replace(/\?.*$/, '').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id').slice(0, 200)

export async function reportError(kind: string, message: string, detail?: string) {
  try {
    if (!client || sent >= MAX_PER_SESSION) return
    const key = kind + '|' + message.slice(0, 200)
    const now = Date.now()
    if ((recent.get(key) || 0) > now - 5 * 60_000) return
    recent.set(key, now)
    const { data } = await client.auth.getSession()
    if (!data.session) return
    sent++
    await client.rpc('log_client_error', {
      p_kind: kind, p_message: message.slice(0, 1000), p_detail: detail ? detail.slice(0, 4000) : null, p_url: screen(),
      p_version: APP_VERSION, p_platform: isNative() ? platform() : 'web', p_agent: navigator.userAgent.slice(0, 300),
    })
  } catch { /* never let error reporting break the app */ }
}

// ---- network-failure noise reduction (v1.3.3) ----
// A fetch that dies with "Failed to fetch" / "Load failed" (no HTTP response at all) is almost always the device: offline,
// switching Wi-Fi/mobile data, or the app being suspended in the background (iOS kills in-flight requests and rejects them on
// resume). So: never report while offline/hidden or within RESUME_GRACE of coming back; retry read-only calls once, quietly;
// and only report endpoints that still have not answered when the grouped burst is checked (one grouped report).
const RESUME_GRACE = 30_000, GROUP_WAIT = 75_000 // > one 60 s sync cycle, so the next poll can prove it was transient
let lastWake = 0 // last time the app became visible / came online / resumed
const okAt = new Map<string, number>() // per endpoint: last time it got an HTTP response
const pending: { at: number; where: string; msg: string }[] = []
let groupTimer: ReturnType<typeof setTimeout> | null = null
const wake = () => { lastWake = Date.now() }
const READ_RPC = /\/rpc\/(pull_records|my_powers|approval_route|my_company_list|record_keys|notify_|worker_access_status|report_)/
export const isNetworkFailure = (msg: string) => /Failed to fetch|Load failed|NetworkError|network connection was lost|Network request failed|The Internet connection appears to be offline/i.test(msg)
/** True when a network failure is explained by the device (offline, backgrounded, just resumed or switched network). */
export function deviceExplainsNetworkFailure(now = Date.now()) {
  return !navigator.onLine || (typeof document !== 'undefined' && document.visibilityState === 'hidden') || now - lastWake < RESUME_GRACE
}
function queueNetworkFailure(where: string, msg: string) {
  const now = Date.now()
  if (deviceExplainsNetworkFailure(now)) return
  pending.push({ at: now, where, msg })
  if (groupTimer) return
  groupTimer = setTimeout(() => {
    groupTimer = null
    const batch = pending.splice(0)
    if (!batch.length) return
    // the device went away meanwhile → transient, stay quiet
    if (deviceExplainsNetworkFailure() || lastWake > batch[0].at - 5_000) return
    // the same endpoint answered after the failure → transient
    const still = batch.filter((b) => !((okAt.get(b.where) || 0) > b.at))
    if (!still.length) return
    const wheres = [...new Set(still.map((b) => b.where))]
    const msg = wheres.length === 1 ? 'Network request failed: ' + wheres[0] : `Network requests failed (${wheres.length}): ${wheres.join(', ')}`
    void reportError('network', msg.slice(0, 900), still[0].msg + ` · still failing after a quiet retry and ${Math.round(GROUP_WAIT / 1000)} s, while online and in the foreground`)
  }, GROUP_WAIT)
}

/** fetch used by the Supabase client: reports failed API calls (5xx, 400, 403) and network failures that are not explained by the device. */
export const trackedFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const skip = /log_client_error|\/auth\/v1\/token/.test(url)
  const method = (init?.method || (typeof input === 'object' && 'method' in input ? input.method : 'GET') || 'GET').toUpperCase()
  const readOnly = method === 'GET' || method === 'HEAD' || (method === 'POST' && READ_RPC.test(url))
  let res: Response
  try {
    res = await fetch(input, init)
  } catch (e) {
    const m = String((e as Error)?.message || e)
    if ((e as Error)?.name === 'AbortError') throw e
    if (readOnly && navigator.onLine && document.visibilityState !== 'hidden' && !init?.signal?.aborted) {
      // one quiet retry for read-only calls (typical after a resume / network switch)
      await new Promise((r) => setTimeout(r, 1500))
      try { res = await fetch(input, init); okAt.set(where(url, init), Date.now()); return res } catch { /* fall through */ }
    }
    if (!skip) queueNetworkFailure(where(url, init), m)
    throw e
  }
  okAt.set(where(url, init), Date.now())
  if (!skip && !res.ok && (res.status >= 500 || res.status === 400 || res.status === 403)) {
    let msg = ''
    try { const b = await res.clone().json(); msg = String(b?.message || b?.error_description || b?.error || b?.msg || '') } catch { /* not json */ }
    void reportError('supabase', `HTTP ${res.status} on ${where(url, init)}${msg ? ': ' + msg.slice(0, 300) : ''}`)
  }
  return res
}
function where(url: string, init?: RequestInit) {
  try { const u = new URL(url); return (init?.method || 'GET') + ' ' + u.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id').slice(0, 160) } catch { return 'request' }
}

let installed = false
export function installErrorCapture() {
  if (installed) return
  installed = true
  wake() // app launch counts as a fresh start (cold start after a network switch)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wake() })
  window.addEventListener('online', wake); window.addEventListener('offline', wake)
  window.addEventListener('pageshow', wake); window.addEventListener('focus', wake)
  if (isNative()) void import('@capacitor/app').then(({ App }) => App.addListener('appStateChange', (st) => { wake(); if (st.isActive) wake() })).catch(() => {})
  window.addEventListener('error', (ev) => {
    if (!ev.message && ev.target && ev.target !== window) return // broken image etc.
    if (/ResizeObserver loop/.test(ev.message || '')) return
    void reportError('error', ev.message || 'Script error', [ev.filename, ev.lineno, ev.colno].filter(Boolean).join(':') + (ev.error?.stack ? '\n' + String(ev.error.stack) : ''))
  })
  window.addEventListener('unhandledrejection', (ev) => {
    const r = ev.reason as { message?: string; stack?: string } | string | undefined
    const msg = typeof r === 'string' ? r : r?.message || 'Unhandled promise rejection'
    if (ev.defaultPrevented || /^View-only access/.test(msg)) return
    if (isNetworkFailure(msg)) return // the failed request itself is handled (grouped, device-aware) in trackedFetch
    void reportError('promise', msg, typeof r === 'object' ? r?.stack : undefined)
  })
}
