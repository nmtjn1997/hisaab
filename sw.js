// Offline: stale-while-revalidate for the app shell and fonts. Bump VERSION on every deploy.
const VERSION = 'h-2611092210';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/money.js', 'js/parse.js', 'js/store.js', 'js/share.js', 'js/receipt.js', 'js/icons.js', 'js/sync.js', 'js/merge.js', 'js/flags.js', 'js/repeat.js', 'js/fx.js', 'js/card.js', 'js/telemetry.js', 'js/history.js', 'js/search.js', 'js/access.js', 'js/push.js', 'js/push-key.js', 'js/webpush.js', 'flags.json', 'manifest.webmanifest', 'assets/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Push: the server sends no content, so fetch the waiting messages from it and show them.
const PUSH = 'https://hisaab-sync.backinstock.workers.dev/push/inbox';
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    const sub = await self.registration.pushManager.getSubscription();
    let items = [];
    try { items = (await (await fetch(PUSH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub?.endpoint }) })).json()).items || []; } catch {}
    if (!items.length) items = [{ tag: 'hisaab', title: 'Hisaab', body: 'Something changed in your groups.', url: '#/' }];
    await Promise.all(items.map((m) => self.registration.showNotification(m.title || 'Hisaab', { body: m.body || '', tag: m.tag || 'hisaab', renotify: true, icon: 'assets/icon-192.png', data: { url: m.url || '#/' } })));
  })());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(self.registration.scope + (e.notification.data?.url || '#/')).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    const c = cs.find((x) => x.url.startsWith(self.registration.scope));
    // navigate() rejects for a tab this worker does not control, so fall back to opening one.
    return c ? c.focus().then(() => c.navigate(url)).catch(() => self.clients.openWindow(url)) : self.clients.openWindow(url);
  }));
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
