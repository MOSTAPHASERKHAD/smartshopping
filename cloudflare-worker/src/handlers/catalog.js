/**
 * Smart Shopping — Cloudflare Worker
 * ملف: src/handlers/catalog.js
 * 
 * معالجات الكتالوج والمنتجات (Public + Admin)
 * ─────────────────────────────────────────────
 * Public:
 *   getCatalog()        → action=catalog
 *   getSettings()       → action=settings
 *   getTestimonials()   → action=testimonials
 *   getPages()          → action=get_pages
 *   getReviews()        → action=get_reviews
 *   validateCoupon()    → action=validate_coupon
 * 
 * Admin (تتطلب token):
 *   adminListProducts() → action=admin_list
 *   adminAddProduct()   → action=admin_add_product
 *   adminEditProduct()  → action=admin_edit_product
 *   adminDeleteProduct()→ action=admin_delete_product
 */

import { sanitize, sanitizeNumber } from '../utils/sanitize.js';

// ─────────────────────────────────────────────
// مدة cache الكتالوج (ثانية) — 10 دقائق
const CATALOG_CACHE_TTL = 600;
const SETTINGS_CACHE_TTL = 600;

/**
 * [PUBLIC] جلب الكتالوج الكامل للزوار
 * يُرجع المنتجات النشطة فقط مع دعم KV Cache
 * يُحاكي getCatalog() في GAS
 */
export async function getCatalog(env) {
  const cacheKey = 'catalog_v1';

  // ── جرِّب الـ Cache أولاً (KV) ──
  if (env.CACHE) {
    const cached = await env.CACHE.get(cacheKey, { type: 'json' });
    if (cached) return cached;
  }

  // ── اجلب من D1 ──
  const { results } = await env.DB.prepare(`
    SELECT
      id, name, description, description_long,
      price, price_old, image_url, gallery_json,
      variant_options, category, stock, tags_json,
      sku, sort_order, created_at
    FROM products
    WHERE active = 1
    ORDER BY sort_order ASC, id DESC
  `).all();

  // ── حوِّل حقول JSON من نص إلى كائنات ──
  const products = results.map(p => ({
    ...p,
    gallery_json:    safeParseJson(p.gallery_json,    []),
    variant_options: safeParseJson(p.variant_options, []),
    tags_json:       safeParseJson(p.tags_json,       []),
  }));

  const result = { products };

  // ── خزِّن في Cache ──
  if (env.CACHE) {
    await env.CACHE.put(cacheKey, JSON.stringify(result), {
      expirationTtl: CATALOG_CACHE_TTL,
    });
  }

  return result;
}

/**
 * [PUBLIC] جلب إعدادات المتجر (بدون المفاتيح السرية)
 * يُحاكي getSettings() في GAS
 */
export async function getSettings(env) {
  const cacheKey = 'settings_v1';

  if (env.CACHE) {
    const cached = await env.CACHE.get(cacheKey, { type: 'json' });
    if (cached) return cached;
  }

  // المفاتيح السرية لا تُرسَل للعميل مطلقاً
  const SECRET_KEYS = new Set([
    'admin_password_hash', 'admin_recovery_hash',
    'fb_capi_token', 'gemini_api_key',
    'login_fails', 'login_blocked_until',
  ]);

  const { results } = await env.DB.prepare(
    `SELECT key, value FROM settings`
  ).all();

  const settings = {};
  for (const row of results) {
    if (!SECRET_KEYS.has(row.key)) {
      settings[row.key] = row.value;
    }
  }

  if (env.CACHE) {
    await env.CACHE.put(cacheKey, JSON.stringify(settings), {
      expirationTtl: SETTINGS_CACHE_TTL,
    });
  }

  return settings;
}

/**
 * [PUBLIC] جلب الشهادات/الآراء الظاهرة
 */
export async function getTestimonials(env) {
  const { results } = await env.DB.prepare(`
    SELECT id, author_name, author_location, content, rating, avatar_url
    FROM testimonials
    WHERE active = 1
    ORDER BY sort_order ASC, id DESC
  `).all();

  return { testimonials: results };
}

