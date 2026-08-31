/**
 * SmartKiosk - Granular Free Shipping Modes Test Suite (20 Deterministic Scenarios)
 */

import assert from 'node:assert';
import { createOrder } from './src/handlers/orders.js';
import productUtils from '../assets/js/product-utils.js';

const { buildDynamicPricingTiers, calculateTierSubtotal, resolveFreeShippingMode } = productUtils;

console.log('════════════════════════════════════════════════════════════════════════════');
console.log('🚀 SMARTKIOSK — GRANULAR FREE SHIPPING MODES TEST SUITE (20/20)');
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

function createMockEnv(productOverrides = {}, themeSectionsOverride = null) {
  const dbProduct = {
    id: 101,
    name: 'ساعة رجالية فاخرة',
    price: 3000,
    active: 1,
    stock: 50,
    weight: 0.5,
    free_shipping: 0,
    landing_config_json: JSON.stringify(productOverrides)
  };

  const storedOrders = [];
  const mockEnv = {
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
              if (key === 'capi_enabled') return { value: 'false' };
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
              const res = [
                {
                  key: 'shipping_config',
                  value: JSON.stringify({
                    version: 2,
                    active_company: 'yalidine',
                    fees: {
                      '16': { home: 500, office: 350 }, // Alger
                      '47': { home: 900, office: 700 }  // Ghardaia (Remote)
                    }
                  })
                },
                { key: 'shipping_home', value: '500' },
                { key: 'shipping_office', value: '350' },
                { key: 'shipping_remote', value: '200' },
                { key: 'free_shipping_enabled', value: 'false' }
              ];
              if (themeSectionsOverride) {
                res.push({ key: 'theme_config', value: JSON.stringify({ sections: themeSectionsOverride }) });
              }
              return { results: res };
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
    _storedOrders: storedOrders
  };

  return mockEnv;
}

const mockCtx = {
  waitUntil(promise) {
    if (promise && promise.catch) promise.catch(() => {});
  }
};

const mockReq = new Request('https://smartshopping.click/api', {
  headers: { 'CF-Connecting-IP': '105.105.105.1', 'User-Agent': 'Mozilla/5.0' }
});

// ─────────────────────────────────────────────────────────────────────────────
// [SUITE 1] Server-Side Granular Free Shipping Evaluation
// ─────────────────────────────────────────────────────────────────────────────
console.log('── [AXIS 1] Server-Side Free Shipping Modes (none / home / office / both) ──');

// Test 1: mode='none' + Home => 500 DZD shipping
await runAsyncTest('TEST 1: mode="none" + Home delivery charges standard home rate (500 DZD)', async () => {
  const productConfig = {
    pricing_tiers: [
      { offer_id: 'tier-1', qty: 1, price: 3000, free_shipping_mode: 'none' }
    ]
  };
  const env = createMockEnv(productConfig);
  const params = {
    name: 'علي محمد',
    phone: '0555123456',
    wilaya_code: '16',
    delivery_type: 'Home',
    items_json: JSON.stringify([{ id: 101, qty: 1, offer_id: 'tier-1' }])
  };
  const res = await createOrder(env, params, mockReq, mockCtx, null, 'tenant_1');
  assert(res.ok, res.error);
  const stored = env._storedOrders[0];
  assert.strictEqual(stored.params[12], 500, 'Stored shipping cost must be 500');
  assert.strictEqual(res.total, 3500);
});

// Test 2: mode='none' + Office => 350 DZD shipping
await runAsyncTest('TEST 2: mode="none" + Office delivery charges standard office rate (350 DZD)', async () => {
  const productConfig = {
    pricing_tiers: [
      { offer_id: 'tier-1', qty: 1, price: 3000, free_shipping_mode: 'none' }
    ]
  };
  const env = createMockEnv(productConfig);
  const params = {
    name: 'علي محمد',
    phone: '0555123456',
    wilaya_code: '16',
    delivery_type: 'Office',
    items_json: JSON.stringify([{ id: 101, qty: 1, offer_id: 'tier-1' }])
  };
  const res = await createOrder(env, params, mockReq, mockCtx, null, 'tenant_1');
  assert(res.ok, res.error);
  const stored = env._storedOrders[0];
  assert.strictEqual(stored.params[12], 350, 'Stored shipping cost must be 350');
  assert.strictEqual(res.total, 3350);
});

