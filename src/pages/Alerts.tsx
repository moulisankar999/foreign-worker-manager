import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Btn, Card, Chip, Empty, SelectFilter, Toolbar, sevTone } from '../components/ui'
import { SEVERITY_ORDER, outletName, type Alert } from '../lib/calc'
import { useAlerts, useOutlets, useSettings } from '../lib/hooks'
import { buildICS } from '../lib/ics'
import { notifyOnOpen, notifySupported, requestNotify } from '../lib/notify'
import { BUSINESS_TYPES } from '../lib/types'
import { usePaged } from '../components/dataTable'
import { download, fmtDate, toCSV, todayISO } from '../lib/util'

export default function Alerts() {
  const all = useAlerts()
  const outlets = useOutlets()
  const s = useSettings()
  const [sp, setSp] = useSearchParams()
  const [cat, setCat] = useState(sp.get('cat') || '')
  const [outlet, setOutlet] = useState('')
  const [type, setType] = useState('')
  const sev = sp.get('sev') || ''
  const [perm, setPerm] = useState(notifySupported() ? Notification.permission : 'unsupported')

  const cats = useMemo(() => Array.from(new Set(all.map((a) => a.category))).sort(), [all])
  const list = all.filter((a) => (!cat || a.category === cat) && (!outlet || a.outletId === outlet) && (!type || a.businessType === type) && (!sev || a.severity === sev))
  const paged = usePaged(list, 20, `${cat}|${outlet}|${type}|${sev}`)
  const counts = SEVERITY_ORDER.map((x) => ({ x, n: all.filter((a) => a.severity === x).length }))
  const exportICS = (rows: Alert[]) => download(`worker-expiries-${todayISO()}.ics`, buildICS(rows.filter((a) => a.date), Math.max(...s.leadTimes)), 'text/calendar')

  return (
    <div className="page">
      <div className="page-h">
        <div><h1>Alerts</h1><p className="muted">Lead times: {[...s.leadTimes].sort((a, b) => b - a).join(' / ')} days</p></div>
        <div className="row gap-s wrap">
          {perm !== 'granted' && perm !== 'unsupported' && <Btn icon="bell" onClick={async () => setPerm(await requestNotify())}>Enable notifications</Btn>}
          {perm === 'granted' && <Btn small icon="bell" onClick={() => notifyOnOpen(all, true)}>Test notification</Btn>}
          <Btn small icon="cal" onClick={() => exportICS(list)}>Export .ics</Btn>
          <Btn small icon="download" onClick={() => download(`alerts-${todayISO()}.csv`, toCSV(list.map((a) => ({ Severity: a.severity, Category: a.category, Worker: a.workerName, 'Worker ID': a.workerNo, Outlet: outletName(outlets, a.outletId), Alert: a.title, Detail: a.detail, Date: fmtDate(a.date), 'Days left': a.days ?? '' }))), 'text/csv')}>CSV</Btn>
        </div>
      </div>
      <div className="sevbar">
        {counts.map(({ x, n }) => (
          <button key={x} className={`sev sev-${sevTone(x)} ${sev === x ? 'on' : ''}`} onClick={() => setSp(sev === x ? {} : { sev: x }, { replace: true })}>
            <strong>{n}</strong><span>{x}</span>
          </button>
        ))}
      </div>
      <Toolbar>
        <SelectFilter label="Category" value={cat} onChange={setCat} options={cats} />
        <SelectFilter label="Outlet" value={outlet} onChange={setOutlet} options={outlets.map((o) => ({ value: o.id, label: o.name }))} />
        <SelectFilter label="Business" value={type} onChange={setType} options={[...BUSINESS_TYPES]} />
      </Toolbar>
      <Card>
        {list.length === 0 ? <Empty icon="check" title="No alerts here" /> : (
          <ul className="alist big">
            {paged.rows.map((a) => (
              <li key={a.id}>
                <Link to={`/workers/${a.workerId}`}>
                  <Chip tone={sevTone(a.severity)}>{a.days !== null ? (a.days < 0 ? `${-a.days}d late` : `${a.days}d`) : a.severity}</Chip>
                  <span className="al-t"><strong>{a.title}</strong><small>{a.workerName} · {a.workerNo} · {outletName(outlets, a.outletId)}</small><small className="muted">{a.category} — {a.detail}</small></span>
                </Link>
                {a.date && <Btn small kind="ghost" icon="cal" title="Add to calendar" onClick={() => exportICS([a])} />}
              </li>
            ))}
          </ul>
        )}
        {paged.pager('Alerts')}
      </Card>
    </div>
  )
}