/**
 * [PUBLIC] جلب تقييمات منتج محدد
 * @param {object} params - يحتوي على product_id
 */
export async function getReviews(env, params) {
  const productId = parseInt(params.product_id || 0);
  if (!productId) return { reviews: [] };

  const { results } = await env.DB.prepare(`
    SELECT id, author_name, content, rating, image_url, created_at
    FROM reviews
    WHERE product_id = ? AND status = 'approved'
    ORDER BY id DESC
    LIMIT 50
  `).bind(productId).all();

  return { reviews: results };
}

/**
 * [PUBLIC] جلب الصفحات الظاهرة
 */
export async function getPages(env) {
  const { results } = await env.DB.prepare(`
    SELECT slug, title, content
    FROM pages
    WHERE active = 1
  `).all();

  return { pages: results };
}

/**
 * [PUBLIC] التحقق من صحة كوبون الخصم
 * يُحاكي validateCoupon() في GAS
 * @param {object} params - { coupon_code, subtotal }
 */
export async function validateCoupon(env, params) {
  const code     = sanitize(params.coupon_code, 50).toUpperCase();
  const subtotal = sanitizeNumber(params.subtotal);

  if (!code) return { valid: false, error: 'كود الكوبون مطلوب' };

  const coupon = await env.DB.prepare(`
    SELECT id, code, discount_type, discount_value, min_order, max_uses, used_count, expires_at
    FROM coupons
    WHERE code = ? AND active = 1
    LIMIT 1
  `).bind(code).first();

  if (!coupon) return { valid: false, error: 'الكوبون غير موجود أو منتهي الصلاحية' };

  // تحقق من الصلاحية الزمنية
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
    return { valid: false, error: 'انتهت صلاحية هذا الكوبون' };
  }

  // تحقق من عدد مرات الاستخدام
  if (coupon.max_uses > 0 && coupon.used_count >= coupon.max_uses) {
    return { valid: false, error: 'تم استنفاد الكوبون بالكامل' };
  }

  // تحقق من الحد الأدنى للطلب
  if (coupon.min_order > 0 && subtotal < coupon.min_order) {
    return {
      valid: false,
      error: `الحد الأدنى للطلب لاستخدام هذا الكوبون هو ${coupon.min_order} دج`,
    };
  }

  // احسب قيمة الخصم
  let discountAmount;
  if (coupon.discount_type === 'percent') {
    discountAmount = Math.min(subtotal * (coupon.discount_value / 100), subtotal);
  } else {
    discountAmount = Math.min(coupon.discount_value, subtotal);
  }

  return {
    valid:           true,
    discount_type:   coupon.discount_type,
    discount_value:  coupon.discount_value,
    discount_amount: Math.round(discountAmount * 100) / 100,
    message:         `تم تطبيق خصم ${coupon.discount_type === 'percent' ? coupon.discount_value + '%' : coupon.discount_value + ' دج'}`,
  };
}

// ─────────────────────────────────────────────
// ── معالجات الأدمن (Admin Handlers) ──
// ─────────────────────────────────────────────

/**
 * [ADMIN] قائمة جميع المنتجات (نشطة وغير نشطة)
 */
export async function adminListProducts(env) {
  const { results } = await env.DB.prepare(`
    SELECT * FROM products ORDER BY sort_order ASC, id DESC
  `).all();

  const products = results.map(p => ({
    ...p,
    gallery_json:    safeParseJson(p.gallery_json,    []),
    variant_options: safeParseJson(p.variant_options, []),
    tags_json:       safeParseJson(p.tags_json,       []),
  }));

  return { products };
}

/**
 * [ADMIN] إضافة منتج جديد
 * @param {object} params - بيانات المنتج
 */
