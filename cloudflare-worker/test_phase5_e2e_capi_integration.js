/**
 * SmartKiosk / Smart Shopping — Phase 5 Test Suite
 * End-to-End Dynamic Theme & Meta CAPI Event Integrity Test
 * cloudflare-worker/test_phase5_e2e_capi_integration.js
 */

import { createOrder } from './src/handlers/orders.js';
import { sendCapiEvent, normalizePhone, normalizeEmail, formatFbc } from './src/handlers/marketing.js';
import ThemeSchema from '../themes/theme-schema.js';
import pkgEngine from '../themes/theme-engine.js';
const { ThemeEngine } = pkgEngine;

async function runPhase5Tests() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🎯 SMARTKIOSK — PHASE 5: END-TO-END THEMES & CAPI INTEGRATION');
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

  // ── [1] Dynamic Theme Rendering with Tracking Guards ──
  console.log('── [1] Dynamic Theme Rendering with Tracking Hooks ──');
  const engine = new ThemeEngine();

  const product = {
    id: 2,
    name: 'ساعة Sabr الفاخرة',
    price: 2500,
    price_old: 3000,
    description: 'ساعة رجالية مميزة'
  };

  const sectionsConfig = {
    "hero-banner": { type: "hero", enabled: true, order: 1, settings: {} },
    "fast-order-form": { type: "order-form", enabled: true, order: 2, settings: {} }
  };

  const pageHtml = engine.renderSections(sectionsConfig, { product, store: { name: 'Smart Shopping' } });

  assert(pageHtml.includes('onclick="scrollToOrderForm()"'), 'Hero CTA is wired to scrollToOrderForm() trigger');
  assert(pageHtml.includes('onsubmit="handleOrderSubmit(event)"'), 'Order form is wired to handleOrderSubmit()');
  assert(pageHtml.includes('id="plOrderForm"'), 'Form contains canonical order form hook for InitiateCheckout');

  // ── [2] Order Creation & Authoritative Calculation in Dynamic Theme ──
  console.log('\n── [2] Order Creation & Backend Authoritative Integrity ──');
  
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
          if (sql.includes('FROM products')) {
            return {
              id: 2,
              name: 'ساعة Sabr الفاخرة',
              price: 2500,
              stock: 10,
              weight: null
            };
          }
          if (sql.includes('FROM settings')) {
            return {
              value: JSON.stringify({
                active_carrier: 'yalidine',
                carriers: [
                  {
                    id: 'yalidine',
                    active: true,
                    rates: {
                      '16': { home: 500, office: 350, active: true }
                    }
                  }
                ]
              })
            };
          }
          return null;
        },
        async all() {
          if (sql.includes('FROM products')) {
            return {
              results: [{ id: 2, name: 'ساعة Sabr الفاخرة', price: 2500, active: 1, stock: 10, weight: null }]
            };
          }
          if (sql.includes('FROM settings')) {
            return {
              results: [
                { key: 'shipping_config', value: JSON.stringify({ active_carrier: 'yalidine', carriers: [{ id: 'yalidine', active: true, rates: { '16': { home: 500, office: 350, active: true } } }] }) },
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

  // Mock global fetch for CAPI intercept
  const originalFetch = global.fetch;
  global.fetch = async function (url, opts) {
    if (url.includes('graph.facebook.com')) {
      capturedCapiCall = {
        url,
        payload: JSON.parse(opts.body)
      };
      return new Response(JSON.stringify({ events_received: 1, fbtrace_id: 'TRACE_TEST_123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return originalFetch.apply(this, arguments);
  };

  const mockEnv = {
    DB: mockDb,
    ALLOWED_ORIGINS: '*'
  };

  const mockCtx = {
    waitUntil(promise) {
      return promise;
    }
  };

  const orderParams = {
    name: 'عبد القادر بلمختار',
    phone: '0555123456',
    email: 'kader@example.com',
    wilaya_code: '16',
    municipality: 'الجزائر الوسطى',
    address: 'شارع ديدوش مراد',
    delivery_type: 'Home',
    items_json: JSON.stringify([{ id: 2, qty: 1, price: 2500 }]),
    fbc: 'fb.1.1787200000.IwAR123456789',
    fbp: 'fb.1.1787200000.987654321',
    utm_source: 'meta_theme_campaign',
    utm_campaign: 'summer_sale'
  };

  const mockRequest = new Request('https://smartshopping.click/api', {
    headers: {
      'CF-Connecting-IP': '105.105.105.105',
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'
    }
  });

  const orderResult = await createOrder(mockEnv, orderParams, mockRequest, mockCtx, null, 'tenant_master_default');

  assert(orderResult.ok === true, 'Order created successfully');
  assert(orderResult.order_id && orderResult.order_id.startsWith('SK-'), 'Valid order_id generated');
  assert(orderResult.total === 3000, 'Total is authoritatively 3000 DZD (2500 product + 500 shipping)');

  // ── [3] CAPI Event Deduplication & Payload Hashing ──
  console.log('\n── [3] Meta CAPI Payload & Deduplication Audit ──');
  
  await sendCapiEvent(mockEnv, 'Purchase', {
    value: 3000,
    order_id: orderResult.order_id,
    content_ids: ['2'],
    event_source_url: 'https://smartshopping.click/product.html?product=2'
  }, {
    phone: orderParams.phone,
    email: orderParams.email,
    fbc: orderParams.fbc,
    fbp: orderParams.fbp
  }, mockRequest);

  assert(capturedCapiCall !== null, 'CAPI Purchase event intercepted');
  assert(capturedCapiCall.payload.data[0].event_name === 'Purchase', 'Event name is Purchase');
  assert(capturedCapiCall.payload.data[0].event_id === orderResult.order_id, 'event_id strictly matches order_id for browser deduplication');
  assert(capturedCapiCall.payload.data[0].custom_data.value === 3000, 'CAPI value matches authoritative order total (3000 DZD)');
  assert(capturedCapiCall.payload.data[0].custom_data.currency === 'DZD', 'CAPI currency is DZD');
  assert(capturedCapiCall.payload.data[0].user_data.ph != null, 'Phone number SHA-256 hashed');
  assert(!JSON.stringify(capturedCapiCall.payload).includes('0555123456'), 'Raw phone number is NEVER leaked');
  assert(!JSON.stringify(capturedCapiCall.payload).includes('kader@example.com'), 'Raw email is NEVER leaked');

  // Restore fetch
  global.fetch = originalFetch;

  // ── Summary ──
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`📊 PHASE 5 RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase5Tests().catch(err => {
  console.error('Test Runner Exception:', err);
  process.exit(1);
});
