/**
 * Smart Shopping — Cloudflare Worker
 * ملف: src/utils/auth.js
 * 
 * نظام المصادقة والأمان متعدد المستأجرين (Multi-Tenant Auth & Security)
 * ─────────────────────────────────────────────
 * - توليد وتحقق tokens الموحدة والمشفرة (SHA-256 Hashed Tokens)
 * - دعم التوافقية العكسية للجلسات القديمة (Legacy Session Compatibility)
 * - استخراج وتحديد سياق المتجر (Tenant Context Resolution)
 * - تسجيل العمليات الحساسة في سجل التدقيق (Audit Logging)
 */

import { canExecuteAction, ROLES } from './rbac.js';

// ── ثوابت الجلسة والمصادقة ──
export const SESSION_TTL_MS  = 24 * 60 * 60 * 1000; // 24 ساعة
export const DEFAULT_MASTER_TENANT_ID = 'tenant_master_default';
export const PBKDF2_ITERATIONS = 100000; // Maximum supported by Cloudflare Workers Web Crypto API
export const PBKDF2_PREFIX = 'pbkdf2:sha256:';
const LOGIN_MAX_FAILS = 5;
const LOGIN_BLOCK_MS  = 60 * 1000; // دقيقة واحدة

/**
 * توليد هاش SHA-256 لنص ما
 * @param {string} text
 * @returns {Promise<string>} hex string
 */
export async function sha256(text) {
  const encoder = new TextEncoder();
  const data     = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray  = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * توليد token عشوائي وآمن مشتق من Web Crypto API (CSPRNG)
 * @param {number} [byteLength=32]
 * @returns {string}
 */
export function generateToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * تطبيع البريد الإلكتروني (Lowercase + Trim)
 * @param {string} email
 * @returns {string}
 */
export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * التحقق من تنسيق البريد الإلكتروني
 * @param {string} email
 * @returns {boolean}
 */
export function isValidEmail(email) {
  if (!email || typeof email !== 'string' || email.length > 254) return false;
  const re = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  return re.test(email);
}

/**
 * التحقق من سياسة كلمة المرور (الطول والحدود الآمنة)
 * @param {string} password
 * @returns {{valid: boolean, error?: string}}
 */
export function validatePasswordStrength(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'كلمة المرور مطلوبة' };
  }
  if (password.length < 8) {
    return { valid: false, error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' };
  }
  if (password.length > 128) {
    return { valid: false, error: 'كلمة المرور طويلة جداً (الحد الأقصى 128 حرفاً)' };
  }
  return { valid: true };
}

/**
 * تشفير كلمة مرور التاجر باستخدام PBKDF2-HMAC-SHA256
 * التنسيق الذاتي: pbkdf2:sha256:<iterations>:<saltHex>:<hashHex>
 * @param {string} password
 * @param {number} [iterations=600000]
 * @param {string|null} [saltHex=null]
 * @returns {Promise<string>}
 */
export async function hashMerchantPassword(password, iterations = PBKDF2_ITERATIONS, saltHex = null) {
  const enc = new TextEncoder();
  const salt = saltHex ? hexToUint8Array(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const finalSaltHex = saltHex || uint8ArrayToHex(salt);

  const passwordKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: iterations,
      hash: 'SHA-256'
    },
    passwordKey,
    256
  );

  const hashHex = uint8ArrayToHex(new Uint8Array(derivedBits));
  return `${PBKDF2_PREFIX}${iterations}:${finalSaltHex}:${hashHex}`;
}

/**
 * التحقق من كلمة مرور التاجر مقابل الهاش المخزن
 * يدعم PBKDF2 والتوافقية مع الهاشات القديمة مع علامة needsUpgrade
 * @param {string} password
 * @param {string} storedHash
 * @returns {Promise<{valid: boolean, needsUpgrade: boolean}>}
 */
