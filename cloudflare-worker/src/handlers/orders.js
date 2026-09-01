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

  const isMaster = tenantId === DEFAULT_MASTER_TENANT_ID;

  // ── 🔒 جلب إعدادات الثيم النشط للمتجر لحساب عروض الكميات بدقة ──
  let storeThemeSections = null;
  try {
    const themeSettingStmt = isMaster
      ? env.DB.prepare(`SELECT key, value FROM settings WHERE key IN ('theme_default', 'theme_config') AND (tenant_id = ? OR tenant_id IS NULL)`).bind(tenantId)
      : env.DB.prepare(`SELECT key, value FROM settings WHERE key IN ('theme_default', 'theme_config') AND tenant_id = ?`).bind(tenantId);
    const { results: themeSettingRows } = await themeSettingStmt.all();
    const stMap = {};
    for (const r of (themeSettingRows || [])) stMap[r.key] = r.value;

    if (stMap.theme_config) {
      const parsedThemeCfg = typeof stMap.theme_config === 'string' ? JSON.parse(stMap.theme_config) : stMap.theme_config;
      if (parsedThemeCfg && parsedThemeCfg.sections) storeThemeSections = parsedThemeCfg.sections;
    } else if (stMap.theme_default) {
      const themeRowStmt = isMaster
        ? env.DB.prepare(`SELECT config_json FROM themes WHERE name = ? AND (tenant_id = ? OR tenant_id IS NULL) LIMIT 1`).bind(stMap.theme_default, tenantId)
        : env.DB.prepare(`SELECT config_json FROM themes WHERE name = ? AND tenant_id = ? LIMIT 1`).bind(stMap.theme_default, tenantId);
      const themeRow = await themeRowStmt.first();
      if (themeRow && themeRow.config_json) {
        const parsed = typeof themeRow.config_json === 'string' ? JSON.parse(themeRow.config_json) : themeRow.config_json;
        if (parsed && parsed.sections) storeThemeSections = parsed.sections;
      }
    }
  } catch (_) {}

  const placeholders = productIds.map(() => '?').join(',');
  const productStmt = isMaster
    ? env.DB.prepare(`SELECT id, name, price, active, stock, weight, landing_config_json, free_shipping FROM products WHERE id IN (${placeholders}) AND (tenant_id = ? OR tenant_id IS NULL)`).bind(...productIds, tenantId)
    : env.DB.prepare(`SELECT id, name, price, active, stock, weight, landing_config_json, free_shipping FROM products WHERE id IN (${placeholders}) AND tenant_id = ?`).bind(...productIds, tenantId);

  const { results: realProducts } = await productStmt.all();

  const productsMap = new Map(realProducts.map(p => [p.id, p]));

  function resolveOfferFreeShippingMode(modeVal, legacyBool) {
    if (modeVal !== undefined && modeVal !== null && modeVal !== '') {
      const m = String(modeVal).toLowerCase().trim();
      if (m === 'home' || m === 'office' || m === 'both' || m === 'none') {
        return m;
      }
    }
    if (legacyBool === true || legacyBool === 'true' || legacyBool === 1 || legacyBool === '1') {
      return 'both';
    }
    return 'none';
  }

  let realSubtotal = 0;
  let hasTierHomeFreeShipping = false;
  let hasTierOfficeFreeShipping = false;
  let hasProdFreeShipping = false;
  for (const p of realProducts) {
    if (p.free_shipping === 1 || p.free_shipping === 'true' || p.free_shipping === true) {
      hasProdFreeShipping = true;
    }
  }
  const secureItems = [];

  for (const item of itemsArr) {
    const pId = Number(item.id);
    const qty = Math.max(1, Math.floor(Number(item.qty) || 1));
    
    if (qty <= 0) return { ok: false, error: 'الكمية غير صالحة' };
    
    const dbProduct = productsMap.get(pId);
    if (!dbProduct) return { ok: false, error: `المنتج رقم ${pId} غير موجود` };
    if (dbProduct.active !== 1) return { ok: false, error: `المنتج ${dbProduct.name} غير متوفر حالياً` };

    const basePrice = Number(dbProduct.price) || 0;

    // ── 🔒 حساب السعر والخصم الكمي على الخادم حصرياً (Server-Authoritative Pricing Tiers) ──
    let tiers = [];
    let isTiersDisabled = false;
    let isTiersExplicitEnabled = false;
    let customTiers = null;

    if (dbProduct.landing_config_json) {
      try {
        const lp = typeof dbProduct.landing_config_json === 'string'
          ? JSON.parse(dbProduct.landing_config_json)
          : (dbProduct.landing_config_json || {});

        if (lp.sections && (lp.sections.pricing_tiers === false || lp.sections.pricing_tiers === 'disabled')) {
          isTiersDisabled = true;
        } else if (lp.sections && (lp.sections.pricing_tiers === true || lp.sections.pricing_tiers === 'enabled')) {
          isTiersExplicitEnabled = true;
        }

        if (Array.isArray(lp.pricing_tiers) && lp.pricing_tiers.length > 0) {
          customTiers = lp.pricing_tiers;
        } else if (lp.sections && lp.sections.pricing_tiers && Array.isArray(lp.sections.pricing_tiers.tiers)) {
          customTiers = lp.sections.pricing_tiers.tiers;
        }
      } catch (_) {}
    }

    if (!isTiersDisabled) {
      if (customTiers && customTiers.length > 0) {
        const filtered = customTiers.filter(t => t && t.enabled !== false && t.enabled !== 'false' && t.enabled !== 0 && t.enabled !== '0');
        if (filtered.length > 0) {
          tiers = filtered.map((t, idx) => {
            const tQty = (t.qty != null && !isNaN(Number(t.qty)) && Number(t.qty) >= 1) ? Math.floor(Number(t.qty)) : (idx + 1);
            const tOfferId = t.offer_id || `tier-${tQty}${idx > 0 ? `-${idx}` : ''}`;
            const tMode = resolveOfferFreeShippingMode(t.free_shipping_mode, t.free_shipping);
            return {
              offer_id: tOfferId,
              qty: tQty,
              label: t.label || t.name || `${tQty} قطع`,
              price: t.price != null ? Number(t.price) : (basePrice * tQty),
              badge: t.badge || '',
              subtext: t.subtext || '',
              free_shipping_mode: tMode,
              free_shipping: (tMode !== 'none')
            };
          });
        }
      } else {
        // Resolve Active Theme Settings
        let themeShowTiers = true;
        let tier1Enabled = true;
        let tier2Enabled = true;
        let tier3Enabled = true;
        let tier1Qty = 1;
        let tier2Qty = 2;
        let tier3Qty = 3;
        let tier1Price = null;
        let tier2Price = null;
        let tier3Price = null;
        let tier2Pct = 10;
        let tier3Pct = 20;
        let tier1FreeShippingMode = 'none';
        let tier2FreeShippingMode = 'none';
        let tier3FreeShippingMode = 'none';
        let t1Label = '1 قطعة (شراء عادي)';
        let t1Subtext = 'السعر القياسي';
        let t2Label = '2 قطع (الأكثر طلباً ⭐)';
        let t2Badge = 'الأكثر طلباً';
        let t2Subtext = 'العرض الموصى به للمنازل';
        let t3Label = '3 قطع (توفير كلي 🎁)';
        let t3Badge = 'توفير كلي';
        let t3Subtext = 'أفضل قيمة وأعلى توفير';

        if (storeThemeSections) {
          const isSettingEnabled = (val, defaultVal = true) => {
            if (val === undefined || val === null || val === '') return defaultVal;
            if (val === false || val === 'false' || val === 0 || val === '0' || val === 'off' || val === 'no' || val === 'disabled') return false;
            return true;
          };

          const tsSec = storeThemeSections['fast-order-form'] || storeThemeSections['order-form'];
          if (tsSec && tsSec.settings) {
            if (tsSec.settings.show_pricing_tiers !== undefined) {
              themeShowTiers = isSettingEnabled(tsSec.settings.show_pricing_tiers, true);
            }
            tier1Enabled = isSettingEnabled(tsSec.settings.tier1_enabled, true);
            tier2Enabled = isSettingEnabled(tsSec.settings.tier2_enabled, true);
            tier3Enabled = isSettingEnabled(tsSec.settings.tier3_enabled, true);
            if (tsSec.settings.tier1_qty != null && !isNaN(Number(tsSec.settings.tier1_qty)) && Number(tsSec.settings.tier1_qty) >= 1) {
              tier1Qty = Math.floor(Number(tsSec.settings.tier1_qty));
            }
            if (tsSec.settings.tier2_qty != null && !isNaN(Number(tsSec.settings.tier2_qty)) && Number(tsSec.settings.tier2_qty) >= 1) {
              tier2Qty = Math.floor(Number(tsSec.settings.tier2_qty));
            }
            if (tsSec.settings.tier3_qty != null && !isNaN(Number(tsSec.settings.tier3_qty)) && Number(tsSec.settings.tier3_qty) >= 1) {
              tier3Qty = Math.floor(Number(tsSec.settings.tier3_qty));
            }
            if (tsSec.settings.tier1_label) t1Label = String(tsSec.settings.tier1_label);
            if (tsSec.settings.tier1_subtext) t1Subtext = String(tsSec.settings.tier1_subtext);
            if (tsSec.settings.tier1_price != null && !isNaN(Number(tsSec.settings.tier1_price)) && Number(tsSec.settings.tier1_price) > 0) {
              tier1Price = Number(tsSec.settings.tier1_price);
            }
            tier1FreeShippingMode = resolveOfferFreeShippingMode(tsSec.settings.tier1_free_shipping_mode, tsSec.settings.tier1_free_shipping);

            if (tsSec.settings.tier2_label) t2Label = String(tsSec.settings.tier2_label);
            if (tsSec.settings.tier2_badge) t2Badge = String(tsSec.settings.tier2_badge);
            if (tsSec.settings.tier2_subtext) t2Subtext = String(tsSec.settings.tier2_subtext);
            if (tsSec.settings.tier2_price != null && !isNaN(Number(tsSec.settings.tier2_price)) && Number(tsSec.settings.tier2_price) > 0) {
              tier2Price = Number(tsSec.settings.tier2_price);
            } else if (tsSec.settings.tier2_discount_pct != null && !isNaN(Number(tsSec.settings.tier2_discount_pct))) {
              tier2Pct = Math.max(0, Math.min(100, Number(tsSec.settings.tier2_discount_pct)));
            }
            tier2FreeShippingMode = resolveOfferFreeShippingMode(tsSec.settings.tier2_free_shipping_mode, tsSec.settings.tier2_free_shipping);

            if (tsSec.settings.tier3_label) t3Label = String(tsSec.settings.tier3_label);
            if (tsSec.settings.tier3_badge) t3Badge = String(tsSec.settings.tier3_badge);
            if (tsSec.settings.tier3_subtext) t3Subtext = String(tsSec.settings.tier3_subtext);
            if (tsSec.settings.tier3_price != null && !isNaN(Number(tsSec.settings.tier3_price)) && Number(tsSec.settings.tier3_price) > 0) {
              tier3Price = Number(tsSec.settings.tier3_price);
            } else if (tsSec.settings.tier3_discount_pct != null && !isNaN(Number(tsSec.settings.tier3_discount_pct))) {
              tier3Pct = Math.max(0, Math.min(100, Number(tsSec.settings.tier3_discount_pct)));
            }
            const legacyFs3 = (tsSec.settings.tier3_free_shipping !== undefined) ? isSettingEnabled(tsSec.settings.tier3_free_shipping, true) : false;
            tier3FreeShippingMode = resolveOfferFreeShippingMode(tsSec.settings.tier3_free_shipping_mode, legacyFs3);
          }
        }

        const effectiveShow = isTiersExplicitEnabled ? true : themeShowTiers;
        if (effectiveShow) {
          const p1 = (tier1Price != null) ? tier1Price : (basePrice * tier1Qty);
          const p2 = (tier2Price != null) ? tier2Price : Math.round(basePrice * tier2Qty * (1 - tier2Pct / 100));
          const p3 = (tier3Price != null) ? tier3Price : Math.round(basePrice * tier3Qty * (1 - tier3Pct / 100));
          const list = [];
          if (tier1Enabled) list.push({ offer_id: 'tier-1', qty: tier1Qty, label: t1Label, subtext: t1Subtext, price: p1, free_shipping_mode: tier1FreeShippingMode, free_shipping: (tier1FreeShippingMode !== 'none') });
          if (tier2Enabled) list.push({ offer_id: 'tier-2', qty: tier2Qty, label: t2Label, subtext: t2Subtext, badge: t2Badge, price: p2, free_shipping_mode: tier2FreeShippingMode, free_shipping: (tier2FreeShippingMode !== 'none') });
          if (tier3Enabled) list.push({ offer_id: 'tier-3', qty: tier3Qty, label: t3Label, subtext: t3Subtext, badge: t3Badge, price: p3, free_shipping_mode: tier3FreeShippingMode, free_shipping: (tier3FreeShippingMode !== 'none') });
          if (list.length === 0) list.push({ offer_id: 'tier-1', qty: tier1Qty, label: t1Label, subtext: t1Subtext, price: p1, free_shipping_mode: tier1FreeShippingMode, free_shipping: (tier1FreeShippingMode !== 'none') });
          tiers = list;
        }
      }
    }

    let itemSubtotal = basePrice * qty;
    let matchedTier = null;

    if (tiers.length > 0) {
      if (item.offer_id) {
        matchedTier = tiers.find(t => String(t.offer_id) === String(item.offer_id));
      }
      if (!matchedTier) {
        matchedTier = tiers.find(t => Number(t.qty) === qty);
      }
      if (matchedTier && matchedTier.price != null && !isNaN(Number(matchedTier.price))) {
        itemSubtotal = Number(matchedTier.price);
        const mode = matchedTier.free_shipping_mode || (matchedTier.free_shipping ? 'both' : 'none');
        if (mode === 'both') {
          hasTierHomeFreeShipping = true;
          hasTierOfficeFreeShipping = true;
        } else if (mode === 'home') {
          hasTierHomeFreeShipping = true;
        } else if (mode === 'office') {
          hasTierOfficeFreeShipping = true;
        }
      }
    }

    const secureQty = (matchedTier && matchedTier.qty != null && Number(matchedTier.qty) >= 1)
      ? Number(matchedTier.qty)
      : qty;

    // ── 🔒 حماية المخزون (Server-Side Authoritative على الكمية المؤكدة) ──
    const stock = Number(dbProduct.stock);
    if (stock >= 0) {
      if (stock === 0) return { ok: false, error: `المنتج ${dbProduct.name} نفد من المخزون` };
      if (secureQty > stock) return { ok: false, error: `الكمية المطلوبة من ${dbProduct.name} تتجاوز المخزون المتاح (${stock})` };
    }

    realSubtotal += itemSubtotal;

    // Check variant details
    let variantTitle = '';
    if (item.variant_selection && typeof item.variant_selection === 'object') {
      variantTitle = Object.values(item.variant_selection).filter(Boolean).join(' / ');
    } else if (item.variant_title) {
      variantTitle = String(item.variant_title);
    }

    const effectiveUnitPrice = (secureQty > 0) ? Math.round(itemSubtotal / secureQty) : itemSubtotal;

    secureItems.push({
      id: dbProduct.id,
      name: dbProduct.name + (variantTitle ? ` (${variantTitle})` : ''),
      title: dbProduct.name,
      variant: item.variant_selection || null,
      variant_title: variantTitle || null,
      offer_id: matchedTier ? (matchedTier.offer_id || null) : (item.offer_id || null),
      tier_name: matchedTier ? (matchedTier.label || `${secureQty} قطع`) : (item.tier_name || null),
      qty: secureQty,
      unit_price: effectiveUnitPrice,
      price: effectiveUnitPrice,
      subtotal: itemSubtotal
    });
  }

  const secureItemsJson = JSON.stringify(secureItems);

  // ── معالجة الكوبون (على السعر الحقيقي داخل متجر التاجر) ──
  let finalDiscount = 0;
  let appliedCouponId = null;

  if (couponCode) {
    const couponStmt = isMaster
      ? env.DB.prepare(`SELECT id, discount_type, discount_value, min_order, max_uses, used_count, expires_at FROM coupons WHERE code = ? AND active = 1 AND (tenant_id = ? OR tenant_id IS NULL) LIMIT 1`).bind(couponCode, tenantId)
      : env.DB.prepare(`SELECT id, discount_type, discount_value, min_order, max_uses, used_count, expires_at FROM coupons WHERE code = ? AND active = 1 AND tenant_id = ? LIMIT 1`).bind(couponCode, tenantId);

    const couponRow = await couponStmt.first();

    if (
      couponRow &&
      (!couponRow.expires_at || new Date(couponRow.expires_at) >= new Date()) &&
      (couponRow.max_uses === 0 || couponRow.used_count < couponRow.max_uses) &&
      (couponRow.min_order === 0 || realSubtotal >= couponRow.min_order)
    ) {
      finalDiscount = couponRow.discount_type === 'percent'
        ? realSubtotal * (couponRow.discount_value / 100)
        : couponRow.discount_value;
      appliedCouponId = couponRow.id;
    } else if (couponRow && couponRow.max_uses > 0 && couponRow.used_count >= couponRow.max_uses) {
      return { ok: false, error: 'تم استنفاد هذا الكوبون بالكامل' };
    }
  }

  // ── حساب سعر التوصيل (Server-Side Authoritative & Multi-Carrier Engine) ──
  const shippingSettings = { shipping_config: '', shipping_home: '', shipping_office: '', shipping_remote: '', free_shipping_enabled: '' };
  try {
    const shipStmt = isMaster
      ? env.DB.prepare(`SELECT key, value FROM settings WHERE key IN ('shipping_config','shipping_home','shipping_office','shipping_remote','free_shipping_enabled') AND (tenant_id = ? OR tenant_id IS NULL)`).bind(tenantId)
      : env.DB.prepare(`SELECT key, value FROM settings WHERE key IN ('shipping_config','shipping_home','shipping_office','shipping_remote','free_shipping_enabled') AND tenant_id = ?`).bind(tenantId);

    const { results: shipRows } = await shipStmt.all();
    for (const row of shipRows) shippingSettings[row.key] = row.value;
  } catch (e) { /* defaults remain '' */ }

  const normDeliveryType = (String(deliveryType || 'home').toLowerCase() === 'office') ? 'office' : 'home';
  const isStoreFreeShipping = (shippingSettings.free_shipping_enabled === 'true');

  let isFreeShipping = false;
  let freeShippingNote = '';

  if (isStoreFreeShipping) {
    isFreeShipping = true;
    freeShippingNote = 'توصيل مجاني (إعداد المتجر)';
  } else if (hasProdFreeShipping) {
    isFreeShipping = true;
    freeShippingNote = 'شحن مجاني (خاص بالمنتج)';
  } else if (normDeliveryType === 'home' && hasTierHomeFreeShipping) {
    isFreeShipping = true;
    freeShippingNote = 'شحن مجاني للمنزل (عرض ترويجي)';
  } else if (normDeliveryType === 'office' && hasTierOfficeFreeShipping) {
    isFreeShipping = true;
    freeShippingNote = 'شحن مجاني للمكتب (عرض ترويجي)';
  }

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

  // ── التوصيل المجاني: تجاوز السعر فقط مع الحفاظ على شركة التوصيل وبيانات الولاية ──
  const shippingCost = isFreeShipping ? 0 : shippingCalc.shippingCost;
  const shippingNote = isFreeShipping ? freeShippingNote : shippingCalc.shippingNote;
  const deliveryCompany = shippingCalc.deliveryCompany || 'yalidine';

  // ── حجز الكوبون ذرياً قبل كتابة الطلب (Atomic Concurrency Protection) ──
  if (appliedCouponId) {
    const updateCouponStmt = isMaster
      ? env.DB.prepare(`
          UPDATE coupons
          SET used_count = used_count + 1
          WHERE id = ?
            AND active = 1
            AND (max_uses = 0 OR used_count < max_uses)
            AND (tenant_id = ? OR tenant_id IS NULL)
        `).bind(appliedCouponId, tenantId)
      : env.DB.prepare(`
          UPDATE coupons
          SET used_count = used_count + 1
          WHERE id = ?
            AND active = 1
            AND (max_uses = 0 OR used_count < max_uses)
            AND tenant_id = ?
        `).bind(appliedCouponId, tenantId);

    const couponUpdateRes = await updateCouponStmt.run();
    if (!couponUpdateRes.meta || couponUpdateRes.meta.changes === 0) {
      return { ok: false, error: 'تم استنفاد هذا الكوبون بالكامل' };
    }
  }

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
    try {
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
    } catch (finalDbErr) {
      // التراجع عن زيادة الكوبون في حال الفشل التام لكتابة الطلب في قاعدة البيانات
      if (appliedCouponId) {
        try {
          const rollbackCouponStmt = isMaster
            ? env.DB.prepare(`UPDATE coupons SET used_count = CASE WHEN used_count > 0 THEN used_count - 1 ELSE 0 END WHERE id = ? AND (tenant_id = ? OR tenant_id IS NULL)`).bind(appliedCouponId, tenantId)
            : env.DB.prepare(`UPDATE coupons SET used_count = CASE WHEN used_count > 0 THEN used_count - 1 ELSE 0 END WHERE id = ? AND tenant_id = ?`).bind(appliedCouponId, tenantId);
          await rollbackCouponStmt.run();
        } catch (_) {}
      }
      throw finalDbErr;
    }
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
        request,
        tenantId
      )
    );

    // ── إرسال إيميل تأكيد الطلب للعميل (إن وُجد) مع التتبع والموثوقية ──
    if (isValidEmail(email)) {
      const formattedItems = secureItems.map(i => `${i.name} (x${i.qty})`).join('، ');
      ctx.waitUntil(
        sendReliableOrderConfirmation(env, tenantId, {
          to: email,
          orderId: orderId,
          customerName: name,
          items: formattedItems,
          total: realSubtotal - finalDiscount + shippingCost,
          shippingNote: shippingNote || (shippingCost > 0 ? `${shippingCost} دج` : 'مجاني'),
        }).catch(err => {
          console.error('[EMAIL] Order confirmation failed', { order_id: orderId, error: err?.message });
        })
      );
    }

    // ── إرسال إشعارات الطلب الجديد للإدارة (Email) في الخلفية ──
    ctx.waitUntil(
      dispatchOrderNotifications(env, tenantId, {
        orderId: orderId,
        name: name,
        phone: phone,
        wilayaAr: wilayaAr,
        wilayaEn: wilayaEn,
        municipality: municipality,
        deliveryType: deliveryType,
        shippingCost: shippingCost,
        total: realSubtotal - finalDiscount + shippingCost
      }, secureItems).catch(err => {
        console.error('[NOTIF] Background dispatch failed', { order_id: orderId, error: err?.message });
      })
    );
  }

  return { ok: true, order_id: orderId, total: realSubtotal - finalDiscount + shippingCost };
}

