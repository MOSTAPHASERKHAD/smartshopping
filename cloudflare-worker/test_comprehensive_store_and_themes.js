/**
 * SMARTKIOSK / SMART SHOPPING — COMPREHENSIVE STORE & THEME INTEGRATION TEST SUITE
 * cloudflare-worker/test_comprehensive_store_and_themes.js
 * 
 * Verifies all 8 critical operational axes:
 * [AXIS 1] ThemeEngine Core: init, 13 built-in themes, tokensToCSS, dark mode, inheritance
 * [AXIS 2] Dynamic Sections Parser: Shopify-like rendering, liquid vars, custom HTML/CSS blocks
 * [AXIS 3] Theme Customizer: state management, reordering, visibility toggle, settings mutation
 * [AXIS 4] Theme Importer & Exporter: Shopify settings_data.json, CSS vars, JSON bundles
 * [AXIS 5] Storefront Pro Features: Variant Swatches, Quantity Breaks & BOGO tiers
 * [AXIS 6] Algerian 58-Wilayas Logistics: multi-carrier shipping, home/office delivery
 * [AXIS 7] End-to-End Order Pipeline: anti-tampering server pricing, canonical SK- order IDs
 * [AXIS 8] Meta CAPI & Privacy Guardrails: SHA-256 hashing, deduplication, zero-leakage
 */

import { createHash } from 'crypto';
import { createOrder } from './src/handlers/orders.js';
import { adminListThemes, adminSaveTheme, adminDeleteTheme, adminSaveThemeSections, getThemeSections } from './src/handlers/themes.js';
import { sendCapiEvent, normalizePhone } from './src/handlers/marketing.js';

// Load Node.js compatible Theme Engine modules
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const pkgSchema = require('../themes/theme-schema.js');
const pkgEngine = require('../themes/theme-engine.js');
const pkgImporter = require('../themes/theme-importer.js');
const pkgCustomizer = require('../themes/theme-customizer.js');
const pkgDefaultThemes = require('../themes/default-themes.js');
const productUtils = require('../assets/js/product-utils.js');

const {
  WILAYAS,
  normalizeProduct,
  calculateClientShippingCost,
  calculateTierSubtotal,
  renderVariantSwatches,
  renderQuantityBreaks
} = (productUtils && productUtils.default) ? productUtils.default : productUtils;

const { ThemeSchema } = pkgSchema;
const { ThemeEngine, themeEngine } = pkgEngine;
const { ThemeImporter } = pkgImporter;
const { ThemeCustomizer, ThemeCustomizerClass } = pkgCustomizer;
const { SmartKioskThemes } = pkgDefaultThemes;

