/* Voluntary passport safekeeping — Passports Act 1966 s.12(1)(f): an employer may keep a worker's passport ONLY with
 * the worker's free consent, must return it on request, and may not charge for it. This module creates the bilingual
 * consent form (English + the worker's primary language, else Bahasa Malaysia) and the release / return slips (EN + BM). */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { currentDocs, outletName } from './calc'
import { getConfig } from './config'
import { companyName, outletCompany } from './companies'
import { pdfLogoFor } from './logos'
import type { MemoRec, Outlet, PassportMove, PassportSafe, Worker } from './types'
import { fmtDate, todayISO } from './util'
import { CONSENT_EN, consentLanguage, type ConsentKey, type ConsentText } from './consentText'
import { langDef, langName } from './languages'
import { ensureFonts, needsCanvas, renderText, scriptLang } from './scriptRender'

export const CONSENT_LABEL: Record<string, string> = {
  not_issued: 'Not issued', pending: 'Pending signature', uploaded: 'Signed copy uploaded — HR to verify', signed: 'Signed', withdrawn: 'Withdrawn',
}
export const CONSENT_TONE: Record<string, string> = { not_issued: 'gray', pending: 'red', uploaded: 'amber', signed: 'green', withdrawn: 'gray' }
export const CUSTODY_LABEL: Record<string, string> = { with_worker: 'With worker', in_safe: 'In company safe', released: 'Released to worker' }
export const consentOf = (w: Worker) => w.passportSafe?.consent || 'not_issued'
export const custodyOf = (w: Worker) => w.passportSafe?.custody || 'with_worker'
export const lastRelease = (w: Worker) => [...(w.passportSafe?.moves || [])].reverse().find((m) => m.kind === 'release')
/** released and past the expected return date (+ grace) */
export function overdueDays(w: Worker): number {
  if (custodyOf(w) !== 'released') return 0
  const r = lastRelease(w)
  if (!r?.expectedReturn) return 0
  const due = new Date(r.expectedReturn); due.setDate(due.getDate() + (getConfig().passport.overdueGraceDays || 0))
  const d = Math.floor((Date.now() - due.getTime()) / 86400000)
  return d > 0 ? d : 0
}
export function passportOf(w: Worker) {
  const p = currentDocs(w).find((d) => d.type === 'Passport')
  return { no: p?.number || '', expiry: p?.expiryDate || '' }
}

