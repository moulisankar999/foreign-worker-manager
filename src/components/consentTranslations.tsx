/* Settings → Passport safekeeping → Consent form translations (CEO / HR Admin).
 * Every language can be corrected field by field; blank = use the built-in text. Saved server-side (audited). */
import { useState } from 'react'
import { Btn, Card, Chip, Modal } from './ui'
import { useAuth } from '../lib/auth'
import { saveConsentTranslation, useConfig } from '../lib/config'
import { CONSENT_EN, CONSENT_KEYS, CONSENT_KEY_LABEL, CONSENT_TR, type ConsentText } from '../lib/consentText'
import { DataTable, Details } from './dataTable'
import { Actions, IconAction } from './iconAction'
import { LANGUAGES, langDef } from '../lib/languages'

const EDITABLE = LANGUAGES.filter((l) => l.code !== 'en' && l.code !== 'other')

export function ConsentTranslationsCard() {
  const { isSuper, isHrAdmin, profile, top } = useAuth()
  const items = useConfig().consent_translations?.items || {}
  const [edit, setEdit] = useState<string | null>(null)
  if (!isSuper && !isHrAdmin && !top('passport.consent')) return null
  return (
    <Card title="Consent form translations">
      <p className="muted small">The passport-safekeeping consent form prints in <b>English + the worker’s primary language</b> (English + Bahasa Malaysia when the language is not recorded or has no translation).
        The built-in translations have <b>not yet been checked by native speakers</b> — please have a fluent speaker read each one and correct it here. Keep the legal meaning: voluntary, the passport is the worker’s property, returned on request within the turnaround time, no fee, consent can be withdrawn, Passports Act 1966 s.12(1)(f).</p>
      <DataTable label="Consent form translations" rows={EDITABLE} rowKey={(l) => l.code} search={(l) => `${l.name} ${l.native || ''}`} searchLabel="Search languages"
        rowClass={(l) => (items[l.code]?.checked ? '' : 'dt-warn')}
        columns={[
          { key: 'n', label: 'Language', main: true, sort: (l) => l.name, render: (l) => <>{l.name}{l.native && l.native !== l.name ? <small className="muted"> — {l.native}</small> : null}</> },
          { key: 'b', label: 'Source', hide: 'tablet', render: (l) => <span className="small">{CONSENT_TR[l.code] ? 'Built-in' : 'No built-in translation'}</span> },
          { key: 'c', label: 'Corrected', hide: 'phone', align: 'right', render: (l) => { const ov = items[l.code]; return ov ? Object.values(ov.text || {}).filter((v) => (v || '').trim()).length : 0 } },
          { key: 's', label: 'Native check', render: (l) => { const ov = items[l.code]; return ov?.checked ? <Chip tone="green">Checked</Chip> : <Chip tone="amber">Not native-checked</Chip> } },
        ]}
        actions={(l) => <Actions><IconAction kind="edit" label={`Edit the ${l.name} translation`} onClick={() => setEdit(l.code)} /></Actions>}
        expand={(l) => { const ov = items[l.code]; const n = ov ? Object.values(ov.text || {}).filter((v) => (v || '').trim()).length : 0
          return <Details items={[['Source', CONSENT_TR[l.code] ? 'Built-in translation' : 'No built-in translation — type every field to enable it'], ['Fields corrected', n || null], ['Last edited by', ov?.updatedBy], ['Native check', ov?.checked ? `Checked${ov.checkedBy ? ` by ${ov.checkedBy}` : ''}` : 'Not native-checked']]} /> }} />
      {edit && <EditModal code={edit} me={profile?.full_name || profile?.email || ''} onClose={() => setEdit(null)} />}
    </Card>
  )
}

function EditModal({ code, me, onClose }: { code: string; me: string; onClose: () => void }) {
  const ov = useConfig().consent_translations?.items?.[code]
  const base: Partial<ConsentText> = CONSENT_TR[code] || {}
  const [text, setText] = useState<Partial<ConsentText>>({ ...(ov?.text || {}) })
  const [checked, setChecked] = useState(!!ov?.checked)
  const [checkedBy, setCheckedBy] = useState(ov?.checkedBy || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const d = langDef(code)
  const save = async (reset?: boolean) => {
    setBusy(true); setErr('')
    try {
      const clean = Object.fromEntries(Object.entries(text).filter(([, v]) => (v || '').trim()).map(([k, v]) => [k, (v || '').trim()]))
      if (!base.title && !reset && !CONSENT_KEYS.every((k) => clean[k])) throw new Error('This language has no built-in translation: fill in every field (or leave it all blank).')
      for (const k of ['p3', 'hours', 'days'] as const) if (clean[k] && !clean[k].includes(k === 'p3' ? '{time}' : '{n}')) throw new Error(`"${CONSENT_KEY_LABEL[k]}" must keep the placeholder ${k === 'p3' ? '{time}' : '{n}'}`)
      await saveConsentTranslation(code, reset ? null : { text: clean, checked, checkedBy: checked ? checkedBy.trim() : undefined, updatedAt: new Date().toISOString(), updatedBy: me })
      onClose()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Modal wide title={`Consent form — ${d?.name || code}`} onClose={onClose} footer={<>
      {ov && <Btn onClick={() => { if (confirm('Go back to the built-in translation?')) save(true) }} disabled={busy}>Reset to built-in</Btn>}
      <Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" onClick={() => save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Btn></>}>
      <p className="muted small">Leave a box empty to keep the built-in text (shown greyed). English reference is under each box. Keep the placeholders <code>{'{time}'}</code> and <code>{'{n}'}</code>.</p>
      {err && <div className="banner red">{err}</div>}
      <div className="grid-form">
        {CONSENT_KEYS.map((k) => (
          <label key={k} className="field full">
            <span>{CONSENT_KEY_LABEL[k]}</span>
            <textarea dir={d?.rtl ? 'rtl' : undefined} rows={k.length > 2 && !k.startsWith('p') && k !== 'intro' && k !== 'reference' && k !== 'explained' ? 1 : 2}
              value={text[k] || ''} placeholder={base[k] || ''} onChange={(e) => setText({ ...text, [k]: e.target.value })} />
            <small className="muted">EN: {CONSENT_EN[k]}</small>
          </label>
        ))}
      </div>
      <label className="check"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> A native speaker has checked this translation</label>
      {checked && <label className="field"><span>Checked by (name)</span><input value={checkedBy} onChange={(e) => setCheckedBy(e.target.value)} /></label>}
    </Modal>
  )
}