// Test 3: mode='home' + Home => 0 DZD shipping
await runAsyncTest('TEST 3: mode="home" + Home delivery waives shipping to 0 DZD', async () => {
  const productConfig = {
    pricing_tiers: [
      { offer_id: 'tier-1', qty: 1, price: 2800, free_shipping_mode: 'home' }
    ]
  };
  const env = createMockEnv(productConfig);
  const params = {
    name: 'علي محمد',
    phone: '0555123456',
    wilaya_code: '16',
    delivery_type: 'Home',
    items_json: JSON.stringify([{ id: 101, qty: 1, offer_id: 'tier-1' }])
  };
  const res = await createOrder(env, params, mockReq, mockCtx, null, 'tenant_1');
  assert(res.ok, res.error);
  const stored = env._storedOrders[0];
  assert.strictEqual(stored.params[12], 0, 'Stored shipping cost must be 0');
  assert.strictEqual(res.total, 2800);
});

// Test 4: mode='home' + Office => 350 DZD shipping
await runAsyncTest('TEST 4: mode="home" + Office delivery charges standard office rate (350 DZD)', async () => {
  const productConfig = {
    pricing_tiers: [
      { offer_id: 'tier-1', qty: 1, price: 2800, free_shipping_mode: 'home' }
    ]
  };
  const env = createMockEnv(productConfig);
  const params = {
    name: 'علي محمد',
    phone: '0555123456',
    wilaya_code: '16',
    delivery_type: 'Office',
    items_json: JSON.stringify([{ id: 101, qty: 1, offer_id: 'tier-1' }])
  };
  const res = await createOrder(env, params, mockReq, mockCtx, null, 'tenant_1');
  assert(res.ok, res.error);
  const stored = env._storedOrders[0];
  assert.strictEqual(stored.params[12], 350, 'Stored shipping cost must be 350');
  assert.strictEqual(res.total, 3150);
});

// Test 5: mode='office' + Home => 500 DZD shipping
await runAsyncTest('TEST 5: mode="office" + Home delivery charges standard home rate (500 DZD)', async () => {
  const productConfig = {
    pricing_tiers: [
      { offer_id: 'tier-1', qty: 1, price: 2800, free_shipping_mode: 'office' }
    ]
  };
  const env = createMockEnv(productConfig);
  const params = {
    name: 'علي محمد',
    phone: '0555123456',
    wilaya_code: '16',
    delivery_type: 'Home',
    items_json: JSON.stringify([{ id: 101, qty: 1, offer_id: 'tier-1' }])
  };
  const res = await createOrder(env, params, mockReq, mockCtx, null, 'tenant_1');
  assert(res.ok, res.error);
  const stored = env._storedOrders[0];
  assert.strictEqual(stored.params[12], 500, 'Stored shipping cost must be 500');
  assert.strictEqual(res.total, 3300);
});

// Test 6: mode='office' + Office => 0 DZD shipping
await runAsyncTest('TEST 6: mode="office" + Office delivery waives shipping to 0 DZD', async () => {
  const productConfig = {
    pricing_tiers: [
      { offer_id: 'tier-1', qty: 1, price: 2800, free_shipping_mode: 'office' }
    ]
  };
  const env = createMockEnv(productConfig);
  const params = {
    name: 'علي محمد',
    phone: '0555123456',
    wilaya_code: '16',
    delivery_type: 'Office',
    items_json: JSON.stringify([{ id: 101, qty: 1, offer_id: 'tier-1' }])
  };
  const res = await createOrder(env, params, mockReq, mockCtx, null, 'tenant_1');
  assert(res.ok, res.error);
  const stored = env._storedOrders[0];
  assert.strictEqual(stored.params[12], 0, 'Stored shipping cost must be 0');
  assert.strictEqual(res.total, 2800);
});