/* ---------- PDF helpers ---------- */
type Fonts = { r: PDFFont; b: PDFFont; i: PDFFont }
const A4: [number, number] = [595, 842]
const M = 48
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/)) {
      const t = line ? line + ' ' + word : word
      if (font.widthOfTextAtSize(t, size) > width && line) { out.push(line); line = word } else line = t
    }
    out.push(line)
  }
  return out
}
const clean = (s: string) => s.replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '?') // standard PDF fonts: Latin-1 only
class Writer {
  y = A4[1] - M
  page: PDFPage
  f: Fonts
  constructor(page: PDFPage, f: Fonts) { this.page = page; this.f = f }
  text(t: string, o: { size?: number; font?: PDFFont; color?: [number, number, number]; indent?: number; gap?: number } = {}) {
    const size = o.size || 9.5, font = o.font || this.f.r, x = M + (o.indent || 0)
    for (const l of wrap(clean(t), font, size, A4[0] - x - M)) {
      this.page.drawText(l, { x, y: this.y, size, font, color: rgb(...(o.color || [0.1, 0.1, 0.12])) })
      this.y -= size * 1.32
    }
    this.y -= o.gap ?? 2
  }
  bi(en: string, ms: string, o: { size?: number; indent?: number } = {}) {
    this.text(en, { ...o, gap: 0 })
    this.text(ms, { ...o, font: this.f.i, color: [0.3, 0.3, 0.35], gap: 5 })
  }
  rule(gap = 8) { this.page.drawLine({ start: { x: M, y: this.y + 4 }, end: { x: A4[0] - M, y: this.y + 4 }, thickness: 0.6, color: rgb(0.75, 0.75, 0.78) }); this.y -= gap }
  table(rows: [string, string][]) {
    for (const [k, v] of rows) {
      this.page.drawText(clean(k), { x: M, y: this.y, size: 9, font: this.f.i, color: rgb(0.35, 0.35, 0.4) })
      this.page.drawText(clean(v || '-'), { x: M + 170, y: this.y, size: 10, font: this.f.b })
      this.y -= 15
    }
    this.y -= 4
  }
  signBox(labels: [string, string][], height = 70) {
    const n = labels.length, gap = 12, w = (A4[0] - 2 * M - gap * (n - 1)) / n
    labels.forEach(([en, ms], i) => {
      const x = M + i * (w + gap)
      this.page.drawRectangle({ x, y: this.y - height, width: w, height, borderColor: rgb(0.6, 0.6, 0.65), borderWidth: 0.7 })
      this.page.drawText(clean(en), { x: x + 4, y: this.y - height - 11, size: 8, font: this.f.b })
      this.page.drawText(clean(ms), { x: x + 4, y: this.y - height - 21, size: 7.5, font: this.f.i, color: rgb(0.35, 0.35, 0.4) })
      this.page.drawText('Name / Nama: ____________________', { x: x + 4, y: this.y - height - 33, size: 7.5, font: this.f.r })
      this.page.drawText('Date / Tarikh: ____ / ____ / ______', { x: x + 4, y: this.y - height - 44, size: 7.5, font: this.f.r })
    })
    this.y -= height + 56
  }
}
async function newDoc() {
  const pdf = await PDFDocument.create()
  const f: Fonts = { r: await pdf.embedFont(StandardFonts.Helvetica), b: await pdf.embedFont(StandardFonts.HelveticaBold), i: await pdf.embedFont(StandardFonts.HelveticaOblique) }
  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | null = null
  const l = getConfig().passport.logo
  if (l?.startsWith('data:image/')) {
    try {
      const bytes = Uint8Array.from(atob(l.split(',')[1]), (c) => c.charCodeAt(0))
      logo = l.startsWith('data:image/png') ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
    } catch { logo = null }
  }
  return { pdf, f, logo, logoFor: workerLogo(pdf, logo) }
}
type Img = Awaited<ReturnType<PDFDocument['embedPng']>>
/** the worker's outlet logo → company logo → the default (Settings → passport form logo) */
function workerLogo(pdf: PDFDocument, fallback: Img | null) {
  const done = new Map<string, Img | null>()
  return async (wk: Worker, outlets: Outlet[]): Promise<Img | null> => {
    const o = outlets.find((x) => x.id === wk.outletId)
    const key = o?.id || ''
    if (!done.has(key)) {
      let img: Img | null = null
      try { const l = await pdfLogoFor(o); if (l) img = l.png ? await pdf.embedPng(l.bytes) : await pdf.embedJpg(l.bytes) } catch { img = null }
      done.set(key, img)
    }
    return done.get(key) || fallback
  }
}
/** with more than one company, a worker's documents carry the name of his own company */
function companyOf(wk: Worker, outlets: Outlet[], company: string) {
  const items = getConfig().companies.items
  if (items.length < 2) return company
  return companyName(items, outletCompany(outlets.find((o) => o.id === wk.outletId))) || company
}
function header(w: Writer, company: string, title: string, titleMs: string, logo: Awaited<ReturnType<PDFDocument['embedPng']>> | null) {
  if (logo) {
    const h = 38, wd = (logo.width / logo.height) * h
    w.page.drawImage(logo, { x: A4[0] - M - wd, y: w.y - h + 10, width: wd, height: h })
  }
  w.text(company, { size: 13, font: w.f.b, gap: 4 })
  w.text(title, { size: 12, font: w.f.b, gap: 0 })
  w.text(titleMs, { size: 10.5, font: w.f.i, color: [0.3, 0.3, 0.35], gap: 8 })
  w.rule(14)
}
const blob = async (pdf: PDFDocument) => new Blob([(await pdf.save()) as BlobPart], { type: 'application/pdf' })

