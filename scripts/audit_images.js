// Read-only PNG/WEBP header inspector (no dependencies) — reports width/height/size
// for the storefront's static image assets, used for the Phase 5A audit only.
const fs = require('fs');
const path = require('path');

function pngDims(buf) {
  if (buf.length < 24) return null;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
  if (!isPng) return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

function webpDims(buf) {
  if (buf.length < 30) return null;
  const isWebp = buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP';
  if (!isWebp) return null;
  const chunk = buf.slice(12, 16).toString('ascii');
  if (chunk === 'VP8X') {
    const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
    const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
    return { width: w, height: h };
  }
  if (chunk === 'VP8 ') {
    const w = buf.readUInt16LE(26) & 0x3fff;
    const h = buf.readUInt16LE(28) & 0x3fff;
    return { width: w, height: h };
  }
  return { width: null, height: null };
}

const files = [
  'icon.svg', 'icon-192.svg', 'icon-512.svg', 'icon-192.png', 'icon-512.png',
  'logo.png', 'logo1.png', 'logo-og.png', 'logo1-og.png',
  'promo-hero.webp', 'promo-sale.webp', 'promo-accessories.webp',
  'test_arabic.png',
];

let totalBytes = 0;
console.log('file, bytes, KB, width, height');
for (const f of files) {
  const p = path.join(__dirname, '..', f);
  if (!fs.existsSync(p)) { console.log(`${f}, MISSING, -, -, -`); continue; }
  const buf = fs.readFileSync(p);
  totalBytes += buf.length;
  let dims = pngDims(buf) || webpDims(buf);
  const kb = (buf.length / 1024).toFixed(1);
  console.log(`${f}, ${buf.length}, ${kb}, ${dims?.width ?? 'n/a'}, ${dims?.height ?? 'n/a'}`);
}
console.log(`\nTOTAL bytes: ${totalBytes} (${(totalBytes/1024).toFixed(1)} KB)`);
