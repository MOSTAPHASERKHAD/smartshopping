const CACHE_NAME = 'smartshopping-v31';
const ASSETS = [
  '/',
  '/index.html',
  '/admin.html',
  '/manifest.json',
  '/promo-hero.png',
  '/promo-sale.png',
  '/promo-accessories.png',
  '/themes/theme-schema.js',
  '/themes/theme-engine.js',
  '/themes/default-themes.js',
  '/themes/theme-importer.js',
  '/themes/theme-editor.js',
  '/themes/theme-customizer.js'
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
    }).catch(() => caches.match(e.request).then(r => {
      if (r) return r;
      if (e.request.mode === 'navigate' || (e.request.headers.get('accept') && e.request.headers.get('accept').includes('text/html'))) {
        return caches.match('/index.html');
      }
      return new Response('', {status: 404, statusText: 'Not Found'});
    }))
  );
});
