/**
 * Smart Shopping — Cloudflare Worker
 * ملف: src/handlers/orders.js
 * 
 * معالجات الطلبات (Orders)
 * ─────────────────────────────────────────────
 * Public:
 *   createOrder()      → action=order
 *   trackOrder()       → action=track
 *   customerOrders()   → action=customer_orders
 * 
 * Admin (تتطلب token):
 *   adminListOrders()  → action=admin_orders
 *   adminUpdateOrder() → action=admin_update_order
 *   adminDeleteOrder() → action=admin_delete_order
 */

import { sendCapiEvent } from './marketing.js';

import {
  sanitize,
  sanitizePhone,
  sanitizeNumber,
  sanitizeOrderItems,
  generateOrderId,
  formatAlgeriaTime,
} from '../utils/sanitize.js';
import { orderSpamGuard } from '../utils/auth.js';

// ─────────────────────────────────────────────
// ── معالجات العامة (Public Handlers) ──
// ─────────────────────────────────────────────

/**
 * [PUBLIC] إنشاء طلب جديد
 * يُحاكي createOrder() في GAS مع نفس التحقق والتنظيف
 * 
 * البيانات المطلوبة:
 *   name, phone, items_json, subtotal,
 *   wilaya_ar, wilaya_en, wilaya_code,
 *   municipality, delivery_type
 * 
 * البيانات الاختيارية:
 *   note, coupon_code, utm_source, utm_medium, utm_campaign
 */
export async function createOrder(env, params, request, ctx) {
  // ── التحقق من الحقول المطلوبة ──
  const name  = sanitize(params.name,  200);
  const phone = sanitizePhone(params.phone);

  if (!name)  return { ok: false, error: 'الاسم مطلوب' };
  if (!phone) return { ok: false, error: 'رقم الهاتف مطلوب' };
  if (phone.length < 9) return { ok: false, error: 'رقم الهاتف غير صالح' };

  // ── حماية spam: 60 ثانية بين طلبات من نفس الرقم ──
  const allowed = await orderSpamGuard(env.DB, phone);
  if (!allowed) {
    return { ok: false, error: 'يرجى الانتظار قليلاً قبل إرسال طلب آخر' };
  }

  // ── تنظيف جميع الحقول ──
  const wilayaAr    = sanitize(params.wilaya_ar,    100);
  const wilayaEn    = sanitize(params.wilaya_en,    100);
  const wilayaCode  = sanitize(params.wilaya_code,  20);
  const municipality= sanitize(params.municipality, 200);
  const deliveryType= sanitize(params.delivery_type,20) || 'home';
  const note        = sanitize(params.note,         500);
  const subtotal    = sanitizeNumber(params.subtotal);
  const utmSource   = sanitize(params.utm_source,   100);
  const utmMedium   = sanitize(params.utm_medium,   100);
  const utmCampaign = sanitize(params.utm_campaign, 100);
  const couponCode  = sanitize(params.coupon_code,  50).toUpperCase();

  // تنظيف العناصر (يقتل XSS المخزَّن)
  const itemsJson = sanitizeOrderItems(params.items_json);

  // تحقق من أن السلة غير فارغة
  let itemsArr = [];
  try { itemsArr = JSON.parse(itemsJson); } catch { /* فارغة */ }
  if (!Array.isArray(itemsArr) || !itemsArr.length) return { ok: false, error: 'السلة فارغة' };

  // ── 🔒 الحماية: حساب السعر من قاعدة البيانات ──
  const productIds = itemsArr.map(item => Number(item.id)).filter(id => !isNaN(id));
  if (!productIds.length) return { ok: false, error: 'بيانات السلة غير صالحة' };

  // استخراج المنتجات الحقيقية (D1 SQLite لا يدعم مصفوفات مباشرة في IN، سنستخدم ?)
  const placeholders = productIds.map(() => '?').join(',');
  const { results: realProducts } = await env.DB.prepare(
    `SELECT id, name, price, active FROM products WHERE id IN (${placeholders})`
  ).bind(...productIds).all();

  const productsMap = new Map(realProducts.map(p => [p.id, p]));

  let realSubtotal = 0;
  const secureItems = [];

  for (const item of itemsArr) {
    const pId = Number(item.id);
    const qty = Number(item.qty) || 1;
    
    if (qty <= 0) return { ok: false, error: 'الكمية غير صالحة' };
    
    const dbProduct = productsMap.get(pId);
    if (!dbProduct) return { ok: false, error: `المنتج رقم ${pId} غير موجود` };
    if (dbProduct.active !== 1) return { ok: false, error: `المنتج ${dbProduct.name} غير متوفر حالياً` };

    const price = Number(dbProduct.price) || 0;
    realSubtotal += (price * qty);

    secureItems.push({
      id: dbProduct.id,
      name: dbProduct.name,
      qty: qty,
      price: price
    });
  }

  const secureItemsJson = JSON.stringify(secureItems);

  // ── معالجة الكوبون (على السعر الحقيقي) ──
  let finalDiscount = 0;
  if (couponCode) {
    const couponRow = await env.DB.prepare(`
      SELECT id, discount_type, discount_value, min_order, max_uses, used_count, expires_at
      FROM coupons
      WHERE code = ? AND active = 1 LIMIT 1
    `).bind(couponCode).first();

    if (
      couponRow &&
      (!couponRow.expires_at || new Date(couponRow.expires_at) >= new Date()) &&
      (couponRow.max_uses === 0 || couponRow.used_count < couponRow.max_uses) &&
      (couponRow.min_order === 0 || realSubtotal >= couponRow.min_order)
    ) {
      finalDiscount = couponRow.discount_type === 'percent'
        ? realSubtotal * (couponRow.discount_value / 100)
        : couponRow.discount_value;

      // زَد العداد بعد قبول الطلب
      await env.DB.prepare(
        `UPDATE coupons SET used_count = used_count + 1 WHERE id = ?`
      ).bind(couponRow.id).run();
    }
  }

  // ── إنشاء معرّف الطلب ──
  const orderId   = generateOrderId();
  const createdAt = formatAlgeriaTime();

  // ── حفظ الطلب في D1 ──
  await env.DB.prepare(`
    INSERT INTO orders (
      order_id, created_at, name, phone,
      wilaya_code, wilaya_ar, wilaya_en, municipality, delivery_type,
      items_json, subtotal, discount, coupon_code,
      status, notes,
      utm_source, utm_medium, utm_campaign
    ) VALUES (
      ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
    )
  `).bind(
    orderId, createdAt, name, phone,
    wilayaCode, wilayaAr, wilayaEn, municipality, deliveryType,
    secureItemsJson, realSubtotal, finalDiscount, couponCode,
    'pending', note,
    utmSource, utmMedium, utmCampaign,
  ).run();

  // ── إرسال حدث CAPI في الخلفية (Non-blocking) ──
  if (ctx && ctx.waitUntil) {
    ctx.waitUntil(
      sendCapiEvent(
        env,
        'Purchase',
        {
          value: realSubtotal - finalDiscount,
          order_id: orderId,
          content_ids: secureItems.map(i => i.id.toString())
        },
        { phone },
        request
      )
    );
  }

  return { ok: true, order_id: orderId };
}

