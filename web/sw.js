// Service worker: appka se načte i bez signálu (poslední uložená verze) a zobrazuje upozornění.
// Data z API (server/index.php) se necachují – kromě obrázků v dokumentech (pod stejným id se nikdy nemění).
// Cesty jsou relativní ke složce appky.
const CACHE = 'notes-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'lib.js', 'md.js', 'merge.js', 'rich.js', 'plain.js', 'doc.js', 'tree.js', 'history.js',
  'push.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('notes-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  if (url.pathname.includes('/server/')) {
    if (!/^\/api\/img\/\d+$/.test(url.searchParams.get('r') || '')) return;
    e.respondWith(caches.open('notes-img').then(async (c) => {  // obrázky: cache první
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }
  // appka: síť první, při výpadku cache
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))),
  );
});

// --- upozornění ---
self.addEventListener('push', (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { title: 'Poznámky', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(m.title || 'Poznámky', {
    body: m.body || '',
    tag: m.tag,
    renotify: !!m.tag,
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    data: { url: m.url || './' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => w.url.startsWith(self.registration.scope));
    if (win) {
      await win.focus();
      win.postMessage({ type: 'open', url });
      return;
    }
    await clients.openWindow(url);
  })());
});
