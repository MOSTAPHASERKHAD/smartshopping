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
import { DEFAULT_MASTER_TENANT_ID } from '../utils/auth.js';

// ─────────────────────────────────────────────
// مدة cache الكتالوج (ثانية) — 10 دقائق
const CATALOG_CACHE_TTL = 600;
const SETTINGS_CACHE_TTL = 600;

/**
 * [PUBLIC] جلب الكتالوج الكامل للزوار مع عزل التاجر
 * @param {Env} env
 * @param {string} [tenantId]
 */
export async function getCatalog(env, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const cacheKey = `tenant:${tenantId}:catalog_v1`;

  // ── جرِّب الـ Cache أولاً (KV) ──
  if (env.CACHE) {
    try {
      const cached = await env.CACHE.get(cacheKey, { type: 'json' });
      if (cached) return cached;
    } catch (e) {}
  }

  // ── اجلب من D1 داخل نطاق التاجر المعتمد ──
  const isMaster = tenantId === DEFAULT_MASTER_TENANT_ID;
  const stmt = isMaster
    ? env.DB.prepare(`
        SELECT
          id, name, description, description_long,
          price, price_old, image_url, gallery_json,
          variant_options, category, stock, tags_json,
          sku, weight, sort_order, created_at, landing_config_json
        FROM products
        WHERE active = 1 AND (tenant_id = ? OR tenant_id IS NULL)
        ORDER BY sort_order ASC, id DESC
      `).bind(tenantId)
    : env.DB.prepare(`
        SELECT
          id, name, description, description_long,
          price, price_old, image_url, gallery_json,
          variant_options, category, stock, tags_json,
          sku, weight, sort_order, created_at, landing_config_json
        FROM products
        WHERE active = 1 AND tenant_id = ?
        ORDER BY sort_order ASC, id DESC
      `).bind(tenantId);

  const { results } = await stmt.all();

  // ── حوِّل حقول JSON من نص إلى كائنات ──
  const products = (results || []).map(p => ({
    ...p,
    gallery_json:    safeParseJson(p.gallery_json,    []),
    variant_options: safeParseJson(p.variant_options, []),
    tags_json:       safeParseJson(p.tags_json,       []),
    landing_config:  normalizeLandingConfig(p.landing_config_json),
  }));

  const result = { products };

  // ── خزِّن في Cache ──
  if (env.CACHE) {
    try {
      await env.CACHE.put(cacheKey, JSON.stringify(result), {
        expirationTtl: CATALOG_CACHE_TTL,
      });
    } catch (e) {}
  }

  return result;
}

/**
 * [PUBLIC] جلب إعدادات المتجر مع عزل التاجر (بدون المفاتيح السرية)
 * @param {Env} env
 * @param {string} [tenantId]
 */
export async function getSettings(env, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const cacheKey = `tenant:${tenantId}:settings_v1`;

  if (env.CACHE) {
    try {
      const cached = await env.CACHE.get(cacheKey, { type: 'json' });
      if (cached) return cached;
    } catch (e) {}
  }

  // المفاتيح السرية لا تُرسَل للعميل مطلقاً
  const SECRET_KEYS = new Set([
    'admin_password_hash', 'admin_recovery_hash',
    'fb_capi_token', 'gemini_api_key',
    'login_fails', 'login_blocked_until',
  ]);

  const isMaster = tenantId === DEFAULT_MASTER_TENANT_ID;
  const stmt = isMaster
    ? env.DB.prepare(`SELECT key, value FROM settings WHERE (tenant_id = ? OR tenant_id IS NULL)`).bind(tenantId)
    : env.DB.prepare(`SELECT key, value FROM settings WHERE tenant_id = ?`).bind(tenantId);

  const { results } = await stmt.all();

  const settings = {};
  for (const row of (results || [])) {
    if (row.key.startsWith('spam_order_')) continue;
    if (!SECRET_KEYS.has(row.key)) {
      settings[row.key] = row.value;
    }
  }

  // ── جلب إعدادات الثيم النشط داخل نطاق التاجر ──
  if (settings.theme_default) {
    const themeStmt = isMaster
      ? env.DB.prepare(`SELECT config_json FROM themes WHERE name = ? AND (tenant_id = ? OR tenant_id IS NULL) LIMIT 1`).bind(settings.theme_default, tenantId)
      : env.DB.prepare(`SELECT config_json FROM themes WHERE name = ? AND tenant_id = ? LIMIT 1`).bind(settings.theme_default, tenantId);

    const themeRow = await themeStmt.first();
    if (themeRow && themeRow.config_json) {
      settings.theme_config = safeParseJson(themeRow.config_json, {});
    }
  }

  // ── خزِّن في Cache ──
  if (env.CACHE) {
    try {
      await env.CACHE.put(cacheKey, JSON.stringify(settings), {
        expirationTtl: SETTINGS_CACHE_TTL,
      });
    } catch (e) {}
  }

  return settings;
}

