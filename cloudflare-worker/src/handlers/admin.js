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
  DEFAULT_MASTER_TENANT_ID,
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
 * [ADMIN] تحديث إعدادات المتجر مع عزل التاجر
 */
export async function adminUpdateSettings(env, params, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const IMMUTABLE_KEYS = new Set([
    'login_fails', 'login_blocked_until',
    'admin_password_hash',
    'admin_recovery_code',
  ]);

  const updates = [];

  for (const [key, value] of Object.entries(params)) {
    if (['action', 'token'].includes(key)) continue;
    if (IMMUTABLE_KEYS.has(key)) continue;

    const cleanKey   = sanitize(key,   100);
    const maxLen     = (cleanKey === 'shipping_config' || cleanKey === 'custom_css' || cleanKey === 'ai_prompt') ? 100000 : 5000;
    let   cleanValue = sanitize(value, maxLen);

    if (cleanKey === 'admin_password' && cleanValue) {
      cleanValue = await sha256(cleanValue);
      updates.push([
        `INSERT INTO settings(tenant_id, key, value, updated_at) VALUES(?, 'admin_password_hash', ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
         ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [tenantId, cleanValue],
      ]);
      continue;
    }

    updates.push([
      `INSERT INTO settings(tenant_id, key, value, updated_at) VALUES(?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
       ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [tenantId, cleanKey, cleanValue],
    ]);
  }

  for (const [sql, args] of updates) {
    await env.DB.prepare(sql).bind(...args).run();
  }

  if (env.CACHE) await env.CACHE.delete(`tenant:${tenantId}:settings_v1`);

  return { ok: true };
}

// ─────────────────────────────────────────────
// ── الكوبونات (Coupons CRUD) ──
// ─────────────────────────────────────────────

/**
 * [ADMIN] قائمة الكوبونات داخل متجر التاجر الموثق
 */
export async function adminListCoupons(env, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const isMaster = tenantId === DEFAULT_MASTER_TENANT_ID;
  const stmt = isMaster
    ? env.DB.prepare(`SELECT * FROM coupons WHERE (tenant_id = ? OR tenant_id IS NULL) ORDER BY id DESC`).bind(tenantId)
    : env.DB.prepare(`SELECT * FROM coupons WHERE tenant_id = ? ORDER BY id DESC`).bind(tenantId);
  const { results } = await stmt.all();

  return { coupons: results };
}

/**
 * [ADMIN] إضافة كوبون جديد داخل متجر التاجر الموثق
 */
export async function adminAddCoupon(env, params, tenantId = DEFAULT_MASTER_TENANT_ID) {
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
      INSERT INTO coupons (tenant_id, code, discount_type, discount_value, min_order, max_uses, expires_at, active)
      VALUES (?,?,?,?,?,?,?,?)
    `).bind(
      tenantId,
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
      return { ok: false, error: 'هذا الكود موجود مسبقاً في متجرك' };
    }
    throw e;
  }
}

/**
 * [ADMIN] تعديل كوبون مع التحقق من الملكية
 */
export async function adminEditCoupon(env, params, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const id = parseInt(params.id);
  if (!id) return { ok: false, error: 'معرّف الكوبون مطلوب' };

  const isMaster = tenantId === DEFAULT_MASTER_TENANT_ID;
  const stmt = isMaster
    ? env.DB.prepare(`
        UPDATE coupons SET
          code           = ?,
          discount_type  = ?,
          discount_value = ?,
          min_order      = ?,
          max_uses       = ?,
          expires_at     = ?,
          active         = ?
        WHERE id = ? AND (tenant_id = ? OR tenant_id IS NULL)
      `).bind(
        sanitize(params.code, 50).toUpperCase(),
        params.discount_type === 'fixed' ? 'fixed' : 'percent',
        sanitizeNumber(params.discount_value),
        sanitizeNumber(params.min_order),
        parseInt(params.max_uses ?? 0),
        params.expires_at ? sanitize(params.expires_at, 30) : null,
        params.active === '0' ? 0 : 1,
        id,
        tenantId,
      )
    : env.DB.prepare(`
        UPDATE coupons SET
          code           = ?,
          discount_type  = ?,
          discount_value = ?,
          min_order      = ?,
          max_uses       = ?,
          expires_at     = ?,
          active         = ?
        WHERE id = ? AND tenant_id = ?
      `).bind(
        sanitize(params.code, 50).toUpperCase(),
        params.discount_type === 'fixed' ? 'fixed' : 'percent',
        sanitizeNumber(params.discount_value),
        sanitizeNumber(params.min_order),
        parseInt(params.max_uses ?? 0),
        params.expires_at ? sanitize(params.expires_at, 30) : null,
        params.active === '0' ? 0 : 1,
        id,
        tenantId,
      );

  const result = await stmt.run();

  if (!result.meta.changes) {
    return { ok: false, error: 'الكوبون غير موجود أو لا تملك صلاحية تعديله' };
  }

  return { ok: true };
}

/**
 * [ADMIN] حذف كوبون مع التحقق من الملكية
 */
export async function adminDeleteCoupon(env, params, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const id = parseInt(params.id);
  if (!id) return { ok: false, error: 'معرّف الكوبون مطلوب' };

  const isMaster = tenantId === DEFAULT_MASTER_TENANT_ID;
  const stmt = isMaster
    ? env.DB.prepare(`DELETE FROM coupons WHERE id = ? AND (tenant_id = ? OR tenant_id IS NULL)`).bind(id, tenantId)
    : env.DB.prepare(`DELETE FROM coupons WHERE id = ? AND tenant_id = ?`).bind(id, tenantId);

  const result = await stmt.run();

  if (!result.meta.changes) {
    return { ok: false, error: 'الكوبون غير موجود أو لا تملك صلاحية حذفه' };
  }

  return { ok: true };
}

// ─────────────────────────────────────────────
// ── الشهادات (Testimonials CRUD) ──
// ─────────────────────────────────────────────

export async function adminListTestimonials(env, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const isMaster = tenantId === DEFAULT_MASTER_TENANT_ID;
  const stmt = isMaster
    ? env.DB.prepare(`SELECT * FROM testimonials WHERE (tenant_id = ? OR tenant_id IS NULL) ORDER BY sort_order ASC, id DESC`).bind(tenantId)
    : env.DB.prepare(`SELECT * FROM testimonials WHERE tenant_id = ? ORDER BY sort_order ASC, id DESC`).bind(tenantId);
  const { results } = await stmt.all();
  return { testimonials: results };
}

export async function adminAddTestimonial(env, params, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const authorName = sanitize(params.author_name, 200);
  const content    = sanitize(params.content,     2000);
  if (!authorName || !content) {
    return { ok: false, error: 'الاسم والمحتوى مطلوبان' };
  }

  const result = await env.DB.prepare(`
    INSERT INTO testimonials (tenant_id, author_name, author_location, content, rating, avatar_url, active, sort_order)
    VALUES (?,?,?,?,?,?,?,?)
  `).bind(
    tenantId,
    authorName,
    sanitize(params.author_location, 100),
    content,
    Math.min(5, Math.max(1, parseInt(params.rating ?? 5))),
    sanitize(params.avatar_url, 500),
    params.active === '0' ? 0 : 1,
    parseInt(params.sort_order ?? 0),
  ).run();

  return { ok: true, id: result.meta.last_row_id };
}

export async function adminEditTestimonial(env, params, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const id = parseInt(params.id);
  if (!id) return { ok: false, error: 'المعرّف مطلوب' };

  const isMaster = tenantId === DEFAULT_MASTER_TENANT_ID;
  const stmt = isMaster
    ? env.DB.prepare(`
        UPDATE testimonials SET
          author_name     = ?,
          author_location = ?,
          content         = ?,
          rating          = ?,
          avatar_url      = ?,
          active          = ?,
          sort_order      = ?
        WHERE id = ? AND (tenant_id = ? OR tenant_id IS NULL)
      `).bind(
        sanitize(params.author_name,     200),
        sanitize(params.author_location, 100),
        sanitize(params.content,         2000),
        Math.min(5, Math.max(1, parseInt(params.rating ?? 5))),
        sanitize(params.avatar_url, 500),
        params.active === '0' ? 0 : 1,
        parseInt(params.sort_order ?? 0),
        id,
        tenantId,
      )
    : env.DB.prepare(`
        UPDATE testimonials SET
          author_name     = ?,
          author_location = ?,
          content         = ?,
          rating          = ?,
          avatar_url      = ?,
          active          = ?,
          sort_order      = ?
        WHERE id = ? AND tenant_id = ?
      `).bind(
        sanitize(params.author_name,     200),
        sanitize(params.author_location, 100),
        sanitize(params.content,         2000),
        Math.min(5, Math.max(1, parseInt(params.rating ?? 5))),
        sanitize(params.avatar_url, 500),
        params.active === '0' ? 0 : 1,
        parseInt(params.sort_order ?? 0),
        id,
        tenantId,
      );

  const result = await stmt.run();

  if (!result.meta.changes) {
    return { ok: false, error: 'الشهادة غير موجودة أو لا تملك صلاحية تعديلها' };
  }

  return { ok: true };
}

export async function adminDeleteTestimonial(env, params, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const id = parseInt(params.id);
  if (!id) return { ok: false, error: 'المعرّف مطلوب' };

  const isMaster = tenantId === DEFAULT_MASTER_TENANT_ID;
  const stmt = isMaster
    ? env.DB.prepare(`DELETE FROM testimonials WHERE id = ? AND (tenant_id = ? OR tenant_id IS NULL)`).bind(id, tenantId)
    : env.DB.prepare(`DELETE FROM testimonials WHERE id = ? AND tenant_id = ?`).bind(id, tenantId);

  const result = await stmt.run();

  if (!result.meta.changes) {
    return { ok: false, error: 'الشهادة غير موجودة أو لا تملك صلاحية حذفها' };
  }

  return { ok: true };
}

// ─────────────────────────────────────────────
// ── التقييمات (Reviews Admin) ──
// ─────────────────────────────────────────────

export async function adminListReviews(env, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const isMaster = tenantId === DEFAULT_MASTER_TENANT_ID;
  const stmt = isMaster
    ? env.DB.prepare(`
        SELECT r.*, p.name as product_name
        FROM reviews r
        LEFT JOIN products p ON r.product_id = p.id
        WHERE (r.tenant_id = ? OR r.tenant_id IS NULL)
        ORDER BY r.id DESC
      `).bind(tenantId)
    : env.DB.prepare(`
        SELECT r.*, p.name as product_name
        FROM reviews r
        LEFT JOIN products p ON r.product_id = p.id
        WHERE r.tenant_id = ?
        ORDER BY r.id DESC
      `).bind(tenantId);

  const { results } = await stmt.all();
  return { reviews: results };
}

export async function adminDeleteReview(env, params, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const id = parseInt(params.id);
  if (!id) return { ok: false, error: 'المعرّف مطلوب' };

  const isMaster = tenantId === DEFAULT_MASTER_TENANT_ID;
  const stmt = isMaster
    ? env.DB.prepare(`DELETE FROM reviews WHERE id = ? AND (tenant_id = ? OR tenant_id IS NULL)`).bind(id, tenantId)
    : env.DB.prepare(`DELETE FROM reviews WHERE id = ? AND tenant_id = ?`).bind(id, tenantId);

  const result = await stmt.run();

  if (!result.meta.changes) {
    return { ok: false, error: 'التقييم غير موجود أو لا تملك صلاحية حذفه' };
  }

  return { ok: true };
}

export async function adminApproveReview(env, params, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const id     = parseInt(params.id);
  const status = params.status === 'rejected' ? 'rejected' : 'approved';
  if (!id) return { ok: false, error: 'المعرّف مطلوب' };

  const isMaster = tenantId === DEFAULT_MASTER_TENANT_ID;
  const stmt = isMaster
    ? env.DB.prepare(`UPDATE reviews SET status = ? WHERE id = ? AND (tenant_id = ? OR tenant_id IS NULL)`).bind(status, id, tenantId)
    : env.DB.prepare(`UPDATE reviews SET status = ? WHERE id = ? AND tenant_id = ?`).bind(status, id, tenantId);

  const result = await stmt.run();

  if (!result.meta.changes) {
    return { ok: false, error: 'التقييم غير موجود أو لا تملك صلاحية تعديله' };
  }

  return { ok: true };
}

// ─────────────────────────────────────────────
// ── الصفحات المخصصة (Pages) ──
// ─────────────────────────────────────────────

export async function adminListPages(env, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const isMaster = tenantId === DEFAULT_MASTER_TENANT_ID;
  const stmt = isMaster
    ? env.DB.prepare(`SELECT id, slug, title, active, updated_at FROM pages WHERE (tenant_id = ? OR tenant_id IS NULL) ORDER BY id`).bind(tenantId)
    : env.DB.prepare(`SELECT id, slug, title, active, updated_at FROM pages WHERE tenant_id = ? ORDER BY id`).bind(tenantId);
  const { results } = await stmt.all();
  return { pages: results };
}

export async function adminSavePage(env, params, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const slug    = sanitize(params.slug,  100).toLowerCase().replace(/\s+/g, '-');
  const title   = sanitize(params.title, 300);
  const content = params.content ? String(params.content).substring(0, 50000) : '';

  if (!slug || !title) return { ok: false, error: 'الـ slug والعنوان مطلوبان' };

  await env.DB.prepare(`
    INSERT INTO pages (tenant_id, slug, title, content, active, updated_at)
    VALUES (?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    ON CONFLICT(tenant_id, slug) DO UPDATE SET
      title      = excluded.title,
      content    = excluded.content,
      active     = excluded.active,
      updated_at = excluded.updated_at
  `).bind(
    tenantId, slug, title, content,
    params.active === '0' ? 0 : 1,
  ).run();

  return { ok: true };
}

// ─────────────────────────────────────────────
// ── الثيمات (Themes Admin) ──
// ─────────────────────────────────────────────

export async function adminListThemes(env, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const { results } = await env.DB.prepare(
    `SELECT id, name, label, is_system, updated_at FROM themes WHERE (tenant_id = ? OR tenant_id IS NULL) ORDER BY id`
  ).bind(tenantId).all();
  return { themes: results };
}

export async function adminSaveTheme(env, params, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const name  = sanitize(params.name, 100).toLowerCase().replace(/\s+/g, '_');
  const label = sanitize(params.label, 200) || name;
  const configJson = typeof params.config === 'object' ? JSON.stringify(params.config) : (params.config || '{}');

  if (!name) return { ok: false, error: 'اسم الثيم مطلوب' };

  await env.DB.prepare(`
    INSERT INTO themes (tenant_id, name, label, config_json, updated_at)
    VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    ON CONFLICT(tenant_id, name) DO UPDATE SET
      label       = excluded.label,
      config_json = excluded.config_json,
      updated_at  = excluded.updated_at
  `).bind(tenantId, name, label, configJson).run();

  return { ok: true };
}

export async function adminDeleteTheme(env, params, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const name = sanitize(params.name, 100);
  if (!name) return { ok: false, error: 'اسم الثيم مطلوب' };

  const result = await env.DB.prepare(
    `DELETE FROM themes WHERE name = ? AND (tenant_id = ? OR tenant_id IS NULL) AND is_system = 0`
  ).bind(name, tenantId).run();

  if (!result.meta.changes) {
    return { ok: false, error: 'لا يمكن حذف هذا الثيم أو أنه غير موجود' };
  }

  return { ok: true };
}

// ─────────────────────────────────────────────
// ── سجل التدقيق (Audit Logs) ──
// ─────────────────────────────────────────────

export async function adminListAuditLogs(env, params = {}, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const limit  = Math.min(100, Math.max(1, parseInt(params.limit ?? 50)));
  const { results } = await env.DB.prepare(`
    SELECT id, user_id, action, resource_type, resource_id, ip_hash, user_agent, metadata_json, created_at
    FROM audit_logs
    WHERE tenant_id = ?
    ORDER BY id DESC
    LIMIT ?
  `).bind(tenantId, limit).all();

  return { ok: true, logs: results };
}
