import { sanitize } from '../utils/sanitize.js';
import { DEFAULT_MASTER_TENANT_ID } from '../utils/auth.js';

function safeJsonParse(str, fallback = {}) {
  if (!str || typeof str !== 'string') return typeof str === 'object' && str !== null ? str : fallback;
  try {
    return JSON.parse(str);
  } catch (e) {
    return fallback;
  }
}

/**
 * [ADMIN] عرض كل الثيمات مع عزل التاجر
 */
export async function adminListThemes(env, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const isMaster = tenantId === DEFAULT_MASTER_TENANT_ID;

  // جرّب جلب الثيمات من جدول themes_v2 أولاً
  try {
    const stmt = isMaster
      ? env.DB.prepare(`SELECT id, tenant_id, name, title, description, version, author, base, extends, tokens_json, sections_json, presets_json, is_active, updated_at FROM themes_v2 WHERE (tenant_id = ? OR tenant_id IS NULL) ORDER BY is_active DESC, updated_at DESC`).bind(tenantId)
      : env.DB.prepare(`SELECT id, tenant_id, name, title, description, version, author, base, extends, tokens_json, sections_json, presets_json, is_active, updated_at FROM themes_v2 WHERE tenant_id = ? ORDER BY is_active DESC, updated_at DESC`).bind(tenantId);
    
    const { results } = await stmt.all();
    if (results && results.length > 0) {
      const themes = results.map(t => ({
        id: t.id,
        tenant_id: t.tenant_id,
        name: t.name,
        title: t.title || t.name,
        description: t.description || '',
        version: t.version || '1.0.0',
        author: t.author || '',
        base: t.base || 'light',
        extends: t.extends || null,
        tokens: safeJsonParse(t.tokens_json, {}),
        sections: safeJsonParse(t.sections_json, {}),
        presets: safeJsonParse(t.presets_json, []),
        is_active: Boolean(t.is_active),
        updated_at: t.updated_at
      }));
      return { ok: true, themes };
    }
  } catch (e) {
    // جدول themes_v2 غير مهيأ بعد، الانتقال للجدول السابق
  }

  // Fallback إلى جدول themes الكلاسيكي
  try {
    const fallbackStmt = isMaster
      ? env.DB.prepare(`SELECT id, name, config_json, updated_at FROM themes WHERE (tenant_id = ? OR tenant_id IS NULL) ORDER BY id DESC`).bind(tenantId)
      : env.DB.prepare(`SELECT id, name, config_json, updated_at FROM themes WHERE tenant_id = ? ORDER BY id DESC`).bind(tenantId);

    const { results } = await fallbackStmt.all();
    const themes = (results || []).map(t => ({
      id: String(t.id || t.name),
      name: t.name,
      title: t.name,
      config_json: safeJsonParse(t.config_json, {}),
      tokens: safeJsonParse(t.config_json, {}),
      updated_at: t.updated_at
    }));
    return { ok: true, themes };
  } catch (err) {
    return { ok: true, themes: [] };
  }
}

/**
 * [ADMIN] إضافة/تحديث ثيم
 */
export async function adminSaveTheme(env, params, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const rawName = sanitize(params.name, 100);
  if (!rawName) return { ok: false, error: 'اسم الثيم مطلوب' };

  let name = rawName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  if (!name) {
    name = 'theme_' + Date.now();
  }
  const title = sanitize(params.title || params.name, 150);
  const desc = sanitize(params.description || '', 500);
  const version = sanitize(params.version || '1.0.0', 20);
  const author = sanitize(params.author || '', 100);
  const base = params.base === 'dark' ? 'dark' : 'light';
  const extendsTheme = params.extends ? sanitize(params.extends, 100) : null;
  const isActive = params.is_active ? 1 : 0;
  const themeId = sanitize(params.id || name, 120);

  const tokensJson = typeof params.tokens === 'object' ? JSON.stringify(params.tokens) : (typeof params.tokens_json === 'string' ? params.tokens_json : (typeof params.config_json === 'string' ? params.config_json : '{}'));
  const sectionsJson = typeof params.sections === 'object' ? JSON.stringify(params.sections) : (typeof params.sections_json === 'string' ? params.sections_json : '{}');
  const presetsJson = typeof params.presets === 'object' ? JSON.stringify(params.presets) : (typeof params.presets_json === 'string' ? params.presets_json : '[]');

  // تحقق من صحة الـ JSON
  try { JSON.parse(tokensJson); } catch (e) { return { ok: false, error: 'تنسيق tokens_json غير صحيح' }; }
  try { JSON.parse(sectionsJson); } catch (e) { return { ok: false, error: 'تنسيق sections_json غير صحيح' }; }
  try { JSON.parse(presetsJson); } catch (e) { return { ok: false, error: 'تنسيق presets_json غير صحيح' }; }

  // 1. الحفظ في جدول themes_v2
  try {
    await env.DB.prepare(`
      INSERT INTO themes_v2 (
        id, tenant_id, name, title, description, version, author, base, extends,
        tokens_json, sections_json, presets_json, is_active, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        version = excluded.version,
        author = excluded.author,
        base = excluded.base,
        extends = excluded.extends,
        tokens_json = excluded.tokens_json,
        sections_json = excluded.sections_json,
        presets_json = excluded.presets_json,
        is_active = excluded.is_active,
        updated_at = excluded.updated_at
    `).bind(
      themeId, tenantId, name, title, desc, version, author, base, extendsTheme,
      tokensJson, sectionsJson, presetsJson, isActive
    ).run();
  } catch (e) {
    // إذا لم يكن themes_v2 منشأ بعد
  }

  // 2. الحفظ التوافقي في جدول themes الكلاسيكي
  try {
    await env.DB.prepare(`
      INSERT INTO themes (name, config_json, updated_at, tenant_id)
      VALUES (?, ?, CURRENT_TIMESTAMP, ?)
      ON CONFLICT(name) DO UPDATE SET
        config_json = excluded.config_json,
        updated_at = CURRENT_TIMESTAMP
    `).bind(name, tokensJson, tenantId).run();
  } catch (e) {}

  // تنظيف الكاش
  if (env.CACHE) {
    await env.CACHE.delete(`tenant:${tenantId}:settings_v1`).catch(() => {});
    await env.CACHE.delete(`tenant:${tenantId}:theme:${themeId}`).catch(() => {});
  }

  return { ok: true, message: 'تم حفظ الثيم بنجاح', theme_id: themeId };
}

