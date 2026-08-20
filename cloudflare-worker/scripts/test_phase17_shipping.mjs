/**
 * SmartKiosk — Phase 17 Automated Test Suite
 * Tests for Multi-Carrier Dynamic Smart Shipping System & Strict Weight Rule
 */

import {
  YALIDINE_REFERENCE_TARIFF,
  getDefaultShippingConfig,
  parseShippingConfig,
  calculateShippingCost
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

console.log('\n======================================================');
console.log('🧪 RUNNING PHASE 17 SHIPPING ENGINE TEST SUITE');
console.log('======================================================\n');

// ── Test 1: Yalidine Reference Tariff Integrity ──
console.log('--- 1. Reference Tariff Verification ---');
const wilayaKeys = Object.keys(YALIDINE_REFERENCE_TARIFF);
assert(wilayaKeys.length === 58, `58 Wilayas present in reference tariff (got ${wilayaKeys.length})`);
assert(YALIDINE_REFERENCE_TARIFF["16"].home === 500 && YALIDINE_REFERENCE_TARIFF["16"].office === 350, 'Alger (16) rates: Home=500, Office=350');
assert(YALIDINE_REFERENCE_TARIFF["01"].home === 1400 && YALIDINE_REFERENCE_TARIFF["01"].office === 900, 'Adrar (01) rates: Home=1400, Office=900');
assert(YALIDINE_REFERENCE_TARIFF["11"].home === 1600 && YALIDINE_REFERENCE_TARIFF["11"].office === 1100, 'Tamanrasset (11) rates: Home=1600, Office=1100');

// ── Test 2: Default Config Generation & Parsing ──
console.log('\n--- 2. Default Config & Parsing ---');
const defaultCfg = getDefaultShippingConfig();
assert(defaultCfg.active_carrier === 'yalidine', 'Active carrier is yalidine');
assert(defaultCfg.carriers.length === 1, 'Default carriers array has 1 carrier');
const parsed = parseShippingConfig(JSON.stringify(defaultCfg));
assert(parsed !== null && parsed.carriers[0].id === 'yalidine', 'JSON parseShippingConfig works');
assert(parseShippingConfig('invalid json') === null, 'Invalid JSON returns null safely');
assert(parseShippingConfig('') === null, 'Empty config returns null safely');

// ── Test 3: Weight NULL (Strict Weight Rule OFF) ──
console.log('\n--- 3. Weight NULL (Weight Logic OFF) ---');
const productNullWeight = { id: 101, name: 'T-Shirt', price: 2500, weight: null };
const productsMapNull = new Map([[101, productNullWeight]]);

const resNullWeight = calculateShippingCost({
  shippingConfig: defaultCfg,
  wilayaCode: '16',
  deliveryType: 'home',
  items: [{ id: 101, qty: 3 }],
  productsMap: productsMapNull
});

assert(resNullWeight.ok === true, 'Calculation successful');
assert(resNullWeight.shippingCost === 500, `Alger Home base rate applied (500 DA) without weight fee (got ${resNullWeight.shippingCost})`);
assert(resNullWeight.hasWeight === false, 'hasWeight is false for weight: null');
assert(resNullWeight.extraFee === 0, 'extraFee is 0');
assert(resNullWeight.deliveryCompany === 'yalidine', 'deliveryCompany is yalidine');

// ── Test 4: Weight <= 5kg (Within Base Tier) ──
console.log('\n--- 4. Weight <= 5kg (No Extra Fee) ---');
const product2kg = { id: 102, name: 'Shoes', price: 4000, weight: 2.0 };
const productsMap2kg = new Map([[102, product2kg]]);

const resUnder5kg = calculateShippingCost({
  shippingConfig: defaultCfg,
  wilayaCode: '31', // Oran (750 home / 450 office)
  deliveryType: 'home',
  items: [{ id: 102, qty: 2 }], // Total weight = 4.0kg <= 5kg
  productsMap: productsMap2kg
});

assert(resUnder5kg.ok === true, 'Calculation successful');
assert(resUnder5kg.shippingCost === 750, `Oran Home base rate (750 DA) with totalWeight=4kg (got ${resUnder5kg.shippingCost})`);
assert(resUnder5kg.hasWeight === true, 'hasWeight is true');
assert(resUnder5kg.totalWeight === 4, `totalWeight is 4kg (got ${resUnder5kg.totalWeight})`);
assert(resUnder5kg.extraFee === 0, 'extraFee is 0 for <= 5kg');

// ── Test 5: Weight > 5kg (Extra Weight Calculation) ──
console.log('\n--- 5. Weight > 5kg (Tiered Extra Fee) ---');
const productHeavy = { id: 103, name: 'Generator', price: 25000, weight: 3.6 };
const productsMapHeavy = new Map([[103, productHeavy]]);

const resOver5kg = calculateShippingCost({
  shippingConfig: defaultCfg,
  wilayaCode: '03', // Laghouat (950 home / 600 office)
  deliveryType: 'home',
  items: [{ id: 103, qty: 2 }], // Total weight = 7.2kg -> extraKg = ceil(2.2) = 3kg
  productsMap: productsMapHeavy
});

// Extra fee = 3 * 50 DA = 150 DA. Total = 950 + 150 = 1100 DA.
assert(resOver5kg.ok === true, 'Calculation successful');
assert(resOver5kg.totalWeight === 7.2, `totalWeight is 7.2kg (got ${resOver5kg.totalWeight})`);
assert(resOver5kg.extraKg === 3, `extraKg is ceil(2.2) = 3 (got ${resOver5kg.extraKg})`);
assert(resOver5kg.extraFee === 150, `extraFee is 150 DA (got ${resOver5kg.extraFee})`);
assert(resOver5kg.shippingCost === 1100, `Laghouat Home total is 1100 DA (950 + 150) (got ${resOver5kg.shippingCost})`);

// ── Test 6: Stop Desk (Office) Rates ──
console.log('\n--- 6. Stop Desk (Office) Rate Calculation ---');
const resOffice = calculateShippingCost({
  shippingConfig: defaultCfg,
  wilayaCode: '16', // Alger
  deliveryType: 'office',
  items: [{ id: 101, qty: 1 }],
  productsMap: productsMapNull
});

assert(resOffice.ok === true, 'Calculation successful');
assert(resOffice.shippingCost === 350, `Alger Stop Desk rate is 350 DA (got ${resOffice.shippingCost})`);
assert(resOffice.deliveryType === 'office', 'deliveryType is office');

// ── Test 7: Multi-Carrier Switching & Secondary Carrier ──
console.log('\n--- 7. Multi-Carrier Support & Secondary Carrier ---');
const customMultiCarrierConfig = {
  version: "2.0",
  active_carrier: "zr_express",
  enable_home: true,
  enable_office: true,
  carriers: [
    {
      id: "yalidine",
      name: "Yalidine Express",
      active: true,
      is_default: false,
      base_weight_kg: 5,
      extra_kg_price: 50,
      rates: JSON.parse(JSON.stringify(YALIDINE_REFERENCE_TARIFF))
    },
    {
      id: "zr_express",
      name: "ZR Express",
      active: true,
      is_default: true,
      base_weight_kg: 3,
      extra_kg_price: 40,
      rates: {
        "16": { home: 400, office: 250, active: true },
        "31": { home: 650, office: 400, active: true }
      }
    }
  ]
};

const resZR = calculateShippingCost({
  shippingConfig: customMultiCarrierConfig,
  wilayaCode: '16',
  deliveryType: 'home',
  items: [{ id: 101, qty: 1 }],
  productsMap: productsMapNull
});

assert(resZR.ok === true, 'Calculation successful with ZR Express');
assert(resZR.shippingCost === 400, `ZR Express rate applied for Alger Home (400 DA, got ${resZR.shippingCost})`);
assert(resZR.deliveryCompany === 'zr_express', `deliveryCompany is zr_express (got ${resZR.deliveryCompany})`);

// ── Test 8: Method Disabling (enable_home / enable_office) ──
console.log('\n--- 8. Disabled Delivery Methods Enforcement ---');
const disabledHomeConfig = {
  version: "2.0",
  active_carrier: "yalidine",
  enable_home: false,
  enable_office: true,
  carriers: defaultCfg.carriers
};

const resDisabledHome = calculateShippingCost({
  shippingConfig: disabledHomeConfig,
  wilayaCode: '16',
  deliveryType: 'home',
  items: [{ id: 101, qty: 1 }],
  productsMap: productsMapNull
});

assert(resDisabledHome.ok === false, 'Home delivery rejected when enable_home is false');

const resEnabledOffice = calculateShippingCost({
  shippingConfig: disabledHomeConfig,
  wilayaCode: '16',
  deliveryType: 'office',
  items: [{ id: 101, qty: 1 }],
  productsMap: productsMapNull
});

assert(resEnabledOffice.ok === true && resEnabledOffice.shippingCost === 350, 'Office delivery allowed when enable_office is true');

// ── Test 9: Fallback to Legacy Settings ──
console.log('\n--- 9. Legacy Settings Fallback ---');
const legacySettings = {
  shipping_home: '600',
  shipping_office: '400',
  shipping_remote: '200'
};

const resLegacyNormal = calculateShippingCost({
  shippingConfig: null, // No dynamic config
  wilayaCode: '16',
  deliveryType: 'home',
  items: [{ id: 101, qty: 1 }],
  productsMap: productsMapNull,
  legacySettings
});

assert(resLegacyNormal.ok === true && resLegacyNormal.shippingCost === 600, `Legacy normal wilaya = 600 DA (got ${resLegacyNormal.shippingCost})`);

const resLegacyRemote = calculateShippingCost({
  shippingConfig: null,
  wilayaCode: '01', // Adrar is remote
  deliveryType: 'home',
  items: [{ id: 101, qty: 1 }],
  productsMap: productsMapNull,
  legacySettings
});

assert(resLegacyRemote.ok === true && resLegacyRemote.shippingCost === 800, `Legacy remote wilaya = 600 + 200 = 800 DA (got ${resLegacyRemote.shippingCost})`);

// ── Final Test Summary ──
console.log('\n======================================================');
console.log(`📊 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log('======================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