export async function adminAddProduct(env, params) {
  const name    = sanitize(params.name, 300);
  if (!name) return { ok: false, error: 'اسم المنتج مطلوب' };

  const price   = sanitizeNumber(params.price);
  if (price <= 0) return { ok: false, error: 'سعر المنتج يجب أن يكون أكبر من صفر' };

  // تأكد من أن variant_options و gallery_json قابلة للـ serialize
  const variantOptions = serializeJson(params.variant_options, '[]');
  const galleryJson    = serializeJson(params.gallery_json,    '[]');
  const tagsJson       = serializeJson(params.tags_json,       '[]');

  const result = await env.DB.prepare(`
    INSERT INTO products
      (name, description, description_long, price, price_old,
       image_url, gallery_json, variant_options, category,
       stock, active, sort_order, tags_json, sku)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    name,
    sanitize(params.description,      1000),
    sanitize(params.description_long, 10000),
    price,
    params.price_old ? sanitizeNumber(params.price_old) : null,
    sanitize(params.image_url, 500),
    galleryJson,
    variantOptions,
    sanitize(params.category, 100),
    parseInt(params.stock ?? -1),
    params.active === '0' || params.active === false ? 0 : 1,
    parseInt(params.sort_order ?? 0),
    tagsJson,
    sanitize(params.sku, 100),
  ).run();

  // امسح الـ cache ليظهر المنتج فوراً
  if (env.CACHE) await env.CACHE.delete('catalog_v1');

  return { ok: true, id: result.meta.last_row_id };
}

/**
 * [ADMIN] تعديل منتج موجود
 * @param {object} params - يجب أن يحتوي على id
 */
export async function adminEditProduct(env, params) {
  const id = parseInt(params.id);
  if (!id) return { ok: false, error: 'معرّف المنتج (id) مطلوب' };

  // تحقق من وجود المنتج
  const existing = await env.DB.prepare(
    `SELECT id FROM products WHERE id = ? LIMIT 1`
  ).bind(id).first();

  if (!existing) return { ok: false, error: 'المنتج غير موجود' };

  await env.DB.prepare(`
    UPDATE products SET
      name             = ?,
      description      = ?,
      description_long = ?,
      price            = ?,
      price_old        = ?,
      image_url        = ?,
      gallery_json     = ?,
      variant_options  = ?,
      category         = ?,
      stock            = ?,
      active           = ?,
      sort_order       = ?,
      tags_json        = ?,
      sku              = ?,
      updated_at       = strftime('%Y-%m-%dT%H:%M:%SZ','now')
    WHERE id = ?
  `).bind(
    sanitize(params.name, 300),
    sanitize(params.description,      1000),
    sanitize(params.description_long, 10000),
    sanitizeNumber(params.price),
    params.price_old ? sanitizeNumber(params.price_old) : null,
    sanitize(params.image_url, 500),
    serializeJson(params.gallery_json,    '[]'),
    serializeJson(params.variant_options, '[]'),
    sanitize(params.category, 100),
    parseInt(params.stock ?? -1),
    params.active === '0' || params.active === false ? 0 : 1,
    parseInt(params.sort_order ?? 0),
    serializeJson(params.tags_json, '[]'),
    sanitize(params.sku, 100),
    id,
  ).run();

  if (env.CACHE) await env.CACHE.delete('catalog_v1');

  return { ok: true };
}

/**
 * [ADMIN] حذف منتج
 * @param {object} params - { id }
 */
export async function adminDeleteProduct(env, params) {
  const id = parseInt(params.id);
  if (!id) return { ok: false, error: 'معرّف المنتج (id) مطلوب' };

  await env.DB.prepare(`DELETE FROM products WHERE id = ?`).bind(id).run();

  if (env.CACHE) await env.CACHE.delete('catalog_v1');

  return { ok: true };
}

// ─────────────────────────────────────────────
// ── دوال مساعدة داخلية ──
// ─────────────────────────────────────────────

/** تحليل JSON بأمان مع قيمة افتراضية */
function safeParseJson(text, fallback) {
  if (!text) return fallback;
  try   { return JSON.parse(text); }
  catch { return fallback; }
}

/** تحويل قيمة إلى JSON string (لحفظها في D1) */
function serializeJson(value, fallback = '[]') {
  if (!value) return fallback;
  if (typeof value === 'string') {
    // تحقق من أنها JSON صالحة
    try { JSON.parse(value); return value; }
    catch { return fallback; }
  }
  try   { return JSON.stringify(value); }
  catch { return fallback; }
}