/**
 * إرسال إيميل تأكيد الطلب للعميل مع الحجز الذري ومنع التكرار (Order Confirmation)
 */
export async function sendReliableOrderConfirmation(env, tenantId, { to, orderId, customerName, items, total, shippingNote }) {
  if (!isValidEmail(to) || !orderId) return { delivered: false, skipped: true };

  const notifType = 'order_confirmation';
  const idempotencyKey = `${tenantId}:${orderId}:${notifType}`;

  try {
    // 1. الحجز الذري لمنع التكرار (Atomic Reservation)
    let canSend = true;
    try {
      const reserveStmt = env.DB.prepare(`
        INSERT INTO notification_logs (
          tenant_id, order_id, notification_type, idempotency_key, recipient, status, attempts, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, 'sending', 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        )
        ON CONFLICT(idempotency_key) DO UPDATE
        SET status = 'sending',
            attempts = notification_logs.attempts + 1,
            updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        WHERE notification_logs.status IN ('queued', 'retrying', 'failed')
      `).bind(tenantId, orderId, notifType, idempotencyKey, to);

      const reserveRes = await reserveStmt.run();
      if (!reserveRes.meta || reserveRes.meta.changes === 0) {
        canSend = false;
        return { delivered: false, skipped: true, reason: 'ALREADY_SENT_OR_IN_FLIGHT' };
      }
    } catch (dbErr) {
      console.error('[Notification Confirmation DB Error]', { order_id: orderId, error: dbErr?.message });
    }

    if (!canSend) return { delivered: false, skipped: true };

    // 2. إرسال البريد عبر EmailProvider
    const sendRes = await EmailProvider.sendOrderConfirmationEmail({
      to,
      orderId,
      customerName,
      items,
      total,
      shippingNote,
      env
    }).catch(err => {
      console.error('[Email Error] Order confirmation transport exception:', { code: 'DISPATCH_ERROR' });
      return { delivered: false, status: 'DISPATCH_ERROR' };
    });

    // 3. تحديث حالة السجل
    try {
      if (sendRes?.delivered) {
        await env.DB.prepare(`
          UPDATE notification_logs
          SET status = 'sent',
              provider = ?,
              provider_msg_id = ?,
              last_error = NULL,
              updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
          WHERE idempotency_key = ?
        `).bind(sendRes.provider || 'resend', sendRes.id || null, idempotencyKey).run();

        return { delivered: true, status: 'sent', id: sendRes.id };
      } else {
        const isTemporary = (sendRes?.status === 'DISPATCH_ERROR' || sendRes?.status === 'PROVIDER_ERROR');
        const nextStatus = isTemporary ? 'retrying' : 'failed';
        const errorMsg = sendRes?.code || sendRes?.status || 'DISPATCH_FAILED';

        await env.DB.prepare(`
          UPDATE notification_logs
          SET status = ?,
              last_error = ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
          WHERE idempotency_key = ?
        `).bind(nextStatus, errorMsg, idempotencyKey).run();

        return { delivered: false, status: nextStatus, error: errorMsg };
      }
    } catch (dbUpdateErr) {
      console.error('[Notification Confirmation Update DB Error]', { error: dbUpdateErr?.message });
      return { delivered: !!sendRes?.delivered, status: sendRes?.delivered ? 'sent' : 'failed' };
    }
  } catch (err) {
    console.error('[sendReliableOrderConfirmation Exception]', { order_id: orderId, error: err?.message });
    return { delivered: false, status: 'failed', error: err?.message };
  }
}

