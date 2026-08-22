const BASE = 'http://127.0.0.1:8787';

async function testThemes() {
  console.log('--- 🎨 اختبار الثيمات (Themes) ---');
  
  // 1. Setup Admin Password
  console.log('\n[1] Setup Admin Password (if not set)');
  const setupBody = new URLSearchParams({
    action: 'admin_update_settings',
    admin_password: 'admin'
  });
  await fetch(`${BASE}/`, { method: 'POST', body: setupBody });

  // 2. Login Admin
  console.log('\n[2] Login Admin');
  const loginBody = new URLSearchParams({
    action: 'verify_admin',
    password: 'admin'
  });
  const loginRes = await fetch(`${BASE}/`, { method: 'POST', body: loginBody });
  const loginJson = await loginRes.json();
  const token = loginJson.token;
  if (!token) {
    console.log('❌ FAIL: Admin login failed:', loginJson);
    process.exit(1);
  }

  // 3. Save Theme
  console.log('\n[3] Save Theme');
  const saveBody = new URLSearchParams({
    action: 'admin_save_theme',
    name: 'dark_mode',
    config_json: JSON.stringify({ bg: '#000', fg: '#fff' })
  });
  const saveRes = await fetch(`${BASE}/`, { 
    method: 'POST', 
    headers: { 'Authorization': `Bearer ${token}` },
    body: saveBody 
  });
  const saveJson = await saveRes.json();
  if (saveJson.ok) {
    console.log('✅ PASS: Theme saved.');
  } else {
    console.log('❌ FAIL: Save theme failed:', saveJson);
    process.exit(1);
  }

  // 4. List Themes
  console.log('\n[4] List Themes');
  const listRes = await fetch(`${BASE}/?action=admin_list_themes`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const listJson = await listRes.json();
  if (listJson.ok && listJson.themes.length > 0) {
    console.log('✅ PASS: Themes listed successfully.');
  } else {
    console.log('❌ FAIL: List themes failed:', listJson);
    process.exit(1);
  }

  // 5. Delete Theme
  console.log('\n[5] Delete Theme');
  const delBody = new URLSearchParams({
    action: 'admin_delete_theme',
    name: 'dark_mode'
  });
  const delRes = await fetch(`${BASE}/`, { 
    method: 'POST', 
    headers: { 'Authorization': `Bearer ${token}` },
    body: delBody 
  });
  const delJson = await delRes.json();
  if (delJson.ok) {
    console.log('✅ PASS: Theme deleted successfully.');
  } else {
    console.log('❌ FAIL: Delete theme failed:', delJson);
    process.exit(1);
  }
}

testThemes().catch(err => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
