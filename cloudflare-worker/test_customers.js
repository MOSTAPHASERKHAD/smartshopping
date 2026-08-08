const BASE = 'http://127.0.0.1:8787';

async function testCustomerFlow() {
  console.log('--- 👤 اختبار العملاء (Customers) ---');
  let token = '';

  // 1. Register
  console.log('\n[1] Register Customer');
  const regBody = new URLSearchParams({
    action: 'customer_register',
    name: 'Ahmed User',
    phone: '0555111222',
    password: 'secretpassword'
  });
  
  const regRes = await fetch(`${BASE}/`, { method: 'POST', body: regBody });
  const regJson = await regRes.json();
  if (regJson.ok && regJson.token) {
    console.log('✅ PASS: Registration successful. Token:', regJson.token);
  } else {
    console.log('⚠️ Warning: Registration failed:', regJson.error || regJson);
    // Might be already registered, let's try login
  }

  // 2. Login
  console.log('\n[2] Login Customer');
  const loginBody = new URLSearchParams({
    action: 'customer_login',
    phone: '0555111222',
    password: 'secretpassword'
  });
  const loginRes = await fetch(`${BASE}/`, { method: 'POST', body: loginBody });
  const loginJson = await loginRes.json();
  if (loginJson.ok && loginJson.token) {
    console.log('✅ PASS: Login successful. Token:', loginJson.token);
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
}

testCustomerFlow().catch(console.error);
