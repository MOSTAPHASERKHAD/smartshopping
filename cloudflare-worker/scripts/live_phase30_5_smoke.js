const PRIMARY_PAGES_URL = 'https://smartshopping-76x.pages.dev';
const CUSTOM_DOMAIN_URL = 'https://smartshopping.click';
const API_URL = 'https://smart-shopping-api.mostaphaserkhad.workers.dev';

console.log('═══════════════════════════════════════════════════════════════');
console.log('🌐 SMARTKIOSK PHASE 30.5 — LIVE PRODUCTION & BROWSER SMOKE TEST');
console.log('Pages URL:', PRIMARY_PAGES_URL);
console.log('Custom Domain:', CUSTOM_DOMAIN_URL);
console.log('API:', API_URL);
console.log('═══════════════════════════════════════════════════════════════\n');

let pass = 0;
let fail = 0;

function assert(testName, condition, expected, actual) {
  if (condition) {
    console.log(`  ✅ PASS | [${testName}] Expected: ${expected} | Got: ${actual}`);
    pass++;
  } else {
    console.error(`  ❌ FAIL | [${testName}] Expected: ${expected} | Got: ${actual}`);
    fail++;
  }
}

async function fetchWithFallback(path) {
  try {
    const res = await fetch(`${CUSTOM_DOMAIN_URL}${path}`);
    if (res.ok) return { res, source: CUSTOM_DOMAIN_URL };
  } catch (e) {}
  const res = await fetch(`${PRIMARY_PAGES_URL}${path}`);
  return { res, source: PRIMARY_PAGES_URL };
}

async function runLiveSmoke() {
  try {
    // 1. Homepage
    console.log('[1] Testing Public Storefront & Landing Pages...');
    const { res: rHome, source: homeSource } = await fetchWithFallback('');
    assert('Homepage', rHome.status === 200, 200, `${rHome.status} (via ${homeSource})`);

    // 2. Catalog
    const rCat = await fetch(`${API_URL}?action=catalog`);
    const dCat = await rCat.json();
    const prodCount = (dCat.products || dCat).length;
    assert('Catalog API', rCat.status === 200 && prodCount > 0, '200 with products', `${rCat.status} with ${prodCount} products`);

    // 3. Settings
    const rSet = await fetch(`${API_URL}?action=settings`);
    const dSet = await rSet.json();
    assert('Settings API', rSet.status === 200 && !dSet.admin_password, '200 sanitized', `${rSet.status} (admin_password leaked: ${!!dSet.admin_password})`);

    // 4. Product Page
    const { res: rProd, source: prodSource } = await fetchWithFallback('/product.html');
    assert('Product Page HTML', rProd.status === 200, 200, `${rProd.status} (via ${prodSource})`);

    // 5. Track Order
    const rTrack = await fetch(`${API_URL}?action=track&tracking_number=TRK-FAKE-999`);
    const dTrack = await rTrack.json();
    assert('Track Order', rTrack.status === 200 && dTrack.found === false, '200 found=false', `${rTrack.status} found=${dTrack.found}`);

    // 6. Validate Coupon
    const rCoup = await fetch(`${API_URL}?action=validate_coupon&code=NONEXISTENT`);
    const dCoup = await rCoup.json();
    assert('Coupon Validation', rCoup.status === 200 && dCoup.valid === false, '200 valid=false', `${rCoup.status} valid=${dCoup.valid}`);

    // 7. Merchant Login (Anti-Enumeration)
    console.log('\n[2] Testing Merchant Authentication & Security Gates...');
    const rLogin = await fetch(`${API_URL}?action=auth_login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ghost_merchant@test.com', password: 'AnyPassword123!' })
    });
    const dLogin = await rLogin.json();
    assert('Merchant Login Anti-Enumeration', dLogin.ok === false && dLogin.error.includes('غير صحيحة'), 'Generic error', dLogin.error);

    // 8. Merchant Auth Me without Token
    const rMeNoTok = await fetch(`${API_URL}?action=auth_me`);
    assert('Merchant Auth Me (No Token)', rMeNoTok.status === 401, 401, rMeNoTok.status);

    // 9. Merchant Logout (Invalid token rejected by Admin Gate)
    const rLogout = await fetch(`${API_URL}?action=auth_logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'invalid_unauthenticated_token_999' })
    });
    assert('Merchant Logout (Invalid Token Guard)', rLogout.status === 401, 401, rLogout.status);

    // 10. Admin Unauthorized
    console.log('\n[3] Testing Admin Gate & Token Rejection...');
    const rAdmList = await fetch(`${API_URL}?action=admin_list`);
    assert('Admin List (No Token)', rAdmList.status === 401, 401, rAdmList.status);

    // 11. Admin Invalid Token
    const rAdmBad = await fetch(`${API_URL}?action=admin_list`, {
      headers: { 'Authorization': 'Bearer fake_invalid_token_999' }
    });
    assert('Admin List (Bogus Token)', rAdmBad.status === 401, 401, rAdmBad.status);

    // 12. Customer Login
    console.log('\n[4] Testing Customer Authentication Isolation...');
    const rCustLogin = await fetch(`${API_URL}?action=customer_login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '0555000000', password: 'WrongPassword123!' })
    });
    const dCustLogin = await rCustLogin.json();
    assert('Customer Login Rejection', dCustLogin.ok === false, 'ok=false', `ok=${dCustLogin.ok}`);

    // 13. Customer Profile without Token
    const rCustProf = await fetch(`${API_URL}?action=customer_profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const dCustProf = await rCustProf.json();
    assert('Customer Profile (No Token)', dCustProf.ok === false, 'ok=false', `ok=${dCustProf.ok}`);

    // 14. CORS Preflight
    console.log('\n[5] Testing CORS & Security Headers...');
    const rCors = await fetch(`${API_URL}?action=catalog`, {
      method: 'OPTIONS',
      headers: {
        'Origin': CUSTOM_DOMAIN_URL,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, Authorization'
      }
    });
    assert('CORS Preflight Status', rCors.status === 204, 204, rCors.status);

    // 15. Security Headers
    const allowOrigin = rCors.headers.get('Access-Control-Allow-Origin');
    assert('CORS Allow-Origin', allowOrigin === CUSTOM_DOMAIN_URL || allowOrigin === '*' || allowOrigin === PRIMARY_PAGES_URL, 'Allowed Origin', allowOrigin);

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(`📊 LIVE SMOKE RESULTS: ${pass} PASSED | ${fail} FAILED`);
    console.log('═══════════════════════════════════════════════════════════════');

    if (fail > 0) process.exit(1);
  } catch (e) {
    console.error('Smoke test fatal error:', e);
    process.exit(1);
  }
}

runLiveSmoke();