// Test 7: mode='both' + Home => 0 DZD shipping
await runAsyncTest('TEST 7: mode="both" + Home delivery waives shipping to 0 DZD', async () => {
  const productConfig = {
    pricing_tiers: [
      { offer_id: 'tier-1', qty: 1, price: 2800, free_shipping_mode: 'both' }
    ]
  };
  const env = createMockEnv(productConfig);
  const params = {
    name: 'علي محمد',
    phone: '0555123456',
    wilaya_code: '16',
    delivery_type: 'Home',
    items_json: JSON.stringify([{ id: 101, qty: 1, offer_id: 'tier-1' }])
  };
  const res = await createOrder(env, params, mockReq, mockCtx, null, 'tenant_1');
  assert(res.ok, res.error);
  const stored = env._storedOrders[0];
  assert.strictEqual(stored.params[12], 0, 'Stored shipping cost must be 0');
  assert.strictEqual(res.total, 2800);
});

// Test 8: mode='both' + Office => 0 DZD shipping
await runAsyncTest('TEST 8: mode="both" + Office delivery waives shipping to 0 DZD', async () => {
  const productConfig = {
    pricing_tiers: [
      { offer_id: 'tier-1', qty: 1, price: 2800, free_shipping_mode: 'both' }
    ]
  };
  const env = createMockEnv(productConfig);
  const params = {
    name: 'علي محمد',
    phone: '0555123456',
    wilaya_code: '16',
    delivery_type: 'Office',
    items_json: JSON.stringify([{ id: 101, qty: 1, offer_id: 'tier-1' }])
  };
  const res = await createOrder(env, params, mockReq, mockCtx, null, 'tenant_1');
  assert(res.ok, res.error);
  const stored = env._storedOrders[0];
  assert.strictEqual(stored.params[12], 0, 'Stored shipping cost must be 0');
  assert.strictEqual(res.total, 2800);
});

// Test 9: mode='both' + Remote Wilaya (47) => 0 DZD shipping
await runAsyncTest('TEST 9: mode="both" for Remote Wilaya (47) waives full shipping to 0 DZD', async () => {
  const productConfig = {
    pricing_tiers: [
      { offer_id: 'tier-1', qty: 1, price: 2800, free_shipping_mode: 'both' }
    ]
  };
  const env = createMockEnv(productConfig);
  const params = {
    name: 'علي محمد',
    phone: '0555123456',
    wilaya_code: '47',
    delivery_type: 'Home',
    items_json: JSON.stringify([{ id: 101, qty: 1, offer_id: 'tier-1' }])
  };
  const res = await createOrder(env, params, mockReq, mockCtx, null, 'tenant_1');
  assert(res.ok, res.error);
  const stored = env._storedOrders[0];
  assert.strictEqual(stored.params[12], 0, 'Stored shipping cost must be 0');
  assert.strictEqual(res.total, 2800);
});

// ─────────────────────────────────────────────────────────────────────────────
// [SUITE 2] Anti-Tampering & Security Protections
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── [AXIS 2] Anti-Tampering & Security Audits ──');

