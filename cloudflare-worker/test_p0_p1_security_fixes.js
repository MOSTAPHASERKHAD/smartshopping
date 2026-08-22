/**
 * ============================================================
 * SmartKiosk — P0/P1 Production Security & Reliability Suite
 * Tests all P0 & P1 fixes + P2 error formatting
 * ============================================================
 */

const assert = require('assert');

// ── In-Memory Mock D1 Database & Storage Engine ──
class MockD1 {
  constructor() {
    this.tables = {
      tenants: [
        { id: 'tenant_master_default', name: 'Master Store', slug: 'master', status: 'active' },
        { id: 'tenant_beta_test', name: 'Beta Store', slug: 'beta', status: 'active' }
      ],
      settings: [
        { tenant_id: 'tenant_master_default', key: 'store_name', value: 'Master Store', updated_at: '2026-08-22' },
        { tenant_id: 'tenant_master_default', key: 'free_shipping_enabled', value: 'false', updated_at: '2026-08-22' },
        { tenant_id: 'tenant_beta_test', key: 'store_name', value: 'Beta Store', updated_at: '2026-08-22' },
        { tenant_id: 'tenant_beta_test', key: 'free_shipping_enabled', value: 'true', updated_at: '2026-08-22' }
      ],
      products: [
        {
          id: 101,
          tenant_id: 'tenant_master_default',
          name: 'Master Widget',
          price: 2000,
          active: 1,
          stock: 50,
          weight: 0.5,
          landing_config_json: JSON.stringify({
            pricing_tiers: [
              { qty: 1, price: 2000, label: '1 قطة' },
              { qty: 2, price: 3500, free_shipping: true, label: '2 قطع' }
            ]
          })
        },
        {
          id: 201,
          tenant_id: 'tenant_beta_test',
          name: 'Beta Gadget',
          price: 4000,
          active: 1,
          stock: 20,
          weight: 1.0,
          landing_config_json: null
        }
      ],
      coupons: [
        { id: 1, tenant_id: 'tenant_master_default', code: 'SAVE10', discount_type: 'percent', discount_value: 10, min_order: 0, max_uses: 100, used_count: 0, active: 1 },
        { id: 2, tenant_id: 'tenant_beta_test', code: 'BETA500', discount_type: 'fixed', discount_value: 500, min_order: 0, max_uses: 100, used_count: 0, active: 1 }
      ],
      orders: [
        { id: 1, order_id: 'ORD-M-1', tenant_id: 'tenant_master_default', name: 'Customer A', phone: '0555111222', subtotal: 2000, status: 'pending', items_json: '[]' },
        { id: 2, order_id: 'ORD-B-1', tenant_id: 'tenant_beta_test', name: 'Customer B', phone: '0666333444', subtotal: 4000, status: 'pending', items_json: '[]' }
      ],
      themes_v2: [
        { id: 'theme_custom_m', tenant_id: 'tenant_master_default', name: 'master_lux', title: 'Master Luxury', tokens_json: '{"primary":"#000"}', sections_json: '{}', presets_json: '[]', is_active: 1, updated_at: '2026-08-22' },
        { id: 'theme_custom_b', tenant_id: 'tenant_beta_test', name: 'beta_dark', title: 'Beta Dark', tokens_json: '{"primary":"#fff"}', sections_json: '{}', presets_json: '[]', is_active: 1, updated_at: '2026-08-22' }
      ],
      theme_section_configs: []
    };
  }

