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
check('SMS only on critical events by default', Object.values(m.DEFAULT_NOTIFY.events).every((e) => !e.channels.sms || e.critical))
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
