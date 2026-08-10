/**
 * Smart Shopping — Cloudflare Worker
 * ملف: src/handlers/admin.js
 * 
 * معالجات الأدمن المتنوعة
 * ─────────────────────────────────────────────
 * - تسجيل الدخول / الخروج
 * - إعدادات المتجر
 * - الكوبونات (CRUD)
 * - الشهادات (CRUD)
 * - التقييمات (Admin)
 * - الصفحات (Admin)
 */

import { sanitize, sanitizeNumber } from '../utils/sanitize.js';
import {
  sha256,
  verifyAdminPassword,
  issueAdminSession,
  revokeAdminSession,
} from '../utils/auth.js';

// ─────────────────────────────────────────────
// ── المصادقة (Authentication) ──
// ─────────────────────────────────────────────

/**
 * [PUBLIC] تسجيل دخول الأدمن
 * يُحاكي verifyAdmin() في GAS
 * @param {object} params - { password }
 * @param {Env} env
 */
export async function verifyAdmin(env, params) {
  const password = params.password || '';

  const result = await verifyAdminPassword(env.DB, password, env);

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  // أصدر token جلسة جديد
  const ttlMs = parseInt(env.SESSION_TTL_HOURS ?? 24) * 60 * 60 * 1000;
  const token  = await issueAdminSession(env.DB, ttlMs);

  return { ok: true, token, expires_in: ttlMs };
}

/**
 * [ADMIN] تسجيل الخروج (إبطال الـ token)
 * @param {string} token - الـ token الحالي من الهيدر
 */
export async function adminLogout(env, token) {
  if (token) await revokeAdminSession(env.DB, token);
  return { ok: true };
}

// ─────────────────────────────────────────────
// ── إعدادات المتجر ──
// ─────────────────────────────────────────────

/**
 * [ADMIN] تحديث إعدادات المتجر
 * يُحاكي adminUpdateSettings() في GAS
 * ينظِّف المفاتيح الحساسة قبل الحفظ
 */
