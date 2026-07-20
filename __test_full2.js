const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');

const BASE = 'https://mostaphaserkhad.github.io/smartshopping/';
const vc = new VirtualConsole();
const logs = [];
const errors = [];
vc.on('log', (...a) => logs.push('LOG: ' + a.join(' ')));
vc.on('warn', (...a) => logs.push('WARN: ' + a.join(' ')));
vc.on('error', (...a) => errors.push('ERROR: ' + (a[0] && a[0].stack ? a[0].stack : a.join(' '))));
vc.on('jsdomError', (e) => errors.push('JSDOM_ERROR: ' + (e && e.message ? e.message + (e.detail ? ' | ' + e.detail : '') : e)));

const html = fs.readFileSync('index.html', 'utf8');

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  url: BASE,
  virtualConsole: vc,
  beforeParse(window) {
    window.matchMedia = function (q) { return { matches: false, media: q, addEventListener() {}, addListener() {} }; };
  }
});

setTimeout(() => {
  const { window } = dom;
  console.log('=== AFTER PAGE LOAD ===');
  console.log('window.ThemeEngine defined:', !!window.ThemeEngine);
  console.log('window.SmartKioskThemes defined:', !!window.SmartKioskThemes);
  if (window.ThemeEngine) {
    console.log('registered themes:', Object.keys(window.ThemeEngine.themes).length);
    console.log('activeId:', window.ThemeEngine.activeId);
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
  errors.slice(0, 20).forEach(e => console.log(e));
  console.log('\n=== LAST 25 LOGS ===');
  logs.slice(-25).forEach(l => console.log(l));
  process.exit(0);
}, 6000);
