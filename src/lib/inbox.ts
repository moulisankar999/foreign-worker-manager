import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'

export interface InboxItem { id: number; event: string; title: string | null; body: string | null; link: string | null; created_at: string; read_at: string | null; critical: boolean }
const subs = new Set<() => void>()
let chan: ReturnType<typeof supabase.channel> | null = null
const bump = () => subs.forEach((f) => f())

/** In-app notifications (always on): rows of notification_deliveries with channel = in_app for the signed-in user. */
export function useInbox() {
  const { session } = useAuth()
  const me = session?.user.id
  const [items, setItems] = useState<InboxItem[]>([])
  const [n, setN] = useState(0)
  useEffect(() => {
    const f = () => setN((x) => x + 1)
    subs.add(f)
    if (me && !chan) {
      chan = supabase.channel('inbox-live').on('postgres_changes', { event: '*', schema: 'public', table: 'notification_deliveries', filter: `user_id=eq.${me}` }, bump).subscribe()
    }
    return () => { subs.delete(f) }
  }, [me])
  useEffect(() => {
    if (!me || !navigator.onLine) return
    let off = false
    supabase.from('notification_deliveries').select('id,event,title,body,link,created_at,read_at,critical').eq('user_id', me).eq('channel', 'in_app').order('created_at', { ascending: false }).limit(60)
      .then(({ data }) => { if (!off && data) setItems(data as InboxItem[]) })
    return () => { off = true }
  }, [me, n])
  return { items, unread: items.filter((i) => !i.read_at).length }
}
export async function markRead(ids?: number[]) {
  await supabase.rpc('notify_mark_read', { p_ids: ids ?? null })
  bump()
}
/** link stored as "<appUrl>#/requests/<id>" → in-app route */
export const routeOf = (link?: string | null) => (link && link.includes('#') ? link.slice(link.indexOf('#') + 1) : null)
