var CACHE_NAME = 'smartshopping-v33';

// Build asset list relative to the SW scope so the app works from the
// domain root or from a subdirectory (e.g. /smartshopping/).
function buildAssets() {
  var BASE = self.registration.scope;
  return [
    BASE + 'index.html',
    BASE + 'admin.html',
    BASE + 'manifest.json',
    BASE + 'assets/css/index.css',
    BASE + 'assets/css/product.css',
    BASE + 'assets/css/admin.css',
    BASE + 'promo-hero.webp',
    BASE + 'promo-sale.webp',
    BASE + 'promo-accessories.webp',
    BASE + 'themes/theme-schema.js',
    BASE + 'themes/theme-engine.js',
    BASE + 'themes/default-themes.js',
    BASE + 'themes/theme-importer.js',
    BASE + 'themes/theme-editor.js',
    BASE + 'themes/theme-customizer.js'
  ];
}

self.addEventListener('install', function(e) {
  // Resilient precache: each asset is fetched independently so a single
  // missing file cannot fail the whole install and strand old caches.
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(c) {
      return Promise.all(buildAssets().map(function(u) {
        return c.add(u).catch(function() { /* skip unavailable file */ });
      }));
    })
  );
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
  if (url.indexOf(self.registration.scope) !== 0) return;
  if (url.indexOf('script.google.com') !== -1) return;
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
        if (e.request.mode === 'navigate' || (e.request.headers.get('accept') && e.request.headers.get('accept').indexOf('text/html') !== -1)) {
          return caches.match(self.registration.scope + 'index.html');
        }
        return new Response('', {status: 404, statusText: 'Not Found'});
      });
    })
  );
});
