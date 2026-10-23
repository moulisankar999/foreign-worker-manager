/* Voluntary passport safekeeping — Passports Act 1966 s.12(1)(f): an employer may keep a worker's passport ONLY with
 * the worker's free consent, must return it on request, and may not charge for it. This module creates the bilingual
 * (English + Bahasa Malaysia) consent form and the release / return slips as PDFs. */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { currentDocs, outletName } from './calc'
import { getConfig } from './config'
import type { MemoRec, Outlet, PassportMove, PassportSafe, Worker } from './types'
import { fmtDate, todayISO } from './util'

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
  return { pdf, f, logo }
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

/* ---------- Consent form (one page per worker) ---------- */
export async function consentPdf(workers: Worker[], outlets: Outlet[], company: string): Promise<Blob> {
  const { pdf, f, logo } = await newDoc()
  const cfg = getConfig().passport
  const hrs = cfg.turnaroundHours || 24
  const turn = hrs <= 24 ? `${hrs} hours` : `${Math.round(hrs / 24)} days`
  const turnMs = hrs <= 24 ? `${hrs} jam` : `${Math.round(hrs / 24)} hari`
  for (const wk of workers) {
    const page = pdf.addPage(A4)
    const w = new Writer(page, f)
    header(w, company, 'VOLUNTARY PASSPORT SAFEKEEPING CONSENT', 'PERSETUJUAN SUKARELA PENYIMPANAN PASPORT', logo)
    const p = passportOf(wk)
    w.table([
      ['Worker name / Nama pekerja', wk.fullName], ['Passport no. / No. pasport', p.no], ['Nationality / Warganegara', wk.nationality],
      ['Passport expiry / Tamat tempoh', p.expiry ? fmtDate(p.expiry) : ''], ['Employee ID / No. pekerja', wk.workerNo],
      ['Outlet / Cawangan', outletName(outlets, wk.outletId)], ['Job / Jawatan', wk.jobCategory || ''], ['Date / Tarikh', fmtDate(todayISO())],
    ])
    w.bi('I, the worker named above, of my own free will ask the company to keep my passport in its safe for safekeeping. I understand that:',
      'Saya, pekerja yang dinamakan di atas, dengan kerelaan sendiri meminta syarikat menyimpan pasport saya di dalam peti keselamatannya. Saya faham bahawa:')
    const pts: [string, string][] = [
      ['1. This is voluntary. I am not forced, and my job does not depend on it.', '1. Ini adalah sukarela. Saya tidak dipaksa dan pekerjaan saya tidak bergantung kepadanya.'],
      ['2. The passport remains my property (and the property of my government). The company only keeps it safely for me.', '2. Pasport kekal hak milik saya (dan kerajaan saya). Syarikat hanya menyimpannya dengan selamat untuk saya.'],
      [`3. I can ask for my passport at any time, for any reason, and it will be returned to me within ${turn}.`, `3. Saya boleh meminta pasport saya pada bila-bila masa atas apa-apa sebab, dan ia akan dipulangkan kepada saya dalam tempoh ${turnMs}.`],
      ['4. No deposit, fee or deduction is charged for keeping or returning the passport.', '4. Tiada deposit, bayaran atau potongan dikenakan untuk menyimpan atau memulangkan pasport.'],
      ['5. I may withdraw this consent at any time; the passport will then be returned to me.', '5. Saya boleh menarik balik persetujuan ini pada bila-bila masa; pasport akan dipulangkan kepada saya.'],
      ['6. Every release and return is recorded and signed on a slip; I may ask for a copy.', '6. Setiap pelepasan dan pemulangan direkodkan dan ditandatangani pada slip; saya boleh meminta salinannya.'],
      ['7. I agree to receive work notices (leave, tickets, passport) by WhatsApp/SMS on my phone. I can stop this at any time.  [  ] Yes / Ya   [  ] No / Tidak',
        '7. Saya bersetuju menerima notis kerja (cuti, tiket, pasport) melalui WhatsApp/SMS. Saya boleh menghentikannya pada bila-bila masa.'],
    ]
    pts.forEach(([en, ms]) => w.bi(en, ms, { indent: 8 }))
    w.text('This form was explained to me in a language I understand. / Borang ini telah diterangkan kepada saya dalam bahasa yang saya fahami.', { size: 8.5, font: f.i, gap: 10 })
    w.signBox([
      ['Worker signature or right thumbprint', 'Tandatangan atau cap ibu jari kanan pekerja'],
      [`Witness (${cfg.witnessTitle || 'Outlet Manager'})`, 'Saksi'],
      ['HR (received & verified)', 'HR (diterima & disahkan)'],
    ])
    w.text('Reference: Passports Act 1966, s.12(1)(f). The company keeps the passport only with this consent.', { size: 7.5, color: [0.4, 0.4, 0.45] })
  }
  return blob(pdf)
}

/* ---------- Release / return slip ---------- */
export async function slipPdf(wk: Worker, m: PassportMove, outlets: Outlet[], company: string): Promise<Blob> {
  const { pdf, f, logo } = await newDoc()
  const page = pdf.addPage(A4)
  const w = new Writer(page, f)
  const rel = m.kind === 'release'
  const title = rel ? 'PASSPORT RELEASE SLIP' : m.kind === 'return' ? 'PASSPORT RETURN SLIP' : 'PASSPORT DEPOSIT SLIP'
  const titleMs = rel ? 'SLIP PELEPASAN PASPORT' : m.kind === 'return' ? 'SLIP PEMULANGAN PASPORT' : 'SLIP SIMPANAN PASPORT'
  header(w, company, title, titleMs, logo)
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
  const { pdf, f, logo } = await newDoc()
  let w = new Writer(pdf.addPage(A4), f)
  header(w, company, m.kind.toUpperCase() + ' MEMO', m.kind === 'Exit Clearance' ? 'MEMO PELEPASAN KERJA' : m.kind === 'Return from Leave' ? 'MEMO KEMBALI DARI CUTI' : 'MEMO KELUAR CUTI', logo)
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
