/* Arrivals: flights in the next weeks, beds needed against hostel capacity, and post-arrival deadlines (FOMEMA within 30 days, PLKS). */
import { Link, useNavigate } from 'react-router-dom'
import { Card, Chip, Empty, Stat } from '../../components/ui'
import { DataTable } from '../../components/dataTable'
import { Actions, IconAction } from '../../components/iconAction'
import { useConfig } from '../../lib/config'
import { useWorkers } from '../../lib/hooks'
import { daysUntil, fmtDate, todayISO } from '../../lib/util'
import { inCompany, addDaysISO, atMyt, useQuota, type Recruit } from '../../lib/quota'
import { useQCtx } from './shared'

export function ArrivalsTab({ company }: { company: string }) {
  const ctx = useQCtx()
  const nav = useNavigate()
  const cfg = useConfig()
  const d = useQuota()
  const workers = useWorkers()
  const today = todayISO()
  const live = d.recruits.filter((r) => r.status === 'active' && (inCompany(company, r.company_id)))
  const coming = live.filter((r) => r.flight_at && !r.arrived_at).sort((a, b) => (a.flight_at! < b.flight_at! ? -1 : 1))
  const arrived = live.filter((r) => r.arrived_at)
  const in30 = coming.filter((r) => (daysUntil(r.flight_at!.slice(0, 10)) ?? 0) <= 30)
  const hostels = cfg.hostels.items.filter((h) => !h.archived && (!company || !h.companyId || h.companyId === company))
  const beds = hostels.map((h) => {
    const occ = workers.filter((w) => w.hostelId === h.id && !['Absconded', 'Resigned', 'Terminated', 'Contract Ended', 'Repatriated'].includes(w.status)).length
    const inc = coming.filter((r) => (r.hostel_id || d.batches.find((b) => b.id === r.batch_id)?.hostel_id) === h.id).length
    return { h, occ, inc, cap: h.capacity || 0, free: (h.capacity || 0) - occ - inc }
  })
  const noBed = coming.filter((r) => !(r.hostel_id || d.batches.find((b) => b.id === r.batch_id)?.hostel_id)).length
  const fomema = (r: Recruit) => addDaysISO(r.arrived_at!.slice(0, 10), 30)
  return (
    <div className="qr-grid">
      <div className="stats">
        <Stat label="Flights in 30 days" value={in30.length} icon="plane" tone="blue" />
        <Stat label="Arrived, not converted" value={arrived.length} icon="users" />
        <Stat label="No hostel assigned" value={noBed} tone={noBed ? 'amber' : 'teal'} icon="home" />
        <Stat label="FOMEMA overdue" value={arrived.filter((r) => !r.steps?.fomema?.done && fomema(r) < today).length} tone="red" icon="alert" />
      </div>
      <Card title="Upcoming arrivals">
        <DataTable label="Upcoming arrivals" rows={coming} rowKey={(r) => r.id}
          columns={[
            { key: 'f', label: 'Flight (MYT)', render: (r) => <>{atMyt(r.flight_at)}<br /><small className="muted">{r.flight_no} · {r.airport}</small></>, sort: (r) => r.flight_at || '' },
            { key: 'n', label: 'Recruit', main: true, render: (r) => <Link to={`/quota/recruit/${r.id}`}>{r.full_name}</Link> },
            { key: 'c', label: 'Country', hide: 'phone', render: (r) => r.country },
            { key: 'p', label: 'Pick-up', hide: 'tablet', render: (r) => r.pickup_by || <Chip tone="amber">Not set</Chip> },
            { key: 'a', label: 'Airport letter', render: (r) => r.steps?.airport_letter?.done ? <Chip tone="green">Printed</Chip> : <Chip tone={(daysUntil(r.flight_at!.slice(0, 10)) ?? 0) <= 3 ? 'red' : 'amber'}>To print</Chip> },
          ]}
          actions={(r) => <Actions><IconAction kind="view" label="Open recruit" onClick={() => nav(`/quota/recruit/${r.id}`)} /></Actions>}
          empty={<Empty title="No flights booked">Set the flight on a recruit — HR is told at once to prepare the hostel.</Empty>} />
      </Card>
      <Card title="Accommodation estimator">
        <div className="note-box">Beds needed = workers living there now + recruits on their way. Act 446 needs a valid Certificate for Accommodation before anyone moves in.{noBed > 0 && <> <b>{noBed}</b> incoming recruit(s) have no hostel yet.</>}</div>
        <DataTable label="Hostels" dense rows={beds} rowKey={(b) => b.h.id}
          columns={[
            { key: 'h', label: 'Hostel', main: true, render: (b) => <>{b.h.name}<br /><small className="muted">{b.h.certExpiry ? `CfA to ${fmtDate(b.h.certExpiry)}` : 'No CfA recorded'}</small></> },
            { key: 'c', label: 'Capacity', align: 'right', hide: 'phone', render: (b) => b.cap || '—' }, { key: 'o', label: 'Now', align: 'right', render: (b) => b.occ },
            { key: 'i', label: 'Incoming', align: 'right', render: (b) => b.inc },
            { key: 'f', label: 'Free after', align: 'right', render: (b) => b.cap ? <Chip tone={b.free < 0 ? 'red' : b.free < 3 ? 'amber' : 'green'}>{b.free}</Chip> : '—' },
          ]} empty={<Empty title="No hostels">Add hostels in the Hostels register.</Empty>} />
      </Card>
      <Card title="After arrival">
        <DataTable label="After arrival" rows={arrived} rowKey={(r) => r.id} rowClass={(r) => (!r.steps?.fomema?.done && fomema(r) < today ? 'row-bad' : '')}
          columns={[
            { key: 'n', label: 'Recruit', main: true, render: (r) => <Link to={`/quota/recruit/${r.id}`}>{r.full_name}</Link> },
            { key: 'a', label: 'Arrived', render: (r) => fmtDate(r.arrived_at!.slice(0, 10)), sort: (r) => r.arrived_at || '' },
            { key: 'f', label: 'FOMEMA', render: (r) => r.steps?.fomema?.done ? <Chip tone="green">Done</Chip> : <Chip tone={fomema(r) < today ? 'red' : 'amber'}>By {fmtDate(fomema(r))}</Chip> },
            { key: 'p', label: 'PLKS', hide: 'phone', render: (r) => r.steps?.plks?.done ? <Chip tone="green">Issued</Chip> : <Chip tone="amber">Pending</Chip> },
            { key: 'b', label: 'SIM / bank', hide: 'tablet', render: (r) => `${r.steps?.sim?.done ? '✓' : '—'} / ${r.steps?.bank?.done ? '✓' : '—'}` },
          ]}
          actions={(r) => <Actions><IconAction kind="view" label="Open recruit" onClick={() => nav(`/quota/recruit/${r.id}`)} /></Actions>}
          empty={<Empty title="Nobody waiting">Arrived recruits stay here until converted to workers.</Empty>} />
      </Card>
      <small className="muted">{ctx.cName(company) || 'All companies'}</small>
    </div>
  )
}
