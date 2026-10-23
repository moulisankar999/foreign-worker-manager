/* Worker form: "What language does the worker speak?" (compulsory for new workers) + other languages with speak/read/write */
import { LANGUAGES, LANG_OPTIONS, SUGGEST_BY_NATIONALITY, langDef, type LangSkill } from '../lib/languages'

type V = Record<string, unknown>
export function LanguageFields({ v, setV, required, missing }: { v: V; setV: (f: (p: V) => V) => void; required: boolean; missing?: boolean }) {
  const primary = String(v.primaryLanguage || '')
  const list = (v.languages as LangSkill[] | undefined) || []
  const suggest = SUGGEST_BY_NATIONALITY[String(v.nationality || '')]
  const set = (patch: V) => setV((p) => ({ ...p, ...patch }))
  const setRow = (i: number, patch: Partial<LangSkill>) => set({ languages: list.map((l, j) => (j === i ? { ...l, ...patch } : l)) })
  const used = new Set([primary, ...list.map((l) => l.lang)].filter((x) => x && x !== 'other'))
  return (
    <section className="lang-section mt-s" aria-label="Languages">
      <h3 className="h-sub">Languages</h3>
      {missing && <p className="banner amber small" role="status">🗣️ <strong>Language missing.</strong> Please ask the worker which language he/she speaks best — it is used for the passport consent form.</p>}
      <div className="grid-form">
        <div className="field">
          <label htmlFor="wf-lang">Primary language (speaks best) {required && <span className="req">*</span>}</label>
          <select id="wf-lang" value={primary} onChange={(e) => set({ primaryLanguage: e.target.value || undefined, ...(e.target.value !== 'other' ? { primaryLanguageOther: undefined } : {}) })}>
            <option value="">— Select —</option>
            {LANG_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {!primary && suggest && <small className="hint">Nationality {String(v.nationality)} — <button type="button" className="link" onClick={() => set({ primaryLanguage: suggest })}>use {langDef(suggest)?.name}?</button> (please confirm with the worker)</small>}
          {!!primary && <small className="hint">The passport consent form is printed in English + this language.</small>}
        </div>
        {primary === 'other' && (
          <div className="field"><label htmlFor="wf-lang-o">Language name {required && <span className="req">*</span>}</label>
            <input id="wf-lang-o" value={String(v.primaryLanguageOther || '')} placeholder="e.g. Punjabi, Karen, Javanese" onChange={(e) => set({ primaryLanguageOther: e.target.value })} /></div>
        )}
        {!!primary && (
          <div className="field"><span className="label">In this language the worker can also</span>
            <div className="row gap-m wrap checks">
              <label><input type="checkbox" checked={!!v.primaryRead} onChange={(e) => set({ primaryRead: e.target.checked })} /> Read</label>
              <label><input type="checkbox" checked={!!v.primaryWrite} onChange={(e) => set({ primaryWrite: e.target.checked })} /> Write</label>
            </div></div>
        )}
      </div>
      <div className="field full mt-s">
        <span className="label">Other languages the worker speaks, reads or writes</span>
        {list.length > 0 && (
          <table className="lang-table">
            <thead><tr><th>Language</th><th>Speak</th><th>Read</th><th>Write</th><th /></tr></thead>
            <tbody>
              {list.map((l, i) => (
                <tr key={i}>
                  <td>
                    <select aria-label={`Other language ${i + 1}`} value={l.lang} onChange={(e) => setRow(i, { lang: e.target.value, other: e.target.value === 'other' ? l.other : undefined })}>
                      <option value="">— Select —</option>
                      {LANGUAGES.filter((x) => x.code === l.lang || x.code === 'other' || !used.has(x.code)).map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
                    </select>
                    {l.lang === 'other' && <input aria-label="Language name" placeholder="Language name" value={l.other || ''} onChange={(e) => setRow(i, { other: e.target.value })} />}
                  </td>
                  <td><input type="checkbox" aria-label="Speak" checked={l.speak} onChange={(e) => setRow(i, { speak: e.target.checked })} /></td>
                  <td><input type="checkbox" aria-label="Read" checked={l.read} onChange={(e) => setRow(i, { read: e.target.checked })} /></td>
                  <td><input type="checkbox" aria-label="Write" checked={l.write} onChange={(e) => setRow(i, { write: e.target.checked })} /></td>
                  <td><button type="button" className="link" aria-label="Remove language" onClick={() => set({ languages: list.filter((_, j) => j !== i) })}>remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <button type="button" className="btn btn-secondary btn-s mt-s" onClick={() => set({ languages: [...list, { lang: '', speak: true, read: false, write: false }] })}>+ Add language</button>
        <div className="row gap-s wrap mt-s quick-langs">
          {['en', 'ms', 'hi'].filter((c) => !used.has(c)).map((c) => (
            <button key={c} type="button" className="lang-quick" onClick={() => set({ languages: [...list, { lang: c, speak: true, read: false, write: false }] })}>+ {langDef(c)?.name}</button>
          ))}
        </div>
      </div>
    </section>
  )
}

/** form value → worker fields (empty rows dropped, "other" without a name dropped) */
export function languageFieldsOut(v: V) {
  const langs = ((v.languages as LangSkill[] | undefined) || []).filter((l) => l.lang && (l.lang !== 'other' || (l.other || '').trim())).map((l) => ({ lang: l.lang, ...(l.lang === 'other' ? { other: (l.other || '').trim() } : {}), speak: !!l.speak, read: !!l.read, write: !!l.write }))
  const p = (v.primaryLanguage as string) || undefined
  return {
    primaryLanguage: p, primaryLanguageOther: p === 'other' ? String(v.primaryLanguageOther || '').trim() || undefined : undefined,
    primaryRead: p ? !!v.primaryRead : undefined, primaryWrite: p ? !!v.primaryWrite : undefined,
    languages: langs,
  }
}
export function languageError(v: V): string {
  if (!v.primaryLanguage) return 'Primary language is required — ask the worker which language he/she speaks best'
  if (v.primaryLanguage === 'other' && !String(v.primaryLanguageOther || '').trim()) return 'Type the name of the primary language'
  return ''
}
