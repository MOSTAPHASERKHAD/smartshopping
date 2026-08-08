const BASE = 'http://127.0.0.1:8787';

async function testSubscribers() {
  console.log('--- 📬 اختبار النشرة البريدية (Subscribers) ---');

  console.log('\n[1] Subscribe to Newsletter');
  const subBody = new URLSearchParams({
    action: 'newsletter_subscribe',
    name: 'Newsletter Fan',
    phone: '0555333444'
  });
  
  const subRes = await fetch(`${BASE}/`, { method: 'POST', body: subBody });
  const subJson = await subRes.json();
  if (subJson.ok) {
    console.log('✅ PASS: Subscribed successfully.');
  } else {
    console.log('❌ FAIL: Subscription failed:', subJson);
    process.exit(1);
  }

  console.log('\n[2] Subscribe Again (Conflict Handling)');
  const subBody2 = new URLSearchParams({
    action: 'newsletter_subscribe',
    name: 'Newsletter Fan 2',
    phone: '0555333444'
  });
  const subRes2 = await fetch(`${BASE}/`, { method: 'POST', body: subBody2 });
  const subJson2 = await subRes2.json();
  if (subJson2.ok) {
    console.log('✅ PASS: Resubscribed successfully (handled conflict).');
  } else {
    console.log('❌ FAIL: Resubscription failed:', subJson2);
    process.exit(1);
  }
}

testSubscribers().catch(console.error);
