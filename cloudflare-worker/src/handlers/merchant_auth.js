/**
 * Smart Shopping — Merchant Authentication Handlers
 * ملف: src/handlers/merchant_auth.js
 * 
 * معالجات مصادقة التجار وإدارة الحسابات والجلسات (Phase 29)
 * ─────────────────────────────────────────────
 * - تسجيل تاجر جديد (Signup)
 * - تسجيل الدخول والخروج (Login & Logout)
 * - استعادة وتأكيد كلمات المرور (Forgot & Reset Password)
 * - تأكيد البريد الإلكتروني (Email Verification)
 * - تغيير كلمة المرور وإلغاء الجلسات (Password Change & Session Revocation)
 */

import {
  sha256,
  generateToken,
  normalizeEmail,
  isValidEmail,
  validatePasswordStrength,
  hashMerchantPassword,
  verifyMerchantPassword,
  issueSession,
  revokeSession,
  revokeAllUserSessions,
  recordAuditLog,
  DEFAULT_MASTER_TENANT_ID,
} from '../utils/auth.js';
import { ROLES } from '../utils/rbac.js';
import { sanitize } from '../utils/sanitize.js';
import { EmailProvider } from '../utils/email.js';

const RESET_TOKEN_TTL_MS  = 30 * 60 * 1000;       // 30 دقيقة
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;  // 24 ساعة

/**
 * [PUBLIC] تسجيل تاجر جديد وإنشاء متجر
 */
