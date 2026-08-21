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
import { orderSpamGuard, validateCustomerToken, isValidEmail, DEFAULT_MASTER_TENANT_ID } from '../utils/auth.js';
import { EmailProvider } from '../utils/email.js';
import { calculateShippingCost } from '../utils/shipping.js';

// ─────────────────────────────────────────────
// ── معالجات العامة (Public Handlers) ──
// ─────────────────────────────────────────────

/**
 * [PUBLIC] إنشاء طلب جديد مع عزل التاجر
 * @param {Env} env
 * @param {object} params
 * @param {Request} request
 * @param {ExecutionContext} ctx
 * @param {string|null} token
 * @param {string} [tenantId]
 */
export async function createOrder(env, params, request, ctx, token, tenantId = DEFAULT_MASTER_TENANT_ID) {
  // إن وُجد توكن جلسة عميل صالح، يُربط الطلب بهويته تلقائياً (session ownership).
  // الزبون (بلا token) يبقون يُنشئون الطلب بشكل طبيعي دون أي قيد.
  const customerId = token ? await validateCustomerToken(env.DB, token) : null;
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
  const utmTerm     = sanitize(params.utm_term,     100);
  const utmContent  = sanitize(params.utm_content,  150);
  const fbclid      = sanitize(params.fbclid,       150);
  const sessionId   = sanitize(params.session_id,   100);
  const fbc            = sanitize(params.fbc,              250);
  const fbp            = sanitize(params.fbp,              250);
  const email          = sanitize(params.email,            150);
  const eventSourceUrl = sanitize(params.event_source_url, 500);
  const couponCode     = sanitize(params.coupon_code,      50).toUpperCase();

  // تنظيف العناصر (يقتل XSS المخزَّن)
  const itemsJson = sanitizeOrderItems(params.items_json);

  // تحقق من أن السلة غير فارغة
  let itemsArr = [];
  try { itemsArr = JSON.parse(itemsJson); } catch { /* فارغة */ }
  if (!Array.isArray(itemsArr) || !itemsArr.length) return { ok: false, error: 'السلة فارغة' };

  // ── 🔒 الحماية: حساب السعر من قاعدة البيانات داخل نطاق التاجر المعتمد ──
  const productIds = itemsArr.map(item => Number(item.id)).filter(id => !isNaN(id));
  if (!productIds.length) return { ok: false, error: 'بيانات السلة غير صالحة' };

  const placeholders = productIds.map(() => '?').join(',');
  const { results: realProducts } = await env.DB.prepare(
    `SELECT id, name, price, active, stock, weight FROM products WHERE id IN (${placeholders}) AND (tenant_id = ? OR tenant_id IS NULL)`
  ).bind(...productIds, tenantId).all();

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

    // ── 🔒 حماية المخزون (Server-Side Authoritative) ──
    const stock = Number(dbProduct.stock);
    if (stock >= 0) {
      if (stock === 0) return { ok: false, error: `المنتج ${dbProduct.name} نفد من المخزون` };
      if (qty > stock) return { ok: false, error: `الكمية المطلوبة من ${dbProduct.name} تتجاوز المخزون المتاح (${stock})` };
    }

    let price = Number(dbProduct.price) || 0;

    // Check variant details
    let variantTitle = '';
    if (item.variant_selection && typeof item.variant_selection === 'object') {
      variantTitle = Object.values(item.variant_selection).filter(Boolean).join(' / ');
    } else if (item.variant_title) {
      variantTitle = String(item.variant_title);
    }

    // Check quantity tier calculation
    let itemSubtotal = price * qty;
    if (item.tier_subtotal && !isNaN(Number(item.tier_subtotal))) {
      itemSubtotal = Number(item.tier_subtotal);
    }

    realSubtotal += itemSubtotal;

    secureItems.push({
      id: dbProduct.id,
      name: dbProduct.name + (variantTitle ? ` (${variantTitle})` : ''),
      variant: item.variant_selection || null,
      variant_title: variantTitle || null,
      qty: qty,
      price: price
    });
  }

  const secureItemsJson = JSON.stringify(secureItems);

  // ── معالجة الكوبون (على السعر الحقيقي داخل متجر التاجر) ──
  let finalDiscount = 0;
  if (couponCode) {
    const couponRow = await env.DB.prepare(`
      SELECT id, discount_type, discount_value, min_order, max_uses, used_count, expires_at
      FROM coupons
      WHERE code = ? AND active = 1 AND (tenant_id = ? OR tenant_id IS NULL) LIMIT 1
    `).bind(couponCode, tenantId).first();

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
        `UPDATE coupons SET used_count = used_count + 1 WHERE id = ? AND (tenant_id = ? OR tenant_id IS NULL)`
      ).bind(couponRow.id, tenantId).run();
    }
  }

  // ── حساب سعر التوصيل (Server-Side Authoritative & Multi-Carrier Engine) ──
  const shippingSettings = { shipping_config: '', shipping_home: '', shipping_office: '', shipping_remote: '' };
  try {
    const { results: shipRows } = await env.DB.prepare(
      `SELECT key, value FROM settings WHERE key IN ('shipping_config','shipping_home','shipping_office','shipping_remote') AND (tenant_id = ? OR tenant_id IS NULL)`
    ).bind(tenantId).all();
    for (const row of shipRows) shippingSettings[row.key] = row.value;
  } catch (e) { /* defaults remain '' */ }

  const shippingCalc = calculateShippingCost({
    shippingConfig: shippingSettings.shipping_config,
    wilayaCode,
    deliveryType,
    items: itemsArr,
    productsMap,
    legacySettings: shippingSettings
  });

  if (!shippingCalc.ok) {
    return { ok: false, error: shippingCalc.error || 'طريقة التوصيل المحددة غير متوفرة' };
  }

  const shippingCost = shippingCalc.shippingCost;
  const shippingNote = shippingCalc.shippingNote;
  const deliveryCompany = shippingCalc.deliveryCompany || 'yalidine';

  // ── إنشاء معرّف الطلب ──
  const orderId   = generateOrderId();
  const createdAt = formatAlgeriaTime();

  // ── حفظ الطلب في D1 مع tenant_id الموثوق والإسناد التسويقي ──
  try {
    await env.DB.prepare(`
      INSERT INTO orders (
        tenant_id, order_id, created_at, name, phone,
        wilaya_code, wilaya_ar, wilaya_en, municipality, delivery_type,
        items_json, subtotal, shipping_cost, shipping_note, discount, coupon_code,
        status, notes,
        utm_source, utm_medium, utm_campaign, utm_term, utm_content, fbclid, session_id,
        customer_id,
        delivery_company, tracking_code
      ) VALUES (
        ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
      )
    `).bind(
      tenantId, orderId, createdAt, name, phone,
      wilayaCode, wilayaAr, wilayaEn, municipality, deliveryType,
      secureItemsJson, realSubtotal, shippingCost, shippingNote, finalDiscount, couponCode,
      'pending', note,
      utmSource, utmMedium, utmCampaign, utmTerm, utmContent, fbclid, sessionId,
      customerId,
      deliveryCompany, '',
    ).run();
  } catch (dbErr) {
    // التوافقية العكسية في حال عدم تطبيق الميجريشن 0003 بعد
    await env.DB.prepare(`
      INSERT INTO orders (
        tenant_id, order_id, created_at, name, phone,
        wilaya_code, wilaya_ar, wilaya_en, municipality, delivery_type,
        items_json, subtotal, shipping_cost, shipping_note, discount, coupon_code,
        status, notes,
        utm_source, utm_medium, utm_campaign, customer_id,
        delivery_company, tracking_code
      ) VALUES (
        ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
      )
    `).bind(
      tenantId, orderId, createdAt, name, phone,
      wilayaCode, wilayaAr, wilayaEn, municipality, deliveryType,
      secureItemsJson, realSubtotal, shippingCost, shippingNote, finalDiscount, couponCode,
      'pending', note,
      utmSource, utmMedium, utmCampaign, customerId,
      deliveryCompany, '',
    ).run();
  }

  // ── إرسال حدث CAPI وتسجيل التحليلات في الخلفية (Non-blocking) ──
  if (ctx && ctx.waitUntil) {
    // تسجيل حدث الشراء في جدول التحليلات الداخلي
    ctx.waitUntil(
      env.DB.prepare(`
        INSERT INTO analytics_events (
          tenant_id, session_id, event_name, product_id,
          utm_source, utm_medium, utm_campaign, utm_term, utm_content, fbclid, ip_country
        ) VALUES (?, ?, 'Purchase', ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        tenantId, sessionId,
        secureItems.map(i => i.id).join(','),
        utmSource, utmMedium, utmCampaign, utmTerm, utmContent, fbclid,
        request?.headers?.get('CF-IPCountry') || ''
      ).run().catch(() => {})
    );
    ctx.waitUntil(
      sendCapiEvent(
        env,
        'Purchase',
        {
          value: realSubtotal - finalDiscount + shippingCost,
          order_id: orderId,
          content_ids: secureItems.map(i => i.id.toString()),
          event_source_url: eventSourceUrl || undefined
        },
        { phone, email, fbc, fbp },
        request
      )
    );

    // ── إرسال إيميل تأكيد الطلب للعميل (إن وُجد) ──
    if (isValidEmail(email)) {
      const formattedItems = secureItems.map(i => `${i.name} (x${i.qty})`).join('، ');
      ctx.waitUntil(
        EmailProvider.sendOrderConfirmationEmail({
          to: email,
          orderId: orderId,
          customerName: name,
          items: formattedItems,
          total: realSubtotal - finalDiscount + shippingCost,
          shippingNote: shippingNote || (shippingCost > 0 ? `${shippingCost} دج` : 'مجاني'),
          env: env
        }).catch(err => {
          console.error('[EMAIL] Order confirmation failed', { order_id: orderId, error: err?.message });
        })
      );
    }
  }

  return { ok: true, order_id: orderId, total: realSubtotal - finalDiscount + shippingCost };
}

/**
 * [PUBLIC] تتبع طلب برقم المعرّف
 * يُرجع بيانات عامة فقط (لا PII مثل الاسم والهاتف)
 * يُحاكي trackOrder() في GAS
 * @param {string} orderId
 */
export async function trackOrder(env, orderId, tenantId = DEFAULT_MASTER_TENANT_ID) {
  if (!orderId) return { found: false, error: 'معرّف الطلب مطلوب' };

  const order = await env.DB.prepare(`
    SELECT
      order_id, created_at, status, shipping_note,
      wilaya_ar, wilaya_en, delivery_type,
      items_json, subtotal, discount, shipping_cost,
      delivery_company, tracking_code
    FROM orders
    WHERE order_id = ? AND (tenant_id = ? OR tenant_id IS NULL)
    LIMIT 1
  `).bind(sanitize(orderId, 60), tenantId).first();

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
 * [CUSTOMER] جلب طلبات العميل المسجّل الداخل فقط مع عزل التاجر
 */
export async function customerOrders(env, token, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const customerId = token ? await validateCustomerToken(env.DB, token) : null;

  if (!customerId) {
    return { ok: false, error: { code: 'UNAUTHORIZED', message: 'يرجى تسجيل الدخول لعرض طلباتك' }, orders: [] };
  }

  const customer = await env.DB.prepare(
    `SELECT phone FROM customers WHERE id = ? AND (tenant_id = ? OR tenant_id IS NULL) LIMIT 1`
  ).bind(customerId, tenantId).first();

  const ownPhone = customer?.phone || null;

  const { results } = await env.DB.prepare(`
    SELECT order_id, created_at, status, subtotal, items_json
    FROM orders
    WHERE (customer_id = ? OR (customer_id IS NULL AND phone = ?))
      AND (tenant_id = ? OR tenant_id IS NULL)
    ORDER BY created_at DESC
    LIMIT 20
  `).bind(customerId, ownPhone, tenantId).all();

  const orders = results.map(o => ({
    ...o,
    items_json: safeParseJson(o.items_json, []),
  }));

  return { ok: true, orders };
}

// ─────────────────────────────────────────────
// ── معالجات الأدمن (Admin Handlers) ──
// ─────────────────────────────────────────────

/**
 * [ADMIN] قائمة جميع الطلبات لمتجر التاجر الموثق
 */
export async function adminListOrders(env, params = {}, tenantId = DEFAULT_MASTER_TENANT_ID) {
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
      utm_source, utm_medium, utm_campaign,
      utm_term, utm_content, fbclid, session_id,
      delivery_company, tracking_code
    FROM orders
    WHERE (tenant_id = ? OR tenant_id IS NULL)
  `;
  const bindings = [tenantId];

  if (status) {
    query += ` AND status = ?`;
    bindings.push(status);
  }

  query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  bindings.push(limit, offset);

  const { results } = await env.DB.prepare(query).bind(...bindings).all();

  // جلب العدد الكلي للصفحات داخل نطاق هذا التاجر
  const countQuery = status
    ? `SELECT COUNT(*) as total FROM orders WHERE (tenant_id = ? OR tenant_id IS NULL) AND status = ?`
    : `SELECT COUNT(*) as total FROM orders WHERE (tenant_id = ? OR tenant_id IS NULL)`;
  const countRow = status
    ? await env.DB.prepare(countQuery).bind(tenantId, status).first()
    : await env.DB.prepare(countQuery).bind(tenantId).first();

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
 * [ADMIN] تحديث حالة أو ملاحظات طلب مع التحقق من ملكية التاجر (IDOR Protection)
 */
export async function adminUpdateOrder(env, params, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const orderId = sanitize(params.order_id, 60);
  if (!orderId) return { ok: false, error: 'معرّف الطلب مطلوب' };

  const existing = await env.DB.prepare(
    `SELECT id, status FROM orders WHERE order_id = ? AND (tenant_id = ? OR tenant_id IS NULL) LIMIT 1`
  ).bind(orderId, tenantId).first();

  if (!existing) return { ok: false, error: 'الطلب غير موجود أو لا تملك صلاحية تعديله' };

  const updates = [];
  const bindings = [];

  const VALID_STATUSES = new Set(['pending','confirmed','shipped','delivered','cancelled']);

  const wantsDelivery = params.status !== undefined &&
    sanitize(params.status, 20) === 'delivered';

  if (params.status !== undefined) {
    const s = sanitize(params.status, 20);
    if (!VALID_STATUSES.has(s)) return { ok: false, error: 'حالة غير صالحة' };
    if (!wantsDelivery) {
      updates.push('status = ?');
      bindings.push(s);
    }
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
  if (params.delivery_company !== undefined) {
    updates.push('delivery_company = ?');
    bindings.push(sanitize(params.delivery_company, 100));
  }
  if (params.tracking_code !== undefined) {
    updates.push('tracking_code = ?');
    bindings.push(sanitize(params.tracking_code, 200));
  }

  if (!updates.length && !wantsDelivery) return { ok: false, error: 'لم يُرسَل أي تعديل' };

  if (updates.length) {
    bindings.push(orderId, tenantId);
    await env.DB.prepare(
      `UPDATE orders SET ${updates.join(', ')} WHERE order_id = ? AND (tenant_id = ? OR tenant_id IS NULL)`
    ).bind(...bindings).run();
  }

  // PATHWAY DELIVERED: المسار الوحيد المؤدي إلى إنقاص المخزون.
  if (wantsDelivery) {
    return processDeliveredOrderStock(env, orderId, tenantId);
  }

  return { ok: true };
}

/**
 * [ADMIN] حذف طلب مع التحقق من ملكية التاجر (IDOR Protection)
 */
export async function adminDeleteOrder(env, params, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const orderId = sanitize(params.order_id, 60);
  if (!orderId) return { ok: false, error: 'معرّف الطلب مطلوب' };

  const result = await env.DB.prepare(
    `DELETE FROM orders WHERE order_id = ? AND (tenant_id = ? OR tenant_id IS NULL)`
  ).bind(orderId, tenantId).run();

  if (!result.meta.changes) {
    return { ok: false, error: 'الطلب غير موجود أو لا تملك صلاحية حذفه' };
  }

  return { ok: true };
}

/**
 * [INTERNAL — DELIVERY CONFIRMED] إنقاص المخزون عند تأكيد التسليم فقط مع عزل التاجر
 */
export async function processDeliveredOrderStock(env, orderId, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const order = await env.DB.prepare(
    `SELECT order_id, status, stock_decremented, items_json FROM orders WHERE order_id = ? LIMIT 1`
  ).bind(orderId).first();

  if (!order) return { ok: false, error: 'الطلب غير موجود' };

  // No-op سريع: الطلب مُعالَج بالفعل أو أصلاً delivered.
  if (order.status === 'delivered' || order.stock_decremented === 1) {
    return { ok: true, alreadyProcessed: true };
  }

  // تحليل عناصر الطلب — الكمية تُؤخذ من بيانات الطلب المخزَّنة فقط (لا من العميل).
  let items = [];
  try { items = JSON.parse(order.items_json); } catch { /* فارغ */ }
  if (!Array.isArray(items) || !items.length) {
    return { ok: false, error: 'الطلب لا يحتوي عناصر صالحة' };
  }

  const productIds = items
    .map(i => Number(i.id))
    .filter(id => Number.isFinite(id) && id > 0);
  if (!productIds.length) return { ok: false, error: 'بيانات الطلب غير صالحة' };

  const placeholders = productIds.map(() => '?').join(',');
  const { results: productRows } = await env.DB.prepare(
    `SELECT id, stock FROM products WHERE id IN (${placeholders})`
  ).bind(...productIds).all();
  const stockMap = new Map(productRows.map(p => [p.id, p.stock]));

  // ── PRE-CHECK (تحسين أداء فقط — آلية الصحة النهائية داخل الـ batch) ──
  const decrements = [];
  for (const item of items) {
    const pId = Number(item.id);
    const qty = Math.max(1, Math.floor(Number(item.qty) || 1));
    if (!Number.isFinite(pId) || pId <= 0) return { ok: false, error: 'insufficient_stock' };
    const stock = Number(stockMap.get(pId));
    if (stock === -1) continue;              // unlimited — لا يُنقص.
    if (Number.isNaN(stock) || stock < qty) return { ok: false, error: 'insufficient_stock' };
    decrements.push({ id: pId, qty });
  }

  // ── TRANSACTION واحدة: claim + assertions + decrements ──
  // claimToken فريد لكل طلب — stock_processed_at يحمله بدلاً من timestamp.
  const claimToken = crypto.randomUUID();

  const stmts = [
    // 0) CLAIM — exactly-once atomic gate.
    env.DB.prepare(`
      UPDATE orders
      SET status = 'delivered',
          stock_decremented = 1,
          stock_processed_at = ?
      WHERE order_id = ?
        AND stock_decremented = 0
        AND status <> 'delivered'
    `).bind(claimToken, orderId),
  ];

  // 1) ASSERTIONS — لكل منتج محدود، داخل نفس الـ transaction.
  //    - من خسر الـ claim (token مخزَّن != token هذا الطلب) → 0 (no-op، alreadyProcessed).
  //    - stock كافٍ → 1 (pass).
  //    - stock غير كافٍ → json('{invalid') يرمي SQL error → rollback الـ batch كله
  //      (يشمل الـ claim) → لا delivered-without-decrement.
  for (const d of decrements) {
    stmts.push(env.DB.prepare(`
      SELECT CASE
        WHEN (SELECT stock_processed_at FROM orders WHERE order_id = ?) <> ? THEN 0
        WHEN (SELECT stock FROM products WHERE id = ?) >= ? THEN 1
        ELSE json('{invalid')
      END
    `).bind(orderId, claimToken, d.id, d.qty));
  }

  // 2) DECREMENTS — فقط للفائز بالـ claim: guard token حرفي.
  //    Guard `stock >= ?` يمنع السالب؛ مطابقة الـ token تمنع أي decrement خاسر.
  for (const d of decrements) {
    stmts.push(env.DB.prepare(`
      UPDATE products
      SET stock = stock - ?
      WHERE id = ?
        AND stock >= ?
        AND (
          SELECT stock_processed_at
          FROM orders
          WHERE order_id = ?
        ) = ?
    `).bind(d.qty, d.id, d.qty, orderId, claimToken));
  }

  let results;
  try {
    results = await env.DB.batch(stmts);
  } catch (err) {
    // خطأ من الـ ASSERTION (مخزون غير كافٍ) أو أي خطأ SQL:
    // D1 قام بـ rollback تلقائي للـ batch كله (يشمل الـ claim).
    if (String(err?.message || err).includes('malformed JSON')) {
      return { ok: false, error: 'insufficient_stock' };
    }
    // خطأ غير متوقع — rollback حدث أيضاً (لا delivered-without-decrement)،
    // لكن نُعيده ليعالج في الطبقة العليا.
    throw err;
  }

  const claim = results[0];
  // لم نفز بالـ claim → معالجة متزامنة/سابقة سبقتنا → no-op (لا يلمس المخزون إطلاقاً).
  if ((claim?.meta?.changes ?? 0) === 0) {
    return { ok: true, alreadyProcessed: true };
  }

  // ── النجاح: commit مؤكد (claim + كل decrements) ──
  // مسح cache الكتالوج فقط بعد commit ناجح.
  if (env.CACHE) {
    try { await env.CACHE.delete('catalog_v1'); } catch { /* cache best-effort */ }
  }

  return { ok: true, stock_processed_at: claimToken };
}

// ─────────────────────────────────────────────
// ── دوال مساعدة ──
// ─────────────────────────────────────────────

function safeParseJson(text, fallback) {
  if (!text) return fallback;
  try   { return JSON.parse(text); }
  catch { return fallback; }
}
