/* 1.6.0: a short confetti burst for big staff milestones (recruit becomes a worker, Quota Use Request approved,
 * every "what to do next" item cleared). Pure DOM + CSS, ~1.2 s, removed afterwards. Skipped entirely when the
 * user's system asks for reduced motion. */
const COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4']
export function celebrate(n = 90) {
  if (typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false
  const box = document.createElement('div')
  box.className = 'confetti'
  box.setAttribute('aria-hidden', 'true')
  box.dataset.testid = 'confetti'
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i')
    const x = (Math.random() - 0.5) * 2
    p.style.cssText = `left:${50 + x * 8}%;background:${COLORS[i % COLORS.length]};--dx:${x * 46}vw;--dy:${55 + Math.random() * 45}vh;--r:${(Math.random() - 0.5) * 1080}deg;animation-delay:${Math.random() * 120}ms;${i % 3 ? '' : 'border-radius:50%;'}`
    box.appendChild(p)
  }
  document.body.appendChild(box)
  setTimeout(() => box.remove(), 1800)
  return true
}
