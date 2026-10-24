import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError, cancelRequest, changePin, createRequest, getMe, getRequests, login, logout, resubmitRequest, sb, type Me, type WReq } from './api'
import { LANGS, initialLang, translator, type Key, type Lang, type T } from './i18n'
import { helpFor } from './help'

type Tab = 'home' | 'docs' | 'req' | 'new' | 'me'
const POLL_MS = 30_000
const ICON = `${import.meta.env.BASE_URL}icon-192.png`

/* ------------------------------------------------------------------ helpers */
const todayStr = () => new Date().toISOString().slice(0, 10)
const daysUntil = (d: string) => Math.round((Date.parse(d + 'T00:00:00Z') - Date.parse(todayStr() + 'T00:00:00Z')) / 86_400_000)
function fmtDate(d?: string | null, lang: Lang = 'en') {
  if (!d) return '—'
  const t = new Date(d.length <= 10 ? d + 'T00:00:00' : d)
  if (isNaN(t.getTime())) return d
  try { return t.toLocaleDateString(lang === 'my' ? 'en-GB' : lang + '-MY', { day: 'numeric', month: 'short', year: 'numeric' }) } catch { return t.toDateString() }
}
const money = (n?: number | null) => (n == null ? '—' : 'RM ' + Number(n).toLocaleString('en-MY', { maximumFractionDigits: 2 }))
type Tone = 'green' | 'amber' | 'red' | 'grey'
function expiryTone(exp: string | null, lead: number): Tone {
  if (!exp) return 'grey'
  const n = daysUntil(exp)
  return n <= 30 ? 'red' : n <= lead ? 'amber' : 'green'
}
function expiryText(exp: string | null, t: T) {
  if (!exp) return t('notRecorded')
  const n = daysUntil(exp)
  return n < 0 ? t('expiredAgo', { n: -n }) : n === 0 ? t('expiresToday') : t('daysLeft', { n })
}
const DOC_KEY: Record<string, Key> = {
  'Passport': 'doc_passport', 'Work Permit / PLKS (VP(TE))': 'doc_permit', 'Visa / VDR': 'doc_visa',
  'FOMEMA Medical': 'doc_fomema', 'Insurance (SPIKPA / Hospitalisation)': 'doc_insurance',
}
const TYPE_KEY: Record<string, Key> = {
  annual_leave: 'lv_annual', medical_leave: 'lv_medical', home_leave: 'lv_home', emergency_leave: 'lv_emergency',
  salary_advance: 't_salary_advance', loan: 't_loan', salary_increment: 't_salary_increment', resignation: 't_resignation',
  permit_renewal: 't_renewal', passport: 't_passport', complaint: 't_complaint', fomema: 'doc_fomema', document_copy: 't_document_copy',
}
const WITH_KEY: Record<string, Key> = { hr_manager: 'st_w_hrm', hr_admin: 'st_w_hra', gm: 'st_w_gm', ceo: 'st_w_ceo', general_manager: 'st_w_gm', super_admin: 'st_w_ceo', manager: 'st_manager_review', outlet_manager: 'st_manager_review' }
function statusInfo(s: string, w?: string | null): { key: Key; cls: string } {
  if (w && WITH_KEY[w] && ['manager_review', 'submitted', 'recommended', 'escalated'].includes(s)) return { key: WITH_KEY[w], cls: w === 'manager' ? 'ch-amber' : 'ch-blue' }
  if (s === 'manager_review') return { key: 'st_manager_review', cls: 'ch-amber' }
  if (s === 'returned') return { key: 'st_returned', cls: 'ch-violet' }
  if (s === 'approved') return { key: 'st_approved', cls: 'ch-green' }
  if (s === 'completed') return { key: 'st_completed', cls: 'ch-green' }
  if (s === 'rejected') return { key: 'st_rejected', cls: 'ch-red' }
  if (s === 'cancelled') return { key: 'st_cancelled', cls: 'ch-grey' }
  return { key: 'st_hr', cls: 'ch-blue' }
}
function errKey(e: unknown): Key | string {
  if (e instanceof ApiError) {
    if (e.code === 'offline') return 'offline'
    if (e.code === 'wrong_or_locked') return 'wrongOrLocked'
    if (e.code === 'busy') return 'busy'
    if (e.code === 'wrong_pin') return 'wrongPin'
    if (e.code === 'weak_pin') return 'weakPin'
    if (e.code === 'same_pin') return 'samePin'
    if (e.code === 'signed_out') return 'sessionEnded'
    const m = e.message || ''
    if (/too many open/i.test(m)) return 'tooMany'
    if (/daily limit/i.test(m)) return 'dailyLimit'
    if (/date|day/i.test(m)) return 'badDates'
    if (/amount/i.test(m)) return 'badAmount'
  }
  return 'error'
}

/** how many fixed-height rows fit in the element (lists page instead of scrolling) */
function useFit(rowH: number, gap = 8) {
  const ref = useRef<HTMLDivElement>(null)
  const [n, setN] = useState(3)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const calc = () => setN(Math.max(1, Math.floor((el.clientHeight + gap) / (rowH + gap))))
    calc()
    const ro = new ResizeObserver(calc)
    ro.observe(el)
    return () => ro.disconnect()
  }, [rowH, gap])
  return [ref, n] as const
}

