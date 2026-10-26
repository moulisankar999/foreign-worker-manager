// v1.4.2: Help / FAQ / role text never names a role two or more levels up; quota help is neutral for HR and has no CEO powers for the GM.
// t164u: no role sees the approval-power rule lines (CEO final / GM alone / own request). Pure check of src/help/content.ts (no database).
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const dir = mkdtempSync(join(tmpdir(), 'helpw-'))
const out = join(dir, 'content.mjs')
execFileSync('npx', ['rolldown', new URL('../src/help/content.ts', import.meta.url).pathname, '--format', 'esm', '-o', out], { cwd: new URL('..', import.meta.url).pathname, stdio: 'pipe' })
const H = await import(out)
const LEVEL = { viewer: 0, om: 1, hrm: 2, hra: 3, gm: 4, ceo: 5 }
const NAMES = { gm: [/\bGeneral Manager\b/, /\bGM\b/], ceo: [/\bCEO\b/], hra: [/\bHR Admin\b/] }
let fails = 0
const bad = (r, where, msg, t) => { fails++; console.log(`FAIL ${r} · ${where}: ${msg}\n     ${t.slice(0, 160)}`) }
const textOf = (x) => JSON.stringify(x)
for (const r of Object.keys(LEVEL)) {
  const items = [['role info', H.ROLE_INFO[r]], ...H.guidesFor(r).map((g) => [`guide ${g.id}`, g]), ...H.faqsFor(r).map((f) => [`faq "${f.q}"`, f])]
  for (const [where, x] of items) {
    const t = textOf(x)
    for (const [k, res] of Object.entries(NAMES)) if (LEVEL[k] >= LEVEL[r] + 2) for (const re of res) if (re.test(t)) bad(r, where, `names ${k}`, t)
    const quota = where.startsWith('guide quota') || /quota|calling visa|ledger entry|Rules & regulations/i.test(x.q || '')
    if (quota && (r === 'hra' || r === 'hrm') && /\b(CEO|GM|General Manager)\b/.test(t)) bad(r, where, 'quota text names a superior', t)
    // t164u: no role (the CEO included) sees approval-power explanations
    if (/alone is (final|never|not)|never enough|approves? (their|his|her|your) own|own request|he raised|not the person who entered|waits for the CEO|another GM or the CEO/i.test(t) || /\bCMOs?\b|Quota & Recruitment/.test(t)) bad(r, where, 'approval-power / old wording', t)
    if (r === 'gm' && /CEO alone|GM step skipped|only the CEO can override|CEO override|without the GM/i.test(t)) bad(r, where, 'GM sees a CEO power', t)
  }
}
console.log(fails ? `${fails} wording problem(s)` : 'help wording: OK for every role')
process.exit(fails ? 1 : 0)