// Test 10: Client spoofs free_shipping:true on mode='none' offer
await runAsyncTest('TEST 10: Anti-Tampering: Client spoofing free_shipping:true is rejected when server mode="none"', async () => {
  const productConfig = {
    pricing_tiers: [
      { offer_id: 'tier-1', qty: 1, price: 3000, free_shipping_mode: 'none' }
    ]
  };
  const env = createMockEnv(productConfig);
  const tamperedParams = {
    name: 'مخترق',
    phone: '0555123456',
    wilaya_code: '16',
    delivery_type: 'Home',
    free_shipping: true,
    free_shipping_mode: 'both',
    shipping_cost: 0,
    total_price: 3000,
    items_json: JSON.stringify([{ id: 101, qty: 1, offer_id: 'tier-1', free_shipping: true, free_shipping_mode: 'both' }])
  };
  const res = await createOrder(env, tamperedParams, mockReq, mockCtx, null, 'tenant_1');
  assert(res.ok, res.error);
  const stored = env._storedOrders[0];
  assert.strictEqual(stored.params[12], 500, 'Server must enforce 500 DZD shipping');
  assert.strictEqual(res.total, 3500, 'Server must calculate 3000 + 500 = 3500 DZD');
});

// Test 11: Client spoofs mode='both' when server mode='home' and chooses Office
await runAsyncTest('TEST 11: Anti-Tampering: Client spoofing mode="both" on Office delivery is overridden by server mode="home"', async () => {
  const productConfig = {
    pricing_tiers: [
      { offer_id: 'tier-1', qty: 1, price: 2800, free_shipping_mode: 'home' }
    ]
  };
  const env = createMockEnv(productConfig);
  const tamperedParams = {
    name: 'مخترق',
    phone: '0555123456',
    wilaya_code: '16',
    delivery_type: 'Office',
    free_shipping_mode: 'both',
    items_json: JSON.stringify([{ id: 101, qty: 1, offer_id: 'tier-1', free_shipping_mode: 'both' }])
  };
  const res = await createOrder(env, tamperedParams, mockReq, mockCtx, null, 'tenant_1');
  assert(res.ok, res.error);
  const stored = env._storedOrders[0];
  assert.strictEqual(stored.params[12], 350, 'Office delivery must charge 350 DZD as server tier only grants home free');
  assert.strictEqual(res.total, 3150);
});

// ─────────────────────────────────────────────────────────────────────────────
// [SUITE 3] Multi-Tier, Backward Compatibility & Theme Configuration
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── [AXIS 3] Multi-Tier, Compatibility & System Integrity ──');

// Test 12: Independent Offer Modes across tiers
await runAsyncTest('TEST 12: Independent Offer Modes (Tier 1="none", Tier 2="home", Tier 3="both")', async () => {
  const productConfig = {
    pricing_tiers: [
      { offer_id: 'tier-1', qty: 1, price: 3000, free_shipping_mode: 'none' },
      { offer_id: 'tier-2', qty: 2, price: 5500, free_shipping_mode: 'home' },
      { offer_id: 'tier-3', qty: 3, price: 7500, free_shipping_mode: 'both' }
    ]
  };

  const env = createMockEnv(productConfig);

  // Select tier-2 with Home => 0 DZD
  const res2Home = await createOrder(env, {
    name: 'زبون 2',
    phone: '0555123456',
    wilaya_code: '16',
    delivery_type: 'Home',
    items_json: JSON.stringify([{ id: 101, qty: 2, offer_id: 'tier-2' }])
  }, mockReq, mockCtx, null, 'tenant_1');
  const stored2Home = env._storedOrders[0];
  assert.strictEqual(stored2Home.params[12], 0);

  // Select tier-2 with Office => 350 DZD
  const env2 = createMockEnv(productConfig);
  const res2Office = await createOrder(env2, {
    name: 'زبون 2',
    phone: '0555123456',
    wilaya_code: '16',
    delivery_type: 'Office',
    items_json: JSON.stringify([{ id: 101, qty: 2, offer_id: 'tier-2' }])
  }, mockReq, mockCtx, null, 'tenant_1');
  const stored2Office = env2._storedOrders[0];
  assert.strictEqual(stored2Office.params[12], 350);

  // Select tier-3 with Office => 0 DZD
  const env3 = createMockEnv(productConfig);
  const res3Office = await createOrder(env3, {
    name: 'زبون 3',
    phone: '0555123456',
    wilaya_code: '16',
    delivery_type: 'Office',
    items_json: JSON.stringify([{ id: 101, qty: 3, offer_id: 'tier-3' }])
  }, mockReq, mockCtx, null, 'tenant_1');
  const stored3Office = env3._storedOrders[0];
  assert.strictEqual(stored3Office.params[12], 0);
});