/* ------------------------------------------------------------------ app */
export default function App() {
  const [lang, setLangState] = useState<Lang>(() => initialLang())
  const t = useMemo(() => translator(lang), [lang])
  const setLang = (l: Lang) => { localStorage.setItem('fww-lang', l); setLangState(l) }
  useEffect(() => { document.documentElement.lang = lang }, [lang])
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSignedIn(!!data.session))
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setSignedIn(!!s))
    return () => sub.subscription.unsubscribe()
  }, [])
  const ended = useCallback(async () => { await logout(); setNotice(t('sessionEnded')); setSignedIn(false) }, [t])

  if (signedIn === null) return <div className="app"><div /><div className="center"><img src={ICON} className="login-logo" width={64} height={64} alt="" /></div><div /></div>
  if (!signedIn) return <div className="app" style={{ gridTemplateRows: '1fr' }}><Login t={t} lang={lang} setLang={setLang} notice={notice} onDone={() => { setNotice(null); setSignedIn(true) }} /></div>
  return <Home t={t} lang={lang} setLang={setLang} onEnded={ended} />
}

/* ------------------------------------------------------------------ login */
function Login({ t, lang, setLang, notice, onDone }: { t: T; lang: Lang; setLang: (l: Lang) => void; notice: string | null; onDone: () => void }) {
  const [pp, setPp] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [langOpen, setLangOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const ok = pp.replace(/\s/g, '').length >= 5 && /^\d{6}$/.test(pin)
  const submit = async () => {
    if (!ok || busy) return
    setBusy(true); setErr(null)
    try { await login(pp, pin); setPin(''); onDone() } catch (e) { const k = errKey(e); setErr(t(k as Key)); setPin('') } finally { setBusy(false) }
  }
  return (
    <form className="login" onSubmit={(e) => { e.preventDefault(); submit() }}>
      <div className="langbar"><button type="button" className="btn ghost small" data-testid="login-lang" onClick={() => setLangOpen(true)}>🌐 {LANGS.find((l) => l.code === lang)?.native}</button><button type="button" className="btn ghost small" data-testid="login-help" onClick={() => setHelpOpen(true)}>❓ {helpFor(lang).ui.help}</button></div>
      <img src={ICON} className="logo" alt="" />
      <h1>{t('appName')}</h1>
      {notice && <div className="note">{notice}</div>}
      <div className="field"><label htmlFor="pp">{t('passport')}</label>
        <input id="pp" name="passport" autoComplete="username" autoCapitalize="characters" spellCheck={false} maxLength={20} value={pp} onChange={(e) => setPp(e.target.value.toUpperCase())} /></div>
      <div className="field"><label htmlFor="pin">{t('pin')}</label>
        <input id="pin" name="pin" type="password" inputMode="numeric" autoComplete="current-password" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} /></div>
      {err && <div className="err" role="alert" data-testid="login-error">{err}</div>}
      <button className="btn primary block" disabled={!ok || busy} data-testid="login-submit">{busy ? t('sending') : t('signIn')}</button>
      <div className="muted small" style={{ textAlign: 'center' }}>{t('pinHelp')}</div>
      {langOpen && <LangSheet t={t} lang={lang} onPick={(l) => { setLang(l); setLangOpen(false) }} onClose={() => setLangOpen(false)} />}
      {helpOpen && <HelpSheet t={t} lang={lang} signedIn={false} onClose={() => setHelpOpen(false)} />}
    </form>
  )
}

function Sheet({ title, onClose, children, full, t }: { title: string; onClose: () => void; children: ReactNode; full?: boolean; t: T }) {
  return (
    <div className="sheet" role="dialog" aria-label={title} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={'panel' + (full ? ' full' : '')}>
        <div className="ph"><h2 className="ell">{title}</h2><button type="button" className="btn" style={{ minHeight: 44 }} onClick={onClose} aria-label={t('close')}>✕</button></div>
        {children}
      </div>
    </div>
  )
}
function LangSheet({ t, lang, onPick, onClose }: { t: T; lang: Lang; onPick: (l: Lang) => void; onClose: () => void }) {
  return (
    <Sheet title={t('language')} onClose={onClose} t={t}>
      <div className="pick c2" style={{ gridAutoRows: '56px', flex: 'none' }}>
        {LANGS.map((l) => <button type="button" key={l.code} className={l.code === lang ? 'on' : ''} onClick={() => onPick(l.code)}>{l.native}</button>)}
      </div>
    </Sheet>
  )
}

