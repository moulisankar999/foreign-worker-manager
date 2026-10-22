/* Simple offline-first service worker; all paths relative to its own scope (respects GitHub Pages base path). */
const CACHE = 'fwm-v2';
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
/* Background push from the daily-alerts server function */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  const title = d.title || 'FW Manager alerts';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || 'Open the app to see your alerts.',
    icon: SCOPE + 'icon-192.png',
    badge: SCOPE + 'icon-192.png',
    tag: d.tag || 'fwm-daily',
    data: { url: SCOPE + (d.path || '#/alerts') },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || SCOPE + '#/alerts';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cl) => {
    const c = cl.find((x) => x.url.startsWith(SCOPE));
    if (c) { c.navigate(url).catch(() => {}); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
