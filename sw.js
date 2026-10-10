/**
 * sw.js — LogiPilot offline shell. App shell cached; nothing else.
 */
const VERSION = 'v2.0.0';
const SHELL_CACHE = `logipilot-shell-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './css/tokens.css?v=2.0.0',
  './css/base.css?v=2.0.0',
  './css/components.css?v=2.0.0',
  './css/modules.css?v=2.0.0',
  './css/app.css?v=2.0.0',
  './js/config.js?v=2.0.0',
  './js/util.js?v=2.0.0',
  './js/crypto.js?v=2.0.0',
  './js/store.js?v=2.0.0',
  './js/i18n.js?v=2.0.0',
  './js/seed.js?v=2.0.0',
  './js/charts.js?v=2.0.0',
  './js/ui.js?v=2.0.0',
  './js/table.js?v=2.0.0',
  './js/auth.js?v=2.0.0',
  './js/scan.js?v=2.0.0',
  './js/photo.js?v=2.0.0',
  './js/api.js?v=2.0.0',
  './js/orders.js?v=2.0.0',
  './js/modules/_shared.js?v=2.0.0',
  './js/modules/dashboard.js?v=2.0.0',
  './js/modules/orders.js?v=2.0.0',
  './js/modules/packing.js?v=2.0.0',
  './js/modules/delivery.js?v=2.0.0',
  './js/modules/proofs.js?v=2.0.0',
  './js/modules/insights.js?v=2.0.0',
  './js/modules/settings.js?v=2.0.0',
  './js/router.js?v=2.0.0',
  './js/app.js?v=2.0.0',
  './assets/icon.svg',
  './assets/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(SHELL.map((url) => cache.add(url).catch(() => undefined)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('logipilot-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('./index.html')));
    return;
  }
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(event.request).then((hit) => {
        const fetching = fetch(event.request).then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(event.request, copy)).catch(() => undefined);
          return res;
        }).catch(() => hit);
        return hit || fetching;
      }),
    );
  }
});
