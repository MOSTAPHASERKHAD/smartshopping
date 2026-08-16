import { DatabaseSync } from 'node:sqlite';
import {
  hashMerchantPassword,
  issueSession,
  issueAdminSession,
  validateSession,
  revokeSession,
  resolveTenant,
  adminGate,
  DEFAULT_MASTER_TENANT_ID,
  sha256,
} from './src/utils/auth.js';
import {
  authRegister,
  authLogin,
} from './src/handlers/merchant_auth.js';
import {
  superListTenants,
  superPlatformStats,
  superUpdateTenant,
  isSuperAdminSession,
} from './src/handlers/super_admin.js';
import { canExecuteAction, ROLES, PERMISSIONS } from './src/utils/rbac.js';

console.log('═══════════════════════════════════════════════════════════════');
console.log('🛡️ SMARTKIOSK — SUPER ADMIN & MULTI-TENANT ISOLATION SUITE');
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

async function runSuperAdminSuite() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE tenants (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      slug        TEXT NOT NULL UNIQUE COLLATE NOCASE,
      domain      TEXT DEFAULT NULL UNIQUE,
      status      TEXT DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'archived')),
      plan        TEXT DEFAULT 'master' CHECK(plan IN ('master', 'starter', 'pro', 'enterprise')),
      created_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE TABLE users (
      id                  TEXT PRIMARY KEY,
      tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      email               TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name                TEXT DEFAULT '',
      password_hash       TEXT NOT NULL,
      role                TEXT NOT NULL DEFAULT 'OWNER',
      status              TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'suspended', 'pending_verification')),
      email_verified_at   TEXT DEFAULT NULL,
      password_changed_at TEXT DEFAULT NULL,
      last_login_at       TEXT DEFAULT NULL,
      created_at          TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at          TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE TABLE sessions (
      token_hash    TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      tenant_id     TEXT NOT NULL,
      role          TEXT NOT NULL,
      expires_at    INTEGER NOT NULL,
      created_at    TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      last_seen_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      revoked_at    TEXT DEFAULT NULL,
      revoke_reason TEXT DEFAULT NULL
    );
    CREATE TABLE email_verification_tokens (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     TEXT NOT NULL,
      token_hash  TEXT NOT NULL UNIQUE,
      expires_at  INTEGER NOT NULL,
      used_at     TEXT DEFAULT NULL,
      created_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE TABLE password_reset_tokens (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     TEXT NOT NULL,
      token_hash  TEXT NOT NULL UNIQUE,
      expires_at  INTEGER NOT NULL,
      used_at     TEXT DEFAULT NULL,
      created_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE TABLE products (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id   TEXT NOT NULL DEFAULT 'tenant_master_default',
      name        TEXT NOT NULL,
      price       REAL NOT NULL,
      stock       INTEGER DEFAULT 10
    );
    CREATE TABLE orders (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id     TEXT NOT NULL DEFAULT 'tenant_master_default',
      order_id      TEXT NOT NULL UNIQUE,
      customer_name TEXT,
      total         REAL,
      status        TEXT DEFAULT 'pending'
    );
    CREATE TABLE settings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id   TEXT NOT NULL DEFAULT 'tenant_master_default',
      key         TEXT NOT NULL,
      value       TEXT NOT NULL,
      UNIQUE(tenant_id, key)
    );
    CREATE TABLE audit_logs (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id      TEXT NOT NULL,
      user_id        TEXT,
      action         TEXT NOT NULL,
      resource_type  TEXT NOT NULL,
      resource_id    TEXT,
      ip_hash        TEXT,
      user_agent     TEXT,
      metadata_json  TEXT,
      created_at     TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    -- Master Tenant & Super Admin User
    INSERT INTO tenants (id, name, slug, domain, status, plan) VALUES
      ('tenant_master_default', 'Smart Shopping Master', 'main', 'smartshopping.click', 'active', 'master');
  `);

  const db = {
    prepare(q) {
      return {
        _q: q, _p: [],
        bind(...p) { this._p = p; return this; },
        async first() { return sqlite.prepare(this._q).get(...this._p) || null; },
        async all() { return { results: sqlite.prepare(this._q).all(...this._p) }; },
        async run() { const i = sqlite.prepare(this._q).run(...this._p); return { success: true, meta: { changes: i.changes } }; },
      };
    },
    async batch(stmts) {
      for (const s of stmts) await s.run();
      return { success: true };
    }
  };
  const env = { DB: db };

  // 1. Setup Super Admin User
  const masterPwHash = await hashMerchantPassword('SuperAdminSecret123!');
  await db.prepare(`
    INSERT INTO users (id, tenant_id, email, name, password_hash, role, status, email_verified_at)
    VALUES ('user_super_admin', 'tenant_master_default', 'super@smartshopping.click', 'Super Admin', ?, 'OWNER', 'active', strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  `).bind(masterPwHash).run();

  // 2. Setup Merchant A and Merchant B
  const regA = await authRegister(env, {
    store_name: 'Store Alpha',
    email: 'merchant_a@example.com',
    password: 'MerchantPass123!',
    slug: 'alpha-shop'
  });
  const regB = await authRegister(env, {
    store_name: 'Store Beta',
    email: 'merchant_b@example.com',
    password: 'MerchantPass123!',
    slug: 'beta-shop'
  });

  const loginSuper = await authLogin(env, { email: 'super@smartshopping.click', password: 'SuperAdminSecret123!' });
  const loginA = await authLogin(env, { email: 'merchant_a@example.com', password: 'MerchantPass123!' });
  const loginB = await authLogin(env, { email: 'merchant_b@example.com', password: 'MerchantPass123!' });

  const sessionSuper = (await validateSession(db, loginSuper.token)).session;
  const sessionA = (await validateSession(db, loginA.token)).session;
  const sessionB = (await validateSession(db, loginB.token)).session;

  // ─────────────────────────────────────────────
  // 1. Authentication Tests
  // ─────────────────────────────────────────────
  console.log('── [1] اختبارات التحقق من جلسات Super Admin والمصادقة ──');
  assert(await adminGate('admin_super_list_tenants', null, db) === false, 'Unauthenticated access to super endpoint blocked (401)');
  assert(await adminGate('admin_super_list_tenants', 'bogus-token-1234', db) === false, 'Invalid token blocked (401)');
  
  // Expired session test
  const expiredHash = await sha256('expired_tok');
  await db.prepare('INSERT INTO sessions (token_hash, user_id, tenant_id, role, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(expiredHash, 'u1', 'tenant_master_default', 'OWNER', Date.now() - 10000).run();
  assert(await adminGate('admin_super_list_tenants', 'expired_tok', db) === false, 'Expired token blocked (401)');

  // ─────────────────────────────────────────────
  // 2. Authorization & Role Checks (Anti-Privilege Escalation)
  // ─────────────────────────────────────────────
  console.log('\n── [2] حماية الصلاحيات ومنع تصعيد الأدوار (RBAC & Privilege Escalation) ──');
  assert(isSuperAdminSession(sessionSuper) === true, 'Master Tenant Owner recognized as Super Admin');
  assert(isSuperAdminSession(sessionA) === false, 'Merchant A (tenant OWNER) rejected as Super Admin');
  assert(isSuperAdminSession(sessionB) === false, 'Merchant B (tenant OWNER) rejected as Super Admin');
  assert(isSuperAdminSession(null) === false, 'Null session rejected as Super Admin');

  assert(canExecuteAction(sessionA.role, 'admin_super_list_tenants', sessionA.tenantId) === false, 'RBAC blocks Merchant A from super_list_tenants (403)');
  assert(canExecuteAction(sessionB.role, 'admin_super_platform_stats', sessionB.tenantId) === false, 'RBAC blocks Merchant B from super_platform_stats (403)');
  assert(canExecuteAction(sessionSuper.role, 'admin_super_list_tenants', sessionSuper.tenantId) === true, 'RBAC allows Super Admin on super_list_tenants (200)');
  assert(canExecuteAction(sessionSuper.role, 'admin_super_platform_stats', sessionSuper.tenantId) === true, 'RBAC allows Super Admin on super_platform_stats (200)');

  // ─────────────────────────────────────────────
  // 3. Super Admin Handlers Security & Tenant Scoping
  // ─────────────────────────────────────────────
  console.log('\n── [3] حماية معالجات Super Admin على الخادم (Defense in Depth) ──');
  const deniedListA = await superListTenants(env, sessionA);
  assert(deniedListA.ok === false && deniedListA.error.includes('Super Admin'), 'superListTenants fails closed on Merchant A');

  const deniedStatsB = await superPlatformStats(env, sessionB);
  assert(deniedStatsB.ok === false && deniedStatsB.error.includes('Super Admin'), 'superPlatformStats fails closed on Merchant B');

  const deniedUpdateA = await superUpdateTenant(env, { target_tenant_id: regB.tenant.id, status: 'suspended' }, sessionA);
  assert(deniedUpdateA.ok === false, 'Merchant A cannot suspend Tenant B (Fails Closed)');

  // ─────────────────────────────────────────────
  // 4. Platform Data & Reporting Integrity
  // ─────────────────────────────────────────────
  console.log('\n── [4] سلامة ودقة بيانات المنصة للـ Super Admin ──');
  // Seed sample products and orders
  await db.prepare('INSERT INTO products (tenant_id, name, price, stock) VALUES (?, ?, ?, ?)')
    .bind(regA.tenant.id, 'Alpha Product 1', 3000, 10).run();
  await db.prepare('INSERT INTO products (tenant_id, name, price, stock) VALUES (?, ?, ?, ?)')
    .bind(regA.tenant.id, 'Alpha Product 2', 4500, 5).run();
  await db.prepare('INSERT INTO orders (tenant_id, order_id, customer_name, total, status) VALUES (?, ?, ?, ?, ?)')
    .bind(regA.tenant.id, 'ORD-A-01', 'Customer A', 7500, 'delivered').run();

  await db.prepare('INSERT INTO products (tenant_id, name, price, stock) VALUES (?, ?, ?, ?)')
    .bind(regB.tenant.id, 'Beta Product 1', 9900, 2).run();
  await db.prepare('INSERT INTO orders (tenant_id, order_id, customer_name, total, status) VALUES (?, ?, ?, ?, ?)')
    .bind(regB.tenant.id, 'ORD-B-01', 'Customer B', 9900, 'pending').run();

  const superTenants = await superListTenants(env, sessionSuper);
  assert(superTenants.ok === true && superTenants.count === 3, 'Super Admin lists all 3 tenants (Master + Alpha + Beta)');
  
  const tenantAData = superTenants.tenants.find(t => t.tenant_id === regA.tenant.id);
  assert(tenantAData && tenantAData.metrics.products_count === 2, 'Tenant Alpha product count accurate (2)');
  assert(tenantAData && tenantAData.metrics.orders_count === 1, 'Tenant Alpha order count accurate (1)');
  assert(tenantAData && tenantAData.metrics.total_revenue === 7500, 'Tenant Alpha revenue accurate (7500 DZD)');
  assert(tenantAData && tenantAData.owner.email === 'merchant_a@example.com', 'Tenant Alpha owner email mapped correctly');

  const stats = await superPlatformStats(env, sessionSuper);
  assert(stats.ok === true, 'Super Admin stats retrieved successfully');
  assert(stats.stats.tenants.total === 3, 'Total tenants count accurate (3)');
  assert(stats.stats.products.total === 3, 'Total platform products count accurate (3)');
  assert(stats.stats.orders.total === 2, 'Total platform orders count accurate (2)');
  assert(stats.stats.orders.total_gmv === 17400, 'Total platform GMV accurate (17400 DZD)');

  // ─────────────────────────────────────────────
  // 5. Tenant Status Management & Master Protection
  // ─────────────────────────────────────────────
  console.log('\n── [5] إدارة حالة المستأجر وحماية المستأجر الرئيسي ──');
  const suspendRes = await superUpdateTenant(env, { target_tenant_id: regB.tenant.id, status: 'suspended' }, sessionSuper);
  assert(suspendRes.ok === true, 'Super Admin can suspend a merchant tenant');

  const updatedB = await db.prepare('SELECT status FROM tenants WHERE id = ?').bind(regB.tenant.id).first();
  assert(updatedB.status === 'suspended', 'Tenant Beta status updated to suspended in D1');

  const masterProtect = await superUpdateTenant(env, { target_tenant_id: DEFAULT_MASTER_TENANT_ID, status: 'suspended' }, sessionSuper);
  assert(masterProtect.ok === false && masterProtect.error.includes('المستأجر الرئيسي'), 'Master tenant cannot be suspended or altered');

  // ─────────────────────────────────────────────
  // 6. Strict Cross-Tenant Anti-IDOR Defense
  // ─────────────────────────────────────────────
  console.log('\n── [6] حماية العزل التام ومقاومة هجمات IDOR ──');
  // Merchant A trying to query Merchant B products via tenant_id param
  const scopedTenantA = await resolveTenant({ headers: new Headers() }, env, sessionA, 'beta-shop');
  assert(scopedTenantA === regA.tenant.id, 'resolveTenant strictly locks Merchant A to session tenant_id regardless of requested slug');

  const scopedTenantB = await resolveTenant({ headers: new Headers() }, env, sessionB, 'alpha-shop');
  assert(scopedTenantB === regB.tenant.id, 'resolveTenant strictly locks Merchant B to session tenant_id regardless of requested slug');

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`📊 TOTAL SUPER ADMIN & ISOLATION TESTS: ${pass} PASSED | ${fail} FAILED`);
  console.log('═══════════════════════════════════════════════════════════════');

  if (fail > 0) process.exit(1);
}

runSuperAdminSuite();
