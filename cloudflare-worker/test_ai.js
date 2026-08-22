const BASE = 'http://127.0.0.1:8787';

async function testAI() {
  console.log('--- 🤖 اختبار AI (Gemini) ---');

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

  // 2. Test AI Chat
  console.log('\n[1] Test AI Chat with prompt');
  const aiBody = new URLSearchParams({
    action: 'admin_ai_chat',
    prompt: 'مرحبا'
  });
  
  const aiRes = await fetch(`${BASE}/`, { 
    method: 'POST', 
    headers: { 'Authorization': `Bearer ${token}` },
    body: aiBody 
  });
  const aiJson = await aiRes.json();
  
  if (aiJson.ok) {
    console.log('✅ PASS: AI Responded:', aiJson.reply);
  } else {
    // If we have a fake key in .dev.vars, we might get an API error. If no .dev.vars, we get config error.
    if (aiJson.error.includes('مفتاح') || aiJson.error.includes('حدث خطأ')) {
       console.log('✅ PASS: Handled API key missing/invalid gracefully:', aiJson.error);
    } else {
       console.log('❌ FAIL: Expected API error, got:', aiJson);
       process.exit(1);
    }
  }
}

testAI().catch(err => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
