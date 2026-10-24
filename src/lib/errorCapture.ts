// Client error capture (v1.3.0): JavaScript errors, unhandled promise rejections and failed Supabase calls are sent to
// the CEO-only error list (Software Control → Errors) via the log_client_error RPC. Only the error text, the screen
// (route without query) and app version/platform are sent — never request bodies, tokens or form data.
import { APP_VERSION, isNative } from './platform'

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
      p_version: APP_VERSION, p_platform: isNative() ? (/(iPhone|iPad|iOS)/i.test(navigator.userAgent) ? 'ios' : 'android') : 'web', p_agent: navigator.userAgent.slice(0, 300),
    })
  } catch { /* never let error reporting break the app */ }
}

/** fetch used by the Supabase client: reports failed API calls (5xx, 400, 403 and network failures while online). */
export const trackedFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const skip = /log_client_error|\/auth\/v1\/token/.test(url)
  let res: Response
  try {
    res = await fetch(input, init)
  } catch (e) {
    if (!skip && navigator.onLine) void reportError('network', 'Network request failed: ' + where(url, init), String((e as Error)?.message || e))
    throw e
  }
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
  window.addEventListener('error', (ev) => {
    if (!ev.message && ev.target && ev.target !== window) return // broken image etc.
    if (/ResizeObserver loop/.test(ev.message || '')) return
    void reportError('error', ev.message || 'Script error', [ev.filename, ev.lineno, ev.colno].filter(Boolean).join(':') + (ev.error?.stack ? '\n' + String(ev.error.stack) : ''))
  })
  window.addEventListener('unhandledrejection', (ev) => {
    const r = ev.reason as { message?: string; stack?: string } | string | undefined
    const msg = typeof r === 'string' ? r : r?.message || 'Unhandled promise rejection'
    if (ev.defaultPrevented || /^View-only access/.test(msg)) return
    if (/Failed to fetch|Load failed|NetworkError/i.test(msg) && !navigator.onLine) return
    void reportError('promise', msg, typeof r === 'object' ? r?.stack : undefined)
  })
}
