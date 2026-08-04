const http = require('http');
const fs = require('fs');
const path = require('path');
const DIR = __dirname;
const MIME = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','webmanifest':'application/manifest+json'};

// Allowed static files (whitelist approach for security)
const ALLOWED = new Set([
  // App entry points + SW
  '/index.html', '/admin.html', '/sw.js', '/manifest.json',
  '/sitemap.xml', '/robots.txt',
  // Icons & logos
  '/icon.svg', '/icon-512.svg', '/icon-192.svg',
  '/icon-192.png', '/icon-512.png', '/logo.png', '/logo1.png',
  // Promo banners
  '/promo-hero.webp', '/promo-sale.webp', '/promo-accessories.webp',
  // Stylesheets
  '/assets/css/index.css', '/assets/css/index.min.css',
  '/assets/css/product.css', '/assets/css/product.min.css',
  '/assets/css/admin.css', '/assets/css/admin.min.css',
  // Theme engine & themes
  '/themes/theme-schema.js', '/themes/theme-engine.js', '/themes/default-themes.js',
  '/themes/theme-importer.js', '/themes/theme-editor.js', '/themes/theme-customizer.js',
  // Product images
  '/assets/img/enzo_3_jpg.png', '/assets/img/enzo_21.png', '/assets/img/enzo_20.png',
  '/assets/img/enzo_1_jpg.png', '/assets/img/enzo_19.png', '/assets/img/enzo_18.png',
  '/assets/img/enzo_17.png', '/assets/img/enzo_15.png', '/assets/img/enzo_12.png'
]);

http.createServer((req, res) => {
  // Block Path Traversal attempts
  const raw = decodeURIComponent(req.url.split('?')[0]);
  if (raw.includes('..') || raw.includes('\0')) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  let url = raw;
  if (url === '/') url = '/index.html';

  // Whitelist check — only serve known static assets
  if (!ALLOWED.has(url)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const fp = path.join(DIR, url);
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(fp);
  res.writeHead(200, {'Content-Type': MIME[ext] || 'application/octet-stream'});
    res.end(data);
  });
}).listen(3000, () => console.log('Server: http://localhost:3000'));
