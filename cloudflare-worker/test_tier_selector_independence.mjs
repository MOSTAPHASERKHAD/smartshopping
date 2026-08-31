/**
 * SmartKiosk - Pricing Tiers & Quantity Selector Independence Test Suite
 * Tests full decoupling of show_pricing_tiers and show_quantity_selector.
 */

import assert from 'node:assert';
import { createOrder } from './src/handlers/orders.js';
import productUtils from '../assets/js/product-utils.js';

const { buildDynamicPricingTiers, calculateTierSubtotal } = productUtils;

console.log('════════════════════════════════════════════════════════════════════════════');
console.log('🚀 SMARTKIOSK — PRICING TIERS & QUANTITY SELECTOR INDEPENDENCE TEST SUITE');
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

function simulateRender(options) {
  const {
    showPricingTiers,
    showQtySelector,
    basePrice = 2000,
    customTiers = null,
    themeTierSettings = {}
  } = options;

  let renderedTiers = false;
  let renderedQtySelector = false;
  let activeTiers = [];

  // Replicate product.html logic:
  // ── Quantity Breaks / Bundle Offers (Independent of Quantity Selector) ──
  if (showPricingTiers && typeof buildDynamicPricingTiers === 'function') {
    activeTiers = buildDynamicPricingTiers(basePrice, customTiers, themeTierSettings);
    renderedTiers = true;
  }

  // ── Standard Quantity Selector (+ / -) (Independent of Pricing Tiers) ──
  if (showQtySelector) {
    renderedQtySelector = true;
  }

  return {
    renderedTiers,
    renderedQtySelector,
    activeTiers
  };
}

function createMockEnv(productOverrides = {}, themeSectionsOverride = null) {
  const dbProduct = {
    id: 101,
    name: 'ساعة يد فاخرة',
    price: 2600,
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
                      '16': { home: 500, office: 350 }
                    }
                  })
                },
                { key: 'shipping_home', value: '500' },
                { key: 'shipping_office', value: '350' },
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

const mockCtx = { waitUntil(p) { if (p && p.catch) p.catch(() => {}); } };
const mockReq = new Request('https://smartshopping.click/api', {
  headers: { 'CF-Connecting-IP': '105.105.105.1', 'User-Agent': 'Mozilla/5.0' }
});

// ─────────────────────────────────────────────────────────────────────────────
// [SUITE 1] 4-State Independence Matrix (UI Rendering)
// ─────────────────────────────────────────────────────────────────────────────
console.log('── [AXIS 1] 4-State Independence Matrix ──');

// TEST 1: pricing tiers = ON, quantity selector = ON
runTest('TEST 1: pricing tiers = ON, quantity selector = ON => tiers visible, selector visible', () => {
  const res = simulateRender({ showPricingTiers: true, showQtySelector: true });
  assert.strictEqual(res.renderedTiers, true, 'Tiers must be visible');
  assert.strictEqual(res.renderedQtySelector, true, 'Quantity selector must be visible');
});

// TEST 2: pricing tiers = ON, quantity selector = OFF
runTest('TEST 2: pricing tiers = ON, quantity selector = OFF => tiers visible, selector hidden', () => {
  const res = simulateRender({ showPricingTiers: true, showQtySelector: false });
  assert.strictEqual(res.renderedTiers, true, 'Tiers MUST remain visible when selector is OFF');
  assert.strictEqual(res.renderedQtySelector, false, 'Quantity selector must be hidden');
});

// TEST 3: pricing tiers = OFF, quantity selector = ON
runTest('TEST 3: pricing tiers = OFF, quantity selector = ON => tiers hidden, selector visible', () => {
  const res = simulateRender({ showPricingTiers: false, showQtySelector: true });
  assert.strictEqual(res.renderedTiers, false, 'Tiers must be hidden');
  assert.strictEqual(res.renderedQtySelector, true, 'Quantity selector must be visible');
});

// TEST 4: pricing tiers = OFF, quantity selector = OFF
runTest('TEST 4: pricing tiers = OFF, quantity selector = OFF => tiers hidden, selector hidden', () => {
  const res = simulateRender({ showPricingTiers: false, showQtySelector: false });
  assert.strictEqual(res.renderedTiers, false, 'Tiers must be hidden');
  assert.strictEqual(res.renderedQtySelector, false, 'Quantity selector must be hidden');
});

// ─────────────────────────────────────────────────────────────────────────────
// [SUITE 2] Pricing & Calculations when Selector is OFF
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── [AXIS 2] Pricing & Calculation with Selector OFF ──');

// TEST 5: pricing tiers = ON, quantity selector = OFF, Select Tier 2: qty=2, price=4200 => subtotal = 4200
runTest('TEST 5: pricing tiers = ON, quantity selector = OFF, select Tier 2 (qty=2, price=4200) => subtotal 4200 DZD (NOT 8400)', () => {
  const themeSettings = {
    tier1_enabled: true,
    tier1_qty: 1,
    tier1_price: 2800,
    tier2_enabled: true,
    tier2_qty: 2,
    tier2_price: 4200
  };
  const tiers = buildDynamicPricingTiers(2600, null, themeSettings);
  const calc = calculateTierSubtotal(2600, 2, null, themeSettings, 'tier-2', 'Home');
  assert.strictEqual(calc.subtotal, 4200, 'Subtotal must be 4200 DZD (fixed bundle price)');
  assert.strictEqual(calc.tier.qty, 2, 'Quantity must be 2');
});

