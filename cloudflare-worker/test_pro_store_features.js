/**
 * SmartKiosk / Smart Shopping — Pro Features Test Suite
 * 1. Advanced Variant Swatches
 * 2. Quantity Breaks & Tiered Pricing (BOGOs)
 * 3. Custom Liquid / HTML Dynamic Blocks
 * cloudflare-worker/test_pro_store_features.js
 */

import productUtils from '../assets/js/product-utils.js';
import ThemeSchema from '../themes/theme-schema.js';
import pkgEngine from '../themes/theme-engine.js';
import { createOrder } from './src/handlers/orders.js';
import { sendCapiEvent } from './src/handlers/marketing.js';

const { normalizeProduct, renderVariantSwatches, renderQuantityBreaks, calculateTierSubtotal } = productUtils;
const { ThemeEngine } = pkgEngine;

async function runProFeaturesTests() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🚀 SMARTKIOSK — PRO FEATURES & ADVANCED CAPABILITIES TEST');
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

  // ── [1] Advanced Variant Swatches ──
  console.log('── [1] Advanced Variant Swatches Engine ──');
  const mockVariantProduct = {
    id: 2,
    name: 'ساعة Sabr الفاخرة',
    price: 2500,
    variant_options: [
      {
        id: 'color',
        name: 'اللون',
        type: 'color',
        values: [
          { name: 'ذهبي ملكي', color: '#d4af37', image: 'https://smartshopping.click/media/watch-gold.jpg', price: 2500 },
          { name: 'فضي كلاسيكي', color: '#c0c0c0', image: 'https://smartshopping.click/media/watch-silver.jpg', price: 2500 },
          { name: 'أسود ملكي', color: '#121212', image: 'https://smartshopping.click/media/watch-black.jpg', price: 2800 }
        ]
      },
      {
        id: 'size',
        name: 'المقاس',
        type: 'pill',
        values: ['40mm', '44mm']
      }
    ]
  };

  const normalizedProd = normalizeProduct(mockVariantProduct);
  assert(normalizedProd.variant_options.length === 2, 'Parsed 2 variant option groups');

  const swatchesHtml = renderVariantSwatches(normalizedProd.variant_options, { color: 'ذهبي ملكي', size: '44mm' });
  assert(swatchesHtml.includes('data-option-id="color"'), 'Rendered color swatch group');
  assert(swatchesHtml.includes('style="background-color:#d4af37'), 'Rendered gold hex background circle');
  assert(swatchesHtml.includes('data-price="2800"'), 'Included variant price override attribute');
  assert(swatchesHtml.includes('44mm'), 'Rendered size option pill');

  // ── [2] Quantity Breaks & Tiered Pricing ──
  console.log('\n── [2] Quantity Breaks & Tiered Pricing (BOGO Engine) ──');
  const customTiers = [
    { qty: 1, label: 'قطعة واحدة', price: 2500, subtext: 'سعر الحبة العادي' },
    { qty: 2, label: 'قطعتين (الأكثر طلباً ⭐)', price: 4500, badge: 'وفر 500 دج', subtext: 'توفير مباشر' },
    { qty: 3, label: '3 قطع (أفضل قيمة 🎁)', price: 6000, badge: 'شحن مجاني + خصم 1500 دج', free_shipping: true, subtext: 'شحن مجاني للباب' }
  ];

  const bundleHtml = renderQuantityBreaks(customTiers, 2500, 2);
  assert(bundleHtml.includes('data-qty="1"'), 'Rendered 1-piece tier card');
  assert(bundleHtml.includes('data-qty="2"'), 'Rendered 2-piece tier card');
  assert(bundleHtml.includes('data-qty="3"'), 'Rendered 3-piece tier card');
  assert(bundleHtml.includes('وفر 500 دج'), 'Rendered savings badge');
  assert(bundleHtml.includes('توصيل مجاني للباب'), 'Rendered free shipping guarantee');

  // Calculations test
  const calc1 = calculateTierSubtotal(2500, 1, customTiers);
  assert(calc1.subtotal === 2500 && calc1.saveAmount === 0 && !calc1.freeShipping, 'Tier 1 subtotal: 2500 DZD');

  const calc2 = calculateTierSubtotal(2500, 2, customTiers);
  assert(calc2.subtotal === 4500 && calc2.saveAmount === 500 && !calc2.freeShipping, 'Tier 2 subtotal: 4500 DZD (Saved 500 DZD)');

  const calc3 = calculateTierSubtotal(2500, 3, customTiers);
  assert(calc3.subtotal === 6000 && calc3.saveAmount === 1500 && calc3.freeShipping === true, 'Tier 3 subtotal: 6000 DZD with Free Shipping (Saved 1500 DZD)');

  // ── [3] Custom Liquid / HTML Dynamic Section ──
  console.log('\n── [3] Custom Liquid / HTML Dynamic Blocks Engine ──');
  const customSectionHtml = engine.renderSection('custom-code', 'custom-banner-1', {
    raw_html: '<div class="promo-box">🌟 عرض خاص على {{ product.name }} فقط بـ {{ product.price }}!</div>',
    custom_css: '.promo-box { background: #fffae6; padding: 15px; border-radius: 8px; }',
    container_width: 'contained',
    device_visibility: 'mobile_only'
  }, {
    product: { name: 'ساعة Sabr', price: 2500 }
  });

  assert(customSectionHtml.includes('sk-custom-code'), 'Section has sk-custom-code class');
  assert(customSectionHtml.includes('sk-mobile-only'), 'Section has mobile-only visibility class');
  assert(customSectionHtml.includes('<style>.promo-box'), 'Custom scoped CSS injected');
  assert(customSectionHtml.includes('عرض خاص على ساعة Sabr'), 'Liquid variable {{ product.name }} injected');

  // ── [4] Backend Order Integrity & CAPI with Variants & Bundles ──
  console.log('\n── [4] Backend Order Integrity & Meta CAPI with Variants ──');
  
  let insertedOrder = null;
  let capturedCapiCall = null;

  const mockDb = {
    prepare(sql) {
      return {
        bind(...args) {
          this.args = args;
          return this;
        },
        async first() {
          if (sql.includes('spam_order_')) {
            return null;
          }
          if (sql.includes('FROM products')) {
            return {
              id: 2,
              name: 'ساعة Sabr الفاخرة',
              price: 2500,
              active: 1,
              stock: 10,
              weight: null
            };
          }
          if (sql.includes('FROM settings')) {
            return { value: '{"rates":{"16":{"home":500,"office":350}}}' };
          }
          return null;
        },
        async all() {
          if (sql.includes('FROM products')) {
            return {
              results: [{
                id: 2,
                name: 'ساعة Sabr الفاخرة',
                price: 2500,
                active: 1,
                stock: 10,
                weight: null
              }]
            };
          }
          if (sql.includes('FROM settings')) {
            return {
              results: [
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
            insertedOrder = { sql, args: this.args };
          }
          return { meta: { changes: 1 } };
        }
      };
    }
  };

  const originalFetch = global.fetch;
  global.fetch = async function (url, opts) {
    if (url.includes('graph.facebook.com')) {
      capturedCapiCall = {
        url,
        payload: JSON.parse(opts.body)
      };
      return new Response(JSON.stringify({ events_received: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return originalFetch.apply(this, arguments);
  };

  const orderParams = {
    name: 'كريم بلحاج',
    phone: '0661123456',
    email: 'karim@example.com',
    wilaya_code: '16',
    municipality: 'باب الزوار',
    address: 'حي 5 جويلية',
    delivery_type: 'Home',
    items_json: JSON.stringify([{
      id: 2,
      qty: 2,
      price: 2500,
      variant_selection: { color: 'أسود ملكي', size: '44mm' },
      variant_title: 'أسود ملكي / 44mm',
      tier_subtotal: 4500
    }])
  };

  const mockEnv = { DB: mockDb, ALLOWED_ORIGINS: '*' };
  const mockCtx = { waitUntil: (p) => p };
  const mockRequest = new Request('https://smartshopping.click/api', {
    headers: { 'CF-Connecting-IP': '105.105.105.105', 'User-Agent': 'Mozilla/5.0' }
  });

  const resOrder = await createOrder(mockEnv, orderParams, mockRequest, mockCtx, null, 'tenant_master_default');
  console.log('DEBUG resOrder:', resOrder);

  assert(resOrder.ok === true, 'Order created with variant details');
  assert(resOrder.total === 5000, 'Order total is 5000 DZD (4500 Tier Subtotal + 500 Shipping)');

  // Verify variant was persisted in items_json
  const savedItemsJson = insertedOrder.args[10]; // items_json is 11th arg
  assert(savedItemsJson.includes('أسود ملكي / 44mm'), 'Variant title stored in database orders');

  // Verify CAPI event
  await sendCapiEvent(mockEnv, 'Purchase', {
    value: resOrder.total,
    order_id: resOrder.order_id,
    content_ids: ['2']
  }, {
    phone: orderParams.phone,
    email: orderParams.email
  }, mockRequest);

  assert(capturedCapiCall != null, 'CAPI Purchase event captured');
  assert(capturedCapiCall.payload.data[0].custom_data.value === 5000, 'CAPI Purchase value matches exact tier order total (5000 DZD)');

  global.fetch = originalFetch;

  // ── Summary ──
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`📊 PRO FEATURES RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runProFeaturesTests().catch(err => {
  console.error('Test Runner Exception:', err);
  process.exit(1);
});
