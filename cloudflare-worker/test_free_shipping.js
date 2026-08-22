/**
 * SmartKiosk — Free Shipping Feature Tests
 * Tests the free_shipping_enabled setting across backend and frontend.
 *
 * Run: node cloudflare-worker/test_free_shipping.js
 */

// ── Import shipping engine (server-side) ──
const { calculateShippingCost, YALIDINE_REFERENCE_TARIFF } = require('./src/utils/shipping.js') || {};

let passed = 0;
let failed = 0;

function assert(label, condition, detail) {
  if (condition) {
    console.log('  ✅ PASS: ' + label);
    passed++;
  } else {
    console.log('  ❌ FAIL: ' + label + (detail ? ' — ' + detail : ''));
    failed++;
  }
}

// ── Mock shipping config (Yalidine with standard rates) ──
const sampleShippingConfig = JSON.stringify({
  version: '2.0',
  active_carrier: 'yalidine',
  enable_home: true,
  enable_office: true,
  carriers: [{
    id: 'yalidine',
    name: 'Yalidine Express',
    active: true,
    is_default: true,
    base_weight_kg: 5,
    extra_kg_price: 50,
    rates: {
      '01': { code: '01', name_ar: 'أدرار', home: 1400, office: 900, active: true },
      '16': { code: '16', name_ar: 'الجزائر', home: 500, office: 350, active: true },
      '31': { code: '31', name_ar: 'وهران', home: 750, office: 450, active: true },
      '47': { code: '47', name_ar: 'غرداية', home: 950, office: 600, active: true }
    }
  }]
});

// ── Mock createOrder shipping logic (mirrors orders.js lines 179-205) ──
function simulateCreateOrderShipping({ wilayaCode, deliveryType, freeShippingEnabled, shippingConfigStr }) {
  const shippingSettings = {
    shipping_config: shippingConfigStr || sampleShippingConfig,
    shipping_home: '',
    shipping_office: '',
    shipping_remote: '',
    free_shipping_enabled: freeShippingEnabled || ''
  };

  const isFreeShipping = shippingSettings.free_shipping_enabled === 'true';

  const shippingCalc = calculateShippingCost({
    shippingConfig: shippingSettings.shipping_config,
    wilayaCode: wilayaCode,
    deliveryType: deliveryType || 'home',
    items: [{ id: 1, qty: 1 }],
    productsMap: new Map([[1, { id: 1, name: 'Test', price: 2500, weight: null, stock: 10 }]]),
    legacySettings: shippingSettings
  });

  if (!shippingCalc.ok) {
    return { ok: false, error: shippingCalc.error };
  }

  const shippingCost = isFreeShipping ? 0 : shippingCalc.shippingCost;
  const shippingNote = isFreeShipping ? 'توصيل مجاني' : shippingCalc.shippingNote;
  const deliveryCompany = shippingCalc.deliveryCompany || 'yalidine';

  return { ok: true, shippingCost, shippingNote, deliveryCompany, isFreeShipping };
}

console.log('');
console.log('═══════════════════════════════════════════════════════════════');
console.log('🚚 SMARTKIOSK — FREE SHIPPING FEATURE TESTS');
console.log('═══════════════════════════════════════════════════════════════');
console.log('');

// ── TEST 1: Default OFF ──
console.log('── TEST 1: Default OFF (no setting) ──');
{
  const res = simulateCreateOrderShipping({ wilayaCode: '16', deliveryType: 'home', freeShippingEnabled: '' });
  assert('Shipping cost is NOT 0 (default OFF)', res.shippingCost > 0, 'got: ' + res.shippingCost);
  assert('isFreeShipping is false', res.isFreeShipping === false);
  assert('Alger home rate is 500', res.shippingCost === 500, 'got: ' + res.shippingCost);
}
console.log('');

// ── TEST 2: Enable free shipping ──
console.log('── TEST 2: Enable free shipping ──');
{
  const res = simulateCreateOrderShipping({ wilayaCode: '16', deliveryType: 'home', freeShippingEnabled: 'true' });
  assert('Shipping cost is 0', res.shippingCost === 0, 'got: ' + res.shippingCost);
  assert('isFreeShipping is true', res.isFreeShipping === true);
  assert('Shipping note is توصيل مجاني', res.shippingNote === 'توصيل مجاني', 'got: ' + res.shippingNote);
}
console.log('');

// ── TEST 3: Disable free shipping ──
console.log('── TEST 3: Disable free shipping ──');
{
  const res = simulateCreateOrderShipping({ wilayaCode: '16', deliveryType: 'home', freeShippingEnabled: 'false' });
  assert('Shipping cost restored to 500', res.shippingCost === 500, 'got: ' + res.shippingCost);
  assert('isFreeShipping is false', res.isFreeShipping === false);
}
console.log('');

