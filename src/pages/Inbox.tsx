import { useNavigate } from 'react-router-dom'
import { Btn, Card, Empty } from '../components/ui'
import { markRead, routeOf, useInbox } from '../lib/inbox'

export default function Inbox() {
  const { items, unread } = useInbox()
  const nav = useNavigate()
  return (
    <div className="page narrow">
      <div className="page-h"><div><h1>Notifications</h1><p className="muted">{unread} unread</p></div>{unread > 0 && <Btn small onClick={() => markRead()}>Mark all read</Btn>}</div>
      <Card>
        {items.length === 0 ? <Empty icon="bell" title="No notifications yet"><p className="muted small">Request updates, tickets booked and passport events appear here.</p></Empty> : (
          <ul className="rows inbox">{items.map((i) => (
            <li key={i.id} className={i.read_at ? '' : 'unread'}>
              <button className="inbox-b" onClick={() => { if (!i.read_at) void markRead([i.id]); const r = routeOf(i.link); if (r) nav(r) }}>
                <div className="r-main"><strong>{i.critical ? '🔴 ' : ''}{i.title || i.event}</strong><small>{i.body}</small><small className="muted">{new Date(i.created_at).toLocaleString()}</small></div>
              </button>
            </li>
          ))}</ul>
        )}
      </Card>
    </div>
  )
}
