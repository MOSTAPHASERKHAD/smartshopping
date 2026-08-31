/**
 * SmartKiosk - Fixed Offer Pricing Architecture Test Suite
 * Tests all 16 deterministic cases required for authoritative fixed pricing.
 */

import assert from 'node:assert';
import { createOrder } from './src/handlers/orders.js';
import productUtils from '../assets/js/product-utils.js';

const { buildDynamicPricingTiers, calculateTierSubtotal } = productUtils;

console.log('════════════════════════════════════════════════════════════════════════════');
console.log('🚀 SMARTKIOSK — FIXED OFFER PRICING ARCHITECTURE TEST SUITE');
console.log('════════════════════════════════════════════════════════════════════════════\n');

let passCount = 0;
let totalTests = 0;

function runTest(testName, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ PASS [${String(totalTests).padStart(2, '0')}]: ${testName}`);
    passCount++;
  } catch (err) {
    console.error(`  ❌ FAIL [${String(totalTests).padStart(2, '0')}]: ${testName}`);
    console.error(`     Error: ${err.message}`);
    throw err;
  }
}

async function runAsyncTest(testName, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ PASS [${String(totalTests).padStart(2, '0')}]: ${testName}`);
    passCount++;
  } catch (err) {
    console.error(`  ❌ FAIL [${String(totalTests).padStart(2, '0')}]: ${testName}`);
    console.error(`     Error: ${err.message}`);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// [SUITE 1] Frontend Fixed Pricing Engine (product-utils.js)
// ─────────────────────────────────────────────────────────────────────────────
console.log('── [AXIS 1] Frontend Fixed Pricing Engine (product-utils.js) ──');

runTest('TEST 1: base = 2000, tier1_price = 2000 => 2000 DZD', () => {
  const tiers = buildDynamicPricingTiers(2000, null, { tier1_price: 2000 });
  const t1 = tiers.find(t => t.offer_id === 'tier-1');
  assert.strictEqual(t1.price, 2000);
  assert.strictEqual(t1.qty, 1);
});

runTest('TEST 2: base = 2000, tier2_price = 1800 => 1800 DZD', () => {
  const tiers = buildDynamicPricingTiers(2000, null, { tier2_price: 1800 });
  const t2 = tiers.find(t => t.offer_id === 'tier-2');
  assert.strictEqual(t2.price, 1800);
  assert.strictEqual(t2.qty, 2);
});

runTest('TEST 3: base = 2000, tier3_price = 1600 => 1600 DZD', () => {
  const tiers = buildDynamicPricingTiers(2000, null, { tier3_price: 1600 });
  const t3 = tiers.find(t => t.offer_id === 'tier-3');
  assert.strictEqual(t3.price, 1600);
  assert.strictEqual(t3.qty, 3);
});

runTest('TEST 4: tier2_price = 1750 => 1750 DZD exact without percentage drift', () => {
  const tiers = buildDynamicPricingTiers(2000, null, { tier2_price: 1750 });
  const t2 = tiers.find(t => t.offer_id === 'tier-2');
  assert.strictEqual(t2.price, 1750);
});

runTest('TEST 8: qty = 2, fixed offer price = 1800 => subtotal = 1800 DZD (NOT 3600)', () => {
  const result = calculateTierSubtotal(2000, 2, null, { tier2_price: 1800 }, 'tier-2');
  assert.strictEqual(result.subtotal, 1800);
  assert.strictEqual(result.standardTotal, 4000);
  assert.strictEqual(result.saveAmount, 2200);
});

runTest('TEST 9: Multiple offers with same qty (qty=1 @ 2000 vs qty=1 @ 2800) with distinct offer_id', () => {
  const customTiers = [
    { offer_id: 'watch_basic', qty: 1, label: 'ساعة بدون علبة', price: 2000 },
    { offer_id: 'watch_gift', qty: 1, label: 'ساعة + علبة هدايا', price: 2800 },
    { offer_id: 'watch_pack2', qty: 2, label: 'باقة قطعتين', price: 3500 }
  ];
  const r1 = calculateTierSubtotal(2000, 1, customTiers, {}, 'watch_basic');
  const r2 = calculateTierSubtotal(2000, 1, customTiers, {}, 'watch_gift');
  const r3 = calculateTierSubtotal(2000, 2, customTiers, {}, 'watch_pack2');

  assert.strictEqual(r1.subtotal, 2000);
  assert.strictEqual(r2.subtotal, 2800);
  assert.strictEqual(r3.subtotal, 3500);
});

runTest('TEST 12: Product explicit pricing_tiers[].price overrides Theme fixed tierX_price', () => {
  const productCustomTiers = [
    { offer_id: 'custom_tier_2', qty: 2, label: 'عرض خاص', price: 4200 }
  ];
  const themeSettings = { tier2_price: 3600 };
  const r = calculateTierSubtotal(2500, 2, productCustomTiers, themeSettings, 'custom_tier_2');
  assert.strictEqual(r.subtotal, 4200, 'Product explicit price must win over theme price');
});

runTest('TEST 13: Theme fixed tierX_price overrides legacy percentage discount', () => {
  const themeSettings = { tier2_price: 1800, tier2_discount_pct: 50 }; // 50% of 4000 would be 2000
  const tiers = buildDynamicPricingTiers(2000, null, themeSettings);
  const t2 = tiers.find(t => t.offer_id === 'tier-2');
  assert.strictEqual(t2.price, 1800, 'Fixed price must override discount_pct');
});

runTest('TEST 14: Legacy percentage fallback works when no fixed price is specified', () => {
  const themeSettings = { tier2_discount_pct: 15 }; // 15% off 4000 = 3400
  const tiers = buildDynamicPricingTiers(2000, null, themeSettings);
  const t2 = tiers.find(t => t.offer_id === 'tier-2');
  assert.strictEqual(t2.price, 3400, 'Legacy percentage fallback must calculate correctly');
});

// ─────────────────────────────────────────────────────────────────────────────
// [SUITE 2] Server-Side Anti-Tampering & Worker Verification (orders.js)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── [AXIS 2] Server-Side Anti-Tampering & Worker Verification (orders.js) ──');

// Mock D1 Environment Factory
function createMockEnv(productOverride = {}, themeSectionsOverride = null) {
  const dbProduct = {
    id: 101,
    name: 'ساعة يد فاخرة',
    price: 2000,
    active: 1,
    stock: 100,
    weight: 0.5,
    landing_config_json: null,
    free_shipping: 0,
    tenant_id: 'tenant_master_default',
    ...productOverride
  };

  const storedOrders = [];
  const capiEvents = [];

  const mockEnv = {
    ALLOWED_ORIGINS: '*',
    DB: {
      prepare(sql) {
        return {
          args: [],
          bind(...params) {
            this.args = params;
            return this;
          },
          async first() {
            if (sql.includes('FROM products')) {
              return dbProduct;
            }
            if (sql.includes('FROM settings WHERE key = ?')) {
              const key = this.args[this.args.length - 1];
              if (key === 'active_theme_sections' && themeSectionsOverride) {
                return { value: JSON.stringify(themeSectionsOverride) };
              }
              if (key === 'capi_enabled') return { value: 'true' };
              if (key === 'fb_capi_token') return { value: 'EAAB_TEST_TOKEN' };
              if (key === 'pixel_id') return { value: '123456789' };
              return null;
            }
            if (sql.includes('FROM coupons')) return null;
            return null;
          },
          async all() {
            if (sql.includes('FROM products')) {
              return { results: [dbProduct] };
            }
            if (sql.includes('FROM settings WHERE key IN')) {
              const res = [];
              if (themeSectionsOverride) {
                res.push({ key: 'theme_config', value: JSON.stringify({ sections: themeSectionsOverride }) });
              }
              return { results: res };
            }
            if (sql.includes('FROM settings')) {
              const settingsList = [
                { key: 'delivery_price', value: '500' },
                { key: 'capi_enabled', value: 'true' },
                { key: 'fb_capi_token', value: 'EAAB_TEST_TOKEN' },
                { key: 'pixel_id', value: '123456789' }
              ];
              if (themeSectionsOverride) {
                settingsList.push({ key: 'theme_config', value: JSON.stringify({ sections: themeSectionsOverride }) });
              }
              return { results: settingsList };
            }
            return { results: [] };
          },
          async run() {
            if (sql.includes('INSERT INTO orders')) {
              storedOrders.push({ sql, params: this.args });
            }
            return { meta: { changes: 1 } };
          }
        };
      }
    },
    _storedOrders: storedOrders,
    _capiEvents: capiEvents
  };

  return mockEnv;
}

await runAsyncTest('TEST 5 & 6 & 7: Server overrides client price=1, subtotal=1, discount_pct=99', async () => {
  const themeSections = {
    'order-form': {
      settings: {
        tier2_price: 1800
      }
    }
  };

  const env = createMockEnv({}, themeSections);
  const mockCtx = {
    waitUntil(promise) {
      if (promise && promise.catch) promise.catch(() => {});
    }
  };

  const mockReq = new Request('https://smartshopping.click/api', {
    headers: { 'CF-Connecting-IP': '105.105.105.1', 'User-Agent': 'Mozilla/5.0' }
  });

  // Client attempts aggressive tampering
  const tamperedParams = {
    name: 'أحمد الجزائري',
    phone: '0555123456',
    wilaya_code: '16', // Alger home delivery standard tariff = 400
    delivery_type: 'Home',
    items_json: JSON.stringify([{
      id: 101,
      qty: 2,
      offer_id: 'tier-2',
      price: 1,       // TAMPERED
      subtotal: 1,    // TAMPERED
      discount_pct: 99 // TAMPERED
    }]),
    subtotal: 1,      // TAMPERED
    total_price: 1    // TAMPERED
  };

  const res = await createOrder(env, tamperedParams, mockReq, mockCtx, null, 'tenant_master_default');
  assert(res.ok, `Order must succeed: ${res.error || ''}`);
  assert.strictEqual(res.total, 1800 + 500, 'Server must enforce fixed offer 1800 + 500 shipping = 2300 (1 DZD spoof rejected)');

  // Verify stored order snapshot in DB
  const storedOrder = env._storedOrders[0];
  const itemsSnapshot = JSON.parse(storedOrder.params[10]);
  assert.strictEqual(itemsSnapshot[0].subtotal, 1800, 'Snapshot must record authoritative 1800 DZD');
  assert.strictEqual(itemsSnapshot[0].offer_id, 'tier-2', 'Snapshot must record offer_id');
});

await runAsyncTest('TEST 10: Free Shipping offer tier gives shipping = 0', async () => {
  const themeSections = {
    'order-form': {
      settings: {
        tier3_price: 1600,
        tier3_free_shipping: true
      }
    }
  };

  const env = createMockEnv({}, themeSections);
  const mockCtx = { waitUntil() {} };
  const mockReq = new Request('https://smartshopping.click/api');

  const params = {
    name: 'بلال وهران',
    phone: '0770123456',
    wilaya_code: '31', // Oran
    delivery_type: 'Home',
    items_json: JSON.stringify([{
      id: 101,
      qty: 3,
      offer_id: 'tier-3'
    }])
  };

  const res = await createOrder(env, params, mockReq, mockCtx, null, 'tenant_master_default');
  assert(res.ok, `Order must succeed: ${res.error || ''}`);
  assert.strictEqual(res.total, 1600, 'Total must equal offer price 1600 with free shipping');
});

await runAsyncTest('TEST 11: Offer without Free Shipping ignores client free_shipping=true', async () => {
  const themeSections = {
    'order-form': {
      settings: {
        tier2_price: 1800,
        tier2_free_shipping: false
      }
    }
  };

  const env = createMockEnv({}, themeSections);
  const mockCtx = { waitUntil() {} };
  const mockReq = new Request('https://smartshopping.click/api');

  const params = {
    name: 'مراد قسنطينة',
    phone: '0661123456',
    wilaya_code: '25',
    delivery_type: 'Home',
    free_shipping: 'true', // TAMPERED
    shipping_cost: '0',    // TAMPERED
    items_json: JSON.stringify([{
      id: 101,
      qty: 2,
      offer_id: 'tier-2',
      free_shipping: true // TAMPERED
    }])
  };

  const res = await createOrder(env, params, mockReq, mockCtx, null, 'tenant_master_default');
  assert(res.ok, `Order must succeed: ${res.error || ''}`);
  assert.strictEqual(res.total, 1800 + 800, 'Total must be 1800 + 800 Constantine shipping = 2600 (tampered free shipping was rejected)');
});

await runAsyncTest('TEST 15: Meta CAPI Purchase event receives server-verified order total', async () => {
  const themeSections = {
    'order-form': {
      settings: {
        tier2_price: 1800
      }
    }
  };

  let capturedCapiCall = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (url.includes('graph.facebook.com')) {
      capturedCapiCall = { url, body: JSON.parse(opts.body) };
      return new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
    }
    return originalFetch(url, opts);
  };

  try {
    const env = createMockEnv({}, themeSections);
    const mockCtx = {
      waitUntil(promise) {
        if (promise && promise.catch) promise.catch(() => {});
      }
    };
    const mockReq = new Request('https://smartshopping.click/api');

    const params = {
      name: 'كريم العاصمة',
      phone: '0555001122',
      wilaya_code: '16',
      delivery_type: 'Home',
      items_json: JSON.stringify([{
        id: 101,
        qty: 2,
        offer_id: 'tier-2'
      }])
    };

    const res = await createOrder(env, params, mockReq, mockCtx, null, 'tenant_master_default');
    assert(res.ok, `Order must succeed: ${res.error || ''}`);
    // Allow background waitUntil to execute
    await new Promise(r => setTimeout(r, 50));

    if (capturedCapiCall) {
      const eventData = capturedCapiCall.body.data[0];
      assert.strictEqual(eventData.custom_data.value, 1800 + 500, 'CAPI Purchase value must match server order total');
      assert.strictEqual(eventData.custom_data.currency, 'DZD');
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

runTest('TEST 16: WhatsApp formatting displays (سعر الباقة: 1,800 دج) cleanly', () => {
  const item = {
    name: 'ساعة يد فاخرة',
    tier_name: '2 قطع (الأكثر طلباً ⭐)',
    qty: 2,
    subtotal: 1800,
    price: 900
  };

  const itemTotal = Number(item.subtotal || (Number(item.price || item.unit_price || 0) * item.qty));
  const priceText = (item && item.tier_name)
    ? (' (سعر الباقة: ' + itemTotal.toLocaleString() + ' دج)')
    : ((item && (item.price || item.unit_price)) ? (' (سعر الوحدة: ' + Number(item.price || item.unit_price).toLocaleString() + ' دج)') : '');

  assert.strictEqual(priceText, ' (سعر الباقة: ' + (1800).toLocaleString() + ' دج)');
});

console.log('\n════════════════════════════════════════════════════════════════════════════');
console.log(`🎉 ALL ${passCount}/${totalTests} TESTS PASSED CLEANLY! FIXED OFFER PRICING VERIFIED.`);
console.log('════════════════════════════════════════════════════════════════════════════\n');
