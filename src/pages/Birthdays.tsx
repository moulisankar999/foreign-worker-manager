/* 1.6.0 Birthdays (HR Admin, HR Manager, GM, CEO): today / this week / this month, Send wish (in-app, signed) and Call. */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Avatar, Btn, Card, Modal, Skeleton } from '../components/ui'
import { Icon } from '../components/Icon'
import { toast } from '../components/toast'
import { useAuth } from '../lib/auth'
import { useConfig } from '../lib/config'
import { useOutlets, useWorkers, useWorkersLoaded } from '../lib/hooks'
import { companyName, outletCompany } from '../lib/companies'
import { fmtPhone } from '../lib/validate'
import { BDAY_LANGS, BDAY_REVIEW, ROLE_LABEL, birthdays, firstName, mytToday, render, saveBdayConfig, sendWish, useBdayData, type BdayConfig, type BdayRow, type Range, type Wish } from '../lib/birthdays'
import type { Worker } from '../lib/types'

const SHOW = 8
const when = (r: BdayRow) => r.inDays === 0 ? 'Today' : r.inDays === 1 ? 'Tomorrow' : r.inDays < 0 ? `Was ${new Date(r.date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
  : new Date(r.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

export default function Birthdays() {
  const wready = useWorkersLoaded()
  const { isHr, isSuper, isGm, role, profile } = useAuth()
  const workers = useWorkers()
  const outlets = useOutlets()
  const cos = useConfig().companies.items
  const { cfg, wishes, err, reload } = useBdayData(isHr)
  const [range, setRange] = useState<Range>('today')
  const [all, setAll] = useState(false)
  const [wishFor, setWishFor] = useState<Worker | null>(null)
  const [setOpen, setSetOpen] = useState(false)
  const [sent, setSent] = useState<Wish[]>([])
  const today = mytToday()
  const lists = useMemo(() => ({ today: birthdays(workers, 'today', today), week: birthdays(workers, 'week', today), month: birthdays(workers, 'month', today) }), [workers, today])
  const rows = lists[range]
  const byW = useMemo(() => { const m = new Map<string, Wish[]>(); for (const w of [...wishes, ...sent]) m.set(w.worker_id, [...(m.get(w.worker_id) || []), w]); return m }, [wishes, sent])
  const next = useMemo(() => lists.today.length ? null : birthdays(workers, 'week', today)[0] || birthdays(workers, 'month', today).find((r) => r.inDays > 0), [lists, workers, today])
  if (!wready) return <div className="page"><Skeleton kind="page" rows={6} /></div>
  if (!isHr) return <div className="page narrow"><h1>Birthdays</h1><p className="muted">Birthdays are for HR, the GM and the CEO.</p></div>
  const outletOf = (w: Worker) => outlets.find((o) => o.id === w.outletId)
  const signer = `${profile?.full_name || profile?.email?.split('@')[0] || ''} · ${ROLE_LABEL[role || ''] || role}`

  return (
    <div className="page bd-page">
      <div className="bd-hero">
        <div className="bd-hero-t">
          <span className="bd-cake" aria-hidden="true">🎂</span>
          <div><h1>Birthdays</h1><p className="muted">{cfg?.autoWish === false ? 'Automatic company wish is off.' : 'The company wish goes to the worker’s app at 8 AM Malaysia time — add a personal one.'}</p></div>
        </div>
        <div className="bd-hero-a">
          <div className="seg" role="tablist" aria-label="Range">
            {([['today', 'Today'], ['week', 'This week'], ['month', 'This month']] as [Range, string][]).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={range === k} className={range === k ? 'on' : ''} onClick={() => { setRange(k); setAll(false) }} data-testid={`bd-${k}`}
                title={k === 'week' ? 'Today and the next 6 days' : k === 'month' ? 'Everyone born this calendar month' : 'Birthdays today (Malaysia time)'}>
                {l} <span className="bd-n">{lists[k].length}</span>
              </button>))}
          </div>
          {(isSuper || isGm) && <Btn kind="ghost" icon="gear" small onClick={() => setSetOpen(true)} title="Birthday settings">Settings</Btn>}
        </div>
      </div>
      {err && <p className="err-t">{err}</p>}
      <Card className="bd-card">
        {rows.length === 0 ? (
          <div className="empty bd-empty">
            <span className="bd-empty-i" aria-hidden="true">🎈</span>
            <p className="empty-t">{range === 'today' ? 'No birthdays today' : range === 'week' ? 'No birthdays in the next 7 days' : 'No birthdays this month'}</p>
            <p className="muted">{next ? <>Next up: <strong>{next.w.fullName}</strong> — {when(next)}.</> : 'Birthdays come from the date of birth on each worker’s record.'}</p>
          </div>
        ) : (
          <ul className="bd-list" data-testid="bd-list">
            {(all ? rows : rows.slice(0, SHOW)).map((r) => {
              const o = outletOf(r.w); const co = cos.find((c) => c.id === outletCompany(o)) as ({ phone?: string } & (typeof cos)[number]) | undefined
              const ws = byW.get(r.w.id) || []
              const auto = ws.find((x) => x.kind === 'auto'); const pers = ws.filter((x) => x.kind === 'personal')
              const callOutlet = o?.phone || co?.phone
              return (
                <li key={r.w.id} className={'bd-row' + (r.inDays === 0 ? ' is-today' : '') + (r.inDays < 0 ? ' is-past' : '')} data-testid="bd-row">
                  <span className="bd-av"><Avatar name={r.w.fullName} photo={r.w.photo} size={46} />{r.inDays === 0 && <span className="bd-badge" aria-hidden="true">🎉</span>}</span>
                  <div className="bd-main">
                    <div className="bd-l1"><Link to={`/workers/${r.w.id}`} className="dt-link">{r.w.fullName}</Link>
                      <span className={'chip ' + (r.inDays === 0 ? 'chip-pink' : 'chip-gray')}>{when(r)}</span>
                      {r.turning != null && <span className="chip chip-gray" title="Age on this birthday, from the date of birth">Turning {r.turning}</span>}</div>
                    <small className="muted" data-testid="bd-company">{o?.companyId && <><b className="co-name">{companyName(cos, o.companyId)}</b>{' · '}</>}{[o?.name, r.w.phoneMY && fmtPhone(r.w.phoneMY)].filter(Boolean).join(' · ')}</small>
                    {(auto || pers.length > 0) && <div className="bd-wished">
                      {auto && <span className="chip chip-green" title="Sent by the company automatically on the birthday morning">✓ Company wish{auto.read_at ? ' · seen' : ''}</span>}
                      {pers.map((p) => <span key={p.id} className="chip chip-blue" data-testid="bd-wished">✓ {p.mine ? 'You' : p.sender_name || 'Management'}{p.sender_role && !p.mine ? ` · ${ROLE_LABEL[p.sender_role] || p.sender_role}` : ''}{p.read_at ? ' · seen' : ''}</span>)}
                    </div>}
                  </div>
                  <div className="bd-act">
                    <Btn kind={pers.some((p) => p.mine) ? 'secondary' : 'primary'} small icon="spark" onClick={() => setWishFor(r.w)}>{pers.some((p) => p.mine) ? 'Wish again' : 'Send wish'}</Btn>
                    {r.w.phoneMY && <a className="btn btn-secondary btn-s" href={`tel:${r.w.phoneMY.replace(/[^\d+]/g, '')}`} title={`Call ${r.w.fullName}`} aria-label={`Call ${r.w.fullName}`}><Icon name="phone" size={16} /><span>Call</span></a>}
                    {callOutlet && <a className="btn btn-ghost btn-s" href={`tel:${callOutlet.replace(/[^\d+]/g, '')}`} title={`Call ${o?.phone ? 'the outlet' : 'the company'}`} aria-label={`Call ${o?.phone ? 'the outlet' : 'the company'}`}><Icon name="phone" size={16} /><span>{o?.phone ? 'Outlet' : 'Office'}</span></a>}
                  </div>
                </li>)
            })}
          </ul>
        )}
        {rows.length > SHOW && !all && <button type="button" className="bd-more" onClick={() => setAll(true)}>Show all {rows.length}</button>}
      </Card>
      {wishFor && <WishSheet w={wishFor} cfg={cfg} signer={signer} company={companyName(cos, outletCompany(outletOf(wishFor))) || 'the company'} onClose={() => setWishFor(null)}
        onSent={(id) => { setSent((s) => [...s, { id, worker_id: wishFor.id, kind: 'personal', sender_name: profile?.full_name || '', sender_role: role, created_at: new Date().toISOString(), read_at: null, mine: true }]); setWishFor(null); void reload().then(() => setSent([])) }} />}
      {setOpen && cfg && <BdaySettings cfg={cfg} onClose={() => setSetOpen(false)} onSaved={() => { setSetOpen(false); void reload() }} />}
    </div>
  )
}

function WishSheet({ w, cfg, signer, company, onClose, onSent }: { w: Worker; cfg: BdayConfig | null; signer: string; company: string; onClose: () => void; onSent: (id: number) => void }) {
  const wl = BDAY_LANGS.some((l) => l.code === w.primaryLanguage) ? w.primaryLanguage! : 'en'
  const langs = [...new Set([wl, 'en'])]
  const fill = (l: string) => render(cfg?.templates?.[l] || cfg?.templates?.en || 'Happy birthday, {{name}}!', firstName(w.fullName), company)
  const [lang, setLang] = useState(wl)
  const [msg, setMsg] = useState(() => fill(wl))
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    try { const r = await sendWish(w.id, msg); toast(`Wish sent to ${firstName(w.fullName)} 🎉`); onSent(r.id) }
    catch (e) { toast((e as Error).message, 'err'); setBusy(false) }
  }
  return (
    <Modal title={<>🎂 Wish {firstName(w.fullName)} a happy birthday</>} onClose={onClose}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" icon="spark" onClick={go} disabled={busy || msg.trim().length < 2}>{busy ? 'Sending…' : 'Send wish'}</Btn></>}>
      {langs.length > 1 && <div className="seg bd-lang" role="tablist" aria-label="Language">{langs.map((l) => <button key={l} type="button" className={lang === l ? 'on' : ''} onClick={() => { setLang(l); setMsg(fill(l)) }}>{BDAY_LANGS.find((x) => x.code === l)?.name || l}</button>)}</div>}
      <div className="field"><label htmlFor="bd-msg">Message</label>
        <textarea id="bd-msg" rows={5} maxLength={1000} value={msg} onChange={(e) => setMsg(e.target.value)} data-testid="bd-msg" />
        <small className="hint">Signed <strong>{signer}</strong> · shows in the worker’s FW Worker app only (no SMS, WhatsApp or email) · {msg.length}/1000</small></div>
    </Modal>
  )
}

function BdaySettings({ cfg, onClose, onSaved }: { cfg: BdayConfig; onClose: () => void; onSaved: () => void }) {
  const [c, setC] = useState<BdayConfig>(cfg)
  const [lang, setLang] = useState('en')
  const [busy, setBusy] = useState(false)
  const save = async () => { setBusy(true); try { await saveBdayConfig(c); toast('Birthday settings saved'); onSaved() } catch (e) { toast((e as Error).message, 'err'); setBusy(false) } }
  return (
    <Modal title="Birthday settings" onClose={onClose} wide footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" onClick={save} disabled={busy}>Save</Btn></>}>
      <label className="check"><input type="checkbox" checked={c.autoWish} onChange={(e) => setC({ ...c, autoWish: e.target.checked })} data-testid="bd-auto" /> Send the company’s birthday wish automatically (8 AM Malaysia time)</label>
      <label className="check"><input type="checkbox" checked={c.notifyStaff} onChange={(e) => setC({ ...c, notifyStaff: e.target.checked })} /> Morning list of today’s birthdays to HR, the GM and the CEO</label>
      <div className="field"><label htmlFor="bd-tl">Default wish</label>
        <select id="bd-tl" value={lang} onChange={(e) => setLang(e.target.value)}>{BDAY_LANGS.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}</select>
        <textarea rows={5} maxLength={1000} value={c.templates[lang] || ''} onChange={(e) => setC({ ...c, templates: { ...c.templates, [lang]: e.target.value } })} />
        <small className="hint">{'{{name}}'} = worker’s first name, {'{{company}}'} = company name. Leave empty to use the built-in text.</small>
        {lang !== 'en' && BDAY_REVIEW.includes(lang) && !c.templates[lang] && <small className="hint" data-testid="bd-review">ℹ️ The built-in text in this language is waiting for a native-speaker check. You can type your own here.</small>}</div>
    </Modal>
  )
}