// ── Test Runner Utilities ──
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, description) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ PASS [${String(passedTests).padStart(2, '0')}]: ${description}`);
  } else {
    failedTests++;
    console.error(`  ❌ FAIL [${String(failedTests).padStart(2, '0')}]: ${description}`);
  }
}

async function runComprehensiveTestSuite() {
  console.log('════════════════════════════════════════════════════════════════════════════');
  console.log('🚀 SMARTKIOSK — COMPREHENSIVE STORE & THEME INTEGRATION TEST HARNESS');
  console.log('════════════════════════════════════════════════════════════════════════════\n');

  // ══════════════════════════════════════════════════════════════════════════
  // ── [AXIS 1] ThemeEngine Core & Built-in Themes ──
  // ══════════════════════════════════════════════════════════════════════════
  console.log('── [AXIS 1] ThemeEngine Core & Built-in Theme Registry ──');

  global.SmartKioskThemes = SmartKioskThemes;
  const engine = new ThemeEngine();
  engine.init();

  assert(Array.isArray(SmartKioskThemes) && SmartKioskThemes.length >= 13, 'Loaded all 13 built-in themes from default-themes.js');
  
  const allThemes = engine.list();
  assert(allThemes.length >= 13, 'ThemeEngine.list() returns all registered built-in themes');

  const defaultTheme = engine.get('smartkiosk-default');
  assert(defaultTheme !== null && defaultTheme.name === 'Smart Kiosk', 'Retrieved smartkiosk-default theme with valid structure');

  const shrineTheme = engine.get('shrine');
  assert(shrineTheme !== null && shrineTheme.tokens.colors.secondary === '#dd1d1d', 'Retrieved shrine pro theme with secondary accent');

  const activeThemeId = engine.getActiveThemeId();
  assert(typeof activeThemeId === 'string' && activeThemeId.length > 0, 'ThemeEngine.getActiveThemeId() returns active theme');

  // Test mode switching and static property proxies
  ThemeEngine.setMode('dark');
  assert(ThemeEngine.mode === 'dark', 'ThemeEngine static mode proxy correctly reflects dark mode');

  ThemeEngine.setMode('light');
  assert(ThemeEngine.mode === 'light', 'ThemeEngine static mode proxy correctly reflects light mode');

  // Test tokens to CSS generation
  const testTokens = {
    colors: { primary: '#0f172a', secondary: '#3b82f6', background: '#ffffff', surface: '#f8fafc', text: '#0f172a' },
    fonts: { heading: "'Cairo',sans-serif", body: "'Inter',sans-serif" },
    radius: { sm: '4px', md: '8px', lg: '12px' }
  };
  const css = engine.tokensToCSS(testTokens, 'light', 'light');
  assert(css.includes('--color-primary:#0f172a;') && css.includes('--ds-primary:#0f172a;'), 'Generated CSS includes direct and landing page bridge tokens');
  assert(css.includes('--font-heading:') && css.includes('--radius-md:8px;'), 'Generated CSS includes font and radius properties');

  // ══════════════════════════════════════════════════════════════════════════
  // ── [AXIS 2] Dynamic Sections Parser & Liquid Template Interpolation ──
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n── [AXIS 2] Dynamic Sections Parser & Template Interpolation ──');

  const mockProduct = {
    id: 101,
    name: 'ساعة الفخامة الذهبية',
    price: 3800,
    price_old: 4800,
    description: 'ساعة يدوية فاخرة مقاومة للماء مع ضمان سنة كاملة.',
    image_url: 'https://smartshopping.click/watch.jpg'
  };

  const sectionsConfig = {
    "hero-banner": {
      type: "hero",
      enabled: true,
      order: 1,
      settings: {
        headline: "{{ product.name }}",
        subtitle: "عرض خاص لفترة محدودة",
        cta_label: "🛒 اطلب الآن",
        urgency_text: "بقي 5 قطع فقط في المخزن!"
      }
    },
    "fast-order-form": {
      type: "order-form",
      enabled: true,
      order: 2,
      settings: {
        title: "استمارة الطلب السريع",
        badge_text: "⚡ تأكيد فوري وسريع"
      }
    },
    "custom-banner": {
      type: "custom-code",
      enabled: true,
      order: 3,
      settings: {
        raw_html: "<div class='promo-banner'>خصم إضافي لمتجر {{ store.name }}</div>",
        custom_css: ".promo-banner { color: #e11d48; font-weight: bold; }",
        device_visibility: "mobile_only"
      }
    },
    "disabled-reviews": {
      type: "reviews",
      enabled: false,
      order: 4,
      settings: {}
    }
  };

  const renderedHtml = engine.renderSections(sectionsConfig, { product: mockProduct, store: { name: 'SmartShopping' } });
  
  assert(renderedHtml.includes('ساعة الفخامة الذهبية'), 'Injected {{ product.name }} into rendered hero headline');
  assert(renderedHtml.includes('pl-price-val') && renderedHtml.includes('دج'), 'Injected formatted product price into rendered HTML');
  assert(renderedHtml.includes('pl-price-old') && renderedHtml.includes('دج'), 'Injected formatted old price into rendered HTML');
  assert(renderedHtml.includes('بقي 5 قطع فقط في المخزن!'), 'Injected urgency badge text');
  assert(renderedHtml.includes('id="plOrderForm"'), 'Rendered fast order form with standard submit ID');
  assert(renderedHtml.includes('خصم إضافي لمتجر SmartShopping'), 'Rendered custom HTML block with {{ store.name }} variable');
  assert(renderedHtml.includes('sk-mobile-only'), 'Applied mobile-only responsive class to custom section');
  assert(!renderedHtml.includes('disabled-reviews'), 'Omitted disabled sections from rendered output');

  // ══════════════════════════════════════════════════════════════════════════
  // ── [AXIS 3] Visual Theme Customizer ──
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n── [AXIS 3] Visual Theme Customizer State Engine ──');

  const customizer = new ThemeCustomizerClass();
  customizer.init({
    themeId: 'shrine',
    themeName: 'Shrine Pro',
    targetType: 'product',
    targetId: '101',
    sections: JSON.parse(JSON.stringify(sectionsConfig))
  });

  const customizerState = customizer.getState();
  assert(customizerState.customizerOpen === true, 'Customizer initialized with open state');
  assert(customizerState.themeId === 'shrine', 'Customizer loaded target theme shrine');

  // Toggle section visibility
  const newVis = customizer.toggleSectionVisibility('fast-order-form', false);
  assert(newVis === false && customizerState.sections['fast-order-form'].enabled === false, 'Disabled order form section via customizer');

  // Reorder section
  customizer.reorderSection('custom-banner', 1);
  assert(customizerState.sections['custom-banner'].order === 1, 'Promoted custom banner section to order 1');

  // Update section setting
  customizer.updateSectionSetting('hero-banner', 'headline', 'ساعة ملكية فاخرة');
  assert(customizerState.sections['hero-banner'].settings.headline === 'ساعة ملكية فاخرة', 'Updated section setting in customizer state');

  // Device mode switching
  customizer.setDeviceMode('mobile');
  assert(customizerState.deviceMode === 'mobile', 'Set customizer device mode to mobile');
  customizer.setDeviceMode('desktop');
  assert(customizerState.deviceMode === 'desktop', 'Set customizer device mode to desktop');

  // Close customizer
  customizer.close();
  assert(customizerState.customizerOpen === false, 'Closed customizer cleanly');

  // ══════════════════════════════════════════════════════════════════════════
  // ── [AXIS 4] Theme Importer & Exporter ──
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n── [AXIS 4] Theme Importer & Exporter ──');

  // Test 1: Native SmartKiosk Format
  const nativeThemeJson = {
    __format: 'smartkiosk',
    id: 'my-custom-theme',
    name: 'My Custom Theme',
    author: 'Designer Mostapha',
    tokens: {
      colors: { primary: '#4f46e5', secondary: '#10b981', background: '#f9fafb' }
    }
  };
  const normalizedNative = ThemeImporter.normalize(nativeThemeJson);
  assert(normalizedNative.id === 'my-custom-theme' && normalizedNative.tokens.colors.primary === '#4f46e5', 'Normalized native SmartKiosk theme format');

  // Test 2: Shopify settings_data.json Format
  const shopifySettingsData = {
    current: {
      color_primary: '#dc2626',
      color_secondary: '#f59e0b',
      color_bg: '#ffffff',
      color_text: '#111827',
      font_heading: 'Almarai'
    }
  };
  const normalizedShopify = ThemeImporter.normalize(shopifySettingsData);
  assert(normalizedShopify.tokens.colors.primary === '#dc2626', 'Mapped Shopify color_primary -> tokens.colors.primary');
  assert(normalizedShopify.tokens.colors.secondary === '#f59e0b', 'Mapped Shopify color_secondary -> tokens.colors.secondary');

  // Test 3: Export Theme JSON
  const exported = engine.exportTheme('rose');
  assert(exported !== null && exported.id === 'rose' && exported.__format === 'smartkiosk', 'Exported rose theme with canonical __format: smartkiosk');

  // ══════════════════════════════════════════════════════════════════════════
  // ── [AXIS 5] Storefront Pro Features (Swatches & Quantity Breaks) ──
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n── [AXIS 5] Storefront Pro Features (Swatches & Quantity Breaks) ──');

  const rawProduct = {
    id: 202,
    name: 'حذاء رياضي أنيق',
    price: 3200,
    price_old: 4500,
    stock: 50,
    variant_options: JSON.stringify([
      { name: 'اللون', type: 'color', values: [{ name: 'أسود', color: '#111827' }, { name: 'أبيض', color: '#ffffff' }] },
      { name: 'المقاس', type: 'pill', values: [{ name: '40' }, { name: '41' }, { name: '42' }] }
    ]),
    pricing_tiers: JSON.stringify([
      { qty: 1, price: 3200, label: 'قطعة واحدة', badge: '' },
      { qty: 2, price: 5440, label: 'قطعتان (خصم 15%)', badge: 'الأكثر طلباً 🔥' },
      { qty: 3, price: 9600, free_shipping: true, label: '3 قطع (شحن مجاني)', badge: 'أفضل توفير 💰' }
    ])
  };

  const normProduct = normalizeProduct(rawProduct);
  assert(Array.isArray(normProduct.variant_options) && normProduct.variant_options.length === 2, 'Normalized variant options array');
  assert(Array.isArray(normProduct.pricing_tiers) && normProduct.pricing_tiers.length === 3, 'Normalized pricing tiers array');

  // Test HTML rendering for Variant Swatches
  const swatchesHtml = renderVariantSwatches(normProduct.variant_options);
  assert(swatchesHtml.includes('pl-swatch-color') && swatchesHtml.includes('background-color:#111827'), 'Rendered color swatches with hex background');
  assert(swatchesHtml.includes('pl-swatch-pill') && swatchesHtml.includes('41'), 'Rendered size pill buttons');

  // Test HTML rendering for Quantity Breaks
  const qbHtml = renderQuantityBreaks(normProduct.pricing_tiers, 3200, 1);
  assert(qbHtml.includes('pl-tier-card') && qbHtml.includes('الأكثر طلباً 🔥'), 'Rendered Quantity Breaks cards with badge');

  // Test Tier Subtotal Calculations
  const tier1Calc = calculateTierSubtotal(3200, 1, normProduct.pricing_tiers);
  assert(tier1Calc.subtotal === 3200 && tier1Calc.saveAmount === 0, 'Tier 1 calculation: 1 * 3200 = 3200 DZD');

  const tier2Calc = calculateTierSubtotal(3200, 2, normProduct.pricing_tiers);
  assert(tier2Calc.subtotal === 5440 && tier2Calc.saveAmount === 960, 'Tier 2 calculation (15% off): 2 * 3200 * 0.85 = 5440 DZD');

  const tier3Calc = calculateTierSubtotal(3200, 3, normProduct.pricing_tiers);
  assert(tier3Calc.subtotal === 9600 && tier3Calc.freeShipping === true, 'Tier 3 calculation: 3 * 3200 = 9600 DZD with Free Shipping flag');

  // ══════════════════════════════════════════════════════════════════════════
  // ── [AXIS 6] Algerian 58-Wilayas Logistics & Multi-Carrier Calculator ──
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n── [AXIS 6] Algerian 58-Wilayas Logistics Calculator ──');

  assert(WILAYAS.length === 58, 'Loaded all 58 official Algerian Wilayas');

  const multiCarrierConfig = JSON.stringify({
    version: 2,
    active_carrier: 'yalidine',
    enable_home: true,
    enable_office: true,
    carriers: [
      {
        id: 'yalidine',
        name: 'Yalidine Express',
        active: true,
        rates: {
          '16': { home: 400, office: 250, active: true },
          '31': { home: 550, office: 350, active: true },
          '47': { home: 900, office: 650, active: true }
        }
      }
    ]
  });

  const algerHome = calculateClientShippingCost(multiCarrierConfig, '16', 'Home', [{ id: 202, qty: 1 }], {});
  assert(algerHome.cost === 400 && algerHome.carrier.includes('Yalidine'), 'Algiers (16) Home delivery rate is 400 DZD');

  const oranOffice = calculateClientShippingCost(multiCarrierConfig, '31', 'Office', [{ id: 202, qty: 1 }], {});
  assert(oranOffice.cost === 350 && oranOffice.carrier.includes('Yalidine'), 'Oran (31) Office delivery rate is 350 DZD');

  const ghardaiaHome = calculateClientShippingCost(multiCarrierConfig, '47', 'Home', [{ id: 202, qty: 1 }], {});
  assert(ghardaiaHome.cost === 900, 'Ghardaia (47) Home delivery rate is 900 DZD');

  // ══════════════════════════════════════════════════════════════════════════
  // ── [AXIS 7] End-to-End Order Pipeline & Anti-Tampering Security ──
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n── [AXIS 7] Order Pipeline & Server Anti-Tampering Security ──');

  let insertedOrderRecord = null;
  const mockDb = {
    prepare(sql) {
      return {
        bind(...args) {
          this.args = args;
          return this;
        },
        async first() {
          if (sql.includes('FROM products')) {
            return { id: 202, name: 'حذاء رياضي أنيق', price: 3200, active: 1, stock: 50, weight: 0.5 };
          }
          if (sql.includes('FROM settings')) {
            return { value: multiCarrierConfig };
          }
          return null;
        },
        async all() {
          if (sql.includes('FROM products')) {
            return { results: [{ id: 202, name: 'حذاء رياضي أنيق', price: 3200, active: 1, stock: 50, weight: 0.5 }] };
          }
          if (sql.includes('FROM settings')) {
            return {
              results: [
                { key: 'shipping_config', value: multiCarrierConfig },
                { key: 'capi_enabled', value: 'true' },
                { key: 'fb_capi_token', value: 'EAAB_TEST_TOKEN' },
                { key: 'fb_pixel_id', value: '928523816193898' }
              ]
            };
          }
          return { results: [] };
        },
        async run() {
          if (sql.includes('INSERT INTO orders')) {
            insertedOrderRecord = { sql, args: this.args };
          }
          return { meta: { changes: 1 } };
        }
      };
    }
  };

  const mockEnv = {
    DB: mockDb,
    ALLOWED_ORIGINS: '*'
  };

  const mockCtx = {
    waitUntil(p) { return p; }
  };

  // User attempts to spoof price to 10 DZD (Anti-tampering test)
  const spoofedOrderPayload = {
    name: 'ياسين بلخيري',
    phone: '0661234567',
    email: 'yassine@example.com',
    wilaya_code: '16',
    municipality: 'الجزائر الوسطى',
    address: 'شارع حسيبة بن بوعلي',
    delivery_type: 'Home',
    items_json: JSON.stringify([{ id: 202, qty: 1, price: 10, variant_title: 'أسود / 42' }]),
    fbc: 'fb.1.1787200000.IwARtest',
    fbp: 'fb.1.1787200000.12345'
  };

  const mockReq = new Request('https://smartshopping.click/api', {
    headers: { 'CF-Connecting-IP': '105.105.105.1', 'User-Agent': 'Mozilla/5.0' }
  });

  const orderResult = await createOrder(mockEnv, spoofedOrderPayload, mockReq, mockCtx, null, 'tenant_master_default');

  assert(orderResult.ok === true, 'Order created successfully');
  assert(orderResult.order_id && orderResult.order_id.startsWith('SK-'), 'Canonical order ID format (SK-*)');
  assert(orderResult.total === 3600, 'Server enforced authoritative price: 3200 Product + 400 Shipping = 3600 DZD (10 DZD spoof was rejected)');

  // ══════════════════════════════════════════════════════════════════════════
  // ── [AXIS 8] Meta CAPI Deduplication & Privacy Guardrails ──
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n── [AXIS 8] Meta CAPI Deduplication & Privacy Guardrails ──');

  let capiCapturedCall = null;
  const originalFetch = global.fetch;
  global.fetch = async function(url, opts) {
    if (url.includes('graph.facebook.com')) {
      capiCapturedCall = { url, body: JSON.parse(opts.body) };
      return new Response(JSON.stringify({ events_received: 1, fbtrace_id: 'TRACE_COMPREHENSIVE_OK' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return originalFetch.apply(this, arguments);
  };

  await sendCapiEvent(mockEnv, 'Purchase', {
    value: orderResult.total,
    order_id: orderResult.order_id,
    content_ids: ['202'],
    event_source_url: 'https://smartshopping.click/product.html?product=202'
  }, {
    phone: spoofedOrderPayload.phone,
    email: spoofedOrderPayload.email,
    fbc: spoofedOrderPayload.fbc,
    fbp: spoofedOrderPayload.fbp
  }, mockReq, 'tenant_master_default');

  assert(capiCapturedCall !== null, 'Intercepted outgoing Meta CAPI Purchase event');
  
  const eventData = capiCapturedCall.body.data[0];
  assert(eventData.event_name === 'Purchase', 'CAPI event name is Purchase');
  assert(eventData.event_id === orderResult.order_id, 'CAPI event_id strictly matches server order_id for browser deduplication');
  assert(eventData.custom_data.value === 3600, 'CAPI purchase value matches authoritative order total (3600 DZD)');
  assert(eventData.custom_data.currency === 'DZD', 'CAPI currency is DZD');

  // Verify SHA-256 Hashing & Zero Raw Data Leakage
  const expectedPhoneHash = createHash('sha256').update(normalizePhone(spoofedOrderPayload.phone)).digest('hex');
  const expectedEmailHash = createHash('sha256').update('yassine@example.com').digest('hex');
  
  assert(eventData.user_data.ph && eventData.user_data.ph[0] === expectedPhoneHash, 'Phone number properly normalized to E.164 and SHA-256 hashed');
  assert(eventData.user_data.em && eventData.user_data.em[0] === expectedEmailHash, 'Email properly normalized and SHA-256 hashed');

  const rawJson = JSON.stringify(capiCapturedCall.body);
  assert(!rawJson.includes('0661234567') && !rawJson.includes('yassine@example.com'), 'ZERO-LEAKAGE VERIFIED: Raw phone and email never present in outgoing CAPI payload');

  // Restore fetch
  global.fetch = originalFetch;

  // ══════════════════════════════════════════════════════════════════════════
  // ── FINAL SUMMARY ──
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════════════════════════════════════════');
  console.log(`📊 COMPREHENSIVE SUITE RESULTS: ${passedTests} / ${totalTests} PASSED (${failedTests} FAILED)`);
  console.log('════════════════════════════════════════════════════════════════════════════\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runComprehensiveTestSuite().catch(err => {
  console.error('Fatal Test Exception:', err);
  process.exit(1);
});
