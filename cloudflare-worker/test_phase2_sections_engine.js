/**
 * SmartKiosk / Smart Shopping — Phase 2 Test Suite
 * Shopify-Like Dynamic Sections Parser & Rendering Engine
 * cloudflare-worker/test_phase2_sections_engine.js
 */

import ThemeSchema from '../themes/theme-schema.js';
import pkg from '../themes/theme-engine.js';
const { ThemeEngine } = pkg;

async function runPhase2Tests() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('⚙️ SMARTKIOSK — PHASE 2: SECTIONS PARSER & RENDER ENGINE TEST');
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

  const mockProduct = {
    id: 2,
    name: 'ســـاعة Sabr الفاخرة',
    price: 2500,
    price_old: 3000,
    description: 'ساعة رجالية ونسائية بتصميم ملكي عربي فريد، مقاومة للماء مع ضمان سنة كاملة.',
    images: [
      'https://smartshopping.click/media/watch1.jpg',
      'https://smartshopping.click/media/watch2.jpg'
    ]
  };

  const mockStore = {
    name: 'Smart Shopping Algeria',
    phone: '213557543177'
  };

  const context = {
    product: mockProduct,
    store: mockStore
  };

  // ── [1] Variable Injection Engine ──
  console.log('── [1] Liquid-Style Variable Injection ──');
  const tpl1 = 'مرحباً بكم في متجر {{ store.name }} لشراء {{ product.name }} بسعر {{ product.price }} فقط!';
  const injected = engine.injectVariables(tpl1, context);

  assert(injected.includes('Smart Shopping Algeria'), 'Injected store.name correctly');
  assert(injected.includes('ســـاعة Sabr الفاخرة'), 'Injected product.name correctly');
  assert(/2[.,\s\u202f]?500/.test(injected) && injected.includes('دج'), 'Injected formatted product.price correctly');

  // ── [2] Section Rendering: Hero & Order Form ──
  console.log('\n── [2] Section Rendering (Hero & Order Form) ──');
  const heroHtml = engine.renderSection('hero', 'hero-1', {
    headline: '{{ product.name }} — عرض خاص',
    subtitle: 'شحن مجاني لجميع الولايات',
    cta_label: '🛒 احصل عليها الآن',
    urgency_text: 'تبقى 3 قطع فقط'
  }, context);

  assert(heroHtml.includes('ســـاعة Sabr الفاخرة — عرض خاص'), 'Hero headline rendered with dynamic variable injection');
  assert(heroHtml.includes('تبقى 3 قطع فقط'), 'Hero urgency text rendered');
  assert(heroHtml.includes('احصل عليها الآن'), 'Hero CTA button rendered');

  const orderFormHtml = engine.renderSection('order-form', 'form-1', {
    title: 'استمارة الشراء السريع',
    submit_btn_text: 'تأكيد الطلب المباشر'
  }, context);

  assert(orderFormHtml.includes('id="plOrderForm"'), 'Order form contains canonical form element');
  assert(orderFormHtml.includes('id="plWilaya"'), 'Order form contains 58 wilayas selector');
  assert(orderFormHtml.includes('تأكيد الطلب المباشر'), 'Order form submit button custom text rendered');

  // ── [3] Full Page Reordering & Visibility Toggles ──
  console.log('\n── [3] Section Reordering & Conditional Visibility ──');
  const customSections = {
    "hero-banner": {
      type: "hero",
      enabled: true,
      order: 1,
      settings: { headline: "ساعة صـبر" }
    },
    "fast-order-form": {
      type: "order-form",
      enabled: true,
      order: 2, // Position #2 right below hero
      settings: { title: "اطلب الآن (الدفع عند الاستلام)" }
    },
    "product-gallery": {
      type: "gallery",
      enabled: true,
      order: 3,
      settings: {}
    },
    "faq-accordion": {
      type: "faq",
      enabled: false, // Disabled
      order: 4,
      settings: {}
    },
    "trust-signals": {
      type: "trust",
      enabled: true,
      order: 5,
      settings: {}
    }
  };

  const fullPageHtml = engine.renderSections(customSections, context);

  assert(fullPageHtml.includes('id="hero-banner"'), 'Hero section is present');
  assert(fullPageHtml.includes('id="fast-order-form"'), 'Order form section is present');
  assert(!fullPageHtml.includes('id="faq-accordion"'), 'Disabled FAQ section is completely omitted');

  const heroPos = fullPageHtml.indexOf('id="hero-banner"');
  const formPos = fullPageHtml.indexOf('id="fast-order-form"');
  const galleryPos = fullPageHtml.indexOf('id="product-gallery"');
  const trustPos = fullPageHtml.indexOf('id="trust-signals"');

  assert(heroPos < formPos, 'Hero is positioned before Order Form (Order 1 < 2)');
  assert(formPos < galleryPos, 'Order Form is positioned before Gallery (Order 2 < 3)');
  assert(galleryPos < trustPos, 'Gallery is positioned before Trust Signals (Order 3 < 5)');

  // ── [4] High Performance Benchmark ──
  console.log('\n── [4] Engine Performance & Benchmarking ──');
  const startTime = Date.now();
  for (let i = 0; i < 500; i++) {
    engine.renderSections(customSections, context);
  }
  const duration = Date.now() - startTime;
  const avgPerRender = duration / 500;
  console.log(`  ⏱️ Rendered 500 dynamic pages in ${duration}ms (Avg: ${avgPerRender.toFixed(3)}ms/page)`);

  assert(avgPerRender < 5.0, 'Sub-5ms ultra-fast section rendering confirmed');

  // ── Summary ──
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`📊 PHASE 2 RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase2Tests().catch(err => {
  console.error('Test Runner Exception:', err);
  process.exit(1);
});
