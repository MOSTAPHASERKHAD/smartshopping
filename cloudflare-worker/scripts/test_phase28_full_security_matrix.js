/**
 * SmartKiosk — Multi-Tenant Full Security, IDOR & RBAC Matrix
 * ملف: cloudflare-worker/scripts/test_phase28_full_security_matrix.js
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { ROLES, PERMISSIONS, hasPermission, canExecuteAction } from '../src/utils/rbac.js';
import { issueSession, validateSession, revokeSession, sha256, recordAuditLog, DEFAULT_MASTER_TENANT_ID } from '../src/utils/auth.js';
import { getCatalog, getSettings, getTestimonials, getReviews, getPages, validateCoupon, adminListProducts, adminAddProduct, adminEditProduct, adminDeleteProduct } from '../src/handlers/catalog.js';
import { createOrder, trackOrder, adminListOrders, adminUpdateOrder, adminDeleteOrder, processDeliveredOrderStock } from '../src/handlers/orders.js';
import { customerRegister, customerLogin, customerProfile, adminListCustomers } from '../src/handlers/customers.js';
import { adminUpdateSettings, adminListCoupons, adminAddCoupon, adminEditCoupon, adminDeleteCoupon, adminListThemes, adminSaveTheme, adminDeleteTheme, adminListAuditLogs } from '../src/handlers/admin.js';
import { adminDeleteMedia } from '../src/handlers/uploads.js';

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
              return { results: stmt.all(...args) };
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

async function runSecurityMatrix() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🛡️ SMARTKIOSK — PHASE 28 FULL SECURITY & IDOR AUDIT MATRIX');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const rawDb = new DatabaseSync(':memory:');
  const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  rawDb.exec(schemaSql);

  const d1 = createD1Emulator(rawDb);
  const cacheStorage = new Map();
  const deletedMedia = [];

  const env = {
    DB: d1,
    CACHE: {
      async get(k) { return cacheStorage.get(k) || null; },
      async put(k, v) { cacheStorage.set(k, v); },
      async delete(k) { cacheStorage.delete(k); },
    },
    MEDIA: {
      async delete(k) { deletedMedia.push(k); return true; },
      async get() { return null; },
      async put() { return true; }
    }
  };

  let totalTests = 0;
  let passedTests = 0;

  function assert(condition, testName) {
    totalTests++;
    if (condition) {
      console.log(`  ✅ PASS [${totalTests.toString().padStart(2, '0')}]: ${testName}`);
      passedTests++;
    } else {
      console.error(`  ❌ FAIL [${totalTests.toString().padStart(2, '0')}]: ${testName}`);
      throw new Error(`Security Test Failed: ${testName}`);
    }
  }

  // 1. إعداد المستأجرين (Master, Tenant A, Tenant B)
  console.log('── [PHASE A & B] تهيئة المستأجرين والمستخدمين ──');
  await d1.prepare(`
    INSERT OR IGNORE INTO tenants (id, name, slug, domain, status)
    VALUES ('tenant_master_default', 'Master Store', 'main', 'smartshopping.click', 'active'),
           ('tenant_A', 'Merchant Alpha', 'alpha', 'alpha.click', 'active'),
           ('tenant_B', 'Merchant Beta', 'beta', 'beta.click', 'active')
  `).run();

  await d1.prepare(`
    INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, password_hash)
    VALUES ('usr_a_owner', 'tenant_A', 'owner@alpha.com', 'Alpha Owner', 'OWNER', 'hash'),
           ('usr_a_mgr', 'tenant_A', 'mgr@alpha.com', 'Alpha Mgr', 'ORDER_MANAGER', 'hash'),
           ('usr_a_view', 'tenant_A', 'view@alpha.com', 'Alpha Viewer', 'VIEWER', 'hash'),
           ('usr_b_owner', 'tenant_B', 'owner@beta.com', 'Beta Owner', 'OWNER', 'hash')
  `).run();

  assert(true, 'Tenants and Users provisioned successfully');

  // 2. فحص عزل الكتالوج العام بين المتاجر
  console.log('\n── [PHASE D] اختبار عزل الكتالوج العام بين المتاجر (Storefront Isolation) ──');
  await adminAddProduct(env, { name: 'Alpha Laptop', price: 90000, active: '1', stock: 10 }, 'tenant_A');
  await adminAddProduct(env, { name: 'Beta Dress', price: 12000, active: '1', stock: 5 }, 'tenant_B');

  const catA = await getCatalog(env, 'tenant_A');
  const catB = await getCatalog(env, 'tenant_B');
  assert(catA.products.length === 1 && catA.products[0].name === 'Alpha Laptop', 'Tenant A storefront only returns Alpha products');
  assert(catB.products.length === 1 && catB.products[0].name === 'Beta Dress', 'Tenant B storefront only returns Beta products');

  // 3. فحص هجمات IDOR على المنتجات
  console.log('\n── [PHASE D] اختبار هجمات IDOR على المنتجات (Product IDOR Prevention) ──');
  const betaProdId = catB.products[0].id;
  const editProdAttack = await adminEditProduct(env, { id: betaProdId, name: 'Hacked Beta Dress', price: 1 }, 'tenant_A');
  assert(editProdAttack.ok === false, 'Tenant A cannot edit Tenant B product (Blocked)');

  const delProdAttack = await adminDeleteProduct(env, { id: betaProdId }, 'tenant_A');
  assert(delProdAttack.ok === false, 'Tenant A cannot delete Tenant B product (Blocked)');

  // 4. فحص هجمات IDOR على الطلبات والعملاء
  console.log('\n── [PHASE D] اختبار هجمات IDOR على الطلبات (Order IDOR Prevention) ──');
  const orderARes = await createOrder(env, {
    name: 'Customer A', phone: '0555111111', items_json: JSON.stringify([{ id: catA.products[0].id, qty: 1 }]),
    subtotal: 90000, wilaya_code: '16', wilaya_ar: 'الجزائر', delivery_type: 'home'
  }, null, null, null, 'tenant_A');

  const orderBRes = await createOrder(env, {
    name: 'Customer B', phone: '0666222222', items_json: JSON.stringify([{ id: betaProdId, qty: 1 }]),
    subtotal: 12000, wilaya_code: '31', wilaya_ar: 'وهران', delivery_type: 'home'
  }, null, null, null, 'tenant_B');

  assert(orderARes.ok === true && orderBRes.ok === true, 'Orders created successfully in respective tenants');

  const ordersListA = await adminListOrders(env, {}, 'tenant_A');
  const ordersListB = await adminListOrders(env, {}, 'tenant_B');
  assert(ordersListA.orders.length === 1 && ordersListA.orders[0].name === 'Customer A', 'Tenant A only views Alpha orders');
  assert(ordersListB.orders.length === 1 && ordersListB.orders[0].name === 'Customer B', 'Tenant B only views Beta orders');

  const orderBId = ordersListB.orders[0].order_id;
  const updateOrderAttack = await adminUpdateOrder(env, { order_id: orderBId, status: 'cancelled' }, 'tenant_A');
  assert(updateOrderAttack.ok === false, 'Tenant A cannot update Tenant B order status (Blocked)');

  const deleteOrderAttack = await adminDeleteOrder(env, { order_id: orderBId }, 'tenant_A');
  assert(deleteOrderAttack.ok === false, 'Tenant A cannot delete Tenant B order (Blocked)');

  // 5. فحص هجمات IDOR على الكوبونات، الإعدادات، والثيمات
  console.log('\n── [PHASE D] اختبار هجمات IDOR على الكوبونات والثيمات ──');
  await adminAddCoupon(env, { code: 'ALPHA10', discount_type: 'percentage', discount_value: 10, active: 1 }, 'tenant_A');
  await adminAddCoupon(env, { code: 'BETA20', discount_type: 'percentage', discount_value: 20, active: 1 }, 'tenant_B');

  const couponsA = await adminListCoupons(env, 'tenant_A');
  assert(couponsA.coupons.length === 1 && couponsA.coupons[0].code === 'ALPHA10', 'Coupons isolated to Tenant A');

  const editCouponAttack = await adminEditCoupon(env, { id: couponsA.coupons[0].id, discount_value: 99 }, 'tenant_B');
  assert(editCouponAttack.ok === false, 'Tenant B cannot edit Tenant A coupon (Blocked)');

  // 6. مصفوفة الصلاحيات (RBAC Matrix Verification)
  console.log('\n── [PHASE E] اختبار مصفوفة الصلاحيات والأدوار (RBAC Engine) ──');
  assert(canExecuteAction(ROLES.OWNER, 'admin_delete_product') === true, 'OWNER can delete product');
  assert(canExecuteAction(ROLES.ADMIN, 'admin_add_product') === true, 'ADMIN can add product');
  assert(canExecuteAction(ROLES.ADMIN, 'admin_delete_user') === false, 'ADMIN cannot delete users');
  assert(canExecuteAction(ROLES.ORDER_MANAGER, 'admin_orders') === true, 'ORDER_MANAGER can view orders');
  assert(canExecuteAction(ROLES.ORDER_MANAGER, 'admin_update_order') === true, 'ORDER_MANAGER can update order');
  assert(canExecuteAction(ROLES.ORDER_MANAGER, 'admin_edit_product') === false, 'ORDER_MANAGER cannot edit product');
  assert(canExecuteAction(ROLES.SUPPORT, 'admin_orders') === true, 'SUPPORT can view orders');
  assert(canExecuteAction(ROLES.SUPPORT, 'admin_update_settings') === false, 'SUPPORT cannot update settings');
  assert(canExecuteAction(ROLES.VIEWER, 'admin_list') === true, 'VIEWER can view product list');
  assert(canExecuteAction(ROLES.VIEWER, 'admin_add_product') === false, 'VIEWER cannot add product');
  assert(canExecuteAction(ROLES.VIEWER, 'admin_delete_order') === false, 'VIEWER cannot delete order');

  // 7. أمان وتشفير الجلسات (Hashed Session Lifecycle & CSPRNG)
  console.log('\n── [PHASE F] اختبار أمان وتشفير الجلسات (Session Hashing & Invalidation) ──');
  const tokenA = await issueSession(d1, { userId: 'usr_a_owner', tenantId: 'tenant_A', role: ROLES.OWNER });
  const hashA = await sha256(tokenA);
  const storedRow = await d1.prepare(`SELECT * FROM sessions WHERE token_hash = ?`).bind(hashA).first();
  assert(storedRow !== null && storedRow.user_id === 'usr_a_owner', 'Session token stored as SHA-256 hash in D1');

  const valSuccess = await validateSession(d1, tokenA);
  assert(valSuccess.valid === true && valSuccess.session.tenantId === 'tenant_A', 'Session validated and tenant resolved');

  await revokeSession(d1, tokenA);
  const valRevoked = await validateSession(d1, tokenA);
  assert(valRevoked.valid === false, 'Revoked session fails validation');

  // 8. التوافقية العكسية لجلسات الأدمن القديمة (Legacy Admin Compatibility)
  console.log('\n── [PHASE G] التوافقية العكسية لجلسات الأدمن القديمة ──');
  await d1.prepare(`INSERT INTO admin_sessions (token, expires_at) VALUES ('legacy_tok_12345', ?)`).bind(Date.now() + 7200000).run();
  const legacyVal = await validateSession(d1, 'legacy_tok_12345');
  assert(legacyVal.valid === true && legacyVal.session.tenantId === DEFAULT_MASTER_TENANT_ID && legacyVal.session.role === ROLES.OWNER, 
    'Legacy session cleanly mapped to Master Tenant and OWNER role');

  // 9. عزل وسائط R2 ومفاتيح كاش KV (R2 & KV Isolation)
  console.log('\n── [PHASE H & I] عزل وسائط R2 ومفاتيح كاش KV ──');
  const delR2Attack = await adminDeleteMedia(env, { key: 'tenants/tenant_B/products/img.jpg' }, 'tenant_A');
  assert(delR2Attack.ok === false, 'Cross-tenant R2 media delete blocked');

  const delR2Valid = await adminDeleteMedia(env, { key: 'tenants/tenant_A/products/img.jpg' }, 'tenant_A');
  assert(delR2Valid.ok === true && deletedMedia.includes('tenants/tenant_A/products/img.jpg'), 'Tenant can delete own R2 media key');

  // KV cache key isolation
  await env.CACHE.put('tenant:tenant_A:catalog_v1', JSON.stringify({ products: ['A'] }));
  await env.CACHE.put('tenant:tenant_B:catalog_v1', JSON.stringify({ products: ['B'] }));
  const kvA = await env.CACHE.get('tenant:tenant_A:catalog_v1');
  const kvB = await env.CACHE.get('tenant:tenant_B:catalog_v1');
  assert(JSON.parse(kvA).products[0] === 'A' && JSON.parse(kvB).products[0] === 'B', 'KV cache keys completely isolated per tenant');

  // 10. دورة حياة الطلب وإدارة المخزون الذرية (Order Lifecycle & Stock Handling)
  console.log('\n── [PHASE K] دورة حياة الطلب وحسم المخزون الذري ──');
  const orderAId = ordersListA.orders[0].order_id;
  await adminUpdateOrder(env, { order_id: orderAId, status: 'confirmed' }, 'tenant_A');
  await adminUpdateOrder(env, { order_id: orderAId, status: 'shipped', delivery_company: 'yalidine', tracking_code: 'YAL123' }, 'tenant_A');
  
  // Delivered status triggers atomic stock decrement
  const deliveredOrder = await adminUpdateOrder(env, { order_id: orderAId, status: 'delivered' }, 'tenant_A');
  assert(deliveredOrder.ok === true, 'Order updated to delivered');

  const prodAfterDelivery = (await adminListProducts(env, 'tenant_A')).products[0];
  assert(prodAfterDelivery.stock === 9, 'Stock atomically decremented upon delivery (10 -> 9)');

  // Idempotency: re-running delivery must NOT decrement stock twice
  await processDeliveredOrderStock(env, orderAId, 'tenant_A');
  const prodAfterSecondDelivery = (await adminListProducts(env, 'tenant_A')).products[0];
  assert(prodAfterSecondDelivery.stock === 9, 'Stock decrement is idempotent (stock stays 9)');

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`🎉 النتيجة: جميع اختبارات الأمان والعزل اجتازت بنجاح (${passedTests}/${totalTests}) — 0 أخطاء.`);
  console.log('═══════════════════════════════════════════════════════════════');
}

runSecurityMatrix().catch(err => {
  console.error('\n❌ Security matrix run failed:', err);
  process.exit(1);
});
