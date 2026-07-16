const CACHE_NAME = 'smartshopping-v13';
const ASSETS = [
  '/smartshopping/',
  '/smartshopping/index.html',
  '/smartshopping/admin.html',
  '/smartshopping/manifest.json',
  '/smartshopping/themes/theme-schema.js',
  '/smartshopping/themes/theme-engine.js',
  '/smartshopping/themes/default-themes.js',
  '/smartshopping/themes/theme-importer.js',
  '/smartshopping/themes/theme-editor.js'
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

self.addEventListener('fetch', e => {
  if (e.request.url.includes('script.google.com')) return;
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
      if (resp.status === 200 && e.request.method === 'GET') {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      }
      return resp;
    }).catch(() => caches.match('/smartshopping/index.html')))
  );
});
