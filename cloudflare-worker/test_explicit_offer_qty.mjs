/**
 * Comprehensive Test Suite for Offer Quantity Explicit Resolution
 * Tests all 20 required scenarios across Frontend Engine and Cloudflare Worker.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { createOrder } from './src/handlers/orders.js';
import productUtils from '../assets/js/product-utils.js';

const { buildDynamicPricingTiers, calculateTierSubtotal } = productUtils;

let passedCount = 0;
let totalCount = 0;

function runTest(name, fn) {
  totalCount++;
  try {
    fn();
    passedCount++;
    console.log(`  ✅ PASS [${String(totalCount).padStart(2, '0')}]: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL [${String(totalCount).padStart(2, '0')}]: ${name}`);
    console.error(`     Error: ${err.message}`);
    throw err;
  }
}

async function runAsyncTest(name, fn) {
  totalCount++;
  try {
    await fn();
    passedCount++;
    console.log(`  ✅ PASS [${String(totalCount).padStart(2, '0')}]: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL [${String(totalCount).padStart(2, '0')}]: ${name}`);
    console.error(`     Error: ${err.message}`);
    throw err;
  }
}

console.log('════════════════════════════════════════════════════════════════════════════');
console.log('🧪 SMARTKIOSK — OFFER QUANTITY EXPLICIT RESOLUTION TEST SUITE');
console.log('════════════════════════════════════════════════════════════════════════════\n');

console.log('── [AXIS 1] Frontend Offer Resolution & Pricing Logic ──');

// 1. Scenario: Base=2600, Tier1: qty=1, price=2800; Tier2: qty=2, price=4200; Tier3: disabled
runTest('TEST 1: Base 2600, Tier 1 (qty 1 @ 2800), Tier 2 (qty 2 @ 4200), Tier 3 disabled', () => {
  const tiers = buildDynamicPricingTiers(2600, null, {
    tier1_enabled: true,
    tier1_qty: 1,
    tier1_label: 'ساعة + علبة',
    tier1_price: 2800,
    tier2_enabled: true,
    tier2_qty: 2,
    tier2_label: 'ساعتان + علبتان',
    tier2_price: 4200,
    tier3_enabled: false
  });
  assert.strictEqual(tiers.length, 2, 'Must have exactly 2 active tiers');
  assert.strictEqual(tiers[0].qty, 1, 'Tier 1 qty is 1');
  assert.strictEqual(tiers[0].price, 2800, 'Tier 1 price is 2800 DZD');
  assert.strictEqual(tiers[1].qty, 2, 'Tier 2 qty is 2');
  assert.strictEqual(tiers[1].price, 4200, 'Tier 2 price is 4200 DZD');
});

// 2. Root Cause Case A: Tier 1 disabled, Tier 2 has qty=1, price=2800
runTest('TEST 2 (Root Cause Case A): Tier 1 disabled, Tier 2 holds qty=1 @ 2800 DZD', () => {
  const tiers = buildDynamicPricingTiers(2600, null, {
    tier1_enabled: false,
    tier2_enabled: true,
    tier2_qty: 1,
    tier2_label: 'ساعة + علبة',
    tier2_price: 2800,
    tier3_enabled: false
  });
  assert.strictEqual(tiers.length, 1, 'Must have 1 active tier');
  assert.strictEqual(tiers[0].offer_id, 'tier-2', 'Offer ID is tier-2');
  assert.strictEqual(tiers[0].qty, 1, 'Resolved qty is 1 (NOT 2!)');
  assert.strictEqual(tiers[0].price, 2800, 'Resolved price is 2800 DZD');
});

// 3. Root Cause Case B: Tier 1 has qty=2, Tier 2 has qty=1
runTest('TEST 3 (Root Cause Case B): Tier 1 qty=2 @ 4200, Tier 2 qty=1 @ 2800 (Tier position != quantity)', () => {
  const tiers = buildDynamicPricingTiers(2600, null, {
    tier1_enabled: true,
    tier1_qty: 2,
    tier1_price: 4200,
    tier2_enabled: true,
    tier2_qty: 1,
    tier2_price: 2800,
    tier3_enabled: false
  });
  assert.strictEqual(tiers.length, 2, 'Must have 2 active tiers');
  assert.strictEqual(tiers[0].qty, 2, 'First tier has qty 2');
  assert.strictEqual(tiers[0].price, 4200, 'First tier price is 4200');
  assert.strictEqual(tiers[1].qty, 1, 'Second tier has qty 1');
  assert.strictEqual(tiers[1].price, 2800, 'Second tier price is 2800');
});

// 4. Fixed Offer Price does NOT multiply by qty
runTest('TEST 4: Fixed price (qty=2, price=4200) evaluates subtotal to 4200 DZD (NOT 8400)', () => {
  const calc = calculateTierSubtotal(2600, 2, null, {
    tier2_enabled: true,
    tier2_qty: 2,
    tier2_price: 4200
  }, 'tier-2');
  assert.strictEqual(calc.subtotal, 4200, 'Subtotal is 4200 DZD (NOT 8400)');
  assert.strictEqual(calc.tier.price, 4200, 'Tier price is 4200 DZD');
});

// 5. Multiple offers with same quantity but distinct offer_id
runTest('TEST 5: Duplicate quantities (qty=1 @ 2800 vs qty=1 @ 3000) resolved independently', () => {
  const customTiers = [
    { offer_id: 'bundle-standard', label: 'باقة عادية', qty: 1, price: 2800 },
    { offer_id: 'bundle-vip', label: 'باقة فاخرة', qty: 1, price: 3000 }
  ];
  const tiers = buildDynamicPricingTiers(2600, customTiers, {});
  assert.strictEqual(tiers.length, 2, 'Both offers preserved');
  assert.strictEqual(tiers[0].offer_id, 'bundle-standard');
  assert.strictEqual(tiers[0].price, 2800);
  assert.strictEqual(tiers[1].offer_id, 'bundle-vip');
  assert.strictEqual(tiers[1].price, 3000);

  const calcStd = calculateTierSubtotal(2600, 1, customTiers, {}, 'bundle-standard');
  const calcVip = calculateTierSubtotal(2600, 1, customTiers, {}, 'bundle-vip');
  assert.strictEqual(calcStd.subtotal, 2800, 'Standard bundle subtotal is 2800');
  assert.strictEqual(calcVip.subtotal, 3000, 'VIP bundle subtotal is 3000');
});

// 6. Custom product explicit tiers unaffected when theme tiers are disabled
runTest('TEST 6: Custom product tiers unaffected by theme tier disabled toggles', () => {
  const customTiers = [
    { offer_id: 'custom-1', label: 'عرض خاص 1', qty: 1, price: 2500, enabled: true },
    { offer_id: 'custom-2', label: 'عرض خاص 2', qty: 2, price: 4500, enabled: true }
  ];
  const tiers = buildDynamicPricingTiers(3000, customTiers, {
    tier1_enabled: false,
    show_tier1: false,
    tier2_enabled: false,
    show_tier2: false
  });
  assert.strictEqual(tiers.length, 2, 'Custom tiers are not stripped by theme toggles');
  assert.strictEqual(tiers[0].offer_id, 'custom-1');
  assert.strictEqual(tiers[0].qty, 1);
  assert.strictEqual(tiers[0].price, 2500);
});

// 7. Legacy theme settings without tierX_qty fall back to 1, 2, 3
runTest('TEST 7: Legacy theme without tierX_qty falls back safely to 1, 2, 3', () => {
  const tiers = buildDynamicPricingTiers(2000, null, {
    tier1_enabled: true,
    tier1_price: 2000,
    tier2_enabled: true,
    tier2_price: 3600,
    tier3_enabled: true,
    tier3_price: 5000
  });
  assert.strictEqual(tiers[0].qty, 1, 'Legacy tier 1 qty is 1');
  assert.strictEqual(tiers[1].qty, 2, 'Legacy tier 2 qty is 2');
  assert.strictEqual(tiers[2].qty, 3, 'Legacy tier 3 qty is 3');
});

console.log('\n── [AXIS 2] Cloudflare Worker Server-Side Verification & Anti-Tampering ──');

// Mock Environment Builder
function buildWorkerMockEnv(opts = {}) {
  const productTiers = opts.productTiers || null;
  const themeTiers = opts.themeTiers || {
    tier1_enabled: true,
    tier1_qty: 1,
    tier1_label: 'ساعة + علبة',
    tier1_price: 2800,
    tier2_enabled: true,
    tier2_qty: 2,
    tier2_label: 'ساعتان + علبتان',
    tier2_price: 4200,
    tier3_enabled: false
  };

  const dbProduct = {
    id: 101,
    tenant_id: 'tenant-algeria',
    name: 'ساعة Sabr الفاخرة',
    price: 2600,
    active: 1,
    stock: 50,
    weight: 0.5,
    free_shipping: 0,
    landing_config_json: JSON.stringify({
      pricing_tiers: productTiers,
      theme_pricing_tiers: themeTiers
    })
  };

  const storedOrders = [];
  let capturedCapi = null;

  global.fetch = async (url, fetchOpts) => {
    if (typeof url === 'string' && url.includes('graph.facebook.com')) {
      capturedCapi = { url, body: JSON.parse(fetchOpts.body) };
      return {
        ok: true,
        status: 200,
        json: async () => ({ events_received: 1 }),
        text: async () => JSON.stringify({ events_received: 1 })
      };
    }
    return { ok: true, json: async () => ({}) };
  };

  const env = {
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
            if (sql.includes('FROM products WHERE id IN') || sql.includes('FROM products WHERE id = ?')) {
              const [id, tenantId] = this.args;
              if (tenantId && tenantId !== 'tenant-algeria') return null;
              if (Number(id) === dbProduct.id || id === '101') return dbProduct;
              return null;
            }
            if (sql.includes('FROM settings WHERE key = ?')) {
              const key = this.args[this.args.length - 1];
              if (key === 'capi_enabled') return { value: 'true' };
              if (key === 'fb_capi_token') return { value: 'EAAB_TEST_TOKEN' };
              if (key === 'pixel_id') return { value: '123456789' };
              return null;
            }
            if (sql.includes('FROM coupons')) return null;
            return null;
          },
          async all() {
            if (sql.includes('FROM products WHERE id IN')) {
              const tenantId = this.args[this.args.length - 1];
              if (tenantId && tenantId !== 'tenant-algeria') return { results: [] };
              return { results: [dbProduct] };
            }
            if (sql.includes('FROM settings WHERE key IN')) {
              return {
                results: [
                  { key: 'delivery_price', value: '500' },
                  { key: 'shipping_home', value: '500' },
                  { key: 'shipping_office', value: '300' },
                  { key: 'shipping_remote', value: '800' },
                  { key: 'free_shipping_enabled', value: 'false' },
                  { key: 'theme_config', value: JSON.stringify({ sections: { 'fast-order-form': { settings: themeTiers } } }) }
                ]
              };
            }
            if (sql.includes('FROM settings')) {
              return {
                results: [
                  { key: 'delivery_price', value: '500' },
                  { key: 'shipping_home', value: '500' },
                  { key: 'shipping_office', value: '300' },
                  { key: 'shipping_remote', value: '800' },
                  { key: 'capi_enabled', value: 'true' },
                  { key: 'fb_capi_token', value: 'EAAB_TEST_TOKEN' },
                  { key: 'pixel_id', value: '123456789' },
                  { key: 'theme_config', value: JSON.stringify({ sections: { 'fast-order-form': { settings: themeTiers } } }) }
                ]
              };
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
    STORE_SETTINGS: {
      get: async (k) => {
        if (k === 'shipping_home') return '500';
        if (k === 'shipping_office') return '300';
        if (k === 'shipping_remote') return '800';
        if (k === 'theme_config') return JSON.stringify({ sections: { 'fast-order-form': { settings: themeTiers } } });
        return null;
      }
    },
    _storedOrders: storedOrders,
    getCapturedCapi: () => capturedCapi
  };

  return env;
}

const mockCtx = { waitUntil(p) { if (p && p.catch) p.catch(() => {}); } };
const mockReq = new Request('https://smartshopping.click/api');

// 8. Server verifies Offer 1 (qty 1 @ 2800 DZD)
await runAsyncTest('TEST 8: Server verifies Offer 1 (qty 1 @ 2800 DZD) + Home shipping 500 DZD = 3300 DZD', async () => {
  const env = buildWorkerMockEnv();
  const params = {
    name: 'Mostapha Serkhad',
    phone: '0555123456',
    wilaya_code: '16',
    delivery_type: 'Home',
    items_json: JSON.stringify([{
      id: 101,
      offer_id: 'tier-1',
      qty: 1
    }])
  };

  const res = await createOrder(env, params, mockReq, mockCtx, null, 'tenant-algeria');
  assert.strictEqual(res.ok, true, 'Order created successfully');
  assert.strictEqual(res.total, 3300, 'Total is 3300 DZD (2800 + 500)');

  const stored = env._storedOrders[0];
  const items = JSON.parse(stored.params[10]);
  assert.strictEqual(items[0].qty, 1, 'Authoritative qty is 1');
  assert.strictEqual(items[0].subtotal, 2800, 'Authoritative subtotal is 2800 DZD');
});

// 9. Server verifies Offer 2 (qty 2 @ 4200 DZD) - Subtotal is 4200, NOT 8400
await runAsyncTest('TEST 9: Server verifies Offer 2 (qty 2 @ 4200 DZD) - Subtotal is 4200 (NOT 8400)', async () => {
  const env = buildWorkerMockEnv();
  const params = {
    name: 'Ahmed Benali',
    phone: '0666123456',
    wilaya_code: '16',
    delivery_type: 'Home',
    items_json: JSON.stringify([{
      id: 101,
      offer_id: 'tier-2',
      qty: 2
    }])
  };

  const res = await createOrder(env, params, mockReq, mockCtx, null, 'tenant-algeria');
  assert.strictEqual(res.ok, true, 'Order created');
  assert.strictEqual(res.total, 4700, 'Total is 4700 DZD (4200 + 500)');

  const stored = env._storedOrders[0];
  const items = JSON.parse(stored.params[10]);
  assert.strictEqual(items[0].qty, 2, 'Authoritative qty is 2');
  assert.strictEqual(items[0].subtotal, 4200, 'Authoritative subtotal is 4200 DZD (NOT 8400)');
});

// 10. Server Anti-Tampering: Client price tampering (price: 1, subtotal: 1)
await runAsyncTest('TEST 10: Server overrides client price tampering (price: 1, subtotal: 1)', async () => {
  const env = buildWorkerMockEnv();
  const params = {
    name: 'Attacker Tamper',
    phone: '0777123456',
    wilaya_code: '16',
    delivery_type: 'Home',
    items_json: JSON.stringify([{
      id: 101,
      offer_id: 'tier-2',
      price: 1,
      subtotal: 1,
      qty: 2
    }]),
    subtotal: 1,
    total_price: 1
  };

  const res = await createOrder(env, params, mockReq, mockCtx, null, 'tenant-algeria');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.total, 4700, 'Tampered price overridden to 4200 + 500 = 4700 DZD');

  const stored = env._storedOrders[0];
  const items = JSON.parse(stored.params[10]);
  assert.strictEqual(items[0].subtotal, 4200, 'Authoritative subtotal recorded as 4200 DZD');
});

// 11. Server Anti-Tampering: Client qty spoofing (qty: 999 with offer_id: tier-1)
await runAsyncTest('TEST 11: Server enforces authoritative tier quantity when client spoofs qty=999', async () => {
  const env = buildWorkerMockEnv();
  const params = {
    name: 'Qty Spoofer',
    phone: '0555999999',
    wilaya_code: '16',
    delivery_type: 'Home',
    items_json: JSON.stringify([{
      id: 101,
      offer_id: 'tier-1',
      qty: 999
    }])
  };

  const res = await createOrder(env, params, mockReq, mockCtx, null, 'tenant-algeria');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.total, 3300, 'Total is 3300 DZD');

  const stored = env._storedOrders[0];
  const items = JSON.parse(stored.params[10]);
  assert.strictEqual(items[0].qty, 1, 'Spoofed qty 999 normalized to authoritative tier qty 1');
  assert.strictEqual(items[0].subtotal, 2800, 'Subtotal is 2800 DZD');
});

// 12. Tenant Isolation: Order for product in different tenant fails securely
await runAsyncTest('TEST 12: Tenant isolation blocks lookup of product belonging to other tenant', async () => {
  const env = buildWorkerMockEnv();
  const params = {
    name: 'Cross Tenant',
    phone: '0555000000',
    wilaya_code: '16',
    delivery_type: 'Home',
    items_json: JSON.stringify([{
      id: 101,
      offer_id: 'tier-1',
      qty: 1
    }])
  };

  const res = await createOrder(env, params, mockReq, mockCtx, null, 'tenant-other-store');
  assert.strictEqual(res.ok, false, 'Order must fail when product is not found under tenant');
  assert(res.error.includes('غير موجود') || res.error.includes('غير متوفر'), 'Returns product not available/found error');
});

// 13. Office Shipping rate calculation
await runAsyncTest('TEST 13: Office delivery calculates authoritative office rate (300 DZD)', async () => {
  const env = buildWorkerMockEnv();
  const params = {
    name: 'Office Customer',
    phone: '0555333333',
    wilaya_code: '16',
    delivery_type: 'Office',
    items_json: JSON.stringify([{
      id: 101,
      offer_id: 'tier-1',
      qty: 1
    }])
  };

  const res = await createOrder(env, params, mockReq, mockCtx, null, 'tenant-algeria');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.total, 3100, 'Total is 3100 DZD (2800 + 300)');
});

// 14. Remote Shipping rate calculation
await runAsyncTest('TEST 14: Remote delivery calculates remote rate (Home 500 + Remote surcharge 800 = 1300 DZD shipping)', async () => {
  const env = buildWorkerMockEnv();
  const params = {
    name: 'Remote Customer',
    phone: '0555888888',
    wilaya_code: '33', // Illizi
    delivery_type: 'Home',
    items_json: JSON.stringify([{
      id: 101,
      offer_id: 'tier-1',
      qty: 1
    }])
  };

  const res = await createOrder(env, params, mockReq, mockCtx, null, 'tenant-algeria');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.total, 4100, 'Total is 4100 DZD (2800 subtotal + 500 base shipping + 800 remote surcharge)');
});

// 15. Free Shipping Tier grants shipping = 0 DZD
await runAsyncTest('TEST 15: Tier with free_shipping=true sets shipping to 0 DZD', async () => {
  const env = buildWorkerMockEnv({
    themeTiers: {
      tier1_enabled: true,
      tier1_qty: 1,
      tier1_price: 2800,
      tier3_enabled: true,
      tier3_qty: 3,
      tier3_price: 6000,
      tier3_free_shipping: true
    }
  });

  const params = {
    name: 'Free Ship Customer',
    phone: '0555777777',
    wilaya_code: '16',
    delivery_type: 'Home',
    items_json: JSON.stringify([{
      id: 101,
      offer_id: 'tier-3',
      qty: 3
    }])
  };

  const res = await createOrder(env, params, mockReq, mockCtx, null, 'tenant-algeria');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.total, 6000, 'Total matches authoritative subtotal without shipping fee (6000 DZD)');
});

// 16. Server Rejection of Client Fake Free Shipping
await runAsyncTest('TEST 16: Non-free shipping tier rejects client fake free_shipping flag', async () => {
  const env = buildWorkerMockEnv();
  const params = {
    name: 'Fake Free Ship',
    phone: '0555666666',
    wilaya_code: '16',
    delivery_type: 'Home',
    free_shipping: true,
    items_json: JSON.stringify([{
      id: 101,
      offer_id: 'tier-1',
      qty: 1,
      free_shipping: true
    }])
  };

  const res = await createOrder(env, params, mockReq, mockCtx, null, 'tenant-algeria');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.total, 3300, 'Total must be 3300 DZD (shipping fee 500 enforced)');
});

// 17. Meta CAPI Event Value is Authoritative Order Total
await runAsyncTest('TEST 17: Meta CAPI Purchase event receives server-verified order total', async () => {
  const env = buildWorkerMockEnv();
  const asyncTasks = [];
  const testCtx = {
    waitUntil(p) {
      if (p) asyncTasks.push(p.catch(() => {}));
    }
  };

  const params = {
    name: 'CAPI Tester',
    phone: '0555444444',
    wilaya_code: '16',
    delivery_type: 'Home',
    items_json: JSON.stringify([{
      id: 101,
      offer_id: 'tier-2',
      qty: 2
    }])
  };

  const res = await createOrder(env, params, mockReq, testCtx, null, 'tenant-algeria');
  assert.strictEqual(res.ok, true);

  await Promise.all(asyncTasks);
  await new Promise(r => setTimeout(r, 60));

  const capi = env.getCapturedCapi();
  assert(capi !== null, 'CAPI fetch was called');
  const eventData = capi.body.data[0];
  assert.strictEqual(eventData.event_name, 'Purchase');
  assert.strictEqual(eventData.custom_data.value, 4700, 'CAPI value must match 4200 + 500 = 4700 DZD');
  assert.strictEqual(eventData.custom_data.currency, 'DZD');
});

// 18. Root Cause in Worker: Tier 1 disabled, Tier 2 holds qty=1 @ 2800
await runAsyncTest('TEST 18 (Worker Root Cause): Tier 1 disabled, Tier 2 holds qty=1 @ 2800 on server', async () => {
  const env = buildWorkerMockEnv({
    themeTiers: {
      tier1_enabled: false,
      tier2_enabled: true,
      tier2_qty: 1,
      tier2_label: 'ساعة + علبة',
      tier2_price: 2800,
      tier3_enabled: false
    }
  });

  const params = {
    name: 'Root Cause Fix',
    phone: '0555111222',
    wilaya_code: '16',
    delivery_type: 'Home',
    items_json: JSON.stringify([{
      id: 101,
      offer_id: 'tier-2',
      qty: 1
    }])
  };

  const res = await createOrder(env, params, mockReq, mockCtx, null, 'tenant-algeria');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.total, 3300, 'Total is 3300 DZD (2800 + 500)');

  const stored = env._storedOrders[0];
  const items = JSON.parse(stored.params[10]);
  assert.strictEqual(items[0].qty, 1, 'Server authoritative qty is 1 (NOT 2!)');
  assert.strictEqual(items[0].subtotal, 2800, 'Server unit price is 2800');
});

// 19. Product-utils normalizeProduct handles explicit pricing tiers smoothly
runTest('TEST 19: Product-utils normalizeProduct handles explicit pricing tiers smoothly', () => {
  const raw = {
    id: 'prod-10',
    price: '2600',
    pricing_tiers: JSON.stringify([
      { offer_id: 't-1', qty: 1, price: 2800, label: 'ساعة + علبة' },
      { offer_id: 't-2', qty: 2, price: 4200, label: 'ساعتان + علبتان' }
    ])
  };
  const norm = productUtils.normalizeProduct(raw);
  assert.strictEqual(Array.isArray(norm.pricing_tiers), true);
  assert.strictEqual(norm.pricing_tiers.length, 2);
  assert.strictEqual(norm.pricing_tiers[0].qty, 1);
  assert.strictEqual(norm.pricing_tiers[0].price, 2800);
});

// 20. End-to-end multi-tier calculation integrity
runTest('TEST 20: calculateTierSubtotal integrity across multiple tiers with explicit quantities', () => {
  const themeSettings = {
    tier1_enabled: true,
    tier1_qty: 1,
    tier1_price: 2800,
    tier2_enabled: true,
    tier2_qty: 2,
    tier2_price: 4200,
    tier3_enabled: true,
    tier3_qty: 5,
    tier3_price: 9000,
    tier3_free_shipping: true
  };
  const c1 = calculateTierSubtotal(2600, 1, null, themeSettings, 'tier-1');
  const c2 = calculateTierSubtotal(2600, 2, null, themeSettings, 'tier-2');
  const c3 = calculateTierSubtotal(2600, 5, null, themeSettings, 'tier-3');

  assert.strictEqual(c1.subtotal, 2800, 'Tier 1 subtotal is 2800');
  assert.strictEqual(c2.subtotal, 4200, 'Tier 2 subtotal is 4200');
  assert.strictEqual(c3.subtotal, 9000, 'Tier 3 subtotal is 9000');
  assert.strictEqual(c3.freeShipping, true, 'Tier 3 free shipping is true');
});

console.log('\n════════════════════════════════════════════════════════════════════════════');
console.log(`🎉 ALL ${passedCount}/${totalCount} TESTS PASSED CLEANLY! OFFER QUANTITY RESOLUTION VERIFIED.`);
console.log('════════════════════════════════════════════════════════════════════════════\n');
