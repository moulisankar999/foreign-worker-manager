// Builds the printed user manuals (A4 PDF) from src/help/content.ts + src/worker/help.ts and the screenshots.
// Run: node scripts/manuals/build.mjs   (needs screenshots from shots.mjs in /workspace/manuals/shots)
// Output: /workspace/manuals/<file>.pdf — file names are the lower-case names used in the private "manuals" bucket.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const req = createRequire(process.env.PLAYWRIGHT_PKG || '/workspace/tools/pw/node_modules/playwright/package.json')
const { chromium } = req('playwright')
const { PDFDocument, StandardFonts, rgb } = req('pdf-lib')
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const OUT = process.env.MANUALS_DIR || '/workspace/manuals/'
const SHOTS = process.env.SHOTS_DIR || OUT + 'shots/'
const TMP = '/tmp/mbuild/'; fs.mkdirSync(TMP, { recursive: true })
const VERSION = JSON.parse(fs.readFileSync(ROOT + '/package.json', 'utf8')).version
const DATE = process.env.MANUAL_DATE || new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
const DEV = 'Developed by Mouli Sankar, mouli@mouli.biz'
const TAMIL_FONT = process.env.TAMIL_FONT || '/workspace/tools/fonts/NotoSansTamil.ttf'

// bundle the TS content for Node
for (const [src, out] of [['src/help/content.ts', 'content.mjs'], ['src/worker/help.ts', 'whelp.mjs']])
  execFileSync('npx', ['rolldown', src, '--format', 'esm', '-o', TMP + out], { cwd: ROOT, stdio: 'pipe' })
const C = await import(pathToFileURL(TMP + 'content.mjs').href + '?' + Date.now())
const W = await import(pathToFileURL(TMP + 'whelp.mjs').href + '?' + Date.now())

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const md = (s) => esc(s).replace(/&quot;([^&]{1,60}?)&quot;/g, '<b>“$1”</b>')
const img = (name) => { const f = SHOTS + name + '.png'; return fs.existsSync(f) ? pathToFileURL(f).href : null }
const logo = fs.readFileSync(ROOT + '/public/icon.svg', 'utf8')
const missing = new Set()

