/* Simple offline-first service worker; all paths relative to its own scope (respects GitHub Pages base path). */
const CACHE = 'fwm-v1';
const SCOPE = self.registration ? self.registration.scope : './';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([SCOPE, SCOPE + 'index.html', SCOPE + 'manifest.webmanifest', SCOPE + 'icon.svg']).catch(() => {})));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(SCOPE + 'index.html', cp)); return r; }).catch(() => caches.match(SCOPE + 'index.html')));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); } return r; })));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((cl) => (cl[0] ? cl[0].focus() : self.clients.openWindow(SCOPE + '#/alerts'))));
});
