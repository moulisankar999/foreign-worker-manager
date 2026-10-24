/* Help: what my role is for, FAQ and the user manual — only the content for the signed-in role. */
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { Btn, Card, Tabs } from '../components/ui'
import { Icon } from '../components/Icon'
import { APP_VERSION } from '../lib/platform'
import { openManual } from '../lib/manuals'
import { CHAIN, GROUPS, MANUAL_FILE, ROLE_INFO, ROLE_TITLE, WORKER_MANUAL_FILE, faqsFor, guidesFor, helpRoleOf, type HelpRole } from '../help/content'

type HelpTab = 'role' | 'faq' | 'manual'
const TABS: { id: HelpTab; label: string }[] = [{ id: 'role', label: 'My role' }, { id: 'faq', label: 'FAQ' }, { id: 'manual', label: 'User manual' }]

const norm = (s: string) => s.toLowerCase()

function RoleTab({ r }: { r: HelpRole }) {
  const i = ROLE_INFO[r]
  return (
    <div className="help-grid">
      <Card title={`Your role: ${ROLE_TITLE[r]}`}>
        <p>{i.purpose}</p>
        <div className="help-chain" aria-label="Approval chain">
          {CHAIN.map((c, n) => <span key={c} className={'help-step' + (c.startsWith(ROLE_TITLE[r]) || (r === 'ceo' && c.startsWith('CEO')) ? ' me' : '')}>{n > 0 && <b aria-hidden="true">→</b>}{c}</span>)}
        </div>
        <p className="muted"><strong>Reports to:</strong> {i.reportsTo}</p>
        <p className="muted"><strong>Approvals:</strong> {i.approvals}</p>
      </Card>
      <Card title="What you can see"><ul className="help-list">{i.sees.map((x) => <li key={x}>{x}</li>)}</ul></Card>
      <Card title="What you can do"><ul className="help-list ok">{i.can.map((x) => <li key={x}>{x}</li>)}</ul></Card>
      <Card title="What you cannot do"><ul className="help-list no">{i.cannot.map((x) => <li key={x}>{x}</li>)}</ul></Card>
      <Card title="Every day"><ol className="help-list">{i.daily.map((x) => <li key={x}>{x}</li>)}</ol></Card>
    </div>
  )
}

function FaqTab({ r }: { r: HelpRole }) {
  const [q, setQ] = useState('')
  const all = faqsFor(r)
  const list = q.trim() ? all.filter((f) => norm(f.q + ' ' + f.a).includes(norm(q.trim()))) : all
  return (
    <Card title={`Frequently asked questions (${all.length})`}>
      <input className="help-search" type="search" placeholder="Search the questions…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search FAQ" />
      {list.length === 0 && <p className="muted">No question matches. Try another word, or look in the User manual.</p>}
      <div className="help-faq">
        {list.map((f) => (
          <details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>
        ))}
      </div>
    </Card>
  )
}

function ManualTab({ r, hr }: { r: HelpRole; hr: boolean }) {
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const guides = guidesFor(r)
  const shown = q.trim() ? guides.filter((g) => norm(g.title + ' ' + g.steps.join(' ') + ' ' + (g.intro || '')).includes(norm(q.trim()))) : guides
  const file = MANUAL_FILE[r]
  const open = async (f: string) => {
    setErr(''); setBusy(f)
    try { await openManual(f) } catch (e) { setErr((e as Error).message) } finally { setBusy('') }
  }
  return (
    <>
      <Card title="PDF manual with pictures">
        <p className="muted">The illustrated A4 manual for your role ({ROLE_TITLE[r]}), version {APP_VERSION}. Save it or print it.</p>
        <div className="row gap-s wrap">
          {file && <Btn kind="primary" icon="download" disabled={!!busy} onClick={() => void open(file)}>{busy === file ? 'Opening…' : `Download PDF manual — ${ROLE_TITLE[r]}`}</Btn>}
          {hr && <Btn icon="download" disabled={!!busy} onClick={() => void open(WORKER_MANUAL_FILE)}>{busy === WORKER_MANUAL_FILE ? 'Opening…' : 'FW Worker guide (Tamil / English) — to give workers'}</Btn>}
        </div>
        {!file && <p className="muted">There is no PDF for this role — use the steps below.</p>}
        {err && <p className="err">{err}</p>}
      </Card>
      <Card title={`How to… (${guides.length} tasks)`}>
        <input className="help-search" type="search" placeholder="Search tasks, e.g. PIN, leave, password…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the manual" />
        {GROUPS.map((gname) => {
          const gs = shown.filter((g) => g.group === gname)
          if (!gs.length) return null
          return (
            <section key={gname} className="help-group">
              <h3>{gname}</h3>
              {gs.map((g) => (
                <details key={g.id} className="help-guide" open={!!q.trim() && shown.length <= 3}>
                  <summary>{g.title}</summary>
                  {g.intro && <p className="muted">{g.intro}</p>}
                  <ol>{g.steps.map((s, n) => <li key={n}>{s}</li>)}</ol>
                  {g.tip && <p className="help-call tip"><strong>Tip:</strong> {g.tip}</p>}
                  {g.important && <p className="help-call imp"><strong>Important:</strong> {g.important}</p>}
                </details>
              ))}
            </section>
          )
        })}
        {shown.length === 0 && <p className="muted">Nothing matches.</p>}
      </Card>
    </>
  )
}

export default function HelpPage() {
  const { role, isHr } = useAuth()
  const r = useMemo(() => helpRoleOf(role), [role])
  const params = useParams<{ tab?: string }>()
  const nav = useNavigate()
  const tab: HelpTab = params.tab === 'faq' || params.tab === 'manual' ? params.tab : 'role'
  return (
    <div className="page narrow help-page">
      <div className="page-h"><div><h1><Icon name="help" /> Help</h1><p className="muted">For your role: <strong>{ROLE_TITLE[r]}</strong> · FW Manager {APP_VERSION}</p></div></div>
      <Tabs tabs={TABS} value={tab} onChange={(t) => nav(t === 'role' ? '/help' : `/help/${t}`, { replace: true })} />
      {tab === 'role' && <RoleTab r={r} />}
      {tab === 'faq' && <FaqTab r={r} />}
      {tab === 'manual' && <ManualTab r={r} hr={isHr} />}
    </div>
  )
}
