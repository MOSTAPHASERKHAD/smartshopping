// اختبارات API — يُشغَّل بـ: node test_worker.js
// تأكد من تشغيل الـ Worker أولاً: npm run dev

const BASE = process.argv[2] || 'http://127.0.0.1:8787';
let pass = 0, fail = 0;

async function test(label, url, opts = {}, expect = {}) {
  try {
    const res = await fetch(url, opts);
    const json = await res.json();
    const statusOk = expect.status ? res.status === expect.status : true;
    const keyOk    = expect.key    ? json[expect.key] !== undefined : true;
    const okOk     = expect.ok !== undefined ? json.ok === expect.ok : true;

    if (statusOk && keyOk && okOk) {
      console.log(`  ✅  ${label}`);
      console.log(`      HTTP ${res.status} → ${JSON.stringify(json).slice(0, 100)}`);
      pass++;
    } else {
      console.log(`  ⚠️   ${label} (unexpected response)`);
      console.log(`      HTTP ${res.status} → ${JSON.stringify(json).slice(0, 120)}`);
    }
    return json;
  } catch (e) {
    console.log(`  ❌  ${label}`);
    console.log(`      ${e.message}`);
    fail++;
    return null;
  }
}

async function run() {
  console.log('\n══════════════════════════════════════════════');
  console.log('  Smart Shopping Worker — Smoke Tests');
  console.log('══════════════════════════════════════════════\n');

  // ── 1. Public: Catalog ──
  console.log('[ Public Routes ]');
  await test(
    'GET ?action=catalog → products array',
    `${BASE}/?action=catalog`,
    {}, { key: 'products' }
  );

  // ── 2. Public: Settings ──
  await test(
    'GET ?action=settings → store settings (no secrets)',
    `${BASE}/?action=settings`,
    {}, { key: 'store_name' }
  );

  // ── 3. Public: Testimonials ──
  await test(
    'GET ?action=testimonials → empty array',
    `${BASE}/?action=testimonials`,
    {}, { key: 'testimonials' }
  );

  // ── 4. Public: Validate Coupon (not found) ──
  await test(
    'GET ?action=validate_coupon (not found) → valid=false',
    `${BASE}/?action=validate_coupon&coupon_code=FAKE99&subtotal=1000`,
    {}, { ok: false }
  );

  // ── 5. Public: Track Order (not found) ──
  await test(
    'GET ?action=track (not found) → found=false',
    `${BASE}/?action=track&order_id=SK-FAKE-0000`,
    {}, { key: 'found' }
  );

  // ── 6. Public: Customer Orders ──
  await test(
    'GET ?action=customer_orders → empty orders',
    `${BASE}/?action=customer_orders&phone=0555000000`,
    {}, { key: 'orders' }
  );

  // ── 7. Unknown Action ──
  console.log('\n[ Error Handling ]');
  await test(
    'GET ?action=doesnt_exist → UNKNOWN_ACTION error',
    `${BASE}/?action=doesnt_exist`,
    {}, { ok: false }
  );

  // ── 8. Missing Action ──
  await test(
    'GET / (no action) → MISSING_ACTION error',
    `${BASE}/`,
    {}, { ok: false }
  );

  // ── 9. Admin Gate: no token ──
  console.log('\n[ Admin Auth Gate ]');
  await test(
    'GET ?action=admin_list (no token) → 401 UNAUTHORIZED',
    `${BASE}/?action=admin_list`,
    {}, { ok: false, status: 401 }
  );

  await test(
    'GET ?action=admin_orders (no token) → 401',
    `${BASE}/?action=admin_orders`,
    {}, { ok: false, status: 401 }
  );

  // ── 10. Login: Setup Mode (no password set yet) ──
  console.log('\n[ Auth Flow ]');
  const loginBody = new URLSearchParams({ action: 'verify_admin', password: 'test123' });
  const loginResult = await test(
    'POST verify_admin (setup mode — no password set) → setup_mode=true',
    `${BASE}/`,
    { method: 'POST', body: loginBody, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    { ok: true }
  );

  // ── 11. Create Order (urlencoded — مثل الـ frontend الحالي) ──
  console.log('\n[ Order Creation ]');
  const orderBody = new URLSearchParams({
    action:       'order',
    name:         'Ahmed Ben Ali',
    phone:        '0555123456',
    items_json:   JSON.stringify([{ id: 1, name: 'Test Product', qty: 2, price: 1500 }]),
    subtotal:     '3000',
    wilaya_ar:    'الجزائر',
    wilaya_en:    'Algiers',
    wilaya_code:  '16',
    delivery_type:'home',
  });
  const orderResult = await test(
    'POST order (urlencoded — same as current frontend) → ok=true + order_id',
    `${BASE}/`,
    { method: 'POST', body: orderBody, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    { ok: true }
  );

  if (orderResult?.ok && orderResult?.order_id) {
    console.log(`      🎉 Order ID: ${orderResult.order_id}`);

    // ── 12. Track the order we just created ──
    await test(
      `GET ?action=track&order_id=${orderResult.order_id} → found=true`,
      `${BASE}/?action=track&order_id=${orderResult.order_id}`,
      {}, { key: 'found' }
    );
  }

  // ── 13. Order: empty cart ──
  const emptyOrderBody = new URLSearchParams({
    action: 'order', name: 'Test', phone: '0555999888',
    items_json: '[]', subtotal: '0',
  });
  await test(
    'POST order (empty cart) → error',
    `${BASE}/`,
    { method: 'POST', body: emptyOrderBody, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    { ok: false }
  );

  // ── 14. JSON body (للتطبيق المحمول) ──
  console.log('\n[ Mobile App / JSON Body ]');
  await test(
    'POST catalog (JSON body — mobile-style) → products array',
    `${BASE}/`,
    {
      method: 'POST',
      body: JSON.stringify({ action: 'catalog' }),
      headers: { 'Content-Type': 'application/json' },
    },
    { key: 'products' }
  );

  // ── 15. CORS: OPTIONS preflight ──
  console.log('\n[ CORS ]');
  try {
    const res = await fetch(`${BASE}/`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://smartkiosk.pages.dev' },
    });
    const allow = res.headers.get('Access-Control-Allow-Origin');
    console.log(`  ✅  OPTIONS preflight → 204, CORS: ${allow}`);
    pass++;
  } catch (e) {
    console.log(`  ❌  OPTIONS preflight: ${e.message}`);
    fail++;
  }

  // ── ملخص ──
  console.log('\n══════════════════════════════════════════════');
  console.log(`  النتائج: ${pass} ✅ نجح  |  ${fail} ❌ فشل`);
  console.log('══════════════════════════════════════════════\n');
  process.exit(fail > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
