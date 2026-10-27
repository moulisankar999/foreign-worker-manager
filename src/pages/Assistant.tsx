/* AI Assistant (v1.5.0): ask about workers, expiries, quota, the pipeline, follow-ups, rules and how to use the app.
 * Answers come from the ai-assistant edge function, which looks things up AS the signed-in user (same scope and
 * hide-superiors rules as the rest of the app). Actions are only drafts: nothing happens until Confirm here. */
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Btn, Card, Chip, Empty } from '../components/ui'
import { Icon } from '../components/Icon'
import { DataTable, Details } from '../components/dataTable'
import { Actions, IconAction } from '../components/iconAction'
import { toast } from '../components/toast'
import { useAuth } from '../lib/auth'
import { db } from '../lib/db'
import { createRequest, refNo } from '../lib/requests'
import { download, uid } from '../lib/util'
import { useAiSwitchOn } from '../lib/config'
import { AI_LANGS, aiChat, aiDecideDraft, aiSetLimit, clearChat, initialAiLang, loadChat, reminderIcs, saveChat, stashDraft, useAiStatus, type AiDraft, type AiMsg, type AiTable } from '../lib/ai'

const SUGGEST: Record<string, string[]> = {
  ceo: ['What needs my attention today?', 'Whose work permits expire in the next 60 days?', 'Show the quota balance by company', 'Which recruits are waiting for a calling visa (VDR)?', 'What are the current FOMEMA rules?'],
  gm: ['What is overdue right now?', 'Passports and permits expiring in 90 days', 'Quota letters expiring with unused slots', 'Recruitment pipeline by stage', 'How do I escalate a request to the CEO?'],
  hr: ['My overdue follow-ups', 'Permits expiring in the next 30 days', 'Recruits arriving this month', 'Draft annual leave for a worker', 'How do I renew a work permit?'],
  om: ['Who in my outlet has documents expiring soon?', 'My open requests', 'Add a praise note for a worker', 'Remind me to check the hostel on Friday', 'How do I raise medical leave?'],
  viewer: ['Find a worker by name', 'Permits expiring in the next 60 days', 'How do the reports work?'],
}
const groupOf = (r?: string | null) => r === 'super_admin' || r === 'admin' ? 'ceo' : r === 'general_manager' ? 'gm' : r === 'hr_admin' || r === 'hr_manager' || r === 'manager' ? 'hr' : r === 'outlet_manager' ? 'om' : 'viewer'

/* markdown-lite: **bold**, [label](/app/path), "- " bullets, numbered lines, paragraphs. No HTML is ever injected. */
function inline(s: string, k: string): ReactNode[] {
  const out: ReactNode[] = []; const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g; let last = 0; let m: RegExpExecArray | null; let i = 0
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index))
    if (m[1]) out.push(<strong key={`${k}b${i++}`}>{m[1]}</strong>)
    else { const to = m[3].replace(/^#/, ''); out.push(to.startsWith('/') && !to.startsWith('//') ? <Link key={`${k}l${i++}`} to={to}>{m[2]}</Link> : <span key={`${k}t${i++}`}>{m[2]}</span>) }
    last = re.lastIndex
  }
  if (last < s.length) out.push(s.slice(last))
  return out
}
export function Md({ text }: { text: string }) {
  const blocks: ReactNode[] = []; let list: { ord: boolean; items: string[] } | null = null
  const flush = () => { if (list) { const L = list.ord ? 'ol' : 'ul'; blocks.push(<L key={`L${blocks.length}`}>{list.items.map((t, i) => <li key={i}>{inline(t, `li${blocks.length}-${i}`)}</li>)}</L>); list = null } }
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd(); const b = /^\s*[-*•]\s+(.*)/.exec(line); const n = /^\s*\d+[.)]\s+(.*)/.exec(line)
    if (b || n) { const ord = !b; if (!list || list.ord !== ord) { flush(); list = { ord, items: [] } } list.items.push((b || n)![1]); continue }
    flush()
    if (!line.trim()) continue
    const h = /^#{1,4}\s+(.*)/.exec(line)
    blocks.push(h ? <p key={`p${blocks.length}`}><strong>{inline(h[1], `h${blocks.length}`)}</strong></p> : <p key={`p${blocks.length}`}>{inline(line, `p${blocks.length}`)}</p>)
  }
  flush()
  return <>{blocks}</>
}

