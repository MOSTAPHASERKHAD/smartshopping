const BASE_URL = 'https://smart-shopping-api.mostaphaserkhad.workers.dev';

console.log('═══════════════════════════════════════════════════════════════');
console.log('🛡️ SMARTKIOSK PHASE 29 — LIVE PRODUCTION SMOKE VERIFICATION');
console.log('Target:', BASE_URL);
console.log('═══════════════════════════════════════════════════════════════\n');

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passCount++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failCount++;
  }
}

async function runLiveSmoke() {
  try {
    // ── 1. Public Storefront Endpoints ──
    console.log('[1] Testing Public Storefront Endpoints (Expected 200 OK)...');
    
    // Catalog
    const rCat = await fetch(`${BASE_URL}?action=catalog`);
    const dCat = await rCat.json();
    const productsArr = Array.isArray(dCat) ? dCat : dCat.products;
    assert(rCat.status === 200 && Array.isArray(productsArr) && productsArr.length > 0, 'Public catalog returns products array');

    // Settings
    const rSet = await fetch(`${BASE_URL}?action=settings`);
    const dSet = await rSet.json();
    assert(rSet.status === 200 && typeof dSet === 'object' && !dSet.admin_password, 'Public settings sanitized (no admin_password)');

    // Testimonials
    const rTest = await fetch(`${BASE_URL}?action=testimonials`);
    const dTest = await rTest.json();
    const testimonialsArr = Array.isArray(dTest) ? dTest : dTest.testimonials;
    assert(rTest.status === 200 && Array.isArray(testimonialsArr), 'Public testimonials endpoint responds with 200');

    // Validate Coupon
    const rCoup = await fetch(`${BASE_URL}?action=validate_coupon&code=FAKECODE`);
    const dCoup = await rCoup.json();
    assert(rCoup.status === 200 && dCoup.valid === false, 'Validate coupon for fake code returns valid=false');

    // Track Order
    const rTrack = await fetch(`${BASE_URL}?action=track&tracking_number=TRK-FAKE-000`);
    const dTrack = await rTrack.json();
    assert(rTrack.status === 200 && dTrack.found === false, 'Track order for nonexistent code returns found=false');

    // ── 2. Protected Endpoints Without Token (Expected 401) ──
    console.log('\n[2] Testing Protected Endpoints Auth Gates (Expected 401 Unauthorized)...');

    const rAdmList = await fetch(`${BASE_URL}?action=admin_list`);
    assert(rAdmList.status === 401, 'GET admin_list without token returns 401');

    const rAdmOrders = await fetch(`${BASE_URL}?action=admin_orders`);
    assert(rAdmOrders.status === 401, 'GET admin_orders without token returns 401');

    const rAdmMe = await fetch(`${BASE_URL}?action=auth_me`);
    assert(rAdmMe.status === 401, 'GET auth_me without token returns 401');

    const rAdmFake = await fetch(`${BASE_URL}?action=admin_list`, {
      headers: { 'Authorization': 'Bearer fake_unauthorized_token_123456789' }
    });
    assert(rAdmFake.status === 401, 'GET admin_list with bogus token returns 401');

    // ── 3. Anti-Account Enumeration Protocol ──
    console.log('\n[3] Testing Anti-Account Enumeration Protocol...');

    // Login with unknown user
    const rLoginUnknown = await fetch(`${BASE_URL}?action=auth_login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'unknown_ghost_merchant@smartshopping.click', password: 'AnyPassword123!' })
    });
    const dLoginUnknown = await rLoginUnknown.json();
    assert(dLoginUnknown.ok === false && dLoginUnknown.error.includes('غير صحيحة'), 
      'Login with unknown email returns generic error without revealing account existence');

    // Forgot password with unknown user
    const rForgotUnknown = await fetch(`${BASE_URL}?action=auth_forgot_password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'unknown_ghost_merchant@smartshopping.click' })
    });
    const dForgotUnknown = await rForgotUnknown.json();
    assert(rForgotUnknown.status === 200 && dForgotUnknown.ok === true && dForgotUnknown.message.includes('إذا كان البريد مسجلاً'), 
      'Forgot password on unknown email returns generic success message (Anti-Enumeration)');

    // ── 4. Token Invalidation and Security Verification ──
    console.log('\n[4] Testing Token Invalidation & Verification Security...');

    // Bogus Email Verification Token
    const rVerifyBad = await fetch(`${BASE_URL}?action=auth_verify_email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'bogus_verification_token_123' })
    });
    const dVerifyBad = await rVerifyBad.json();
    assert(dVerifyBad.ok === false && dVerifyBad.error.includes('غير صالح'), 'Bogus email verification token rejected cleanly');

    // Bogus Password Reset Token
    const rResetBad = await fetch(`${BASE_URL}?action=auth_reset_password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'bogus_reset_token_123', new_password: 'NewStrongPassword2026!' })
    });
    const dResetBad = await rResetBad.json();
    assert(dResetBad.ok === false && dResetBad.error.includes('غير صالح'), 'Bogus password reset token rejected cleanly');

    // ── 5. Client IDOR & Tenant Isolation ──
    console.log('\n[5] Testing Tenant Scope & IDOR Protection...');

    // Trying to pass fake tenant_id in public query
    const rCatTenant = await fetch(`${BASE_URL}?action=catalog&tenant_id=fake_malicious_tenant_id`);
    const dCatTenant = await rCatTenant.json();
    assert(rCatTenant.status === 200 && dCatTenant.length === dCat.length, 
      'Catalog request safely binds to Master Tenant regardless of spoofed tenant_id');

    // ── 6. CORS & Preflight Protocol ──
    console.log('\n[6] Testing CORS & Security Headers...');
    const rPreflight = await fetch(`${BASE_URL}?action=catalog`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://smartshopping.click',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, Authorization'
      }
    });
    assert(rPreflight.status === 204, 'CORS Preflight OPTIONS returns 204 No Content');
    const allowOrigin = rPreflight.headers.get('Access-Control-Allow-Origin');
    assert(allowOrigin === 'https://smartshopping.click' || allowOrigin === '*', 'CORS Allow-Origin header validated');

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(`📊 LIVE PRODUCTION SMOKE RESULTS: ${passCount} PASSED | ${failCount} FAILED`);
    console.log('═══════════════════════════════════════════════════════════════');

    if (failCount > 0) process.exit(1);
  } catch (err) {
    console.error('Fatal live smoke test error:', err);
    process.exit(1);
  }
}

runLiveSmoke();
