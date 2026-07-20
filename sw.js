const CACHE_NAME = 'smartshopping-v17';
const ASSETS = [
  '/smartshopping/',
  '/smartshopping/index.html',
  '/smartshopping/admin.html',
  '/smartshopping/manifest.json',
  '/smartshopping/themes/theme-schema.js',
  '/smartshopping/themes/theme-engine.js',
  '/smartshopping/themes/default-themes.js',
  '/smartshopping/themes/theme-importer.js',
  '/smartshopping/themes/theme-editor.js',
  '/smartshopping/themes/theme-customizer.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first: always fetch fresh content; fall back to cache only when offline.
self.addEventListener('fetch', e => {
  if (e.request.url.includes('script.google.com')) return;
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(function (resp) {
      if (resp && resp.status === 200) {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      }
      return resp;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('/smartshopping/index.html')))
  );
});