/* One screen, no page scroll: the page fills the space between its top and the bottom bar (phone) or window edge;
 * only the conversation scrolls inside it. */
function useFitHeight(ref: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const fit = () => {
      const el = ref.current; if (!el) return
      const bar = document.querySelector('.bottom') as HTMLElement | null
      const barTop = bar && getComputedStyle(bar).display !== 'none' ? bar.getBoundingClientRect().top : window.innerHeight
      const top = el.getBoundingClientRect().top
      el.style.height = `${Math.max(360, Math.floor(barTop - top - 12))}px`
      // the shell may add padding below the page: trim whatever still makes the window scroll
      const se = document.scrollingElement as HTMLElement | null
      const over = se ? se.scrollHeight - se.clientHeight : 0
      if (over > 0) el.style.height = `${Math.max(360, el.getBoundingClientRect().height - over)}px`
    }
    fit(); const t = setTimeout(fit, 300)
    window.addEventListener('resize', fit); window.visualViewport?.addEventListener('resize', fit)
    return () => { clearTimeout(t); window.removeEventListener('resize', fit); window.visualViewport?.removeEventListener('resize', fit) }
  }, [ref])
}

function AiTableView({ t, open: open0 }: { t: AiTable; open: boolean }) {
  const [open, setOpen] = useState(open0)
  useEffect(() => { if (!open0) setOpen(false) }, [open0]) // older answers fold so the screen stays short
  const [main, ...rest] = t.columns
  const show = (v: unknown) => (v == null || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v))
  return (
    <div className={`ai-table ${open ? 'is-open' : ''}`}>
      <button type="button" className="ai-table-h" aria-expanded={open} title={open ? 'Fold the table' : 'Show the table'} onClick={() => setOpen(!open)}>
        <Icon name="doc" size={16} /> <strong>{t.title}</strong> <span className="muted small">{t.rows.length}{t.more ? ` of ${t.rows.length + t.more}` : ''}</span>
        <span className="ai-fold-c"><Icon name="chev" size={16} /></span>
      </button>
      {open && <DataTable label={t.title} rows={t.rows} rowKey={(r) => String(r.id ?? r.ref ?? JSON.stringify(r))} dense searchFrom={12} pageSize={8}
        columns={[
          { key: main.key, label: main.label, main: true, sort: (r) => show(r[main.key]), render: (r) => (r.link ? <Link to={String(r.link)} onClick={(e) => e.stopPropagation()}>{show(r[main.key])}</Link> : show(r[main.key])) },
          ...rest.map((c, i) => ({ key: c.key, label: c.label, hide: (i >= 3 ? 'tablet' : i >= 1 ? 'phone' : undefined) as 'phone' | 'tablet' | undefined, sort: (r: Record<string, unknown>) => (typeof r[c.key] === 'number' ? (r[c.key] as number) : show(r[c.key])), render: (r: Record<string, unknown>) => show(r[c.key]) })),
        ]}
        expand={(r) => <Details items={Object.entries(r).filter(([k]) => !['id', 'link'].includes(k) && r[k] != null && r[k] !== '').map(([k, v]) => [k.replace(/_/g, ' '), show(v)] as [string, string])} />}
        actions={(r) => (r.link ? <Actions><IconAction kind="view" label="Open in the app" href={`#${String(r.link)}`} /></Actions> : null)} />}
    </div>
  )
}