/**
 * [PUBLIC] جلب سياق وهوية المتجر العامة
 * @param {Env} env
 * @param {string} tenantId
 * @param {Request} [request]
 */
export async function getStoreContext(env, tenantId = DEFAULT_MASTER_TENANT_ID, request = null) {
  const cacheKey = `tenant:${tenantId}:store_context_v1`;

  if (env.CACHE) {
    try {
      const cached = await env.CACHE.get(cacheKey, { type: 'json' });
      if (cached) return cached;
    } catch (e) {}
  }

  // 1. جلب بيانات التاجر الأساسية
  const tenant = await env.DB.prepare(
    `SELECT id, name, slug, domain, status FROM tenants WHERE id = ? LIMIT 1`
  ).bind(tenantId).first();

  if (!tenant) {
    return { ok: false, error: { code: 'STORE_NOT_FOUND', message: 'المتجر غير موجود' } };
  }

  // 2. جلب إعدادات الهوية العامة
  const isMaster = tenantId === DEFAULT_MASTER_TENANT_ID;
  const stmt = isMaster
    ? env.DB.prepare(`SELECT key, value FROM settings WHERE (tenant_id = ? OR tenant_id IS NULL)`).bind(tenantId)
    : env.DB.prepare(`SELECT key, value FROM settings WHERE tenant_id = ?`).bind(tenantId);

  const { results: settingsRows } = await stmt.all();
  const settingsMap = {};
  for (const row of (settingsRows || [])) {
    settingsMap[row.key] = row.value;
  }

  // 3. بناء الرابط القياسي المعتمد (Canonical URL)
  let canonicalUrl = 'https://smartshopping.click';
  if (!isMaster) {
    if (tenant.domain) {
      canonicalUrl = `https://${tenant.domain}`;
    } else if (tenant.slug) {
      canonicalUrl = `https://${tenant.slug}.smartshopping.click`;
    }
  }

  const result = {
    ok: true,
    store: {
      id: tenant.id,
      name: settingsMap.store_name || tenant.name,
      slug: tenant.slug,
      domain: tenant.domain || null,
      status: tenant.status,
      canonical_url: canonicalUrl,
      branding: {
        store_name: settingsMap.store_name || tenant.name,
        store_phone: settingsMap.store_phone || '',
        store_whatsapp: settingsMap.whatsapp_number || settingsMap.store_phone || '',
        logo_url: settingsMap.store_logo || '',
        favicon_url: settingsMap.store_favicon || '',
        primary_color: settingsMap.primary_color || '#2563eb',
        secondary_color: settingsMap.secondary_color || '#f59e0b',
        font_family: settingsMap.font_family || 'Almarai',
        seo_title: settingsMap.seo_title || settingsMap.store_name || tenant.name,
        seo_description: settingsMap.seo_description || 'متجر إلكتروني جزائري — منتجات متنوعة بأفضل الأسعار مع التوصيل لجميع الولايات',
      },
    },
  };

  if (env.CACHE) {
    try {
      await env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: SETTINGS_CACHE_TTL });
    } catch (e) {}
  }

  return result;
}

/**
 * [PUBLIC] جلب الشهادات/الآراء الظاهرة لمتجر التاجر
 */
export async function getTestimonials(env, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const isMaster = tenantId === DEFAULT_MASTER_TENANT_ID;
  const stmt = isMaster
    ? env.DB.prepare(`
        SELECT id, author_name, author_location, content, rating, avatar_url
        FROM testimonials
        WHERE active = 1 AND (tenant_id = ? OR tenant_id IS NULL)
        ORDER BY sort_order ASC, id DESC
      `).bind(tenantId)
    : env.DB.prepare(`
        SELECT id, author_name, author_location, content, rating, avatar_url
        FROM testimonials
        WHERE active = 1 AND tenant_id = ?
        ORDER BY sort_order ASC, id DESC
      `).bind(tenantId);

  const { results } = await stmt.all();

  return { testimonials: results || [] };
}

