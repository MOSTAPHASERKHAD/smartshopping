import { sanitize, sanitizePhone } from '../utils/sanitize.js';
import {
  hashCustomerPasswordS1, verifyCustomerPassword,
  issueCustomerSession, validateCustomerToken, revokeCustomerSession,
  DEFAULT_MASTER_TENANT_ID,
} from '../utils/auth.js';

/**
 * [PUBLIC] تسجيل عميل جديد مع عزل التاجر
 */
export async function customerRegister(env, params, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const phone = sanitizePhone(params.phone);
  const password = params.password;
  const name = sanitize(params.name, 100);
  
  if (!phone || phone.length < 9) return { ok: false, error: 'رقم الهاتف غير صالح' };
  if (!password || password.length < 6) return { ok: false, error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' };
  
  // تحقق من عدم وجود الحساب مسبقاً داخل متجر هذا التاجر
  const existing = await env.DB.prepare(
    `SELECT id FROM customers WHERE phone = ? AND (tenant_id = ? OR tenant_id IS NULL) LIMIT 1`
  ).bind(phone, tenantId).first();
  if (existing) return { ok: false, error: 'رقم الهاتف مستخدم مسبقاً في هذا المتجر' };
  
  const passwordHash = await hashCustomerPasswordS1(password);
  
  const result = await env.DB.prepare(`
    INSERT INTO customers (tenant_id, phone, name, password_hash) VALUES (?, ?, ?, ?)
  `).bind(tenantId, phone, name, passwordHash).run();
  
  if (result.success) {
    const customerId = result.meta.last_row_id;
    const token = await issueCustomerSession(env.DB, customerId);
    const customer = await env.DB.prepare(`
      SELECT id, phone, name, wilaya_code, wilaya_ar, wilaya_en, municipality, delivery_type, created_at
      FROM customers WHERE id = ? LIMIT 1
    `).bind(customerId).first();
    
    return { ok: true, customer, token, message: 'تم التسجيل بنجاح' };
  }
  
  return { ok: false, error: 'حدث خطأ أثناء التسجيل' };
}

/**
 * [PUBLIC] تسجيل دخول العميل مع عزل التاجر
 */
export async function customerLogin(env, params, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const phone = sanitizePhone(params.phone);
  const password = params.password;
  
  if (!phone || !password) return { ok: false, error: 'رقم الهاتف وكلمة المرور مطلوبة' };
  
  const customer = await env.DB.prepare(`
    SELECT id, phone, password_hash FROM customers WHERE phone = ? AND (tenant_id = ? OR tenant_id IS NULL) LIMIT 1
  `).bind(phone, tenantId).first();
  
  if (!customer) return { ok: false, error: 'بيانات الدخول غير صحيحة' };
  
  const verify = await verifyCustomerPassword(password, customer.phone, customer.password_hash, env);

  if (!verify.ok) return { ok: false, error: 'بيانات الدخول غير صحيحة' };

  if (verify.needsUpgrade) {
    const newHash = await hashCustomerPasswordS1(password);
    await env.DB.prepare(
      `UPDATE customers SET password_hash = ? WHERE id = ?`
    ).bind(newHash, customer.id).run();
  }
  
  const token = await issueCustomerSession(env.DB, customer.id);
  const customerData = await env.DB.prepare(`
    SELECT id, phone, name, wilaya_code, wilaya_ar, wilaya_en, municipality, delivery_type, created_at
    FROM customers WHERE id = ? LIMIT 1
  `).bind(customer.id).first();
  
  return { ok: true, customer: customerData, token, message: 'تم تسجيل الدخول بنجاح' };
}

/**
 * [CUSTOMER] الملف الشخصي للعميل
 */
export async function customerProfile(env, token, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const customerId = await validateCustomerToken(env.DB, token);
  if (!customerId) return { ok: false, error: { code: 'UNAUTHORIZED', message: 'يرجى تسجيل الدخول' } };
  
  const customer = await env.DB.prepare(`
    SELECT id, phone, name, wilaya_code, wilaya_ar, wilaya_en, municipality, delivery_type, created_at
    FROM customers WHERE id = ? AND (tenant_id = ? OR tenant_id IS NULL) LIMIT 1
  `).bind(customerId, tenantId).first();
  
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
 * [ADMIN] عرض العملاء لمتجر التاجر الموثق
 */
export async function adminListCustomers(env, params, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const page = Math.max(1, parseInt(params.page) || 1);
  const limit = Math.max(1, parseInt(params.limit) || 20);
  const offset = (page - 1) * limit;
  const search = sanitize(params.search, 50) || '';
  
  let query = `SELECT id, phone, name, wilaya_ar, created_at FROM customers WHERE (tenant_id = ? OR tenant_id IS NULL)`;
  let countQuery = `SELECT COUNT(*) as total FROM customers WHERE (tenant_id = ? OR tenant_id IS NULL)`;
  const queryParams = [tenantId];
  
  if (search) {
    query += ` AND (phone LIKE ? OR name LIKE ?)`;
    countQuery += ` AND (phone LIKE ? OR name LIKE ?)`;
    queryParams.push(`%${search}%`, `%${search}%`);
  }
  
  query += ` ORDER BY id DESC LIMIT ? OFFSET ?`;
  const countParams = [...queryParams];
  queryParams.push(limit, offset);
  
  const [countRes, rowsRes] = await env.DB.batch([
    env.DB.prepare(countQuery).bind(...countParams),
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