export async function verifyMerchantPassword(password, storedHash) {
  if (!password || !storedHash || typeof storedHash !== 'string') {
    return { valid: false, needsUpgrade: false };
  }

  // 1. Format: PBKDF2-HMAC-SHA256 (Modern)
  if (storedHash.startsWith(PBKDF2_PREFIX)) {
    const parts = storedHash.slice(PBKDF2_PREFIX.length).split(':');
    if (parts.length !== 3) return { valid: false, needsUpgrade: false };
    const [itersStr, saltHex, expectedHex] = parts;
    const iterations = parseInt(itersStr, 10);
    if (!iterations || isNaN(iterations) || iterations < 10000) {
      return { valid: false, needsUpgrade: false };
    }

    const computedHashStr = await hashMerchantPassword(password, iterations, saltHex);
    const computedHex = computedHashStr.split(':').pop();
    const match = timingSafeEqualHex(computedHex, expectedHex);
    const needsUpgrade = iterations < PBKDF2_ITERATIONS;
    return { valid: match, needsUpgrade };
  }

  // 2. Format: Double SHA-256 or Single SHA-256 (Legacy upgrade path)
  if (storedHash.length === 64 && /^[0-9a-f]+$/i.test(storedHash)) {
    const doubleHashed = await sha256(await sha256(password));
    if (timingSafeEqualHex(doubleHashed, storedHash)) {
      return { valid: true, needsUpgrade: true };
    }
    const singleHashed = await sha256(password);
    if (timingSafeEqualHex(singleHashed, storedHash)) {
      return { valid: true, needsUpgrade: true };
    }
  }

  return { valid: false, needsUpgrade: false };
}

function hexToUint8Array(hex) {
  const match = hex.match(/.{1,2}/g) || [];
  return new Uint8Array(match.map(byte => parseInt(byte, 16)));
}

function uint8ArrayToHex(arr) {
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ════════════════════════════════════════════════════════════
// ── Multi-Tenant Session Engine (Hashed Token Storage) ──
// ════════════════════════════════════════════════════════════

/**
 * إصدار جلسة جديدة للتاجر وحفظها كـ Hash في جدول sessions
 * @param {D1Database} db
 * @param {object} opts - { userId, tenantId, role, ttlMs }
 * @returns {Promise<string>} الـ raw token الذي يُرسل للعميل
 */
export async function issueSession(db, { userId, tenantId = DEFAULT_MASTER_TENANT_ID, role = ROLES.OWNER, ttlMs = SESSION_TTL_MS }) {
  const rawToken  = generateToken();
  const tokenHash = await sha256(rawToken);
  const expiresAt = Date.now() + ttlMs;

  // تنظيف دوري للجلسات المنتهية
  try {
    await db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).bind(Date.now()).run();
  } catch (e) { /* non-blocking cleanup */ }

  // حفظ الجلسة المشفرة
  await db.prepare(`
    INSERT INTO sessions (token_hash, user_id, tenant_id, role, expires_at, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  `).bind(tokenHash, userId, tenantId, role, expiresAt).run();

  return rawToken;
}

/**
 * التحقق من صحة جلسة التاجر واستخراج بيانات المستخدم والمتجر
 * يدعم نظام الجلسات المشفر الجديد + طبقة توافق للجلسات القديمة
 * @param {D1Database} db
 * @param {string} token
 * @returns {Promise<{valid:boolean, session?:object}>}
 */
