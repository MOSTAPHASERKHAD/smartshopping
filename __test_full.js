const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');

const BASE = 'https://mostaphaserkhad.github.io/smartshopping/';
const localDir = path.resolve('.');

// Custom resource loader: map same-origin URLs to local files
class LocalLoader extends ResourceLoader {
  fetch(url, options) {
    let u;
    try { u = new URL(url); } catch (e) { return null; }
    if (u.origin !== new URL(BASE).origin) return null; // let jsdom skip cross-origin
    let rel = decodeURIComponent(u.pathname.replace('/smartshopping/', '/'));
    let file = path.join(localDir, rel);
    if (fs.existsSync(file)) {
      return Promise.resolve(fs.readFileSync(file));
    }
    return null;
  }
}

const vc = new VirtualConsole();
const logs = [];
const errors = [];
vc.on('log', (...a) => logs.push('LOG: ' + a.join(' ')));
vc.on('warn', (...a) => logs.push('WARN: ' + a.join(' ')));
vc.on('error', (...a) => errors.push('ERROR: ' + (a[0] && a[0].stack ? a[0].stack : a.join(' '))));
vc.on('jsdomError', (e) => errors.push('JSDOM_ERROR: ' + (e && e.message ? e.message : e)));

const html = fs.readFileSync('index.html', 'utf8');

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  resources: new LocalLoader(),
  pretendToBeVisual: true,
  url: BASE,
  virtualConsole: vc
});

const { window } = dom;
window.matchMedia = window.matchMedia || function (q) {
  return { matches: false, media: q, addEventListener() {}, addListener() {} };
};

// Wait for scripts + DOMContentLoaded to fire
setTimeout(() => {
  console.log('=== AFTER PAGE LOAD ===');
  console.log('window.ThemeEngine defined:', !!window.ThemeEngine);
  console.log('window.SmartKioskThemes defined:', !!window.SmartKioskThemes);
  if (window.ThemeEngine) {
    console.log('registered themes:', Object.keys(window.ThemeEngine.themes).length);
    console.log('activeId:', window.ThemeEngine.activeId);
  }
  const styleEl = window.document.getElementById('theme-engine-style');
  console.log('theme-engine-style exists:', !!styleEl);

  // Now click a theme (simulate applyStoreTheme('rose'))
  if (window.ThemeEngine) {
    try {
      window.ThemeEngine.apply('rose', 'light');
      console.log('After apply rose -> activeId:', window.ThemeEngine.activeId);
      const se = window.document.getElementById('theme-engine-style');
      const bg = se && se.textContent.match(/--bg:\s*([^;]+);/);
      console.log('rose --bg:', bg ? bg[1] : 'MISSING');
    } catch (e) {
      errors.push('apply rose failed: ' + e.message);
    }
  }

  console.log('\n=== ERRORS (' + errors.length + ') ===');
  errors.slice(0, 15).forEach(e => console.log(e));
  console.log('\n=== LAST 20 LOGS ===');
  logs.slice(-20).forEach(l => console.log(l));
  process.exit(0);
}, 3000);