function DraftCard({ d, onDone }: { d: AiDraft; onDone: (state: 'confirmed' | 'discarded', ref?: string) => void }) {
  const { profile, session, role } = useAuth()
  const nav = useNavigate()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const p = d.payload as Record<string, unknown>
  const missing = (p.missing as string[] | undefined) || []
  const fields = ((p.fields as { key: string; label: string; value: unknown }[] | undefined) || []).filter((f) => f.value != null && f.value !== '')
  const openForm = () => { stashDraft(d); nav(`/requests/new?type=${encodeURIComponent(String(p.type))}&worker=${encodeURIComponent(String(d.worker_id))}&ai=${d.id}`) }
  const confirm = async () => {
    setBusy(true); setErr('')
    try {
      if (d.kind === 'request') {
        if (missing.length || p.type === 'emergency_leave') return openForm()
        const r = await createRequest(String(p.type), String(d.worker_id), String(p.title), (p.data as Record<string, unknown>) || {}, p.amount == null ? null : Number(p.amount))
        await aiDecideDraft(d.id, 'confirmed', refNo(r))
        toast(`Request ${refNo(r)} sent for approval`); onDone('confirmed', refNo(r))
      } else if (d.kind === 'note') {
        await db.remarks.put({ id: uid(), workerId: String(d.worker_id), text: String(p.text), kind: (p.kind as 'remark') || 'remark', at: new Date().toISOString(), by: profile?.full_name || profile?.email || '', byId: session?.user.id, byRole: role || undefined })
        await aiDecideDraft(d.id, 'confirmed', 'note')
        toast('Note saved on the worker record'); onDone('confirmed')
      } else {
        download(`reminder-${String(p.date)}.ics`, reminderIcs(p as { title: string; date: string }), 'text/calendar')
        await aiDecideDraft(d.id, 'confirmed', 'ics')
        toast('Reminder added — open the file to put it in your calendar'); onDone('confirmed')
      }
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const discard = async () => { try { await aiDecideDraft(d.id, 'discarded'); onDone('discarded') } catch (e) { setErr((e as Error).message) } }
  const kindLabel = d.kind === 'request' ? `Request · ${String(p.type_label || p.type)}` : d.kind === 'note' ? `Note · ${String(p.kind || 'remark')}` : 'Reminder'
  return (
    <div className={`ai-draft ${d.state ? 'is-' + d.state : ''}`} data-testid="ai-draft">
      <div className="ai-draft-h"><Chip tone={d.kind === 'request' ? 'blue' : d.kind === 'note' ? 'teal' : 'purple'}>{kindLabel}</Chip>{d.state && <Chip tone={d.state === 'confirmed' ? 'green' : 'gray'}>{d.state === 'confirmed' ? `Done${d.ref && d.ref.startsWith('#') ? ' ' + d.ref : ''}` : 'Discarded'}</Chip>}</div>
      <strong>{d.title}</strong>
      {d.kind === 'request' && (<>
        {p.worker_name != null && <p className="small muted">Worker: {d.worker_id ? <Link to={`/workers/${d.worker_id}`}>{String(p.worker_name)}</Link> : String(p.worker_name)}</p>}
        {fields.length > 0 && <Details items={fields.map((f) => [f.label, String(f.value)] as [string, string])} />}
        {missing.length > 0 && <p className="small warn-t">Still needed: {missing.join(', ')} — finish it in the request form.</p>}
      </>)}
      {d.kind === 'note' && <><p className="small muted">On <Link to={`/workers/${d.worker_id}`}>{String(p.worker_name)}</Link></p><p className="ai-quote">{String(p.text)}</p></>}
      {d.kind === 'reminder' && <p className="small">{String(p.date)} {String(p.time || '')}{p.worker_name ? ` · ${String(p.worker_name)}` : ''}{p.note ? ` — ${String(p.note)}` : ''}</p>}
      {err && <p className="err small">{err}{d.kind === 'request' && <> · <a href="#" onClick={(e) => { e.preventDefault(); openForm() }}>Open the request form</a></>}</p>}
      {!d.state && (
        <div className="row gap-s mt-s">
          <Btn small kind="primary" icon="check" disabled={busy} onClick={confirm}>{d.kind === 'request' && (missing.length || p.type === 'emergency_leave') ? 'Review & submit' : d.kind === 'reminder' ? 'Confirm & add to calendar' : 'Confirm'}</Btn>
          <Btn small icon="x" disabled={busy} onClick={discard}>Discard</Btn>
          <span className="muted small">Nothing happens until you confirm.</span>
        </div>
      )}
    </div>
  )
}

export default function Assistant() {
  const { session, role, profile, isSuper } = useAuth()
  const me = session?.user.id || ''
  const [st, refresh] = useAiStatus(me)
  const switchOn = useAiSwitchOn()
  const [msgs, setMsgs] = useState<AiMsg[]>(() => (me ? loadChat(me) : []))
  // v1.6.0: 'Ask Assistant' buttons open this page with a question about the page you came from (you still press Send)
  const [text, setText] = useState(() => { try { return new URLSearchParams(window.location.hash.split('?')[1] || '').get('q') || '' } catch { return '' } })
  const [lang, setLang] = useState(initialAiLang)
  const [busy, setBusy] = useState(false)
  const [usage, setUsage] = useState<{ used: number; limit: number } | null>(null)
  const end = useRef<HTMLDivElement>(null)
  const page = useRef<HTMLDivElement>(null)
  useFitHeight(page)
  const sugg = useMemo(() => SUGGEST[groupOf(role)], [role])
  useEffect(() => { if (me) saveChat(me, msgs) }, [me, msgs])
  useEffect(() => { const t = end.current?.parentElement; if (t) t.scrollTo({ top: t.scrollHeight, behavior: 'smooth' }) }, [msgs.length, busy])
  useEffect(() => { if (st?.limit != null) setUsage({ used: st.used || 0, limit: st.limit }) }, [st])
  const first = (profile?.full_name || '').split(' ')[0]

  const ask = async (q: string) => {
    const t = q.trim(); if (!t || busy) return
    const next: AiMsg[] = [...msgs, { role: 'user', text: t, at: new Date().toISOString() }]
    setMsgs(next); setText(''); setBusy(true)
    try {
      const r = await aiChat(next.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text })), lang)
      if (r.disabled) { void refresh(); return }
      setMsgs([...next, { role: 'assistant', text: r.reply || '…', tables: r.tables, drafts: r.drafts, at: new Date().toISOString() }])
      if (r.usage) setUsage(r.usage)
    } catch (e) {
      setMsgs([...next, { role: 'assistant', text: (e as Error).message, error: true, at: new Date().toISOString() }])
      if (/turned off/i.test((e as Error).message)) void refresh()
    } finally { setBusy(false) }
  }
  const lastA = msgs.reduce((a, m, i) => (m.role === 'assistant' ? i : a), -1)
  const setDraft = (mi: number, id: string, state: 'confirmed' | 'discarded', ref?: string) =>
    setMsgs((all) => all.map((m, i) => (i !== mi ? m : { ...m, drafts: m.drafts?.map((d) => (d.id === id ? { ...d, state, ref } : d)) })))

  // 1.6.1: switched off by the CEO (Settings → AI Assistant) — the menus hide it; a saved link lands here
  if (!switchOn || st?.off) return (
    <div className="page narrow" data-testid="ai-off">
      <Empty icon="spark" title="The Assistant is turned off">The Assistant has been turned off by your administrator.{isSuper && <> <Link to="/settings/ai">Turn it on in Settings</Link>.</>}</Empty>
    </div>
  )
  if (!st) return <div className="page narrow"><p className="muted">Loading the assistant…</p></div>
  if (!st.enabled) {
    if (!isSuper) return <div className="page narrow"><Empty icon="spark" title="The assistant is coming soon">Your administrator has not switched it on yet.</Empty></div>
    return (
      <div className="page narrow ai-off-page">
        <h1 className="row gap-s"><Icon name="spark" /> Assistant</h1>
        <Card className="ai-off" title="Assistant not switched on yet">
          <p>Everything is installed and ready. It switches on as soon as an AI provider key is added — no app update needed. Until then it stays hidden from other users.</p>
          <ol className="small">
            <li>Create an API key with your chosen provider (recommended: <strong>Google Gemini</strong>, on a billing-enabled account so your data is not used for training).</li>
            <li>In Supabase → Edge Functions → Secrets, add <code>AI_API_KEY</code> (the key) and, if not Gemini, <code>AI_PROVIDER</code> = <code>openai</code> or <code>anthropic</code>. Optional: <code>AI_MODEL</code>.</li>
            <li>Come back here and press <em>Check again</em>.</li>
          </ol>
          <p className="small muted">The key is kept only on the server. It is never sent to phones or browsers.</p>
          <Btn icon="refresh" onClick={refresh}>Check again</Btn>
        </Card>
      </div>
    )
  }
  return (
    <div className="ai-page ai-fit" ref={page}>
      <div className="ai-head">
        <h1 className="row gap-s"><span className="ai-mark"><Icon name="spark" size={18} /></span> Assistant</h1>
        <div className="spacer" />
        {usage && <span className="muted small ai-count" title="Questions asked today / daily limit">{usage.used}/{usage.limit}<span className="ai-count-t"> today</span></span>}
        <select aria-label="Reply language" className="ai-lang" value={lang} onChange={(e) => { setLang(e.target.value); localStorage.setItem('fwm-ai-lang', e.target.value) }}>{AI_LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}</select>
        {isSuper && <button type="button" className="ai-ib" title="Daily question limit per user" aria-label="Daily question limit per user" onClick={async () => { const v = prompt('Questions per user per day (0 switches the assistant off for everyone):', String(usage?.limit ?? 40)); if (v == null) return; try { await aiSetLimit(Number(v)); await refresh(); toast('Daily limit saved') } catch (e) { toast((e as Error).message, 'err') } }}><Icon name="gear" size={17} /></button>}
        <button type="button" className="ai-ib" title="New chat (clears this conversation on this device)" aria-label="New chat" disabled={!msgs.length} onClick={() => { clearChat(me); setMsgs([]) }}><Icon name="plus" size={17} /></button>
      </div>
      <div className="ai-thread" aria-live="polite">
        {msgs.length === 0 && (
          <div className="ai-hello">
            <div className="ai-orb"><Icon name="spark" size={28} /></div>
            <h2>{first ? `Hi ${first}, how can I help?` : 'How can I help?'}</h2>
            <p className="muted">I look things up with your own access and prepare requests, notes and reminders for you to confirm.</p>
            <div className="ai-chips">{sugg.map((s) => <button key={s} className="ai-chip" onClick={() => ask(s)}>{s}</button>)}</div>
          </div>
        )}
        {msgs.map((m, i) => (
          <Fragment key={i}>
            <div className={`ai-msg ${m.role} ${m.error ? 'is-err' : ''}`}>
              {m.role === 'assistant' && <span className="ai-av"><Icon name="spark" size={14} /></span>}
              <div className="ai-bubble">{m.role === 'user' ? m.text : <Md text={m.text} />}</div>
            </div>
            {(m.tables?.length || m.drafts?.length) ? (
              <div className="ai-extras">
                {m.tables?.map((t, j) => <AiTableView key={j} t={t} open={i === lastA && j === 0} />)}
                {m.drafts?.map((d) => <DraftCard key={d.id} d={d} onDone={(s, ref) => setDraft(i, d.id, s, ref)} />)}
              </div>
            ) : null}
          </Fragment>
        ))}
        {busy && <div className="ai-msg assistant"><span className="ai-av"><Icon name="spark" size={14} /></span><div className="ai-bubble ai-typing"><i /><i /><i /></div></div>}
        <div ref={end} />
      </div>
      <form className="ai-compose" onSubmit={(e) => { e.preventDefault(); void ask(text) }}>
        <textarea rows={1} value={text} placeholder="Ask a question…" aria-label="Message the assistant" disabled={busy}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(text) } }} />
        <button className="ai-send" type="submit" disabled={busy || !text.trim()} aria-label="Send" title="Send"><Icon name="send" size={18} /></button>
      </form>
      <p className="ai-foot muted small">Answers can be wrong — check before you act. Nothing changes without your Confirm.</p>
    </div>
  )
}