export async function validateSession(db, token) {
  if (!token || typeof token !== 'string' || token.length < 16) {
    return { valid: false };
  }

  const tokenHash = await sha256(token);

  // 1. التحقق من جدول sessions الحديث (Hashed lookup)
  try {
    const session = await db.prepare(`
      SELECT s.token_hash, s.user_id, s.tenant_id, s.role, s.expires_at, s.revoked_at,
             t.status as tenant_status, t.slug as tenant_slug, t.name as tenant_name
      FROM sessions s
      LEFT JOIN tenants t ON s.tenant_id = t.id
      WHERE s.token_hash = ? AND s.revoked_at IS NULL
      LIMIT 1
    `).bind(tokenHash).first();

    if (session) {
      if (Date.now() > session.expires_at || session.tenant_status === 'suspended') {
        return { valid: false, reason: 'EXPIRED_OR_SUSPENDED' };
      }
      // تحديث last_seen_at بشكل غير متزامن
      db.prepare(`UPDATE sessions SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE token_hash = ?`)
        .bind(tokenHash).run().catch(() => {});

      return {
        valid: true,
        session: {
          userId:    session.user_id,
          tenantId:  session.tenant_id,
          role:      session.role,
          tenantSlug:session.tenant_slug,
          tenantName:session.tenant_name,
        }
      };
    }
  } catch (e) { /* جدول sessions قد لا يكون موجوداً قبل الـ migration */ }

  // 2. Compatibility Layer: التحقق من جدول admin_sessions القديم
  try {
    const legacy = await db.prepare(`
      SELECT expires_at FROM admin_sessions WHERE token = ? LIMIT 1
    `).bind(token).first();

    if (legacy && Date.now() <= legacy.expires_at) {
      return {
        valid: true,
        session: {
          userId:    'legacy_admin',
          tenantId:  DEFAULT_MASTER_TENANT_ID,
          role:      ROLES.OWNER,
          tenantSlug:'main',
          tenantName:'Smart Shopping Master',
          isLegacy:  true,
        }
      };
    }
  } catch (e) { /* non-blocking */ }

  return { valid: false };
}

/**
 * إلغاء جلسة التاجر (تسجيل خروج)
 * @param {D1Database} db
 * @param {string} token
 */
export async function revokeSession(db, token, reason = 'user_logout') {
  if (!token) return;
  const tokenHash = await sha256(token);
  try {
    await db.prepare(`
      UPDATE sessions 
      SET revoked_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
          revoke_reason = ? 
      WHERE token_hash = ?
    `).bind(reason, tokenHash).run();
  } catch (e) {}
  try {
    await db.prepare(`DELETE FROM admin_sessions WHERE token = ?`).bind(token).run();
  } catch (e) {}
}

/**
 * إلغاء كافة الجلسات النشطة لمستخدم محدد (عند تغيير كلمة المرور أو تسجيل الخروج الشامل)
 * @param {D1Database} db
 * @param {string} userId
 * @param {string} [reason='revoke_all']
 */
export async function revokeAllUserSessions(db, userId, reason = 'revoke_all') {
  if (!userId) return;
  try {
    await db.prepare(`
      UPDATE sessions
      SET revoked_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
          revoke_reason = ?
      WHERE user_id = ? AND revoked_at IS NULL
    `).bind(reason, userId).run();
  } catch (e) {}
}

/**
 * Compatibility: وظائف الأدمن القديمة المرجعية
 */
export async function issueAdminSession(db, ttlMs = SESSION_TTL_MS) {
  return issueSession(db, { userId: 'legacy_admin', tenantId: DEFAULT_MASTER_TENANT_ID, role: ROLES.OWNER, ttlMs });
}

export async function validateAdminToken(db, token) {
  const res = await validateSession(db, token);
  return res.valid;
}

export async function revokeAdminSession(db, token) {
  return revokeSession(db, token);
}

// ════════════════════════════════════════════════════════════
// ── Tenant Resolution & Server-Side Scope ──
// ════════════════════════════════════════════════════════════

/**
 * قائمة الكلمات والمسارات المحجوزة للمنصة لمنع حجزها كـ Subdomains
 */
export const RESERVED_SLUGS = new Set([
  'www', 'api', 'admin', 'app', 'dashboard', 'login', 'auth', 'account',
  'support', 'help', 'docs', 'blog', 'mail', 'static', 'assets', 'cdn',
  'dev', 'staging', 'test', 'demo', 'status', 'billing', 'checkout', 'cart',
  'master', 'main', 'default', 'portal', 'webhook', 'root', 'pages'
]);

/**
 * تطبيع اسم النطاق بشكل حتمي (Deterministic Host Normalization)
 * @param {string} rawHost
 * @returns {string}
 */
export function normalizeHostname(rawHost) {
  if (!rawHost || typeof rawHost !== 'string') return '';
  let host = rawHost.trim().toLowerCase();
  // تجريد البورت إذا وُجد
  if (host.includes(':')) {
    host = host.split(':')[0];
  }
  // إزالة النقطة الختامية (trailing dot)
  while (host.endsWith('.')) {
    host = host.slice(0, -1);
  }
  return host;
}

