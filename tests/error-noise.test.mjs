// v1.3.3: network-failure noise reduction in src/lib/errorCapture.ts (unit test, no network, no Supabase).
// Run: node tests/error-noise.test.mjs
import { build } from 'rolldown'
import { mock } from 'node:test'
import fs from 'node:fs'
const out = '/tmp/errorCapture.bundle.mjs'
await build({ input: new URL('../src/lib/errorCapture.ts', import.meta.url).pathname, platform: 'browser', logLevel: 'silent', output: { file: out, format: 'esm', codeSplitting: false } })
let pass = 0, fail = 0
const check = (n, ok, info = '') => { if (ok) { pass++; console.log('PASS', n) } else { fail++; console.log('FAIL', n, info) } }
// minimal browser globals
const listeners = {}
const on = (t, f) => { (listeners[t] ||= []).push(f) }
const fire = (t) => (listeners[t] || []).forEach((f) => f({}))
globalThis.window = { addEventListener: on, location: { hash: '#/workers/x' } }
globalThis.document = { visibilityState: 'visible', addEventListener: on }
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, userAgent: 'test' }, configurable: true, writable: true })
mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000_000_000 })
const m = await import(out)
const reports = []
m.registerErrorClient({ rpc: async (fn, a) => { reports.push(a) }, auth: { getSession: async () => ({ data: { session: {} } }) } })
m.installErrorCapture()
let mode = 'fail' // 'fail' | 'ok' | 'failOnce'
let calls = 0
globalThis.fetch = async () => { calls++; if (mode === 'ok' || (mode === 'failOnce' && calls > 1)) return new Response('[]', { status: 200 }); throw new TypeError('Load failed') }
const U = 'https://x.supabase.co/rest/v1/rpc/'
const call = (fn, method = 'POST') => m.trackedFetch(U + fn, { method, body: '{}' }).then(() => 'ok', () => 'err')
const micro = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
const tick = async (ms) => { await micro(); for (let t = 0; t < ms; t += 500) { mock.timers.tick(Math.min(500, ms - t)); await micro() } }
const run = async (p, ms = 2000) => { const r = p; await tick(ms); return r }
const flush = async () => { await tick(80_000); await new Promise((r) => setImmediate(r)) }
async function scenario(name, fn, expect) {
  reports.length = 0; calls = 0
  await tick(6 * 60_000) // past the resume grace and the 5-min dedupe window
  await fn(); await flush()
  check(name, expect(reports), JSON.stringify(reports.map((r) => r.p_message)))
}
await scenario('offline: failures are not reported', async () => { navigator.onLine = false; mode = 'fail'; await run(call('pull_records')); await run(call('my_powers')); navigator.onLine = true }, (r) => r.length === 0)
await scenario('backgrounded: failures are not reported', async () => { document.visibilityState = 'hidden'; mode = 'fail'; await run(call('pull_records')); document.visibilityState = 'visible' }, (r) => r.length === 0)
await scenario('just resumed (visibilitychange): burst within 30 s is not reported', async () => { mode = 'fail'; fire('visibilitychange'); await run(call('pull_records')); await run(call('my_powers')); await run(call('approval_route')) }, (r) => r.length === 0)
await scenario('network switch (online event): not reported', async () => { mode = 'fail'; fire('online'); await run(call('pull_records')) }, (r) => r.length === 0)
await scenario('read-only call: quiet retry succeeds → nothing reported, caller gets the response', async () => { mode = 'failOnce'; const r = call('pull_records'); await tick(2000); check('  retry returned ok', (await r) === 'ok' && calls === 2) }, (r) => r.length === 0)
await scenario('failure then the same endpoint answers on the next sync → not reported', async () => { mode = 'fail'; await run(call('push_records')); mode = 'ok'; await tick(60_000); await run(call('push_records')) }, (r) => r.length === 0)
await scenario('write call is NOT retried (no double writes)', async () => { mode = 'failOnce'; const r = call('push_records'); await tick(2000); check('  push_records called once', (await r) === 'err' && calls === 1) }, () => true)
await scenario('persistent failure while online + foreground → ONE grouped report', async () => { mode = 'fail'; await run(call('pull_records')); await run(call('my_powers')); await run(call('approval_route')) }, (r) => r.length === 1 && /Network requests failed \(3\)/.test(r[0].p_message) && /still failing/.test(r[0].p_detail))
await scenario('platform label comes from Capacitor (web here), not the user agent', async () => { mode = 'fail'; await run(call('my_company_list')) }, (r) => r.length === 1 && r[0].p_platform === 'web')
await scenario('unhandled "Load failed" rejection is not double-reported', async () => { (listeners.unhandledrejection || []).forEach((f) => f({ reason: new TypeError('Load failed'), defaultPrevented: false })) }, (r) => r.length === 0)
await scenario('real JS errors are still reported', async () => { (listeners.error || []).forEach((f) => f({ message: 'boom', error: new Error('boom') })) }, (r) => r.length === 1 && r[0].p_kind === 'error')
await scenario('HTTP 500 is still reported immediately', async () => { globalThis.fetch = async () => new Response('{"message":"x"}', { status: 500 }); await run(call('pull_records')) }, (r) => r.length === 1 && /HTTP 500/.test(r[0].p_message))
fs.rmSync(out, { force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