/**
 * [PUBLIC] جلب تقييمات منتج محدد داخل نطاق التاجر
 */
export async function getReviews(env, params, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const productId = parseInt(params.product_id || 0);
  if (!productId) return { reviews: [] };

  const isMaster = tenantId === DEFAULT_MASTER_TENANT_ID;
  const stmt = isMaster
    ? env.DB.prepare(`
        SELECT id, author_name, content, rating, image_url, created_at
        FROM reviews
        WHERE product_id = ? AND status = 'approved' AND (tenant_id = ? OR tenant_id IS NULL)
        ORDER BY id DESC
        LIMIT 50
      `).bind(productId, tenantId)
    : env.DB.prepare(`
        SELECT id, author_name, content, rating, image_url, created_at
        FROM reviews
        WHERE product_id = ? AND status = 'approved' AND tenant_id = ?
        ORDER BY id DESC
        LIMIT 50
      `).bind(productId, tenantId);

  const { results } = await stmt.all();

  return { reviews: results || [] };
}

/**
 * [PUBLIC] جلب الصفحات الظاهرة لمتجر التاجر
 */
export async function getPages(env, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const isMaster = tenantId === DEFAULT_MASTER_TENANT_ID;
  const stmt = isMaster
    ? env.DB.prepare(`
        SELECT slug, title, content
        FROM pages
        WHERE active = 1 AND (tenant_id = ? OR tenant_id IS NULL)
      `).bind(tenantId)
    : env.DB.prepare(`
        SELECT slug, title, content
        FROM pages
        WHERE active = 1 AND tenant_id = ?
      `).bind(tenantId);

  const { results } = await stmt.all();

  return { pages: results || [] };
}

/**
 * [PUBLIC] التحقق من صحة كوبون الخصم لمتجر التاجر
 */
export async function validateCoupon(env, params, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const code     = sanitize(params.coupon_code, 50).toUpperCase();
  const subtotal = sanitizeNumber(params.subtotal);

  if (!code) return { valid: false, error: 'كود الكوبون مطلوب' };

  const isMaster = tenantId === DEFAULT_MASTER_TENANT_ID;
  const stmt = isMaster
    ? env.DB.prepare(`
        SELECT id, code, discount_type, discount_value, min_order, max_uses, used_count, expires_at
        FROM coupons
        WHERE code = ? AND active = 1 AND (tenant_id = ? OR tenant_id IS NULL)
        LIMIT 1
      `).bind(code, tenantId)
    : env.DB.prepare(`
        SELECT id, code, discount_type, discount_value, min_order, max_uses, used_count, expires_at
        FROM coupons
        WHERE code = ? AND active = 1 AND tenant_id = ?
        LIMIT 1
      `).bind(code, tenantId);

  const coupon = await stmt.first();

  if (!coupon) return { valid: false, error: 'الكوبون غير موجود أو منتهي الصلاحية' };

  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
    return { valid: false, error: 'انتهت صلاحية هذا الكوبون' };
  }

  if (coupon.max_uses > 0 && coupon.used_count >= coupon.max_uses) {
    return { valid: false, error: 'تم استنفاد الكوبون بالكامل' };
  }

  if (coupon.min_order > 0 && subtotal < coupon.min_order) {
    return {
      valid: false,
      error: `الحد الأدنى للطلب لاستخدام هذا الكوبون هو ${coupon.min_order} دج`,
    };
  }

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
 * [ADMIN] قائمة جميع المنتجات لمتجر التاجر الموثق
 */
export async function adminListProducts(env, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const isMaster = tenantId === DEFAULT_MASTER_TENANT_ID;
  const stmt = isMaster
    ? env.DB.prepare(`
        SELECT * FROM products
        WHERE (tenant_id = ? OR tenant_id IS NULL)
        ORDER BY sort_order ASC, id DESC
      `).bind(tenantId)
    : env.DB.prepare(`
        SELECT * FROM products
        WHERE tenant_id = ?
        ORDER BY sort_order ASC, id DESC
      `).bind(tenantId);

  const { results } = await stmt.all();

  const products = (results || []).map(p => ({
    ...p,
    gallery_json:    safeParseJson(p.gallery_json,    []),
    variant_options: safeParseJson(p.variant_options, []),
    tags_json:       safeParseJson(p.tags_json,       []),
  }));

  return { products };
}

/**
 * [ADMIN] إضافة منتج جديد لمتجر التاجر الموثق
 */
