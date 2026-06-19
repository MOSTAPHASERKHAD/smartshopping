const http = require('http');
const fs = require('fs');
const path = require('path');
const DIR = 'D:\\pro\\ccc\\smartkiosk';
const MIME = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon'};
http.createServer((req, res) => {
  let url = req.url.split('?')[0];
  if (url === '/') url = '/index.html';
  const fp = path.join(DIR, url);
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {'Content-Type': MIME[path.extname(fp)] || 'text/html'});
    res.end(data);
  });
}).listen(3000, () => console.log('Server: http://localhost:3000'));