/* ------------------------------------------------------------------ signed-in shell */
function Home({ t, lang, setLang, onEnded }: { t: T; lang: Lang; setLang: (l: Lang) => void; onEnded: () => void }) {
  const [tab, setTab] = useState<Tab>('home')
  const [me, setMe] = useState<Me | null>(null)
  const [reqs, setReqs] = useState<WReq[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [offline, setOffline] = useState(typeof navigator !== 'undefined' && navigator.onLine === false)
  const [toast, setToast] = useState<string | null>(null)
  const [seen, setSeen] = useState<Record<string, string>>(() => { try { return JSON.parse(localStorage.getItem('fww-seen') || '{}') } catch { return {} } })
  const first = useRef(true)

  const load = useCallback(async () => {
    try {
      const [m, r] = await Promise.all([getMe(), getRequests()])
      setMe(m); setReqs(r); setErr(null)
      if (first.current) {
        first.current = false
        if (!localStorage.getItem('fww-lang') && m.language) { const l = initialLang(m.language); if (l !== lang) setLang(l) }
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'signed_out') return onEnded()
      setErr(t(errKey(e) as Key))
    }
  }, [onEnded, t, lang, setLang])

  useEffect(() => {
    load()
    const iv = window.setInterval(() => { if (document.visibilityState === 'visible') load() }, POLL_MS)
    const vis = () => { if (document.visibilityState === 'visible') load() }
    const on = () => { setOffline(false); load() }, off = () => setOffline(true)
    document.addEventListener('visibilitychange', vis); window.addEventListener('focus', vis)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', vis); window.removeEventListener('focus', vis); window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [load])

  // requests whose status changed since the worker last looked → badge + toast
  const changed = useMemo(() => (reqs || []).filter((r) => seen[r.id] !== undefined && seen[r.id] !== r.status), [reqs, seen])
  const unseenNew = useMemo(() => (reqs || []).filter((r) => seen[r.id] === undefined && !r.mine), [reqs, seen])
  const badge = changed.length + unseenNew.length
  const prevBadge = useRef(0)
  useEffect(() => { if (badge > prevBadge.current && reqs) setToast('🔔 ' + t('updated')); prevBadge.current = badge }, [badge, reqs, t])
  useEffect(() => {
    if (!reqs) return
    if (Object.keys(seen).length === 0 && reqs.length) markSeen(reqs) // first run: nothing is "new"
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqs])
  function markSeen(list: WReq[]) {
    const m: Record<string, string> = {}
    list.forEach((r) => { m[r.id] = r.status })
    localStorage.setItem('fww-seen', JSON.stringify(m)); setSeen(m)
  }
  useEffect(() => { if (tab === 'req' && reqs && badge) markSeen(reqs) }, [tab, reqs, badge])
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 3000); return () => clearTimeout(id) }, [toast])

  const [helpOpen, setHelpOpen] = useState(false)
  const tabs: { id: Tab; ic: string; k: Key }[] = [
    { id: 'home', ic: '🏠', k: 'tabHome' }, { id: 'docs', ic: '🛂', k: 'tabDocs' }, { id: 'new', ic: '＋', k: 'tabNew' },
    { id: 'req', ic: '📨', k: 'tabReq' }, { id: 'me', ic: '👤', k: 'tabMe' },
  ]
  const title = tab === 'home' ? t('appName') : t(tabs.find((x) => x.id === tab)!.k)
  return (
    <div className="app" data-tab={tab}>
      <header className="top">
        <img src={ICON} width={30} height={30} style={{ borderRadius: 8 }} alt="" />
        <h1>{title}</h1>
        <button className="iconbtn" onClick={() => setHelpOpen(true)} aria-label={helpFor(lang).ui.help} data-testid="help">?</button>
        <button className="iconbtn" onClick={() => { load(); setToast(t('refresh') + ' ✓') }} aria-label={t('refresh')} data-testid="refresh">⟳</button>
      </header>
      <main className="main" data-testid={'tab-' + tab}>
        {offline && <div className="offline-bar">{t('offline')}</div>}
        {err && !me && <div className="err">{err}</div>}
        {!me || !reqs ? <div className="center muted">…</div>
          : tab === 'home' ? <HomeTab t={t} lang={lang} me={me} reqs={reqs} go={setTab} />
          : tab === 'docs' ? <DocsTab t={t} lang={lang} me={me} />
          : tab === 'req' ? <ReqTab t={t} lang={lang} reqs={reqs} reload={load} onEnded={onEnded} toast={setToast} />
          : tab === 'new' ? <NewTab t={t} lang={lang} onEnded={onEnded} done={() => { load(); setTab('req') }} />
          : <MeTab t={t} lang={lang} me={me} setLang={setLang} onEnded={onEnded} toast={setToast} />}
      </main>
      <nav className="tabs">
        {tabs.map((x) => (
          <button key={x.id} className={(tab === x.id ? 'on ' : '') + (x.id === 'new' ? 'new' : '')} onClick={() => setTab(x.id)} data-testid={'nav-' + x.id} aria-label={t(x.k)}>
            <span className="ic">{x.ic}</span><span className="lb">{t(x.k)}</span>
            {x.id === 'req' && badge > 0 && <span className="badge">{badge}</span>}
          </button>
        ))}
      </nav>
      {toast && <div className="toast" role="status">{toast}</div>}
      {helpOpen && <HelpSheet t={t} lang={lang} signedIn onClose={() => setHelpOpen(false)} />}
    </div>
  )
}

