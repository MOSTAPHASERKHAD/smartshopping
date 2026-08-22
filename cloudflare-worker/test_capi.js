const BASE = 'http://127.0.0.1:8787';

async function testCAPI() {
  console.log('--- 📈 اختبار Marketing (CAPI) ---');

  // 1. Login
  const loginBody = new URLSearchParams({
    action: 'verify_admin',
    password: 'admin'
  });
  const loginRes = await fetch(`${BASE}/`, { method: 'POST', body: loginBody });
  const loginJson = await loginRes.json();
  const token = loginJson.token;
  if (!token) {
    console.log('❌ FAIL: Admin login failed');
    process.exit(1);
  }

  // 2. Setup CAPI Settings
  console.log('\n[1] Setup CAPI Settings');
  const setupBody = new URLSearchParams({
    action: 'admin_update_settings',
    capi_enabled: 'true',
    fb_capi_token: 'fake_token',
    fb_pixel_id: 'fake_pixel'
  });
  await fetch(`${BASE}/`, { 
    method: 'POST', 
    headers: { 'Authorization': `Bearer ${token}` },
    body: setupBody 
  });

  // 3. Test CAPI
  console.log('\n[2] Trigger admin_capi_test');
  const capiBody = new URLSearchParams({
    action: 'admin_capi_test',
    test_code: 'TEST1234'
  });
  
  const capiRes = await fetch(`${BASE}/`, { 
    method: 'POST', 
    headers: { 'Authorization': `Bearer ${token}` },
    body: capiBody 
  });
  const capiJson = await capiRes.json();

  // We expect an error from Facebook because the token is fake
  if (capiJson.fb_response && capiJson.fb_response.error) {
    console.log('✅ PASS: CAPI logic triggered and FB responded with expected error:', capiJson.fb_response.error.message);
  } else {
    console.log('❌ FAIL: Expected FB error, got:', capiJson);
    process.exit(1);
  }
}

testCAPI().catch(err => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
