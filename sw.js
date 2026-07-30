var CACHE_NAME = 'smartkiosk-v1';
var ASSETS = [
  '/',
  '/index.html',
  '/admin.html',
  '/manifest.json',
  '/product.html',
  '/assets/css/index.css',
  '/assets/css/product.css',
  '/assets/css/admin.css',
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
          return caches.match('/index.html');
        }
        return new Response('', {status: 404, statusText: 'Not Found'});
      });
    })
  );
});