const CSS = `
@font-face { font-family: 'Noto Sans Tamil'; src: url('${pathToFileURL(TAMIL_FONT).href}'); }
@page { size: A4; margin: 20mm 16mm 18mm 16mm; }
* { box-sizing: border-box; }
body { font-family: 'Noto Sans', 'Noto Sans Tamil', 'DejaVu Sans', sans-serif; color: #1f2937; font-size: 10.5pt; line-height: 1.5; margin: 0; }
.ta { font-family: 'Noto Sans Tamil', 'Noto Sans', sans-serif; }
h1 { font-size: 20pt; color: #0b3b36; margin: 0 0 6mm; padding-bottom: 2mm; border-bottom: 2.5px solid #14b8a6; break-after: avoid; }
h1.sec { break-before: page; }
h2 { font-size: 13.5pt; color: #0b3b36; margin: 7mm 0 2mm; break-after: avoid; }
h3 { font-size: 11pt; color: #115e59; margin: 4mm 0 1mm; break-after: avoid; }
.mk { color: #fff; font-size: 1px; }
p { margin: 1.5mm 0; }
ol.steps { padding-left: 0; list-style: none; counter-reset: s; margin: 2mm 0; }
ol.steps li { counter-increment: s; position: relative; padding-left: 9mm; margin: 1.6mm 0; break-inside: avoid; }
ol.steps li::before { content: counter(s); position: absolute; left: 0; top: .2mm; width: 6mm; height: 6mm; border-radius: 50%; background: #dc2626; color: #fff; font-weight: 700; font-size: 9pt; line-height: 6mm; text-align: center; }
ul { margin: 1mm 0; padding-left: 5mm; } ul li { margin: .8mm 0; }
figure { margin: 3mm 0 4mm; break-inside: avoid; text-align: center; }
figure img { max-width: 100%; max-height: 112mm; border: 1px solid #cbd5e1; border-radius: 2mm; box-shadow: 0 1px 3px rgba(0,0,0,.12); }
figure.phone img { max-height: 125mm; }
figcaption { font-size: 8.5pt; color: #64748b; margin-top: 1mm; }
.guide { break-inside: auto; margin-bottom: 4mm; }
.call { border-left: 4px solid; border-radius: 1.5mm; padding: 2mm 3mm; margin: 2.5mm 0; break-inside: avoid; font-size: 10pt; }
.call b.t { display: block; margin-bottom: .5mm; }
.tip { border-color: #0d9488; background: #f0fdfa; } .imp { border-color: #d97706; background: #fffbeb; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
.box { border: 1px solid #e2e8f0; border-radius: 2mm; padding: 2.5mm 3.5mm; break-inside: avoid; }
.box h3 { margin-top: 0; }
.ok h3 { color: #15803d; } .shared h3 { color: #475569; }
.chain { display: flex; flex-wrap: wrap; align-items: center; gap: 1.5mm; margin: 3mm 0; }
.chain span.n { background: #0b3b36; color: #fff; border-radius: 2mm; padding: 1.5mm 2.5mm; font-weight: 600; font-size: 9pt; }
.chain span.n.me { background: #dc2626; } .chain span.a { color: #64748b; font-weight: 700; }
.faq { break-inside: avoid; margin: 2.5mm 0; } .faq .q { font-weight: 700; color: #0b3b36; } .faq .q::before { content: 'Q. '; color: #dc2626; }
.toc a { color: inherit; text-decoration: none; }
.toc .row { display: flex; gap: 2mm; margin: 1.2mm 0; } .toc .row.l1 { font-weight: 700; margin-top: 3mm; } .toc .row.l2 { padding-left: 7mm; font-size: 9.8pt; }
.toc .dots { flex: 1; border-bottom: 1px dotted #94a3b8; margin-bottom: 1.2mm; }
.cover { height: 257mm; display: flex; flex-direction: column; }
.cover .band { background: linear-gradient(135deg, #0b3b36, #0f766e); color: #fff; border-radius: 4mm; padding: 16mm 12mm; margin-top: 30mm; }
.cover .logo svg { width: 26mm; height: 26mm; } .cover h1 { color: #fff; border: 0; font-size: 28pt; margin: 6mm 0 2mm; padding: 0; }
.cover .role { font-size: 20pt; font-weight: 300; } .cover .meta { margin-top: auto; color: #475569; font-size: 10.5pt; line-height: 1.7; }
.cover .meta b { color: #0b3b36; }
.wk { display: grid; grid-template-columns: 70mm 1fr; gap: 6mm; align-items: start; break-inside: avoid; margin: 3mm 0 6mm; }
.wk figure { margin: 0; } .wk figure img { max-height: 135mm; }
.wk ol.steps li { font-size: 12.5pt; } .wk .en ol.steps li { font-size: 10.5pt; color: #475569; } .wk .en { margin-top: 3mm; border-top: 1px solid #e2e8f0; padding-top: 2mm; }
.lead { font-size: 11.5pt; }
`
const page = (body, extra = '') => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}${extra}</style></head><body>${body}</body></html>`

function coverHtml(title, role, sub = '') {
  return page(`<div class="cover"><div class="band"><div class="logo">${logo}</div><h1>${esc(title)}</h1><div class="role">${role}</div>${sub}</div>
  <div class="meta"><b>Version ${esc(VERSION)}</b> · ${esc(DATE)}<br>${esc(DEV)}<br><span style="font-size:9pt">Screenshots use made-up test data only. Your screens may differ slightly by device and by the role settings your company uses.</span></div></div>`)
}
function tocHtml(entries, pages, offset, heading = 'Contents') {
  return page(`<h1>${heading}</h1><div class="toc">${entries.map((e) => `<div class="row l${e.level}"><span>${esc(e.label)}</span><span class="dots"></span><span>${pages[e.id] ? pages[e.id] + offset : '–'}</span></div>`).join('')}</div>`)
}
const fig = (name, cap, n, phone = false) => { const u = img(name); if (!u) { missing.add(name); return '' } return `<figure class="${phone || name.includes('phone') || name === 'login' ? 'phone' : ''}"><img src="${u}"><figcaption>Figure ${n}. ${esc(cap)}</figcaption></figure>` }

// ---------- staff manual
function staffBody(role) {
  const R = C.ROLE_INFO[role], T = C.ROLE_TITLE[role], toc = []; let s = 0, f = 0, html = ''
  const sec = (title) => { s++; const id = 'S' + s; toc.push({ id, level: 1, label: `${s}. ${title}` }); return `<h1 class="${s > 1 ? 'sec' : ''}"><span class="mk">[[${id}]]</span>${s}. ${esc(title)}</h1>` }
  let sub = 0; const h2 = (title) => { sub++; const id = `S${s}.${sub}`; toc.push({ id, level: 2, label: `${s}.${sub} ${title}` }); return `<h2><span class="mk">[[${id}]]</span>${s}.${sub} ${esc(title)}</h2>` }
  // 1 Role
  html += sec(`Your role: ${T}`); sub = 0
  html += `<p class="lead">${md(R.purpose)}</p>`
  const me = { ceo: 5, gm: 4, hra: 3, hrm: 2, om: 1 }[role]
  const chain = C.chainFor(role)
  if (chain.length) html += h2('The approval chain') + `<div class="chain">${chain.map((c, i) => `<span class="n${i === me ? ' me' : ''}">${esc(c)}</span>`).join('<span class="a">→</span>')}</div>`
  if (chain.length) html += `<p>${md('Requests move up this chain one step at a time.' + (role === 'ceo' ? ' The CEO reviews decisions and can overrule, amend, recall or mark them reviewed. The CEO and the General Manager can assign or escalate a request to any person at any level.' : role === 'gm' ? ' You can assign a request to anyone at your level or below, or send it on to the next approval step.' : ''))} Your place in the chain is shown in red.</p>`
  html += `<div class="grid2"><div class="box"><h3>Who you report to</h3><p>${md(R.reportsTo)}</p></div><div class="box"><h3>Where requests and approvals go</h3><p>${md(R.approvals)}</p></div></div>`
  html += h2('Responsibilities and access') + `<div class="box"><h3>What you see</h3><ul>${R.sees.map((x) => `<li>${md(x)}</li>`).join('')}</ul></div>`
  const ownBox = `<div class="box ok"><h3>✔ What you own and do</h3><ul>${R.can.map((x) => `<li>${md(x)}</li>`).join('')}</ul></div>`
  html += R.cannot.length ? `<div class="grid2" style="margin-top:4mm">${ownBox}<div class="box shared"><h3>↔ How the work is shared</h3><ul>${R.cannot.map((x) => `<li>${md(x)}</li>`).join('')}</ul></div></div>` : `<div style="margin-top:4mm">${ownBox}</div>`
  html += h2('Your daily routine') + `<ol class="steps">${R.daily.map((x) => `<li>${md(x)}</li>`).join('')}</ol>`
  html += `<div class="call tip"><b class="t">Tip</b>${md('In the app, open Help → My role to see this page at any time. Help → FAQ answers the most common questions for your role.')}</div>`
  // How-to sections by group
  const gs = C.guidesFor(role)
  for (const g of C.GROUPS) {
    const list = gs.filter((x) => x.group === g); if (!list.length) continue
    html += sec(g); sub = 0
    for (const gd of list) {
      html += `<div class="guide">${h2(gd.title)}`
      if (gd.intro) html += `<p>${md(gd.intro)}</p>`
      html += `<ol class="steps">${gd.steps.map((x) => `<li>${md(x)}</li>`).join('')}</ol>`
      for (const sh of gd.shots || []) { const pick = role !== 'ceo' && sh === 'dashboard' && img('dashboard-' + role) ? 'dashboard-' + role : sh; html += fig(pick, `${gd.title}${(gd.shots || []).length > 1 ? '' : ''} — the red numbers match the steps above.`, ++f) }
      if (gd.tip) html += `<div class="call tip"><b class="t">Tip</b>${md(gd.tip)}</div>`
      if (gd.important) html += `<div class="call imp"><b class="t">Important</b>${md(gd.important)}</div>`
      html += `</div>`
    }
  }
  // FAQ
  html += sec('Frequently asked questions'); sub = 0
  html += C.faqsFor(role).map((q) => `<div class="faq"><div class="q">${md(q.q)}</div><div>${md(q.a)}</div></div>`).join('')
  // support
  html += sec('Getting help'); sub = 0
  html += `<p>Help inside the app: <b>Help</b> in the left menu (on a phone: <b>More → Help</b>) has your role page, the FAQ and these step-by-step guides. The <b>Download PDF manual</b> button there always gives the newest version of this document.</p>
  <p>Account matters (forgotten password, paused account, role settings) are handled by your admin.</p><p>Software problems: ${role === 'ceo' ? 'open Software Control → Errors to see the details.' : 'report them to your admin.'} ${esc(DEV)}.</p>`
  return { html: page(html), toc }
}

// ---------- worker guide (Tamil first, then English)
function workerBody() {
  const ta = W.WORKER_HELP.ta, en = W.WORKER_HELP.en, toc = []; let s = 0, html = ''
  const sec = (tt, et) => { s++; const id = 'S' + s; toc.push({ id, level: 1, label: `${s}. ${tt} / ${et}` }); return `<h1 class="${s > 1 ? 'sec' : ''}"><span class="mk">[[${id}]]</span>${s}. <span class="ta">${esc(tt)}</span> <span style="font-weight:400;color:#64748b">/ ${esc(et)}</span></h1>` }
  const SH = [['w-home-ta'], ['w-login-ta'], ['w-docs-ta'], ['w-new-ta', 'w-leave-dates-ta', 'w-leave-confirm-ta'], ['w-req-ta', 'w-req-detail-ta'], ['w-me-ta'], []]
  ta.guides.forEach((g, i) => {
    html += sec(g.title, en.guides[i].title)
    const shots = SH[i].filter((x) => img(x) || (img(x.replace('-ta', '-en')) && (x = x.replace('-ta', '-en')))).map((x) => img(x) ? x : x.replace('-ta', '-en'))
    const first = shots[0]
    html += `<div class="wk">${first ? `<figure class="phone"><img src="${img(first)}"></figure>` : '<div></div>'}<div><div class="ta"><ol class="steps">${g.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div><div class="en"><ol class="steps">${en.guides[i].steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div></div></div>`
    if (shots.length > 1) html += `<div class="grid2" style="grid-template-columns:repeat(${shots.length - 1},1fr)">${shots.slice(1).map((x) => `<figure class="phone"><img src="${img(x)}" style="max-height:120mm"></figure>`).join('')}</div>`
    if (i === 0) html += `<div class="call imp"><b class="t ta">முக்கியம் / Important</b><span class="ta">உங்கள் PIN-ஐ யாரிடமும் சொல்ல வேண்டாம்.</span> Never tell your PIN to anyone — not even HR.</div>`
  })
  html += sec('உதவி', 'Help in the app')
  html += `<div class="wk"><figure class="phone"><img src="${img('w-help-faq-ta') || img('w-help-faq-en') || ''}"></figure><div class="ta"><p class="lead">? பொத்தான் அல்லது நான் → உதவி. கேள்விகள் மற்றும் எப்படி செய்வது.</p><p class="en" style="color:#475569">Tap <b>?</b> on the home screen, or <b>Me → Help</b>, for questions and short how-to guides in your language.</p></div></div>`
  html += sec('கேள்விகள்', 'Questions')
  html += ta.faq.map(([q, a], i) => `<div class="faq"><div class="q ta">${esc(q)}</div><div class="ta">${esc(a)}</div><div style="color:#475569;font-size:9.5pt"><b>${esc(en.faq[i][0])}</b> ${esc(en.faq[i][1])}</div></div>`).join('')
  return { html: page(html), toc }
}

// ---------- render + assemble
const browser = await chromium.launch()
async function pdf(html, file) { const p = await browser.newPage(); fs.writeFileSync(TMP + 'x.html', html); await p.goto(pathToFileURL(TMP + 'x.html').href, { waitUntil: 'networkidle' }); await p.evaluate(() => document.fonts.ready); await p.pdf({ path: file, format: 'A4', printBackground: true, preferCSSPageSize: true }); await p.close(); return file }
function pageOf(file, toc) {
  const txt = execFileSync('pdftotext', ['-layout', file, '-'], { maxBuffer: 1 << 26 }).toString().split('\f'); const m = {}
  for (const e of toc) { const i = txt.findIndex((t) => t.includes(`[[${e.id}]]`)); if (i >= 0) m[e.id] = i + 1 }
  return m
}
async function build({ file, title, roleLine, sub, body, header }) {
  const { html, toc } = body
  const b = await pdf(html, TMP + 'body.pdf'); const pages = pageOf(b, toc)
  const c = await pdf(coverHtml(title, roleLine, sub), TMP + 'cover.pdf')
  let t = await pdf(tocHtml(toc, pages, 2), TMP + 'toc.pdf')
  const tN = (await PDFDocument.load(fs.readFileSync(t))).getPageCount()
  if (tN !== 1) t = await pdf(tocHtml(toc, pages, 1 + tN), TMP + 'toc.pdf')
  const out = await PDFDocument.create()
  for (const f of [c, t, b]) { const d = await PDFDocument.load(fs.readFileSync(f)); (await out.copyPages(d, d.getPageIndices())).forEach((pg) => out.addPage(pg)) }
  const font = await out.embedFont(StandardFonts.Helvetica), bold = await out.embedFont(StandardFonts.HelveticaBold)
  const N = out.getPageCount()
  out.getPages().forEach((pg, i) => {
    if (i === 0) return
    const { width: w, height: h } = pg.getSize(), gray = rgb(0.39, 0.45, 0.55), teal = rgb(0.08, 0.72, 0.65)
    pg.drawText(header, { x: 45, y: h - 36, size: 8.5, font: bold, color: rgb(0.04, 0.23, 0.21) })
    const v = `Version ${VERSION}`; pg.drawText(v, { x: w - 45 - font.widthOfTextAtSize(v, 8.5), y: h - 36, size: 8.5, font, color: gray })
    pg.drawLine({ start: { x: 45, y: h - 42 }, end: { x: w - 45, y: h - 42 }, thickness: 0.8, color: teal })
    pg.drawLine({ start: { x: 45, y: 38 }, end: { x: w - 45, y: 38 }, thickness: 0.5, color: rgb(0.8, 0.84, 0.88) })
    pg.drawText(DEV, { x: 45, y: 26, size: 8, font, color: gray })
    const pn = `Page ${i + 1} of ${N}`; pg.drawText(pn, { x: w - 45 - bold.widthOfTextAtSize(pn, 8.5), y: 26, size: 8.5, font: bold, color: gray })
  })
  out.setTitle(title + (roleLine ? ': ' + roleLine.replace(/<[^>]+>/g, '') : '')); out.setAuthor('Mouli Sankar'); out.setSubject('FW Manager user manual'); out.setCreator('FW Manager manual builder')
  fs.writeFileSync(OUT + file, await out.save()); const miss = toc.filter((e) => !pages[e.id]).map((e) => e.label)
  console.log(`${OUT + file}: ${N} pages${miss.length ? ' — TOC entries without a page: ' + miss.join('; ') : ''}`)
  return N
}
const only = process.argv[2]
const report = {}
for (const role of ['ceo', 'gm', 'hra', 'hrm', 'om']) {
  if (only && only !== role) continue
  const T = C.ROLE_TITLE[role]
  report[C.MANUAL_FILE[role]] = await build({ file: C.MANUAL_FILE[role], title: 'FW Manager User Manual', roleLine: esc(T), body: staffBody(role), header: `FW Manager User Manual: ${T}` })
}
if (!only || only === 'worker')
  report[C.WORKER_MANUAL_FILE] = await build({ file: C.WORKER_MANUAL_FILE, title: 'FW Manager User Manual', roleLine: '<span class="ta">தொழிலாளர் வழிகாட்டி</span> · Worker (FW Worker app)', sub: '<p class="ta" style="margin-top:6mm;font-size:12pt">தமிழ் மற்றும் English · படங்களுடன் எளிய வழிகாட்டி</p>', body: workerBody(), header: 'FW Manager User Manual: Worker (FW Worker app)' })
await browser.close()
if (missing.size) console.log('missing screenshots:', [...missing].join(', '))
const prevPages = fs.existsSync(OUT + 'manifest.json') ? JSON.parse(fs.readFileSync(OUT + 'manifest.json', 'utf8')).pages || {} : {}
fs.writeFileSync(OUT + 'manifest.json', JSON.stringify({ version: VERSION, date: DATE, pages: { ...prevPages, ...report } }, null, 1))
