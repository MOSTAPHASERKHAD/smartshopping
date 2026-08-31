/**
 * test_theme_customizer_shipping_modes.mjs
 * Verification of Granular Free Shipping Modes in Theme Customizer & Theme Schema.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ThemeCustomizer, ThemeCustomizerClass } = require('../themes/theme-customizer.js');
const ThemeSchema = require('../themes/theme-schema.js');

let passCount = 0;
let totalCount = 0;

function runTest(name, fn) {
  totalCount++;
  try {
    fn();
    passCount++;
    console.log(`  ✅ PASS [${String(totalCount).padStart(2, '0')}]: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL [${String(totalCount).padStart(2, '0')}]: ${name}`);
    console.error(`     Error: ${err.message}`);
    throw err;
  }
}

console.log('════════════════════════════════════════════════════════════════════════════');
console.log('🎨 SMARTKIOSK — THEME CUSTOMIZER SHIPPING MODES & SCHEMA TEST SUITE');
console.log('════════════════════════════════════════════════════════════════════════════\n');

console.log('── [AXIS 1] ThemeSchema Defaults & Schema Integrity ──');

runTest('TEST 1: ThemeSchema defaults contain granular free_shipping_modes', () => {
  const sections = ThemeSchema.defaultSectionsConfig();
  const formSec = sections['fast-order-form'] || sections['order-form'];
  assert.ok(formSec, 'fast-order-form exists in defaults');
  assert.equal(formSec.settings.tier1_free_shipping_mode, 'none', 'tier1 default is none');
  assert.equal(formSec.settings.tier2_free_shipping_mode, 'none', 'tier2 default is none');
  assert.equal(formSec.settings.tier3_free_shipping_mode, 'both', 'tier3 default is both');
  assert.equal(formSec.settings.tier3_free_shipping, true, 'tier3 legacy compatibility flag preserved');
});

runTest('TEST 2: Legacy theme state with only tier3_free_shipping: true normalizes to mode="both"', () => {
  const customizer = new ThemeCustomizerClass();
  customizer.init({
    sections: {
      'fast-order-form': {
        enabled: true,
        settings: {
          tier1_enabled: true,
          tier2_enabled: true,
          tier3_enabled: true,
          tier3_free_shipping: true
          // no tier3_free_shipping_mode specified
        }
      }
    }
  });

  const state = customizer.getState();
  const sec = state.sections['fast-order-form'];
  assert.equal(sec.settings.tier1_free_shipping_mode, 'none');
  assert.equal(sec.settings.tier2_free_shipping_mode, 'none');
  assert.equal(sec.settings.tier3_free_shipping_mode, 'both');
});

runTest('TEST 3: Legacy theme state with tier3_free_shipping: false normalizes to mode="none"', () => {
  const customizer = new ThemeCustomizerClass();
  customizer.init({
    sections: {
      'fast-order-form': {
        enabled: true,
        settings: {
          tier1_enabled: true,
          tier2_enabled: true,
          tier3_enabled: true,
          tier3_free_shipping: false
        }
      }
    }
  });

  const state = customizer.getState();
  const sec = state.sections['fast-order-form'];
  assert.equal(sec.settings.tier3_free_shipping_mode, 'none');
});

console.log('\n── [AXIS 2] Customizer Mutation & Persistence Integrity ──');

runTest('TEST 4: Update customizer with Tier 1="none", Tier 2="home", Tier 3="office"', () => {
  const customizer = new ThemeCustomizerClass();
  customizer.init({ targetId: '2' });

  customizer.updateSectionSetting('fast-order-form', 'tier1_free_shipping_mode', 'none');
  customizer.updateSectionSetting('fast-order-form', 'tier2_free_shipping_mode', 'home');
  customizer.updateSectionSetting('fast-order-form', 'tier3_free_shipping_mode', 'office');

  const state = customizer.getState();
  const sec = state.sections['fast-order-form'];
  assert.equal(sec.settings.tier1_free_shipping_mode, 'none');
  assert.equal(sec.settings.tier2_free_shipping_mode, 'home');
  assert.equal(sec.settings.tier3_free_shipping_mode, 'office');
  assert.equal(sec.settings.tier3_free_shipping, true, 'tier3_free_shipping is true when mode is not none');

  // Simulate Save & Reopen
  const serialized = JSON.stringify(state.sections);
  const reopened = new ThemeCustomizerClass();
  reopened.init({ sections: JSON.parse(serialized), targetId: '2' });
  const reopenedSec = reopened.getState().sections['fast-order-form'];

  assert.equal(reopenedSec.settings.tier1_free_shipping_mode, 'none');
  assert.equal(reopenedSec.settings.tier2_free_shipping_mode, 'home');
  assert.equal(reopenedSec.settings.tier3_free_shipping_mode, 'office');
});

runTest('TEST 5: Update customizer with Tier 1="both", Tier 2="none", Tier 3="home"', () => {
  const customizer = new ThemeCustomizerClass();
  customizer.init({ targetId: '2' });

  customizer.updateSectionSetting('fast-order-form', 'tier1_free_shipping_mode', 'both');
  customizer.updateSectionSetting('fast-order-form', 'tier2_free_shipping_mode', 'none');
  customizer.updateSectionSetting('fast-order-form', 'tier3_free_shipping_mode', 'home');

  const state = customizer.getState();
  const sec = state.sections['fast-order-form'];
  assert.equal(sec.settings.tier1_free_shipping_mode, 'both');
  assert.equal(sec.settings.tier2_free_shipping_mode, 'none');
  assert.equal(sec.settings.tier3_free_shipping_mode, 'home');

  // Simulate Save & Reopen
  const serialized = JSON.stringify(state.sections);
  const reopened = new ThemeCustomizerClass();
  reopened.init({ sections: JSON.parse(serialized), targetId: '2' });
  const reopenedSec = reopened.getState().sections['fast-order-form'];

  assert.equal(reopenedSec.settings.tier1_free_shipping_mode, 'both');
  assert.equal(reopenedSec.settings.tier2_free_shipping_mode, 'none');
  assert.equal(reopenedSec.settings.tier3_free_shipping_mode, 'home');
});

console.log('\n── [AXIS 3] DOM UI Rendering & Legacy Checkbox Exclusion ──');

runTest('TEST 6: Customizer UI excludes legacy tier3_free_shipping checkbox', () => {
  // Mock minimal document to test refreshSectionsList output
  const mockContainer = { innerHTML: '' };
  const originalDoc = global.document;

  global.document = {
    getElementById: (id) => {
      if (id === 'sk-sections-list-container') return mockContainer;
      return null;
    }
  };

  try {
    const customizer = new ThemeCustomizerClass();
    customizer.init({ targetId: '2' });
    customizer.selectSection('fast-order-form');
    customizer.refreshSectionsList();

    const rendered = mockContainer.innerHTML;
    // Check that select dropdowns for modes are rendered
    assert.ok(rendered.includes('tier1_free_shipping_mode'), 'tier1_free_shipping_mode select rendered');
    assert.ok(rendered.includes('tier2_free_shipping_mode'), 'tier2_free_shipping_mode select rendered');
    assert.ok(rendered.includes('tier3_free_shipping_mode'), 'tier3_free_shipping_mode select rendered');

    // Check dropdown options
    assert.ok(rendered.includes('❌ بدون توصيل مجاني'), 'none option present');
    assert.ok(rendered.includes('🏠 التوصيل المجاني للمنزل فقط'), 'home option present');
    assert.ok(rendered.includes('🏢 التوصيل المجاني للمكتب فقط'), 'office option present');
    assert.ok(rendered.includes('🎁 التوصيل المجاني للمنزل والمكتب'), 'both option present');

    // Check that legacy boolean checkbox is NOT rendered
    assert.ok(!rendered.includes('sk-chk-fast-order-form-tier3_free_shipping'), 'legacy checkbox ID absent');
    assert.ok(!rendered.includes('تنسيق قديم'), 'legacy label absent');
  } finally {
    global.document = originalDoc;
  }
});

console.log('\n════════════════════════════════════════════════════════════════════════════');
console.log(`📊 FINAL RESULT: ${passCount}/${totalCount} TESTS PASSED`);
console.log('════════════════════════════════════════════════════════════════════════════\n');