/**
 * استخراج وتحديد التاجر الموثوق للطلب (Server-Side Authoritative Resolution)
 * @param {Request} request
 * @param {Env} env
 * @param {object|null} authenticatedSession
 * @param {string|null} [explicitSlug] - مسموح في المسارات العامة فقط للربط بالنطاق
 * @returns {Promise<string|object|null>} tenantId الموثق أو كائن الخطأ
 */
export async function resolveTenant(request, env, authenticatedSession = null, explicitSlug = null) {
  // 1. إذا كان الطلب مصادقاً بجلسة إدارية: هوية التاجر تُشتق حصرياً من الجلسة (Server-Authoritative)
  if (authenticatedSession && authenticatedSession.tenantId) {
    return authenticatedSession.tenantId;
  }

  // 2. استخراج وتطبيع اسم النطاق الموثوق
  let rawHost = '';
  if (request) {
    try {
      if (request.url) {
        rawHost = new URL(request.url).hostname;
      }
    } catch (e) {}
    if (!rawHost && request.headers) {
      rawHost = request.headers.get('Host') || '';
    }
  }

  const host = normalizeHostname(rawHost);

  // 3. فحص النطاقات الرئيسية للمتجر العام / بيئات التطوير والـ API
  const isMasterHost = !host ||
    host === 'smartshopping.click' ||
    host === 'www.smartshopping.click' ||
    host === 'smartshopping-76x.pages.dev' ||
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.endsWith('.workers.dev') ||
    host.endsWith('.pages.dev');

  if (isMasterHost) {
    // إذا تم تمرير slug صريح (Path / Query Fallback e.g. ?store=slug أو ?tenant_slug=slug)
    if (explicitSlug && typeof explicitSlug === 'string') {
      const cleanSlug = explicitSlug.trim().toLowerCase();
      if (cleanSlug && cleanSlug !== 'main' && cleanSlug !== 'default' && !RESERVED_SLUGS.has(cleanSlug)) {
        return await resolveTenantBySlug(env, cleanSlug);
      }
    }
    return DEFAULT_MASTER_TENANT_ID;
  }

  // 4. فحص النطاقات الفرعية للمنصة (*.smartshopping.click)
  if (host.endsWith('.smartshopping.click')) {
    const subdomain = host.slice(0, -'.smartshopping.click'.length).trim();
    // إذا كان الساب دومين محجوزاً للمنصة (مثل admin, api, www)
    if (RESERVED_SLUGS.has(subdomain)) {
      return DEFAULT_MASTER_TENANT_ID;
    }
    return await resolveTenantBySlug(env, subdomain, host);
  }

  // 5. فحص النطاقات المخصصة (Custom Domains e.g. example.dz)
  return await resolveTenantByDomain(env, host);
}

/**
 * البحث عن التاجر بواسطة الـ Slug مع كاش KV
 */
async function resolveTenantBySlug(env, slug, hostKey = null) {
  const cacheKey = `tenant:host:${hostKey || slug}`;
  if (env.CACHE) {
    try {
      const cached = await env.CACHE.get(cacheKey, { type: 'json' });
      if (cached && cached.tenantId) {
        if (cached.status === 'suspended') return { error: 'STORE_SUSPENDED', tenantId: cached.tenantId };
        return cached.tenantId;
      }
    } catch (e) { /* KV failure fallback to D1 */ }
  }

  try {
    const row = await env.DB.prepare(`SELECT id, status FROM tenants WHERE slug = ? LIMIT 1`).bind(slug).first();
    if (row && row.id) {
      if (env.CACHE) {
        env.CACHE.put(cacheKey, JSON.stringify({ tenantId: row.id, status: row.status }), { expirationTtl: 3600 }).catch(() => {});
      }
      if (row.status === 'suspended') {
        return { error: 'STORE_SUSPENDED', tenantId: row.id };
      }
      if (row.status === 'active') {
        return row.id;
      }
      return null;
    }
  } catch (e) {}

  return null;
}