/**
 * إرسال إشعارات الطلب الجديد للموظفين / المشرفين عبر البريد الإلكتروني (Resend) مع الحجز الذري
 */
export async function dispatchOrderNotifications(env, tenantId, orderData, secureItems = [], filterType = 'all') {
  const result = {
    email: { attempted: false, delivered: false }
  };

  try {
    const isMaster = tenantId === DEFAULT_MASTER_TENANT_ID;
    const stmt = isMaster
      ? env.DB.prepare(`SELECT key, value FROM settings WHERE (tenant_id = ? OR tenant_id IS NULL) AND key IN ('notification_email_enabled', 'notification_emails', 'store_name')`).bind(tenantId)
      : env.DB.prepare(`SELECT key, value FROM settings WHERE tenant_id = ? AND key IN ('notification_email_enabled', 'notification_emails', 'store_name')`).bind(tenantId);

    const { results } = await stmt.all();
    const cfg = {};
    (results || []).forEach(r => { cfg[r.key] = r.value; });

    const storeName = cfg.store_name || 'Smart Shopping';
    const formattedItems = secureItems.map(i => `${i.name} (x${i.qty})`).join('، ');

    // 1. إشعارات البريد الإلكتروني للمسؤول (Admin New Order Email) مع الحماية من التكرار
    const emailEnabled = cfg.notification_email_enabled === 'true' || cfg.notification_email_enabled === '1';
    if ((filterType === 'all' || filterType === 'email') && emailEnabled && cfg.notification_emails) {
      const emailList = cfg.notification_emails
        .split(/[\n,;]+/)
        .map(e => e.trim().toLowerCase())
        .filter(e => e && e.includes('@') && e.includes('.'));

      if (emailList.length > 0) {
        const notifType = 'new_order_admin';
        const idempotencyKey = `${tenantId}:${orderData.orderId}:${notifType}`;
        const recipientStr = emailList.join(', ');

        // الحجز الذري لمنع التكرار (Atomic Reservation)
        let canSend = true;
        try {
          const reserveStmt = env.DB.prepare(`
            INSERT INTO notification_logs (
              tenant_id, order_id, notification_type, idempotency_key, recipient, status, attempts, created_at, updated_at
            ) VALUES (
              ?, ?, ?, ?, ?, 'sending', 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
            )
            ON CONFLICT(idempotency_key) DO UPDATE
            SET status = 'sending',
                attempts = notification_logs.attempts + 1,
                updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
            WHERE notification_logs.status IN ('queued', 'retrying', 'failed')
          `).bind(tenantId, orderData.orderId, notifType, idempotencyKey, recipientStr);

          const reserveRes = await reserveStmt.run();
          if (!reserveRes.meta || reserveRes.meta.changes === 0) {
            canSend = false;
            result.email.attempted = false;
            result.email.skipped = true;
            result.email.reason = 'ALREADY_SENT_OR_IN_FLIGHT';
          }
        } catch (dbErr) {
          console.error('[Notification DB Error]', { order_id: orderData.orderId, error: dbErr?.message });
        }

        if (canSend) {
          result.email.attempted = true;
          const emailRes = await EmailProvider.sendNewOrderAdminNotification({
            toList: emailList,
            orderId: orderData.orderId,
            customerName: orderData.name,
            phone: orderData.phone,
            wilaya: orderData.wilayaAr || orderData.wilayaEn || '',
            municipality: orderData.municipality || '',
            deliveryType: orderData.deliveryType || 'home',
            items: formattedItems,
            total: orderData.total,
            shippingCost: orderData.shippingCost,
            storeName: storeName,
            env: env,
          }).catch(err => {
            console.error('[Email Error] Background email dispatch failed:', { code: 'DISPATCH_ERROR' });
            return { delivered: false, status: 'DISPATCH_ERROR' };
          });

          result.email.delivered = !!emailRes?.delivered;
          if (emailRes?.id) result.email.id = emailRes.id;
          if (emailRes?.status) result.email.status = emailRes.status;

          // تحديث السجل بعد المحاولة
          try {
            if (emailRes?.delivered) {
              await env.DB.prepare(`
                UPDATE notification_logs
                SET status = 'sent',
                    provider = ?,
                    provider_msg_id = ?,
                    last_error = NULL,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
                WHERE idempotency_key = ?
              `).bind(emailRes.provider || 'resend', emailRes.id || null, idempotencyKey).run();
            } else {
              const isTemporary = (emailRes?.status === 'DISPATCH_ERROR' || emailRes?.status === 'PROVIDER_ERROR');
              const nextStatus = isTemporary ? 'retrying' : 'failed';
              const errorMsg = emailRes?.code || emailRes?.status || 'DISPATCH_FAILED';

              await env.DB.prepare(`
                UPDATE notification_logs
                SET status = ?,
                    last_error = ?,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
                WHERE idempotency_key = ?
              `).bind(nextStatus, errorMsg, idempotencyKey).run();
            }
          } catch (dbUpdateErr) {
            console.error('[Notification DB Update Error]', { error: dbUpdateErr?.message });
          }
        }
      }
    }

    return result;
  } catch (err) {
    console.error('[Notification Dispatch Error]', { code: 'DISPATCH_EXCEPTION' });
    return result;
  }
}

