const BASE_URL = 'https://smart-shopping-api-staging.mostaphaserkhad.workers.dev';

async function req(action, params = {}, method = 'POST') {
  const url = `${BASE_URL}?action=${action}`;
  let opts = { method, headers: {} };
  
  if (method === 'POST') {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(params);
  }
  
  // Test CORS
  opts.headers['Origin'] = 'https://smartshopping.click';
  
  try {
    const res = await fetch(url, opts);
    const isJson = res.headers.get('content-type')?.includes('application/json');
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch(e) {}
    
    return {
      status: res.status,
      isJson,
      cors: res.headers.get('access-control-allow-origin') === 'https://smartshopping.click' || res.headers.get('access-control-allow-origin') === '*',
      data: data || text
    };
  } catch(e) {
    return { error: e.message };
  }
}

async function runTests() {
  console.log('--- 🧪 STARTING DATA & API TESTS ON STAGING ---\n');
  
  // 1. Catalog
  const cat = await req('catalog', {}, 'GET');
  console.log(`[CATALOG] isJson: ${cat.isJson}, cors: ${cat.cors}, items: ${cat.data?.products?.length || 0}`);
  
  if (!cat.data?.products?.length) {
    console.error('❌ Catalog is empty! Did the data import properly?');
    return;
  }
  
  const product = cat.data.products[0];
  console.log(`- Sample Product: ${product.name} - Price: ${product.price}`);
  
  // 2. Coupon
  const cop = await req('coupon', { code: 'WELCOME' }, 'POST');
  console.log(`[COUPON] (WELCOME) status: ${cop.status}, valid: ${cop.data?.valid}, type: ${cop.data?.discount_type}`);
  
  // 3. Price Manipulation test (createOrder)
  console.log('\n[CREATE ORDER] Testing price manipulation (subtotal=0)...');
  const orderData = {
    name: 'Test Hacker',
    phone: '0555555557',
    wilaya_code: '1',
    wilaya_ar: 'أدرار',
    municipality: 'Adrar',
    items_json: JSON.stringify([
      { id: product.id, qty: 2 } // Hacking subtotal
    ]),
    subtotal: "0" // Fake subtotal!
  };
  const ord = await req('order', orderData, 'POST');
  console.log(`Order Result: OK=${ord.data?.ok}, Error=${ord.data?.error}, Data:`, ord.data);
  
  if (ord.data?.order_id) {
    // 4. Track Order
    const track = await req('track', { order_id: ord.data.order_id }, 'POST');
    const myOrder = track.data?.order;
    console.log(`[TRACK ORDER] Found order. Stored Subtotal from DB: ${myOrder?.subtotal}`);
    if (myOrder?.subtotal === 0 || myOrder?.subtotal === "0") {
      console.log('❌ FAIL: The worker accepted the fake 0 subtotal!');
    } else {
      console.log(`✅ PASS: The worker recalculated the subtotal from the DB: ${myOrder?.subtotal} (Expected: ${product.price * 2})`);
    }
  }
  
  console.log('\n--- ✅ ALL TESTS COMPLETED ---');
}

runTests();
