/* Gurzad dashboard service worker: offline shell + push notifications.
   Data is never cached here (it is private and lives behind auth) — only the app shell and static assets. */
const VERSION = 'gd-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const fonts = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== self.location.origin && !fonts) return;       // Supabase etc. → network only
  if (url.pathname.startsWith('/api/')) return;                    // never cache API responses

  if (req.mode === 'navigate') {                                   // app shell: network first, cached shell offline
    e.respondWith(fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put('/', copy)); } return r; }).catch(() => caches.match('/')));
    return;
  }
  // hashed assets, icons, fonts: cache first, refresh in the background
  e.respondWith(caches.match(req).then((hit) => {
    const net = fetch(req).then((r) => { if (r.ok || r.type === 'opaque') { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'גורזאד', body: e.data ? e.data.text() : '' }; }
  const jobs = [self.registration.showNotification(d.title || 'גורזאד', {
    body: d.body || '', tag: d.tag || undefined, renotify: !!d.tag,
    icon: '/icons/icon-192.png', badge: '/icons/badge-96.png',
    dir: 'rtl', lang: 'he', data: { url: d.url || '/' },
  })];
  if (typeof d.badge === 'number' && self.navigator.setAppBadge) jobs.push(self.navigator.setAppBadge(d.badge).catch(() => {}));
  e.waitUntil(Promise.all(jobs));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => new URL(c.url).origin === self.location.origin);
    if (open) { open.postMessage({ type: 'navigate', url }); return open.focus(); }
    return self.clients.openWindow(url);
  }));
});

// The page asks for a local notification (test button / demo mode).
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'notify') self.registration.showNotification(e.data.title, { body: e.data.body, icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', dir: 'rtl', lang: 'he', tag: e.data.tag, data: { url: e.data.url || '/' } });
});