/**
 * البحث عن التاجر بواسطة النطاق المخصص مع كاش KV
 */
async function resolveTenantByDomain(env, domain) {
  const cacheKey = `tenant:host:${domain}`;
  if (env.CACHE) {
    try {
      const cached = await env.CACHE.get(cacheKey, { type: 'json' });
      if (cached && cached.tenantId) {
        if (cached.status === 'suspended') return { error: 'STORE_SUSPENDED', tenantId: cached.tenantId };
        return cached.tenantId;
      }
    } catch (e) { /* KV failure fallback to D1 */ }
  }

  try {
    const row = await env.DB.prepare(`SELECT id, status FROM tenants WHERE domain = ? LIMIT 1`).bind(domain).first();
    if (row && row.id) {
      if (env.CACHE) {
        env.CACHE.put(cacheKey, JSON.stringify({ tenantId: row.id, status: row.status }), { expirationTtl: 3600 }).catch(() => {});
      }
      if (row.status === 'suspended') {
        return { error: 'STORE_SUSPENDED', tenantId: row.id };
      }
      if (row.status === 'active') {
        return row.id;
      }
      return null;
    }
  } catch (e) {}

  return null;
}

// ════════════════════════════════════════════════════════════
// ── Audit Logging Layer ──
// ════════════════════════════════════════════════════════════

/**
 * تسجيل حدث حساس في سجل التدقيق الأمني
 * لا يخزن كلمات مرور أو tokens أو أسراراً إطلاقاً
 */
