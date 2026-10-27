import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { VaultPanel } from '../components/vault'
import { CheckStatusPanel } from '../components/agencies'
import { PassportPanel, RemarksPanel, WorkerRequests } from '../components/workerExtras'
import { AppAccessPanel } from '../components/appAccess'
import { useAuth } from '../lib/auth'
import { CONSENT_LABEL, CONSENT_TONE, consentOf, overdueDays } from '../lib/passport'
import { Avatar, Btn, Card, Chip, Empty, FormModal, KV, Tabs, docTone, sevTone, statusTone, Skeleton } from '../components/ui'
import { ContractTab, DocumentsTab, FamilyTab, LeaveTab, LoansTab, MemoEditor, MemosTab, NotesTab, PayTab, setStatus } from '../components/sections'
import { db } from '../lib/db'
import { RemittanceTab } from '../components/remittance'
import { ComplianceTab } from '../components/workerCompliance'
import { completeness, fmtPhone } from '../lib/validate'
import { LogoImg } from '../components/logos'
import { outletLogo } from '../lib/logos'
import { allowancesTotal, buildAlerts, currentBasic, currentDocs, docStatus, isExited, leaveBalanceNow, minContractEnd, outletName, outstanding, ticketInfo } from '../lib/calc'
import { useOutlets, useSettings } from '../lib/hooks'
import { buildICS } from '../lib/ics'
import { STATUSES, type MemoRec, type WorkerStatus } from '../lib/types'
import { missingLanguage, otherLanguagesText, primaryLangName } from '../lib/languages'
import { DataTable, usePaged } from '../components/dataTable'
import { age, download, fmtDate, rm, serviceText, todayISO } from '../lib/util'

type Tab = 'access' | 'overview' | 'checks' | 'vault' | 'requests' | 'passport' | 'remarks' | 'docs' | 'remit' | 'family' | 'contract' | 'pay' | 'loans' | 'leave' | 'memos' | 'notes' | 'trackers'