export async function authRegister(env, params, request) {
  const email       = normalizeEmail(params.email);
  const password    = params.password || '';
  const name        = sanitize(params.name || '', 100);
  const storeName   = sanitize(params.store_name || name || 'متجري', 100);
  let   slug        = sanitize(params.slug || '', 60).toLowerCase().replace(/[^a-z0-9_-]/g, '');

  if (!email || !isValidEmail(email)) {
    return { ok: false, error: 'البريد الإلكتروني غير صالح' };
  }

  const pwCheck = validatePasswordStrength(password);
  if (!pwCheck.valid) {
    return { ok: false, error: pwCheck.error };
  }

  // 1. التحقق من عدم وجود البريد مسبقاً (Global Email Uniqueness)
  const existingUser = await env.DB.prepare(
    `SELECT id FROM users WHERE email = ? COLLATE NOCASE LIMIT 1`
  ).bind(email).first();

  if (existingUser) {
    return { ok: false, error: 'البريد الإلكتروني مسجل بالفعل' };
  }

  // 2. التحقق من توفر الـ slug أو توليده
  if (!slug) {
    slug = 'store-' + generateToken(4);
  }

  const existingTenant = await env.DB.prepare(
    `SELECT id FROM tenants WHERE slug = ? COLLATE NOCASE LIMIT 1`
  ).bind(slug).first();

  if (existingTenant) {
    slug = slug + '-' + generateToken(3);
  }

  const tenantId = 'tenant_' + generateToken(8);
  const userId   = 'user_' + generateToken(8);
  const passwordHash = await hashMerchantPassword(password);

  // 3. إنشاء المتجر والمستخدم بدور OWNER
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO tenants (id, name, slug, status, plan, created_at, updated_at)
      VALUES (?, ?, ?, 'active', 'starter', strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    `).bind(tenantId, storeName, slug),

    env.DB.prepare(`
      INSERT INTO users (id, tenant_id, email, name, password_hash, role, status, email_verified_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'OWNER', 'active', NULL, strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    `).bind(userId, tenantId, email, name, passwordHash),
  ]);

  // 4. توليد رمز تأكيد البريد الإلكتروني
  const verifyRawToken = generateToken(32);
  const verifyTokenHash = await sha256(verifyRawToken);
  const expiresAt = Date.now() + VERIFY_TOKEN_TTL_MS;

  await env.DB.prepare(`
    INSERT INTO email_verification_tokens (user_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  `).bind(userId, verifyTokenHash, expiresAt).run();

  // 5. إرسال رسالة التأكيد
  await EmailProvider.sendVerificationEmail({
    to: email,
    token: verifyRawToken,
    tenantName: storeName,
    env,
  });

  // 6. تسجيل في سجل التدقيق
  await recordAuditLog(env.DB, {
    tenant_id: tenantId,
    user_id: userId,
    action: 'USER_CREATED',
    resource_type: 'user',
    resource_id: userId,
    metadata: { email, role: 'OWNER' },
    request,
  });

  return {
    ok: true,
    message: 'تم إنشاء الحساب بنجاح. يرجى مراجعة بريدك الإلكتروني لتأكيد الحساب.',
    tenant: { id: tenantId, name: storeName, slug },
  };
}

/**
 * [PUBLIC] تسجيل دخول التاجر بالبريد وكلمة المرور
 */
export async function authLogin(env, params, request) {
  const email    = normalizeEmail(params.email);
  const password = params.password || '';

  if (!email || !password) {
    return { ok: false, error: 'البريد الإلكتروني وكلمة المرور مطلوبان' };
  }

  // 1. جلب المستخدم والتحقق من وجوده
  const user = await env.DB.prepare(`
    SELECT u.id, u.tenant_id, u.email, u.name, u.password_hash, u.role, u.status, u.email_verified_at,
           t.name as tenant_name, t.slug as tenant_slug, t.domain as tenant_domain, t.status as tenant_status
    FROM users u
    JOIN tenants t ON u.tenant_id = t.id
    WHERE u.email = ? COLLATE NOCASE
    LIMIT 1
  `).bind(email).first();

  // Anti-Enumeration: رسالة موحدة في حالة عدم وجود الحساب
  if (!user) {
    return { ok: false, error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' };
  }

  // 2. التحقق من كلمة المرور (PBKDF2 مع دعم الترقية التلقائية من الصيغ القديمة)
  const verifyRes = await verifyMerchantPassword(password, user.password_hash);
  if (!verifyRes.valid) {
    await recordAuditLog(env.DB, {
      tenant_id: user.tenant_id,
      user_id: user.id,
      action: 'LOGIN_FAILURE',
      resource_type: 'auth',
      metadata: { reason: 'WRONG_PASSWORD' },
      request,
    });
    return { ok: false, error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' };
  }

  // 3. التحقق من حالة الحساب والمتجر
  if (user.status === 'suspended' || user.tenant_status === 'suspended') {
    return { ok: false, error: 'هذا الحساب معطل حالياً، يرجى التواصل مع الإدارة' };
  }

  // 4. الترقية التلقائية للهاش إذا كان قديماً (Lazy Rehash to PBKDF2)
  if (verifyRes.needsUpgrade) {
    const newHash = await hashMerchantPassword(password);
    await env.DB.prepare(`
      UPDATE users 
      SET password_hash = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
      WHERE id = ?
    `).bind(newHash, user.id).run();
  }

  // 5. تحديث تاريخ آخر دخول
  await env.DB.prepare(`
    UPDATE users 
    SET last_login_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
    WHERE id = ?
  `).bind(user.id).run();

  // 6. إصدار جلسة جديدة ومشفرة
  const token = await issueSession(env.DB, {
    userId: user.id,
    tenantId: user.tenant_id,
    role: user.role,
  });

  // 7. تسجيل الدخول الناجح في سجل التدقيق
  await recordAuditLog(env.DB, {
    tenant_id: user.tenant_id,
    user_id: user.id,
    action: 'LOGIN_SUCCESS',
    resource_type: 'auth',
    request,
  });

  return {
    ok: true,
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      email_verified: !!user.email_verified_at,
    },
    tenant: {
      id: user.tenant_id,
      name: user.tenant_name,
      slug: user.tenant_slug,
      domain: user.tenant_domain,
    },
  };
}

/**
 * [AUTH] تسجيل خروج التاجر
 */
export async function authLogout(env, token, authSession, request) {
  if (token) {
    await revokeSession(env.DB, token, 'user_logout');
  }

  if (authSession) {
    await recordAuditLog(env.DB, {
      tenant_id: authSession.tenantId,
      user_id: authSession.userId,
      action: 'LOGOUT',
      resource_type: 'auth',
      request,
    });
  }

  return { ok: true, message: 'تم تسجيل الخروج بنجاح' };
}

/**
 * [AUTH] استعلام بيانات المستخدم الحالي (Current User Context)
 */
export async function authMe(env, token, authSession) {
  if (!authSession) {
    return { ok: false, error: 'غير مصرح' };
  }

  // إذا كانت جلسة أدمن قديمة
  if (authSession.isLegacy) {
    return {
      ok: true,
      user: {
        id: 'legacy_admin',
        email: 'admin@smartshopping.click',
        name: 'الأدمن الرئيسي',
        role: ROLES.OWNER,
        isLegacy: true,
      },
      tenant: {
        id: DEFAULT_MASTER_TENANT_ID,
        name: 'Smart Shopping Master',
        slug: 'main',
        domain: 'smartshopping.click',
      },
    };
  }

  const user = await env.DB.prepare(`
    SELECT u.id, u.tenant_id, u.email, u.name, u.role, u.status, u.email_verified_at, u.created_at,
           t.name as tenant_name, t.slug as tenant_slug, t.domain as tenant_domain, t.plan as tenant_plan
    FROM users u
    JOIN tenants t ON u.tenant_id = t.id
    WHERE u.id = ? AND u.tenant_id = ?
    LIMIT 1
  `).bind(authSession.userId, authSession.tenantId).first();

  if (!user) {
    return { ok: false, error: 'المستخدم غير موجود' };
  }

  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      email_verified: !!user.email_verified_at,
      created_at: user.created_at,
    },
    tenant: {
      id: user.tenant_id,
      name: user.tenant_name,
      slug: user.tenant_slug,
      domain: user.tenant_domain,
      plan: user.tenant_plan,
    },
  };
}

/**
 * [PUBLIC] طلب استعادة كلمة المرور (Forgot Password - Anti Enumeration)
 */
export async function authForgotPassword(env, params, request) {
  const email = normalizeEmail(params.email);

  if (!email || !isValidEmail(email)) {
    // استجابة موحدة لمنع الاستكشاف
    return { ok: true, message: 'إذا كان البريد مسجلاً، فستصلك تعليمات استعادة كلمة المرور.' };
  }

  const user = await env.DB.prepare(`
    SELECT u.id, u.tenant_id, u.email, t.name as tenant_name
    FROM users u
    JOIN tenants t ON u.tenant_id = t.id
    WHERE u.email = ? COLLATE NOCASE
    LIMIT 1
  `).bind(email).first();

  if (user) {
    // 1. توليد رمز استعادة عشوائي ومشفر
    const resetRawToken = generateToken(32);
    const resetTokenHash = await sha256(resetRawToken);
    const expiresAt = Date.now() + RESET_TOKEN_TTL_MS;

    // 2. إبطال أي رموز سابقة لنفس المستخدم وحفظ الرمز الجديد
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE password_reset_tokens 
        SET used_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
        WHERE user_id = ? AND used_at IS NULL
      `).bind(user.id),

      env.DB.prepare(`
        INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at)
        VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      `).bind(user.id, resetTokenHash, expiresAt),
    ]);

    // 3. إرسال البريد الإلكتروني
    await EmailProvider.sendPasswordResetEmail({
      to: email,
      token: resetRawToken,
      tenantName: user.tenant_name,
      env,
    });

    // 4. تسجيل في سجل التدقيق
    await recordAuditLog(env.DB, {
      tenant_id: user.tenant_id,
      user_id: user.id,
      action: 'PASSWORD_RESET_REQUESTED',
      resource_type: 'auth',
      request,
    });
  }

  // دائماً نرجع نفس الرسالة (Generic Response)
  return { ok: true, message: 'إذا كان البريد مسجلاً، فستصلك تعليمات استعادة كلمة المرور.' };
}