/* ------------------------------------------------------------------ Help (FAQ + how-to; pages instead of scrolling) */
const WORKER_MANUAL = 'fw-worker-manual.pdf'
function HelpSheet({ t, lang, signedIn, onClose }: { t: T; lang: Lang; signedIn: boolean; onClose: () => void }) {
  const h = helpFor(lang)
  const [seg, setSeg] = useState<'faq' | 'how'>('faq')
  const [open, setOpen] = useState<number | null>(null)
  const [page, setPage] = useState(0)
  const [msg, setMsg] = useState<string | null>(null)
  const [ref, per] = useFit(64)
  const titles = seg === 'faq' ? h.faq.map((f) => f[0]) : h.guides.map((g) => g.title)
  const pages = Math.max(1, Math.ceil(titles.length / per))
  const p = Math.min(page, pages - 1)
  const pick = (s: 'faq' | 'how') => { setSeg(s); setOpen(null); setPage(0) }
  const pdf = async () => {
    setMsg(null)
    const { data, error } = await sb.storage.from('manuals').createSignedUrl(WORKER_MANUAL, 600, { download: WORKER_MANUAL })
    if (error || !data) { setMsg(h.ui.pdfMissing); return }
    const { Capacitor } = await import('@capacitor/core')
    if (Capacitor.isNativePlatform()) { const { Browser } = await import('@capacitor/browser'); await Browser.open({ url: data.signedUrl }) }
    else window.open(data.signedUrl, '_blank')
  }
  return (
    <Sheet title={'❓ ' + h.ui.help} onClose={onClose} t={t} full>
      <div className="seg" role="tablist">
        <button type="button" role="tab" aria-selected={seg === 'faq'} className={seg === 'faq' ? 'on' : ''} onClick={() => pick('faq')} data-testid="help-faq">💬 {h.ui.faq}</button>
        <button type="button" role="tab" aria-selected={seg === 'how'} className={seg === 'how' ? 'on' : ''} onClick={() => pick('how')} data-testid="help-how">📖 {h.ui.howTo}</button>
      </div>
      <div className="list" ref={ref} data-testid="help-list">
        {open === null ? titles.slice(p * per, p * per + per).map((q, i) => (
          <button key={q} type="button" className="row help-row" onClick={() => setOpen(p * per + i)} data-testid="help-row">
            <span className="t ell">{q}</span><span className="muted">›</span>
          </button>
        )) : (
          <div className="card grow help-ans" data-testid="help-answer">
            <div className="q">{titles[open]}</div>
            {seg === 'faq' ? <p>{h.faq[open][1]}</p>
              : <ol>{h.guides[open].steps.map((s) => <li key={s}>{s}</li>)}</ol>}
          </div>
        )}
      </div>
      {open === null ? (pages > 1 && (
        <div className="pager">
          <button className="btn" disabled={p === 0} onClick={() => setPage(p - 1)} aria-label={t('back')} data-testid="help-prev">‹</button>
          <span className="muted small">{p + 1} / {pages}</span>
          <button className="btn" disabled={p >= pages - 1} onClick={() => setPage(p + 1)} aria-label={t('next')} data-testid="help-next">›</button>
        </div>
      )) : (
        <div className="pager">
          <button className="btn" disabled={open === 0} onClick={() => setOpen(open - 1)} aria-label={t('back')}>‹</button>
          <button className="btn" onClick={() => { setPage(Math.floor(open / per)); setOpen(null) }} data-testid="help-back">☰ {h.ui.list}</button>
          <button className="btn" disabled={open >= titles.length - 1} onClick={() => setOpen(open + 1)} aria-label={t('next')}>›</button>
        </div>
      )}
      {msg && <div className="note">{msg}</div>}
      {signedIn ? <button type="button" className="btn block" onClick={() => void pdf()} data-testid="help-pdf">📄 {h.ui.pdf}</button>
        : <div className="muted small" style={{ textAlign: 'center' }}>📄 {h.ui.pdfNeedsSignIn}</div>}
    </Sheet>
  )
}

