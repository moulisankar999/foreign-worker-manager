import { useNavigate } from 'react-router-dom'
import { Card, Empty } from '../components/ui'
import { DataTable, Details } from '../components/dataTable'
import { Actions, IconAction } from '../components/iconAction'
import { markRead, routeOf, useInbox } from '../lib/inbox'

export default function Inbox() {
  const { items, unread } = useInbox()
  const nav = useNavigate()
  return (
    <div className="page narrow">
      <div className="page-h"><div><h1>Notifications</h1><p className="muted">{unread} unread</p></div>{unread > 0 && <IconAction kind="approve" text label="Mark all read" onClick={() => void markRead()} />}</div>
      <Card>
        {items.length === 0 ? <Empty icon="bell" title="No notifications yet"><p className="muted small">Request updates, tickets booked and passport events appear here.</p></Empty> : (
          <DataTable label="Notifications" className="inbox-t" rows={items} rowKey={(i) => String(i.id)} rowClass={(i) => (i.read_at ? '' : 'is-unread')} initialSort={{ key: 'at', dir: 'desc' }}
            search={(i) => `${i.title || i.event} ${i.body || ''}`} searchLabel="Search notifications"
            filters={[{ key: 'st', label: 'Show', options: [{ value: 'unread', label: 'Unread' }, { value: 'urgent', label: 'Urgent' }], match: (i, v) => (v === 'unread' ? !i.read_at : !!i.critical) }]}
            onOpenChange={(k, o) => { const i = items.find((x) => String(x.id) === k); if (o && i && !i.read_at) void markRead([i.id]) }}
            columns={[
              { key: 'title', label: 'Notification', main: true, sort: (i) => (i.title || i.event || '').toLowerCase(), render: (i) => <>{i.critical ? '🔴 ' : ''}{i.title || i.event}<small className="dt-clip">{i.body}</small></> },
              { key: 'at', label: 'When', hide: 'phone', sort: (i) => i.created_at, render: (i) => <span className="small">{new Date(i.created_at).toLocaleString()}</span> },
            ]}
            actions={(i) => routeOf(i.link) ? <Actions><IconAction kind="view" label="Open" onClick={() => { if (!i.read_at) void markRead([i.id]); const r = routeOf(i.link); if (r) nav(r) }} /></Actions> : null}
            expand={(i) => <Details items={[['When', new Date(i.created_at).toLocaleString()], ['Message', i.body], ['Urgent', i.critical ? 'Yes' : null]]} />} />
        )}
      </Card>
    </div>
  )
}
