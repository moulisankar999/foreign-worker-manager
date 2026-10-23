// Unit test for the Malaysian SMS template validator (no network). Run: node --experimental-strip-types tests/sms-rules.test.mjs
const m = await import('../src/lib/notifyEvents.ts')
let pass = 0, fail = 0
const check = (n, ok) => { ok ? pass++ : fail++; console.log(ok ? 'PASS' : 'FAIL', n) }
const C = (t) => m.checkSms(t, 'ACME')
check('default templates all valid', Object.values(m.DEFAULT_NOTIFY.events).every((e) => C(e.sms).ok && C(e.workerSms || '').ok && C(e.sms).length <= 160))
check('URL rejected', !C('Open https://x.com now').ok && !C('see www.abc.my').ok && !C('go {{link}}').ok)
check('phone number rejected', !C('Call 012-345 6789').ok && !C('Call +60123456789').ok)
check('names / personal data rejected', !C('Worker {{worker}} approved').ok && !C('Send your IC no').ok)
check('emoji / non-ASCII rejected', !C('Approved ✅').ok)
check('over 160 warns (not error)', C('x'.repeat(155)).ok && C('x'.repeat(155)).warnings.length === 1)
check('preview has RM0 prefix', C('Request {{ref}} approved.').preview === 'RM0 ACME: Request R-1042 approved.')
check('Malay text ok', C('Permohonan {{ref}} diluluskan. Sila buka aplikasi FW Manager.').ok)
check('SMS cost default RM0.115', m.DEFAULT_NOTIFY.costs.sms === 0.115)
check('SMS off in the matrix by default (fallback only)', Object.values(m.DEFAULT_NOTIFY.events).every((e) => !e.channels.sms && !e.worker?.sms))
check('WhatsApp/SMS/email master switches OFF, in-app + push ON by default', m.DEFAULT_NOTIFY.enabled.whatsapp === false && m.DEFAULT_NOTIFY.enabled.sms === false && m.DEFAULT_NOTIFY.enabled.email === false && m.DEFAULT_NOTIFY.enabled.in_app && m.DEFAULT_NOTIFY.enabled.push)
check('WhatsApp utility template cost RM0.0564', m.DEFAULT_NOTIFY.costs.whatsapp === 0.0564)
{ const W = JSON.parse((await import('fs')).readFileSync(new URL('../supabase/functions/_shared/wa-templates.json', import.meta.url), 'utf8')).templates
  const names = new Set(W.map((t) => t.name))
  check('every event WhatsApp template exists in wa-templates.json', Object.values(m.DEFAULT_NOTIFY.events).every((e) => (!e.wa || names.has(e.wa)) && (!e.workerWa || names.has(e.workerWa))))
  check('templates are UTILITY and never start/end with a variable', W.every((t) => t.category === 'UTILITY' && t.components.filter((c) => c.type === 'BODY').every((c) => !/^\s*\{\{|\}\}\s*$/.test(c.text)))) }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
