/* Languages a worker speaks / reads / writes, and the script + font used to print each one on the consent form.
 * Font files live in public/fonts (Noto, SIL Open Font License) and are only fetched when a form needs them. */
import type { Worker } from './types'

export interface LangDef {
  code: string
  name: string // English name shown in the app
  native: string // the language's own name
  font?: string // file in public/fonts; undefined = Latin (built-in)
  rtl?: boolean
  lineHeight?: number // multiple of the font size; tall scripts need more room
  noSpaces?: boolean // words are not separated by spaces (wrap by word segmenter)
}
export const LANGUAGES: LangDef[] = [
  { code: 'ta', name: 'Tamil', native: 'தமிழ்', font: 'NotoSansTamil-Regular.ttf', lineHeight: 1.6 },
  { code: 'ne', name: 'Nepali', native: 'नेपाली', font: 'NotoSansDevanagari-Regular.ttf', lineHeight: 1.6 },
  { code: 'bn', name: 'Bengali', native: 'বাংলা', font: 'NotoSansBengali-Regular.ttf', lineHeight: 1.6 },
  { code: 'my', name: 'Burmese (Myanmar)', native: 'မြန်မာ', font: 'NotoSansMyanmar-Regular.ttf', lineHeight: 1.9, noSpaces: true },
  { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', font: 'NotoSansDevanagari-Regular.ttf', lineHeight: 1.6 },
  { code: 'te', name: 'Telugu', native: 'తెలుగు', font: 'NotoSansTelugu-Regular.ttf', lineHeight: 1.8 },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം', font: 'NotoSansMalayalam-Regular.ttf', lineHeight: 1.8 },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ', font: 'NotoSansKannada-Regular.ttf', lineHeight: 1.8 },
  { code: 'pa', name: 'Punjabi (Gurmukhi)', native: 'ਪੰਜਾਬੀ', font: 'NotoSansGurmukhi-Regular.ttf', lineHeight: 1.6 },
  { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી', font: 'NotoSansGujarati-Regular.ttf', lineHeight: 1.6 },
  { code: 'mr', name: 'Marathi', native: 'मराठी', font: 'NotoSansDevanagari-Regular.ttf', lineHeight: 1.6 },
  { code: 'or', name: 'Odia', native: 'ଓଡ଼ିଆ', font: 'NotoSansOriya-Regular.ttf', lineHeight: 1.8 },
  { code: 'ur', name: 'Urdu', native: 'اردو', font: 'NotoNastaliqUrdu-Regular.ttf', rtl: true, lineHeight: 2.3 },
  { code: 'si', name: 'Sinhala', native: 'සිංහල', font: 'NotoSansSinhala-Regular.ttf', lineHeight: 1.7 },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt', font: 'NotoSans-Latin.ttf', lineHeight: 1.5 },
  { code: 'th', name: 'Thai', native: 'ไทย', font: 'NotoSansThai-Regular.ttf', lineHeight: 1.7, noSpaces: true },
  { code: 'km', name: 'Khmer', native: 'ខ្មែរ', font: 'NotoSansKhmer-Regular.ttf', lineHeight: 1.9, noSpaces: true },
  { code: 'lo', name: 'Lao', native: 'ລາວ', font: 'NotoSansLao-Regular.ttf', lineHeight: 1.8, noSpaces: true },
  { code: 'tl', name: 'Tagalog / Filipino', native: 'Filipino' },
  { code: 'ms', name: 'Malay', native: 'Bahasa Melayu' },
  { code: 'en', name: 'English', native: 'English' },
  { code: 'zh', name: 'Chinese (Mandarin)', native: '中文', font: 'NotoSansSC-Subset.otf', lineHeight: 1.6, noSpaces: true },
  { code: 'other', name: 'Other (type in)', native: '' },
]
export const LANG_OPTIONS = LANGUAGES.map((l) => ({ value: l.code, label: l.native && l.native !== l.name ? `${l.name} — ${l.native}` : l.name }))
export const langDef = (code?: string) => LANGUAGES.find((l) => l.code === code)

export interface LangSkill { lang: string; other?: string; speak: boolean; read: boolean; write: boolean }

/** "Nepali", or the typed-in name for "Other" */
export function langName(code?: string, other?: string): string {
  if (!code) return ''
  if (code === 'other') return (other || '').trim() || 'Other'
  return langDef(code)?.name || code
}
export const primaryLangName = (w: Pick<Worker, 'primaryLanguage' | 'primaryLanguageOther'>) => langName(w.primaryLanguage, w.primaryLanguageOther)
export const missingLanguage = (w: Pick<Worker, 'primaryLanguage' | 'primaryLanguageOther'>) => !w.primaryLanguage || (w.primaryLanguage === 'other' && !(w.primaryLanguageOther || '').trim())

const skills = (s: { speak?: boolean; read?: boolean; write?: boolean }) => [s.speak && 'speak', s.read && 'read', s.write && 'write'].filter(Boolean).join('/')
/** one line for detail pages and exports: "Nepali (primary; speak/read/write); Hindi (speak); English (speak/read)" */
export function languagesSummary(w: Worker): string {
  const out: string[] = []
  if (w.primaryLanguage) out.push(`${primaryLangName(w)} (primary; ${skills({ speak: true, read: w.primaryRead, write: w.primaryWrite })})`)
  for (const l of w.languages || []) if (l.lang) out.push(`${langName(l.lang, l.other)}${skills(l) ? ` (${skills(l)})` : ''}`)
  return out.join('; ')
}
export const otherLanguagesText = (w: Worker) => (w.languages || []).filter((l) => l.lang).map((l) => `${langName(l.lang, l.other)}${skills(l) ? ` (${skills(l)})` : ''}`).join('; ')

/** a likely first language for a nationality, offered as a one-tap suggestion (never filled in silently) */
export const SUGGEST_BY_NATIONALITY: Record<string, string> = {
  Nepal: 'ne', Bangladesh: 'bn', Myanmar: 'my', Indonesia: 'id', India: 'ta', Pakistan: 'ur', 'Sri Lanka': 'si', Vietnam: 'vi', Thailand: 'th', Cambodia: 'km', Philippines: 'tl',
}
