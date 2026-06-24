const http = require('http');
const fs = require('fs');
const path = require('path');
const DIR = __dirname;
const MIME = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','webmanifest':'application/manifest+json'};

// Allowed static files (whitelist approach for security)
const ALLOWED = new Set([
  '/index.html', '/admin.html', '/style.css', '/script.js', '/sw.js',
  '/manifest.json', '/sitemap.xml', '/robots.txt',
  '/favicon.ico', '/icon-192.png', '/icon-512.png',
  '/logo.png', '/logo1.png',
  '/banner-hero.png', '/banner1.png', '/banner-sale.png', '/banner-accessories.png'
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