export async function adminUpdateSettings(env, params) {
  // المفاتيح المحمية لا تُعَدَّل مباشرةً من هذا الطريق
  // (مصادَرة الأدمن تُدار حصرياً عبر Worker Secret ADMIN_PASSWORD_HASH)
  const IMMUTABLE_KEYS = new Set([
    'login_fails', 'login_blocked_until',
    'admin_password_hash',      // لا يُكتب مباشرةً — فقط عبر admin_password (يُهاش)
    'admin_recovery_code',      // أكواد الاسترداد تُدار آلياً
  ]);

  const updates = [];
  const bindings = [];

  for (const [key, value] of Object.entries(params)) {
    // تخطَّ المعاملات الخاصة بالـ action والـ token
    if (['action', 'token'].includes(key)) continue;
    if (IMMUTABLE_KEYS.has(key)) continue;

    const cleanKey   = sanitize(key,   100);
    let   cleanValue = sanitize(value, 5000);

    // إذا كانت تحديث كلمة المرور: حوِّلها لهاش قبل الحفظ
    if (cleanKey === 'admin_password' && cleanValue) {
      cleanValue = await sha256(cleanValue);
      updates.push([
        `INSERT OR REPLACE INTO settings(key, value) VALUES('admin_password_hash', ?)`,
        [cleanValue],
      ]);
      continue;
    }

    updates.push([
      `INSERT OR REPLACE INTO settings(key, value, updated_at) VALUES(?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
      [cleanKey, cleanValue],
    ]);
  }

  // نفِّذ جميع التحديثات في batch
  for (const [sql, args] of updates) {
    await env.DB.prepare(sql).bind(...args).run();
  }

  // امسح cache الإعدادات
  if (env.CACHE) await env.CACHE.delete('settings_v1');

  return { ok: true };
}

// ─────────────────────────────────────────────
// ── الكوبونات (Coupons CRUD) ──
// ─────────────────────────────────────────────

/**
 * [ADMIN] قائمة الكوبونات
 */
export async function adminListCoupons(env) {
  const { results } = await env.DB.prepare(`
    SELECT * FROM coupons ORDER BY id DESC
  `).all();

  return { coupons: results };
}

/**
 * [ADMIN] إضافة كوبون جديد
 */
export async function adminAddCoupon(env, params) {
  const code = sanitize(params.code, 50).toUpperCase().replace(/\s/g, '');
  if (!code) return { ok: false, error: 'كود الكوبون مطلوب' };

  const discountType  = params.discount_type === 'fixed' ? 'fixed' : 'percent';
  const discountValue = sanitizeNumber(params.discount_value);
  if (discountValue <= 0) return { ok: false, error: 'قيمة الخصم يجب أن تكون أكبر من صفر' };
  if (discountType === 'percent' && discountValue > 100) {
    return { ok: false, error: 'نسبة الخصم لا يمكن أن تتجاوز 100%' };
  }

  try {
    const result = await env.DB.prepare(`
      INSERT INTO coupons (code, discount_type, discount_value, min_order, max_uses, expires_at, active)
      VALUES (?,?,?,?,?,?,?)
    `).bind(
      code,
      discountType,
      discountValue,
      sanitizeNumber(params.min_order),
      parseInt(params.max_uses ?? 0),
      params.expires_at ? sanitize(params.expires_at, 30) : null,
      params.active === '0' ? 0 : 1,
    ).run();

    return { ok: true, id: result.meta.last_row_id };
  } catch (e) {
    if (e.message?.includes('UNIQUE')) {
      return { ok: false, error: 'هذا الكود موجود مسبقاً' };
    }
    throw e;
  }
}

/**
 * [ADMIN] تعديل كوبون
 */
export async function adminEditCoupon(env, params) {
  const id = parseInt(params.id);
  if (!id) return { ok: false, error: 'معرّف الكوبون مطلوب' };

  await env.DB.prepare(`
    UPDATE coupons SET
      code           = ?,
      discount_type  = ?,
      discount_value = ?,
      min_order      = ?,
      max_uses       = ?,
      expires_at     = ?,
      active         = ?
    WHERE id = ?
  `).bind(
    sanitize(params.code, 50).toUpperCase(),
    params.discount_type === 'fixed' ? 'fixed' : 'percent',
    sanitizeNumber(params.discount_value),
    sanitizeNumber(params.min_order),
    parseInt(params.max_uses ?? 0),
    params.expires_at ? sanitize(params.expires_at, 30) : null,
    params.active === '0' ? 0 : 1,
    id,
  ).run();

  return { ok: true };
}

/**
 * [ADMIN] حذف كوبون
 */
export async function adminDeleteCoupon(env, params) {
  const id = parseInt(params.id);
  if (!id) return { ok: false, error: 'معرّف الكوبون مطلوب' };

  await env.DB.prepare(`DELETE FROM coupons WHERE id = ?`).bind(id).run();
  return { ok: true };
}

// ─────────────────────────────────────────────
// ── الشهادات (Testimonials CRUD) ──
// ─────────────────────────────────────────────

export async function adminListTestimonials(env) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM testimonials ORDER BY sort_order ASC, id DESC`
  ).all();
  return { testimonials: results };
}

export async function adminAddTestimonial(env, params) {
  const authorName = sanitize(params.author_name, 200);
  const content    = sanitize(params.content,     2000);
  if (!authorName || !content) {
    return { ok: false, error: 'الاسم والمحتوى مطلوبان' };
  }

  const result = await env.DB.prepare(`
    INSERT INTO testimonials (author_name, author_location, content, rating, avatar_url, active, sort_order)
    VALUES (?,?,?,?,?,?,?)
  `).bind(
    authorName,
    sanitize(params.author_location, 100),
    content,
    Math.min(5, Math.max(1, parseInt(params.rating ?? 5))),
    sanitize(params.avatar_url, 500),
    params.active === '0' ? 0 : 1,
    parseInt(params.sort_order ?? 0),
  ).run();

  // امسح الـ cache
  if (env.CACHE) await env.CACHE.delete('testimonials_v1');

  return { ok: true, id: result.meta.last_row_id };
}

export async function adminEditTestimonial(env, params) {
  const id = parseInt(params.id);
  if (!id) return { ok: false, error: 'المعرّف مطلوب' };

  await env.DB.prepare(`
    UPDATE testimonials SET
      author_name     = ?,
      author_location = ?,
      content         = ?,
      rating          = ?,
      avatar_url      = ?,
      active          = ?,
      sort_order      = ?
    WHERE id = ?
  `).bind(
    sanitize(params.author_name,     200),
    sanitize(params.author_location, 100),
    sanitize(params.content,         2000),
    Math.min(5, Math.max(1, parseInt(params.rating ?? 5))),
    sanitize(params.avatar_url, 500),
    params.active === '0' ? 0 : 1,
    parseInt(params.sort_order ?? 0),
    id,
  ).run();

  if (env.CACHE) await env.CACHE.delete('testimonials_v1');
  return { ok: true };
}

export async function adminDeleteTestimonial(env, params) {
  const id = parseInt(params.id);
  if (!id) return { ok: false, error: 'المعرّف مطلوب' };

  await env.DB.prepare(`DELETE FROM testimonials WHERE id = ?`).bind(id).run();
  if (env.CACHE) await env.CACHE.delete('testimonials_v1');
  return { ok: true };
}

// ─────────────────────────────────────────────
// ── التقييمات (Reviews Admin) ──
// ─────────────────────────────────────────────

export async function adminListReviews(env) {
  const { results } = await env.DB.prepare(`
    SELECT r.*, p.name as product_name
    FROM reviews r
    LEFT JOIN products p ON r.product_id = p.id
    ORDER BY r.id DESC
  `).all();
  return { reviews: results };
}

export async function adminDeleteReview(env, params) {
  const id = parseInt(params.id);
  if (!id) return { ok: false, error: 'المعرّف مطلوب' };

  await env.DB.prepare(`DELETE FROM reviews WHERE id = ?`).bind(id).run();
  return { ok: true };
}

export async function adminApproveReview(env, params) {
  const id     = parseInt(params.id);
  const status = params.status === 'rejected' ? 'rejected' : 'approved';
  if (!id) return { ok: false, error: 'المعرّف مطلوب' };

  await env.DB.prepare(
    `UPDATE reviews SET status = ? WHERE id = ?`
  ).bind(status, id).run();
  return { ok: true };
}

// ─────────────────────────────────────────────
// ── الصفحات المخصصة (Pages) ──
// ─────────────────────────────────────────────

export async function adminListPages(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, slug, title, active, updated_at FROM pages ORDER BY id`
  ).all();
  return { pages: results };
}

export async function adminSavePage(env, params) {
  const slug    = sanitize(params.slug,  100).toLowerCase().replace(/\s+/g, '-');
  const title   = sanitize(params.title, 300);
  const content = params.content ? String(params.content).substring(0, 50000) : '';

  if (!slug || !title) return { ok: false, error: 'الـ slug والعنوان مطلوبان' };

  await env.DB.prepare(`
    INSERT INTO pages (slug, title, content, active, updated_at)
    VALUES (?,?,?,?,strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    ON CONFLICT(slug) DO UPDATE SET
      title      = excluded.title,
      content    = excluded.content,
      active     = excluded.active,
      updated_at = excluded.updated_at
  `).bind(
    slug, title, content,
    params.active === '0' ? 0 : 1,
  ).run();

  return { ok: true };
}
