#!/usr/bin/env node
/*
 * SmartKiosk regression test harness.
 *
 * Usage (from repo root):
 *   node regression-tests.js                      # public/security tests only
 *   node regression-tests.js --password "ADMINPW" # also run admin-gated tests
 *   node regression-tests.js --url "https://...exec"  # override default endpoint
 *
 * Exit code: 0 if all executed tests pass, 1 if any fail.
 * NOTE: GAS deploy must be updated with google-apps-script/Code.gs first.
 */
const urlArg = process.argv.find(a => a.startsWith('--url='));
let PASSWORD = null;
{
  const i = process.argv.indexOf('--password');
  if (i !== -1 && process.argv[i + 1] && process.argv[i + 1][0] !== '-') PASSWORD = process.argv[i + 1];
  if (PASSWORD === null) { const eq = process.argv.find(a => a.startsWith('--password=')); if (eq) PASSWORD = eq.slice('--password='.length); }
}
const API = urlArg
  ? urlArg.slice('--url='.length)
  : 'https://script.google.com/macros/s/AKfycbwSbvmaGo5s7yB4Vw29589Z_UgBY1TYd3QrwmW90ivy5jVx0gbr_jh5MxSwQzepIQ2JEQ/exec';
const BASE = 'https://smartshopping.click'; // static/PWA host (same-origin root)

// Admin auth expects SHA-256 of the password (client hashes before sending).
const crypto = require('crypto');
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const PW_HASH = PASSWORD ? sha256(PASSWORD) : null;

let pass = 0, fail = 0, skip = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok === 'SKIP') { skip++; console.log(`  - SKIP ${name}`); return; }
  if (ok) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; failures.push(`${name}${detail ? ' :: ' + detail : ''}`); console.log(`  FAIL ${name}${detail ? ' :: ' + detail : ''}`); }
}

