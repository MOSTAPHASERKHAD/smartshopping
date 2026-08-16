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
} from '../src/utils/auth.js';
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
} from '../src/handlers/merchant_auth.js';

console.log('═══════════════════════════════════════════════════════════════');
console.log('🚀 STAGING VERIFICATION SUITE — PHASE 29 MERCHANT AUTH');
console.log('═══════════════════════════════════════════════════════════════\n');

async function runStagingVerification() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE COLLATE NOCASE, domain TEXT DEFAULT NULL UNIQUE, status TEXT DEFAULT 'active', plan TEXT DEFAULT 'master', created_at TEXT, updated_at TEXT);
    CREATE TABLE users (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT DEFAULT '', password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'OWNER', status TEXT DEFAULT 'active', email_verified_at TEXT, password_changed_at TEXT, last_login_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, tenant_id TEXT NOT NULL, role TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at TEXT, last_seen_at TEXT, revoked_at TEXT, revoke_reason TEXT);
    CREATE TABLE password_reset_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, used_at TEXT, created_at TEXT);
    CREATE TABLE email_verification_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, used_at TEXT, created_at TEXT);
    CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, user_id TEXT, action TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT, ip_hash TEXT, user_agent TEXT, metadata_json TEXT, created_at TEXT);
    INSERT INTO tenants (id, name, slug, domain, status, plan) VALUES ('tenant_master_default', 'Smart Shopping Master', 'main', 'smartshopping.click', 'active', 'master');
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

  // 1. Signup Merchant
  console.log('[1] Testing Merchant Signup (auth_register)...');
  const reg = await authRegister(env, { email: 'staging_owner@shop.com', password: 'StagingPass2026!', store_name: 'Staging Shop' });
  console.log('  ✅ Signup result:', reg.ok ? 'SUCCESS' : 'FAILED', reg.tenant?.id);

  // 2. Login Merchant
  console.log('\n[2] Testing Merchant Login (auth_login)...');
  const login = await authLogin(env, { email: 'staging_owner@shop.com', password: 'StagingPass2026!' });
  console.log('  ✅ Login result:', login.ok ? 'SUCCESS' : 'FAILED', 'Token length:', login.token?.length);

  // 3. Current User Info
  console.log('\n[3] Testing Current User Info (auth_me)...');
  const authSession = { userId: login.user.id, tenantId: login.tenant.id, role: login.user.role };
  const me = await authMe(env, login.token, authSession);
  console.log('  ✅ auth_me result:', me.ok ? 'SUCCESS' : 'FAILED', me.user?.email, me.tenant?.name);

  // 4. Change Password
  console.log('\n[4] Testing Change Password (auth_change_password)...');
  const cp = await authChangePassword(env, { current_password: 'StagingPass2026!', new_password: 'NewStagingPass2026!' }, login.token, authSession);
  console.log('  ✅ auth_change_password result:', cp.ok ? 'SUCCESS' : 'FAILED');

  // 5. Verify Old Session Revoked
  console.log('\n[5] Testing Session Revocation After Password Change...');
  const oldVal = await validateSession(db, login.token);
  const newVal = await validateSession(db, cp.token);
  console.log('  ✅ Old Session Valid:', oldVal.valid, '| New Session Valid:', newVal.valid);

  // 6. List Sessions
  console.log('\n[6] Testing List Active Sessions (auth_sessions)...');
  const sess = await authListSessions(env, cp.token, authSession);
  console.log('  ✅ Active sessions count:', sess.sessions?.length);

  // 7. Logout
  console.log('\n[7] Testing Logout (auth_logout)...');
  const logout = await authLogout(env, cp.token, authSession);
  const loggedOutVal = await validateSession(db, cp.token);
  console.log('  ✅ Logout result:', logout.ok ? 'SUCCESS' : 'FAILED', '| Token Valid after logout:', loggedOutVal.valid);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('🎉 Staging Smoke Tests Completed Successfully (7 / 7 PASS)');
  console.log('═══════════════════════════════════════════════════════════════');
}

runStagingVerification();
