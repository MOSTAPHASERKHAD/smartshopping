import { sanitize, sanitizePhone } from '../utils/sanitize.js';

/**
 * [PUBLIC] اشتراك في القائمة البريدية/SMS
 */
export async function newsletterSubscribe(env, params) {
  const phone = sanitizePhone(params.phone);
  const name = sanitize(params.name, 100);

  if (!phone || phone.length < 9) {
    return { ok: false, error: 'رقم الهاتف غير صالح' };
  }

  try {
    await env.DB.prepare(`
      INSERT INTO subscribers (phone, name) VALUES (?, ?)
      ON CONFLICT(phone) DO UPDATE SET active = 1
    `).bind(phone, name).run();

    return { ok: true, message: 'تم الاشتراك بنجاح' };
  } catch (err) {
    return { ok: false, error: 'حدث خطأ أثناء الاشتراك' };
  }
}

/**
 * [ADMIN] عرض قائمة المشتركين
 */
export async function adminListSubscribers(env, params) {
  const page = Math.max(1, parseInt(params.page) || 1);
  const limit = Math.max(1, parseInt(params.limit) || 50);
  const offset = (page - 1) * limit;
  const search = sanitize(params.search, 50) || '';

  let query = `SELECT id, phone, name, active, created_at FROM subscribers`;
  let countQuery = `SELECT COUNT(*) as total FROM subscribers`;
  const queryParams = [];

  if (search) {
    query += ` WHERE phone LIKE ? OR name LIKE ?`;
    countQuery += ` WHERE phone LIKE ? OR name LIKE ?`;
    queryParams.push(`%${search}%`, `%${search}%`);
  }

  query += ` ORDER BY id DESC LIMIT ? OFFSET ?`;
  queryParams.push(limit, offset);

  const [countRes, rowsRes] = await env.DB.batch([
    env.DB.prepare(countQuery).bind(...queryParams.slice(0, -2)),
    env.DB.prepare(query).bind(...queryParams)
  ]);

  return {
    ok: true,
    subscribers: rowsRes.results,
    pagination: {
      total: countRes.results[0].total,
      page,
      limit,
      total_pages: Math.ceil(countRes.results[0].total / limit)
    }
  };
}
