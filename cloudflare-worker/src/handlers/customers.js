import { sanitize, sanitizePhone } from '../utils/sanitize.js';
import { sha256, issueCustomerSession, validateCustomerToken, revokeCustomerSession } from '../utils/auth.js';

/**
 * [PUBLIC] تسجيل عميل جديد
 */
export async function customerRegister(env, params) {
  const phone = sanitizePhone(params.phone);
  const password = params.password;
  const name = sanitize(params.name, 100);
  
  if (!phone || phone.length < 9) return { ok: false, error: 'رقم الهاتف غير صالح' };
  if (!password || password.length < 6) return { ok: false, error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' };
  
  // تحقق من عدم وجود الحساب مسبقاً
  const existing = await env.DB.prepare(`SELECT id FROM customers WHERE phone = ? LIMIT 1`).bind(phone).first();
  if (existing) return { ok: false, error: 'رقم الهاتف مستخدم مسبقاً' };
  
  const passwordHash = await sha256(password);
  
  const result = await env.DB.prepare(`
    INSERT INTO customers (phone, name, password_hash) VALUES (?, ?, ?)
  `).bind(phone, name, passwordHash).run();
  
  if (result.success) {
    const customerId = result.meta.last_row_id;
    const token = await issueCustomerSession(env.DB, customerId);
    return { ok: true, token, message: 'تم التسجيل بنجاح' };
  }
  
  return { ok: false, error: 'حدث خطأ أثناء التسجيل' };
}

/**
 * [PUBLIC] تسجيل دخول العميل
 */
export async function customerLogin(env, params) {
  const phone = sanitizePhone(params.phone);
  const password = params.password;
  
  if (!phone || !password) return { ok: false, error: 'رقم الهاتف وكلمة المرور مطلوبة' };
  
  // Anti brute-force للعملاء: يمكن تنفيذه بجدول settings برقم الهاتف أو الاكتفاء بالرد البسيط
  const customer = await env.DB.prepare(`
    SELECT id, password_hash FROM customers WHERE phone = ? LIMIT 1
  `).bind(phone).first();
  
  if (!customer) return { ok: false, error: 'بيانات الدخول غير صحيحة' };
  
  const inputHash = await sha256(password);
  if (inputHash !== customer.password_hash) {
    return { ok: false, error: 'بيانات الدخول غير صحيحة' };
  }
  
  const token = await issueCustomerSession(env.DB, customer.id);
  return { ok: true, token, message: 'تم تسجيل الدخول بنجاح' };
}

/**
 * [CUSTOMER] الملف الشخصي للعميل
 */
export async function customerProfile(env, token) {
  const customerId = await validateCustomerToken(env.DB, token);
  if (!customerId) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'يرجى تسجيل الدخول' } };
  
  const customer = await env.DB.prepare(`
    SELECT id, phone, name, wilaya_code, wilaya_ar, wilaya_en, municipality, delivery_type, created_at
    FROM customers WHERE id = ? LIMIT 1
  `).bind(customerId).first();
  
  if (!customer) return { ok: false, error: 'الحساب غير موجود' };
  
  return { ok: true, customer };
}

/**
 * [CUSTOMER] تسجيل الخروج
 */
export async function customerLogout(env, token) {
  if (token) await revokeCustomerSession(env.DB, token);
  return { ok: true, message: 'تم تسجيل الخروج' };
}

/**
 * [ADMIN] عرض العملاء
 */
export async function adminListCustomers(env, params) {
  const page = Math.max(1, parseInt(params.page) || 1);
  const limit = Math.max(1, parseInt(params.limit) || 20);
  const offset = (page - 1) * limit;
  const search = sanitize(params.search, 50) || '';
  
  let query = `SELECT id, phone, name, wilaya_ar, created_at FROM customers`;
  let countQuery = `SELECT COUNT(*) as total FROM customers`;
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
    customers: rowsRes.results,
    pagination: {
      total: countRes.results[0].total,
      page,
      limit,
      total_pages: Math.ceil(countRes.results[0].total / limit)
    }
  };
}
