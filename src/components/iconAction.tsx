/* IconAction — one small icon button per action, with a label that shows on hover / keyboard focus (desktop)
 * and on long-press or tap (phone / tablet). Same icon for the same meaning everywhere in the app.
 * Destructive actions (delete, reject, revoke, pause, reset) are tinted red / amber; their confirmation step stays. */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

export type ActionKind =
  | 'delete' | 'reject' | 'approve' | 'reset' | 'pause' | 'resume' | 'revoke' | 'edit' | 'assign' | 'escalate'
  | 'recall' | 'unlock' | 'view' | 'download' | 'print' | 'upload' | 'add' | 'close' | 'refresh' | 'send' | 'copy' | 'scope' | 'more' | 'depart'

type Tone = 'danger' | 'warn' | 'ok' | 'pri' | 'plain'
/** one icon + tone per meaning (the README lists them) */
export const ACTIONS: Record<ActionKind, { icon: string; tone: Tone; label: string }> = {
  delete: { icon: 'trash', tone: 'danger', label: 'Delete' },
  reject: { icon: 'xcircle', tone: 'danger', label: 'Reject' },
  revoke: { icon: 'ban', tone: 'danger', label: 'Revoke' },
  pause: { icon: 'pause', tone: 'warn', label: 'Pause' },
  reset: { icon: 'key', tone: 'warn', label: 'Reset password' },
  recall: { icon: 'undo', tone: 'warn', label: 'Recall' },
  unlock: { icon: 'lock', tone: 'plain', label: 'Unlock' },
  approve: { icon: 'check', tone: 'ok', label: 'Approve' },
  resume: { icon: 'play', tone: 'ok', label: 'Resume' },
  edit: { icon: 'edit', tone: 'plain', label: 'Edit' },
  assign: { icon: 'userplus', tone: 'plain', label: 'Assign' },
  escalate: { icon: 'arrowup', tone: 'plain', label: 'Escalate' },
  view: { icon: 'eye', tone: 'plain', label: 'Open' },
  download: { icon: 'download', tone: 'plain', label: 'Download' },
  print: { icon: 'print', tone: 'plain', label: 'Print' },
  upload: { icon: 'upload', tone: 'plain', label: 'Upload' },
  add: { icon: 'plus', tone: 'pri', label: 'Add' },
  close: { icon: 'x', tone: 'plain', label: 'Close' },
  refresh: { icon: 'refresh', tone: 'plain', label: 'Refresh' },
  send: { icon: 'send', tone: 'plain', label: 'Send' },
  copy: { icon: 'copy', tone: 'plain', label: 'Copy' },
  scope: { icon: 'store', tone: 'plain', label: 'Companies / outlets' },
  more: { icon: 'more', tone: 'plain', label: 'More' },
  depart: { icon: 'plane', tone: 'plain', label: 'Check out' },
}

/** fixed-position tooltip in a portal so a table cell or card never clips it */
export function Tooltip({ anchor, text, id }: { anchor: HTMLElement | null; text: ReactNode; id: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null)
  useEffect(() => {
    if (!anchor) return
    const place = () => {
      const r = anchor.getBoundingClientRect()
      const w = ref.current?.offsetWidth || 120, h = ref.current?.offsetHeight || 30
      const below = r.top - h - 8 < 8
      const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8)
      setPos({ left, top: below ? r.bottom + 8 : r.top - h - 8, below })
    }
    place()
    const raf = requestAnimationFrame(place)
    window.addEventListener('scroll', place, true); window.addEventListener('resize', place)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place) }
  }, [anchor, text])
  if (!anchor) return null
  return createPortal(
    <div ref={ref} id={id} role="tooltip" className={`tip${pos?.below ? ' tip-below' : ''}`} style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}>{text}</div>,
    document.body,
  )
}

