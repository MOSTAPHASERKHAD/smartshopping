/**
 * SmartKiosk / Smart Shopping — Master System Integrity & Post-Deployment Audit
 * File: cloudflare-worker/test_master_system_audit.js
 * 
 * Comprehensive 6-Axis Audit covering:
 * 1. Frontend & DOM Rendering (Variants, Swatches, Bundles, Landing Page)
 * 2. 58-Wilayas Shipping Engine (Home/Office across all 58 wilayas)
 * 3. Order Lifecycle & Server-Side Authoritative Security
 * 4. Meta CAPI Tracking Guardrails, SHA-256 Hashing & UTM Attribution
 * 5. Admin Panel & Multi-Tenant Isolation
 * 6. Automated Regression & Test Harness Validation
 */

import productUtils from '../assets/js/product-utils.js';
import ThemeSchema from '../themes/theme-schema.js';
import pkgEngine from '../themes/theme-engine.js';
import ThemeImporter from '../themes/theme-importer.js';
import { createOrder, adminListOrders } from './src/handlers/orders.js';
import { adminListThemes } from './src/handlers/themes.js';
import { sendCapiEvent, normalizePhone, normalizeEmail, formatFbc } from './src/handlers/marketing.js';
import { sha256 } from './src/utils/auth.js';

const {
  WILAYAS,
  normalizeProduct,
  calculateClientShippingCost,
  formatPrice,
  renderVariantSwatches,
  renderQuantityBreaks,
  calculateTierSubtotal,
  captureUTM,
  getUTM,
  getMetaTracking
} = productUtils;

const { ThemeEngine } = pkgEngine;