// Test 13: Tier 1 disabled, Tier 2 qty=1, mode='home'
await runAsyncTest('TEST 13: Theme settings: Tier 1 disabled, Tier 2 explicit qty=1 with mode="home"', async () => {
  const themeSections = {
    'fast-order-form': {
      settings: {
        show_pricing_tiers: true,
        tier1_enabled: false,
        tier2_enabled: true,
        tier2_qty: 1,
        tier2_price: 2900,
        tier2_free_shipping_mode: 'home',
        tier3_enabled: false
      }
    }
  };
  const env = createMockEnv({}, themeSections);
  const res = await createOrder(env, {
    name: 'علي محمد',
    phone: '0555123456',
    wilaya_code: '16',
    delivery_type: 'Home',
    items_json: JSON.stringify([{ id: 101, qty: 1, offer_id: 'tier-2' }])
  }, mockReq, mockCtx, null, 'tenant_1');
  assert(res.ok, res.error);
  const stored = env._storedOrders[0];
  assert.strictEqual(stored.params[11], 2900, 'Subtotal must be 2900');
  assert.strictEqual(stored.params[12], 0, 'Shipping cost must be 0');
  assert.strictEqual(res.total, 2900);
});

// Test 14: Backward Compatibility: Legacy tier3_free_shipping: true => 'both'
runTest('TEST 14: Legacy tier3_free_shipping:true safely resolves to "both"', () => {
  assert.strictEqual(resolveFreeShippingMode(undefined, true), 'both');
  assert.strictEqual(resolveFreeShippingMode(undefined, false), 'none');
  assert.strictEqual(resolveFreeShippingMode('', true), 'both');
});

// Test 15: Invalid modes safely default to 'none'
runTest('TEST 15: Invalid / Malformed mode values ("xyz", null, 123) safely default to "none"', () => {
  assert.strictEqual(resolveFreeShippingMode('invalid_xyz'), 'none');
  assert.strictEqual(resolveFreeShippingMode(null), 'none');
  assert.strictEqual(resolveFreeShippingMode(123), 'none');
  assert.strictEqual(resolveFreeShippingMode('   '), 'none');
});

// Test 16: Fixed Offer Pricing Authoritative Preservation
await runAsyncTest('TEST 16: Fixed Offer Pricing Authoritative Preservation with free shipping', async () => {
  const productConfig = {
    pricing_tiers: [
      { offer_id: 'tier-2', qty: 2, price: 4990, free_shipping_mode: 'home' }
    ]
  };
  const env = createMockEnv(productConfig);
  const res = await createOrder(env, {
    name: 'علي محمد',
    phone: '0555123456',
    wilaya_code: '16',
    delivery_type: 'Home',
    items_json: JSON.stringify([{ id: 101, qty: 2, offer_id: 'tier-2' }])
  }, mockReq, mockCtx, null, 'tenant_1');
  assert(res.ok, res.error);
  const stored = env._storedOrders[0];
  assert.strictEqual(stored.params[11], 4990);
  assert.strictEqual(stored.params[12], 0);
  assert.strictEqual(res.total, 4990);
});

// Test 17: Explicit Offer Quantity Authoritative Preservation
await runAsyncTest('TEST 17: Explicit Offer Quantity Authoritative Preservation (snapshot qty=1)', async () => {
  const productConfig = {
    pricing_tiers: [
      { offer_id: 'tier-2', qty: 1, price: 2800, free_shipping_mode: 'none' }
    ]
  };
  const env = createMockEnv(productConfig);
  const res = await createOrder(env, {
    name: 'علي محمد',
    phone: '0555123456',
    wilaya_code: '16',
    delivery_type: 'Home',
    items_json: JSON.stringify([{ id: 101, qty: 1, offer_id: 'tier-2' }])
  }, mockReq, mockCtx, null, 'tenant_1');
  assert(res.ok, res.error);
  const storedOrder = env._storedOrders[0];
  const itemsSnapshot = JSON.parse(storedOrder.params[10]);
  assert.strictEqual(itemsSnapshot[0].qty, 1);
});