/**
 * [PUBLIC] تعيين كلمة المرور الجديدة عبر رمز الاستعادة (Reset Password)
 */
export async function authResetPassword(env, params, request) {
  const resetToken  = String(params.token || '').trim();
  const newPassword = params.new_password || '';

  if (!resetToken || resetToken.length < 16) {
    return { ok: false, error: 'رمز الاستعادة غير صالح' };
  }

  const pwCheck = validatePasswordStrength(newPassword);
  if (!pwCheck.valid) {
    return { ok: false, error: pwCheck.error };
  }

  const tokenHash = await sha256(resetToken);

  // 1. التحقق من صلاحية التوكن
  const tokenRow = await env.DB.prepare(`
    SELECT id, user_id, expires_at, used_at
    FROM password_reset_tokens
    WHERE token_hash = ?
    LIMIT 1
  `).bind(tokenHash).first();

  if (!tokenRow || tokenRow.used_at || Date.now() > tokenRow.expires_at) {
    return { ok: false, error: 'رابط استعادة كلمة المرور غير صالح أو منتهي الصلاحية' };
  }

  const newHash = await hashMerchantPassword(newPassword);

  // 2. تحديث كلمة المرور وتعطيل الرمز
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE users
      SET password_hash = ?, password_changed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
      WHERE id = ?
    `).bind(newHash, tokenRow.user_id),

    env.DB.prepare(`
      UPDATE password_reset_tokens
      SET used_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
      WHERE id = ?
    `).bind(tokenRow.id),
  ]);

  // 3. إلغاء كافة الجلسات السابقة للمستخدم (Security Invalidation)
  await revokeAllUserSessions(env.DB, tokenRow.user_id, 'password_reset');

  // 4. تسجيل في سجل التدقيق
  await recordAuditLog(env.DB, {
    user_id: tokenRow.user_id,
    action: 'PASSWORD_RESET_COMPLETED',
    resource_type: 'auth',
    request,
  });

  return { ok: true, message: 'تم تغيير كلمة المرور بنجاح. يمكنك الآن تسجيل الدخول بكلمة المرور الجديدة.' };
}

/**
 * [PUBLIC] تأكيد البريد الإلكتروني عبر التوكن (Verify Email)
 */
export async function authVerifyEmail(env, params, request) {
  const verifyToken = String(params.token || '').trim();

  if (!verifyToken || verifyToken.length < 16) {
    return { ok: false, error: 'رمز التأكيد غير صالح' };
  }

  const tokenHash = await sha256(verifyToken);

  const tokenRow = await env.DB.prepare(`
    SELECT id, user_id, expires_at, used_at
    FROM email_verification_tokens
    WHERE token_hash = ?
    LIMIT 1
  `).bind(tokenHash).first();

  if (!tokenRow || tokenRow.used_at || Date.now() > tokenRow.expires_at) {
    return { ok: false, error: 'رابط التأكيد غير صالح أو منتهي الصلاحية' };
  }

  // تفعيل الحساب
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE users
      SET status = 'active', email_verified_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
      WHERE id = ?
    `).bind(tokenRow.user_id),

    env.DB.prepare(`
      UPDATE email_verification_tokens
      SET used_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
      WHERE id = ?
    `).bind(tokenRow.id),
  ]);

  await recordAuditLog(env.DB, {
    user_id: tokenRow.user_id,
    action: 'EMAIL_VERIFIED',
    resource_type: 'auth',
    request,
  });

  return { ok: true, message: 'تم تأكيد بريدك الإلكتروني بنجاح! يمكنك الآن تسجيل الدخول.' };
}

