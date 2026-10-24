// Uploads the built PDFs to the private "manuals" bucket of the TEST project and checks role access:
// each role can get a signed URL for its own manual (and the worker guide), never for another role's.
// TEST only (guards in test-env.mjs). For live, run the same upload with the live service key at ship time.
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { admin, URL_, ANON, STATE } from './test-env.mjs'
const { createClient } = createRequire(new URL('../../package.json', import.meta.url).pathname)('@supabase/supabase-js')
const DIR = process.env.MANUALS_DIR || '/workspace/manuals/'
const FILES = { ceo: 'fwm-manual-ceo.pdf', gm: 'fwm-manual-general-manager.pdf', hra: 'fwm-manual-hr-admin.pdf', hrm: 'fwm-manual-hr-manager.pdf', om: 'fwm-manual-outlet-manager.pdf', worker: 'fw-worker-manual.pdf' }
for (const f of Object.values(FILES)) {
  const { error } = await admin.storage.from('manuals').upload(f, fs.readFileSync(DIR + f), { contentType: 'application/pdf', upsert: true })
  console.log(error ? `upload FAIL ${f}: ${error.message}` : `uploaded ${f}`)
}
const S = JSON.parse(fs.readFileSync(STATE, 'utf8')); let pass = 0, fail = 0
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
async function tryAll(who, c, allowed) {
  for (const [k, f] of Object.entries(FILES)) {
    const { data, error } = await c.storage.from('manuals').createSignedUrl(f, 60)
    let ok = false
    if (data?.signedUrl) { const r = await fetch(data.signedUrl); const b = Buffer.from(await r.arrayBuffer()); ok = r.ok && b.subarray(0, 4).toString() === '%PDF' }
    const want = allowed.includes(k); const good = ok === want; good ? pass++ : fail++
    console.log(`${good ? 'ok  ' : 'FAIL'} ${who.padEnd(7)} ${f.padEnd(32)} ${ok ? 'allowed' : 'denied'}${good ? '' : ' (expected ' + (want ? 'allowed' : 'denied') + ')' + (error ? ' ' + error.message : '')}`)
  }
}
const allow = { ceo: Object.keys(FILES), gm: ['gm', 'worker'], hra: ['hra', 'worker'], hrm: ['hrm', 'worker'], om: ['om', 'worker'], viewer: [] }
for (const role of Object.keys(allow)) {
  const c = createClient(URL_, ANON, opts); const { error } = await c.auth.signInWithPassword({ email: S.users[role].email, password: S.pw })
  if (error) { console.log('sign-in failed', role, error.message); fail++; continue }
  await tryAll(role, c, allow[role]); await c.auth.signOut()
}
{ // worker: same public sign-in the FW Worker app uses
  const r = await fetch(`${URL_}/functions/v1/worker-auth`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` }, body: JSON.stringify({ action: 'login', passport: S.pp, pin: S.pin }) })
  const j = await r.json(); const c = createClient(URL_, ANON, opts)
  if (!j.session) { console.log('worker sign-in failed', j.error); fail++ } else { await c.auth.setSession({ access_token: j.session.access_token, refresh_token: j.session.refresh_token }); await tryAll('worker', c, ['worker']) }
}
{ const c = createClient(URL_, ANON, opts); await tryAll('anon', c, []) }
console.log(`manual access: ${pass} ok, ${fail} failed`); process.exit(fail ? 1 : 0)
