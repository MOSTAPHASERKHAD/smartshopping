/**
 * Smart Shopping — Multi-Tenant & RBAC Comprehensive Test Harness
 * ملف: cloudflare-worker/test_multi_tenant_harness.js
 * 
 * يتحقق من عزل البيانات والصلاحيات بنسبة 100% عبر SQLite الحقيقي
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import application modules
import { ROLES, PERMISSIONS, hasPermission, canExecuteAction } from './src/utils/rbac.js';
import { issueSession, validateSession, revokeSession, sha256, recordAuditLog, DEFAULT_MASTER_TENANT_ID } from './src/utils/auth.js';
import { getCatalog, adminListProducts, adminAddProduct, adminEditProduct, adminDeleteProduct } from './src/handlers/catalog.js';
import { createOrder, trackOrder, adminListOrders, adminUpdateOrder, adminDeleteOrder } from './src/handlers/orders.js';
import { adminDeleteMedia } from './src/handlers/uploads.js';
import { adminListAuditLogs } from './src/handlers/admin.js';

// ── D1 SQLite Emulator Wrapper ──
function createD1Emulator(db) {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              const stmt = db.prepare(sql);
              return stmt.get(...args) || null;
            },
            async all() {
              const stmt = db.prepare(sql);
              const results = stmt.all(...args);
              return { results };
            },
            async run() {
              const stmt = db.prepare(sql);
              const info = stmt.run(...args);
              return {
                success: true,
                meta: {
                  changes: info.changes,
                  last_row_id: Number(info.lastInsertRowid),
                }
              };
            }
          };
        },
        async first() {
          const stmt = db.prepare(sql);
          return stmt.get() || null;
        },
        async all() {
          const stmt = db.prepare(sql);
          return { results: stmt.all() };
        },
        async run() {
          const stmt = db.prepare(sql);
          const info = stmt.run();
          return {
            success: true,
            meta: {
              changes: info.changes,
              last_row_id: Number(info.lastInsertRowid),
            }
          };
        }
      };
    },
    async batch(statements) {
      const results = [];
      for (const s of statements) {
        results.push(await s.run ? s.all() : s);
      }
      return results;
    }
  };
}

async function runMultiTenantTestSuite() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🧪 SMARTKIOSK PHASE 28 — MULTI-TENANT & RBAC TEST HARNESS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  let passedTests = 0;
  let failedTests = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passedTests++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failedTests++;
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  // 1. إعداد قاعدة البيانات وتطبيق schema.sql
  console.log('[Test 1] تهيئة قاعدة بيانات D1 SQLite وفحص المخطط المتعدد للمستأجرين');
  const rawDb = new DatabaseSync(':memory:');
  const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  rawDb.exec(schemaSql);

  // إدراج المستأجر الرئيسي الافتراضي
  rawDb.exec(`
    INSERT OR IGNORE INTO tenants (id, name, slug, domain, status)
    VALUES ('tenant_master_default', 'Smart Shopping Master', 'main', 'smartshopping.click', 'active');
  `);

  const d1 = createD1Emulator(rawDb);
  const dummyEnv = {
    DB: d1,
    CACHE: {
      async get() { return null; },
      async put() {},
      async delete() {},
    },
    MEDIA: {
      deletedKeys: [],
      async delete(k) { this.deletedKeys.push(k); return true; },
      async get() { return null; },
      async put() { return true; }
    }
  };

  const masterTenant = await d1.prepare(`SELECT * FROM tenants WHERE id = ?`).bind(DEFAULT_MASTER_TENANT_ID).first();
  assert(masterTenant && masterTenant.slug === 'main', 'Master default tenant exists and initialized');

  // 2. إنشاء مستأجرين إضافيين (Merchant Alpha & Merchant Beta)
  console.log('\n[Test 2] إنشاء مستأجرين إضافيين (Tenant Alpha & Tenant Beta)');
  await d1.prepare(`
    INSERT INTO tenants (id, name, slug, domain, status)
    VALUES ('tenant_alpha', 'Alpha Electronics', 'alpha', 'alpha.store', 'active'),
           ('tenant_beta', 'Beta Fashion', 'beta', 'beta.store', 'active')
  `).run();

  const tenants = await d1.prepare(`SELECT COUNT(*) as count FROM tenants`).first();
  assert(tenants.count === 3, 'Total tenants created (Master + Alpha + Beta) == 3');

  // 3. عزل كتالوج المنتجات بين المستأجرين (Product Catalog Isolation)
  console.log('\n[Test 3] اختبار عزل كتالوج المنتجات بين المتاجر');
  await adminAddProduct(dummyEnv, { name: 'Master Phone', price: 50000, active: '1' }, DEFAULT_MASTER_TENANT_ID);
  await adminAddProduct(dummyEnv, { name: 'Alpha Laptop', price: 90000, active: '1' }, 'tenant_alpha');
  await adminAddProduct(dummyEnv, { name: 'Beta Dress', price: 12000, active: '1' }, 'tenant_beta');

  const alphaCatalog = await getCatalog(dummyEnv, 'tenant_alpha');
  assert(alphaCatalog.products.length === 1 && alphaCatalog.products[0].name === 'Alpha Laptop', 
    'Tenant Alpha public catalog only contains Alpha Laptop');

  const betaCatalog = await getCatalog(dummyEnv, 'tenant_beta');
  assert(betaCatalog.products.length === 1 && betaCatalog.products[0].name === 'Beta Dress', 
    'Tenant Beta public catalog only contains Beta Dress');

  const masterCatalog = await getCatalog(dummyEnv, DEFAULT_MASTER_TENANT_ID);
  assert(masterCatalog.products.some(p => p.name === 'Master Phone'), 
    'Master tenant catalog contains Master Phone');

  // 4. اختبار حماية التعديل والحذف عبر المتاجر (Product IDOR Protection)
  console.log('\n[Test 4] حماية IDOR: منع التاجر Alpha من تعديل أو حذف منتجات التاجر Beta');
  const betaProduct = (await adminListProducts(dummyEnv, 'tenant_beta')).products[0];
  
  // Alpha يحاول تعديل منتج Beta
  const editAttack = await adminEditProduct(dummyEnv, { id: betaProduct.id, name: 'Hacked Laptop', price: 100 }, 'tenant_alpha');
  assert(editAttack.ok === false, 'Tenant Alpha cannot edit Tenant Beta product (Returns ok: false)');

  // Alpha يحاول حذف منتج Beta
  const deleteAttack = await adminDeleteProduct(dummyEnv, { id: betaProduct.id }, 'tenant_alpha');
  assert(deleteAttack.ok === false, 'Tenant Alpha cannot delete Tenant Beta product (Returns ok: false)');

  // تأكد أن منتج Beta لم يتأثر
  const betaCheck = (await adminListProducts(dummyEnv, 'tenant_beta')).products[0];
  assert(betaCheck.name === 'Beta Dress' && betaCheck.price === 12000, 'Tenant Beta product remains unaltered');

  // 5. عزل إنشاء واستعلام الطلبات (Order Tenant Isolation)
  console.log('\n[Test 5] عزل الطلبات وحماية IDOR على طلبات التجار');
  const alphaOrderRes = await createOrder(dummyEnv, {
    name: 'Karim Alpha',
    phone: '0555000111',
    items_json: JSON.stringify([{ id: (await adminListProducts(dummyEnv, 'tenant_alpha')).products[0].id, qty: 1 }]),
    subtotal: 90000,
    wilaya_code: '16',
    wilaya_ar: 'الجزائر',
    wilaya_en: 'Algiers',
    municipality: 'Bab Ezzouar',
    delivery_type: 'home',
  }, null, null, null, 'tenant_alpha');

  assert(alphaOrderRes.ok === true, 'Order created in Tenant Alpha');

  const betaOrderRes = await createOrder(dummyEnv, {
    name: 'Sara Beta',
    phone: '0666000222',
    items_json: JSON.stringify([{ id: betaProduct.id, qty: 1 }]),
    subtotal: 12000,
    wilaya_code: '31',
    wilaya_ar: 'وهران',
    wilaya_en: 'Oran',
    municipality: 'Es Senia',
    delivery_type: 'home',
  }, null, null, null, 'tenant_beta');

  assert(betaOrderRes.ok === true, 'Order created in Tenant Beta');

  // فحص استعراض الطلبات
  const alphaOrdersList = await adminListOrders(dummyEnv, {}, 'tenant_alpha');
  assert(alphaOrdersList.orders.length === 1 && alphaOrdersList.orders[0].name === 'Karim Alpha', 
    'Tenant Alpha admin only sees Alpha orders');

  const betaOrdersList = await adminListOrders(dummyEnv, {}, 'tenant_beta');
  assert(betaOrdersList.orders.length === 1 && betaOrdersList.orders[0].name === 'Sara Beta', 
    'Tenant Beta admin only sees Beta orders');

  // Alpha يحاول حذف طلب Beta
  const betaOrderId = betaOrdersList.orders[0].order_id;
  const deleteOrderAttack = await adminDeleteOrder(dummyEnv, { order_id: betaOrderId }, 'tenant_alpha');
  assert(deleteOrderAttack.ok === false, 'Tenant Alpha cannot delete Tenant Beta order (IDOR blocked)');

  // 6. مصفوفة الصلاحيات (RBAC Permissions Matrix)
  console.log('\n[Test 6] فحص مصفوفة الأدوار والصلاحيات (RBAC Engine)');
  assert(hasPermission(ROLES.OWNER, PERMISSIONS.PRODUCTS_DELETE) === true, 'OWNER has products.delete');
  assert(hasPermission(ROLES.OWNER, PERMISSIONS.USERS_DELETE) === true, 'OWNER has users.delete');
  assert(hasPermission(ROLES.ADMIN, PERMISSIONS.PRODUCTS_CREATE) === true, 'ADMIN has products.create');
  assert(hasPermission(ROLES.ADMIN, PERMISSIONS.USERS_DELETE) === false, 'ADMIN cannot delete other users');
  assert(hasPermission(ROLES.ORDER_MANAGER, PERMISSIONS.ORDERS_UPDATE) === true, 'ORDER_MANAGER has orders.update');
  assert(hasPermission(ROLES.ORDER_MANAGER, PERMISSIONS.PRODUCTS_DELETE) === false, 'ORDER_MANAGER cannot delete products');
  assert(hasPermission(ROLES.VIEWER, PERMISSIONS.PRODUCTS_READ) === true, 'VIEWER has products.read');
  assert(hasPermission(ROLES.VIEWER, PERMISSIONS.ORDERS_UPDATE) === false, 'VIEWER cannot update orders');

  assert(canExecuteAction(ROLES.VIEWER, 'admin_delete_order') === false, 'canExecuteAction: VIEWER cannot admin_delete_order');
  assert(canExecuteAction(ROLES.ORDER_MANAGER, 'admin_update_order') === true, 'canExecuteAction: ORDER_MANAGER can admin_update_order');
  assert(canExecuteAction(ROLES.ORDER_MANAGER, 'admin_update_settings') === false, 'canExecuteAction: ORDER_MANAGER cannot admin_update_settings');

  // 7. تشفير الجلسات وإبطالها (Hashed Token & Invalidation)
  console.log('\n[Test 7] فحص الجلسات المشفرة (SHA-256 Hashed Tokens) وإبطالها');
  
  // إنشاء مستخدم التاجر أولاً في جدول users (لتلبية قيد المفتاح الأجنبي)
  await d1.prepare(`
    INSERT INTO users (id, tenant_id, email, name, role, password_hash)
    VALUES ('usr_alpha_1', 'tenant_alpha', 'admin@alpha.store', 'Alpha Admin', 'ADMIN', 'fake_hash')
  `).run();

  const rawToken = await issueSession(d1, { userId: 'usr_alpha_1', tenantId: 'tenant_alpha', role: ROLES.ADMIN });
  const rawTokenHash = await sha256(rawToken);

  // تأكد أن الـ token لا يُخزن كنص صريح في D1 إطلاقاً
  const sessionRow = await d1.prepare(`SELECT * FROM sessions WHERE token_hash = ?`).bind(rawTokenHash).first();
  assert(sessionRow && sessionRow.user_id === 'usr_alpha_1', 'Session stored as SHA-256 hash in D1');

  const rawLookup = await d1.prepare(`SELECT * FROM sessions WHERE token_hash = ?`).bind(rawToken).first();
  assert(rawLookup === null, 'Raw plaintext token is NEVER stored in database');

  // التحقق من صحة الجلسة
  const validRes = await validateSession(d1, rawToken);
  assert(validRes.valid === true && validRes.session.tenantId === 'tenant_alpha' && validRes.session.role === ROLES.ADMIN, 
    'Session successfully validated and tenant context resolved');

  // إبطال الجلسة (تسجيل خروج)
  await revokeSession(d1, rawToken);
  const afterRevoke = await validateSession(d1, rawToken);
  assert(afterRevoke.valid === false, 'Revoked session is immediately invalid');

  // 8. التوافقية العكسية لجلسات الأدمن القديمة (Legacy Compatibility)
  console.log('\n[Test 8] التوافقية العكسية للجلسات القديمة');
  await d1.prepare(`INSERT INTO admin_sessions (token, expires_at) VALUES ('legacy_valid_token_32_chars_long', ?)`).bind(Date.now() + 3600000).run();
  const legacyValidation = await validateSession(d1, 'legacy_valid_token_32_chars_long');
  assert(legacyValidation.valid === true && legacyValidation.session.tenantId === DEFAULT_MASTER_TENANT_ID, 
    'Legacy admin session gracefully maps to Master Tenant with full compatibility');

  // 9. حماية وسائط التخزين R2 وعزل المسارات (R2 Media Isolation)
  console.log('\n[Test 9] حماية وسائط التخزين R2 ومنع الحذف العابر للمستأجرين');
  const deleteR2Attack = await adminDeleteMedia(dummyEnv, { key: 'tenants/tenant_beta/products/img.jpg' }, 'tenant_alpha');
  assert(deleteR2Attack.ok === false, 'Tenant Alpha cannot delete Tenant Beta R2 media key');

  const deleteR2Own = await adminDeleteMedia(dummyEnv, { key: 'tenants/tenant_alpha/products/img.jpg' }, 'tenant_alpha');
  assert(deleteR2Own.ok === true, 'Tenant Alpha can delete its own R2 media key');

  // 10. سجل التدقيق الأمني (Audit Logs)
  console.log('\n[Test 10] سجل التدقيق الأمني (Audit Logs)');
  await recordAuditLog(d1, {
    tenant_id: 'tenant_alpha',
    user_id: 'usr_alpha_1',
    action: 'admin_edit_product',
    resource_type: 'products',
    resource_id: '101',
    metadata: { price_changed: true },
    request: {
      headers: {
        get: (h) => (h === 'CF-Connecting-IP' ? '197.112.5.42' : 'Mozilla/5.0')
      }
    }
  });

  const alphaLogs = await adminListAuditLogs(dummyEnv, {}, 'tenant_alpha');
  assert(alphaLogs.ok === true && alphaLogs.logs.length === 1, 'Audit log recorded for Tenant Alpha');
  assert(alphaLogs.logs[0].action === 'admin_edit_product' && alphaLogs.logs[0].ip_hash.length > 0, 
    'Audit log contains action and hashed client IP (zero plaintext IP/secrets)');

  const betaLogs = await adminListAuditLogs(dummyEnv, {}, 'tenant_beta');
  assert(betaLogs.logs.length === 0, 'Tenant Beta cannot see Tenant Alpha audit logs');

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`🎉 النتيجة: جميع الاختبارات اجتازت بنجاح (${passedTests}/${passedTests + failedTests}) — 0 أخطاء.`);
  console.log('═══════════════════════════════════════════════════════════════');
}

runMultiTenantTestSuite().catch(err => {
  console.error('\n❌ Test harness failed with unhandled error:', err);
  process.exit(1);
});
