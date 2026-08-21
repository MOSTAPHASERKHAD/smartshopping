/**
 * SmartKiosk / Smart Shopping — Phase 3 Test Suite
 * Visual Sections & Theme Customizer Engine
 * cloudflare-worker/test_phase3_visual_customizer.js
 */

import ThemeSchema from '../themes/theme-schema.js';
import pkgEngine from '../themes/theme-engine.js';
import pkgCustomizer from '../themes/theme-customizer.js';

const { ThemeEngine } = pkgEngine;
const { ThemeCustomizer } = pkgCustomizer;

async function runPhase3Tests() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🎨 SMARTKIOSK — PHASE 3: VISUAL CUSTOMIZER & PREVIEW TEST');
  console.log('═══════════════════════════════════════════════════════════════\n');

  let passed = 0;
  let failed = 0;

  function assert(cond, label) {
    if (cond) {
      console.log(`  ✅ PASS [${String(passed + 1).padStart(2, '0')}]: ${label}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL [${String(failed + 1).padStart(2, '0')}]: ${label}`);
      failed++;
    }
  }

  const engine = new ThemeEngine();

  // ── [1] Initialization ──
  console.log('── [1] Visual Customizer State Initialization ──');
  ThemeCustomizer.init({
    themeId: 'shrine_pro',
    themeName: 'Shrine Pro Edition',
    targetType: 'product',
    targetId: '2'
  });

  const state = ThemeCustomizer.getState();
  assert(state.customizerOpen === true, 'Customizer initialized as open');
  assert(state.targetId === '2', 'Target product ID is 2');
  assert(typeof state.sections === 'object', 'Default sections populated');
  assert(state.sections['hero-banner'] != null, 'Hero banner section present');
  assert(state.sections['fast-order-form'] != null, 'Fast order form section present');

  // ── [2] Visibility Toggling ──
  console.log('\n── [2] Live Section Visibility Toggling ──');
  const wasFaqEnabled = state.sections['faq-accordion'].enabled;
  const newFaqState = ThemeCustomizer.toggleSectionVisibility('faq-accordion', false);
  assert(newFaqState === false, 'FAQ section disabled via customizer');
  assert(state.sections['faq-accordion'].enabled === false, 'State reflected disabled status');

  // ── [3] Reordering (Drag / Up / Down) ──
  console.log('\n── [3] Section Reordering & Priority Control ──');
  ThemeCustomizer.reorderSection('fast-order-form', 1);
  ThemeCustomizer.reorderSection('hero-banner', 2);

  assert(state.sections['fast-order-form'].order === 1, 'Order form promoted to Order 1');
  assert(state.sections['hero-banner'].order === 2, 'Hero banner placed at Order 2');

  // ── [4] Real-Time Settings Mutation ──
  console.log('\n── [4] Section Settings Inspector & Mutation ──');
  ThemeCustomizer.updateSectionSetting('hero-banner', 'headline', 'ساعة الفخامة والتميز ⌚');
  ThemeCustomizer.updateSectionSetting('hero-banner', 'cta_label', '⚡ اطلب الآن واحصل على التوصيل مجاناً');

  assert(state.sections['hero-banner'].settings.headline === 'ساعة الفخامة والتميز ⌚', 'Headline setting updated');
  assert(state.sections['hero-banner'].settings.cta_label.includes('التوصيل مجاناً'), 'CTA label setting updated');

  // ── [5] Live Preview Integration with Engine ──
  console.log('\n── [5] Dynamic Render Generation from Customizer State ──');
  const renderedHtml = engine.renderSections(state.sections, {
    product: { id: 2, name: 'ساعة Sabr', price: 2500 },
    store: { name: 'Smart Shopping' }
  });

  const formIdx = renderedHtml.indexOf('id="fast-order-form"');
  const heroIdx = renderedHtml.indexOf('id="hero-banner"');

  assert(formIdx < heroIdx, 'Live HTML immediately reflects new order (Form before Hero)');
  assert(!renderedHtml.includes('id="faq-accordion"'), 'Live HTML immediately omits disabled FAQ section');
  assert(renderedHtml.includes('ساعة الفخامة والتميز ⌚'), 'Live HTML contains updated headline text');

  // ── [6] Device Mode Switching ──
  console.log('\n── [6] Responsive Viewport Mode Control ──');
  ThemeCustomizer.setDeviceMode('mobile');
  assert(state.deviceMode === 'mobile', 'Device mode switched to mobile (375px)');
  ThemeCustomizer.setDeviceMode('desktop');
  assert(state.deviceMode === 'desktop', 'Device mode switched to desktop (100%)');

  // ── Summary ──
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`📊 PHASE 3 RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase3Tests().catch(err => {
  console.error('Test Runner Exception:', err);
  process.exit(1);
});