export async function recordAuditLog(db, { tenant_id = DEFAULT_MASTER_TENANT_ID, user_id = null, action, resource_type, resource_id = null, metadata = {}, request = null }) {
  try {
    let ipHash = '';
    let userAgent = '';
    if (request) {
      const clientIp = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
      ipHash = (await sha256(clientIp)).substring(0, 16);
      userAgent = (request.headers.get('User-Agent') || '').substring(0, 200);
    }
    const safeMetadata = typeof metadata === 'object' ? JSON.stringify(metadata) : '{}';

    await db.prepare(`
      INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, ip_hash, user_agent, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      tenant_id,
      user_id,
      String(action || '').substring(0, 50),
      String(resource_type || '').substring(0, 50),
      resource_id ? String(resource_id).substring(0, 100) : null,
      ipHash,
      userAgent,
      safeMetadata
    ).run();
  } catch (e) {
    // Audit log failure must not crash business logic
    console.error('[Audit Log Error]', e?.message);
  }
}

/**
 * جلب هاش كلمة مرور الأدمن الموثوق من البيئة أو قاعدة البيانات
 * @param {D1Database} db
 * @param {Env} env
 * @returns {Promise<string|null>}
 */
export async function resolveAdminPasswordHash(db, env = {}) {
  // 1. سر البيئة أولاً
  if (env.ADMIN_PASSWORD_HASH) {
    return String(env.ADMIN_PASSWORD_HASH).trim();
  }

  // 2. جدول الإعدادات في D1
  try {
    const row = await db.prepare(
      `SELECT value FROM settings WHERE key IN ('admin_password_hash', 'admin_password') ORDER BY CASE WHEN key = 'admin_password_hash' THEN 1 ELSE 2 END LIMIT 1`
    ).first();
    if (row && row.value) {
      return String(row.value).trim();
    }
  } catch (e) {}

  return null;
}

/**
 * التحقق من كلمة مرور الأدمن (login)
 * نحوّل كلمة المرور (التي تأتي مُهاشةً مرة من الواجهة: sha256(raw))
 * إلى هاش ثانوي: sha256(sha256(raw)) ثم نقارنها في زمن ثابت.
 *
 * FALL-CLOSED: في حالة عدم وجود أي هاش مُهيَّأ (لا Secret ولا سطر في D1)
 * لا يُعرَف أي "وضع إعداد أولي" أبداً:
 * - في أي بيئة العلاقة تُرفض (لا setup لأي واجهة).
 * @param {D1Database} db
 * @param {string} password - هاش الواجهة sha256(raw)
 * @param {Env} env
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function verifyAdminPassword(db, password, env = {}) {
  if (!password) return { ok: false, error: 'كلمة المرور مطلوبة' };

  // تحقق من الحجب أولاً
  const blockRow = await db.prepare(
    `SELECT value FROM settings WHERE key = 'login_blocked_until' LIMIT 1`
  ).first();

  if (blockRow && parseInt(blockRow.value) > Date.now()) {
    return { ok: false, error: 'تم تجاوز الحد المسموح، يرجى الانتظار دقيقة' };
  }

  // اجلب هاش كلمة المرور الموثوق (Secret أولاً ثم D1)
  const expectedHash = await resolveAdminPasswordHash(db, env);

  // FALL-CLOSED: لا يوجد حساب مهيَّأ — لا يُعرض أي وضع إعداد أولي
  if (!expectedHash) {
    return { ok: false, error: 'لم يتم تهيئة حساب الأدمن بعد' };
  }

  // قارن الهاش في زمن ثابت
  const inputHash = await sha256(password);
  if (!timingSafeEqualHex(inputHash, expectedHash)) {
    await recordLoginFailure(db);
    return { ok: false, error: 'كلمة المرور غير صحيحة' };
  }

  // نجاح: أعد تعيين عداد الفشل
  await db.prepare(
    `DELETE FROM settings WHERE key IN ('login_fails','login_blocked_until')`
  ).run();

  return { ok: true };
}

/**
 * تسجيل محاولة دخول فاشلة (brute-force protection)
 * @param {D1Database} db
 */
async function recordLoginFailure(db) {
  const failRow = await db.prepare(
    `SELECT value FROM settings WHERE key = 'login_fails' LIMIT 1`
  ).first();

  const fails = parseInt(failRow?.value || '0') + 1;

  if (fails >= LOGIN_MAX_FAILS) {
    // احجب لمدة دقيقة
    await db.prepare(
      `INSERT OR REPLACE INTO settings(key, value) VALUES('login_blocked_until', ?)`
    ).bind(String(Date.now() + LOGIN_BLOCK_MS)).run();
    await db.prepare(
      `INSERT OR REPLACE INTO settings(key, value) VALUES('login_fails', '0')`
    ).run();
  } else {
    await db.prepare(
      `INSERT OR REPLACE INTO settings(key, value) VALUES('login_fails', ?)`
    ).bind(String(fails)).run();
  }
}

/**
 * حارس مسارات الأدمن (Admin Gate Middleware)
 * يُطبَّق قبل أي action يبدأ بـ admin_
 *
 * FAIL-CLOSED:
 * - لا يوجد أي "استثناء وضع إعداد أولي" بعد الآن.
 * - كل مسارات admin_* تتطلب توكن جلسة أدمن صالحاً بلا أي استثناء.
 * @param {string} action
 * @param {string|null} token
 * @param {D1Database} db
 * @returns {Promise<boolean>}
 */
export async function adminGate(action, token, db) {
  // المسارات التي تتطلب مصادقة
  const PROTECTED_PREFIXES = ['admin_'];
  const PROTECTED_ACTIONS  = new Set([
    'generate_recovery', 'capi_test',
    'auth_me', 'auth_logout', 'auth_change_password',
    'auth_sessions', 'auth_revoke_session', 'auth_revoke_all',
  ]);

  const needsAuth =
    PROTECTED_ACTIONS.has(action) ||
    PROTECTED_PREFIXES.some(p => action.startsWith(p));

  if (!needsAuth) return true;

  return validateAdminToken(db, token);
}

/**
 * حارس spam الطلبات (Order Spam Guard)
 * يمنع إرسال أكثر من طلب في 60 ثانية من نفس الهاتف
 * يُخزَّن في D1 بدلاً من PropertiesService
 * @param {D1Database} db
 * @param {string} phone
 * @returns {Promise<boolean>} true = مسموح، false = محجوب
 */
export async function orderSpamGuard(db, phone) {
  if (!phone) return true;

  const key = `spam_order_${phone.replace(/[^0-9]/g, '')}`;
  const row = await db.prepare(
    `SELECT value FROM settings WHERE key = ? LIMIT 1`
  ).bind(key).first();

  const last = parseInt(row?.value || '0');
  const now  = Date.now();

  if (now - last < 60_000) return false; // محجوب

  // سجِّل الوقت الحالي
  await db.prepare(
    `INSERT OR REPLACE INTO settings(key, value) VALUES(?, ?)`
  ).bind(key, String(now)).run();

  return true;
}

/**
 * ── Customer Authentication & Password Hashing ──
 */

export const CUSTOMER_PW_S1 = 's1:';
export const CUSTOMER_PW_P1 = 'p1:';

export function generateSaltHex() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function hashCustomerPasswordS1(password, saltHex = null) {
  const salt = saltHex || generateSaltHex();
  const hash = await sha256(`${salt}:${password}`);
  return `${CUSTOMER_PW_S1}${salt}:${hash}`;
}

export async function verifyCustomerPassword(password, phone, storedHash, env = {}) {
  if (!password || !storedHash) return { ok: false };

  // Scheme 1: Modern salted SHA-256 (s1:salt:hash)
  if (storedHash.startsWith(CUSTOMER_PW_S1)) {
    const parts = storedHash.split(':');
    if (parts.length !== 3) return { ok: false };
    const [, salt, expectedHash] = parts;
    const computed = await sha256(`${salt}:${password}`);
    const match = timingSafeEqualHex(computed, expectedHash);
    return { ok: match, scheme: 's1', needsUpgrade: false };
  }

  // Scheme 2: Legacy peppered SHA-256 (p1:hash)
  if (storedHash.startsWith(CUSTOMER_PW_P1)) {
    const pepper = env.CUSTOMER_PEPPER;
    if (!pepper) return { ok: false, blocked: true };
    const expected = storedHash.slice(CUSTOMER_PW_P1.length);
    const computed = await sha256(`${password}:${phone}:${pepper}`);
    const match = timingSafeEqualHex(computed, expected);
    return { ok: match, scheme: 'p1', needsUpgrade: true };
  }

  // Scheme 3: Bare SHA-256 (legacy GAS pass:phone or old worker pass)
  if (storedHash.length === 64 && /^[0-9a-f]+$/i.test(storedHash)) {
    const computedGAS = await sha256(`${password}:${phone}`);
    if (timingSafeEqualHex(computedGAS, storedHash)) {
      return { ok: true, scheme: 'sha256', needsUpgrade: true };
    }
    const computedOld = await sha256(password);
    if (timingSafeEqualHex(computedOld, storedHash)) {
      return { ok: true, scheme: 'sha256', needsUpgrade: true };
    }
    return { ok: false, scheme: 'sha256' };
  }

  // Scheme 4: Numeric PIN legacy
  if (timingSafeEqualStr(password, storedHash)) {
    return { ok: true, scheme: 'numeric', needsUpgrade: true };
  }

  return { ok: false };
}

export async function issueCustomerSession(db, customerId, ttlMs = SESSION_TTL_MS) {
  const token = generateToken();
  const expiresAt = Date.now() + ttlMs;

  await db.prepare(
    `DELETE FROM customer_sessions WHERE expires_at < ?`
  ).bind(Date.now()).run();

  await db.prepare(
    `INSERT INTO customer_sessions (token, customer_id, expires_at) VALUES (?, ?, ?)`
  ).bind(token, customerId, expiresAt).run();

  return token;
}

export async function validateCustomerToken(db, token) {
  if (!token || token.length < 32) return null;

  const row = await db.prepare(
    `SELECT customer_id, expires_at FROM customer_sessions WHERE token = ? LIMIT 1`
  ).bind(token).first();

  if (!row) return null;

  if (Date.now() > row.expires_at) {
    await db.prepare(
      `DELETE FROM customer_sessions WHERE token = ?`
    ).bind(token).run();
    return null;
  }

  return row.customer_id;
}

export async function revokeCustomerSession(db, token) {
  await db.prepare(
    `DELETE FROM customer_sessions WHERE token = ?`
  ).bind(token).run();
}
