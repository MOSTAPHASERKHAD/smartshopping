const API_URL = 'https://smart-shopping-api.mostaphaserkhad.workers.dev';

async function checkProductionEndpoints() {
  console.log('=== PHASE 33 PRODUCTION API SMOKE (READ-ONLY) ===');
  
  // 1. Catalog
  const r1 = await fetch(`${API_URL}?action=catalog`);
  console.log('1. Catalog status:', r1.status, '| Products:', (await r1.json()).products?.length || 0);

  // 2. Settings
  const r2 = await fetch(`${API_URL}?action=settings`);
  const d2 = await r2.json();
  console.log('2. Settings status:', r2.status, '| admin_password leaked:', !!d2.admin_password);

  // 3. Testimonials
  const r3 = await fetch(`${API_URL}?action=testimonials`);
  console.log('3. Testimonials status:', r3.status);

  // 4. Track Nonexistent
  const r4 = await fetch(`${API_URL}?action=track&order_id=ORD-NONEXISTENT-999`);
  const d4 = await r4.json();
  console.log('4. Track Nonexistent status:', r4.status, '| found:', d4.found);

  // 5. Validate Coupon Nonexistent
  const r5 = await fetch(`${API_URL}?action=validate_coupon&code=FAKECODE999`);
  const d5 = await r5.json();
  console.log('5. Validate Coupon status:', r5.status, '| valid:', d5.valid);

  // 6. OPTIONS Preflight
  const r6 = await fetch(`${API_URL}?action=catalog`, {
    method: 'OPTIONS',
    headers: {
      'Origin': 'https://smartshopping.click',
      'Access-Control-Request-Method': 'POST'
    }
  });
  console.log('6. OPTIONS status:', r6.status, '| Allow-Origin:', r6.headers.get('Access-Control-Allow-Origin'));

  // 7. Unauthenticated Admin List
  const r7 = await fetch(`${API_URL}?action=admin_list_products`);
  console.log('7. Unauthenticated Admin status:', r7.status);
}

checkProductionEndpoints();