/* ---------- Consent form: English + the worker's primary language (one form per worker) ---------- */
type Lines = { size?: number; bold?: boolean; italic?: boolean; color?: [number, number, number]; indent?: number; gap?: number; lang?: string }
type Cached = Map<string, Promise<{ img: Img; w: number; h: number }>>
/** a Writer that can print any script (canvas-rendered, see scriptRender) and continues on a new page when full */
class RichWriter extends Writer {
  pdf: PDFDocument
  cache: Cached
  onNewPage?: (w: RichWriter) => void
  constructor(pdf: PDFDocument, f: Fonts, cache: Cached) { super(pdf.addPage(A4), f); this.pdf = pdf; this.cache = cache }
  ensure(h: number) {
    if (this.y - h >= M - 8) return
    this.page = this.pdf.addPage(A4); this.y = A4[1] - M
    this.onNewPage?.(this)
  }
  /** image for text in a script — cached per document, so a bulk PDF re-uses the same image on every page */
  img(t: string, o: { lang?: string; size: number; width: number; bold?: boolean; italic?: boolean; color?: [number, number, number] }) {
    const key = JSON.stringify([t, o])
    if (!this.cache.has(key)) this.cache.set(key, (async () => {
      const r = renderText(t, o)
      return { img: await this.pdf.embedPng(r.png), w: r.w, h: r.h }
    })())
    return this.cache.get(key)!
  }
  async lines(t: string, o: Lines = {}) {
    if (!t) return
    const size = o.size || 9.5, x = M + (o.indent || 0), width = A4[0] - x - M
    const color = o.color || [0.1, 0.1, 0.12]
    if (!needsCanvas(t) && !(o.lang && langDef(o.lang)?.font)) {
      const font = o.bold ? this.f.b : o.italic ? this.f.i : this.f.r
      for (const l of wrap(t, font, size, width)) {
        this.ensure(size * 1.3)
        this.page.drawText(l, { x, y: this.y, size, font, color: rgb(...color) })
        this.y -= size * 1.3
      }
    } else {
      const lang = o.lang && langDef(o.lang)?.font ? o.lang : scriptLang(t) || o.lang
      const r = await this.img(t, { lang, size, width, bold: o.bold, color })
      const adv = r.h - size * 0.3
      this.ensure(adv) // a paragraph is never split; if it does not fit it moves to the next page whole
      const rtl = !!langDef(lang)?.rtl
      this.page.drawImage(r.img, { x: rtl ? x + width - r.w : x, y: this.y + size - r.h + size * 0.05, width: r.w, height: r.h })
      this.y -= adv
    }
    this.y -= o.gap ?? 2
  }
  /** one short value at a position (worker names may be typed in their own script). Returns the height used. */
  async cell(t: string, x: number, y: number, size: number, o: { bold?: boolean; maxW?: number; lang?: string; color?: [number, number, number]; italic?: boolean } = {}) {
    const color = o.color || [0.1, 0.1, 0.12]
    if (!needsCanvas(t) && !(o.lang && langDef(o.lang)?.font)) {
      const font = o.bold ? this.f.b : o.italic ? this.f.i : this.f.r
      let s = t
      while (o.maxW && s.length > 3 && font.widthOfTextAtSize(s, size) > o.maxW) s = s.slice(0, -2)
      this.page.drawText(s === t ? t : s.trimEnd() + '...', { x, y, size, font, color: rgb(...color) })
      return size * 1.25
    }
    const r = await this.img(t, { lang: o.lang && langDef(o.lang)?.font ? o.lang : scriptLang(t), size, width: o.maxW || 300, bold: o.bold, color })
    this.page.drawImage(r.img, { x, y: y + size - r.h + size * 0.05, width: r.w, height: r.h })
    return r.h - size * 0.25
  }
}

/** the turnaround in words, e.g. "24 hours" / "24 घण्टा" */
const turnText = (hrs: number, t: ConsentText) => (hrs <= 24 ? t.hours.replace('{n}', String(hrs)) : t.days.replace('{n}', String(Math.round(hrs / 24))))

/** Consent forms. Each worker's form is in English + his primary language — or English + Bahasa Malaysia when his
 *  language is English, Malay, not recorded, or has no translation yet (a small note on the form says so). */
export async function consentPdf(workers: Worker[], outlets: Outlet[], company: string): Promise<Blob> {
  const doc = await newDoc()
  const cache: Cached = new Map()
  for (const wk of workers) {
    // each form should fit on ONE page: long scripts (Tamil, Malayalam…) are tried on a scratch document at a slightly
    // smaller type size first; the first scale that fits is then drawn into the real document
    let k = 1
    for (const t of [1, 0.94, 0.88, 0.82]) {
      k = t
      const scratch = await newDoc()
      if ((await consentOne(scratch, new Map(), wk, outlets, company, t)) <= 1) break
    }
    await consentOne(doc, cache, wk, outlets, company, k)
  }
  return blob(doc.pdf)
}