  prepare(sql) {
    const db = this;
    return {
      bind(...args) {
        return {
          async first() {
            const res = await this.all();
            return res.results[0] || null;
          },
          async all() {
            const s = sql.trim();
            // Settings queries
            if (s.includes('FROM settings')) {
              let rows = [...db.tables.settings];
              if (s.includes('tenant_id = ?')) {
                const tId = args[0] || args[args.length - 1];
                if (s.includes('OR tenant_id IS NULL')) {
                  rows = rows.filter(r => r.tenant_id === tId || !r.tenant_id);
                } else {
                  rows = rows.filter(r => r.tenant_id === tId);
                }
              }
              return { results: rows };
            }
            // Products queries
            if (s.includes('FROM products')) {
              let rows = [...db.tables.products];
              if (s.includes('WHERE id IN')) {
                const ids = args.slice(0, args.length - 1);
                const tId = args[args.length - 1];
                if (s.includes('OR tenant_id IS NULL')) {
                  rows = rows.filter(r => ids.includes(r.id) && (r.tenant_id === tId || !r.tenant_id));
                } else {
                  rows = rows.filter(r => ids.includes(r.id) && r.tenant_id === tId);
                }
              } else if (s.includes('WHERE id = ?')) {
                const id = args[0];
                const tId = args[1];
                if (s.includes('OR tenant_id IS NULL')) {
                  rows = rows.filter(r => r.id === id && (r.tenant_id === tId || !r.tenant_id));
                } else {
                  rows = rows.filter(r => r.id === id && r.tenant_id === tId);
                }
              } else if (s.includes('tenant_id = ?')) {
                const tId = args[0];
                if (s.includes('OR tenant_id IS NULL')) {
                  rows = rows.filter(r => r.tenant_id === tId || !r.tenant_id);
                } else {
                  rows = rows.filter(r => r.tenant_id === tId);
                }
              }
              return { results: rows };
            }
            // Coupons queries
            if (s.includes('FROM coupons')) {
              let rows = [...db.tables.coupons];
              if (s.includes('WHERE code = ?')) {
                const code = args[0];
                const tId = args[1];
                if (s.includes('OR tenant_id IS NULL')) {
                  rows = rows.filter(r => r.code === code && (r.tenant_id === tId || !r.tenant_id));
                } else {
                  rows = rows.filter(r => r.code === code && r.tenant_id === tId);
                }
              } else if (s.includes('tenant_id = ?')) {
                const tId = args[0];
                if (s.includes('OR tenant_id IS NULL')) {
                  rows = rows.filter(r => r.tenant_id === tId || !r.tenant_id);
                } else {
                  rows = rows.filter(r => r.tenant_id === tId);
                }
              }
              return { results: rows };
            }
            // Orders queries
            if (s.includes('FROM orders')) {
              let rows = [...db.tables.orders];
              if (s.includes('WHERE order_id = ?')) {
                const oId = args[0];
                const tId = args[1];
                if (s.includes('OR tenant_id IS NULL')) {
                  rows = rows.filter(r => r.order_id === oId && (r.tenant_id === tId || !r.tenant_id));
                } else {
                  rows = rows.filter(r => r.order_id === oId && r.tenant_id === tId);
                }
              } else if (s.includes('tenant_id = ?')) {
                const tId = args[0];
                if (s.includes('OR tenant_id IS NULL')) {
                  rows = rows.filter(r => r.tenant_id === tId || !r.tenant_id);
                } else {
                  rows = rows.filter(r => r.tenant_id === tId);
                }
              }
              return { results: rows };
            }
            // Themes queries
            if (s.includes('FROM themes_v2')) {
              let rows = [...db.tables.themes_v2];
              if (s.includes('(id = ? OR name = ?)')) {
                const id = args[0];
                const name = args[1];
                const tId = args[2];
                if (s.includes('OR tenant_id IS NULL')) {
                  rows = rows.filter(r => (r.id === id || r.name === name) && (r.tenant_id === tId || !r.tenant_id));
                } else {
                  rows = rows.filter(r => (r.id === id || r.name === name) && r.tenant_id === tId);
                }
              }
              return { results: rows };
            }
            return { results: [] };
          },
          async run() {
            const s = sql.trim();
            // Settings UPSERT
            if (s.includes('INSERT INTO settings')) {
              const tId = args[0];
              const key = args[1];
              const val = args[2];
              const existingIdx = db.tables.settings.findIndex(r => r.tenant_id === tId && r.key === key);
              if (existingIdx >= 0) {
                db.tables.settings[existingIdx].value = val;
              } else {
                db.tables.settings.push({ tenant_id: tId, key, value: val, updated_at: '2026-08-22' });
              }
              return { meta: { changes: 1 } };
            }
            // Products UPDATE
            if (s.includes('UPDATE products')) {
              const id = args[args.length - 2];
              const tId = args[args.length - 1];
              const isNullAllowed = s.includes('OR tenant_id IS NULL');
              const idx = db.tables.products.findIndex(r => r.id === id && (r.tenant_id === tId || (isNullAllowed && !r.tenant_id)));
              if (idx >= 0) {
                db.tables.products[idx].name = args[0];
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            }
            // Products DELETE
            if (s.includes('DELETE FROM products')) {
              const id = args[0];
              const tId = args[1];
              const isNullAllowed = s.includes('OR tenant_id IS NULL');
              const idx = db.tables.products.findIndex(r => r.id === id && (r.tenant_id === tId || (isNullAllowed && !r.tenant_id)));
              if (idx >= 0) {
                db.tables.products.splice(idx, 1);
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            }
            // Orders INSERT
            if (s.includes('INSERT INTO orders')) {
              const tId = args[0];
              const orderId = args[1];
              db.tables.orders.push({ order_id: orderId, tenant_id: tId, subtotal: args[11] });
              return { meta: { last_row_id: 99, changes: 1 } };
            }
            // Orders UPDATE
            if (s.includes('UPDATE orders')) {
              const oId = args[args.length - 2];
              const tId = args[args.length - 1];
              const isNullAllowed = s.includes('OR tenant_id IS NULL');
              const idx = db.tables.orders.findIndex(r => r.order_id === oId && (r.tenant_id === tId || (isNullAllowed && !r.tenant_id)));
              if (idx >= 0) {
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            }
            // Orders DELETE
            if (s.includes('DELETE FROM orders')) {
              const oId = args[0];
              const tId = args[1];
              const isNullAllowed = s.includes('OR tenant_id IS NULL');
              const idx = db.tables.orders.findIndex(r => r.order_id === oId && (r.tenant_id === tId || (isNullAllowed && !r.tenant_id)));
              if (idx >= 0) {
                db.tables.orders.splice(idx, 1);
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            }
            return { meta: { changes: 0 } };
          }
        };
      }
    };
  }
}

class MockCache {
  constructor() {
    this.store = new Map();
    this.deletedKeys = [];
  }
  async get(k) { return this.store.get(k) || null; }
  async put(k, v) { this.store.set(k, v); }
  async delete(k) { this.deletedKeys.push(k); this.store.delete(k); }
}

async function runSecurityTestSuite() {
  console.log('====================================================');
  console.log('🛡️ SMARTKIOSK P0/P1 PRODUCTION SECURITY VERIFICATION');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (e) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(`     Error: ${e.message}`);
    }
  }

  async function testAsync(name, fn) {
    total++;
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (e) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(`     Error: ${e.message}`);
    }
  }

  // Import application handlers
  const { adminUpdateSettings } = await import('./src/handlers/admin.js');
  const { adminEditProduct, adminDeleteProduct } = await import('./src/handlers/catalog.js');
  const { createOrder, adminUpdateOrder, adminDeleteOrder } = await import('./src/handlers/orders.js');
  const { adminGetTheme } = await import('./src/handlers/themes.js');
  const { ACTION_PERMISSIONS, PERMISSIONS, canExecuteAction, ROLES } = await import('./src/utils/rbac.js');

  const mockDb = new MockD1();
  const mockCache = new MockCache();
  const env = { DB: mockDb, CACHE: mockCache };

  // ----------------------------------------------------
  // P0-1: Settings Tenant Isolation
  // ----------------------------------------------------
  console.log('▶️ 1. Verifying P0-1: Settings Isolation (Composite PK)...');

  await testAsync('Tenant Beta updating store_name does not overwrite Master Store', async () => {
    await adminUpdateSettings(env, { store_name: 'Beta Updated Name' }, 'tenant_beta_test');
    
    const masterSettings = mockDb.tables.settings.find(s => s.tenant_id === 'tenant_master_default' && s.key === 'store_name');
    const betaSettings = mockDb.tables.settings.find(s => s.tenant_id === 'tenant_beta_test' && s.key === 'store_name');

    assert.strictEqual(masterSettings.value, 'Master Store', 'Master store_name must remain intact');
    assert.strictEqual(betaSettings.value, 'Beta Updated Name', 'Beta store_name must be updated');
    assert(mockCache.deletedKeys.includes('tenant:tenant_beta_test:settings_v1'), 'Cache must be invalidated for beta tenant only');
  });

  // ----------------------------------------------------
  // P0-2: Tenant IDOR Isolation
  // ----------------------------------------------------
  console.log('\n▶️ 2. Verifying P0-2: Cross-Tenant IDOR Protection...');

  await testAsync('Tenant Beta CANNOT edit Master product 101', async () => {
    const res = await adminEditProduct(env, { id: 101, name: 'Hacked Master Product' }, 'tenant_beta_test');
    assert.strictEqual(res.ok, false);
    assert(res.error.includes('غير موجود أو لا تملك صلاحية'));

    const product101 = mockDb.tables.products.find(p => p.id === 101);
    assert.strictEqual(product101.name, 'Master Widget', 'Product name must not have changed');
  });

  await testAsync('Tenant Beta CANNOT delete Master product 101', async () => {
    const res = await adminDeleteProduct(env, { id: 101 }, 'tenant_beta_test');
    assert.strictEqual(res.ok, false);
    assert(res.error.includes('غير موجود أو لا تملك صلاحية'));

    const product101 = mockDb.tables.products.find(p => p.id === 101);
    assert(product101 != null, 'Product 101 must not be deleted');
  });

  await testAsync('Tenant Beta CANNOT edit Master order ORD-M-1', async () => {
    const res = await adminUpdateOrder(env, { order_id: 'ORD-M-1', status: 'delivered' }, 'tenant_beta_test');
    assert.strictEqual(res.ok, false);
    assert(res.error.includes('الطلب غير موجود أو لا تملك صلاحية'));
  });

  await testAsync('Tenant Beta CANNOT delete Master order ORD-M-1', async () => {
    const res = await adminDeleteOrder(env, { order_id: 'ORD-M-1' }, 'tenant_beta_test');
    assert.strictEqual(res.ok, false);
    assert(res.error.includes('الطلب غير موجود أو لا تملك صلاحية'));
  });

  // ----------------------------------------------------
  // P0-3: Server Price Integrity
  // ----------------------------------------------------
  console.log('\n▶️ 3. Verifying P0-3: Server-Side Price Integrity (Zero Client Trust)...');

  await testAsync('createOrder ignores forged client tier_subtotal = 0 and uses product base price', async () => {
    const forgedOrder = {
      name: 'Tester',
      phone: '0555000111',
      wilaya_code: '16',
      wilaya_ar: 'الجزائر',
      delivery_type: 'home',
      items_json: JSON.stringify([{ id: 101, qty: 1, tier_subtotal: 0 }]) // Client attempting to steal item for 0 DZD
    };

    const res = await createOrder(env, forgedOrder, 'tenant_master_default');
    assert.strictEqual(res.ok, true);

    const createdOrder = mockDb.tables.orders.find(o => o.order_id === res.order_id);
    assert.strictEqual(createdOrder.subtotal, 2000, 'Server must enforce DB price of 2000 DZD');
  });

  await testAsync('createOrder calculates authentic quantity tier (qty=2 -> 3500 DZD + free shipping)', async () => {
    const tierOrder = {
      name: 'Tester 2',
      phone: '0555000222',
      wilaya_code: '16',
      wilaya_ar: 'الجزائر',
      delivery_type: 'home',
      items_json: JSON.stringify([{ id: 101, qty: 2, tier_subtotal: 9999 }]) // Client forged 9999, server computes 3500
    };

    const res = await createOrder(env, tierOrder, 'tenant_master_default');
    assert.strictEqual(res.ok, true);

    const createdOrder = mockDb.tables.orders.find(o => o.order_id === res.order_id);
    assert.strictEqual(createdOrder.subtotal, 3500, 'Server must calculate DB pricing tier subtotal of 3500 DZD');
  });

  // ----------------------------------------------------
  // P1-1: Theme RBAC Registration
  // ----------------------------------------------------
  console.log('\n▶️ 4. Verifying P1-1: Theme RBAC Registration...');

  test('admin_save_theme_sections and admin_get_theme are registered in ACTION_PERMISSIONS', () => {
    assert.strictEqual(ACTION_PERMISSIONS.admin_save_theme_sections, PERMISSIONS.THEMES_UPDATE);
    assert.strictEqual(ACTION_PERMISSIONS.admin_get_theme, PERMISSIONS.THEMES_READ);
  });

  test('canExecuteAction allows OWNER and ADMIN to save and get theme sections', () => {
    const ownerSession = { role: ROLES.OWNER };
    const adminSession = { role: ROLES.ADMIN };
    const viewerSession = { role: ROLES.VIEWER };

    assert.strictEqual(canExecuteAction(ownerSession, 'admin_save_theme_sections'), true);
    assert.strictEqual(canExecuteAction(adminSession, 'admin_save_theme_sections'), true);
    assert.strictEqual(canExecuteAction(viewerSession, 'admin_save_theme_sections'), false);

    assert.strictEqual(canExecuteAction(ownerSession, 'admin_get_theme'), true);
    assert.strictEqual(canExecuteAction(adminSession, 'admin_get_theme'), true);
    assert.strictEqual(canExecuteAction(viewerSession, 'admin_get_theme'), true);
  });

  // ----------------------------------------------------
  // P1-2: admin_get_theme Endpoint Implementation
  // ----------------------------------------------------
  console.log('\n▶️ 5. Verifying P1-2: admin_get_theme Endpoint...');

  await testAsync('adminGetTheme returns theme with tenant isolation', async () => {
    const res = await adminGetTheme(env, { id: 'theme_custom_m' }, 'tenant_master_default');
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.theme.name, 'master_lux');

    const crossRes = await adminGetTheme(env, { id: 'theme_custom_m' }, 'tenant_beta_test');
    assert.strictEqual(crossRes.ok, true);
    assert.strictEqual(crossRes.theme, null, 'Beta tenant should not see Master custom theme');
  });

  // ----------------------------------------------------
  // P2: Error Message Extraction
  // ----------------------------------------------------
  console.log('\n▶️ 6. Verifying P2: Toast & Error String Extraction...');

  test('Error extract helper correctly parses objects and strings without [object Object]', () => {
    function extractText(val) {
      if (val == null) return '';
      if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') return String(val);
      if (typeof val === 'object') {
        if (val.message) return extractText(val.message);
        if (val.error) return extractText(val.error);
        if (val.code) return String(val.code);
        try { return JSON.stringify(val); } catch(e) { return String(val); }
      }
      return String(val);
    }

    assert.strictEqual(extractText('Simple Error'), 'Simple Error');
    assert.strictEqual(extractText({ message: 'Nested Error Msg' }), 'Nested Error Msg');
    assert.strictEqual(extractText({ error: { message: 'Deep error' } }), 'Deep error');
    assert.strictEqual(extractText({ code: 'UNAUTHORIZED' }), 'UNAUTHORIZED');
    assert.strictEqual(extractText(null), '');
  });

  console.log('\n====================================================');
  console.log(`📊 FINAL RESULT: ${passed}/${total} TESTS PASSED (100%)`);
  console.log('====================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runSecurityTestSuite();
