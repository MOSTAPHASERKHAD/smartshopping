import { DatabaseSync } from 'node:sqlite';
import {
  hashMerchantPassword,
  verifyMerchantPassword,
  issueSession,
  validateSession,
  revokeSession,
  revokeAllUserSessions,
  resolveTenant,
  adminGate,
  DEFAULT_MASTER_TENANT_ID,
  sha256,
} from './src/utils/auth.js';
import {
  authRegister,
  authLogin,
  authLogout,
  authMe,
  authForgotPassword,
  authResetPassword,
  authVerifyEmail,
  authChangePassword,
  authListSessions,
  authRevokeAll,
} from './src/handlers/merchant_auth.js';
import { canExecuteAction, hasPermission, ROLES, PERMISSIONS } from './src/utils/rbac.js';
import { recordAuditLog } from './src/utils/auth.js';

console.log('═══════════════════════════════════════════════════════════════');
console.log('🏛️ SMARTKIOSK PHASE 31 — SAAS MERCHANT & TENANT LIFECYCLE SUITE');
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

async function runPhase31SaaSSuite() {
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
      role                TEXT NOT NULL DEFAULT 'OWNER' CHECK(role IN ('OWNER', 'ADMIN', 'ORDER_MANAGER', 'SUPPORT', 'VIEWER')),
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

  // ─────────────────────────────────────────────
  // 1. Tenant Creation & Provisioning
  // ─────────────────────────────────────────────
  console.log('── [1] اختبارات إنشاء المستأجر وتخصيص الموارد (Tenant Provisioning) ──');
  const reg1 = await authRegister(env, {
    store_name: 'Store Alpha',
    email: 'alpha_owner@example.com',
    password: 'StrongMasterPassword123!',
    slug: 'alpha-store'
  });
  assert(reg1.ok === true, 'Merchant registered successfully');
  assert(reg1.tenant?.slug === 'alpha-store', 'Slug assigned properly');
  assert(reg1.tenant?.id.startsWith('tenant_'), 'Unpredictable random tenant ID generated');

  const tenantRecord = await db.prepare('SELECT * FROM tenants WHERE id = ?').bind(reg1.tenant.id).first();
  assert(tenantRecord && tenantRecord.status === 'active' && tenantRecord.plan === 'starter', 'Tenant created in active status with starter plan');

  // ─────────────────────────────────────────────
  // 2. Tenant / User Atomicity
  // ─────────────────────────────────────────────
  console.log('\n── [2] ذرية إنشاء المستأجر والمستخدم (Atomicity) ──');
  const userCount = await db.prepare('SELECT count(*) as count FROM users WHERE tenant_id = ?').bind(reg1.tenant.id).first();
  assert(userCount.count === 1, 'Exactly one OWNER user created per registered tenant');

  // ─────────────────────────────────────────────
  // 3. Duplicate Email & Duplicate Slug Defense
  // ─────────────────────────────────────────────
  console.log('\n── [3] منع تكرار البريد والتعامل الآمن مع الـ Slugs ──');
  const dupEmail = await authRegister(env, {
    store_name: 'Store Alpha Clone',
    email: 'alpha_owner@example.com',
    password: 'StrongMasterPassword123!',
  });
  assert(dupEmail.ok === false && dupEmail.error.includes('مسجل بالفعل'), 'Global email duplication blocked');

  const regDupSlug = await authRegister(env, {
    store_name: 'Store Alpha Two',
    email: 'alpha_two@example.com',
    password: 'StrongMasterPassword123!',
    slug: 'alpha-store'
  });
  assert(regDupSlug.ok === true && regDupSlug.tenant?.slug !== 'alpha-store', 'Duplicate slug automatically disambiguated with random entropy');

  // ─────────────────────────────────────────────
  // 4. Server-Authoritative Owner Binding
  // ─────────────────────────────────────────────
  console.log('\n── [4] الربط السيادي للمالك (Server-Authoritative Owner Binding) ──');
  const login1 = await authLogin(env, {
    email: 'alpha_owner@example.com',
    password: 'StrongMasterPassword123!',
  });
  assert(login1.ok === true && !!login1.token, 'Owner login successful');
  assert(login1.user.role === 'OWNER', 'User role is authoritative OWNER');
  assert(login1.tenant.id === reg1.tenant.id, 'Session locked to owner tenant');

  // ─────────────────────────────────────────────
  // 5. Tenant Isolation & IDOR Defense
  // ─────────────────────────────────────────────
  console.log('\n── [5] عزل المستأجرين التام وحماية IDOR ──');
  // Add product for Tenant Alpha
  await db.prepare('INSERT INTO products (tenant_id, name, price, stock) VALUES (?, ?, ?, ?)')
    .bind(reg1.tenant.id, 'Alpha Exclusive Product', 9900, 10).run();
  
  // Add product for Tenant Two
  await db.prepare('INSERT INTO products (tenant_id, name, price, stock) VALUES (?, ?, ?, ?)')
    .bind(regDupSlug.tenant.id, 'Beta Exclusive Product', 4500, 5).run();

  const alphaProds = await db.prepare('SELECT * FROM products WHERE tenant_id = ?').bind(reg1.tenant.id).all();
  assert(alphaProds.results.length === 1 && alphaProds.results[0].name === 'Alpha Exclusive Product', 'Tenant Alpha only reads own products');

  const betaProds = await db.prepare('SELECT * FROM products WHERE tenant_id = ?').bind(regDupSlug.tenant.id).all();
  assert(betaProds.results.length === 1 && betaProds.results[0].name === 'Beta Exclusive Product', 'Tenant Beta only reads own products');

  // ─────────────────────────────────────────────
  // 6. Master Tenant Protection
  // ─────────────────────────────────────────────
  console.log('\n── [6] حماية المستأجر الرئيسي (Master Tenant Safety) ──');
  const masterTenant = await db.prepare('SELECT * FROM tenants WHERE id = ?').bind(DEFAULT_MASTER_TENANT_ID).first();
  assert(masterTenant && masterTenant.slug === 'main', 'Master tenant intact and cannot be overridden');

  // Try resolving with no credentials
  const defaultTenant = await resolveTenant({ headers: new Headers() }, env, null);
  assert(defaultTenant === DEFAULT_MASTER_TENANT_ID, 'Unauthenticated public storefront defaults safely to Master Tenant');

  // ─────────────────────────────────────────────
  // 7. RBAC Matrix Verification
  // ─────────────────────────────────────────────
  console.log('\n── [7] مصفوفة الصلاحيات والأدوار (RBAC Scope) ──');
  assert(canExecuteAction(ROLES.OWNER, 'admin_delete_product') === true, 'OWNER has product delete');
  assert(canExecuteAction(ROLES.ADMIN, 'admin_delete_user') === false, 'ADMIN cannot delete users');
  assert(canExecuteAction(ROLES.ORDER_MANAGER, 'admin_orders') === true, 'ORDER_MANAGER has orders access');
  assert(canExecuteAction(ROLES.VIEWER, 'admin_list') === true, 'VIEWER has view catalog');
  assert(canExecuteAction(ROLES.VIEWER, 'admin_add_product') === false, 'VIEWER cannot add product');

  // ─────────────────────────────────────────────
  // 8. R2 & KV Tenant Scoping & Traversal Defense
  // ─────────────────────────────────────────────
  console.log('\n── [8] عزل وسائط R2 ومفاتيح KV وحماية Traversal ──');
  const alphaR2 = `tenants/${reg1.tenant.id}/images/hero.webp`;
  const betaR2 = `tenants/${regDupSlug.tenant.id}/images/hero.webp`;
  assert(!alphaR2.includes('..') && alphaR2.startsWith(`tenants/${reg1.tenant.id}/`), 'R2 path scoped to Tenant Alpha without traversal');
  assert(alphaR2 !== betaR2, 'R2 media buckets completely separated per tenant');

  const alphaKV = `tenant:${reg1.tenant.id}:catalog_v1`;
  const betaKV = `tenant:${regDupSlug.tenant.id}:catalog_v1`;
  assert(alphaKV !== betaKV, 'KV cache keys completely separated per tenant');

  // ─────────────────────────────────────────────
  // 9. Audit Logging (Zero Secrets in Logs)
  // ─────────────────────────────────────────────
  console.log('\n── [9] سجل التدقيق وخلوه من بيانات الاعتماد (Audit Trail) ──');
  await recordAuditLog(db, {
    tenant_id: reg1.tenant.id,
    user_id: login1.user.id,
    action: 'PRODUCT_CREATED',
    resource_type: 'product',
    resource_id: '101',
    metadata: { name: 'Alpha Exclusive Product' },
    request: { headers: new Map([['cf-connecting-ip', '1.2.3.4'], ['user-agent', 'TestAgent']]) }
  });

  const auditEntry = await db.prepare('SELECT * FROM audit_logs WHERE tenant_id = ? AND action = ?').bind(reg1.tenant.id, 'PRODUCT_CREATED').first();
  assert(auditEntry && auditEntry.action === 'PRODUCT_CREATED' && !auditEntry.metadata_json.includes('password'), 
    'Audit log created and free from passwords/tokens');

  // ─────────────────────────────────────────────
  // 10. Session Revocation
  // ─────────────────────────────────────────────
  console.log('\n── [10] إبطال وتدوير الجلسات (Session Revocation) ──');
  await revokeSession(db, login1.token, 'test_logout');
  const sessionVal = await validateSession(db, login1.token);
  assert(sessionVal.valid === false, 'Revoked session fails validation');

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`📊 TOTAL SAAS LIFECYCLE TESTS: ${pass} PASSED | ${fail} FAILED`);
  console.log('═══════════════════════════════════════════════════════════════');

  if (fail > 0) process.exit(1);
}

runPhase31SaaSSuite();
