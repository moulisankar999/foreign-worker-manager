/* Country-code selector + local number. Stores E.164 (+60123456789) when the number is valid for the chosen country;
   while typing an incomplete/invalid number it keeps "+<dial><digits>" so nothing is lost and validation can flag it. */
import { useEffect, useState } from 'react'
import type { CountryCode } from 'libphonenumber-js/min'
import { DIAL_CODES, splitPhone, toE164 } from '../lib/validate'

export function PhoneInput({ id, value, onChange, defaultCc }: { id: string; value?: string; onChange: (v: string | undefined) => void; defaultCc?: string }) {
  const init = splitPhone(value, (defaultCc as CountryCode) || 'MY')
  const [cc, setCc] = useState<CountryCode>(init.cc)
  const [num, setNum] = useState(init.national)
  // follow outside changes (e.g. record loaded after mount)
  useEffect(() => {
    const cur = toE164(cc, num) || (num ? `${DIAL_CODES.find((d) => d.cc === cc)?.dial || ''}${num.replace(/\D/g, '').replace(/^0+/, '')}` : undefined)
    if ((value || undefined) !== cur) { const s = splitPhone(value, (defaultCc as CountryCode) || cc); setCc(s.cc); setNum(s.national) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  const emit = (c: CountryCode, n: string) => {
    if (!n.trim()) return onChange(undefined)
    const e = toE164(c, n)
    onChange(e || `${DIAL_CODES.find((d) => d.cc === c)?.dial || ''}${n.replace(/\D/g, '').replace(/^0+/, '')}`)
  }
  const opts = DIAL_CODES.some((d) => d.cc === cc) ? DIAL_CODES : [...DIAL_CODES, { cc, dial: '', name: cc, flag: '🌐' }]
  return (
    <div className="phone-in">
      <select aria-label="Country code" value={cc} onChange={(e) => { const c = e.target.value as CountryCode; setCc(c); emit(c, num) }}>
        {opts.map((d) => <option key={d.cc} value={d.cc}>{d.flag} {d.dial} {d.name}</option>)}
      </select>
      <input id={id} type="tel" inputMode="tel" autoComplete="tel-national" placeholder={cc === 'MY' ? '12-345 6789' : 'local number'} value={num}
        onChange={(e) => { const n = e.target.value.replace(/[^\d\s()-]/g, ''); setNum(n); emit(cc, n) }} />
    </div>
  )
}
