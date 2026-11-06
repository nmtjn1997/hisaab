// Offline: stale-while-revalidate for the app shell and fonts. Bump VERSION on every deploy.
const VERSION = 'h-2611061546';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/money.js', 'js/parse.js', 'js/store.js', 'js/share.js', 'js/receipt.js', 'js/icons.js', 'js/sync.js', 'js/merge.js', 'js/flags.js', 'flags.json', 'manifest.webmanifest', 'assets/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const ok = u.origin === location.origin || /fonts\.(googleapis|gstatic)\.com$/.test(u.hostname);
  if (!ok) return;
  e.respondWith(
    caches.open(VERSION).then(async (c) => {
      const hit = await c.match(e.request, { ignoreSearch: u.origin === location.origin });
      const net = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    })
  );
});
