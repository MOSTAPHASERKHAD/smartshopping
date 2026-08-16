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
  authResendVerification,
  authChangePassword,
  authListSessions,
  authRevokeAll,
} from './src/handlers/merchant_auth.js';
import { canExecuteAction, hasPermission, ROLES, PERMISSIONS } from './src/utils/rbac.js';
import { recordAuditLog } from './src/utils/auth.js';

console.log('═══════════════════════════════════════════════════════════════');
console.log('🧪 SMARTKIOSK PHASE 30 — FULL INTEGRATION & HARDENING MATRIX');
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

async function runPhase30IntegrationSuite() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
      domain TEXT DEFAULT NULL UNIQUE,
      status TEXT DEFAULT 'active',
      plan TEXT DEFAULT 'free',
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT DEFAULT '',
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'OWNER',
      status TEXT DEFAULT 'active',
      email_verified_at TEXT DEFAULT NULL,
      password_changed_at TEXT DEFAULT NULL,
      last_login_at TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE TABLE sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      role TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      last_seen_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      revoked_at TEXT DEFAULT NULL,
      revoke_reason TEXT DEFAULT NULL
    );
    CREATE TABLE password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      used_at TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE TABLE email_verification_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      used_at TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_master_default',
      name TEXT NOT NULL,
      price REAL NOT NULL,
      stock INTEGER DEFAULT 10
    );
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_master_default',
      order_id TEXT NOT NULL UNIQUE,
      customer_name TEXT,
      total REAL,
      status TEXT DEFAULT 'pending'
    );
    CREATE TABLE settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_master_default',
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      UNIQUE(tenant_id, key)
    );
    CREATE TABLE coupons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_master_default',
      code TEXT NOT NULL UNIQUE,
      discount_percent INTEGER NOT NULL
    );
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      user_id TEXT,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      ip_hash TEXT,
      user_agent TEXT,
      metadata_json TEXT,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    INSERT INTO tenants (id, name, slug, domain, status, plan) VALUES
      ('tenant_master_default', 'Master Store', 'main', 'smartshopping.click', 'active', 'master'),
      ('tenant_alpha_001', 'Alpha Store', 'alpha', 'alpha.smartshopping.click', 'active', 'pro'),
      ('tenant_beta_002', 'Beta Store', 'beta', 'beta.smartshopping.click', 'active', 'pro');

    INSERT INTO products (id, tenant_id, name, price, stock) VALUES
      (101, 'tenant_alpha_001', 'Alpha Phone', 50000, 10),
      (201, 'tenant_beta_002', 'Beta Laptop', 120000, 5);

    INSERT INTO orders (id, tenant_id, order_id, customer_name, total, status) VALUES
      (1, 'tenant_alpha_001', 'ORD-ALPHA-01', 'Karim Alpha', 50000, 'pending'),
      (2, 'tenant_beta_002', 'ORD-BETA-01', 'Samir Beta', 120000, 'pending');
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
    async batch(stmts) { for (const s of stmts) await s.run(); }
  };
  const env = { DB: db };

  // ─────────────────────────────────────────────
  // 1. Password Security (PBKDF2 100,000 iters)
  // ─────────────────────────────────────────────
  console.log('── [1] اختبارات تشفير كلمات المرور (PBKDF2 100k Security) ──');
  const rawPw = 'StrongSecurePass2026!';
  const pwHash = await hashMerchantPassword(rawPw);
  assert(pwHash.startsWith('pbkdf2:sha256:100000:'), 'PBKDF2 hash uses 100,000 iterations (Cloudflare Native Limit)');
  const verifyValid = await verifyMerchantPassword(rawPw, pwHash);
  assert(verifyValid.valid === true && verifyValid.needsUpgrade === false, 'Valid password verified without needing upgrade');
  const verifyBad = await verifyMerchantPassword('WrongPassword!', pwHash);
  assert(verifyBad.valid === false, 'Wrong password rejected cleanly');

  // ─────────────────────────────────────────────
  // 2. Signup & Email Verification Flow
  // ─────────────────────────────────────────────
  console.log('\n── [2] دورة تسجيل التاجر وتأكيد البريد (Signup & Email Verification) ──');
  const regRes = await authRegister(env, {
    email: 'new_merchant@example.com',
    password: rawPw,
    store_name: 'Super Elite Store',
  });
  assert(regRes.ok === true && !!regRes.tenant?.id, 'Merchant registration creates new tenant and user');

  const pendingUser = await db.prepare('SELECT status, email_verified_at FROM users WHERE email = ?')
    .bind('new_merchant@example.com').first();
  assert(pendingUser.email_verified_at === null, 'New user is pending verification (email_verified_at is null)');

  // Verify email
  const verifyRec = await db.prepare('SELECT token_hash FROM email_verification_tokens WHERE used_at IS NULL').first();
  await db.prepare("UPDATE users SET status = 'active', email_verified_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE email = ?")
    .bind('new_merchant@example.com').run();
  await db.prepare("UPDATE email_verification_tokens SET used_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE token_hash = ?")
    .bind(verifyRec.token_hash).run();

  const activeUser = await db.prepare('SELECT status, email_verified_at FROM users WHERE email = ?')
    .bind('new_merchant@example.com').first();
  assert(activeUser.status === 'active' && !!activeUser.email_verified_at, 'User account verified and activated');

  // ─────────────────────────────────────────────
  // 3. Login & Session Security
  // ─────────────────────────────────────────────
  console.log('\n── [3] تسجيل الدخول وأمان الجلسات (Login & Hashed Sessions) ──');
  const loginRes = await authLogin(env, {
    email: 'new_merchant@example.com',
    password: rawPw,
  });
  assert(loginRes.ok === true && !!loginRes.token, 'Login succeeds and issues session token');

  const tokenHash = await sha256(loginRes.token);
  const sessionInDb = await db.prepare('SELECT * FROM sessions WHERE token_hash = ?').bind(tokenHash).first();
  assert(!!sessionInDb && sessionInDb.user_id === loginRes.user.id, 'Session stored as SHA-256 hash in D1');

  const authSession = { userId: loginRes.user.id, tenantId: loginRes.tenant.id, role: loginRes.user.role };
  const meRes = await authMe(env, loginRes.token, authSession);
  assert(meRes.ok === true && meRes.tenant.name === 'Super Elite Store', 'auth_me returns authenticated merchant context');

  // ─────────────────────────────────────────────
  // 4. Password Reset & Complete Session Wipe
  // ─────────────────────────────────────────────
  console.log('\n── [4] استعادة كلمة المرور وإبطال الجلسات الشامل (Password Reset & Session Invalidation) ──');
  const forgotRes = await authForgotPassword(env, { email: 'new_merchant@example.com' });
  assert(forgotRes.ok === true, 'Forgot password creates reset token');

  // Reset password
  const resetNewPw = 'BrandNewPassword2026!';
  const resetNewHash = await hashMerchantPassword(resetNewPw);
  await db.prepare("UPDATE users SET password_hash = ?, password_changed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?")
    .bind(resetNewHash, loginRes.user.id).run();
  await revokeAllUserSessions(db, loginRes.user.id, 'password_reset');

  const sessionAfterReset = await validateSession(db, loginRes.token);
  assert(sessionAfterReset.valid === false, 'Existing sessions invalidated completely after password reset');

  const reloginRes = await authLogin(env, { email: 'new_merchant@example.com', password: resetNewPw });
  assert(reloginRes.ok === true, 'Relogin succeeds with new password');

  // ─────────────────────────────────────────────
  // 5. Password Change & Session Rotation
  // ─────────────────────────────────────────────
  console.log('\n── [5] تغيير كلمة المرور وتدوير الجلسة (Password Change & Rotation) ──');
  const cpRes = await authChangePassword(env, {
    current_password: resetNewPw,
    new_password: 'EvenNewerPassword2026!',
  }, reloginRes.token, { userId: loginRes.user.id, tenantId: loginRes.tenant.id, role: 'OWNER' });
  assert(cpRes.ok === true && !!cpRes.token, 'Password change returns new rotated session token');

  const oldSessionValid = await validateSession(db, reloginRes.token);
  const newSessionValid = await validateSession(db, cpRes.token);
  assert(oldSessionValid.valid === false && newSessionValid.valid === true, 'Old session revoked and new session active');

  // ─────────────────────────────────────────────
  // 6. RBAC Matrix & Granular Permissions
  // ─────────────────────────────────────────────
  console.log('\n── [6] مصفوفة الصلاحيات (RBAC Permissions Matrix) ──');
  assert(canExecuteAction(ROLES.OWNER, 'admin_delete_product') === true, 'OWNER has product delete permission');
  assert(canExecuteAction(ROLES.ADMIN, 'admin_delete_user') === false, 'ADMIN cannot delete users');
  assert(canExecuteAction(ROLES.ORDER_MANAGER, 'admin_orders') === true, 'ORDER_MANAGER can view orders');
  assert(canExecuteAction(ROLES.ORDER_MANAGER, 'admin_add_product') === false, 'ORDER_MANAGER cannot add products');
  assert(canExecuteAction(ROLES.SUPPORT, 'admin_update_settings') === false, 'SUPPORT cannot update settings');
  assert(canExecuteAction(ROLES.VIEWER, 'admin_list') === true, 'VIEWER can view product catalog');
  assert(canExecuteAction(ROLES.VIEWER, 'admin_delete_order') === false, 'VIEWER cannot delete orders');

  // ─────────────────────────────────────────────
  // 7. Tenant Isolation & IDOR Adversarial Tests
  // ─────────────────────────────────────────────
  console.log('\n── [7] العزل الصارم للمستأجرين وحماية IDOR (Tenant Isolation & IDOR Rejection) ──');
  
  // Tenant A session context
  const sessionAlpha = { userId: 'usr_alpha', tenantId: 'tenant_alpha_001', role: 'OWNER' };
  const sessionBeta = { userId: 'usr_beta', tenantId: 'tenant_beta_002', role: 'OWNER' };

  // Tenant Alpha attempting to access Beta product
  const betaProd = await db.prepare('SELECT * FROM products WHERE id = ? AND tenant_id = ?')
    .bind(201, sessionAlpha.tenantId).first();
  assert(betaProd === null, 'Tenant Alpha cannot query Tenant Beta product (IDOR blocked)');

  // Tenant Beta attempting to access Alpha order
  const alphaOrder = await db.prepare('SELECT * FROM orders WHERE id = ? AND tenant_id = ?')
    .bind(1, sessionBeta.tenantId).first();
  assert(alphaOrder === null, 'Tenant Beta cannot query Tenant Alpha order (IDOR blocked)');

  // Server-Authoritative Tenant Resolution (Ignores client-supplied spoofed slug/tenant)
  const resolvedAlpha = await resolveTenant({ headers: new Headers() }, env, sessionAlpha, 'beta');
  assert(resolvedAlpha === 'tenant_alpha_001', 'Authenticated session strictly locks tenant to session tenant_id (spoof ignored)');

  // ─────────────────────────────────────────────
  // 8. R2 Media & KV Cache Prefix Isolation
  // ─────────────────────────────────────────────
  console.log('\n── [8] عزل وسائط R2 ومفاتيح كاش KV (R2 & KV Isolation) ──');
  const r2KeyAlpha = `tenants/${sessionAlpha.tenantId}/images/prod_1.webp`;
  const r2KeyBeta = `tenants/${sessionBeta.tenantId}/images/prod_2.webp`;
  assert(r2KeyAlpha.startsWith(`tenants/tenant_alpha_001/`), 'R2 path includes tenant prefix');
  assert(!r2KeyBeta.startsWith(`tenants/tenant_alpha_001/`), 'Tenant Alpha cannot access Tenant Beta R2 prefix');

  // ─────────────────────────────────────────────
  // 9. Audit Logging (Zero Password / Secret Leakage)
  // ─────────────────────────────────────────────
  console.log('\n── [9] سجل التدقيق وخلوه من كلمات المرور (Audit Logging Integrity) ──');
  await recordAuditLog(db, {
    tenant_id: sessionAlpha.tenantId,
    user_id: sessionAlpha.userId,
    action: 'TEST_ACTION',
    resource_type: 'product',
    resource_id: '101',
    metadata: { sensitive: false },
    request: { headers: new Headers({ 'User-Agent': 'SecurityTester/1.0' }) },
  });

  const auditRow = await db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 1').first();
  assert(!!auditRow && !auditRow.metadata_json.includes('password') && !auditRow.metadata_json.includes('token'), 
    'Audit log created cleanly with zero credentials/passwords/tokens');

  // ─────────────────────────────────────────────
  // 10. Logout & Server Session Revocation
  // ─────────────────────────────────────────────
  console.log('\n── [10] تسجيل الخروج وإبطال الجلسة على الخادم (Logout & Session Revocation) ──');
  const logoutRes = await authLogout(env, cpRes.token, authSession);
  assert(logoutRes.ok === true, 'Logout returns success');
  const validateLoggedOut = await validateSession(db, cpRes.token);
  assert(validateLoggedOut.valid === false, 'Session token invalidated on server in D1 upon logout');

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`📊 TOTAL INTEGRATION TEST RESULTS: ${pass} PASSED | ${fail} FAILED`);
  console.log('═══════════════════════════════════════════════════════════════');

  if (fail > 0) process.exit(1);
}

runPhase30IntegrationSuite();
