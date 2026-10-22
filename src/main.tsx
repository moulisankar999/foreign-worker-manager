import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './lib/auth'
import './styles.css'
import { ensureSeed } from './lib/db'

ensureSeed()

// Friendly message when a view-only user tries to change something (blocked by the sync layer)
window.addEventListener('unhandledrejection', (e) => {
  const m = String((e.reason as Error)?.message || '')
  if (m.startsWith('View-only access')) { e.preventDefault(); alert(m) }
})

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => {})
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </HashRouter>
  </StrictMode>,
)
