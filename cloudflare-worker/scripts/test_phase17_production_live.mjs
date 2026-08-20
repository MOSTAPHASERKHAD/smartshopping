/**
 * SmartKiosk — Phase 17 Live Production Validation Suite
 * Tests live deployed Cloudflare Pages and Cloudflare Worker API
 */

const API_URL = 'https://smart-shopping-api.mostaphaserkhad.workers.dev';
const FRONTEND_URL = 'https://smartshopping.click';

console.log('═══════════════════════════════════════════════════════════════');
console.log('🚀 SMARTKIOSK PHASE 17 — LIVE PRODUCTION VALIDATION');
console.log('API Target:', API_URL);
console.log('Frontend Target:', FRONTEND_URL);
console.log('═══════════════════════════════════════════════════════════════\n');

let pass = 0;
let fail = 0;

function assert(testName, condition, details = '') {
  if (condition) {
    console.log(`  ✅ PASS [${String(pass + 1).padStart(2, '0')}]: ${testName} ${details ? '(' + details + ')' : ''}`);
    pass++;
  } else {
    console.error(`  ❌ FAIL: ${testName} ${details ? '(' + details + ')' : ''}`);
    fail++;
  }
}

async function runLiveValidation() {
  try {
    // ── 1. Check Frontend Live Deployment & Static Assets ──
    console.log('── [1] التحقق من نشر ملفات الـ Frontend على Cloudflare Pages ──');

    const resUtils = await fetch(`${FRONTEND_URL}/assets/js/product-utils.js?_t=${Date.now()}`);
    const textUtils = await resUtils.text();
    assert('product-utils.js deployed & contains calculateClientShippingCost', textUtils.includes('calculateClientShippingCost'), `Status: ${resUtils.status}`);

    const resProduct = await fetch(`${FRONTEND_URL}/product.html?_t=${Date.now()}`);
    const textProduct = await resProduct.text();
    assert('product.html deployed & contains updateShippingSummary', textProduct.includes('updateShippingSummary'), `Status: ${resProduct.status}`);
    assert('product.html has no old phone-confirmation shipping label', !textProduct.includes('حسب الولاية (يُحدد هاتفياً)'));

    const resIndex = await fetch(`${FRONTEND_URL}/index.html?_t=${Date.now()}`);
    const textIndex = await resIndex.text();
    assert('index.html deployed & contains updateLpShippingSummary', textIndex.includes('updateLpShippingSummary'), `Status: ${resIndex.status}`);
    assert('index.html landing page has no old confirmation note', !textIndex.includes('تكلفة التوصيل تُحدَّد بعد التأكيد معك هاتفياً'));

    const resAdmin = await fetch(`${FRONTEND_URL}/admin.html?_t=${Date.now()}`);
    const textAdmin = await resAdmin.text();
    assert('admin.html deployed & contains sec-shipping', textAdmin.includes('id="sec-shipping"'), `Status: ${resAdmin.status}`);
    assert('admin.html contains Yalidine initial reference tariff wording', textAdmin.includes('استيراد التعريفة الابتدائية لـ Yalidine'));
    assert('admin.html contains p_weight in product modal', textAdmin.includes('id="p_weight"'));
    assert('addCarrierModal uses modal-overlay structure on production', textAdmin.includes('class="modal-overlay" id="addCarrierModal"'));
    assert('old unshielded modal id="addCarrierModal" removed from production', !textAdmin.includes('class="modal" id="addCarrierModal"'));
    assert('admin.html has p_price wrapped in input-group with currency addon (دج)', textAdmin.includes('id="p_price"') && textAdmin.includes('class="input-addon">دج</span>'));
    assert('admin.html has p_old_price wrapped in input-group with currency addon (دج)', textAdmin.includes('id="p_old_price"'));

    const resAdminCss = await fetch(`${FRONTEND_URL}/assets/css/admin.css?_t=${Date.now()}`);
    const textAdminCss = await resAdminCss.text();
    assert('admin.css deployed & contains .input-group rule', textAdminCss.includes('.input-group'), `Status: ${resAdminCss.status}`);
    assert('admin.css deployed & contains .input-addon rule', textAdminCss.includes('.input-addon'));

    // ── 2. Check Live Backend Catalog & Settings API ──
    console.log('\n── [2] التحقق من الكتالوج والإعدادات الحية من Worker API ──');

    const resCat = await fetch(`${API_URL}?action=catalog`);
    const dataCat = await resCat.json();
    assert('Worker API returns catalog', Array.isArray(dataCat.products) && dataCat.products.length > 0, `Products: ${dataCat.products?.length}`);

    const sampleProduct = dataCat.products[0];
    assert('Product schema includes weight property', sampleProduct && ('weight' in sampleProduct), `Product: ${sampleProduct?.name}, Weight: ${sampleProduct?.weight}`);
    assert('Existing products default to weight = null', sampleProduct && sampleProduct.weight === null, `Weight: ${sampleProduct?.weight}`);

    // ── 3. Live Server-Side Order & Shipping Engine Tests ──
    console.log('\n── [3] اختبار حساب الشحن الحي في الطلبات (Server-Side Calculation) ──');

    // Test 3A: Alger (16) Home -> 500 DA
    const testPhoneA = '0555' + Math.floor(100000 + Math.random() * 900000);
    const testOrderHome = {
      name: 'Test Live Phase17',
      phone: testPhoneA,
      wilaya_code: '16',
      wilaya_ar: 'الجزائر',
      wilaya_en: 'Alger',
      municipality: 'الجزائر الوسطى',
      delivery_type: 'Home',
      items_json: JSON.stringify([{ id: sampleProduct.id, qty: 1 }]),
      shipping_cost: 99999 // Client-sent fake cost — should be ignored!
    };

    const resOrderHome = await fetch(`${API_URL}?action=order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testOrderHome)
    });
    const dataOrderHome = await resOrderHome.json();
    assert('Live Order Home created successfully', dataOrderHome.ok === true, `Order ID: ${dataOrderHome.order_id}`);

    // Verify stored fields via trackOrder
    const resTrackHome = await fetch(`${API_URL}?action=track&order_id=${dataOrderHome.order_id}`);
    const dataTrackHome = await resTrackHome.json();
    assert('Track Order Home found', dataTrackHome.found === true);
    assert('Server Authoritative Alger Home Shipping Rate (500 DA applied, fake 99999 ignored)', dataTrackHome.order?.shipping_cost === 500, `Got: ${dataTrackHome.order?.shipping_cost} DA`);
    assert('Delivery Company is set to yalidine', dataTrackHome.order?.delivery_company === 'yalidine', `Company: ${dataTrackHome.order?.delivery_company}`);
    assert('Total correctly calculated (Price + 500 DA)', dataOrderHome.total === sampleProduct.price + 500, `Total: ${dataOrderHome.total} vs expected ${sampleProduct.price + 500}`);

    // Test 3B: Alger (16) Office (Stop Desk) -> 350 DA
    const testPhoneB = '0555' + Math.floor(100000 + Math.random() * 900000);
    const testOrderOffice = {
      name: 'Test Live Phase17 StopDesk',
      phone: testPhoneB,
      wilaya_code: '16',
      wilaya_ar: 'الجزائر',
      wilaya_en: 'Alger',
      municipality: 'الجزائر الوسطى',
      delivery_type: 'Office',
      items_json: JSON.stringify([{ id: sampleProduct.id, qty: 1 }])
    };

    const resOrderOffice = await fetch(`${API_URL}?action=order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testOrderOffice)
    });
    const dataOrderOffice = await resOrderOffice.json();
    assert('Live Order Stop Desk created successfully', dataOrderOffice.ok === true, `Order ID: ${dataOrderOffice.order_id}`);

    const resTrackOffice = await fetch(`${API_URL}?action=track&order_id=${dataOrderOffice.order_id}`);
    const dataTrackOffice = await resTrackOffice.json();
    assert('Server Authoritative Alger Stop Desk Rate (350 DA)', dataTrackOffice.order?.shipping_cost === 350, `Got: ${dataTrackOffice.order?.shipping_cost} DA`);

    // Test 3C: Adrar (01) Home -> 1400 DA
    const testPhoneC = '0555' + Math.floor(100000 + Math.random() * 900000);
    const testOrderAdrar = {
      name: 'Test Live Phase17 Adrar',
      phone: testPhoneC,
      wilaya_code: '01',
      wilaya_ar: 'أدرار',
      wilaya_en: 'Adrar',
      municipality: 'أدرار',
      delivery_type: 'Home',
      items_json: JSON.stringify([{ id: sampleProduct.id, qty: 1 }])
    };

    const resOrderAdrar = await fetch(`${API_URL}?action=order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testOrderAdrar)
    });
    const dataOrderAdrar = await resOrderAdrar.json();
    assert('Live Order Adrar created successfully', dataOrderAdrar.ok === true, `Order ID: ${dataOrderAdrar.order_id}`);

    const resTrackAdrar = await fetch(`${API_URL}?action=track&order_id=${dataOrderAdrar.order_id}`);
    const dataTrackAdrar = await resTrackAdrar.json();
    assert('Server Authoritative Adrar Home Rate (1400 DA)', dataTrackAdrar.order?.shipping_cost === 1400, `Got: ${dataTrackAdrar.order?.shipping_cost} DA`);

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(`📊 LIVE PRODUCTION VALIDATION: ${pass} PASSED, ${fail} FAILED`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    if (fail > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error('Fatal test error:', err);
    process.exit(1);
  }
}

runLiveValidation();