/**
 * [PUBLIC] إعادة إرسال رسالة التأكيد (Resend Verification)
 */
export async function authResendVerification(env, params, request) {
  const email = normalizeEmail(params.email);

  if (!email || !isValidEmail(email)) {
    return { ok: true, message: 'إذا كان الحساب بانتظار التأكيد، فقد تم إرسال رسالة جديدة.' };
  }

  const user = await env.DB.prepare(`
    SELECT u.id, u.tenant_id, u.email, u.status, t.name as tenant_name
    FROM users u
    JOIN tenants t ON u.tenant_id = t.id
    WHERE u.email = ? COLLATE NOCASE AND u.email_verified_at IS NULL
    LIMIT 1
  `).bind(email).first();

  if (user) {
    const verifyRawToken = generateToken(32);
    const verifyTokenHash = await sha256(verifyRawToken);
    const expiresAt = Date.now() + VERIFY_TOKEN_TTL_MS;

    await env.DB.batch([
      env.DB.prepare(`
        UPDATE email_verification_tokens
        SET used_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
        WHERE user_id = ? AND used_at IS NULL
      `).bind(user.id),

      env.DB.prepare(`
        INSERT INTO email_verification_tokens (user_id, token_hash, expires_at, created_at)
        VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      `).bind(user.id, verifyTokenHash, expiresAt),
    ]);

    await EmailProvider.sendVerificationEmail({
      to: email,
      token: verifyRawToken,
      tenantName: user.tenant_name,
      env,
    });
  }

  return { ok: true, message: 'إذا كان الحساب بانتظار التأكيد، فقد تم إرسال رسالة جديدة.' };
}