export async function adminAddProduct(env, params, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const name    = sanitize(params.name, 300);
  if (!name) return { ok: false, error: 'اسم المنتج مطلوب' };

  const price   = sanitizeNumber(params.price);
  if (price <= 0) return { ok: false, error: 'سعر المنتج يجب أن يكون أكبر من صفر' };

  const variantOptions = serializeJson(params.variant_options, '[]');
  const galleryJson    = serializeJson(params.gallery_json,    '[]');
  const tagsJson       = serializeJson(params.tags_json,       '[]');
  const landingConfig  = JSON.stringify(normalizeLandingConfig(params.landing_config_json));
  const weight         = params.weight !== undefined && params.weight !== null && params.weight !== '' && !isNaN(Number(params.weight))
    ? Math.max(0, parseFloat(params.weight))
    : null;

  const result = await env.DB.prepare(`
    INSERT INTO products
      (tenant_id, name, description, description_long, price, price_old,
       image_url, gallery_json, variant_options, category,
       stock, active, sort_order, tags_json, sku, weight, landing_config_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    tenantId,
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
    weight,
    landingConfig,
  ).run();

  // مسح كاش المتجر المعني فقط
  if (env.CACHE) await env.CACHE.delete(`tenant:${tenantId}:catalog_v1`);

  return { ok: true, id: result.meta.last_row_id };
}

/**
 * [ADMIN] تعديل منتج مع التحقق من ملكية التاجر (IDOR Protection)
 */
export async function adminEditProduct(env, params, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const id = parseInt(params.id);
  if (!id) return { ok: false, error: 'معرّف المنتج (id) مطلوب' };

  const isMaster = tenantId === DEFAULT_MASTER_TENANT_ID;

  // التحقق الحصري من وجود المنتج داخل نطاق هذا التاجر
  const checkStmt = isMaster
    ? env.DB.prepare(`SELECT id FROM products WHERE id = ? AND (tenant_id = ? OR tenant_id IS NULL) LIMIT 1`).bind(id, tenantId)
    : env.DB.prepare(`SELECT id FROM products WHERE id = ? AND tenant_id = ? LIMIT 1`).bind(id, tenantId);

  const existing = await checkStmt.first();

  if (!existing) return { ok: false, error: 'المنتج غير موجود أو لا تملك صلاحية تعديله' };

  const weight = params.weight !== undefined && params.weight !== null && params.weight !== '' && !isNaN(Number(params.weight))
    ? Math.max(0, parseFloat(params.weight))
    : null;

  const updateStmt = isMaster
    ? env.DB.prepare(`
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
          weight           = ?,
          landing_config_json = ?,
          updated_at       = strftime('%Y-%m-%dT%H:%M:%SZ','now')
        WHERE id = ? AND (tenant_id = ? OR tenant_id IS NULL)
      `)
    : env.DB.prepare(`
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
          weight           = ?,
          landing_config_json = ?,
          updated_at       = strftime('%Y-%m-%dT%H:%M:%SZ','now')
        WHERE id = ? AND tenant_id = ?
      `);

  await updateStmt.bind(
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
    weight,
    JSON.stringify(normalizeLandingConfig(params.landing_config_json)),
    id,
    tenantId,
  ).run();

  if (env.CACHE) await env.CACHE.delete(`tenant:${tenantId}:catalog_v1`);

  return { ok: true };
}

/**
 * [ADMIN] حذف منتج مع التحقق من ملكية التاجر (IDOR Protection)
 */
export async function adminDeleteProduct(env, params, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const id = parseInt(params.id);
  if (!id) return { ok: false, error: 'معرّف المنتج (id) مطلوب' };

  const isMaster = tenantId === DEFAULT_MASTER_TENANT_ID;
  const deleteStmt = isMaster
    ? env.DB.prepare(`DELETE FROM products WHERE id = ? AND (tenant_id = ? OR tenant_id IS NULL)`).bind(id, tenantId)
    : env.DB.prepare(`DELETE FROM products WHERE id = ? AND tenant_id = ?`).bind(id, tenantId);

  const result = await deleteStmt.run();

  if (env.CACHE) await env.CACHE.delete(`tenant:${tenantId}:catalog_v1`);

  if (!result.meta.changes) {
    return { ok: false, error: 'المنتج غير موجود أو لا تملك صلاحية حذفه' };
  }

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

// ════════════════════════════════════════════════════════════
// Phase 7 — normalization/validation لإعدادات صفحة الهبوط
// ════════════════════════════════════════════════════════════

// الحدود القصوى المسموح بها داخل الإعدادات
const LP_FEATURES_MAX = 6;   // أقصى عدد ميزات
const LP_FAQ_MAX      = 10;  // أقصى عدد أسئلة شائعة

// القطاعات المسموح بها (أي مفتاح آخر يُتجاهَل)
const LP_SECTION_KEYS = [
  'hero', 'gallery', 'features', 'details',
  'reviews', 'faq', 'trust', 'form',
];

/** قصّ نص وتحديد طوله الأقصى */
function lpStr(value, max) {
  if (typeof value !== 'string') return '';
  return value.substring(0, max);
}

/** تحويل أي قيمة إلى boolean منطقي (افتراضي: true) */
function lpBool(value, fallback = true) {
  if (value === undefined || value === null) return fallback;
  return value === true || value === 'true' || value === 1 || value === '1';
}

/** التحقق من صحة لون الهكس #RRGGBB فقط (أي صيغة أخرى تُرفَض → '') */
function lpAccent(value) {
  if (typeof value !== 'string') return '';
  const v = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(v) ? v : '';
}

/**
 * قبول/تطبيع إعداد صفحة الهبوط القادم من الأدمن (يقبل نص JSON أو كائن فعلية).
 * يرفض الأنواع الخاطئة، يقصّ النصوص، يقصّ الميزات إلى 6 والأسئلة إلى 10،
 * ويتجاهل أي خصائص غير معروفة. الإدخال غير الصالح (JSON مكسور) → {}.
 * ملاحظة مهمة: لا يُستخدَم sanitize() هنا — يجب أن يحفظ JSON characters
 * مثل " < > وحروف عربية وأسطر جديدة كما هي (round-trip آمن).
 */
export function normalizeLandingConfig(input) {
  let raw = input;
  if (typeof raw === 'string' && raw.trim()) {
    try { raw = JSON.parse(raw); }
    catch { return {}; }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const out = {};

  // mode: auto | custom (غير ذلك → auto)
  out.mode = raw.mode === 'custom' ? 'custom' : 'auto';

  // sections: booleans للقطاعات الثمانية (افتراضي الكل مفعّل)
  const sections = {};
  for (const key of LP_SECTION_KEYS) {
    sections[key] = lpBool(raw.sections?.[key]);
  }
  out.sections = sections;

  // hero
  const h = (raw.hero && typeof raw.hero === 'object' && !Array.isArray(raw.hero)) ? raw.hero : {};
  out.hero = {
    headline:     lpStr(h.headline,     200),
    subtitle:     lpStr(h.subtitle,     400),
    cta_label:    lpStr(h.cta_label,     80),
    urgency_text: lpStr(h.urgency_text, 200),
    accent_color: lpAccent(h.accent_color),
  };

  // features
  const features = Array.isArray(raw.features) ? raw.features : [];
  out.features = features.slice(0, LP_FEATURES_MAX).map(f => {
    if (!f || typeof f !== 'object' || Array.isArray(f)) return null;
    return {
      icon:  lpStr(f.icon,  40),
      title: lpStr(f.title, 120),
      desc:  lpStr(f.desc,  300),
    };
  }).filter(Boolean);

  // faq
  const faq = Array.isArray(raw.faq) ? raw.faq : [];
  out.faq = faq.slice(0, LP_FAQ_MAX).map(f => {
    if (!f || typeof f !== 'object' || Array.isArray(f)) return null;
    return {
      q: lpStr(f.q, 300),
      a: lpStr(f.a, 1000),
    };
  }).filter(Boolean);

  // seo
  const seo = (raw.seo && typeof raw.seo === 'object' && !Array.isArray(raw.seo)) ? raw.seo : {};
  out.seo = {
    title:       lpStr(seo.title,       200),
    description: lpStr(seo.description, 400),
    image_url:   lpStr(seo.image_url,   500),
  };

  // whatsapp_text
  out.whatsapp_text = lpStr(raw.whatsapp_text, 800);

  // cost_price (سعر التكلفة والشراء بالجملة لحساب الأرباح وحماية العروض)
  if (raw.cost_price !== undefined && raw.cost_price !== null && raw.cost_price !== '' && !isNaN(Number(raw.cost_price))) {
    out.cost_price = Math.max(0, parseFloat(raw.cost_price));
  } else {
    out.cost_price = null;
  }

  return out;
}