/** draws one worker's consent form; returns the number of pages it used */
async function consentOne(d: Awaited<ReturnType<typeof newDoc>>, cache: Cached, wk: Worker, outlets: Outlet[], company: string, k: number): Promise<number> {
  const { pdf, f, logoFor } = d
  const before = pdf.getPageCount()
  const cfg = getConfig().passport
  const overrides = getConfig().consent_translations || { items: {} }
  const hrs = cfg.turnaroundHours || 24
  const E = CONSENT_EN
  const grey: [number, number, number] = [0.35, 0.35, 0.4]
  {
    const L = consentLanguage(wk.primaryLanguage, overrides)
    const T = L.text, lang = L.code
    const fontsOk = await ensureFonts(lang)
    await ensureFonts(scriptLang(wk.fullName))
    const sub: Lines = { size: 8.6 * k, italic: true, color: [0.27, 0.27, 0.33], lang }
    const w = new RichWriter(pdf, f, cache)
    w.onNewPage = (x) => { x.page.drawText(`${wk.workerNo} - consent form (continued)`, { x: M, y: x.y, size: 8, font: f.i, color: rgb(0.4, 0.4, 0.45) }); x.y -= 16 }
    // header
    const logo = await logoFor(wk, outlets)
    if (logo) { const h = 36, wd = (logo.width / logo.height) * h; w.page.drawImage(logo, { x: A4[0] - M - wd, y: w.y - h + 10, width: wd, height: h }) }
    await w.lines(companyOf(wk, outlets, company), { size: 12.5, bold: true, gap: 3 })
    await w.lines(E.title, { size: 11.5, bold: true, gap: 0 })
    await w.lines(T.title, { ...sub, size: 10 * k, gap: 4 * k })
    w.rule(10 * k)
    if (!fontsOk) await w.lines('Note: the font for the worker\u2019s language could not be loaded (offline?). Please reprint this form when online.', { size: 7.5, italic: true, color: [0.6, 0.3, 0.0], gap: 5 })
    else if (L.fallback) await w.lines(`Note: ${L.fallback}`, { size: 7.5, italic: true, color: [0.55, 0.35, 0.05], gap: 5 })
    // worker details — name across the page, the rest in two columns; English label with the translation beneath
    const p = passportOf(wk)
    const field = async (key: ConsentKey, v: string, x: number, valueX: number, valueW: number) => {
      w.page.drawText(E[key], { x, y: w.y, size: 8.5, font: f.i, color: rgb(...grey) })
      const th = await w.cell(T[key], x, w.y - 9.5, 7, { maxW: valueX - x - 6, lang, color: grey })
      const vh = await w.cell(v || '-', valueX, w.y, 9.5, { bold: true, maxW: valueW })
      return Math.max(9.5 + th, vh) + 5 * k
    }
    const colW = (A4[0] - 2 * M) / 2
    w.y -= Math.max(await field('name', wk.fullName, M, M + 105, A4[0] - 2 * M - 105), 0)
    const pairs: [ConsentKey, string][] = [
      ['passportNo', p.no], ['nationality', wk.nationality], ['expiry', p.expiry ? fmtDate(p.expiry) : ''], ['workerNo', wk.workerNo],
      ['outlet', outletName(outlets, wk.outletId)], ['job', wk.jobCategory || ''], ['date', fmtDate(todayISO())],
    ]
    for (let i = 0; i < pairs.length; i += 2) {
      const a = await field(pairs[i][0], pairs[i][1], M, M + 105, colW - 110)
      const b = pairs[i + 1] ? await field(pairs[i + 1][0], pairs[i + 1][1], M + colW, M + colW + 95, colW - 95) : 0
      w.y -= Math.max(a, b)
    }
    w.y -= 4 * k
    // the statement, paragraph by paragraph: English, then the translation
    const en9 = 9.2 * k
    await w.lines(E.intro, { size: en9, gap: 1 }); await w.lines(T.intro, { ...sub, gap: 5 * k })
    const ps: ConsentKey[] = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']
    for (const [i, key] of ps.entries()) {
      let en = `${i + 1}. ${E[key].replace('{time}', turnText(hrs, E))}`
      let tr = `${i + 1}. ${T[key].replace('{time}', turnText(hrs, T))}`
      if (key === 'p7') { en += `   [  ] ${E.yes}   [  ] ${E.no}`; tr += `   [  ] ${T.yes}   [  ] ${T.no}` }
      w.ensure(30)
      await w.lines(en, { size: en9, indent: 8, gap: 0.5 })
      await w.lines(tr, { ...sub, indent: 8, gap: 4 * k })
    }
    await w.lines(E.explained, { size: 8.3 * k, italic: true, gap: 0 })
    await w.lines(T.explained, { ...sub, size: 8 * k, gap: 7 * k })
    // signature boxes (kept together on one page)
    const labels: [string, string][] = [[E.signWorker, T.signWorker], [`${E.signWitness} (${cfg.witnessTitle || 'Outlet Manager'})`, T.signWitness], [E.signHr, T.signHr]]
    const bh = 52 * Math.min(1, k + 0.04), gap = 12, bw = (A4[0] - 2 * M - gap * 2) / 3
    const lh = langDef(lang)?.lineHeight || 1.4
    // the box block: box + English label (≤2 lines) + translated label (≤2 lines) + name/date lines + their translations
    w.ensure(bh + 10 + 18 + 7 * lh * 2 + 6 + 8 + 6.6 * lh + 4 + 8 + 6.6 * lh + 6)
    const top = w.y
    let below = 0
    for (const [i, [en, tr]] of labels.entries()) {
      const x = M + i * (bw + gap)
      w.page.drawRectangle({ x, y: top - bh, width: bw, height: bh, borderColor: rgb(0.6, 0.6, 0.65), borderWidth: 0.7 })
      let y = top - bh - 10
      for (const l of wrap(en, f.b, 7.6, bw - 6)) { w.page.drawText(l, { x: x + 3, y, size: 7.6, font: f.b }); y -= 9 }
      y -= await w.cell(tr, x + 3, y, 7, { maxW: bw - 6, lang, color: grey })
      y -= 6
      w.page.drawText(`${E.signName}: _______________________`, { x: x + 3, y, size: 7.4, font: f.r }); y -= 8
      y -= await w.cell(`(${T.signName})`, x + 3, y, 6.6, { maxW: bw - 6, lang, color: grey }) + 4
      w.page.drawText(`${E.signDate}: ____ / ____ / ______`, { x: x + 3, y, size: 7.4, font: f.r }); y -= 8
      y -= await w.cell(`(${T.signDate})`, x + 3, y, 6.6, { maxW: bw - 6, lang, color: grey })
      below = Math.max(below, top - y)
    }
    w.y = top - below - 6
    await w.lines(E.reference, { size: 7.3, color: [0.4, 0.4, 0.45], gap: 0 })
    await w.lines(T.reference, { ...sub, size: 7, gap: 3 })
    const name = lang === 'ms' ? 'Bahasa Malaysia' : langName(lang)
    const note = L.override?.checked
      ? `Translation (${name}) reviewed by ${L.override.checkedBy || 'a native speaker'}. If anything is unclear, the English text applies.`
      : `Translation (${name}) should be checked by a native speaker before use. If anything is unclear, the English text applies and HR must explain it.`
    await w.lines(note, { size: 6.6, italic: true, color: [0.5, 0.5, 0.55], gap: 0 })
  }
  return pdf.getPageCount() - before
}

