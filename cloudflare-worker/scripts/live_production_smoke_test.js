/**
 * Live Production Smoke Test Runner
 * ملف: cloudflare-worker/scripts/live_production_smoke_test.js
 */

const PROD_URL = 'https://smart-shopping-api.mostaphaserkhad.workers.dev';

async function runLiveSmokeTests() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🚀 LIVE PRODUCTION SMOKE TESTS — SMARTKIOSK WORKER');
  console.log(`🌐 Target: ${PROD_URL}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, name, detail = '') {
    if (condition) {
      console.log(`  ✅ PASS: ${name}${detail ? ' — ' + detail : ''}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${name}${detail ? ' — ' + detail : ''}`);
      failed++;
    }
  }

  // 1. GET ?action=catalog
  console.log('[1] Testing GET ?action=catalog...');
  const catRes = await fetch(`${PROD_URL}/?action=catalog`);
  const catJson = await catRes.json();
  assert(catRes.status === 200 && Array.isArray(catJson.products), 
    'Catalog response 200 OK', `Products count: ${catJson.products?.length}`);

  // 2. GET ?action=settings
  console.log('\n[2] Testing GET ?action=settings...');
  const setRes = await fetch(`${PROD_URL}/?action=settings`);
  const setJson = await setRes.json();
  assert(setRes.status === 200 && typeof setJson === 'object' && setJson.store_name === 'Smart Shopping', 
    'Settings response 200 OK', `Store name: ${setJson.store_name || 'N/A'}`);
  // Verify no secret leak in settings
  assert(!setJson.admin_password && !setJson.admin_password_hash && !setJson.admin_secret,
    'No sensitive secrets leaked in settings response');

  // 3. GET ?action=testimonials
  console.log('\n[3] Testing GET ?action=testimonials...');
  const testRes = await fetch(`${PROD_URL}/?action=testimonials`);
  const testJson = await testRes.json();
  assert(testRes.status === 200 && Array.isArray(testJson.testimonials), 
    'Testimonials response 200 OK');

  // 4. GET ?action=validate_coupon (non-existent coupon)
  console.log('\n[4] Testing GET ?action=validate_coupon...');
  const coupRes = await fetch(`${PROD_URL}/?action=validate_coupon&code=FAKECOUPON999`);
  const coupJson = await coupRes.json();
  assert(coupRes.status === 200 && coupJson.valid === false, 
    'Coupon validation returns valid=false for non-existent coupon');

  // 5. GET ?action=track (non-existent order)
  console.log('\n[5] Testing GET ?action=track...');
  const trackRes = await fetch(`${PROD_URL}/?action=track&order_id=NONEXISTENT_ORD_123`);
  const trackJson = await trackRes.json();
  assert(trackRes.status === 200 && trackJson.found === false, 
    'Order tracking returns found=false for non-existent order');

  // 6. Security Gate: Unauthenticated admin requests must return 401
  console.log('\n[6] Testing Admin Gate Auth Protection (No Token -> Expect 401)...');
  const adminListRes = await fetch(`${PROD_URL}/?action=admin_list`);
  assert(adminListRes.status === 401, 'admin_list blocked with 401 UNAUTHORIZED');

  const adminOrdersRes = await fetch(`${PROD_URL}/?action=admin_orders`);
  assert(adminOrdersRes.status === 401, 'admin_orders blocked with 401 UNAUTHORIZED');

  const adminSettingsRes = await fetch(`${PROD_URL}/?action=admin_settings`);
  assert(adminSettingsRes.status === 401, 'admin_settings blocked with 401 UNAUTHORIZED');

  // 7. Security Gate: Invalid/Bogus token -> Expect 401
  console.log('\n[7] Testing Admin Gate with Bogus Token (Expect 401)...');
  const bogusRes = await fetch(`${PROD_URL}/?action=admin_list`, {
    headers: { 'Authorization': 'Bearer 00000000000000000000000000000000' }
  });
  assert(bogusRes.status === 401, 'admin_list with bogus token rejected with 401');

  // 8. Customer Register Validation
  console.log('\n[8] Testing Customer Register Validation...');
  const regShortRes = await fetch(`${PROD_URL}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'customer_register', phone: '0555999888', password: '123' })
  });
  const regShortJson = await regShortRes.json();
  assert(regShortJson.ok === false, 'Short password rejected in customer registration');

  // 9. Customer Login with Bad Password
  console.log('\n[9] Testing Customer Login with Wrong Password...');
  const logBadRes = await fetch(`${PROD_URL}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'customer_login', phone: '0555000000', password: 'wrongPassword999' })
  });
  const logBadJson = await logBadRes.json();
  assert(logBadJson.ok === false, 'Customer login with wrong credentials cleanly rejected');

  // 10. CORS Preflight OPTIONS check
  console.log('\n[10] Testing CORS Preflight (OPTIONS)...');
  const optRes = await fetch(`${PROD_URL}/`, {
    method: 'OPTIONS',
    headers: {
      'Origin': 'https://smartshopping.click',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Content-Type, Authorization'
    }
  });
  const allowOrigin = optRes.headers.get('Access-Control-Allow-Origin');
  assert(optRes.status === 204 && (allowOrigin === 'https://smartshopping.click' || allowOrigin === '*'), 
    'CORS preflight 204 No Content with valid allow origin', `Allow-Origin: ${allowOrigin}`);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`📊 نتيجة اختبارات الـ Smoke الحية: ${passed} ناجح | ${failed} فاشل`);
  console.log('═══════════════════════════════════════════════════════════════');

  if (failed > 0) process.exit(1);
}

runLiveSmokeTests().catch(err => {
  console.error('Smoke tests error:', err);
  process.exit(1);
});
