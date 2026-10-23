/* Small toast messages ("Updated ✓ …") shown at the bottom of the screen; announced to screen readers. */
import { useEffect, useState } from 'react'

type T = { id: number; text: string; tone: 'ok' | 'err' }
let push: ((t: T) => void) | null = null
let n = 0
export function toast(text: string, tone: 'ok' | 'err' = 'ok') { push?.({ id: ++n, text, tone }) }

export function Toaster() {
  const [items, setItems] = useState<T[]>([])
  useEffect(() => {
    push = (t) => {
      setItems((x) => [...x.slice(-2), t])
      window.setTimeout(() => setItems((x) => x.filter((y) => y.id !== t.id)), t.tone === 'err' ? 8000 : 4500)
    }
    return () => { push = null }
  }, [])
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => <div key={t.id} className={`toast toast-${t.tone}`} onClick={() => setItems((x) => x.filter((y) => y.id !== t.id))}>{t.text}</div>)}
    </div>
  )
}

/* Unsaved-changes guard (HashRouter has no blocker): forms register a dirty flag; leaving the page asks first. */
const dirty = new Map<string, { label: string; home: string }>()
let installed = false
let lastHash = ''
function install() {
  if (installed) return
  installed = true
  lastHash = window.location.hash
  window.addEventListener('beforeunload', (e) => { if (dirty.size) { e.preventDefault(); e.returnValue = '' } })
  window.addEventListener('hashchange', () => {
    const now = window.location.hash
    if (dirty.size) {
      const homes = new Set([...dirty.values()].map((d) => d.home))
      if (![...homes].some((h) => now.startsWith(h))) {
        const what = [...dirty.values()].map((d) => d.label).join(', ')
        if (!window.confirm(`You have unsaved changes (${what}).\n\nLeave without saving? Press Cancel to go back and click “Update”.`)) {
          window.location.hash = lastHash
          return
        }
        dirty.clear()
      }
    }
    lastHash = now
  })
}
export function setDirty(key: string, on: boolean, label = 'unsaved changes', home = window.location.hash.split('?')[0]) {
  install()
  if (on) dirty.set(key, { label, home }); else dirty.delete(key)
}
export const hasDirty = () => dirty.size > 0