/**
 * [PUBLIC] تتبع طلب برقم المعرّف
 * يُرجع بيانات عامة فقط (لا PII مثل الاسم والهاتف)
 * يُحاكي trackOrder() في GAS
 * @param {string} orderId
 */
export async function trackOrder(env, orderId) {
  if (!orderId) return { found: false, error: 'معرّف الطلب مطلوب' };

  const order = await env.DB.prepare(`
    SELECT
      order_id, created_at, status, shipping_note,
      wilaya_ar, wilaya_en, delivery_type,
      items_json, subtotal, discount
    FROM orders
    WHERE order_id = ?
    LIMIT 1
  `).bind(sanitize(orderId, 60)).first();

  if (!order) return { found: false, error: 'الطلب غير موجود' };

  return {
    found: true,
    order: {
      ...order,
      items_json: safeParseJson(order.items_json, []),
    },
  };
}

/**
 * [PUBLIC] جلب طلبات زبون برقم هاتفه
 * يُحاكي customerOrders() في GAS
 * @param {string} phone
 */
export async function customerOrders(env, phone) {
  const cleanPhone = sanitizePhone(phone);
  if (!cleanPhone || cleanPhone.length < 9) {
    return { orders: [] };
  }

  // تطابق مرن مع/بدون كود الدولة
  const { results } = await env.DB.prepare(`
    SELECT order_id, created_at, status, subtotal, items_json
    FROM orders
    WHERE replace(phone, '+', '') LIKE '%' || replace(?, '+', '') || '%'
       OR phone = ?
    ORDER BY created_at DESC
    LIMIT 20
  `).bind(cleanPhone, cleanPhone).all();

  const orders = results.map(o => ({
    ...o,
    items_json: safeParseJson(o.items_json, []),
  }));

  return { orders };
}

