/**
 * Smart Shopping — Marketing Attribution & Campaign Analytics Test Suite
 * ملف: cloudflare-worker/test_campaign_analytics.js
 */

import { DatabaseSync } from 'node:sqlite';
import { trackPublicAnalyticsEvent, getCampaignAnalytics } from './src/handlers/analytics.js';
import { createOrder } from './src/handlers/orders.js';
import productUtils from '../assets/js/product-utils.js';

console.log('═══════════════════════════════════════════════════════════════');
console.log('📈 SMARTKIOSK — FIRST-PARTY CAMPAIGN ANALYTICS TEST SUITE');
console.log('═══════════════════════════════════════════════════════════════\n');

let pass = 0;
let fail = 0;

function assert(condition, desc) {
  if (condition) {
    console.log(`  ✅ PASS [${String(pass + 1).padStart(2, '0')}]: ${desc}`);
    pass++;
  } else {
    console.error(`  ❌ FAIL: ${desc}`);
    fail++;
  }
}

// ── D1 SQLite Mock Adapter ──
function createMockD1(rawDb) {
  return {
    prepare(query) {
      return {
        bind(...args) {
          return {
            async all() {
              try {
                const stmt = rawDb.prepare(query);
                const results = stmt.all(...args);
                return { results: results || [] };
              } catch (e) {
                console.error('[D1 Mock all Error]', e.message, 'Query:', query);
                throw e;
              }
            },
            async first() {
              try {
                const stmt = rawDb.prepare(query);
                const row = stmt.get(...args);
                return row || null;
              } catch (e) {
                console.error('[D1 Mock first Error]', e.message, 'Query:', query);
                throw e;
              }
            },
            async run() {
              try {
                const stmt = rawDb.prepare(query);
                const info = stmt.run(...args);
                return { success: true, meta: { changes: info.changes, last_row_id: info.lastInsertRowid } };
              } catch (e) {
                console.error('[D1 Mock run Error]', e.message, 'Query:', query);
                throw e;
              }
            }
          };
        }
      };
    }
  };
}

