const { JSDOM } = require('jsdom');
const fs = require('fs');

const html = fs.readFileSync('index.html', 'utf8');

const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: 'https://mostaphaserkhad.github.io/smartshopping/'
});
const { window } = dom;

global.window = window;
global.document = window.document;
window.matchMedia = function (q) { return { matches: false, media: q, addEventListener() {}, addListener() {} }; };

// Extract the original <style> CSS from the HTML and inject it as a SEPARATE
// style element in <head> (simulating what the browser does with the inline CSS).
const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
if (styleMatch) {
  const origStyle = window.document.createElement('style');
  origStyle.id = 'original-inline-css';
  origStyle.textContent = styleMatch[1];
  window.document.head.appendChild(origStyle);
  console.log('Injected original CSS, length:', origStyle.textContent.length);
}

// Load theme scripts in order
const scripts = ['themes/theme-schema.js','themes/theme-engine.js','themes/default-themes.js','themes/theme-importer.js','themes/theme-editor.js'];
for (const s of scripts) {
  try { window.eval(fs.readFileSync(s,'utf8')); }
  catch (e) { console.error('FAILED', s, e.message); process.exit(1); }
}

// Run init (as DOMContentLoaded would)
try { window.ThemeEngine.init(); } catch (e) { console.error('init error:', e.message); }

function dumpHead(label) {
  const styles = [...window.document.querySelectorAll('head style')];
  console.log('\n=== ' + label + ' ===');
  styles.forEach((st,i) => {
    const bg = (st.textContent.match(/--bg:\s*([^;]+);/) || [])[1];
    console.log(`[${i}] id=${st.id} len=${st.textContent.length} --bg=${bg}`);
  });
}

dumpHead('AFTER INIT (default theme)');

// Now simulate clicking 'rose'
window.ThemeEngine.apply('rose', 'light');
dumpHead('AFTER SWITCH TO rose');

// Check computed cascade: the engine's :root should override original :root IF it comes later.
const styles = [...window.document.querySelectorAll('head style')];
const engineStyle = styles.find(s => s.id === 'theme-engine-style');
const origStyle = styles.find(s => s.id === 'original-inline-css');
const engineIdx = styles.indexOf(engineStyle);
const origIdx = styles.indexOf(origStyle);
console.log('\nEngine style index:', engineIdx, ' Original style index:', origIdx);
console.log('Engine comes AFTER original:', engineIdx > origIdx);
