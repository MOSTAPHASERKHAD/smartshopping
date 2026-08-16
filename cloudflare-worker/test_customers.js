const BASE = 'http://127.0.0.1:8787';

async function testCustomerFlow() {
  console.log('--- 👤 اختبار العملاء (Customers) ---');
  let token = '';

  // 1. Register - Phase 20: Use JSON body
  console.log('\n[1] Register Customer');
  const regBody = {
    action: 'customer_register',
    name: 'Ahmed User',
    phone: '0555111222',
    password: 'secretpassword'
  };
  
  const regRes = await fetch(`${BASE}/`, { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(regBody)
  });
  const regJson = await regRes.json();
  if (regJson.ok && regJson.token && regJson.customer) {
    console.log('✅ PASS: Registration successful. Token:', regJson.token);
    console.log('✅ PASS: Customer object returned:', regJson.customer.name);
    // Verify no sensitive fields
    if (!regJson.customer.password && !regJson.customer.password_hash) {
      console.log('✅ PASS: No sensitive credential fields in response');
    } else {
      console.log('❌ FAIL: Sensitive fields leaked in customer object');
      process.exit(1);
    }
  } else {
    console.log('⚠️ Warning: Registration failed:', regJson.error || regJson);
    // Might be already registered, let's try login
  }

  // 2. Login - Phase 20: Use JSON body
  console.log('\n[2] Login Customer');
  const loginBody = {
    action: 'customer_login',
    phone: '0555111222',
    password: 'secretpassword'
  };
  const loginRes = await fetch(`${BASE}/`, { 
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(loginBody)
  });
  const loginJson = await loginRes.json();
  if (loginJson.ok && loginJson.token && loginJson.customer) {
    console.log('✅ PASS: Login successful. Token:', loginJson.token);
    console.log('✅ PASS: Customer object returned:', loginJson.customer.name);
    // Verify no sensitive fields
    if (!loginJson.customer.password && !loginJson.customer.password_hash) {
      console.log('✅ PASS: No sensitive credential fields in response');
    } else {
      console.log('❌ FAIL: Sensitive fields leaked in customer object');
      process.exit(1);
    }
    token = loginJson.token;
  } else {
    console.log('❌ FAIL: Login failed:', loginJson);
    process.exit(1);
  }

  // 3. Profile
  console.log('\n[3] Get Profile');
  const profileRes = await fetch(`${BASE}/?action=customer_profile`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const profileJson = await profileRes.json();
  if (profileJson.ok && profileJson.customer.name === 'Ahmed User') {
    console.log('✅ PASS: Profile fetched successfully.');
  } else {
    console.log('❌ FAIL: Profile fetch failed:', profileJson);
    process.exit(1);
  }

  // 4. Test customer_orders with Bearer token
  console.log('\n[4] Customer Orders with Bearer token');
  const ordersRes = await fetch(`${BASE}/`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ action: 'customer_orders' })
  });
  const ordersJson = await ordersRes.json();
  if (ordersJson.ok && Array.isArray(ordersJson.orders)) {
    console.log('✅ PASS: Customer orders fetched with Bearer token');
  } else {
    console.log('❌ FAIL: Customer orders failed:', ordersJson);
    process.exit(1);
  }

  // 5. Test customer_orders without token (should fail)
  console.log('\n[5] Customer Orders without token (should fail)');
  const ordersNoTokenRes = await fetch(`${BASE}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'customer_orders' })
  });
  const ordersNoTokenJson = await ordersNoTokenRes.json();
  if (!ordersNoTokenJson.ok && ordersNoTokenJson.error?.code === 'UNAUTHORIZED') {
    console.log('✅ PASS: Customer orders correctly rejected without token');
  } else {
    console.log('❌ FAIL: Customer orders should reject without token:', ordersNoTokenJson);
    process.exit(1);
  }

  // 6. Test customer_orders with phone only (no Bearer) - should fail
  console.log('\n[6] Customer Orders with phone only (should fail)');
  const ordersPhoneRes = await fetch(`${BASE}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'customer_orders', phone: '0555111222' })
  });
  const ordersPhoneJson = await ordersPhoneRes.json();
  if (!ordersPhoneJson.ok && ordersPhoneJson.error?.code === 'UNAUTHORIZED') {
    console.log('✅ PASS: Customer orders correctly rejected with phone only');
  } else {
    console.log('❌ FAIL: Customer orders should reject with phone only:', ordersPhoneJson);
    process.exit(1);
  }

  console.log('\n✅ All customer tests passed!');
}

testCustomerFlow().catch(console.error);
