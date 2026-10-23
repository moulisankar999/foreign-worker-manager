import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './lib/auth'
import './styles.css'
import { applyTheme } from './lib/theme'
import { ensureSeed } from './lib/db'
import { isNative, shareFile } from './lib/platform'
import { setNativeSaver } from './lib/util'
import { listenForTaps } from './lib/localNotify'
import { supabase } from './lib/supabase'

applyTheme()

/* Password-reset email links land on "<site>/#access_token=…&type=recovery" (or "#error=…").
 * With the hash router that hash is not a page, so read it here, start the session, and open the reset screen. */
async function takeAuthLink() {
  const h = window.location.hash.replace(/^#\/?/, '')
  if (!/(^|&)(access_token|error)=/.test(h)) return
  const q = new URLSearchParams(h)
  const clean = (to: string) => window.history.replaceState(null, '', window.location.pathname + window.location.search + to)
  if (q.get('error')) {
    sessionStorage.setItem('fwm-auth-link-error', /expired/i.test(q.get('error_code') || q.get('error_description') || '') ? 'This password-reset link has expired or was already used. Ask for a new one.' : q.get('error_description') || 'The link could not be used.')
    clean('#/'); return
  }
  const access_token = q.get('access_token') || '', refresh_token = q.get('refresh_token') || ''
  clean('#/')
  if (!access_token || !refresh_token) return
  const { error } = await supabase.auth.setSession({ access_token, refresh_token })
  if (error) { sessionStorage.setItem('fwm-auth-link-error', 'This link could not be used: ' + error.message); return }
  if (q.get('type') === 'recovery') sessionStorage.setItem('fwm-recovery', '1')
}

ensureSeed()
const authLink = takeAuthLink().catch(() => {})

// Friendly message when a view-only user tries to change something (blocked by the sync layer)
window.addEventListener('unhandledrejection', (e) => {
  const m = String((e.reason as Error)?.message || '')
  if (m.startsWith('View-only access')) { e.preventDefault(); alert(m) }
})

if (isNative()) {
  // Android / iOS app: files go to the share sheet, notification taps open Alerts, Android back button navigates back
  document.documentElement.classList.add('native')
  setNativeSaver(shareFile)
  listenForTaps()
  void import('@capacitor/app').then(({ App }) => App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack && window.location.hash.replace(/^#\/?/, '') !== '') window.history.back()
    else void App.exitApp()
  }))
} else if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => {})
  })
}

void authLink.then(() => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </HashRouter>
  </StrictMode>,
))
