// v1.3.4 UI e2e on TEST: platform label (iPad/iPhone UA + Capacitor ios/android/web), error-capture platform, Clear list + badges.
// Usage: UI_URL=<TEST build> node tests/platform-ui.mjs   (refuses the live project)
import fs from 'node:fs'
import { createRequire } from 'node:module'
const ROOT = new URL('..', import.meta.url).pathname
const require = createRequire(ROOT + 'package.json')
const { createClient } = require('@supabase/supabase-js')
const { chromium } = createRequire(process.env.PW_PKG || ROOT + 'package.json')('playwright')
const env = Object.fromEntries(fs.readFileSync(ROOT + '.secrets.env', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const URL_ = env.TEST_SUPABASE_URL, UI = process.env.UI_URL
if (!URL_ || URL_.includes('gnepquxtwkyffjmoydnv') || !URL_.includes(env.TEST_PROJECT_REF)) { console.error('ABORT'); process.exit(1) }
const admin = createClient(URL_, env.TEST_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
let pass = 0, fail = 0
const check = (n, ok, info = '') => { if (ok) { pass++; console.log('PASS', n) } else { fail++; console.log('FAIL', n, String(info).slice(0, 400)) } }
const IPAD_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)' // iPadOS WKWebView (desktop mode)
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'
const stamp = Date.now(), pw = 'Plt-' + stamp + '-x!'
const email = `fwm-plt-ceo-${stamp}@example.com`
const { data: cu, error: ce } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: 'PLT CEO' } })
if (ce) throw ce
const uid = cu.user.id
await admin.from('profiles').update({ role: 'super_admin', status: 'active', full_name: 'PLT CEO' }).eq('id', uid)
const browser = await chromium.launch()
// cap: 'ios' | 'android' | null — the Capacitor platform the page reports (custom platform = web plugin implementations)
async function session(ua, cap, touch) {
  const ctx = await browser.newContext({ userAgent: ua, hasTouch: touch, viewport: { width: 1024, height: 1300 } })
  if (cap) await ctx.addInitScript((name) => { window.CapacitorCustomPlatform = { name, plugins: {} } }, cap)
  if (touch) await ctx.addInitScript(() => { Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 }); Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' }) })
  const p = await ctx.newPage()
  await p.goto(UI); await p.fill('#em', email); await p.fill('#pw', pw); await p.locator('form button[type=submit]').first().click()
  await p.waitForTimeout(6000)
  return { ctx, p }
}
const aboutPlatform = async (p) => {
  await p.goto(UI + '#/settings/about'); await p.waitForTimeout(2500)
  return (await p.locator('.about-kv div', { hasText: 'Platform' }).locator('dd').innerText().catch(() => '?')).trim()
}
try {
  for (const [name, ua, cap, touch, want] of [
    ['iPad TestFlight (Mac UA, Capacitor ios)', IPAD_UA, 'ios', true, 'iPhone / iPad app'],
    ['iPhone app (Capacitor ios)', IPHONE_UA, 'ios', true, 'iPhone / iPad app'],
    ['Android app (Capacitor android)', ANDROID_UA, 'android', true, 'Android app'],
    ['iPad Safari (web, Mac UA + touch)', IPAD_UA, null, true, 'Web app (iPhone / iPad)'],
  ]) {
    const s = await session(ua, cap, touch)
    const got = await aboutPlatform(s.p)
    check(`About → Platform: ${name} = "${want}"`, got === want, got)
    if (cap) {
      const tag = `pw-platform-${cap}-${stamp}-${name.length}`
      await s.p.evaluate((m) => { setTimeout(() => { throw new Error(m) }, 0) }, tag); await s.p.waitForTimeout(4000)
      const { data } = await admin.from('app_errors').select('platform,app_version').eq('message', tag)
      const d2 = data?.length ? data : (await admin.from('app_errors').select('platform,app_version,message').ilike('message', `%${tag}%`)).data
      check(`error log records platform "${cap}" (${name})`, d2?.[0]?.platform === cap && d2?.[0]?.app_version === JSON.parse(fs.readFileSync(ROOT + 'package.json', 'utf8')).version, JSON.stringify(d2))
    }
    await s.ctx.close()
  }

  // Clear list: 3 errors + a stale tile (count24h 3), as on the iPad
  await admin.from('app_errors').delete().eq('user_id', uid)
  const now = new Date().toISOString()
  await admin.from('app_errors').insert([1, 2, 3].map((i) => ({ user_id: uid, user_role: 'super_admin', kind: 'network', message: `Network request failed (pw ${i})`, url: '#/workers', app_version: i === 3 ? '1.3.2' : '1.3.4', platform: 'android', user_agent: IPAD_UA, fingerprint: `pw-${stamp}-${i}`, last_seen: now })))
  const { data: tileBefore } = await admin.from('health_latest').select('*').eq('check_key', 'app_errors').maybeSingle()
  await admin.from('health_latest').upsert({ ...(tileBefore || { title: 'App errors (last 24 h)', sort: 160, source: 'db', area: 'Software Control → Errors', changed_at: now }), check_key: 'app_errors', status: 'amber', detail: { count24h: 3 }, checked_at: now })
  const s = await session(IPAD_UA, 'ios', true)
  await s.p.goto(UI + '#/control/errors'); await s.p.waitForTimeout(4000)
  const tabTxt = async () => (await s.p.locator('.tabs, [role=tablist]').first().innerText().catch(() => '')).replace(/\s+/g, ' ')
  const side = async () => Number(((await s.p.locator('a', { hasText: 'Software Control' }).first().innerText().catch(() => '')).match(/(\d+)\s*$/) || [0, 0])[1])
  const sideBefore = await side()
  const rows = await s.p.locator('.err-list tr.dt-r').count()
  check('Errors list shows the errors before clearing', rows >= 3, rows)
  const listTxt = await s.p.locator('.err-list').innerText()
  check('old (1.3.2) row from an iPad shows "unknown (old app)"', listTxt.includes('unknown (old app) 1.3.2'), listTxt)
  check('Errors tab badge shows a count before clearing', /Errors\s*\d+/.test(await tabTxt()), await tabTxt())
  s.p.on('dialog', (d) => d.accept())
  await s.p.getByRole('button', { name: 'Clear list' }).click(); await s.p.waitForTimeout(3500)
  check('after Clear: list empty and Errors badge gone (no reload)', (await s.p.locator('.err-list tr.dt-r').count()) === 0 && !/Errors\s*\d+/.test(await tabTxt()), await tabTxt())
  const sideAfter = await side()
  check('sidebar Software Control badge drops by 1 straight after Clear', sideAfter === sideBefore - 1, `${sideBefore} -> ${sideAfter}`)
  await s.p.reload(); await s.p.waitForTimeout(6000); await s.p.goto(UI + '#/control/errors'); await s.p.waitForTimeout(4000)
  check('after reload: still empty, badge still gone', (await s.p.locator('.err-list tr.dt-r').count()) === 0 && !/Errors\s*\d+/.test(await tabTxt()), await tabTxt())
  const { count } = await admin.from('app_errors').select('id', { count: 'exact', head: true })
  const { data: tile } = await admin.from('health_latest').select('detail,status').eq('check_key', 'app_errors').single()
  check('server: rows deleted and the App errors tile reset to 0', count === 0 && tile.detail.count24h === 0 && tile.status === 'green', JSON.stringify({ count, tile }))
  const { data: au } = await admin.from('audit_log').select('action').eq('action', 'control.clear_errors').limit(1)
  check('clear is audit-logged', (au || []).length === 1, JSON.stringify(au))
  await s.p.screenshot({ path: '/tmp/plt-errors.png' })
  await s.ctx.close()
} finally {
  await browser.close()
  await admin.from('app_errors').delete().eq('user_id', uid)
  await admin.from('profiles').delete().eq('id', uid); await admin.auth.admin.deleteUser(uid).catch(() => {})
}
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
