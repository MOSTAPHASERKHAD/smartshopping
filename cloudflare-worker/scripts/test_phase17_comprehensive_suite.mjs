/**
 * SmartKiosk — Phase 17 Comprehensive Verification Suite
 * Tests all 7 user scenarios with live assertions
 */

import {
  getDefaultShippingConfig,
  parseShippingConfig,
  calculateShippingCost,
  YALIDINE_REFERENCE_TARIFF
} from '../src/utils/shipping.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

console.log('═══════════════════════════════════════════════════════════════');
console.log('🧪 COMPREHENSIVE PRODUCTION & LOGIC VALIDATION');
console.log('═══════════════════════════════════════════════════════════════\n');

// ── Test 1: Product Page Client Calculation (Home vs Stop Desk) ──
console.log('--- 1. Product Page Calculation (Home vs Stop Desk) ---');
const cfgDefault = getDefaultShippingConfig();
const pNull = { id: 2, name: 'Watch', price: 3000, weight: null };
const pMap = new Map([[2, pNull]]);

const resHomeAlger = calculateShippingCost({
  shippingConfig: JSON.stringify(cfgDefault),
  wilayaCode: '16',
  deliveryType: 'Home',
  items: [{ id: 2, qty: 1 }],
  productsMap: pMap
});
assert(resHomeAlger.ok && resHomeAlger.shippingCost === 500, 'Alger Home rate is 500 DA');

const resOfficeAlger = calculateShippingCost({
  shippingConfig: JSON.stringify(cfgDefault),
  wilayaCode: '16',
  deliveryType: 'Office',
  items: [{ id: 2, qty: 1 }],
  productsMap: pMap
});
assert(resOfficeAlger.ok && resOfficeAlger.shippingCost === 350, 'Alger Stop Desk (Office) rate is 350 DA');

// ── Test 2: Weight NULL Behavior (Strict Weight Rule OFF) ──
console.log('\n--- 2. Weight NULL Behavior ---');
const resAdrarNull = calculateShippingCost({
  shippingConfig: JSON.stringify(cfgDefault),
  wilayaCode: '01',
  deliveryType: 'Home',
  items: [{ id: 2, qty: 3 }],
  productsMap: pMap
});
assert(resAdrarNull.shippingCost === 1400, 'Adrar (01) Home base rate is 1400 DA with weight NULL');
assert(resAdrarNull.hasWeight === false, 'hasWeight is false for weight: NULL');
assert(resAdrarNull.extraFee === 0, 'extraFee is 0');

// ── Test 3: Weighted Product Calculation (weight * qty) ──
console.log('\n--- 3. Weighted Product Calculation (weight * qty) ---');
const pHeavy = { id: 10, name: 'Heavy Item', price: 5000, weight: 3.5 };
const pHeavyMap = new Map([[10, pHeavy]]);

// 1 item * 3.5kg = 3.5kg <= 5kg (base limit) -> extraFee = 0
const resHeavy1 = calculateShippingCost({
  shippingConfig: JSON.stringify(cfgDefault),
  wilayaCode: '31', // Oran (base home = 750)
  deliveryType: 'Home',
  items: [{ id: 10, qty: 1 }],
  productsMap: pHeavyMap
});
assert(resHeavy1.shippingCost === 750, 'Oran 1 item (3.5kg <= 5kg) has no extra fee (750 DA)');
assert(resHeavy1.hasWeight === true, 'hasWeight is true');
assert(resHeavy1.totalWeight === 3.5, 'totalWeight is 3.5kg');
assert(resHeavy1.extraFee === 0, 'extraFee is 0');

// 2 items * 3.5kg = 7.0kg > 5kg -> extraKg = 2kg -> extraFee = 2 * 50 = 100 DA
const resHeavy2 = calculateShippingCost({
  shippingConfig: JSON.stringify(cfgDefault),
  wilayaCode: '31', // Oran
  deliveryType: 'Home',
  items: [{ id: 10, qty: 2 }],
  productsMap: pHeavyMap
});
assert(resHeavy2.totalWeight === 7.0, '2 items total weight is 7.0kg');
assert(resHeavy2.extraKg === 2, 'extraKg is 2kg');
assert(resHeavy2.extraFee === 100, 'extraFee is 100 DA (2 * 50)');
assert(resHeavy2.shippingCost === 850, 'Total shipping cost is 750 + 100 = 850 DA');

// ── Test 4: Admin Custom Rate Editing & Persistence Simulation ──
console.log('\n--- 4. Admin Custom Rate Modification ---');
const customCfg = JSON.parse(JSON.stringify(cfgDefault));
customCfg.carriers[0].rates["16"].home = 650; // Modified Alger rate
customCfg.carriers[0].rates["16"].office = 450;
const resCustom = calculateShippingCost({
  shippingConfig: JSON.stringify(customCfg),
  wilayaCode: '16',
  deliveryType: 'Home',
  items: [{ id: 2, qty: 1 }],
  productsMap: pMap
});
assert(resCustom.shippingCost === 650, 'Admin custom rate (650 DA) overrides reference rate (500 DA)');

// ── Test 5: Multi-Carrier Switching ──
console.log('\n--- 5. Multi-Carrier Support ---');
const multiCarrierCfg = JSON.parse(JSON.stringify(cfgDefault));
multiCarrierCfg.carriers.push({
  id: 'zr_express',
  name: 'ZR Express',
  active: true,
  is_default: false,
  base_weight_kg: 5,
  extra_kg_price: 60,
  rates: {
    "16": { home: 400, office: 250, active: true }
  }
});
multiCarrierCfg.active_carrier = 'zr_express';

const resZR = calculateShippingCost({
  shippingConfig: JSON.stringify(multiCarrierCfg),
  wilayaCode: '16',
  deliveryType: 'Home',
  items: [{ id: 2, qty: 1 }],
  productsMap: pMap
});
assert(resZR.shippingCost === 400, 'ZR Express rate 400 DA applied');
assert(resZR.deliveryCompany === 'zr_express', 'deliveryCompany is zr_express');

console.log('\n═══════════════════════════════════════════════════════════════');
console.log(`📊 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log('═══════════════════════════════════════════════════════════════\n');

if (failed > 0) process.exit(1);