/* ---------- Release / return slip ---------- */
export async function slipPdf(wk: Worker, m: PassportMove, outlets: Outlet[], company: string): Promise<Blob> {
  const { pdf, f, logoFor } = await newDoc()
  const page = pdf.addPage(A4)
  const w = new Writer(page, f)
  const rel = m.kind === 'release'
  const title = rel ? 'PASSPORT RELEASE SLIP' : m.kind === 'return' ? 'PASSPORT RETURN SLIP' : 'PASSPORT DEPOSIT SLIP'
  const titleMs = rel ? 'SLIP PELEPASAN PASPORT' : m.kind === 'return' ? 'SLIP PEMULANGAN PASPORT' : 'SLIP SIMPANAN PASPORT'
  header(w, companyOf(wk, outlets, company), title, titleMs, await logoFor(wk, outlets))
  const p = passportOf(wk)
  w.table([
    ['Worker / Pekerja', `${wk.fullName} (${wk.workerNo})`], ['Passport no. / No. pasport', p.no], ['Outlet / Cawangan', outletName(outlets, wk.outletId)],
    [rel ? 'Released on / Dilepaskan pada' : 'Received on / Diterima pada', fmtDate(m.date)], ['Reason / Sebab', m.reason || ''],
    ...(rel ? [['Expected back / Dijangka dipulangkan', m.expectedReturn ? fmtDate(m.expectedReturn) + ' (only if the worker wishes / hanya jika pekerja mahu)' : 'Not required / Tidak perlu'] as [string, string]] : []),
    ['Handled by / Dikendalikan oleh', m.by || ''],
  ])
  w.bi(rel ? 'The passport was handed to the worker in good condition. No fee or deposit was charged.' : 'The worker handed the passport to the company for voluntary safekeeping (consent on file). No fee or deposit was charged.',
    rel ? 'Pasport telah diserahkan kepada pekerja dalam keadaan baik. Tiada bayaran atau deposit dikenakan.' : 'Pekerja menyerahkan pasport kepada syarikat untuk simpanan sukarela (persetujuan dalam fail). Tiada bayaran atau deposit dikenakan.')
  w.y -= 8
  w.signBox([['Worker signature / thumbprint', 'Tandatangan / cap ibu jari pekerja'], ['HR', 'HR'], ['Witness', 'Saksi']])
  return blob(pdf)
}
export const nextCustody = (ps: PassportSafe | undefined) => (ps?.custody === 'in_safe' ? 'release' : 'return')