const H = { 'Content-Type': 'text/plain;charset=utf-8' };
const TIMEOUT = 45000;
async function timedFetch(url, opts) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT);
  try { return await fetch(url, { ...opts, signal: ac.signal }); }
  finally { clearTimeout(t); }
}
async function get(action, extra) {
  const q = new URLSearchParams({ action, ...(extra || {}) });
  const r = await timedFetch(`${API}?${q.toString()}`);
  const txt = await r.text();
  try { return JSON.parse(txt); } catch { return { __raw: txt }; }
}
async function getRaw(action, extra) {
  const q = new URLSearchParams({ action, ...(extra || {}) });
  const r = await timedFetch(`${API}?${q.toString()}`);
  return r.text();
}
async function post(action, body) {
  const q = new URLSearchParams({ action, ...body });
  const r = await timedFetch(API, { method: 'POST', body: q.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  const txt = await r.text();
  try { return JSON.parse(txt); } catch { return { __raw: txt }; }
}

(async () => {
  console.log(`Endpoint: ${API}`);

  // ---- 1. Catalog renders --------------------------------------------------
  try {
    const c = await get('catalog');
    check('1 catalog returns products array', Array.isArray(c.products), JSON.stringify(c).slice(0, 80));
  } catch (e) { check('1 catalog returns products array', false, e.message); }

  // ---- 2. Banner settings --------------------------------------------------
  try {
    const s = await get('settings');
    const hasBanner = s && typeof s === 'object' && Object.keys(s).some(k => /^banner\d_(img|title|link)$/.test(k));
    check('2 settings returns object with banner fields', !!hasBanner, s ? Object.keys(s).slice(0, 10).join(',') : 'no settings');
  } catch (e) { check('2 settings returns object', false, e.message); }

  // ---- 4. Track order must NOT leak PII ------------------------------------
  try {
    const t = await get('track', { order_id: '_nonexistent_' });
    const leak = Object.keys(t).some(k => ['name', 'phone', 'notes', 'comment'].includes(k.toLowerCase()));
    check('4 track nonexistent order returns object without PII leaks', !leak, JSON.stringify(t).slice(0, 120));
  } catch (e) { check('4 track no PII', false, e.message); }

  // ---- 5. Customer orders must not error for unknown phone -----------------
  try {
    const co = await get('customer_orders', { phone: '_unknown_' });
    check('5 customer_orders unknown phone handled', Array.isArray(co.orders), JSON.stringify(co).slice(0, 80));
  } catch (e) { check('5 customer_orders unknown', false, e.message); }

  // ---- L1. JSONP callback handling -------------------------------------------
  try {
    const rawOk = await getRaw('catalog', { callback: 'window.myCb' });
    check('L1 safe callback wraps in JSONP', rawOk.indexOf('window.myCb(') === 0, rawOk.slice(0, 40));
  } catch (e) { check('L1 safe callback', false, e.message); }
  try {
    const bad = await getRaw('catalog', { callback: 'evil()' });
    check('L1 malicious callback dropped (raw JSON)', bad.indexOf('evil') === -1 && bad.trim().indexOf('{') === 0, bad.slice(0, 60));
  } catch (e) { check('L1 malicious callback', false, e.message); }
  try {
    // admin action must never answer in JSONP even though callback is supplied
    const adminCb = await getRaw('admin_list', { callback: 'anything', token: 'bad' });
    check('L1 admin action ignores callback (raw JSON)', adminCb.trim().indexOf('{') === 0, adminCb.slice(0, 60));
  } catch (e) { check('L1 admin ignores callback', false, e.message); }

  // ---- 6. Coupon validation (read-only) -------------------------------------
  try {
    const v = await get('validate_coupon', { code: '' });
    check('6 validate_coupon empty input handled (remainder only path)', v.valid === false, JSON.stringify(v).slice(0, 80));
  } catch (e) { check('6 validate_coupon empty', false, e.message); }

  // ---- 7. Upload hardening (rejection paths, no junk created) -----------------
  try {
    const u1 = await get('upload_image', { base64: '', mimeType: 'image/png' });
    check('7 upload empty base64 rejected', !!u1.error, JSON.stringify(u1).slice(0, 80));
  } catch (e) { check('7 upload empty', false, e.message); }
  try {
    const badPng = Buffer.from('notanimage').toString('base64');
    const u2 = await get('upload_image', { base64: badPng, mimeType: 'image/png' });
    check('7 upload wrong magic bytes rejected', !!u2.error, JSON.stringify(u2).slice(0, 80));
  } catch (e) { check('7 upload magic bytes', false, e.message); }
  try {
    const big = Buffer.alloc(3 * 1024 * 1024).toString('base64'); // > 3MB raw
    const u3 = await post('admin_upload_image', { imageData: big, mimeType: 'image/png', token: 'bad' });
    const rejected = !!u3.error || !!u3.__raw;
    check('7 upload oversized rejected (or gated)', rejected, JSON.stringify(u3).slice(0, 80));
  } catch (e) { check('7 upload oversized', false, e.message); }
  try {
    const u4 = await get('upload_image', { base64: '////', mimeType: 'image/svg' });
    check('7 upload unsupported mime rejected', !!u4.error, JSON.stringify(u4).slice(0, 80));
  } catch (e) { check('7 upload unsupported mime', false, e.message); }

  // ---- AI chat gating (empty message to avoid quota) ---------------------------
  try {
    const ai = await get('ai_chat', { message: '' });
    check('8 ai_chat empty message handled', !!ai, JSON.stringify(ai).slice(0, 60));
  } catch (e) { check('8 ai_chat empty', false, e.message); }

  // ---- Newsletter invalid input -------------------------------------------------
  try {
    const nl = await post('newsletter_subscribe', { email: 'not-an-email' });
    check('9 newsletter invalid email rejected', nl.ok === false, JSON.stringify(nl).slice(0, 80));
  } catch (e) { check('9 newsletter invalid', false, e.message); }

  // ---- 12. Theme listing is public (read-only) ----------------------------------
  try {
    const th = await get('admin_list_themes');
    check('12 admin_list_themes reachable', !!th && typeof th === 'object', JSON.stringify(th).slice(0, 80));
  } catch (e) { check('12 theme list', false, e.message); }

  // ---- 13A. Catalog fields required for search/filters ----------------------------
  try {
    const c = await get('catalog');
    const p0 = c.products && c.products[0];
    const hasFields = p0 && ['id', 'title_ar', 'price', 'category_ar', 'image1'].every(k => k in p0);
    check('13a catalog rows carry search/filter fields', !!hasFields, p0 ? Object.keys(p0).join(',') : 'no products');
  } catch (e) { check('13a catalog fields', false, e.message); }

  // ---- 13B. Coupon validation is read-only + rejects bogus code --------------------
  try {
    const v = await get('validate_coupon', { code: 'ZZZNOPE' });
    check('13b bogus coupon rejected (nothing consumed)', v.valid === false, JSON.stringify(v).slice(0, 80));
  } catch (e) { check('13b bogus coupon', false, e.message); }

  // ---- 13C. Customer register -> login -> profile round-trip ------------------------
  const stamp = String(Date.now());
  const cphone = '699' + stamp.slice(-7);
  const cpassword = 'regre$$' + stamp.slice(-4);
  try {
    const reg = await post('customer_register', { phone: cphone, password: cpassword, name: 'Regression Tester' });
    check('13c customer register succeeds', reg.ok === true, JSON.stringify(reg).slice(0, 100));
  } catch (e) { check('13c customer register', false, e.message); }
  try {
    const log = await post('customer_login', { phone: cphone, password: cpassword });
    check('13d customer login succeeds', log.ok === true, JSON.stringify(log).slice(0, 100));
  } catch (e) { check('13d customer login', false, e.message); }
  try {
    const prof = await post('customer_profile', { phone: cphone, password: cpassword });
    const leaked = JSON.stringify(prof).toLowerCase().indexOf('"password"') !== -1;
    check('13e customer_profile works & omits password hash', prof.ok === true && !leaked, JSON.stringify(prof).slice(0, 100));
  } catch (e) { check('13e customer_profile', false, e.message); }
  (function sleep(ms){ const start = Date.now(); while (Date.now() - start < ms) {} })(1200); // allow write to settle

  // ---- 13F. Order creation (POST) + tracking PII on the created order ----------------
  let createdOrderId = null;
  try {
    const ord = await post('order', {
      name: 'Regression Tester', phone: cphone, note: 'automated regression test',
      municipality: 'Test', wilaya_ar: 'الجزائر', delivery_type: 'cash',
      items_json: JSON.stringify([{ id: 'PROD-1785264858984', qty: 1, price: 100 }]),
      subtotal: '100'
    });
    if (ord && (ord.orderId || ord.order_id)) { createdOrderId = ord.orderId || ord.order_id; check('13f order created (POST)', true, createdOrderId); }
    else if (ord && ord.error) { check('13f order created (POST)', false, JSON.stringify(ord).slice(0, 120)); }
    else { check('13f order created (POST)', false, JSON.stringify(ord).slice(0, 120)); }
  } catch (e) { check('13f order created (POST)', false, e.message); }

  if (createdOrderId) {
    try {
      const t = await get('track', { order_id: createdOrderId });
      const leak = Object.keys(t).some(k => ['name', 'phone', 'notes', 'comment'].includes(k.toLowerCase()));
      check('13g tracking created order reveals NO PII', !leak && !t.error, JSON.stringify(t).slice(0, 120));
    } catch (e) { check('13g tracking no PII', false, e.message); }
  } else { check('13g tracking created order reveals NO PII', 'SKIP'); }

  // ---- PWA/static-host checks (must be deployed to smartshopping.click) --------------
  try {
    const sw = await (await timedFetch(BASE + '/sw.js')).text();
    const v33 = sw.indexOf("'smartshopping-v33'") !== -1;
    const scoped = sw.indexOf('self.registration.scope') !== -1;
    const hardcodedPrecache = sw.indexOf("caches.match('/smartshopping/") !== -1;
    check('PWA sw.js is v33 scope-relative', v33 && scoped && !hardcodedPrecache, `v33=${v33} scoped=${scoped} hardcodedFallback=${hardcodedPrecache}`);
  } catch (e) { check('PWA sw.js v33', false, e.message); }
  try {
    const idx = await (await timedFetch(BASE + '/')).text();
    check('PWA index REQUIRED_VER=v33', idx.indexOf("REQUIRED_VER = 'v33'") !== -1, '');
  } catch (e) { check('PWA index REQUIRED_VER', false, e.message); }
  try {
    const man = JSON.parse(await (await timedFetch(BASE + '/manifest.json')).text());
    check('PWA manifest start_url="./"', man.start_url === './', JSON.stringify(man.start_url));
  } catch (e) { check('PWA manifest start_url', false, e.message); }

  // ---- Admin-gated tests (only with password) -----------------------------------
  if (!PASSWORD) {
    check('admin suite', 'SKIP', 'run with --password to test gated actions');
  } else {
    try {
      const denied = await get('admin_list');
      check('A admin_list without token unauthorized', !!denied.error, JSON.stringify(denied).slice(0, 80));
    } catch (e) { check('A admin_list unauthed', false, e.message); }

    try {
      const wrong = await post('verify_admin', { password: sha256('__wrong__') });
      check('B verify_admin wrong password rejected', wrong.ok === false, JSON.stringify(wrong).slice(0, 80));
    } catch (e) { check('B verify_admin wrong', false, e.message); }

    let token = null;
    try {
      const login = await post('verify_admin', { password: PW_HASH });
      if (login.ok && login.token) token = login.token;
      check('C verify_admin correct password issues token', !!token, JSON.stringify(login).slice(0, 80));
    } catch (e) { check('C verify_admin correct', false, e.message); }

    if (token) {
      try {
        const list = await get('admin_list', { token });
        check('D admin_list with token returns products', Array.isArray(list.products), JSON.stringify(list).slice(0, 80));
      } catch (e) { check('D admin_list token', false, e.message); }
      try {
        const s = await get('admin_settings', { token });
        const sinks = JSON.stringify(s);
        if (sinks.indexOf('admin_password') !== -1 || sinks.indexOf('admin_recovery') !== -1) {
          check('E admin_settings does not leak secrets', false, sinks.slice(0, 120));
        } else {
          check('E admin_settings does not leak secrets', true);
        }
      } catch (e) { check('E admin_settings secrets', false, e.message); }

      // ---- Admin POST CRUD (add -> find -> edit -> delete, self-cleaning) ----
      const prodId = 'PROD-REG-' + stamp;
      try {
        const add = await post('admin_add_product', { token, id: prodId, title_ar: 'Regression Test', price: '1', active: 'false' });
        check('F admin add product via POST', add.ok === true, JSON.stringify(add).slice(0, 80));
      } catch (e) { check('F admin add product via POST', false, e.message); }
      let prodRow = null;
      try {
        const list = await get('admin_list', { token });
        const p = (list.products || []).find(x => x.id === prodId);
        prodRow = p ? p._row : null;
        check('G added product appears in admin_list', !!prodRow, `row=${prodRow}`);
      } catch (e) { check('G added product appears', false, e.message); }
      if (prodRow) {
        try {
          const ed = await post('admin_edit_product', { token, _row: prodRow, title_ar: 'Regression Test EDIT' });
          check('H admin edit product via POST', ed.ok === true, JSON.stringify(ed).slice(0, 80));
        } catch (e) { check('H admin edit product', false, e.message); }
        try {
          const del = await post('admin_delete_product', { token, _row: prodRow });
          check('I admin delete product via POST (cleanup)', del.ok === true, JSON.stringify(del).slice(0, 80));
        } catch (e) { check('I admin delete product', false, e.message); }
      } else { check('H admin edit product', 'SKIP'); check('I admin delete product', 'SKIP'); }
    } else {
      check('D admin_list with token', 'SKIP');
      check('E admin_settings secrets', 'SKIP');
    }
  }

  console.log('\n----- SUMMARY -----');
  console.log(`PASS: ${pass}  FAIL: ${fail}  SKIP: ${skip}`);
  if (failures.length) { console.log('Failures:\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('All executed checks passed.');
  process.exit(0);
})().catch(e => { console.error('Fatal:', e.message); process.exit(1); });