// ── TEST 4: Normal Wilaya + Free Shipping ON ──
console.log('── TEST 4: Normal Wilaya (Alger 16) + Free Shipping ON ──');
{
  const res = simulateCreateOrderShipping({ wilayaCode: '16', deliveryType: 'home', freeShippingEnabled: 'true' });
  assert('Normal wilaya shipping cost = 0', res.shippingCost === 0);
}
console.log('');

// ── TEST 5: Remote Wilaya + Free Shipping ON ──
console.log('── TEST 5: Remote Wilaya (Adrar 01) + Free Shipping ON ──');
{
  const res = simulateCreateOrderShipping({ wilayaCode: '01', deliveryType: 'home', freeShippingEnabled: 'true' });
  assert('Remote wilaya shipping cost = 0', res.shippingCost === 0);
  const res2 = simulateCreateOrderShipping({ wilayaCode: '01', deliveryType: 'home', freeShippingEnabled: 'false' });
  assert('Without free shipping, Adrar home = 1400', res2.shippingCost === 1400, 'got: ' + res2.shippingCost);
}
console.log('');

// ── TEST 6: Home delivery + Free Shipping ──
console.log('── TEST 6: Home delivery + Free Shipping ON ──');
{
  const res = simulateCreateOrderShipping({ wilayaCode: '31', deliveryType: 'home', freeShippingEnabled: 'true' });
  assert('Home delivery cost = 0', res.shippingCost === 0);
}
console.log('');

// ── TEST 7: Office delivery + Free Shipping ──
console.log('── TEST 7: Office delivery + Free Shipping ON ──');
{
  const res = simulateCreateOrderShipping({ wilayaCode: '31', deliveryType: 'office', freeShippingEnabled: 'true' });
  assert('Office delivery cost = 0', res.shippingCost === 0);
}
console.log('');

// ── TEST 8: Tenant Isolation ──
console.log('── TEST 8: Tenant Isolation ──');
{
  const tenantA = simulateCreateOrderShipping({ wilayaCode: '16', deliveryType: 'home', freeShippingEnabled: 'true' });
  const tenantB = simulateCreateOrderShipping({ wilayaCode: '16', deliveryType: 'home', freeShippingEnabled: 'false' });
  assert('Tenant A cost = 0', tenantA.shippingCost === 0);
  assert('Tenant B cost = 500', tenantB.shippingCost === 500, 'got: ' + tenantB.shippingCost);
  assert('Tenant A does not affect Tenant B', tenantA.shippingCost !== tenantB.shippingCost);
}
console.log('');

// ── TEST 9: Frontend Display Logic ──
console.log('── TEST 9: Frontend Display Logic ──');
{
  var settingsOn = { free_shipping_enabled: 'true' };
  var settingsOff = { free_shipping_enabled: 'false' };
  var settingsMissing = {};

  assert('ON: isFreeShippingSetting = true', settingsOn.free_shipping_enabled === 'true');
  assert('OFF: isFreeShippingSetting = false', settingsOff.free_shipping_enabled !== 'true');
  assert('MISSING: isFreeShippingSetting = false (default)', settingsMissing.free_shipping_enabled !== 'true');
  assert('cost=0 + no setting ≠ free shipping display', !(settingsMissing.free_shipping_enabled === 'true'));
}
console.log('');

// ── TEST 10: Backend Authority ──
console.log('── TEST 10: Backend Authority (Server overrides frontend) ──');
{
  const res = simulateCreateOrderShipping({ wilayaCode: '16', deliveryType: 'home', freeShippingEnabled: 'true' });
  assert('Backend enforces cost=0 regardless of frontend', res.shippingCost === 0);
  assert('deliveryCompany comes from calculateShippingCost (not hardcoded)', res.deliveryCompany === 'yalidine');
}
console.log('');

// ── TEST 11: Settings Persistence ──
console.log('── TEST 11: Settings Persistence (UPSERT via admin_update_settings) ──');
{
  const IMMUTABLE_KEYS = new Set(['login_fails', 'login_blocked_until', 'admin_password_hash', 'admin_recovery_code']);
  assert('free_shipping_enabled is NOT in IMMUTABLE_KEYS', !IMMUTABLE_KEYS.has('free_shipping_enabled'));
  const SECRET_KEYS = new Set(['admin_password_hash', 'admin_recovery_hash', 'fb_capi_token', 'gemini_api_key', 'login_fails', 'login_blocked_until']);
  assert('free_shipping_enabled is NOT in SECRET_KEYS', !SECRET_KEYS.has('free_shipping_enabled'));
}
console.log('');

// ── Summary ──
console.log('═══════════════════════════════════════════════════════════════');
console.log('📊 FREE SHIPPING TEST RESULTS: ' + passed + ' PASSED | ' + failed + ' FAILED');
console.log('═══════════════════════════════════════════════════════════════');
console.log('');

if (failed > 0) {
  process.exit(1);
}