export default function WorkerDetail() {
  const { id } = useParams()
  const w = useLiveQuery(() => db.workers.get(id || ''), [id])
  const s = useSettings()
  const outlets = useOutlets()
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const { canWrite, canSeeSalary, isHr } = useAuth()
  const tab = (sp.get('tab') as Tab) || 'overview'
  const setTab = (t: Tab) => setSp({ tab: t }, { replace: true })
  const [statusEdit, setStatusEdit] = useState(false)
  const [memo, setMemo] = useState<Partial<MemoRec> | null>(null)

  if (w === undefined) return <div className="page"><Skeleton kind="page" rows={6} /></div>
  if (!w) return <div className="page"><Empty title="Worker not found"><Btn onClick={() => nav('/workers')}>Back to workers</Btn></Empty></div>

  const alerts = buildAlerts([w], s)
  const t = ticketInfo(w, s)
  const docs = currentDocs(w)
  const consent = consentOf(w)
  const comp = completeness(w, outlets)
  const allTabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'overview', label: 'Overview', badge: alerts.filter((a) => a.severity === 'critical' || a.severity === 'high').length },
    { id: 'requests', label: 'Requests' },
    { id: 'vault', label: 'Vault' },
    { id: 'passport', label: 'Passport', badge: (consent === 'pending' || consent === 'uploaded' ? 1 : 0) + (overdueDays(w) > 0 ? 1 : 0) },
    { id: 'remarks', label: 'Remarks' },
    ...(isHr ? [{ id: 'checks' as Tab, label: 'Check status' }] : []),
    { id: 'docs', label: 'Expiry docs', badge: docs.filter((d) => docStatus(d, s) !== 'Valid' && docStatus(d, s) !== 'No expiry').length },
    { id: 'leave', label: 'Leave & ticket' },
    { id: 'contract', label: 'Contract & exit' },
    { id: 'trackers', label: 'Compliance', badge: alerts.filter((a) => (a.severity === 'critical' || a.severity === 'high') && ['Absconding', 'Exit', '10-year stay', 'Recruitment cost', 'PLKS renewal'].includes(a.category)).length },
    { id: 'pay', label: 'Pay' },
    { id: 'loans', label: 'Loans' },
    { id: 'family', label: 'Family & address' },
    ...(isHr ? [{ id: 'remit' as Tab, label: 'Remittance' }] : []),
    { id: 'memos', label: 'Memos', badge: w.memos.filter((m) => m.checklist.some((c) => !c.done)).length },
    { id: 'notes', label: 'Timeline' },
    ...(isHr ? [{ id: 'access' as Tab, label: '📱 App access' }] : []), // CEO / GM / HR Admin / HR Manager only (server-enforced too)
  ]
  // outlet managers / viewers: read-only, no pay data
  const tabs = canWrite ? allTabs : allTabs.filter((x) => ['overview', 'requests', 'vault', 'passport', 'remarks', 'checks', 'notes'].includes(x.id))
  const p = { w, s }
  return (
    <div className="page">
      <div className="page-h">
        <div className="row gap-s"><Btn kind="ghost" icon="back" onClick={() => nav(-1)} title="Back" /><h1 className="sr-m">Worker</h1></div>
        <div className="row gap-s wrap">
          <Btn small icon="cal" onClick={() => download(`${w.workerNo}-expiries.ics`, buildICS(buildAlerts([w], { ...s, leadTimes: [100000] }).filter((a) => a.date), Math.max(...s.leadTimes)), 'text/calendar')}>Calendar</Btn>
          {canWrite && <Btn small icon="edit" onClick={() => nav(`/workers/${w.id}/edit`)}>Edit</Btn>}
        </div>
      </div>
      <Card className="hero">
        <div className="hero-r">
          <Avatar name={w.fullName} photo={w.photo} size={72} />
          <div className="grow">
            <h2 className="row gap-s">{w.fullName}<LogoImg path={outletLogo(outlets.find((o) => o.id === w.outletId))} size={28} fallback={false} /></h2>
            <p className="muted">{w.workerNo} · {w.nationality} · {w.jobCategory || '—'} ({w.skillLevel || '—'})</p>
            <p className="muted">{outletName(outlets, w.outletId)} · {w.businessType || '—'} · {serviceText(w.joinDate, w.exitDate)} service</p>
            <div className="row gap-s wrap mt-s">
              {canWrite ? <button className="chip-btn" onClick={() => setStatusEdit(true)} aria-label="Change status"><Chip tone={statusTone(w.status)}>{w.status} ▾</Chip></button> : <Chip tone={statusTone(w.status)}>{w.status}</Chip>}
              {consent !== 'signed' && <button className="chip-btn" onClick={() => setTab('passport')}><Chip tone={CONSENT_TONE[consent]}>🛂 {CONSENT_LABEL[consent]}</Chip></button>}
              {missingLanguage(w) && (canWrite ? <button className="chip-btn" onClick={() => nav(`/workers/${w.id}/edit`)} aria-label="Add language"><Chip tone="amber">🗣️ Language missing</Chip></button> : <Chip tone="amber">🗣️ Language missing</Chip>)}
              {t.eligible && <Chip tone="purple">✈ Ticket ×{t.balance}</Chip>}
              {canSeeSalary && outstanding(w) > 0 && <Chip tone="amber">Loan {rm(outstanding(w))}</Chip>}
              {!comp.complete && (canWrite ? <button className="chip-btn" onClick={() => nav(`/workers/${w.id}/edit`)} title={`Missing: ${comp.missing.map((m) => m.label).join(', ')}`}><Chip tone="red">📝 Draft / Incomplete · {comp.done} of {comp.total}</Chip></button> : <Chip tone="red">📝 Incomplete profile</Chip>)}
              {w.phoneMY && <a className="chip chip-gray" href={`tel:${w.phoneMY}`}>📞 {fmtPhone(w.phoneMY)}</a>}
            </div>
          </div>
        </div>
      </Card>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'overview' && (
        <>
          {alerts.length > 0 && (
            <WorkerAlerts alerts={alerts} />
          )}
          <div className="grid2">
            <Card title="Documents" actions={canWrite && <button className="link" onClick={() => setTab('docs')}>Manage →</button>}>
              {docs.length === 0 ? <p className="muted">No documents</p> : (
                <DataTable label="Documents" dense rows={docs} rowKey={(d) => d.id} canExpand={() => false}
                  rowClass={(d) => { const st = docTone(docStatus(d, s)); return st === 'red' ? 'dt-bad' : st === 'amber' || st === 'orange' ? 'dt-warn' : '' }}
                  columns={[
                    { key: 't', label: 'Document', main: true, render: (d) => <>{d.type === 'Other' ? d.label : d.type}{d.number ? <small className="muted"> {d.number}</small> : null}</> },
                    { key: 'e', label: 'Expiry', sort: (d) => d.expiryDate || '', render: (d) => fmtDate(d.expiryDate) },
                    { key: 's', label: 'Status', render: (d) => <Chip tone={docTone(docStatus(d, s))}>{docStatus(d, s)}</Chip> },
                  ]} />
              )}
            </Card>
            <Card title="Summary">
              <KV items={[
                ...(canSeeSalary ? [['Basic + allowances', `${rm(currentBasic(w))} + ${rm(allowancesTotal(w))}`] as [string, string]] : []),
                ['Annual leave balance', `${leaveBalanceNow(w, s)} days`],
                ['Flight ticket', t.eligible ? `Eligible ×${t.balance} (${rm(t.value)})` : `Next on ${fmtDate(t.nextDate)}`],
                ['Contract', `${fmtDate(w.contractStart)} → ${fmtDate(w.contractEnd)}`],
                ['Min. contract ends', fmtDate(minContractEnd(w))],
                ...(canSeeSalary ? [['Outstanding loan', rm(outstanding(w))] as [string, string]] : []),
              ]} />
            </Card>
            <Card title="Personal">
              <KV items={[
                ['Date of birth', w.dob ? `${fmtDate(w.dob)} (${age(w.dob)} yrs)` : '—'], ['Gender', w.gender], ['Religion', w.religion],
                ['Primary language', missingLanguage(w) ? '— missing' : `${primaryLangName(w)} (speaks${w.primaryRead ? ' · reads' : ''}${w.primaryWrite ? ' · writes' : ''})`],
                ['Other languages', otherLanguagesText(w) || '—'],
                ['Phone (MY)', w.phoneMY && fmtPhone(w.phoneMY)], ['Phone (home)', w.phoneHome && fmtPhone(w.phoneHome)], ['Join date', fmtDate(w.joinDate)], ['Agent', w.agent],
                ['Next of kin', w.family.filter((f) => f.isNextOfKin).map((f) => `${f.name} (${f.relation}) ${f.phone || ''}`).join(', ')],
              ]} />
            </Card>
            {!canWrite ? (
              <Card title="Quick requests">
                <div className="quick small-q">
                  {[['annual_leave', '🏖️', 'Annual leave'], ['emergency_leave', '🚨', 'Emergency leave'], ['medical_leave', '🤒', 'MC'], ['salary_advance', '💵', 'Salary advance'], ['passport', '🛂', 'Passport'], ['update_details', '📇', 'Update details']].map(([k, i, l]) => (
                    <button key={k} onClick={() => nav(`/requests/new?type=${k}&worker=${w.id}`)}><span>{i}</span>{l}</button>
                  ))}
                </div>
              </Card>
            ) : <Card title="Quick actions">
              <div className="quick small-q">
                <button onClick={() => setTab('leave')}><span>🏖️</span>Apply leave</button>
                <button onClick={() => setMemo({ kind: 'Home Leave Checkout' })}><span>🧳</span>Checkout memo</button>
                <button onClick={() => setTab('docs')}><span>🛂</span>Renew document</button>
                <button onClick={() => setTab('loans')}><span>💵</span>Loan / advance</button>
                <button onClick={() => setTab('pay')}><span>📈</span>Increment</button>
                {!isExited(w) && <button onClick={() => setTab('contract')}><span>🚪</span>Process exit</button>}
                <button onClick={() => nav(`/requests/new?worker=${w.id}`)}><span>📝</span>New request</button>
              </div>
            </Card>}
          </div>
        </>
      )}
      {tab === 'requests' && <WorkerRequests w={w} />}
      {tab === 'access' && isHr && <AppAccessPanel w={w} />}
      {tab === 'vault' && <VaultPanel workerId={w.id} />}
      {tab === 'passport' && <PassportPanel w={w} />}
      {tab === 'remarks' && <RemarksPanel w={w} />}
      {isHr && tab === 'checks' && <CheckStatusPanel w={w} />}
      {canWrite && tab === 'docs' && <DocumentsTab {...p} />}
      {canWrite && tab === 'family' && <FamilyTab {...p} />}
      {isHr && tab === 'remit' && <RemittanceTab w={w} />}
      {canWrite && tab === 'contract' && <ContractTab {...p} />}
      {canWrite && tab === 'trackers' && <ComplianceTab w={w} />}
      {canWrite && tab === 'pay' && <PayTab {...p} />}
      {canWrite && tab === 'loans' && <LoansTab {...p} />}
      {canWrite && tab === 'leave' && <LeaveTab {...p} openMemo={setMemo} />}
      {canWrite && tab === 'memos' && <MemosTab {...p} openMemo={setMemo} />}
      {tab === 'notes' && <NotesTab {...p} />}

      {memo && <MemoEditor w={w} init={memo} onClose={() => setMemo(null)} />}
      {statusEdit && (
        <FormModal title="Change employment status" initial={{ status: w.status, date: todayISO() }} onClose={() => setStatusEdit(false)}
          fields={[{ key: 'status', label: 'New status', type: 'select', options: [...STATUSES], required: true }, { key: 'date', label: 'Effective date', type: 'date', required: true }, { key: 'remarks', label: 'Remarks', type: 'textarea' }]}
          onSave={(v) => setStatus(w, v.status as WorkerStatus, v.date as string, v.remarks as string)}>
          {(v) => ['Resigned', 'Terminated', 'Contract Ended', 'Repatriated'].includes(String(v.status)) ? <p className="warn small">Tip: use <strong>Contract & exit → Process exit</strong> to also compute the prorated penalty and generate the exit clearance memo.</p> : null}
        </FormModal>
      )}
    </div>
  )
}

/** 1.5.1: the worker's alerts as a folding card, 4 per page (no long scroll on a phone). */
function WorkerAlerts({ alerts }: { alerts: ReturnType<typeof buildAlerts> }) {
  const pg = usePaged(alerts, 4)
  return (
    <Card fold="open" title={<>Alerts for this worker <Chip tone="amber">{alerts.length}</Chip></>}>
      <ul className="alist">{pg.rows.map((a) => <li key={a.id}><div><Chip tone={sevTone(a.severity)}>{a.severity}</Chip><span className="al-t"><strong>{a.title}</strong><small>{a.detail}</small></span></div></li>)}</ul>
      {pg.pager('Alerts for this worker')}
    </Card>
  )
}