/* ------------------------------------------------------------------ Home tab */
function HomeTab({ t, lang, me, reqs, go }: { t: T; lang: Lang; me: Me; reqs: WReq[]; go: (t: Tab) => void }) {
  const open = reqs.filter((r) => !['approved', 'completed', 'rejected', 'cancelled'].includes(r.status)).length
  const dated = me.docs.filter((d) => d.expiryDate).sort((a, b) => a.expiryDate!.localeCompare(b.expiryDate!))
  const next = dated[0]
  const worst = me.docs.reduce<Tone>((acc, d) => { const x = expiryTone(d.expiryDate, me.leadDays); return x === 'red' || acc === 'red' ? 'red' : x === 'amber' || acc === 'amber' ? 'amber' : acc }, 'green')
  const latest = reqs[0]
  return (
    <>
      <div className="card">
        <div className="hello">{t('hello')} 👋</div>
        <div className="name ell" data-testid="worker-name">{me.name}</div>
        <div className="sub ell">{[me.outlet, me.job].filter(Boolean).join(' · ')}</div>
      </div>
      <div className="tiles">
        <button className={'tile wide c-' + (next ? expiryTone(next.expiryDate, me.leadDays) : worst)} onClick={() => go('docs')} data-testid="home-expiry">
          <span className="k">{t('nextExpiry')}</span>
          {next ? <><span className={'v t-' + expiryTone(next.expiryDate, me.leadDays)}>{t(DOC_KEY[next.type] || 'doc_passport')}</span>
            <span className="d">{fmtDate(next.expiryDate, lang)} · {expiryText(next.expiryDate, t)}</span></>
            : <span className="v t-grey">{t('notRecorded')}</span>}
        </button>
        <div className="tile"><span className="k">{t('basicPay')}</span><span className="v" data-testid="home-pay">{money(me.basicPay)}</span></div>
        <div className="tile"><span className="k">{t('loanLeft')}</span><span className="v" data-testid="home-loan">{money(me.loanBalance)}</span></div>
        <button className="tile" onClick={() => go('req')}><span className="k">{t('openReq')}</span><span className="v">{open}</span></button>
        <button className="tile" onClick={() => go(latest ? 'req' : 'new')}>
          {latest ? <><span className="k ell">{t(TYPE_KEY[latest.type] || 't_complaint')}</span><span className={'chip ' + statusInfo(latest.status, latest.with).cls} style={{ alignSelf: 'flex-start', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t(statusInfo(latest.status, latest.with).key)}</span></>
            : <><span className="k">{t('tabNew')}</span><span className="v">＋</span></>}
        </button>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ Docs tab */
function DocsTab({ t, lang, me }: { t: T; lang: Lang; me: Me }) {
  return (
    <>
      {me.renewals.length > 0 && <div className="note ell">🔄 {t('renewalInProgress')} ({me.renewals.length})</div>}
      <div className="docs">
        {me.docs.map((d) => {
          const tone = expiryTone(d.expiryDate, me.leadDays)
          return (
            <div key={d.type} className={'card doc c-' + tone} data-testid="doc-tile" data-tone={tone}>
              <div style={{ minWidth: 0 }}><div className="nm ell">{t(DOC_KEY[d.type] || 'doc_passport')}</div>
                <div className="dt ell">{fmtDate(d.expiryDate, lang)}{d.number ? ' · ' + d.number : ''}</div></div>
              <div className={'left t-' + tone}>{expiryText(d.expiryDate, t)}</div>
            </div>
          )
        })}
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ Requests tab */
function ReqTab({ t, lang, reqs, reload, onEnded, toast }: { t: T; lang: Lang; reqs: WReq[]; reload: () => void; onEnded: () => void; toast: (s: string) => void }) {
  const [ref, per] = useFit(64)
  const [page, setPage] = useState(0)
  const [openId, setOpenId] = useState<string | null>(null)
  const pages = Math.max(1, Math.ceil(reqs.length / per))
  const p = Math.min(page, pages - 1)
  const shown = reqs.slice(p * per, p * per + per)
  const open = reqs.find((r) => r.id === openId) || null
  return (
    <>
      <div className="list" ref={ref} data-testid="req-list">
        {reqs.length === 0 ? <div className="center muted">{t('noRequests')}</div>
          : shown.map((r) => {
            const s = statusInfo(r.status, r.with)
            return (
              <button key={r.id} className="row" onClick={() => setOpenId(r.id)} data-testid="req-row">
                <div style={{ minWidth: 0 }}>
                  <div className="t ell">{t(TYPE_KEY[r.type] || 't_complaint')}</div>
                  <div className="s ell">{fmtDate(r.createdAt, lang)} · {r.ref}{r.source === 'manager' ? ' · ' + t('fromManager') : ''}{r.confidential ? ' · 🔒' : ''}</div>
                </div>
                <span className={'chip ' + s.cls}>{t(s.key)}</span>
              </button>
            )
          })}
      </div>
      {pages > 1 && (
        <div className="pager">
          <button className="btn" disabled={p === 0} onClick={() => setPage(p - 1)} aria-label={t('back')}>‹</button>
          <span className="muted small">{p + 1} / {pages}</span>
          <button className="btn" disabled={p >= pages - 1} onClick={() => setPage(p + 1)} aria-label={t('next')}>›</button>
        </div>
      )}
      {open && <ReqSheet t={t} lang={lang} r={open} onClose={() => setOpenId(null)} reload={reload} onEnded={onEnded} toast={toast} />}
    </>
  )
}

const EV_KEY: Record<string, Key> = {
  worker_submit: 'ev_worker_submit', submit: 'ev_submit', mgr_approve: 'ev_mgr_approve', mgr_reject: 'ev_mgr_reject', auto_escalate: 'ev_auto_escalate',
  approve: 'ev_approve', forward: 'ev_forward', reject: 'ev_reject', return: 'ev_return', apply: 'ev_apply', cancel: 'ev_cancel',
  worker_cancel: 'ev_worker_cancel', resubmit: 'ev_resubmit', worker_resubmit: 'ev_worker_resubmit',
}
function ReqSheet({ t, lang, r, onClose, reload, onEnded, toast }: { t: T; lang: Lang; r: WReq; onClose: () => void; reload: () => void; onEnded: () => void; toast: (s: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const s = statusInfo(r.status, r.with)
  const canCancel = r.mine && ['manager_review', 'submitted', 'returned'].includes(r.status)
  const returned = r.mine && r.status === 'returned'
  const lastReason = [...r.events].reverse().find((e) => ['mgr_reject', 'reject', 'return'].includes(e.action) && e.comment)
  const evs = r.events.slice(returned ? -2 : -4)
  const run = async (f: () => Promise<void>) => {
    setBusy(true); setErr(null)
    try { await f(); toast(t('sent')); reload(); onClose() } catch (e) { if (e instanceof ApiError && e.code === 'signed_out') return onEnded(); setErr(t(errKey(e) as Key)) } finally { setBusy(false) }
  }
  return (
    <Sheet title={t(TYPE_KEY[r.type] || 't_complaint')} onClose={onClose} t={t} full>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span className={'chip ' + s.cls} data-testid="req-status">{t(s.key)}</span>
          {r.source === 'manager' && <span className="chip ch-grey">{t('fromManager')}</span>}
          {r.overdue && <span className="chip ch-amber">{t('overdueFlag')}</span>}
          {r.confidential && <span className="chip ch-violet">🔒 {t('private')}</span>}
        </div>
        <div className="kv">
          <span className="k">#</span><span className="v">{r.ref}</span>
          <span className="k">{t('tabNew')}</span><span className="v">{fmtDate(r.createdAt, lang)}</span>
          {r.from && <><span className="k">{t('from')} – {t('to')}</span><span className="v">{fmtDate(r.from, lang)} – {fmtDate(r.to, lang)}</span></>}
          {r.lastDay && <><span className="k">{t('lastDay')}</span><span className="v">{fmtDate(r.lastDay, lang)}</span></>}
          {r.amount != null && <><span className="k">{t('amount')}</span><span className="v">{money(r.amount)}</span></>}
        </div>
      </div>
      {lastReason && <div className="err clamp2" data-testid="req-reason"><b>{t('reasonGiven')}:</b> {lastReason.comment}</div>}
      <div className="card grow" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="muted small">{t('history')}</div>
        {evs.map((e, i) => (
          <div className="ev" key={i}><span className="dot" /><span className="ell">{t((e.action === 'assign' || e.action === 'escalate') && e.role && WITH_KEY[e.role] ? WITH_KEY[e.role] : EV_KEY[e.action] || 'ev_submit')}</span><span className="muted small">{fmtDate(e.at, lang)}</span></div>
        ))}
      </div>
      {returned && (
        <div className="field"><label htmlFor="ans">{t('answer')}</label>
          <textarea id="ans" maxLength={300} value={answer} onChange={(e) => setAnswer(e.target.value)} style={{ height: 72 }} /></div>
      )}
      {err && <div className="err">{err}</div>}
      {confirmCancel ? (
        <div className="wiz foot" style={{ display: 'grid' }}>
          <button className="btn" onClick={() => setConfirmCancel(false)}>{t('no')}</button>
          <button className="btn danger" disabled={busy} onClick={() => run(() => cancelRequest(r.id))} data-testid="req-cancel-yes">{t('confirmCancel')} {t('yes')}</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: returned && canCancel ? '1fr 2fr' : '1fr', gap: 10 }}>
          {canCancel && <button className="btn danger" onClick={() => setConfirmCancel(true)} data-testid="req-cancel">{t('cancelReq')}</button>}
          {returned && <button className="btn primary" disabled={busy || !answer.trim()} onClick={() => run(() => resubmitRequest(r.id, answer))}>{t('sendAnswer')}</button>}
        </div>
      )}
    </Sheet>
  )
}

/* ------------------------------------------------------------------ New request wizard */
type WType = 'leave' | 'salary_advance' | 'loan' | 'salary_increment' | 'resignation' | 'renewal' | 'passport' | 'complaint'
const WTYPES: { id: WType; ic: string; k: Key }[] = [
  { id: 'leave', ic: '🌴', k: 't_leave' }, { id: 'salary_advance', ic: '💵', k: 't_salary_advance' },
  { id: 'loan', ic: '🏦', k: 't_loan' }, { id: 'salary_increment', ic: '📈', k: 't_salary_increment' },
  { id: 'renewal', ic: '🔄', k: 't_renewal' }, { id: 'passport', ic: '🛂', k: 't_passport' },
  { id: 'complaint', ic: '🗣️', k: 't_complaint' }, { id: 'resignation', ic: '🚪', k: 't_resignation' },
]
const RENEW_DOCS: { v: string; k: Key }[] = [
  { v: 'Passport', k: 'doc_passport' }, { v: 'Work permit (PLKS)', k: 'doc_permit' }, { v: 'Visa', k: 'doc_visa' },
  { v: 'FOMEMA', k: 'doc_fomema' }, { v: 'Insurance', k: 'doc_insurance' },
]
const TOPICS: { v: string; k: Key; ic: string }[] = [
  { v: 'Salary', k: 'tp_pay', ic: '💵' }, { v: 'Hostel', k: 'tp_hostel', ic: '🏠' }, { v: 'Work', k: 'tp_work', ic: '🧰' },
  { v: 'Safety', k: 'tp_safety', ic: '⛑️' }, { v: 'Other', k: 'tp_other', ic: '💬' },
]
type Form = { kind?: string; from?: string; to?: string; amount?: string; months?: string; reason?: string; lastDay?: string; doc?: string; date?: string; topic?: string; aboutManager?: boolean }

function NewTab({ t, lang, onEnded, done }: { t: T; lang: Lang; onEnded: () => void; done: () => void }) {
  const [type, setType] = useState<WType | null>(null)
  const [step, setStep] = useState(0)
  const [f, setF] = useState<Form>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<{ ref: string; status: string } | null>(null)
  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }))
  const reset = () => { setType(null); setStep(0); setF({}); setErr(null); setResult(null) }

  if (result) return (
    <div className="center" data-testid="new-done">
      <div className="big">✅</div>
      <div className="name">{result.status === 'manager_review' ? t('sentTo') : t('sentHr')}</div>
      <div className="muted">{result.ref}</div>
      <button className="btn primary" style={{ minWidth: 200 }} onClick={() => { reset(); done() }}>{t('done')}</button>
    </div>
  )
  if (!type) return (
    <div className="pick c2" data-testid="new-types">
      {WTYPES.map((x) => <button key={x.id} onClick={() => { setType(x.id); setStep(1); setF(x.id === 'loan' ? { months: '6' } : {}) }} data-testid={'type-' + x.id}><span className="ic">{x.ic}</span><span className="ell" style={{ maxWidth: '100%' }}>{t(x.k)}</span></button>)}
    </div>
  )

  const today = todayStr()
  const steps: { ok: boolean; body: ReactNode }[] = []
  const reasonField = (required: boolean, label: Key = 'reason') => (
    <div className="field"><label htmlFor="reason">{t(label)}{required ? ' *' : ''}</label>
      <textarea id="reason" maxLength={300} value={f.reason || ''} onChange={(e) => set({ reason: e.target.value })} /></div>
  )
  const pickRow = <V extends string>(opts: { v: V; k: Key; ic?: string }[], val: string | undefined, onPick: (v: V) => void, cols = 1) => (
    <div className={'pick' + (cols === 2 ? ' c2' : '')}>{opts.map((o) => <button key={o.v} className={val === o.v ? 'on' : ''} onClick={() => onPick(o.v)} data-testid={'opt-' + o.v}>{o.ic && <span className="ic">{o.ic}</span>}<span>{t(o.k)}</span></button>)}</div>
  )
  if (type === 'leave') {
    steps.push({ ok: !!f.kind, body: pickRow([{ v: 'annual', k: 'lv_annual', ic: '🌴' }, { v: 'medical', k: 'lv_medical', ic: '🩺' }, { v: 'home', k: 'lv_home', ic: '✈️' }], f.kind, (v) => { set({ kind: v }); setStep(2) }) })
    steps.push({ ok: !!f.from && !!f.to && f.to >= f.from, body: <>
      <div className="field"><label htmlFor="from">{t('from')}</label><input id="from" type="date" value={f.from || ''} min={today} onChange={(e) => set({ from: e.target.value, to: f.to && f.to >= e.target.value ? f.to : e.target.value })} /></div>
      <div className="field"><label htmlFor="to">{t('to')}</label><input id="to" type="date" value={f.to || ''} min={f.from || today} onChange={(e) => set({ to: e.target.value })} /></div>
      {reasonField(false)}</> })
  } else if (type === 'salary_advance' || type === 'loan') {
    const amt = Number(f.amount)
    steps.push({ ok: amt > 0 && amt <= 20000 && (type !== 'loan' || (Number(f.months) >= 1 && Number(f.months) <= 36)), body: <>
      <div className="field"><label htmlFor="amount">{t('amount')}</label><input id="amount" inputMode="decimal" value={f.amount || ''} onChange={(e) => set({ amount: e.target.value.replace(/[^\d.]/g, '').slice(0, 8) })} /></div>
      {type === 'loan' && <div className="field"><label htmlFor="months">{t('months')}</label><input id="months" inputMode="numeric" value={f.months || ''} onChange={(e) => set({ months: e.target.value.replace(/\D/g, '').slice(0, 2) })} /></div>}
      {reasonField(false)}</> })
  } else if (type === 'salary_increment') {
    steps.push({ ok: !!f.reason?.trim(), body: reasonField(true) })
  } else if (type === 'resignation') {
    steps.push({ ok: !!f.lastDay && f.lastDay >= today, body: <>
      <div className="field"><label htmlFor="lastDay">{t('lastDay')}</label><input id="lastDay" type="date" min={today} value={f.lastDay || ''} onChange={(e) => set({ lastDay: e.target.value })} /></div>
      {reasonField(false)}</> })
  } else if (type === 'renewal') {
    steps.push({ ok: !!f.doc, body: <><div className="muted small">{t('whichDoc')}</div>{pickRow(RENEW_DOCS, f.doc, (v) => { set({ doc: v }); setStep(2) })}</> })
  } else if (type === 'passport') {
    steps.push({ ok: !f.date || f.date >= today, body: <>
      <div className="note">{t('passportNote')}</div>
      <div className="field"><label htmlFor="date">{t('date')}</label><input id="date" type="date" min={today} value={f.date || ''} onChange={(e) => set({ date: e.target.value })} /></div>
      {reasonField(false)}</> })
  } else if (type === 'complaint') {
    steps.push({ ok: !!f.topic, body: <><div className="muted small">{t('topic')}</div>{pickRow(TOPICS, f.topic, (v) => { set({ topic: v }); setStep(2) }, 2)}</> })
    steps.push({ ok: !!f.reason?.trim(), body: <>{reasonField(true)}
      <label className="check"><input type="checkbox" checked={!!f.aboutManager} onChange={(e) => set({ aboutManager: e.target.checked })} data-testid="about-manager" /><span>{t('aboutManager')}</span></label></> })
  }
  const toHr = type === 'passport' || (type === 'complaint' && f.aboutManager)
  const summary: [Key, string][] = []
  summary.push(['tabNew', t(WTYPES.find((x) => x.id === type)!.k)])
  if (f.kind) summary.push(['kind', t(('lv_' + f.kind) as Key)])
  if (f.from) summary.push(['from', fmtDate(f.from, lang)])
  if (f.to) summary.push(['to', fmtDate(f.to, lang)])
  if (f.amount) summary.push(['amount', money(Number(f.amount))])
  if (type === 'loan' && f.months) summary.push(['months', f.months])
  if (f.lastDay) summary.push(['lastDay', fmtDate(f.lastDay, lang)])
  if (f.doc) summary.push(['whichDoc', t(RENEW_DOCS.find((d) => d.v === f.doc)!.k)])
  if (f.date) summary.push(['date', fmtDate(f.date, lang)])
  if (f.topic) summary.push(['topic', t(TOPICS.find((d) => d.v === f.topic)!.k)])
  steps.push({ ok: true, body: <>
    <div className="card"><div className="kv">{summary.map(([k, v]) => <Fragment key={k}><span className="k">{t(k)}</span><span className="v">{v}</span></Fragment>)}</div>
      {f.reason && <div className="clamp2 small" style={{ marginTop: 8 }}>“{f.reason}”</div>}</div>
    {type === 'resignation' && <div className="err">{t('confirmResign')}</div>}
    <div className="note">➡️ {toHr ? t('sentHr') : t('sentTo')}</div></> })

  const total = steps.length
  const cur = steps[step - 1]
  const last = step === total
  const send = async () => {
    setBusy(true); setErr(null)
    const data: Record<string, unknown> = { reason: f.reason?.trim() || '' }
    if (type === 'leave') Object.assign(data, { kind: f.kind, from: f.from, to: f.to })
    if (type === 'salary_advance' || type === 'loan') Object.assign(data, { amount: Number(f.amount), months: type === 'loan' ? Number(f.months) : undefined })
    if (type === 'resignation') data.lastDay = f.lastDay
    if (type === 'renewal') data.doc = f.doc
    if (type === 'passport') data.date = f.date || today
    if (type === 'complaint') Object.assign(data, { topic: f.topic, aboutManager: !!f.aboutManager })
    try { const r = await createRequest(type, data); setResult(r) } catch (e) { if (e instanceof ApiError && e.code === 'signed_out') return onEnded(); setErr(t(errKey(e) as Key)) } finally { setBusy(false) }
  }
  return (
    <div className="wiz" data-testid="wizard" data-step={step}>
      <div className="head"><b className="ell">{WTYPES.find((x) => x.id === type)!.ic} {t(WTYPES.find((x) => x.id === type)!.k)}</b><span className="muted small" style={{ whiteSpace: 'nowrap' }}>{last ? t('confirm') : t('step', { a: step, b: total })}</span></div>
      <div className="body">{cur.body}</div>
      {err && <div className="err" role="alert">{err}</div>}
      <div className="foot">
        <button className="btn" onClick={() => (step === 1 ? reset() : setStep(step - 1))}>{t('back')}</button>
        {last ? <button className="btn primary" disabled={busy} onClick={send} data-testid="wiz-send">{busy ? t('sending') : t('send')}</button>
          : <button className="btn primary" disabled={!cur.ok} onClick={() => setStep(step + 1)} data-testid="wiz-next">{t('next')}</button>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Me tab */
function MeTab({ t, lang, me, setLang, onEnded, toast }: { t: T; lang: Lang; me: Me; setLang: (l: Lang) => void; onEnded: () => void; toast: (s: string) => void }) {
  const [sheet, setSheet] = useState<'lang' | 'pin' | 'help' | null>(null)
  return (
    <>
      <div className="card grow" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="name ell">{me.name}</div>
        <div className="kv">
          <span className="k">{t('workerNo')}</span><span className="v">{me.workerNo || '—'}</span>
          <span className="k">{t('outlet')}</span><span className="v">{me.outlet || '—'}</span>
          <span className="k">{t('job')}</span><span className="v">{me.job || '—'}</span>
          <span className="k">{t('joined')}</span><span className="v">{fmtDate(me.joinDate, lang)}</span>
          <span className="k">{t('nationality')}</span><span className="v">{me.nationality || '—'}</span>
        </div>
      </div>
      <button className="btn block" onClick={() => setSheet('lang')} data-testid="me-lang">🌐 {t('language')}: {LANGS.find((l) => l.code === lang)?.native}</button>
      <div className="row2">
        <button className="btn" onClick={() => setSheet('pin')} data-testid="me-pin">🔑 {t('changePin')}</button>
        <button className="btn" onClick={() => setSheet('help')} data-testid="me-help">❓ {helpFor(lang).ui.help}</button>
      </div>
      <button className="btn danger block" onClick={async () => { await logout() }} data-testid="me-logout">↩ {t('signOut')}</button>
      {sheet === 'lang' && <LangSheet t={t} lang={lang} onPick={(l) => { setLang(l); setSheet(null) }} onClose={() => setSheet(null)} />}
      {sheet === 'help' && <HelpSheet t={t} lang={lang} signedIn onClose={() => setSheet(null)} />}
      {sheet === 'pin' && <PinSheet t={t} onClose={() => setSheet(null)} onEnded={onEnded} onDone={() => { setSheet(null); toast(t('pinChanged') + ' ✓') }} />}
    </>
  )
}
function PinSheet({ t, onClose, onEnded, onDone }: { t: T; onClose: () => void; onEnded: () => void; onDone: () => void }) {
  const [cur, setCur] = useState(''), [nw, setNw] = useState(''), [rep, setRep] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const ok = /^\d{6}$/.test(cur) && /^\d{6}$/.test(nw) && nw === rep
  const digits = (s: string) => s.replace(/\D/g, '').slice(0, 6)
  const submit = async () => {
    if (nw !== rep) return setErr(t('pinMismatch'))
    setBusy(true); setErr(null)
    try { await changePin(cur, nw); onDone() } catch (e) { if (e instanceof ApiError && e.code === 'signed_out') return onEnded(); setErr(t(errKey(e) as Key)) } finally { setBusy(false) }
  }
  return (
    <Sheet title={t('changePin')} onClose={onClose} t={t}>
      <form onSubmit={(e) => { e.preventDefault(); submit() }} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="field"><label htmlFor="cp">{t('currentPin')}</label><input id="cp" type="password" inputMode="numeric" autoComplete="current-password" value={cur} onChange={(e) => setCur(digits(e.target.value))} /></div>
        <div className="field"><label htmlFor="np">{t('newPin')}</label><input id="np" type="password" inputMode="numeric" autoComplete="new-password" value={nw} onChange={(e) => setNw(digits(e.target.value))} /></div>
        <div className="field"><label htmlFor="rp">{t('repeatPin')}</label><input id="rp" type="password" inputMode="numeric" autoComplete="new-password" value={rep} onChange={(e) => setRep(digits(e.target.value))} /></div>
        {rep.length === 6 && nw !== rep && <div className="err">{t('pinMismatch')}</div>}
        {err && <div className="err" role="alert">{err}</div>}
        <button className="btn primary block" disabled={!ok || busy} data-testid="pin-save">{busy ? t('sending') : t('changePin')}</button>
      </form>
    </Sheet>
  )
}
