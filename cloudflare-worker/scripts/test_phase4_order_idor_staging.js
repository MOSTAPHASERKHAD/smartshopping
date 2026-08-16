/**
 * Phase 4 — Customer Order IDOR/Authorization — STAGING verification.
 *
 * Verifies:
 *  - guest checkout still works (customer_id stays NULL)
 *  - authenticated order creation stamps customer_id from session
 *  - customer_orders resolves ownership ONLY from session (never client phone)
 *  - cross-customer access is blocked (customer B cannot see customer A's orders)
 *  - unauthenticated customer_orders is rejected, even with a phone param
 *    (closes the phone-enumeration/IDOR vector)
 *  - guest action=track by order_id still works and leaks zero PII
 *  - admin order listing/update/delete still work
 *
 * All test data is synthetic and is deleted at the end of the run.
 */
const crypto = require('crypto');
const { execSync } = require('child_process');

const BASE = 'https://smart-shopping-api-staging.mostaphaserkhad.workers.dev';
const ORIGIN = 'https://smartshopping.click';

let pass = 0, fail = 0;
function log(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' — ' + detail : ''}`);
  ok ? pass++ : fail++;
}

function sha256(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

async function req(action, params = {}, headers = {}) {
  const url = `${BASE}?action=${encodeURIComponent(action)}`;
  const opts = {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(params),
  };
  const res = await fetch(url, opts);
  let data = {};
  try { data = await res.json(); } catch { /* ignore */ }
  return { status: res.status, data };
}

function d1(sql) {
  const escaped = sql.replace(/"/g, '\\"');
  const cmd = `npx wrangler d1 execute smart-shopping-db-staging --env staging --remote --json --command "${escaped}"`;
  const out = execSync(cmd, { encoding: 'utf8' });
  const parsed = JSON.parse(out);
  return parsed[0]?.results || [];
}

const PHONE_A = '0500000901';
const PHONE_B = '0500000902';
const PASSWORD_A = 'Phase4TestA_' + crypto.randomBytes(4).toString('hex');
const PASSWORD_B = 'Phase4TestB_' + crypto.randomBytes(4).toString('hex');

async function run() {
  console.log('=== PHASE 4 — CUSTOMER ORDER IDOR/AUTHORIZATION — STAGING ===\n');

  const PHONE_A2 = '0500000905'; // different recipient phone for A's 2nd order (avoids pre-existing 60s per-phone orderSpamGuard, unrelated to Phase 4)

  // ── cleanup any leftovers from a prior partial run ──
  d1(`DELETE FROM orders WHERE phone IN ('${PHONE_A}', '${PHONE_B}', '${PHONE_A2}', '0500000900');`);
  d1(`DELETE FROM customer_sessions WHERE customer_id IN (SELECT id FROM customers WHERE phone IN ('${PHONE_A}', '${PHONE_B}'));`);
  d1(`DELETE FROM customers WHERE phone IN ('${PHONE_A}', '${PHONE_B}');`);

  // ── 0. Fresh throwaway admin credential (staging only, never printed) ──
  const rawAdminPw = crypto.randomBytes(24).toString('hex');
  const once = sha256(rawAdminPw);
  const twice = sha256(once);
  execSync('npx wrangler secret put ADMIN_PASSWORD_HASH --env staging', { input: twice });
  await new Promise(r => setTimeout(r, 12000));
  let adminLogin = { data: {} };
  for (let i = 0; i < 3; i++) {
    adminLogin = await req('verify_admin', { password: once });
    if (adminLogin.data?.ok) break;
    await new Promise(r => setTimeout(r, 10000));
  }
  log('0. staging admin login (fresh throwaway credential)', adminLogin.data?.ok === true);
  const adminToken = adminLogin.data?.token;
  const adminHeaders = { Authorization: `Bearer ${adminToken}` };

  // ── 1. Register customer A and B ──
  const regA = await req('customer_register', { phone: PHONE_A, password: PASSWORD_A, name: 'Phase4 A' });
  log('1a. customer A registered', regA.data?.ok === true && !!regA.data?.token);
  const tokenA = regA.data?.token;

  const regB = await req('customer_register', { phone: PHONE_B, password: PASSWORD_B, name: 'Phase4 B' });
  log('1b. customer B registered', regB.data?.ok === true && !!regB.data?.token);
  const tokenB = regB.data?.token;

  // ── 2. Guest checkout still works (no token) ──
  const catalog = await req('catalog', {});
  const product = catalog.data?.products?.[0];
  log('2. catalog has a product to order', !!product);

  const guestOrder = await req('order', {
    name: 'Guest Buyer', phone: '0500000900',
    items_json: JSON.stringify([{ id: product.id, qty: 1 }]),
    subtotal: '0', wilaya_ar: 'الجزائر', wilaya_en: 'Algiers', wilaya_code: '16',
    delivery_type: 'home',
  });
  log('2b. guest order created (no session)', guestOrder.data?.ok === true && !!guestOrder.data?.order_id);
  const guestOrderId = guestOrder.data?.order_id;

  const guestOrderRow = d1(`SELECT customer_id FROM orders WHERE order_id = '${guestOrderId}';`);
  log('2c. guest order has NULL customer_id', guestOrderRow[0]?.customer_id === null);

  // ── 3. Authenticated order (customer A) stamps customer_id ──
  const orderA1 = await req('order', {
    name: 'Phase4 A', phone: PHONE_A,
    items_json: JSON.stringify([{ id: product.id, qty: 1 }]),
    subtotal: '0', wilaya_ar: 'الجزائر', wilaya_en: 'Algiers', wilaya_code: '16',
    delivery_type: 'home',
  }, { Authorization: `Bearer ${tokenA}` });
  log('3a. authenticated order (A) created', orderA1.data?.ok === true && !!orderA1.data?.order_id);
  const orderA1Id = orderA1.data?.order_id;

  const custARow = d1(`SELECT id FROM customers WHERE phone = '${PHONE_A}';`);
  const custAId = custARow[0]?.id;
  const orderA1Row = d1(`SELECT customer_id FROM orders WHERE order_id = '${orderA1Id}';`);
  log('3b. order (A) stamped with correct customer_id', orderA1Row[0]?.customer_id === custAId);

  // Second authenticated order for A, shipped to a different recipient phone
  // (avoids the pre-existing 60s per-phone orderSpamGuard; ownership is still
  // resolved purely from the session token, independent of the order's phone field).
  const orderA2 = await req('order', {
    name: 'Phase4 A', phone: PHONE_A2,
    items_json: JSON.stringify([{ id: product.id, qty: 2 }]),
    subtotal: '0', wilaya_ar: 'الجزائر', wilaya_en: 'Algiers', wilaya_code: '16',
    delivery_type: 'home',
  }, { Authorization: `Bearer ${tokenA}` });
  log('3c. second authenticated order (A) created', orderA2.data?.ok === true);

  // ── 4. Authenticated order (customer B) ──
  const orderB1 = await req('order', {
    name: 'Phase4 B', phone: PHONE_B,
    items_json: JSON.stringify([{ id: product.id, qty: 1 }]),
    subtotal: '0', wilaya_ar: 'الجزائر', wilaya_en: 'Algiers', wilaya_code: '16',
    delivery_type: 'home',
  }, { Authorization: `Bearer ${tokenB}` });
  log('4a. authenticated order (B) created', orderB1.data?.ok === true);
  const orderB1Id = orderB1.data?.order_id;

  // ── 5. customer_orders (A) sees ONLY A's orders, not B's, not guest's ──
  const ordersA = await req('customer_orders', {}, { Authorization: `Bearer ${tokenA}` });
  const idsA = (ordersA.data?.orders || []).map(o => o.order_id);
  log('5a. customer_orders(A) ok', ordersA.data?.ok === true);
  log('5b. customer_orders(A) contains both of A\'s orders', idsA.includes(orderA1Id) && idsA.includes(orderA2.data?.order_id));
  log('5c. customer_orders(A) does NOT contain B\'s order', !idsA.includes(orderB1Id));
  log('5d. customer_orders(A) does NOT contain guest order', !idsA.includes(guestOrderId));

  // ── 6. customer_orders (B) sees ONLY B's orders (cross-customer access blocked) ──
  const ordersB = await req('customer_orders', {}, { Authorization: `Bearer ${tokenB}` });
  const idsB = (ordersB.data?.orders || []).map(o => o.order_id);
  log('6a. customer_orders(B) ok', ordersB.data?.ok === true);
  log('6b. customer_orders(B) contains B\'s order', idsB.includes(orderB1Id));
  log('6c. customer_orders(B) does NOT contain A\'s orders (cross-customer IDOR blocked)', !idsB.includes(orderA1Id) && !idsB.includes(orderA2.data?.order_id));

  // ── 7. Unauthenticated customer_orders is rejected outright ──
  const noAuth = await req('customer_orders', {});
  log('7a. customer_orders with no token rejected', noAuth.data?.ok === false);
  log('7b. no orders leaked without token', !(noAuth.data?.orders && noAuth.data.orders.length));

  // ── 8. Phone-based enumeration attempt (no token, but phone supplied) is rejected ──
  const enumAttempt = await req('customer_orders', { phone: PHONE_A });
  log('8a. customer_orders phone-enumeration attempt rejected', enumAttempt.data?.ok === false);
  log('8b. enumeration attempt leaked no orders', !(enumAttempt.data?.orders && enumAttempt.data.orders.length));

  // Also try with a forged/garbage token
  const forged = await req('customer_orders', {}, { Authorization: 'Bearer FORGEDTOKEN000000000000000000000000' });
  log('8c. customer_orders with forged token rejected', forged.data?.ok === false);

  // ── 8d. Legacy bridging: a pre-migration order (customer_id IS NULL) tied to
  //     A's OWN phone must be visible to A via session-resolved phone match,
  //     but must NOT be visible to B (cross-customer bridging must not leak). ──
  const legacyOrderId = 'SK-LEGACY-TEST-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  d1(`INSERT INTO orders (order_id, name, phone, items_json, subtotal, status, customer_id) VALUES ('${legacyOrderId}', 'Legacy A', '${PHONE_A}', '[]', 0, 'pending', NULL);`);

  const ordersAafterLegacy = await req('customer_orders', {}, { Authorization: `Bearer ${tokenA}` });
  const idsAafterLegacy = (ordersAafterLegacy.data?.orders || []).map(o => o.order_id);
  log('8d. legacy NULL-customer_id order bridged to A via own phone', idsAafterLegacy.includes(legacyOrderId));

  const ordersBafterLegacy = await req('customer_orders', {}, { Authorization: `Bearer ${tokenB}` });
  const idsBafterLegacy = (ordersBafterLegacy.data?.orders || []).map(o => o.order_id);
  log('8e. legacy order tied to A\'s phone NOT visible to B (no cross-customer bridging leak)', !idsBafterLegacy.includes(legacyOrderId));

  d1(`DELETE FROM orders WHERE order_id = '${legacyOrderId}';`);

  // ── 9. Guest track by order_id still works, zero PII ──
  const track = await req('track', { order_id: guestOrderId });
  log('9a. guest track by order_id works', track.data?.found === true);
  const trackStr = JSON.stringify(track.data?.order || {});
  log('9b. track response has no phone field', !('phone' in (track.data?.order || {})));
  log('9c. track response has no name field', !('name' in (track.data?.order || {})));
  log('9d. track response contains no PII strings (phone numbers)', !/05000009\d\d/.test(trackStr));

  // ── 10. Admin order functionality preserved ──
  const adminOrders = await req('admin_orders', {}, adminHeaders);
  const adminIds = (adminOrders.data?.orders || []).map(o => o.order_id);
  log('10a. admin_orders works', Array.isArray(adminOrders.data?.orders));
  log('10b. admin sees guest + A + B orders (unrestricted admin visibility)',
    adminIds.includes(guestOrderId) && adminIds.includes(orderA1Id) && adminIds.includes(orderB1Id));

  const adminUpdate = await req('admin_update_order', { order_id: orderA1Id, status: 'confirmed' }, adminHeaders);
  log('10c. admin_update_order works', adminUpdate.data?.ok === true);
  const updatedRow = d1(`SELECT status FROM orders WHERE order_id = '${orderA1Id}';`);
  log('10d. admin update persisted', updatedRow[0]?.status === 'confirmed');

  const adminDelete = await req('admin_delete_order', { order_id: orderA2.data?.order_id }, adminHeaders);
  log('10e. admin_delete_order works', adminDelete.data?.ok === true);
  const deletedRow = d1(`SELECT id FROM orders WHERE order_id = '${orderA2.data?.order_id}';`);
  log('10f. admin delete persisted', deletedRow.length === 0);

  const adminNoAuth = await req('admin_orders', {});
  log('10g. admin_orders still requires auth (401 gate untouched)', adminNoAuth.status === 401);

  // ── Cleanup: remove all synthetic data ──
  d1(`DELETE FROM orders WHERE phone IN ('${PHONE_A}', '${PHONE_B}', '${PHONE_A2}', '0500000900');`);
  d1(`DELETE FROM customer_sessions WHERE customer_id IN (SELECT id FROM customers WHERE phone IN ('${PHONE_A}', '${PHONE_B}'));`);
  d1(`DELETE FROM customers WHERE phone IN ('${PHONE_A}', '${PHONE_B}');`);
  const remaining = d1(`SELECT COUNT(*) as n FROM orders WHERE phone IN ('${PHONE_A}', '${PHONE_B}', '${PHONE_A2}', '0500000900');`);
  const remainingCust = d1(`SELECT COUNT(*) as n FROM customers WHERE phone IN ('${PHONE_A}', '${PHONE_B}');`);
  log('11. all synthetic test data removed', remaining[0]?.n === 0 && remainingCust[0]?.n === 0);

  console.log(`\n=== SUMMARY: pass=${pass} fail=${fail} ===`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