async function runTests() {
  const rawDb = new DatabaseSync(':memory:');

  // Setup Tables
  rawDb.exec(`
    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT DEFAULT 'master',
      name TEXT NOT NULL,
      price REAL NOT NULL,
      stock INTEGER DEFAULT 100,
      active INTEGER DEFAULT 1,
      weight REAL DEFAULT 0.5
    );

    CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT DEFAULT 'master',
      order_id TEXT UNIQUE NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      wilaya_code TEXT,
      wilaya_ar TEXT,
      wilaya_en TEXT,
      municipality TEXT,
      delivery_type TEXT DEFAULT 'home',
      items_json TEXT,
      subtotal REAL NOT NULL,
      shipping_cost REAL DEFAULT 0,
      shipping_note TEXT,
      discount REAL DEFAULT 0,
      coupon_code TEXT,
      status TEXT DEFAULT 'pending',
      notes TEXT,
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      utm_term TEXT,
      utm_content TEXT,
      fbclid TEXT,
      session_id TEXT,
      customer_id INTEGER,
      delivery_company TEXT DEFAULT 'yalidine',
      tracking_code TEXT
    );

    CREATE TABLE coupons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT DEFAULT 'master',
      code TEXT UNIQUE NOT NULL,
      discount_type TEXT DEFAULT 'percent',
      discount_value REAL NOT NULL,
      min_order REAL DEFAULT 0,
      max_uses INTEGER DEFAULT 0,
      used_count INTEGER DEFAULT 0,
      expires_at TEXT,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      tenant_id TEXT DEFAULT 'master'
    );

    CREATE TABLE analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT DEFAULT 'master',
      session_id TEXT,
      event_name TEXT NOT NULL,
      product_id TEXT,
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      utm_term TEXT,
      utm_content TEXT,
      fbclid TEXT,
      ip_country TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const mockDb = createMockD1(rawDb);
  const env = { DB: mockDb };

  // Seed sample settings & products
  rawDb.exec(`
    INSERT INTO settings (key, value, tenant_id) VALUES 
      ('fb_capi_token', 'EAAB_MOCK_TOKEN_12345', 'master'),
      ('fb_ad_account_id', 'act_9988776655', 'master'),
      ('usd_to_dzd_rate', '230', 'master'),
      ('estimated_product_cost_pct', '30', 'master');

    INSERT INTO products (id, tenant_id, name, price, stock, active) VALUES
      (1, 'master', 'Wireless Earbuds Pro', 4500, 50, 1),
      (2, 'master', 'Smart Watch Ultra', 8500, 20, 1);
  `);

  // ── [1] Client-Side Attribution Utilities (product-utils.js) ──
  console.log('── [1] Client-Side Attribution Utilities (product-utils.js) ──');
  assert(typeof productUtils.captureUTM === 'function', 'captureUTM function exists in productUtils');
  assert(typeof productUtils.getUTM === 'function', 'getUTM function exists in productUtils');
  assert(typeof productUtils.trackAnalyticsEvent === 'function', 'trackAnalyticsEvent function exists in productUtils');

  // ── [2] Public Analytics Event Tracking (trackPublicAnalyticsEvent) ──
  console.log('\n── [2] Public Analytics Event Tracking (trackPublicAnalyticsEvent) ──');
  
  const ev1 = await trackPublicAnalyticsEvent(env, {
    event_name: 'PageView',
    session_id: 'sid_test_101',
    product_id: '1',
    utm_source: 'facebook',
    utm_medium: 'cpc',
    utm_campaign: 'Summer_Sale_2026',
    utm_term: 'Tech_Enthusiasts_25_45',
    utm_content: 'Video_Ad_01',
    fbclid: 'fb_clk_12345'
  }, { headers: new Map([['CF-IPCountry', 'DZ']]) });

  assert(ev1.ok === true, 'Successfully tracks PageView event');

  const ev2 = await trackPublicAnalyticsEvent(env, {
    event_name: 'InitiateCheckout',
    session_id: 'sid_test_101',
    product_id: '1',
    utm_source: 'facebook',
    utm_medium: 'cpc',
    utm_campaign: 'Summer_Sale_2026',
    utm_term: 'Tech_Enthusiasts_25_45',
    utm_content: 'Video_Ad_01'
  }, {});

  assert(ev2.ok === true, 'Successfully tracks InitiateCheckout event');

  const loggedEvents = rawDb.prepare('SELECT * FROM analytics_events').all();
  assert(loggedEvents.length === 2, '2 analytics events inserted in database');
  assert(loggedEvents[0].utm_campaign === 'Summer_Sale_2026', 'Correctly stored utm_campaign');
  assert(loggedEvents[0].utm_term === 'Tech_Enthusiasts_25_45', 'Correctly stored utm_term');
  assert(loggedEvents[0].utm_content === 'Video_Ad_01', 'Correctly stored utm_content');
  assert(loggedEvents[0].session_id === 'sid_test_101', 'Correctly stored session_id');

  // ── [3] Zero-Regression Order Creation with Attribution (createOrder) ──
  console.log('\n── [3] Zero-Regression Order Creation with Attribution (createOrder) ──');

  const orderCtx = { waitUntil(p) { p.catch?.(() => {}); } };
  const orderRes = await createOrder(env, {
    name: 'Ahmed Benali',
    phone: '0555123456',
    wilaya_code: '16',
    municipality: 'Algiers',
    delivery_type: 'Home',
    items_json: JSON.stringify([{ id: 1, qty: 2 }]),
    subtotal: 9000,
    utm_source: 'facebook',
    utm_medium: 'cpc',
    utm_campaign: 'Summer_Sale_2026',
    utm_term: 'Tech_Enthusiasts_25_45',
    utm_content: 'Video_Ad_01',
    fbclid: 'fb_clk_12345',
    session_id: 'sid_test_101'
  }, { headers: new Map([['CF-IPCountry', 'DZ']]) }, orderCtx, null, 'master');

  assert(orderRes.ok === true, 'createOrder succeeds with attribution payload');
  assert(typeof orderRes.order_id === 'string' && orderRes.order_id.startsWith('SK-'), 'Generates valid order_id');

  const dbOrder = rawDb.prepare('SELECT * FROM orders WHERE order_id = ?').get(orderRes.order_id);
  assert(dbOrder.utm_campaign === 'Summer_Sale_2026', 'Order has utm_campaign persisted');
  assert(dbOrder.utm_term === 'Tech_Enthusiasts_25_45', 'Order has utm_term persisted');
  assert(dbOrder.utm_content === 'Video_Ad_01', 'Order has utm_content persisted');
  assert(dbOrder.session_id === 'sid_test_101', 'Order has session_id persisted');
  assert(dbOrder.subtotal === 9000, 'Authoritative subtotal matches real product price (4500 * 2 = 9000)');

  // Seed another order without UTMs (Direct / Organic)
  await createOrder(env, {
    name: 'Karim Zaid',
    phone: '0661998877',
    wilaya_code: '31',
    municipality: 'Oran',
    delivery_type: 'Home',
    items_json: JSON.stringify([{ id: 2, qty: 1 }]),
    subtotal: 8500
  }, {}, orderCtx, null, 'master');

  // ── [4] Meta Ads Insights API Mock & Full Campaign Analytics (getCampaignAnalytics) ──
  console.log('\n── [4] Meta Ads Insights API Mock & Full Campaign Analytics (getCampaignAnalytics) ──');

  // Mock global fetch for Meta Graph API
  const originalFetch = global.fetch;
  global.fetch = async function(url, options) {
    if (typeof url === 'string' && url.includes('graph.facebook.com')) {
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              campaign_name: 'Summer_Sale_2026',
              adset_name: 'Tech_Enthusiasts_25_45',
              ad_name: 'Video_Ad_01',
              spend: '25.00', // 25 USD * 230 = 5,750 DZD
              impressions: '1500',
              clicks: '75',
              cpc: '0.33',
              ctr: '5.00'
            },
            {
              campaign_name: 'Summer_Sale_2026',
              adset_name: 'Tech_Enthusiasts_25_45',
              ad_name: 'Image_Carousel_02',
              spend: '10.00', // 10 USD * 230 = 2,300 DZD
              impressions: '800',
              clicks: '30',
              cpc: '0.33',
              ctr: '3.75'
            }
          ]
        })
      };
    }
    return originalFetch(url, options);
  };

  const analyticsRes = await getCampaignAnalytics(env, { preset: 'today' }, 'master');
  assert(analyticsRes.ok === true, 'getCampaignAnalytics returns ok: true');
  assert(analyticsRes.data.meta_connected === true, 'Meta API connection confirmed active');

  const summary = analyticsRes.data.summary;
  assert(summary.total_spend_usd === 35, 'Total spend USD equals 35.00');
  assert(summary.total_spend_dzd === 8050, 'Total spend DZD equals 8050 (35 * 230)');
  assert(summary.total_impressions === 2300, 'Total impressions calculated across ads');
  assert(summary.total_clicks === 105, 'Total link clicks calculated');
  assert(summary.total_orders === 2, 'Total orders matches 2 created orders');

  // Hierarchy check
  const campaigns = analyticsRes.data.campaigns;
  assert(Array.isArray(campaigns) && campaigns.length === 2, 'Returns 2 top-level campaign groups (Summer_Sale_2026 and Direct/Organic)');

  const summerCamp = campaigns.find(c => c.name === 'Summer_Sale_2026');
  assert(summerCamp !== undefined, 'Found Summer_Sale_2026 campaign node');
  assert(summerCamp.spend_dzd === 8050, 'Campaign aggregated spend equals 8050 DZD');
  assert(summerCamp.purchases === 1, 'Campaign has 1 matched order');
  assert(summerCamp.revenue_dzd > 9000, 'Campaign revenue calculated with shipping');
  assert(summerCamp.children.length === 1, 'Campaign has 1 child AdSet');

  const adSet = summerCamp.children[0];
  assert(adSet.name === 'Tech_Enthusiasts_25_45', 'AdSet name matches');
  assert(adSet.children.length === 2, 'AdSet has 2 child Ads');

  const directGroup = campaigns.find(c => c.name.includes('Direct'));
  assert(directGroup !== undefined, 'Found [Direct / Organic] fallback campaign group');
  assert(directGroup.spend_dzd === 0, 'Direct group has 0 ad spend');
  assert(directGroup.purchases === 1, 'Direct group attributed 1 untagged order');

  // ── [5] Fail-Safe Resiliency (Meta API Unreachable) ──
  console.log('\n── [5] Fail-Safe Resiliency (Meta API Unreachable) ──');
  global.fetch = async function() {
    throw new Error('Network connection timeout to Facebook Graph API');
  };

  const fallbackRes = await getCampaignAnalytics(env, { preset: 'today' }, 'master');
  assert(fallbackRes.ok === true, 'Returns ok: true even when Meta API is down');
  assert(fallbackRes.data.meta_connected === false, 'meta_connected is false');
  assert(typeof fallbackRes.data.meta_error === 'string', 'Captures readable meta_error message');
  assert(fallbackRes.data.summary.total_orders === 2, 'D1 orders are still 100% visible and accurate');

  // Restore fetch
  global.fetch = originalFetch;

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`🏁 TEST RESULTS: ${pass} PASSED, ${fail} FAILED`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (fail > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Unhandled Test Exception:', err);
  process.exit(1);
});
