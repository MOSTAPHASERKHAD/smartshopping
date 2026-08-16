var CACHE_NAME = 'smartshopping-v46';
var SWR_CACHE   = 'smartshopping-api-v46'; // separate cache so API data survives static asset busting
var MAX_SWR_AGE = 4 * 60 * 60 * 1000;      // 4 hours — serve from cache but revalidate if older

// Build asset list relative to the SW scope so the app works from the
// domain root or from a subdirectory (e.g. /smartshopping/).
function buildAssets() {
  var BASE = self.registration.scope;
  return [
    BASE + 'index.html',
    BASE + 'product.html',
    BASE + 'admin.html',
    BASE + 'manifest.json',
    BASE + 'assets/js/product-utils.js',
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
      return Promise.all(keys.filter(function(k) {
        // Keep current static cache + current API SWR cache; delete everything else
        return k !== CACHE_NAME && k !== SWR_CACHE;
      }).map(function(k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

/**
 * Normalise a GAS API URL into a stable cache key.
 * Strips volatile params (_w, _t, _, callback) so the warmup fetch
 * and the real apiCall share a single entry.
 * Returns null if the URL is not a cacheable public read action.
 */
function apiCacheKey(url) {
  try {
    var u = new URL(url);
    var action = u.searchParams.get('action');
    // Only cache public, read-only actions
    var cacheable = ['catalog', 'settings', 'testimonials'];
    if (cacheable.indexOf(action) === -1) return null;
    // Remove cache-busting and JSONP params
    ['_w', '_t', '_', 'callback', 'jsonp'].forEach(function(p) {
      u.searchParams.delete(p);
    });
    // Stable sorted key: origin + path + sorted params
    var params = [];
    u.searchParams.forEach(function(v, k) { params.push(k + '=' + v); });
    params.sort();
    return u.origin + u.pathname + '?' + params.join('&');
  } catch(e) { return null; }
}

/**
 * Extract the timestamp we stored inside the cached response body
 * (we add an `_sw_cached_at` field when storing).
 * Returns 0 if we cannot determine age.
 */
function getCachedAge(responseClone) {
  return responseClone.clone().json().then(function(body) {
    return body && body._sw_cached_at ? Date.now() - body._sw_cached_at : 0;
  }).catch(function() { return 0; });
}

/**
 * Wrap a fresh network response with a `_sw_cached_at` timestamp
 * so we can implement MAX_SWR_AGE correctly.
 */
function stampResponse(resp) {
  return resp.clone().json().then(function(body) {
    body._sw_cached_at = Date.now();
    return new Response(JSON.stringify(body), {
      status: resp.status,
      statusText: resp.statusText,
      headers: resp.headers
    });
  }).catch(function() { return resp; });
}

// Cache-first for static assets (images, CSS, JS) — fast on slow networks
// Network-first for HTML pages — always serve fresh content
self.addEventListener('fetch', function(e) {
  var url = e.request.url;
  if (e.request.method !== 'GET') return;

  if (url.indexOf(self.registration.scope) !== 0) return;

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
