/* Draw text in any script (Devanagari, Bengali, Myanmar, Nastaliq, Thai, Khmer, Chinese…) for PDFs.
 * pdf-lib cannot shape complex scripts, so the browser shapes them on a canvas with a lazily loaded Noto font and the
 * result is embedded in the PDF as a high-resolution PNG (3 px per point ≈ 216 dpi). */
import { langDef } from './languages'

const SCALE = 3
const loaded = new Map<string, Promise<boolean>>()
const fam = (file: string) => 'FWM-' + file.replace(/\W/g, '')
const LATIN = 'NotoSans-Latin.ttf'

function loadFile(file: string): Promise<boolean> {
  if (!loaded.has(file)) {
    loaded.set(file, (async () => {
      try {
        const url = new URL(import.meta.env.BASE_URL + 'fonts/' + file, document.baseURI).toString()
        const face = new FontFace(fam(file), `url(${url})`)
        await face.load()
        ;(document.fonts as unknown as { add(f: FontFace): void }).add(face)
        return true
      } catch { loaded.delete(file); return false }
    })())
  }
  return loaded.get(file)!
}

/** which of our fonts covers this text (by Unicode block) — for worker names typed in their own script */
export function scriptLang(text: string): string | undefined {
  const tests: [RegExp, string][] = [
    [/[\u0900-\u097F]/, 'hi'], [/[\u0980-\u09FF]/, 'bn'], [/[\u1000-\u109F]/, 'my'], [/[\u0B80-\u0BFF]/, 'ta'], [/[\u0C00-\u0C7F]/, 'te'], [/[\u0D00-\u0D7F]/, 'ml'], [/[\u0C80-\u0CFF]/, 'kn'], [/[\u0A00-\u0A7F]/, 'pa'], [/[\u0A80-\u0AFF]/, 'gu'], [/[\u0B00-\u0B7F]/, 'or'],
    [/[\u0D80-\u0DFF]/, 'si'], [/[\u0E00-\u0E7F]/, 'th'], [/[\u0E80-\u0EFF]/, 'lo'], [/[\u1780-\u17FF]/, 'km'], [/[\u0600-\u06FF]/, 'ur'],
    [/[\u3000-\u9FFF\uFF00-\uFFEF]/, 'zh'],
  ]
  for (const [re, l] of tests) if (re.test(text)) return l
  return /[^\x00-\xFF]/.test(text) ? 'vi' : undefined
}
export const needsCanvas = (text: string) => /[^\x09\x0A\x0D\x20-\x7E\u00A0-\u00FF]/.test(text)

/** load the fonts for a language (+ the Latin fallback). Resolves false if a font could not be fetched. */
export async function ensureFonts(lang?: string): Promise<boolean> {
  const f = langDef(lang || '')?.font
  const [, ok] = await Promise.all([loadFile(LATIN), f ? loadFile(f) : Promise.resolve(true)])
  return ok // the Latin fallback is optional (standard PDF fonts cover English/Malay)
}

function fontCss(lang: string | undefined, px: number, bold?: boolean, italic?: boolean) {
  const f = langDef(lang || '')?.font
  const stack = [f && `"${fam(f)}"`, `"${fam(LATIN)}"`, 'sans-serif'].filter(Boolean).join(', ')
  return `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${px}px ${stack}`
}

/** split into unbreakable pieces; a piece carries its trailing spaces/punctuation so lines never start with "।" or "、" */
function tokens(text: string, lang?: string): string[] {
  const out: string[] = []
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(t: string): Iterable<{ segment: string; isWordLike?: boolean }> } }).Segmenter
  if (Seg && langDef(lang || '')?.noSpaces) {
    for (const s of new Seg(lang === 'my' ? 'my' : lang, { granularity: 'word' }).segment(text)) {
      if (!s.isWordLike && out.length) out[out.length - 1] += s.segment
      else out.push(s.segment)
    }
  } else {
    for (const m of text.matchAll(/\S+\s*/g)) out.push(m[0])
    if (/^\s/.test(text) && out.length) out[0] = text.match(/^\s+/)![0] + out[0]
  }
  return out
}

export interface Rendered { png: string; w: number; h: number } // png = data URL; w/h in PDF points

/** wrap + draw one paragraph. widthPt = available width; returns the image and its size in points. */
export function renderText(text: string, o: { lang?: string; size: number; width: number; bold?: boolean; italic?: boolean; color?: [number, number, number]; rtl?: boolean; lineHeight?: number }): Rendered {
  const def = langDef(o.lang || '')
  const rtl = o.rtl ?? !!def?.rtl
  const lh = (o.lineHeight || def?.lineHeight || 1.45) * o.size
  const c = document.createElement('canvas')
  const ctx = c.getContext('2d')!
  const px = o.size * SCALE
  ctx.font = fontCss(o.lang, px, o.bold, o.italic)
  const maxW = o.width * SCALE
  const lines: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const t of tokens(para, o.lang)) {
      const next = line + t
      if (line && ctx.measureText(next.trimEnd()).width > maxW) { lines.push(line.trimEnd()); line = t.trimStart() } else line = next
    }
    lines.push(line.trimEnd())
  }
  const used = Math.min(maxW, Math.ceil(Math.max(1, ...lines.map((l) => ctx.measureText(l).width)))) + 2 * SCALE
  c.width = Math.ceil(rtl ? maxW : used)
  c.height = Math.ceil(lines.length * lh * SCALE + 0.35 * px)
  ctx.font = fontCss(o.lang, px, o.bold, o.italic) // resizing the canvas resets the context
  ctx.fillStyle = `rgb(${(o.color || [0.1, 0.1, 0.12]).map((v) => Math.round(v * 255)).join(',')})`
  ctx.textBaseline = 'alphabetic'
  ctx.direction = rtl ? 'rtl' : 'ltr'
  ctx.textAlign = rtl ? 'right' : 'left'
  const x = rtl ? c.width - SCALE : 0
  // first baseline sits ~1 font size down, plus half of the extra line spacing
  lines.forEach((l, i) => ctx.fillText(l, x, (i * lh + o.size + (lh - o.size * 1.2) / 2) * SCALE))
  return { png: c.toDataURL('image/png'), w: c.width / SCALE, h: c.height / SCALE }
}
