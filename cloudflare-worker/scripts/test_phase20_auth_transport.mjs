import assert from 'assert';

const WORKER_URL = process.env.WORKER_URL || 'http://127.0.0.1:8787';

async function testPhase20AuthTransport() {
  console.log('Testing Phase 20 Auth Transport...');
  let testCustomerToken = null;
  let testCustomerId = null;
  let testCustomerPhone = '0500000000';
  let testCustomerPass = 'password123';

  console.log('\n[F-1, F-2] Testing customer_register with POST JSON...');
  const regRes = await fetch(`${WORKER_URL}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'customer_register',
      name: 'Phase 20 Test',
      phone: testCustomerPhone,
      password: testCustomerPass
    })
  });
  const regData = await regRes.json();
  
  // Accept if ok is true (success) or if phone is already registered (from previous run)
  if (regData.ok) {
    assert.strictEqual(regData.ok, true, 'Register ok should be true');
    assert.ok(regData.customer, 'Register should return customer object');
    assert.ok(regData.token, 'Register should return session token');
  } else {
    // If phone exists, login instead
    console.log('Phone exists, testing customer_login with POST JSON...');
  }

  const loginRes = await fetch(`${WORKER_URL}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'customer_login',
      phone: testCustomerPhone,
      password: testCustomerPass
    })
  });
  const loginData = await loginRes.json();
  
  assert.strictEqual(loginData.ok, true, 'Login ok should be true');
  assert.ok(loginData.customer, 'Login should return customer object');
  assert.strictEqual(loginData.customer.phone, testCustomerPhone, 'Customer phone should match');
  assert.ok(loginData.token, 'Login should return session token (F-2 compliance)');
  
  testCustomerToken = loginData.token;
  testCustomerId = loginData.customer.id;
  console.log('✅ customer_login and customer_register POST JSON contracts verified');

  console.log('\n[F-3] Testing customer_orders with Bearer Auth...');
  
  // 1. Test without token (should fail UNAUTHORIZED)
  const noTokenRes = await fetch(`${WORKER_URL}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'customer_orders' })
  });
  const noTokenData = await noTokenRes.json();
  assert.strictEqual(noTokenData.ok, false);
  assert.strictEqual(noTokenData.error?.code, 'UNAUTHORIZED', 'Expected UNAUTHORIZED without token');

  // 2. Test with token (should succeed)
  const withTokenRes = await fetch(`${WORKER_URL}/`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${testCustomerToken}`
    },
    body: JSON.stringify({ action: 'customer_orders' })
  });
  const withTokenData = await withTokenRes.json();
  assert.strictEqual(withTokenData.ok, true, 'Should succeed with valid Bearer token');
  assert.ok(Array.isArray(withTokenData.orders), 'Should return orders array');
  console.log('✅ customer_orders Bearer Auth verified');

  console.log('\n[F-5] Testing CORS Configuration...');
  const originToTest = 'https://smartshopping-76x.pages.dev';
  const corsRes = await fetch(`${WORKER_URL}/?action=catalog`, {
    method: 'OPTIONS',
    headers: {
      'Origin': originToTest,
      'Access-Control-Request-Method': 'POST'
    }
  });
  
  const allowOrigin = corsRes.headers.get('access-control-allow-origin');
  assert.strictEqual(allowOrigin, originToTest, `CORS should reflect allowed origin ${originToTest}`);
  console.log('✅ CORS configuration verified');

  console.log('\nAll Phase 20 Tests Passed! 🎉');
}

testPhase20AuthTransport().catch(e => {
  console.error('\n❌ Test Failed:', e.message);
  process.exit(1);
});
