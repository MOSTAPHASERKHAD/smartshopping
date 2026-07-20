const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync('index.html', 'utf8');
const baseUrl = 'https://mostaphaserkhad.github.io/smartshopping/';

const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: baseUrl
});

const { window } = dom;
global.window = window;
global.document = window.document;
global.navigator = window.navigator;
global.localStorage = window.localStorage;
global.matchMedia = window.matchMedia = function (q) {
  return { matches: false, media: q, addEventListener() {}, addListener() {}, removeEventListener() {}, removeListener() {} };
};
global.Blob = window.Blob || function () {};
global.URL = window.URL || { createObjectURL: () => '', revokeObjectURL() {} };

// Suppress console noise but capture errors
const errors = [];
const logs = [];
window.console = {
  log: (...a) => logs.push('LOG: ' + a.join(' ')),
  warn: (...a) => logs.push('WARN: ' + a.join(' ')),
  error: (...a) => { errors.push(a.join(' ')); logs.push('ERROR: ' + a.join(' ')); },
  info: (...a) => {}
};

// Load the theme scripts in order (manually evalulate in window scope)
const scripts = [
  'themes/theme-schema.js',
  'themes/theme-engine.js',
  'themes/default-themes.js',
  'themes/theme-importer.js',
  'themes/theme-editor.js'
];

for (const s of scripts) {
  const code = fs.readFileSync(s, 'utf8');
  try {
    window.eval(code);
  } catch (e) {
    console.error('FAILED to load', s, e.message);
    process.exit(1);
  }
}

// Now call ThemeEngine.init() as the page would (on DOMContentLoaded)
try {
  window.ThemeEngine.init();
} catch (e) {
  errors.push('init error: ' + e.message);
}

// Check initial state
const styleBefore = window.document.getElementById('theme-engine-style');
console.log('=== BEFORE SWITCH ===');
console.log('theme-engine-style exists:', !!styleBefore);
if (styleBefore) {
  console.log('CSS has --bg:', styleBefore.textContent.includes('--bg'));
  console.log('activeId:', window.ThemeEngine.activeId);
}

// Now switch to 'rose'
console.log('\n=== SWITCH TO rose ===');
try {
  window.ThemeEngine.apply('rose', 'light');
} catch (e) {
  errors.push('apply rose error: ' + e.message);
}

const styleAfter = window.document.getElementById('theme-engine-style');
console.log('activeId after:', window.ThemeEngine.activeId);
if (styleAfter) {
  const css = styleAfter.textContent;
  // Extract --bg value
  const bgMatch = css.match(/--bg:\s*([^;]+);/);
  const accentMatch = css.match(/--accent:\s*([^;]+);/);
  console.log('--bg value:', bgMatch ? bgMatch[1] : 'NOT FOUND');
  console.log('--accent value:', accentMatch ? accentMatch[1] : 'NOT FOUND');
  console.log('CSS length:', css.length);
}

// Check the original CSS :root block
const headStyles = window.document.querySelectorAll('head style');
console.log('\n=== HEAD STYLE ELEMENTS ===');
headStyles.forEach((st, i) => {
  console.log(`style[${i}] id=${st.id} len=${st.textContent.length}`);
});

console.log('\n=== ERRORS ===');
errors.forEach(e => console.log(e));
console.log('\n=== LAST 10 LOGS ===');
logs.slice(-10).forEach(l => console.log(l));