/**
 * [PUBLIC] تتبع طلب برقم المعرّف
 * يُرجع بيانات عامة فقط (لا PII مثل الاسم والهاتف)
 * يُحاكي trackOrder() في GAS
 * @param {string} orderId
 */
export async function trackOrder(env, orderId, tenantId = DEFAULT_MASTER_TENANT_ID) {
  if (!orderId) return { found: false, error: 'معرّف الطلب مطلوب' };

  const isMaster = tenantId === DEFAULT_MASTER_TENANT_ID;
  const stmt = isMaster
    ? env.DB.prepare(`
        SELECT
          order_id, created_at, status, shipping_note,
          wilaya_ar, wilaya_en, delivery_type,
          items_json, subtotal, discount, shipping_cost,
          delivery_company, tracking_code
        FROM orders
        WHERE order_id = ? AND (tenant_id = ? OR tenant_id IS NULL)
        LIMIT 1
      `).bind(sanitize(orderId, 60), tenantId)
    : env.DB.prepare(`
        SELECT
          order_id, created_at, status, shipping_note,
          wilaya_ar, wilaya_en, delivery_type,
          items_json, subtotal, discount, shipping_cost,
          delivery_company, tracking_code
        FROM orders
        WHERE order_id = ? AND tenant_id = ?
        LIMIT 1
      `).bind(sanitize(orderId, 60), tenantId);

  const order = await stmt.first();

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

  const isMaster = tenantId === DEFAULT_MASTER_TENANT_ID;
  const custStmt = isMaster
    ? env.DB.prepare(`SELECT phone FROM customers WHERE id = ? AND (tenant_id = ? OR tenant_id IS NULL) LIMIT 1`).bind(customerId, tenantId)
    : env.DB.prepare(`SELECT phone FROM customers WHERE id = ? AND tenant_id = ? LIMIT 1`).bind(customerId, tenantId);

  const customer = await custStmt.first();
  const ownPhone = customer?.phone || null;

  const ordersStmt = isMaster
    ? env.DB.prepare(`
        SELECT order_id, created_at, status, subtotal, items_json
        FROM orders
        WHERE (customer_id = ? OR (customer_id IS NULL AND phone = ?))
          AND (tenant_id = ? OR tenant_id IS NULL)
        ORDER BY created_at DESC
        LIMIT 20
      `).bind(customerId, ownPhone, tenantId)
    : env.DB.prepare(`
        SELECT order_id, created_at, status, subtotal, items_json
        FROM orders
        WHERE (customer_id = ? OR (customer_id IS NULL AND phone = ?))
          AND tenant_id = ?
        ORDER BY created_at DESC
        LIMIT 20
      `).bind(customerId, ownPhone, tenantId);

  const { results } = await ordersStmt.all();

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

  const isMaster = tenantId === DEFAULT_MASTER_TENANT_ID;
  const tenantFilter = isMaster ? `(tenant_id = ? OR tenant_id IS NULL)` : `tenant_id = ?`;

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
    WHERE ${tenantFilter}
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
    ? `SELECT COUNT(*) as total FROM orders WHERE ${tenantFilter} AND status = ?`
    : `SELECT COUNT(*) as total FROM orders WHERE ${tenantFilter}`;
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

  const isMaster = tenantId === DEFAULT_MASTER_TENANT_ID;
  const checkStmt = isMaster
    ? env.DB.prepare(`SELECT id, status, stock_decremented FROM orders WHERE order_id = ? AND (tenant_id = ? OR tenant_id IS NULL) LIMIT 1`).bind(orderId, tenantId)
    : env.DB.prepare(`SELECT id, status, stock_decremented FROM orders WHERE order_id = ? AND tenant_id = ? LIMIT 1`).bind(orderId, tenantId);

  const existing = await checkStmt.first();

  if (!existing) return { ok: false, error: 'الطلب غير موجود أو لا تملك صلاحية تعديله' };

  const updates = [];
  const bindings = [];

  const VALID_STATUSES = new Set(['pending','confirmed','shipped','delivered','cancelled']);

  const newStatus = params.status !== undefined ? sanitize(params.status, 20) : null;
  if (newStatus && !VALID_STATUSES.has(newStatus)) return { ok: false, error: 'حالة غير صالحة' };

  const wantsDelivery = (newStatus === 'delivered');
  const wantsRestore = (newStatus === 'cancelled' && existing.status === 'delivered' && Number(existing.stock_decremented) === 1);

  if (newStatus && !wantsDelivery && !wantsRestore) {
    updates.push('status = ?');
    bindings.push(newStatus);
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

  if (!updates.length && !wantsDelivery && !wantsRestore) return { ok: false, error: 'لم يُرسَل أي تعديل' };

  if (updates.length) {
    bindings.push(orderId, tenantId);
    const updateOrderStmt = isMaster
      ? env.DB.prepare(`UPDATE orders SET ${updates.join(', ')} WHERE order_id = ? AND (tenant_id = ? OR tenant_id IS NULL)`)
      : env.DB.prepare(`UPDATE orders SET ${updates.join(', ')} WHERE order_id = ? AND tenant_id = ?`);
    await updateOrderStmt.bind(...bindings).run();
  }

  // PATHWAY DELIVERED: إنقاص المخزون
  if (wantsDelivery) {
    return processDeliveredOrderStock(env, orderId, tenantId);
  }

  // PATHWAY CANCELLED FROM DELIVERED: استرجاع المخزون الذري
  if (wantsRestore) {
    return processRestoredOrderStock(env, orderId, tenantId);
  }

  return { ok: true };
}

/**
 * [ADMIN] حذف طلب مع التحقق من ملكية التاجر (IDOR Protection)
 */
export async function adminDeleteOrder(env, params, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const orderId = sanitize(params.order_id, 60);
  if (!orderId) return { ok: false, error: 'معرّف الطلب مطلوب' };

  const isMaster = tenantId === DEFAULT_MASTER_TENANT_ID;
  const deleteStmt = isMaster
    ? env.DB.prepare(`DELETE FROM orders WHERE order_id = ? AND (tenant_id = ? OR tenant_id IS NULL)`).bind(orderId, tenantId)
    : env.DB.prepare(`DELETE FROM orders WHERE order_id = ? AND tenant_id = ?`).bind(orderId, tenantId);

  const result = await deleteStmt.run();

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
  // مسح cache الكتالوج للمستأجر المعني فقط بعد commit ناجح
  if (env.CACHE) {
    try { await env.CACHE.delete(`tenant:${tenantId}:catalog_v1`); } catch { /* cache best-effort */ }
  }

  return { ok: true, stock_processed_at: claimToken };
}

/**
 * [INTERNAL — RESTORE ON CANCELLATION] استرجاع المخزون الذري عند إلغاء طلب مسلَّم سابقاً مع عزل التاجر
 */
export async function processRestoredOrderStock(env, orderId, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const isMaster = tenantId === DEFAULT_MASTER_TENANT_ID;
  const stmt = isMaster
    ? env.DB.prepare(`SELECT order_id, status, stock_decremented, items_json FROM orders WHERE order_id = ? AND (tenant_id = ? OR tenant_id IS NULL) LIMIT 1`).bind(orderId, tenantId)
    : env.DB.prepare(`SELECT order_id, status, stock_decremented, items_json FROM orders WHERE order_id = ? AND tenant_id = ? LIMIT 1`).bind(orderId, tenantId);

  const order = await stmt.first();
  if (!order) return { ok: false, error: 'الطلب غير موجود' };

  // Guard: إذا لم يكن الطلب مسلماً أو لم يتم إنقاص مخزونه، فلا حاجة للاسترجاع (Idempotency)
  if (order.status !== 'delivered' || Number(order.stock_decremented) !== 1) {
    return { ok: true, alreadyProcessed: true };
  }

  let items = [];
  try { items = JSON.parse(order.items_json); } catch { items = []; }
  if (!Array.isArray(items) || !items.length) {
    const updateStmt = isMaster
      ? env.DB.prepare(`UPDATE orders SET status = 'cancelled', stock_decremented = 0 WHERE order_id = ? AND (tenant_id = ? OR tenant_id IS NULL)`).bind(orderId, tenantId)
      : env.DB.prepare(`UPDATE orders SET status = 'cancelled', stock_decremented = 0 WHERE order_id = ? AND tenant_id = ?`).bind(orderId, tenantId);
    await updateStmt.run();
    return { ok: true, stock_restored: false };
  }

  const productIds = items
    .map(i => Number(i.id))
    .filter(id => Number.isFinite(id) && id > 0);

  if (!productIds.length) {
    return { ok: false, error: 'بيانات الطلب غير صالحة' };
  }

  const placeholders = productIds.map(() => '?').join(',');
  const { results: productRows } = await env.DB.prepare(
    `SELECT id, stock FROM products WHERE id IN (${placeholders})`
  ).bind(...productIds).all();
  const stockMap = new Map((productRows || []).map(p => [p.id, p.stock]));

  const restorations = [];
  for (const item of items) {
    const pId = Number(item.id);
    const qty = Math.max(1, Math.floor(Number(item.qty) || 1));
    if (!Number.isFinite(pId) || pId <= 0) continue;
    const currentStock = Number(stockMap.get(pId));
    // إذا كان المخزون غير محدود (-1)، لا تتم زيادته ليبقى غير محدود
    if (currentStock === -1) continue;
    restorations.push({ id: pId, qty });
  }

  const restoreToken = crypto.randomUUID();

  // 0) CLAIM — Atomic gate: الانتقال إلى cancelled وإلغاء علامة الخصم (stock_decremented = 0)
  const stmts = [
    isMaster
      ? env.DB.prepare(`
          UPDATE orders
          SET status = 'cancelled',
              stock_decremented = 0,
              stock_processed_at = ?
          WHERE order_id = ?
            AND stock_decremented = 1
            AND status = 'delivered'
            AND (tenant_id = ? OR tenant_id IS NULL)
        `).bind(restoreToken, orderId, tenantId)
      : env.DB.prepare(`
          UPDATE orders
          SET status = 'cancelled',
              stock_decremented = 0,
              stock_processed_at = ?
          WHERE order_id = ?
            AND stock_decremented = 1
            AND status = 'delivered'
            AND tenant_id = ?
        `).bind(restoreToken, orderId, tenantId)
  ];

  // 1) INCREMENTS — زيادة كمية المخزون فقط في حال الفوز بالـ claim token
  for (const r of restorations) {
    stmts.push(env.DB.prepare(`
      UPDATE products
      SET stock = stock + ?
      WHERE id = ?
        AND (
          SELECT stock_processed_at
          FROM orders
          WHERE order_id = ?
        ) = ?
    `).bind(r.qty, r.id, orderId, restoreToken));
  }

  const results = await env.DB.batch(stmts);
  const claim = results[0];
  if ((claim?.meta?.changes ?? 0) === 0) {
    return { ok: true, alreadyProcessed: true };
  }

  if (env.CACHE) {
    try { await env.CACHE.delete(`tenant:${tenantId}:catalog_v1`); } catch { /* cache best-effort */ }
  }

  return { ok: true, stock_restored: true, stock_processed_at: restoreToken };
}

// ─────────────────────────────────────────────
// ── دوال مساعدة ──
// ─────────────────────────────────────────────

function safeParseJson(text, fallback) {
  if (!text) return fallback;
  try   { return JSON.parse(text); }
  catch { return fallback; }
}