/* ---------- Checkout / return / exit memo (auto-saved to the vault when a memo is saved) ---------- */
export async function memoPdf(wk: Worker, m: MemoRec, outlets: Outlet[], company: string): Promise<Blob> {
  const { pdf, f, logoFor } = await newDoc()
  let w = new Writer(pdf.addPage(A4), f)
  header(w, companyOf(wk, outlets, company), m.kind.toUpperCase() + ' MEMO', m.kind === 'Exit Clearance' ? 'MEMO PELEPASAN KERJA' : m.kind === 'Return from Leave' ? 'MEMO KEMBALI DARI CUTI' : 'MEMO KELUAR CUTI', await logoFor(wk, outlets))
  w.table([
    ['Worker / Pekerja', `${wk.fullName} (${wk.workerNo})`], ['Passport no. / No. pasport', passportOf(wk).no], ['Outlet / Cawangan', outletName(outlets, wk.outletId)],
    ['Memo date / Tarikh', fmtDate(m.date)], [m.kind === 'Return from Leave' ? 'Reported back / Kembali' : 'Last working day / Hari terakhir', m.lastWorkingDay ? fmtDate(m.lastWorkingDay) : ''],
    ...(m.expectedReturn ? [['Expected return / Dijangka kembali', fmtDate(m.expectedReturn)] as [string, string]] : []),
    ['Outstanding loan / advance', `RM ${Number(m.outstandingBalance || 0).toFixed(2)}`],
    ...(m.finalSalary !== undefined ? [['Final salary / Gaji akhir', `RM ${m.finalSalary.toFixed(2)}`] as [string, string]] : []),
    ...(m.penalty !== undefined ? [['Penalty / Penalti', `RM ${m.penalty.toFixed(2)}`] as [string, string]] : []),
    ...(m.ticketDetails ? [['Flight ticket / Tiket', m.ticketDetails] as [string, string]] : []),
  ])
  w.text('Checklist / Senarai semak', { size: 11, font: f.b, gap: 4 })
  for (const c of m.checklist) {
    if (w.y < 150) w = new Writer(pdf.addPage(A4), f)
    w.text(`[${c.done ? 'X' : '  '}]  ${c.label}${c.remarks ? ' — ' + c.remarks : ''}`, { gap: 3 })
  }
  if (m.notes) { w.y -= 4; w.text('Notes / Catatan: ' + m.notes) }
  if (w.y < 150) w = new Writer(pdf.addPage(A4), f)
  w.y -= 10
  w.signBox([[`Worker: ${m.workerSign || wk.fullName}`, 'Pekerja'], [`Manager: ${m.managerSign || ''}`, 'Pengurus'], [`HR: ${m.hrSign || ''}`, 'HR']], 55)
  return blob(pdf)
}