// ─────────────────────────────────────────────
// ── معالجات الأدمن (Admin Handlers) ──
// ─────────────────────────────────────────────

/**
 * [ADMIN] قائمة جميع الطلبات
 * يُحاكي adminListOrders() في GAS
 * يدعم الفلترة بالحالة والصفحات (Pagination)
 * @param {object} params - { status?, page?, limit? }
 */
export async function adminListOrders(env, params = {}) {
  const status = params.status ? sanitize(params.status, 20) : null;
  const page   = Math.max(1, parseInt(params.page  ?? 1));
  const limit  = Math.min(100, Math.max(1, parseInt(params.limit ?? 50)));
  const offset = (page - 1) * limit;

  let query = `
    SELECT
      id, order_id, created_at, name, phone,
      wilaya_ar, wilaya_en, municipality, delivery_type,
      items_json, subtotal, shipping_cost, discount, coupon_code,
      status, shipping_note, admin_note, notes,
      utm_source, utm_medium, utm_campaign
    FROM orders
  `;
  const bindings = [];

  if (status) {
    query += ` WHERE status = ?`;
    bindings.push(status);
  }

  query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  bindings.push(limit, offset);

  const { results } = await env.DB.prepare(query).bind(...bindings).all();

  // جلب العدد الكلي للصفحات
  const countQuery = status
    ? `SELECT COUNT(*) as total FROM orders WHERE status = ?`
    : `SELECT COUNT(*) as total FROM orders`;
  const countRow = status
    ? await env.DB.prepare(countQuery).bind(status).first()
    : await env.DB.prepare(countQuery).first();

  const orders = results.map(o => ({
    ...o,
    items_json: safeParseJson(o.items_json, []),
  }));

  return {
    orders,
    pagination: {
      total:    countRow?.total ?? 0,
      page,
      limit,
      pages:    Math.ceil((countRow?.total ?? 0) / limit),
    },
  };
}

/**
 * [ADMIN] تحديث حالة أو ملاحظات طلب
 * يُحاكي adminUpdateOrder() في GAS
 * @param {object} params - { order_id, status?, shipping_note?, admin_note?, shipping_cost? }
 */
export async function adminUpdateOrder(env, params) {
  const orderId = sanitize(params.order_id, 60);
  if (!orderId) return { ok: false, error: 'معرّف الطلب مطلوب' };

  const existing = await env.DB.prepare(
    `SELECT id FROM orders WHERE order_id = ? LIMIT 1`
  ).bind(orderId).first();

  if (!existing) return { ok: false, error: 'الطلب غير موجود' };

  // بنِ استعلام UPDATE ديناميكي بناءً على الحقول المُرسَلة
  const updates = [];
  const bindings = [];

  const VALID_STATUSES = new Set(['pending','confirmed','shipped','delivered','cancelled']);

  if (params.status !== undefined) {
    const s = sanitize(params.status, 20);
    if (!VALID_STATUSES.has(s)) return { ok: false, error: 'حالة غير صالحة' };
    updates.push('status = ?');
    bindings.push(s);
  }
  if (params.shipping_note !== undefined) {
    updates.push('shipping_note = ?');
    bindings.push(sanitize(params.shipping_note, 500));
  }
  if (params.admin_note !== undefined) {
    updates.push('admin_note = ?');
    bindings.push(sanitize(params.admin_note, 1000));
  }
  if (params.shipping_cost !== undefined) {
    updates.push('shipping_cost = ?');
    bindings.push(sanitizeNumber(params.shipping_cost));
  }

  if (!updates.length) return { ok: false, error: 'لم يُرسَل أي تعديل' };

  bindings.push(orderId);
  await env.DB.prepare(
    `UPDATE orders SET ${updates.join(', ')} WHERE order_id = ?`
  ).bind(...bindings).run();

  return { ok: true };
}

/**
 * [ADMIN] حذف طلب
 * @param {object} params - { order_id }
 */
export async function adminDeleteOrder(env, params) {
  const orderId = sanitize(params.order_id, 60);
  if (!orderId) return { ok: false, error: 'معرّف الطلب مطلوب' };

  await env.DB.prepare(
    `DELETE FROM orders WHERE order_id = ?`
  ).bind(orderId).run();

  return { ok: true };
}

// ─────────────────────────────────────────────
// ── دوال مساعدة ──
// ─────────────────────────────────────────────

function safeParseJson(text, fallback) {
  if (!text) return fallback;
  try   { return JSON.parse(text); }
  catch { return fallback; }
}
