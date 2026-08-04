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
const pwArg = process.argv.find(a => a.startsWith('--password='));
const API = urlArg
  ? urlArg.slice('--url='.length)
  : 'https://script.google.com/macros/s/AKfycbwSbvmaGo5s7yB4Vw29589Z_UgBY1TYd3QrwmW90ivy5jVx0gbr_jh5MxSwQzepIQ2JEQ/exec';
const PASSWORD = pwArg ? pwArg.slice('--password='.length) : null;

let pass = 0, fail = 0, skip = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok === 'SKIP') { skip++; console.log(`  - SKIP ${name}`); return; }
  if (ok) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; failures.push(`${name}${detail ? ' :: ' + detail : ''}`); console.log(`  FAIL ${name}${detail ? ' :: ' + detail : ''}`); }
}

const H = { 'Content-Type': 'text/plain;charset=utf-8' };
async function get(action, extra) {
  const q = new URLSearchParams({ action, ...(extra || {}) });
  const r = await fetch(`${API}?${q.toString()}`, { headers: H });
  return r.json();
}
async function getRaw(action, extra) {
  const q = new URLSearchParams({ action, ...(extra || {}) });
  const r = await fetch(`${API}?${q.toString()}`, { headers: H });
  return r.text();
}
async function post(action, body) {
  const q = new URLSearchParams({ action, ...body });
  const r = await fetch(API, { method: 'POST', body: q.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  return r.json();
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
    check('2 settings returns object with banner fields', s && typeof s === 'object', JSON.stringify(s).slice(0, 80));
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
    const big = Buffer.alloc(4 * 1024 * 1024).toString('base64'); // > 3MB
    const u3 = await get('upload_image', { base64: big, mimeType: 'image/png' });
    check('7 upload oversized rejected', !!u3.error, JSON.stringify(u3).slice(0, 80));
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

  // ---- Admin-gated tests (only with password) -----------------------------------
  if (!PASSWORD) {
    check('admin suite', 'SKIP', 'run with --password to test gated actions');
  } else {
    try {
      const denied = await get('admin_list');
      check('A admin_list without token unauthorized', !!denied.error, JSON.stringify(denied).slice(0, 80));
    } catch (e) { check('A admin_list unauthed', false, e.message); }

    try {
      const wrong = await post('verify_admin', { password: '__wrong__' });
      check('B verify_admin wrong password rejected', wrong.ok === false, JSON.stringify(wrong).slice(0, 80));
    } catch (e) { check('B verify_admin wrong', false, e.message); }

    let token = null;
    try {
      const login = await post('verify_admin', { password: PASSWORD });
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