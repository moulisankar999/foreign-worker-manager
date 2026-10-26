/* v1.6.0 data visuals: count-up numbers, progress ring, donut, sparkline. Plain SVG, no library; respects reduced motion. */
import { useEffect, useRef, useState } from 'react'

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function CountUp({ value, ms = 700 }: { value: number; ms?: number }) {
  const [v, setV] = useState(reduced() ? value : 0)
  const from = useRef(0)
  useEffect(() => {
    if (reduced()) { setV(value); return }
    const a = from.current, t0 = performance.now(); let raf = 0
    const step = (t: number) => { const p = Math.min(1, (t - t0) / ms); const e = 1 - Math.pow(1 - p, 3); setV(Math.round(a + (value - a) * e)); if (p < 1) raf = requestAnimationFrame(step); else from.current = value }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])
  return <>{v.toLocaleString()}</>
}

export function Ring({ value, size = 64, stroke = 7, tone = 'var(--pri)', label, children }: { value: number | null; size?: number; stroke?: number; tone?: string; label?: string; children?: React.ReactNode }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, value ?? 0))
  return (
    <span className="ring" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--ring-track)" strokeWidth={stroke} />
        <circle className="ring-v" cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - p / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span className="ring-c">{children ?? (value == null ? '—' : `${Math.round(p)}`)}</span>
    </span>
  )
}

/** donut of parts, e.g. quota used / reserved / available */
export function Donut({ parts, size = 120, stroke = 16, center, label }: { parts: { v: number; color: string; name: string }[]; size?: number; stroke?: number; center?: React.ReactNode; label?: string }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, tot = parts.reduce((t, p) => t + Math.max(0, p.v), 0) || 1
  let off = 0
  return (
    <span className="ring donut" style={{ width: size, height: size }} role="img" aria-label={label || parts.map((p) => `${p.name} ${p.v}`).join(', ')}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--ring-track)" strokeWidth={stroke} />
        {parts.filter((p) => p.v > 0).map((p) => {
          const len = (p.v / tot) * c, el = <circle key={p.name} className="ring-v" cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.color} strokeWidth={stroke}
            strokeDasharray={`${Math.max(0, len - 2)} ${c}`} strokeDashoffset={-off} transform={`rotate(-90 ${size / 2} ${size / 2})`}><title>{`${p.name}: ${p.v}`}</title></circle>
          off += len; return el
        })}
      </svg>
      {center && <span className="ring-c">{center}</span>}
    </span>
  )
}

export function Spark({ data, w = 90, h = 28, color = 'currentColor' }: { data: number[]; w?: number; h?: number; color?: string }) {
  if (data.length < 2) return null
  const max = Math.max(...data, 1), min = Math.min(...data, 0), dx = w / (data.length - 1)
  const pts = data.map((v, i) => `${(i * dx).toFixed(1)},${(h - 2 - ((v - min) / (max - min || 1)) * (h - 4)).toFixed(1)}`)
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polygon points={`0,${h} ${pts.join(' ')} ${w},${h}`} fill={color} opacity=".12" />
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
