/**
 * Smart Shopping — Cloudflare Worker
 * ملف: src/utils/auth.js
 * 
 * نظام المصادقة والأمان
 * - توليد وتحقق tokens الأدمن (مخزَّنة في D1)
 * - هاش SHA-256 لكلمة المرور
 * - rate limiting بسيط عبر D1
 */

// ── ثوابت الجلسة ──
const SESSION_TTL_MS  = 24 * 60 * 60 * 1000; // 24 ساعة
const LOGIN_MAX_FAILS = 5;
const LOGIN_BLOCK_MS  = 60 * 1000;            // دقيقة واحدة

/**
 * توليد هاش SHA-256 لنص ما
 * تُستخدَم لمقارنة كلمة المرور بدون تخزينها نصياً
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
 * توليد token عشوائي وآمن (128-bit entropy)
 * بديل لـ Utilities.getUuid() في GAS
 * @returns {string}
 */
export function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * إصدار جلسة أدمن جديدة وحفظها في D1
 * يحل محل _issueAdminToken() في GAS
 * @param {D1Database} db
 * @param {number} ttlMs - مدة الصلاحية بالميلي ثانية
 * @returns {Promise<string>} الـ token الجديد
 */
export async function issueAdminSession(db, ttlMs = SESSION_TTL_MS) {
  const token     = generateToken();
  const expiresAt = Date.now() + ttlMs;

  // احذف الجلسات المنتهية أولاً (تنظيف دوري)
  await db.prepare(
    `DELETE FROM admin_sessions WHERE expires_at < ?`
  ).bind(Date.now()).run();

  // أدرج الجلسة الجديدة
  await db.prepare(
    `INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)`
  ).bind(token, expiresAt).run();

  return token;
}

/**
 * التحقق من صحة token الأدمن
 * يحل محل _isValidAdminToken() في GAS
 * @param {D1Database} db
 * @param {string} token
 * @returns {Promise<boolean>}
 */
export async function validateAdminToken(db, token) {
  if (!token || token.length < 32) return false;

  const row = await db.prepare(
    `SELECT expires_at FROM admin_sessions WHERE token = ? LIMIT 1`
  ).bind(token).first();

  if (!row) return false;

  // تحقق من انتهاء الصلاحية
  if (Date.now() > row.expires_at) {
    // احذف الجلسة المنتهية
    await db.prepare(
      `DELETE FROM admin_sessions WHERE token = ?`
    ).bind(token).run();
    return false;
  }

  return true;
}

/**
 * إلغاء جلسة الأدمن (تسجيل خروج)
 * @param {D1Database} db
 * @param {string} token
 */
export async function revokeAdminSession(db, token) {
  await db.prepare(
    `DELETE FROM admin_sessions WHERE token = ?`
  ).bind(token).run();
}

/**
 * مقارنة نصوص hex في زمن ثابت (Constant-Time)
 * تمنع هجمات التوقيت على مقارنة كلمة المرور / الـ token
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * إعادة هاش كلمة مرور الأدمن الموثوق
 * الأولوية: Secret `ADMIN_PASSWORD_HASH` (الموثوق) ثم `admin_password_hash` في D1 (انتقالي).
 * @param {D1Database} db
 * @param {Env} env
 * @returns {Promise<string|null>} null = لم تُهيَّأ الحساب بعد
 */
async function resolveAdminPasswordHash(db, env) {
  const secretHash = env && typeof env.ADMIN_PASSWORD_HASH === 'string'
    ? env.ADMIN_PASSWORD_HASH.trim()
    : '';
  if (secretHash) return secretHash;

  const hashRow = await db.prepare(
    `SELECT value FROM settings WHERE key = 'admin_password_hash' LIMIT 1`
  ).first();
  return (hashRow && hashRow.value) ? hashRow.value : null;
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
 * ── Customer Authentication ──
 */

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
