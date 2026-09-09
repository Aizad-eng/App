/* Service worker: network-first so updates show up on the next launch, cache fallback so it still works offline. */
const VERSION = 'huehop-v1.0.1';
const SHELL = ['./', './index.html', './css/style.css', './js/audio.js', './js/game.js', './js/app.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-512-maskable.png', './icons/apple-touch-icon.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url); if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res && res.ok) caches.open(VERSION).then(c => c.put(e.request, res.clone()));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(cached => cached || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});