/**
 * [ADMIN] حذف ثيم
 */
export async function adminDeleteTheme(env, params, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const name = sanitize(params.name || params.id, 100);
  if (!name) return { ok: false, error: 'اسم الثيم مطلوب' };

  // تأكد أنه ليس الثيم الافتراضي
  try {
    const activeThemeRow = await env.DB.prepare(
      `SELECT value FROM settings WHERE key = 'theme_default' AND (tenant_id = ? OR tenant_id IS NULL) LIMIT 1`
    ).bind(tenantId).first();

    if (activeThemeRow && (activeThemeRow.value === name || activeThemeRow.value === `theme_${name}`)) {
      return { ok: false, error: 'لا يمكن حذف الثيم النشط حالياً' };
    }
  } catch (e) {}

  try {
    await env.DB.prepare(`DELETE FROM themes_v2 WHERE (name = ? OR id = ?) AND tenant_id = ?`).bind(name, name, tenantId).run();
  } catch (e) {}

  try {
    await env.DB.prepare(`DELETE FROM themes WHERE name = ? AND tenant_id = ?`).bind(name, tenantId).run();
  } catch (e) {}

  return { ok: true, message: 'تم حذف الثيم' };
}

/**
 * [PUBLIC / ADMIN] حفظ إعدادات الأقسام لمنتج أو صفحة معينة
 */
export async function adminSaveThemeSections(env, params, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const targetType = ['global', 'product', 'page', 'collection'].includes(params.target_type) ? params.target_type : 'global';
  const targetId = sanitize(String(params.target_id || 'default'), 100);
  const themeId = params.theme_id ? sanitize(params.theme_id, 100) : null;
  
  let sectionsJson = '{}';
  if (params.sections) {
    sectionsJson = typeof params.sections === 'object' ? JSON.stringify(params.sections) : String(params.sections);
  } else if (params.sections_json) {
    sectionsJson = String(params.sections_json);
  }

  try {
    JSON.parse(sectionsJson);
  } catch (e) {
    return { ok: false, error: 'تنسيق sections_json غير صالح' };
  }

  await env.DB.prepare(`
    INSERT INTO theme_section_configs (tenant_id, target_type, target_id, theme_id, sections_json, updated_at)
    VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    ON CONFLICT(tenant_id, target_type, target_id) DO UPDATE SET
      theme_id = excluded.theme_id,
      sections_json = excluded.sections_json,
      updated_at = excluded.updated_at
  `).bind(tenantId, targetType, targetId, themeId, sectionsJson).run();

  if (env.CACHE) {
    await env.CACHE.delete(`tenant:${tenantId}:sections:${targetType}:${targetId}`).catch(() => {});
  }

  return { ok: true, message: 'تم حفظ إعدادات الأقسام بنجاح' };
}

/**
 * [PUBLIC / ADMIN] جلب إعدادات الأقسام لمنتج أو صفحة
 */
export async function getThemeSections(env, params, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const targetType = ['global', 'product', 'page', 'collection'].includes(params.target_type) ? params.target_type : 'global';
  const targetId = sanitize(String(params.target_id || params.product_id || 'default'), 100);

  const cacheKey = `tenant:${tenantId}:sections:${targetType}:${targetId}`;
  if (env.CACHE) {
    try {
      const cached = await env.CACHE.get(cacheKey, { type: 'json' });
      if (cached) return { ok: true, config: cached };
    } catch (e) {}
  }

  try {
    const row = await env.DB.prepare(`
      SELECT target_type, target_id, theme_id, sections_json, updated_at
      FROM theme_section_configs
      WHERE tenant_id = ? AND target_type = ? AND target_id = ?
      LIMIT 1
    `).bind(tenantId, targetType, targetId).first();

    if (row) {
      const config = {
        target_type: row.target_type,
        target_id: row.target_id,
        theme_id: row.theme_id,
        sections: safeJsonParse(row.sections_json, {}),
        updated_at: row.updated_at
      };

      if (env.CACHE) {
        env.CACHE.put(cacheKey, JSON.stringify(config), { expirationTtl: 300 }).catch(() => {});
      }

      return { ok: true, config };
    }
  } catch (e) {}

  return { ok: true, config: null };
}