async function runMasterSystemAudit() {
  console.log('════════════════════════════════════════════════════════════════════════════');
  console.log('🛡️ SMARTKIOSK — POST-DEPLOYMENT MASTER INTEGRITY & ZERO-REGRESSION AUDIT');
  console.log('════════════════════════════════════════════════════════════════════════════\n');

  let passed = 0;
  let failed = 0;
  const auditLog = [];

  function check(axis, testName, condition, details = '') {
    if (condition) {
      passed++;
      const msg = `  ✅ PASS [${String(passed).padStart(2, '0')}]: [${axis}] ${testName}`;
      console.log(msg + (details ? ` (${details})` : ''));
      auditLog.push({ axis, test: testName, status: 'PASS', details });
    } else {
      failed++;
      const msg = `  ❌ FAIL [${String(failed).padStart(2, '0')}]: [${axis}] ${testName}`;
      console.error(msg + (details ? ` (${details})` : ''));
      auditLog.push({ axis, test: testName, status: 'FAIL', details });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ── AXIS 1: Frontend & DOM Rendering (Landing Page, Variants, Bundles) ──
  // ══════════════════════════════════════════════════════════════════════════
  console.log('── [AXIS 1] Frontend & DOM Rendering Engine ──');

  const mockProduct = {
    id: 2,
    name: 'ساعة Sabr الفاخرة',
    title_ar: 'ساعة الصبر الفاخرة المقاومة للماء',
    price: 2500,
    price_old: 3500,
    active: 1,
    stock: 25,
    weight: 0.35,
    description: 'ساعة إسلامية أنيقة بلمسات ذهبية عصرية',
    variant_options: [
      {
        id: 'color',
        name: 'اللون',
        type: 'color',
        values: [
          { name: 'ذهبي ملكي', color: '#d4af37', image: 'https://smartshopping.click/media/gold.jpg', price: 2500 },
          { name: 'فضي كلاسيكي', color: '#c0c0c0', image: 'https://smartshopping.click/media/silver.jpg', price: 2500 },
          { name: 'أسود فحمي', color: '#121212', image: 'https://smartshopping.click/media/black.jpg', price: 2800 }
        ]
      },
      {
        id: 'strap',
        name: 'نوع السوار',
        type: 'pill',
        values: ['جلد طبيعي', 'ستيل مقاوم للصدأ']
      }
    ],
    pricing_tiers: [
      { qty: 1, label: '1 قطعة (شراء عادي)', price: 2500, subtext: 'السعر القياسي' },
      { qty: 2, label: '2 قطع (الأكثر طلباً ⭐)', price: 4500, badge: 'وفر 500 دج', subtext: 'العرض الموصى به' },
      { qty: 3, label: '3 قطع (توفير كلي 🎁)', price: 6000, badge: 'شحن مجاني + خصم 1500 دج', free_shipping: true, subtext: 'أفضل توفير' }
    ]
  };

  const norm = normalizeProduct(mockProduct);
  check('AXIS 1', 'Product normalization integrity', norm.id === 2 && norm.old_price === 3500);
  check('AXIS 1', 'Variant options schema normalization', Array.isArray(norm.variant_options) && norm.variant_options.length === 2);
  check('AXIS 1', 'Pricing tiers schema normalization', Array.isArray(norm.pricing_tiers) && norm.pricing_tiers.length === 3);

  // Variant Swatches HTML Rendering
  const swatchesHtml = renderVariantSwatches(norm.variant_options, { color: 'ذهبي ملكي', strap: 'جلد طبيعي' });
  check('AXIS 1', 'Variant Swatches HTML structure', swatchesHtml.includes('pl-variants-container') && swatchesHtml.includes('data-option-id="color"'));
  check('AXIS 1', 'Hex color circles rendering', swatchesHtml.includes('background-color:#d4af37') && swatchesHtml.includes('title="ذهبي ملكي"'));
  check('AXIS 1', 'Pill buttons rendering', swatchesHtml.includes('pl-swatch-pill') && swatchesHtml.includes('ستيل مقاوم للصدأ'));

  // Quantity Breaks HTML Rendering
  const bundleHtml = renderQuantityBreaks(norm.pricing_tiers, norm.price, 2);
  check('AXIS 1', 'Quantity Breaks HTML structure', bundleHtml.includes('pl-bundles-container') && bundleHtml.includes('pl-tier-cards-grid'));
  check('AXIS 1', 'Tier discount badge rendering', bundleHtml.includes('وفر 500 دج'));
  check('AXIS 1', 'Tier free shipping highlight rendering', bundleHtml.includes('توصيل مجاني للباب'));

  // ══════════════════════════════════════════════════════════════════════════
  // ── AXIS 2: Logistics & 58-Wilayas Shipping Calculator ──
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n── [AXIS 2] Logistics & 58-Wilayas Multi-Carrier Calculator ──');

  check('AXIS 2', 'Algerian Wilayas coverage', WILAYAS.length === 58, 'All 58 official Algerian wilayas loaded');

  const sampleShippingConfig = JSON.stringify({
    version: 2,
    active_carrier: 'yalidine',
    enable_home: true,
    enable_office: true,
    carriers: [
      {
        id: 'yalidine',
        name: 'Yalidine Express',
        is_default: true,
        active: true,
        base_weight_kg: 5,
        extra_kg_price: 50,
        rates: {
          '16': { home: 400, office: 250, active: true },
          '31': { home: 500, office: 300, active: true },
          '25': { home: 550, office: 350, active: true },
          '47': { home: 900, office: 600, active: true }
        }
      }
    ]
  });

  let wilayaCalculationsPassed = true;
  for (let i = 1; i <= 58; i++) {
    const code = String(i).padStart(2, '0');
    const homeRes = calculateClientShippingCost(sampleShippingConfig, code, 'Home', [{ id: 2, weight: 0.35, qty: 1 }], {});
    const officeRes = calculateClientShippingCost(sampleShippingConfig, code, 'Office', [{ id: 2, weight: 0.35, qty: 1 }], {});
    if (typeof homeRes.cost !== 'number' || isNaN(homeRes.cost) || typeof officeRes.cost !== 'number' || isNaN(officeRes.cost)) {
      wilayaCalculationsPassed = false;
      break;
    }
  }
  check('AXIS 2', '58 Wilayas Home/Office calculation completeness', wilayaCalculationsPassed);

  const algerHome = calculateClientShippingCost(sampleShippingConfig, '16', 'Home', [{ id: 2, weight: 0.35, qty: 1 }], {});
  const algerOffice = calculateClientShippingCost(sampleShippingConfig, '16', 'Office', [{ id: 2, weight: 0.35, qty: 1 }], {});
  check('AXIS 2', 'Algiers Home Rate Accuracy', algerHome.cost === 400);
  check('AXIS 2', 'Algiers Office Rate Accuracy', algerOffice.cost === 250);

  // Free shipping override in Tier 3
  const tier3Calc = calculateTierSubtotal(2500, 3, norm.pricing_tiers);
  const finalEffectiveShipCost = tier3Calc.freeShipping ? 0 : algerHome.cost;
  const grandTotal = tier3Calc.subtotal + finalEffectiveShipCost;
  check('AXIS 2', 'Tier 3 Bundle + Free Shipping Total Arithmetic', grandTotal === 6000 && tier3Calc.saveAmount === 1500);

  // ══════════════════════════════════════════════════════════════════════════
  // ── AXIS 3: Order Lifecycle & Server-Side Authoritative Security ──
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n── [AXIS 3] Order Lifecycle & Server-Side Authoritative Verification ──');

  let insertedDbRecord = null;
  const mockDb = {
    prepare(sql) {
      return {
        bind(...args) {
          this.args = args;
          return this;
        },
        async first() {
          if (sql.includes('spam_order_')) return null;
          if (sql.includes('FROM products')) {
            return { id: 2, name: 'ساعة Sabr الفاخرة', price: 2500, active: 1, stock: 25, weight: 0.35 };
          }
          if (sql.includes('FROM settings')) {
            return { value: sampleShippingConfig };
          }
          return null;
        },
        async all() {
          if (sql.includes('FROM products')) {
            return {
              results: [{ id: 2, name: 'ساعة Sabr الفاخرة', price: 2500, active: 1, stock: 25, weight: 0.35 }]
            };
          }
          if (sql.includes('FROM settings')) {
            return {
              results: [
                { key: 'shipping_config', value: sampleShippingConfig },
                { key: 'capi_enabled', value: 'true' },
                { key: 'fb_capi_token', value: 'EAAB_LIVE_AUDIT_TOKEN' },
                { key: 'fb_pixel_id', value: '928523816193898' }
              ]
            };
          }
          return { results: [] };
        },
        async run() {
          if (sql.includes('INSERT INTO orders')) {
            insertedDbRecord = { sql, args: this.args };
          }
          return { meta: { changes: 1 } };
        }
      };
    }
  };

  const mockEnv = { DB: mockDb, ALLOWED_ORIGINS: '*' };
  const mockCtx = { waitUntil: (p) => p };
  const mockReq = new Request('https://smartshopping.click/api', {
    headers: { 'CF-Connecting-IP': '105.105.105.105', 'User-Agent': 'Mozilla/5.0 Audit Agent' }
  });

  // Test 1: Legitimate order with Variant and Tier pricing
  const legitimateOrderPayload = {
    name: 'مصطفى سرخاد',
    phone: '0555123456',
    email: 'mostapha@example.com',
    wilaya_code: '16',
    municipality: 'الجزائر الوسطى',
    address: 'شارع ديدوش مراد رقم 12',
    delivery_type: 'Home',
    items_json: JSON.stringify([{
      id: 2,
      qty: 2,
      price: 2500,
      variant_selection: { color: 'ذهبي ملكي', strap: 'ستيل مقاوم للصدأ' },
      variant_title: 'ذهبي ملكي / ستيل مقاوم للصدأ',
      tier_subtotal: 4500
    }]),
    utm_source: 'facebook_ads',
    utm_campaign: 'summer_sabr_watch',
    utm_content: 'ad_video_gold',
    fbclid: 'IwAR_TEST_FBCLID_999',
    fbc: 'fb.1.1787330000.IwAR_TEST_FBCLID_999',
    fbp: 'fb.1.1787330000.123456789'
  };

  const orderResult = await createOrder(mockEnv, legitimateOrderPayload, mockReq, mockCtx, null, 'tenant_master_default');
  check('AXIS 3', 'Order Creation API response ok: true', orderResult.ok === true);
  check('AXIS 3', 'Canonical order ID format', /^SK-\d{8}-[A-Z0-9]{4}$/.test(orderResult.order_id));
  check('AXIS 3', 'Total calculation with Tier Subtotal + Algiers Shipping', orderResult.total === 4900, '4500 Tier + 400 Shipping = 4900 DZD');

  // Verify DB Persistence
  const savedItems = insertedDbRecord ? JSON.parse(insertedDbRecord.args[10]) : [];
  check('AXIS 3', 'items_json contains variant title', savedItems[0] && savedItems[0].name.includes('ذهبي ملكي / ستيل مقاوم للصدأ'));
  check('AXIS 3', 'items_json contains exact quantity', savedItems[0] && savedItems[0].qty === 2);

  // Test 2: Anti-tampering price spoofing attack
  const spoofedOrderPayload = {
    name: 'مخترق تجريبي',
    phone: '0666998877',
    wilaya_code: '16',
    municipality: 'باب الزوار',
    address: 'حي النور',
    delivery_type: 'Home',
    items_json: JSON.stringify([{
      id: 2,
      qty: 1,
      price: 10 // Attacker attempted to buy 2500 DZD product for 10 DZD
    }])
  };

  const spoofedResult = await createOrder(mockEnv, spoofedOrderPayload, mockReq, mockCtx, null, 'tenant_master_default');
  check('AXIS 3', 'Anti-tampering server-side price protection', spoofedResult.total === 2900, 'Re-calculated from D1: 2500 + 400 = 2900 DZD (Ignoring spoofed 10 DZD)');

  // ══════════════════════════════════════════════════════════════════════════
  // ── AXIS 4: Meta CAPI Tracking Guardrails & SHA-256 Hashing ──
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n── [AXIS 4] Meta CAPI Tracking Guardrails & SHA-256 Hashing ──');

  const normalizedPhone = normalizePhone('0555-12-34-56');
  check('AXIS 4', 'Phone normalization to E.164', normalizedPhone === '213555123456');

  const hashedPhone = await sha256(normalizedPhone);
  check('AXIS 4', 'SHA-256 phone hash generation', hashedPhone.length === 64 && /^[0-9a-f]{64}$/.test(hashedPhone));

  const hashedEmail = await sha256('Mostapha@Example.COM'.trim().toLowerCase());
  check('AXIS 4', 'SHA-256 email hash generation', hashedEmail.length === 64 && !hashedEmail.includes('mostapha'));

  // Test Deduplication event_id matching
  let capturedCapiCall = null;
  const origFetch = global.fetch;
  global.fetch = async function (url, opts) {
    if (url.includes('graph.facebook.com')) {
      capturedCapiCall = { url, body: JSON.parse(opts.body) };
      return new Response(JSON.stringify({ events_received: 1, fbtrace_id: 'AUDIT_TRACE_OK' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return origFetch.apply(this, arguments);
  };

  await sendCapiEvent(mockEnv, 'Purchase', {
    order_id: orderResult.order_id,
    value: orderResult.total,
    currency: 'DZD',
    content_ids: ['2']
  }, {
    phone: legitimateOrderPayload.phone,
    email: legitimateOrderPayload.email,
    fbc: legitimateOrderPayload.fbc,
    fbp: legitimateOrderPayload.fbp
  }, mockReq);

  global.fetch = origFetch;

  check('AXIS 4', 'CAPI Purchase event dispatch', capturedCapiCall !== null);
  check('AXIS 4', 'CAPI event_id equals client order_id (Deduplication guarantee)', capturedCapiCall && capturedCapiCall.body.data[0].event_id === orderResult.order_id);
  check('AXIS 4', 'CAPI value matches authoritative order total', capturedCapiCall && capturedCapiCall.body.data[0].custom_data.value === orderResult.total);
  check('AXIS 4', 'CAPI user_data contains hashed phone', capturedCapiCall && capturedCapiCall.body.data[0].user_data.ph && capturedCapiCall.body.data[0].user_data.ph[0] === hashedPhone);
  check('AXIS 4', 'CAPI user_data contains formatted fbc', capturedCapiCall && capturedCapiCall.body.data[0].user_data.fbc === legitimateOrderPayload.fbc);

  // ══════════════════════════════════════════════════════════════════════════
  // ── AXIS 5: Admin Panel & Multi-Tenant Isolation ──
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n── [AXIS 5] Admin Panel & Multi-Tenant Isolation ──');

  let tenant1OrdersQueried = false;
  let tenant2OrdersQueried = false;

  const mockMultiTenantDb = {
    prepare(sql) {
      return {
        bind(...args) {
          if (args.includes('tenant_store_1')) tenant1OrdersQueried = true;
          if (args.includes('tenant_store_2')) tenant2OrdersQueried = true;
          return this;
        },
        async first() { return { count: 5 }; },
        async all() { return { results: [] }; },
        async run() { return { meta: { changes: 1 } }; }
      };
    }
  };

  await adminListOrders({ DB: mockMultiTenantDb }, {}, 'tenant_store_1');
  await adminListOrders({ DB: mockMultiTenantDb }, {}, 'tenant_store_2');
  check('AXIS 5', 'Multi-tenant database query isolation for Tenant 1', tenant1OrdersQueried);
  check('AXIS 5', 'Multi-tenant database query isolation for Tenant 2', tenant2OrdersQueried);

  // ══════════════════════════════════════════════════════════════════════════
  // ── AXIS 6: Theme Engine & Dynamic Section Capabilities ──
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n── [AXIS 6] Theme Engine & Dynamic Section Capabilities ──');

  const engine = new ThemeEngine();
  const sampleSections = {
    'custom-hero': {
      type: 'hero',
      enabled: true,
      order: 1,
      settings: { headline: 'عرض خاص على {{ product.name }}', cta_label: 'اطلب الآن' }
    },
    'custom-code-block': {
      type: 'custom-code',
      enabled: true,
      order: 2,
      settings: { raw_html: '<div class="promo-banner">تخفيضات العيد الكبرى</div>', device_visibility: 'all' }
    }
  };

  const renderedHtml = engine.renderSections(sampleSections, { product: mockProduct });
  check('AXIS 6', 'Theme Engine Section Rendering', renderedHtml.includes('عرض خاص على ساعة Sabr الفاخرة'));
  check('AXIS 6', 'Custom HTML / Liquid Block Rendering', renderedHtml.includes('تخفيضات العيد الكبرى'));

  // ══════════════════════════════════════════════════════════════════════════
  // ── FINAL AUDIT SUMMARY ──
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════════════════════════════════════════');
  console.log(`📊 MASTER SYSTEM AUDIT COMPLETE: ${passed} PASSED | ${failed} FAILED`);
  console.log('════════════════════════════════════════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runMasterSystemAudit().catch(err => {
  console.error('Master Audit Exception:', err);
  process.exit(1);
});