/**
 * [AUTH] تغيير كلمة المرور للمستخدم المسجل (Change Password)
 */
export async function authChangePassword(env, params, token, authSession, request) {
  if (!authSession) return { ok: false, error: 'غير مصرح' };

  const currentPassword = params.current_password || '';
  const newPassword     = params.new_password || '';

  const pwCheck = validatePasswordStrength(newPassword);
  if (!pwCheck.valid) {
    return { ok: false, error: pwCheck.error };
  }

  // 1. جلب كلمة المرور الحالية للمستخدم
  const user = await env.DB.prepare(`
    SELECT id, tenant_id, password_hash FROM users WHERE id = ? LIMIT 1
  `).bind(authSession.userId).first();

  if (!user) {
    return { ok: false, error: 'المستخدم غير موجود' };
  }

  // 2. التحقق من صحة كلمة المرور القديمة
  const verifyRes = await verifyMerchantPassword(currentPassword, user.password_hash);
  if (!verifyRes.valid) {
    return { ok: false, error: 'كلمة المرور الحالية غير صحيحة' };
  }

  // 3. تشفير وحفظ كلمة المرور الجديدة
  const newHash = await hashMerchantPassword(newPassword);
  await env.DB.prepare(`
    UPDATE users 
    SET password_hash = ?, password_changed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
    WHERE id = ?
  `).bind(newHash, user.id).run();

  // 4. إلغاء كافة الجلسات الأخرى للمستخدم
  await revokeAllUserSessions(env.DB, user.id, 'password_change');

  // 5. تدوير الجلسة الحالية وإصدار توكن جديد (Session Rotation)
  const newToken = await issueSession(env.DB, {
    userId: user.id,
    tenantId: user.tenant_id,
    role: authSession.role,
  });

  // 6. تسجيل في سجل التدقيق
  await recordAuditLog(env.DB, {
    tenant_id: user.tenant_id,
    user_id: user.id,
    action: 'PASSWORD_CHANGED',
    resource_type: 'auth',
    request,
  });

  return { ok: true, token: newToken, message: 'تم تحديث كلمة المرور بنجاح.' };
}

/**
 * [AUTH] عرض قائمة الجلسات النشطة للمستخدم
 */
export async function authListSessions(env, token, authSession) {
  if (!authSession) return { ok: false, error: 'غير مصرح' };

  const currentTokenHash = token ? await sha256(token) : '';

  const rows = await env.DB.prepare(`
    SELECT token_hash, created_at, last_seen_at, expires_at
    FROM sessions
    WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
    ORDER BY last_seen_at DESC
  `).bind(authSession.userId, Date.now()).all();

  const sessions = (rows?.results || []).map(s => ({
    id: s.token_hash.substring(0, 12),
    created_at: s.created_at,
    last_seen_at: s.last_seen_at,
    expires_at: s.expires_at,
    is_current: s.token_hash === currentTokenHash,
  }));

  return { ok: true, sessions };
}

/**
 * [AUTH] إلغاء كافة الجلسات النشطة للمستخدم الحالي
 */
export async function authRevokeAll(env, token, authSession, request) {
  if (!authSession) return { ok: false, error: 'غير مصرح' };

  await revokeAllUserSessions(env.DB, authSession.userId, 'user_revoke_all');

  await recordAuditLog(env.DB, {
    tenant_id: authSession.tenantId,
    user_id: authSession.userId,
    action: 'ALL_SESSIONS_REVOKED',
    resource_type: 'auth',
    request,
  });

  return { ok: true, message: 'تم إلغاء كافة الجلسات بنجاح. يرجى تسجيل الدخول مجدداً.' };
}
