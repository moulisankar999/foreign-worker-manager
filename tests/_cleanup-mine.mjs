// one-off: remove leftovers of THIS branch's suites only (prefixes below), incl. app-deleted tombstones
import { createRequire } from 'module'; import fs from 'fs'
import { cleanupOwn } from './_own.mjs'
const require = createRequire(new URL('../package.json', import.meta.url)); const { createClient } = require('@supabase/supabase-js')
const env = Object.fromEntries(fs.readFileSync(new URL('../.secrets.env', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
if (!env.TEST_SUPABASE_URL || env.TEST_SUPABASE_URL.includes('gnepquxtwkyffjmoydnv') || !env.TEST_SUPABASE_URL.includes(env.TEST_PROJECT_REF)) process.exit(1)
const admin = createClient(env.TEST_SUPABASE_URL, env.TEST_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
for (const p of ['fws-', 'fwt-', 'fwr-', 'fwn-', 'fwu-', 'fwa-', 'fwc-', 'fwd-', 'fwp-', 'fwh-']) console.log(p, await cleanupOwn(admin, p))