// Test 18: Multi-Tenant Database Query Scoping
await runAsyncTest('TEST 18: Multi-Tenant Database Query Scoping preserves isolation', async () => {
  const env = createMockEnv({});
  const res = await createOrder(env, {
    name: 'علي محمد',
    phone: '0555123456',
    wilaya_code: '16',
    delivery_type: 'Home',
    items_json: JSON.stringify([{ id: 101, qty: 1 }])
  }, mockReq, mockCtx, null, 'tenant_42');
  assert(res.ok, res.error);
  const storedOrder = env._storedOrders[0];
  assert.ok(storedOrder.params.includes('tenant_42'), 'Tenant ID tenant_42 must be bound in order insert');
});

// Test 19: Meta CAPI Purchase Value matches exact server total
await runAsyncTest('TEST 19: Meta CAPI Purchase Value matches final server total', async () => {
  const productConfig = {
    pricing_tiers: [
      { offer_id: 'tier-1', qty: 1, price: 3000, free_shipping_mode: 'none' }
    ]
  };
  const env = createMockEnv(productConfig);
  const res = await createOrder(env, {
    name: 'علي محمد',
    phone: '0555123456',
    wilaya_code: '16',
    delivery_type: 'Home',
    items_json: JSON.stringify([{ id: 101, qty: 1, offer_id: 'tier-1' }])
  }, mockReq, mockCtx, null, 'tenant_1');
  assert(res.ok, res.error);
  assert.strictEqual(res.total, 3500); // 3000 subtotal + 500 shipping
});

// Test 20: Product Utils calculateTierSubtotal matches across all delivery types
runTest('TEST 20: Frontend calculateTierSubtotal correctly identifies isFreeForDelivery for all modes', () => {
  const tiers = [
    { offer_id: 't-none', qty: 1, price: 1000, free_shipping_mode: 'none' },
    { offer_id: 't-home', qty: 1, price: 1000, free_shipping_mode: 'home' },
    { offer_id: 't-office', qty: 1, price: 1000, free_shipping_mode: 'office' },
    { offer_id: 't-both', qty: 1, price: 1000, free_shipping_mode: 'both' }
  ];

  const calcNoneHome = calculateTierSubtotal(1000, 1, tiers, {}, 't-none', 'Home');
  assert.strictEqual(calcNoneHome.isFreeForDelivery, false);

  const calcHomeHome = calculateTierSubtotal(1000, 1, tiers, {}, 't-home', 'Home');
  assert.strictEqual(calcHomeHome.isFreeForDelivery, true);

  const calcHomeOffice = calculateTierSubtotal(1000, 1, tiers, {}, 't-home', 'Office');
  assert.strictEqual(calcHomeOffice.isFreeForDelivery, false);

  const calcOfficeOffice = calculateTierSubtotal(1000, 1, tiers, {}, 't-office', 'Office');
  assert.strictEqual(calcOfficeOffice.isFreeForDelivery, true);

  const calcBothHome = calculateTierSubtotal(1000, 1, tiers, {}, 't-both', 'Home');
  assert.strictEqual(calcBothHome.isFreeForDelivery, true);

  const calcBothOffice = calculateTierSubtotal(1000, 1, tiers, {}, 't-both', 'Office');
  assert.strictEqual(calcBothOffice.isFreeForDelivery, true);
});

console.log(`\n════════════════════════════════════════════════════════════════════════════`);
console.log(`📊 FINAL RESULT: ${passCount}/${totalTests} TESTS PASSED`);
console.log(`════════════════════════════════════════════════════════════════════════════\n`);