/** shared hover / focus / long-press behaviour; returns props for the trigger element */
export function useTip(label: string) {
  const id = useId()
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [show, setShow] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const hideT = useRef<number | undefined>(undefined)
  const long = useRef(false)
  const touchAt = useRef(0)
  useEffect(() => () => { clearTimeout(timer.current); clearTimeout(hideT.current) }, [])
  useEffect(() => {
    if (!show) return
    const off = (e: Event) => { if (el && !el.contains(e.target as Node)) setShow(false) }
    document.addEventListener('pointerdown', off, true)
    return () => document.removeEventListener('pointerdown', off, true)
  }, [show, el])
  const flash = (ms: number) => { setShow(true); clearTimeout(hideT.current); hideT.current = window.setTimeout(() => setShow(false), ms) }
  return {
    show, id, el,
    props: {
      ref: setEl,
      'aria-describedby': show ? id : undefined,
      // the native title is the fallback; hidden while our own tooltip is on screen so the two never double up
      title: show ? undefined : label,
      onMouseEnter: () => { if (Date.now() - touchAt.current > 800) { clearTimeout(timer.current); timer.current = window.setTimeout(() => setShow(true), 250) } },
      onMouseLeave: () => { clearTimeout(timer.current); setShow(false) },
      onFocus: (e: React.FocusEvent<HTMLElement>) => { if (e.target.matches(':focus-visible')) setShow(true) },
      onBlur: () => setShow(false),
      onTouchStart: () => {
        touchAt.current = Date.now(); long.current = false; clearTimeout(timer.current)
        timer.current = window.setTimeout(() => { long.current = true; flash(2200); navigator.vibrate?.(10) }, 450)
      },
      onTouchEnd: () => { touchAt.current = Date.now(); clearTimeout(timer.current); if (!long.current) flash(1400) }, // a tap also names the button
      onTouchMove: () => clearTimeout(timer.current),
      onContextMenu: (e: React.MouseEvent) => { if (Date.now() - touchAt.current < 1500) e.preventDefault() },
    },
    /** true once if the last touch was a long-press (the press only shows the label, it does not act) */
    takeLong: () => { const l = long.current; long.current = false; return l },
    flash,
  }
}

export function IconAction({ kind, label, onClick, disabled, confirm: confirmText, href, download, testId, text, tone }: {
  kind: ActionKind
  /** what this button does, in words — shown in the tooltip and read by screen readers (defaults to the kind's label) */
  label?: string
  onClick?: () => void
  disabled?: boolean
  /** ask before acting (destructive actions that have no dialog of their own) */
  confirm?: string
  href?: string
  download?: string
  testId?: string
  /** also show the label next to the icon (used inside expanded rows and on wide screens) */
  text?: boolean
  tone?: Tone
}) {
  const a = ACTIONS[kind]
  const lbl = label || a.label
  const tip = useTip(lbl)
  const cls = `ia ia-${tone || a.tone}${text ? ' ia-text' : ''}`
  const act = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (tip.takeLong()) { e.preventDefault(); return }
    if (confirmText && !window.confirm(confirmText)) { e.preventDefault(); return }
    onClick?.()
  }
  const inner = <><Icon name={a.icon} size={17} /><span className="ia-lbl">{lbl}</span></>
  // the label is already on screen for text buttons and inside expanded rows, so no tooltip there
  const tipOn = tip.show && !text && !tip.el?.closest('.dt-x-act')
  return (
    <>
      {href ? (
        <a {...tip.props} className={cls} href={disabled ? undefined : href} download={download} aria-label={lbl} aria-describedby={tipOn ? tip.id : undefined} aria-disabled={disabled || undefined}
          target={download || href.startsWith('#') ? undefined : '_blank'} rel="noopener" data-testid={testId} data-action={kind} onClick={act}>{inner}</a>
      ) : (
        <button {...tip.props} type="button" className={cls} disabled={disabled} aria-label={lbl} aria-describedby={tipOn ? tip.id : undefined} data-testid={testId} data-action={kind} onClick={act}>{inner}</button>
      )}
      {tipOn && <Tooltip anchor={tip.el} text={lbl} id={tip.id} />}
    </>
  )
}

/** a row of IconActions */
export function Actions({ children }: { children: ReactNode }) {
  return <div className="ia-row" onClick={(e) => e.stopPropagation()}>{children}</div>
}