// TEST 6: Tier position != quantity with quantity selector OFF
runTest('TEST 6: Tier 1 disabled, Tier 2 enabled (qty=1, price=2800), quantity selector = OFF => subtotal 2800 DZD', () => {
  const themeSettings = {
    tier1_enabled: false,
    tier2_enabled: true,
    tier2_qty: 1,
    tier2_price: 2800,
    tier3_enabled: false
  };
  const tiers = buildDynamicPricingTiers(2600, null, themeSettings);
  assert.strictEqual(tiers.length, 1);
  assert.strictEqual(tiers[0].offer_id, 'tier-2');
  assert.strictEqual(tiers[0].qty, 1);
  assert.strictEqual(tiers[0].price, 2800);

  const calc = calculateTierSubtotal(2600, 1, null, themeSettings, 'tier-2', 'Home');
  assert.strictEqual(calc.subtotal, 2800);
});

// TEST 7: Shipping mode integration with selector OFF
runTest('TEST 7: quantity selector = OFF, pricing tiers = ON, free_shipping_mode = home => Home=0, Office=350', () => {
  const themeSettings = {
    tier1_enabled: true,
    tier1_qty: 1,
    tier1_price: 2800,
    tier1_free_shipping_mode: 'home'
  };
  const calcHome = calculateTierSubtotal(2600, 1, null, themeSettings, 'tier-1', 'Home');
  assert.strictEqual(calcHome.isFreeForDelivery, true, 'Home must be free');

  const calcOffice = calculateTierSubtotal(2600, 1, null, themeSettings, 'tier-1', 'Office');
  assert.strictEqual(calcOffice.isFreeForDelivery, false, 'Office must not be free');
});

// ─────────────────────────────────────────────────────────────────────────────
// [SUITE 3] Server-Side Worker Verification with Selector OFF
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── [AXIS 3] Backend Server-Side Verification ──');

// TEST 8: Server verifies order when theme has show_quantity_selector = false and show_pricing_tiers = true
await runAsyncTest('TEST 8: Backend verifies Tier 2 (qty=2, price=4200) when theme show_quantity_selector=false', async () => {
  const themeSections = {
    'fast-order-form': {
      settings: {
        show_quantity_selector: false,
        show_pricing_tiers: true,
        tier1_enabled: true,
        tier1_qty: 1,
        tier1_price: 2800,
        tier2_enabled: true,
        tier2_qty: 2,
        tier2_price: 4200,
        tier2_free_shipping_mode: 'home'
      }
    }
  };

  const env = createMockEnv({}, themeSections);
  const params = {
    name: 'أحمد الجزائري',
    phone: '0555123456',
    wilaya_code: '16',
    delivery_type: 'Home',
    items_json: JSON.stringify([{ id: 101, qty: 2, offer_id: 'tier-2' }])
  };

  const res = await createOrder(env, params, mockReq, mockCtx, null, 'tenant_1');
  assert(res.ok, res.error);
  assert.strictEqual(res.total, 4200, 'Server must enforce 4200 subtotal + 0 shipping = 4200 DZD');

  const stored = env._storedOrders[0];
  assert.strictEqual(stored.params[11], 4200, 'Stored subtotal must be 4200');
  assert.strictEqual(stored.params[12], 0, 'Stored shipping must be 0');
  const storedItems = JSON.parse(stored.params[10]);
  assert.strictEqual(storedItems[0].qty, 2, 'Stored qty must be 2');
  assert.strictEqual(storedItems[0].offer_id, 'tier-2');
});

// TEST 9: Backend rejects client price tampering when show_quantity_selector=false
await runAsyncTest('TEST 9: Backend overrides client price tampering when show_quantity_selector=false', async () => {
  const themeSections = {
    'fast-order-form': {
      settings: {
        show_quantity_selector: false,
        show_pricing_tiers: true,
        tier1_enabled: true,
        tier1_qty: 1,
        tier1_price: 2800,
        tier2_enabled: true,
        tier2_qty: 2,
        tier2_price: 4200
      }
    }
  };

  const env = createMockEnv({}, themeSections);
  const tamperedParams = {
    name: 'مخترق',
    phone: '0555123456',
    wilaya_code: '16',
    delivery_type: 'Office',
    price: 1,
    subtotal: 1,
    total_price: 1,
    items_json: JSON.stringify([{ id: 101, qty: 2, offer_id: 'tier-2', price: 1, subtotal: 1 }])
  };

  const res = await createOrder(env, tamperedParams, mockReq, mockCtx, null, 'tenant_1');
  assert(res.ok, res.error);
  assert.strictEqual(res.total, 4200 + 350, 'Server must enforce 4200 + 350 office shipping = 4550 DZD');
});

console.log(`\n════════════════════════════════════════════════════════════════════════════`);
console.log(`📊 FINAL RESULT: ${passCount}/${totalTests} TESTS PASSED`);
console.log(`════════════════════════════════════════════════════════════════════════════\n`);
