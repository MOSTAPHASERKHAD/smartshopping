var CACHE_NAME = 'smartshopping-v32';
var ASSETS = [
  '/smartshopping/',
  '/smartshopping/index.html',
  '/smartshopping/admin.html',
  '/smartshopping/manifest.json',
  '/smartshopping/assets/css/index.css',
  '/smartshopping/assets/css/product.css',
  '/smartshopping/assets/css/admin.css',
  '/smartshopping/promo-hero.webp',
  '/smartshopping/promo-sale.webp',
  '/smartshopping/promo-accessories.webp',
  '/smartshopping/themes/theme-schema.js',
  '/smartshopping/themes/theme-engine.js',
  '/smartshopping/themes/default-themes.js',
  '/smartshopping/themes/theme-importer.js',
  '/smartshopping/themes/theme-editor.js',
  '/smartshopping/themes/theme-customizer.js'
];

self.addEventListener('install', function(e) {
  e.waitUntil(caches.open(CACHE_NAME).then(function(c) { return c.addAll(ASSETS); }));
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k !== CACHE_NAME; }).map(function(k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

// Cache-first for static assets (images, CSS, JS) — fast on slow networks
// Network-first for HTML pages — always serve fresh content
self.addEventListener('fetch', function(e) {
  var url = e.request.url;
  if (url.includes('script.google.com')) return;
  if (e.request.method !== 'GET') return;

  // Cache-first for images, CSS, theme JS
  if (url.match(/\.(png|jpg|jpeg|gif|svg|webp|css|js)$/)) {
    e.respondWith(
      caches.match(e.request).then(function(cached) {
        if (cached) return cached;
        return fetch(e.request).then(function(resp) {
          if (resp && resp.status === 200) {
            var clone = resp.clone();
            caches.open(CACHE_NAME).then(function(c) { c.put(e.request, clone); });
          }
          return resp;
        });
      })
    );
    return;
  }

  // Network-first for HTML and everything else
  e.respondWith(
    fetch(e.request).then(function(resp) {
      if (resp && resp.status === 200) {
        var clone = resp.clone();
        caches.open(CACHE_NAME).then(function(c) { c.put(e.request, clone); });
      }
      return resp;
    }).catch(function() {
      return caches.match(e.request).then(function(r) {
        if (r) return r;
        if (e.request.mode === 'navigate' || (e.request.headers.get('accept') && e.request.headers.get('accept').includes('text/html'))) {
          return caches.match('/smartshopping/index.html');
        }
        return new Response('', {status: 404, statusText: 'Not Found'});
      });
    })
  );
});
