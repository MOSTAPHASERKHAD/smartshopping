import { sanitize } from '../utils/sanitize.js';

/**
 * [ADMIN] عرض كل الثيمات
 */
export async function adminListThemes(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, name, config_json, updated_at FROM themes ORDER BY id DESC`
  ).all();

  const themes = results.map(t => ({
    ...t,
    config_json: JSON.parse(t.config_json || '{}')
  }));

  return { ok: true, themes };
}

/**
 * [ADMIN] إضافة/تحديث ثيم
 */
export async function adminSaveTheme(env, params) {
  const name = sanitize(params.name, 100);
  if (!name) return { ok: false, error: 'اسم الثيم مطلوب' };

  let configJson = '{}';
  if (params.config_json) {
    try {
      JSON.parse(params.config_json); // التحقق من صحة JSON
      configJson = params.config_json;
    } catch (e) {
      return { ok: false, error: 'تنسيق config_json غير صحيح' };
    }
  }

  // استخدم INSERT OR REPLACE بحيث يكون id تلقائيًا إذا لم يكن موجودًا
  // أو نقوم بالتحديث بناءً على الاسم (لأنه UNIQUE)
  await env.DB.prepare(`
    INSERT INTO themes (name, config_json, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(name) DO UPDATE SET config_json = excluded.config_json, updated_at = CURRENT_TIMESTAMP
  `).bind(name, configJson).run();

  // تنظيف الكاش لأن الإعدادات قد تتغير إذا كان هذا هو الثيم النشط
  if (env.CACHE) {
    await env.CACHE.delete('settings_v1');
  }

  return { ok: true, message: 'تم حفظ الثيم بنجاح' };
}

/**
 * [ADMIN] حذف ثيم
 */
export async function adminDeleteTheme(env, params) {
  const name = sanitize(params.name, 100);
  if (!name) return { ok: false, error: 'اسم الثيم مطلوب' };

  // تأكد أنه ليس الثيم الافتراضي
  const activeThemeRow = await env.DB.prepare(
    `SELECT value FROM settings WHERE key = 'theme_default' LIMIT 1`
  ).first();

  if (activeThemeRow && activeThemeRow.value === name) {
    return { ok: false, error: 'لا يمكن حذف الثيم النشط حالياً' };
  }

  await env.DB.prepare(`DELETE FROM themes WHERE name = ?`).bind(name).run();

  return { ok: true, message: 'تم حذف الثيم' };
}
