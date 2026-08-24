/**
 * Smart Shopping — Cloudflare Worker
 * ملف: src/handlers/ai.js
 *
 * [ADMIN] مساعد الذكاء الاصطناعي التجاري والتسويقي (AI Business & Marketing Copilot)
 * ─────────────────────────────────────────────────────────────
 * • يقوم بتجميع البيانات الحقيقية من D1 و Meta Graph API خادمياً (Server-Side Aggregation)
 * • يحسب المؤشرات الرياضية الأساسية (Revenue, AOV, Orders, Cancellations, ROAS, CPA) قبل مخاطبة Gemini
 * • يلتزم بمبدأ الصدق التام وعدم اختراع أي بيانات وهمية أو أرباح غير مثبتة
 * • يلتزم بمبدأ Approval-First: صياغة مسودات WhatsApp دون إرسال تلقائي
 * • يلتزم بالأمان التام وعزل المستأجرين (Multi-Tenant Isolation) وحماية المفاتيح وحماية Prompt Injection
 */

import { sanitize, sanitizePhone } from '../utils/sanitize.js';
import { DEFAULT_MASTER_TENANT_ID } from '../utils/auth.js';
import { getCampaignAnalytics } from './analytics.js';
import { GeminiModelResolver } from '../utils/gemini_resolver.js';

/**
 * استرجاع مفتاح Gemini API بأمان خادمياً
 */
async function resolveGeminiApiKey(env, tenantId = DEFAULT_MASTER_TENANT_ID) {
  if (env.GEMINI_API_KEY && String(env.GEMINI_API_KEY).trim()) {
    return String(env.GEMINI_API_KEY).trim();
  }

  try {
    const isMaster = tenantId === DEFAULT_MASTER_TENANT_ID;
    const row = isMaster
      ? await env.DB.prepare(`SELECT value FROM settings WHERE key = 'gemini_api_key' AND (tenant_id = ? OR tenant_id IS NULL) LIMIT 1`).bind(tenantId).first()
      : await env.DB.prepare(`SELECT value FROM settings WHERE key = 'gemini_api_key' AND tenant_id = ? LIMIT 1`).bind(tenantId).first();

    if (row && row.value && String(row.value).trim()) {
      return String(row.value).trim();
    }
  } catch (err) {
    console.warn('[AI Key Lookup Warning]', err?.message);
  }

  return null;
}

/**
 * تجميع البيانات الحقيقية من D1 و Meta Graph API وبناء كائن الاستخبارات التجارية الموحد (Commercial Snapshot)
 */
async function aggregateStoreData(env, tenantId = DEFAULT_MASTER_TENANT_ID, preset = 'last_30d') {
  const isMaster = tenantId === DEFAULT_MASTER_TENANT_ID;

  // 1. حساب إحصائيات الطلبات وسلسلة التحويل ومصفوفة الولايات من D1
  let ordersSummary = {
    total_orders: 0,
    confirmed_orders: 0,
    delivered_orders: 0,
    shipped_orders: 0,
    pending_orders: 0,
    cancelled_orders: 0,
    total_revenue_dzd: 0,
    delivered_revenue_dzd: 0,
    subtotal_dzd: 0,
    shipping_collected_dzd: 0,
    discounts_given_dzd: 0,
    aov_dzd: 0,
    cancellation_rate: '0.0%',
    confirmation_rate: '0.0%',
    delivery_success_rate: '0.0%',
    delivery_type_breakdown: { home: 0, office: 0 },
    top_wilayas: [],
    wilayas_delivery_matrix: [],
    sample_size: 0
  };

  const unknownDataList = [];

  try {
    const ordersStmt = isMaster
      ? env.DB.prepare(`
          SELECT
            status,
            wilaya_ar,
            wilaya_code,
            delivery_type,
            COUNT(*) AS count,
            SUM(COALESCE(subtotal, 0) - COALESCE(discount, 0) + COALESCE(shipping_cost, 0)) AS revenue,
            SUM(COALESCE(subtotal, 0)) AS subtotal,
            SUM(COALESCE(shipping_cost, 0)) AS shipping,
            SUM(COALESCE(discount, 0)) AS discount
          FROM orders
          WHERE (tenant_id = ? OR tenant_id IS NULL)
          GROUP BY status, wilaya_ar, wilaya_code, delivery_type
        `).bind(tenantId)
      : env.DB.prepare(`
          SELECT
            status,
            wilaya_ar,
            wilaya_code,
            delivery_type,
            COUNT(*) AS count,
            SUM(COALESCE(subtotal, 0) - COALESCE(discount, 0) + COALESCE(shipping_cost, 0)) AS revenue,
            SUM(COALESCE(subtotal, 0)) AS subtotal,
            SUM(COALESCE(shipping_cost, 0)) AS shipping,
            SUM(COALESCE(discount, 0)) AS discount
          FROM orders
          WHERE tenant_id = ?
          GROUP BY status, wilaya_ar, wilaya_code, delivery_type
        `).bind(tenantId);

    const { results: oRows } = await ordersStmt.all();
    const rows = oRows || [];

    const wilayaMap = new Map();
    let validRevenueOrdersCount = 0;

    rows.forEach(r => {
      const count = Number(r.count || 0);
      const rev = Number(r.revenue || 0);
      const sub = Number(r.subtotal || 0);
      const ship = Number(r.shipping || 0);
      const disc = Number(r.discount || 0);
      const status = (r.status || 'pending').toLowerCase();
      const wilaya = r.wilaya_ar || 'غير محدد';
      const wCode = r.wilaya_code || '';
      const delType = (r.delivery_type || 'home').toLowerCase();

      ordersSummary.total_orders += count;
      ordersSummary.sample_size += count;

      if (delType === 'home' || delType === 'domicile') {
        ordersSummary.delivery_type_breakdown.home += count;
      } else {
        ordersSummary.delivery_type_breakdown.office += count;
      }

      if (status === 'confirmed') ordersSummary.confirmed_orders += count;
      else if (status === 'delivered') {
        ordersSummary.delivered_orders += count;
        ordersSummary.delivered_revenue_dzd += rev;
      }
      else if (status === 'shipped') ordersSummary.shipped_orders += count;
      else if (status === 'cancelled' || status === 'returned' || status === 'rto') ordersSummary.cancelled_orders += count;
      else ordersSummary.pending_orders += count;

      if (status !== 'cancelled' && status !== 'returned' && status !== 'rto') {
        ordersSummary.total_revenue_dzd += rev;
        ordersSummary.subtotal_dzd += sub;
        ordersSummary.shipping_collected_dzd += ship;
        ordersSummary.discounts_given_dzd += disc;
        validRevenueOrdersCount += count;
      }

      if (!wilayaMap.has(wilaya)) {
        wilayaMap.set(wilaya, {
          wilaya: wilaya,
          code: wCode,
          orders: 0,
          confirmed: 0,
          delivered: 0,
          cancelled: 0,
          revenue: 0,
          total_shipping: 0
        });
      }
      const wNode = wilayaMap.get(wilaya);
      wNode.orders += count;
      wNode.total_shipping += ship;
      if (status === 'delivered') wNode.delivered += count;
      if (status === 'confirmed' || status === 'shipped' || status === 'delivered') wNode.confirmed += count;
      if (status === 'cancelled' || status === 'returned' || status === 'rto') wNode.cancelled += count;
      if (status !== 'cancelled' && status !== 'returned' && status !== 'rto') wNode.revenue += rev;
    });

    if (ordersSummary.total_orders > 0) {
      ordersSummary.cancellation_rate = ((ordersSummary.cancelled_orders / ordersSummary.total_orders) * 100).toFixed(1) + '%';
      const confirmedTotal = ordersSummary.confirmed_orders + ordersSummary.shipped_orders + ordersSummary.delivered_orders;
      ordersSummary.confirmation_rate = ((confirmedTotal / ordersSummary.total_orders) * 100).toFixed(1) + '%';

      const finishedOrders = ordersSummary.delivered_orders + ordersSummary.cancelled_orders;
      if (finishedOrders > 0) {
        ordersSummary.delivery_success_rate = ((ordersSummary.delivered_orders / finishedOrders) * 100).toFixed(1) + '%';
      } else {
        ordersSummary.delivery_success_rate = 'N/A (لا توجد طلبات منتهية بعد)';
      }
    }

    if (validRevenueOrdersCount > 0) {
      ordersSummary.aov_dzd = Math.round(ordersSummary.total_revenue_dzd / validRevenueOrdersCount);
    }

    const allWilayas = Array.from(wilayaMap.values()).map(w => {
      const fin = w.delivered + w.cancelled;
      const delivRate = fin > 0 ? ((w.delivered / fin) * 100).toFixed(1) + '%' : 'N/A';
      const confRate = w.orders > 0 ? ((w.confirmed / w.orders) * 100).toFixed(1) + '%' : '0.0%';
      const avgShip = w.orders > 0 ? Math.round(w.total_shipping / w.orders) : 0;
      return {
        wilaya: w.wilaya,
        code: w.code,
        orders: w.orders,
        confirmed: w.confirmed,
        delivered: w.delivered,
        cancelled: w.cancelled,
        confirmation_rate: confRate,
        delivery_success_rate: delivRate,
        revenue_dzd: w.revenue,
        avg_shipping_dzd: avgShip
      };
    });

    ordersSummary.top_wilayas = allWilayas
      .sort((a, b) => b.orders - a.orders)
      .slice(0, 6);

    ordersSummary.wilayas_delivery_matrix = allWilayas
      .sort((a, b) => b.orders - a.orders);

  } catch (err) {
    console.warn('[AI Orders Aggregation Warning]', err?.message);
  }

  // 2. حساب إحصائيات المنتجات والتكلفة بالجملة والتسعير الآمن (COGS & Unit Economics)
  let productsSummary = {
    total_products: 0,
    active_products: 0,
    out_of_stock_products: 0,
    total_inventory_retail_valuation_dzd: 0,
    total_inventory_wholesale_valuation_dzd: 0,
    cogs_coverage_pct: '0.0%',
    catalog_items: [],
    top_selling_items: [],
    low_stock_alerts: []
  };

  let totalProductsWithCogs = 0;

  try {
    const prodStmt = isMaster
      ? env.DB.prepare(`SELECT id, name, price, price_old, stock, active, landing_config_json FROM products WHERE (tenant_id = ? OR tenant_id IS NULL) LIMIT 2000`).bind(tenantId)
      : env.DB.prepare(`SELECT id, name, price, price_old, stock, active, landing_config_json FROM products WHERE tenant_id = ? LIMIT 2000`).bind(tenantId);

    const { results: pRows } = await prodStmt.all();
    const prods = pRows || [];

    productsSummary.total_products = prods.length;
    prods.forEach(p => {
      if (p.active) productsSummary.active_products++;
      const stock = Number(p.stock || 0);
      const retailPrice = Number(p.price || 0);
      let costPrice = null;
      try {
        const lp = JSON.parse(p.landing_config_json || '{}');
        if (lp && lp.cost_price != null && !isNaN(Number(lp.cost_price))) {
          costPrice = Number(lp.cost_price);
        }
      } catch (_) {}

      if (costPrice != null) {
        totalProductsWithCogs++;
      } else {
        unknownDataList.push(`سعر الجملة (COGS) للمنتج "${p.name}" غير مسجل`);
      }

      if (stock <= 0) {
        productsSummary.out_of_stock_products++;
      } else if (stock <= 5) {
        productsSummary.low_stock_alerts.push({ id: p.id, name: p.name, stock: stock, retail_price: retailPrice, cost_price: costPrice });
      }

      if (stock > 0) {
        productsSummary.total_inventory_retail_valuation_dzd += (stock * retailPrice);
        if (costPrice != null) {
          productsSummary.total_inventory_wholesale_valuation_dzd += (stock * costPrice);
        }
      }

      const grossMargin = (costPrice != null) ? (retailPrice - costPrice) : null;
      const marginPercent = (costPrice != null && retailPrice > 0) ? (((retailPrice - costPrice) / retailPrice) * 100).toFixed(1) + '%' : null;

      // الحسابات المالية الدقيقة المبنية حصراً على البيانات الحقيقية بدون أرقام افتراضية (Zero Magic Numbers)
      const minSafePrice = costPrice != null ? costPrice : null;
      const maxSafeDiscount = (costPrice != null && grossMargin != null && grossMargin > 0) ? grossMargin : null;

      // تصنيف ربحية المنتج المعتمد حصراً على الهامش الفعلي وحجم البيانات
      let classification = 'INSUFFICIENT_DATA';
      if (costPrice == null) {
        classification = 'INSUFFICIENT_DATA';
      } else if (grossMargin <= 0) {
        classification = 'LOSING_MONEY';
      } else if (marginPercent != null && parseFloat(marginPercent) < 15) {
        classification = 'MARGIN_PRESSURE';
      } else if (marginPercent != null && parseFloat(marginPercent) >= 40) {
        classification = 'HIGHLY_PROFITABLE';
      } else {
        classification = 'PROFITABLE';
      }

      productsSummary.catalog_items.push({
        id: p.id,
        name: p.name,
        retail_price_dzd: retailPrice,
        wholesale_cost_dzd: costPrice,
        stock: stock,
        active: Boolean(p.active),
        gross_margin_dzd: grossMargin,
        gross_margin_percent: marginPercent,
        estimated_min_safe_price_dzd: minSafePrice,
        estimated_max_safe_discount_dzd: maxSafeDiscount,
        classification: classification
      });
    });

    if (productsSummary.total_products > 0) {
      productsSummary.cogs_coverage_pct = ((totalProductsWithCogs / productsSummary.total_products) * 100).toFixed(1) + '%';
    }

    // جلب عينة من مبيعات المنتجات من items_json
    const itemsStmt = isMaster
      ? env.DB.prepare(`SELECT items_json FROM orders WHERE (tenant_id = ? OR tenant_id IS NULL) AND status NOT IN ('cancelled', 'returned', 'rto') ORDER BY id DESC LIMIT 200`).bind(tenantId)
      : env.DB.prepare(`SELECT items_json FROM orders WHERE tenant_id = ? AND status NOT IN ('cancelled', 'returned', 'rto') ORDER BY id DESC LIMIT 200`).bind(tenantId);

    const { results: iRows } = await itemsStmt.all();
    const itemSalesMap = new Map();

    (iRows || []).forEach(r => {
      try {
        const items = JSON.parse(r.items_json || '[]');
        if (Array.isArray(items)) {
          items.forEach(it => {
            const title = (it.title || it.name || 'منتج').trim();
            const qty = Number(it.qty || 1);
            const price = Number(it.price || 0);
            if (!itemSalesMap.has(title)) {
              itemSalesMap.set(title, { name: title, units_sold: 0, total_sales_dzd: 0 });
            }
            const node = itemSalesMap.get(title);
            node.units_sold += qty;
            node.total_sales_dzd += (price * qty);
          });
        }
      } catch (_) {}
    });

    productsSummary.top_selling_items = Array.from(itemSalesMap.values())
      .sort((a, b) => b.units_sold - a.units_sold)
      .slice(0, 8);

  } catch (err) {
    console.warn('[AI Products Aggregation Warning]', err?.message);
  }

  // 3. تقييمات الزبائن
  let reviewsSummary = {
    total_approved_reviews: 0,
    average_rating: '0.0'
  };
  try {
    const revStmt = isMaster
      ? env.DB.prepare(`SELECT rating FROM reviews WHERE status = 'approved' AND (tenant_id = ? OR tenant_id IS NULL) LIMIT 2000`).bind(tenantId)
      : env.DB.prepare(`SELECT rating FROM reviews WHERE status = 'approved' AND tenant_id = ? LIMIT 2000`).bind(tenantId);
    const { results: rRows } = await revStmt.all();
    const revs = rRows || [];
    reviewsSummary.total_approved_reviews = revs.length;
    if (revs.length > 0) {
      let sum = 0;
      revs.forEach(r => sum += Number(r.rating || 5));
      reviewsSummary.average_rating = (sum / revs.length).toFixed(1);
    }
  } catch (_) {}

  // 4. تحليلات الحملات الإعلانية ومزامنة Meta Graph API مع الربط التجاري
  let marketingSummary = {
    meta_connected: false,
    ad_spend_dzd: 0,
    overall_roas: 'N/A',
    overall_cpa_dzd: 0,
    overall_ctr: '0.00%',
    overall_cr: '0.00%',
    campaigns: [],
    creatives_analysis: [],
    notice: 'بيانات الحملات الإعلانية غير مربوطة حالياً.'
  };

  try {
    const campRes = await getCampaignAnalytics(env, { preset: preset }, tenantId);
    if (campRes && campRes.ok && campRes.data) {
      const d = campRes.data;
      marketingSummary.meta_connected = Boolean(d.meta_connected);
      marketingSummary.ad_spend_dzd = Number(d.summary?.total_spend_dzd || 0);
      marketingSummary.overall_roas = String(d.summary?.overall_roas || 'N/A');
      marketingSummary.overall_cpa_dzd = Number(d.summary?.overall_cpa_dzd || 0);
      marketingSummary.overall_ctr = String(d.summary?.overall_ctr || '0.00%');
      marketingSummary.overall_cr = String(d.summary?.overall_cr || '0.00%');

      const creativeList = [];

      marketingSummary.campaigns = (d.campaigns || []).slice(0, 10).map(c => {
        (c.adsets || []).forEach(s => {
          (s.ads || []).forEach(a => {
            creativeList.push({
              campaign_name: c.name,
              adset_name: s.name,
              creative_name: a.name,
              spend_dzd: a.spend_dzd,
              impressions: a.impressions,
              clicks: a.clicks,
              ctr: a.ctr,
              purchases: a.purchases,
              confirmed_orders: a.confirmed_orders,
              revenue_dzd: a.revenue_dzd,
              cpa_dzd: a.cpa_dzd,
              roas: a.roas,
              estimated_profit_dzd: a.estimated_profit_dzd
            });
          });
        });

        return {
          name: c.name,
          spend_dzd: c.spend_dzd,
          impressions: c.impressions,
          clicks: c.clicks,
          ctr: c.ctr,
          purchases: c.purchases,
          confirmed_orders: c.confirmed_orders,
          revenue_dzd: c.revenue_dzd,
          cpa_dzd: c.cpa_dzd,
          roas: c.roas,
          estimated_profit_dzd: c.estimated_profit_dzd,
          status: c.status_badge
        };
      });

      marketingSummary.creatives_analysis = creativeList.slice(0, 15);

      if (d.meta_connected) {
        marketingSummary.notice = 'بيانات Meta Ads متصلة ومحدثة مع تتبع الإسناد الفعلي.';
      } else if (d.meta_error) {
        marketingSummary.notice = `حساب Meta غير متصل: ${d.meta_error}`;
      }
    }
  } catch (err) {
    console.warn('[AI Marketing Aggregation Warning]', err?.message);
  }

  // 5. الحسابات المالية الدقيقة لـ CFO (CFO Financial Engine & True Net Delivered Profit)
  let totalDeliveredCogs = 0;
  let hasMissingCogsForDelivered = false;

  // جلب الطلبات المستلمة لحساب تكلفة COGS الفعلية
  try {
    const delOrdersStmt = isMaster
      ? env.DB.prepare(`SELECT items_json FROM orders WHERE (tenant_id = ? OR tenant_id IS NULL) AND status = 'delivered'`).bind(tenantId)
      : env.DB.prepare(`SELECT items_json FROM orders WHERE tenant_id = ? AND status = 'delivered'`).bind(tenantId);
    const { results: delRows } = await delOrdersStmt.all();

    const cogsLookup = new Map();
    productsSummary.catalog_items.forEach(ci => {
      if (ci.wholesale_cost_dzd != null) cogsLookup.set(ci.name.trim().toLowerCase(), ci.wholesale_cost_dzd);
    });

    (delRows || []).forEach(dr => {
      try {
        const items = JSON.parse(dr.items_json || '[]');
        if (Array.isArray(items)) {
          items.forEach(it => {
            const name = (it.title || it.name || '').trim().toLowerCase();
            const qty = Number(it.qty || 1);
            if (cogsLookup.has(name)) {
              totalDeliveredCogs += (cogsLookup.get(name) * qty);
            } else {
              hasMissingCogsForDelivered = true;
            }
          });
        }
      } catch (_) {}
    });
  } catch (_) {}

  const adSpend = marketingSummary.ad_spend_dzd || 0;
  const deliveredRev = ordersSummary.delivered_revenue_dzd;
  const netDeliveredProfit = (deliveredRev > 0 || adSpend > 0)
    ? (deliveredRev - totalDeliveredCogs - adSpend)
    : 0;

  const deliveredCAC = (adSpend > 0 && ordersSummary.delivered_orders > 0)
    ? Math.round(adSpend / ordersSummary.delivered_orders)
    : (adSpend === 0 ? 0 : null);

  const financialSnapshot = {
    gross_revenue_dzd: ordersSummary.total_revenue_dzd,
    delivered_revenue_dzd: deliveredRev,
    subtotal_dzd: ordersSummary.subtotal_dzd,
    shipping_collected_dzd: ordersSummary.shipping_collected_dzd,
    discounts_given_dzd: ordersSummary.discounts_given_dzd,
    total_delivered_cogs_dzd: totalDeliveredCogs,
    ad_spend_dzd: adSpend,
    net_delivered_profit_dzd: netDeliveredProfit,
    delivered_cac_dzd: deliveredCAC,
    has_partial_cogs: hasMissingCogsForDelivered,
    meta_connected: marketingSummary.meta_connected
  };

  // 6. محرك الأولويات الآلي (Automated Priority Engine)
  const priorityList = [];
  if (adSpend > 0 && ordersSummary.delivered_orders === 0 && ordersSummary.total_orders > 0) {
    priorityList.push({ level: 'P0', title: 'خطر مالي مباشر: إنفاق إعلاني بدون طلبيات مستلمة حتى الآن', reason: 'نزيف مالي يتطلب فحص جودة الحملات وسرعة التأكيد' });
  }
  if (productsSummary.low_stock_alerts.length > 0) {
    priorityList.push({ level: 'P1', title: `تنبيه مخزون منخفض لـ ${productsSummary.low_stock_alerts.length} منتجات`, reason: 'خطر نفاد المخزون وتوقف المبيعات' });
  }
  if (totalProductsWithCogs < productsSummary.total_products) {
    priorityList.push({ level: 'P2', title: 'بيانات تسعير ناقصة: أسعار الجملة (COGS) غير مكتملة', reason: 'ضرورة إدخال أسعار الجملة لحساب صافي الربح بدقة 100%' });
  }

  // تجميع الكائن التجاري الموحد (Commercial Snapshot)
  return {
    period: preset,
    orders: ordersSummary,
    products: productsSummary,
    reviews: reviewsSummary,
    marketing: marketingSummary,
    financials: financialSnapshot,
    priorities: priorityList,
    unknowns: unknownDataList,
    data_quality: {
      sample_size_orders: ordersSummary.total_orders,
      cogs_coverage_pct: productsSummary.cogs_coverage_pct,
      meta_sync_active: marketingSummary.meta_connected,
      confidence_rating: ordersSummary.total_orders >= 30 ? 'High' : (ordersSummary.total_orders >= 10 ? 'Moderate' : 'Low (عينة صغيرة)')
    }
  };
}

/**
 * جلب سياق طلبية محددة لصياغة رسالة WhatsApp بأمان
 */
async function getOrderSnapshotForWhatsApp(env, tenantId = DEFAULT_MASTER_TENANT_ID, orderId = '') {
  if (!orderId) return null;
  const isMaster = tenantId === DEFAULT_MASTER_TENANT_ID;

  try {
    const stmt = isMaster
      ? env.DB.prepare(`SELECT order_id, name, phone, wilaya_ar, municipality, delivery_type, subtotal, shipping_cost, discount, status, notes, items_json FROM orders WHERE order_id = ? AND (tenant_id = ? OR tenant_id IS NULL) LIMIT 1`).bind(orderId, tenantId)
      : env.DB.prepare(`SELECT order_id, name, phone, wilaya_ar, municipality, delivery_type, subtotal, shipping_cost, discount, status, notes, items_json FROM orders WHERE order_id = ? AND tenant_id = ? LIMIT 1`).bind(orderId, tenantId);

    const order = await stmt.first();
    if (!order) return null;

    let itemsList = [];
    try {
      const parsed = JSON.parse(order.items_json || '[]');
      if (Array.isArray(parsed)) {
        itemsList = parsed.map(i => `${i.title || i.name || 'منتج'} (${i.qty || 1} قطعة)`);
      }
    } catch (_) {}

    const total = Math.max(0, (Number(order.subtotal || 0) - Number(order.discount || 0) + Number(order.shipping_cost || 0)));

    return {
      order_id: order.order_id,
      customer_name: sanitize(order.name, 100),
      phone: sanitizePhone(order.phone),
      wilaya: sanitize(order.wilaya_ar, 50),
      municipality: sanitize(order.municipality, 50),
      delivery_type: order.delivery_type === 'Home' ? 'توصيل للمنزل' : 'استلام من المكتب',
      total_dzd: total,
      status: order.status || 'pending',
      items: itemsList,
      notes: sanitize(order.notes, 200)
    };
  } catch (err) {
    console.warn('[AI Order Snapshot Error]', err?.message);
    return null;
  }
}

/**
 * [ADMIN] المعالج الرئيسي للذكاء الاصطناعي التجاري والتسويقي (Commercial & Marketing Commander)
 */
export async function adminAiChat(env, params = {}, tenantId = DEFAULT_MASTER_TENANT_ID, authSession = null) {
  const mode = sanitize(params.mode, 50) || 'store_overview';
  const customPrompt = sanitize(params.prompt || params.message, 1000);
  const orderId = sanitize(params.order_id, 50);
  const preset = sanitize(params.preset, 30) || 'last_30d';

  // 1. التحقق من مفتاح Gemini
  const apiKey = await resolveGeminiApiKey(env, tenantId);
  if (!apiKey) {
    return {
      ok: false,
      error: 'تكامل Gemini غير مهيأ (يرجى تكوين GEMINI_API_KEY في المتغيرات البيئية أو الإعدادات)'
    };
  }

  // 2. تجميع البيانات الحقيقية من قاعدة البيانات
  const aggregatedData = await aggregateStoreData(env, tenantId, preset);
  let orderSnapshot = null;
  if (orderId) {
    orderSnapshot = await getOrderSnapshotForWhatsApp(env, tenantId, orderId);
  }

  // في وضع مسودة WhatsApp: التحقق من وجود الطلبية وانتمائها للمتجر
  if (mode === 'whatsapp_draft') {
    if (!orderId) {
      return { ok: false, error: 'يرجى تحديد رقم الطلبية لصياغة مسودة WhatsApp مخصصة' };
    }
    if (!orderSnapshot) {
      return { ok: false, error: 'الطلبية المحددة غير موجودة أو تابعة لمتجر آخر' };
    }
  }

  // 3. بناء برومبت القائد التجاري والمالي والتسويقي (Chief Commercial, Financial & Performance Marketing Officer)
  const systemInstruction = `
أنت "SmartKiosk Chief Commercial, Financial & Performance Marketing Manager" — المدير المالي ورئيس التسويق الرقمي والقائد التجاري لمنصة التجارة الإلكترونية الجزائرية SmartKiosk (COD).

==================================================
🎯 1. الفلسفة والقاعدة الذهبية لـ SMARTKIOSK
==================================================
1. لا تعتبر:
   - كثرة الطلبات = نجاح
   - كثرة الرسائل أو النقرات = نجاح
   - CTR مرتفع = نجاح
   - CPC منخفض = نجاح
   - ROAS مرتفع = نجاح
   - Revenue مرتفع = نجاح
2. النجاح الحقيقي الأوحد هو: **NET DELIVERED PROFIT** (الربح الصافي الفعلي الناتج عن الطلبات التي تم تسليمها واستلام ثمنها بعد خصم كافة التكاليف الحقيقية).
3. لا تتخذ قراراً تجارياً أو إعلانياً مهماً بناءً على Metric واحدة معزولة.

==================================================
🛡️ 2. منع اختراع المعلومات ومنظومة الوسوم المعرفية الـ 7 (Epistemic Tags)
==================================================
قاعدة صارمة غير قابلة للتفاوض: ممنوع اختراع أي رقم، سعر جملة، تكلفة شحن، تكلفة إرجاع، بيانات Meta، أو أرقام غير موجودة في البيانات.
إذا كانت المعلومة غير موجودة أو حجم العينة صغيراً جداً، صرح بوضوح: "🔴 UNKNOWN — حجم العينة غير كافٍ / لا توجد بيانات" ولا تصدر قراراً جازماً بلا أدلة.

استخدم الوسوم الـ 7 في كافة تحليلاتك لتوضيح طبيعة ومصدر كل رقم واستنتاج:
• 🟢 FACT: بيانات حقيقية مسجلة ومثبتة في قاعدة بيانات المتجر (طلبات، مخزون، أسعار، أحداث، مزامنة Meta).
• 🔵 CALCULATED: رقم تم حسابه رياضياً من بيانات المتجر الحقيقية (مثل Gross Margin، Delivery Rate %).
• 🟣 HISTORICAL BASELINE: خط أساس تاريخي ديناميكي مستخرج من سجلات المتجر لنفس المنتج/الحملة/الولاية خلال فترات سابقة.
• 🟡 INFERENCE: استنتاج تحليلي مدعوم بالأرقام وسلوك المتجر وتغير الأداء.
• 🟠 HYPOTHESIS: فرضية تسويقية وتجارية تحتاج إلى اختبار وتجربة عملية قبل تعميمها.
• 🌐 EXTERNAL BENCHMARK: معيار خارجي عام موثق (يُصنف صراحة كمعيار خارجي ومفصول تماماً عن بيانات المتجر).
• 🔴 UNKNOWN: معلومة غير مسجلة أو حجم العينة غير كافٍ (Insufficient Sample Size).

==================================================
💰 3. الإدارة المالية الشاملة والتمييز بين سعر الجملة والتجزئة (Wholesale vs Retail & Unit Economics)
==================================================
• معادلة صافي الربح الحقيقي للطلبية المسلمة (Deterministic Net Delivered Profit):
  Net Delivered Profit = [Delivered Revenue الإيراد المستلم] - [Delivered COGS تكلفة الجملة للمستلم] - [Verified Ad Spend الإنفاق الإعلاني الموثق] - [Absorbed Shipping الشحن الممتص] - [Verified Confirmation Cost تكلفة التأكيد إن وُجدت] - [Verified Return Cost تكلفة الراجع إن وُجدت].
  إذا كانت أي تكلفة غير مسجلة في بيانات المتجر، اعرضها فوراً كـ 🔴 UNKNOWN ولا تخترع رقماً افتراضياً.
• إذا كان سعر الجملة (Wholesale Cost) غير مسجل: لا تخترع رقماً، بل اعرضه كـ 🔴 UNKNOWN واطلب من التاجر إدخاله لحساب الربحية بدقة.
• حدد دائماً: Known Costs، Unknown Costs، و Estimated Net Profit Range.

==================================================
🛡️ 4. طبقة الحماية من الخسارة وتصنيف ربحية المنتجات (Loss Prevention Barrier & 6-Tier Product Matrix)
==================================================
صنف كل منتج بناءً على الأرقام:
• 🟢 HIGHLY PROFITABLE (ربح صافٍ ممتاز وهامش واسع يسمح بالتوسع الإعلاني).
• 🟢 PROFITABLE (مربح ومستقر بأرقام متزنة).
• 🟡 MARGIN UNDER PRESSURE (الهامش تحت الضغط بسبب ارتفاع CAC أو مصاريف الشحن).
• 🟠 HIGH RISK (مخاطرة عالية — نسبة إلغاء مرتفعة أو هامش ضيق جداً).
• 🔴 LOSING MONEY (يستنزف الميزانية ويسبب خسارة صريحة بعد خصم الشحن والإعلانات).
• ⚪ INSUFFICIENT DATA (بيانات غير كافية لتقييم الربحية بدقة).

إذا كان أي عرض أو توسع سيؤدي لخسارة مالية، ارفع فوراً تحذير الخط الأحمر:
"🔴 تحذير الخسارة (Loss Prevention Barrier): هذا العرض غير مربح بهذه الأرقام ويؤدي لتآكل رأس المال."

==================================================
📢 5. مسار تشخيص السلسلة الإعلانية وقيادة الحملات (Campaign Commander & Full Funnel Diagnostics)
==================================================
مسار التحليل الإلزامي:
Campaign → Ad Set → Creative → Landing Page → Product → Checkout → Order → Confirmation → Shipping → Delivery → Net Profit.

⚠️ مبدأ المعايير الديناميكية وتطور الأداء (Dynamic Baseline vs Hardcoded Rules):
• ممنوع استخدام حدود ثابتة عامة (لا تقل أبداً: CTR < 1.5% سيئ أو Confirmation < 60% سيئ كقاعدة مطلقة!).
• الأولوية دائماً لخط الأساس التاريخي (🟣 HISTORICAL BASELINE) لكل منتج وحملة وولاية على حدة.
• اذكر دائماً: حجم العينة (Sample Size)، النافذة الزمنية (Time Window)، ومستوى الثقة الإحصائية (Confidence).
• صنّف اتجاه الأداء بدقة:
  [ Improving 🟢 | Stable 🟡 | Declining 🟠 | Volatile ⚠️ | Insufficient Data 🔴 ]

مسار التشخيص المعتمد على المقارنة الديناميكية:
• إذا كان الـ CTR الحالي أقل بنسبة ملحوظة من خط الأساس التاريخي (🟣 HISTORICAL BASELINE) مع عينة ظهور كافية → إشارة لتراجع جاذبية الـ Creative أو تشبع الجمهور (Creative Fatigue).
• إذا كان الـ CTR مستقراً ولكن تحويل صفحة الهبوط يتراجع مقارنة بخط الأساس → إشارة لخلل في العرض (Offer)، وضوح السعر، أو تجربة الاستخدام.
• إذا كان معدل التأكيد (Confirmation Rate) أقل من خط الأساس التاريخي للمنتج/الحملة → إشارة لضعف جودة الجمهور أو بطء الاتصال الهاتفي.
• إذا كان معدل التسليم (Delivery Rate) أقل من خط الأساس التاريخي للولاية المعنية أو نوع الشحن → إشارة لمشاكل في التوصيل أو تراجع التزام الزبائن.
• ⚠️ القاعدة الذهبية: لا توقف حملة لمجرد تراجع مؤشر وسيط (مثل CTR) طالما أن Net Delivered Profit ما زال يحقق أرباحاً صافية مجدية!

==================================================
💵 6. قائد إدارة الميزانية والتوسع الآمن (Budget Commander & Scale Management)
==================================================
• عند إعطائك ميزانية (مثل 10,000 دج): احسب CAC الأقصى المسموح به، عدد الطلبيات المستلمة المطلوبة للتعادل، وحدد 3 سيناريوهات:
  1. السيناريو المحافظ (Conservative)
  2. السيناريو المتوقع (Expected)
  3. السيناريو المتفائل (Optimistic)
• لا تقترح زيادة الميزانية (Scale) بمجرد ارتفاع ROAS أو عدد الطلبات! بل افحص: استقرار CPA، معدل التسليم مقارنة بالـ Baseline التاريخي، وصافي ربح موجب ومثبت لكل طلبية إضافية (Incremental Net Delivered Profit > 0) مع عينة إحصائية كافية.
• 🔴 حد الخطر (Stop-Loss): حدد بدقة الرقم الذي إذا وصل إليه الـ CPA أو معدل الإلغاء يجب إيقاف الحملة فوراً.

==================================================
🎁 7. مستشار التسعير ومهندس العروض التجارية (AI Pricing Advisor & Offer Builder Scenarios)
==================================================
احسب واقترح لكل منتج: Minimum Safe Price، Recommended Retail Price، Promotion Price، و Maximum Safe Discount.
وقارن دائماً بين سيناريوهات العروض بالأرقام:
• Scenario A: سعر البيع + الشحن على العميل.
• Scenario B: سعر البيع + شحن مجاني (يتحمله المتجر).
• Scenario C: باقة قطعتين (Bundle) + شحن مجاني (رفع AOV وتوزيع CAC على قطعتين).
• Scenario D: سعر البيع + هدية مجانية + شحن مجاني.
احسب لكل سيناريو: السعر الإجمالي، تكلفة الجملة، مصاريف الشحن، الربح الإجمالي، والـ Max CAC الآمن.

==================================================
🧪 8. تحويل التوصيات إلى تجارب نمو (Growth Experiments Framework)
==================================================
صِغ كل فكرة بصيغة تجربة علمية قابلة للقياس:
{ الفرضية HYPOTHESIS، التجربة TEST، المتغير VARIABLE، الميزانية BUDGET، المدة DURATION، المؤشر الأساسي PRIMARY KPI، شرط الإيقاف STOP-LOSS، والنتيجة المتوقعة EXPECTED OUTCOME }.

==================================================
🇩🇿 9. الفهم الميداني للسوق الجزائري (COD Realities)
==================================================
• الدفع عند الاستلام COD يتطلب: تأكيداً هاتفياً سريعاً، حق المعاينة عند الباب، وتوفير خيار الاستلام من المكتب (Stop Desk) لولايات الجنوب لتقليل مصاريف الشحن.
• عامل أي نمط كفرضية قابلة للقياس والتحقق من بيانات المتجر الفعلية.

==================================================
==================================================
🎯 10. محرك الأولويات الصارم (Priority Engine P0-P3)
==================================================
عند وجود عدة مشاكل أو قرارات، رتبها وفق سلم الأولويات التالي:
• 🔴 P0 — خطر مالي مباشر: نزيف مالي، عروض خاسرة، أو إعلانات تستنزف الميزانية بصفر تسليم.
• 🟠 P1 — يؤثر على الربحية الحالية: بطء التأكيد الهاتفي، نقص المخزون السريع، أو تراجع هوامش الشحن.
• 🟢 P2 — فرصة نمو وتوسع: منتج ذو هامش ممتاز ونسبة تسليم مستقرة يستحق زيادة الميزانية.
• ⚪ P3 — تحسين ثانوي: تجارب إضافية على النصوص أو تعديلات طفيفة.

واذكر للتاجر دائماً:
"إذا كان بإمكانك تنفيذ شيء واحد فقط اليوم، فهذا هو الشيء الذي يجب أن تفعله: [P0/P1 الأكثر إلحاحاً]."

==================================================
📋 11. الهيكل الإلزامي للقرارات والتوصيات النهائية (11-Part Actionable Decision)
==================================================
عند تقديم توصية استراتيجية أو قرار حملة، التزم بالهيكل التالي:
🎯 DECISION / القرار: (حدد بوضوح أحد الإجراءات: SCALE | MAINTAIN | OPTIMIZE | TEST | REDUCE | STOP)
💰 FINANCIAL IMPACT / الأثر المالي: (صافي الربح المستلم المتوقع Net Delivered Profit والهامش الإجمالي)
📊 FACTS & BASELINES / الحقائق وخط الأساس: (مع وسوم 🟢 FACT و 🟣 HISTORICAL BASELINE وحجم العينة والنافذة الزمنية)
🧮 CALCULATIONS / الحسابات: (مع وسوم 🔵 CALCULATED لاقتصاديات الوحدة: COGS، CAC، الشحن، مخاطر الراجع)
🧠 DIAGNOSIS / التشخيص التجاري: (مع وسوم 🟡 INFERENCE لمكان التسرب في مسار التحويل Funnel Leak)
📈 ACTION / الإجراء التنفيذي: (خطوات عملية واضحة مرتبة بالأولوية P0-P3)
🧪 EXPERIMENT / خطة الاختبار: (مع وسوم 🟠 HYPOTHESIS {الفرضية، المتغير، الميزانية، المؤشر، شرط الإيقاف})
🔴 STOP-LOSS / حد الخطر: (سقف الخسارة أو تكلفة الإعلان التي نوقف عندها فوراً)
⚠️ RISK / المخاطر: (النقاط الواجب مراقبتها: التدفق النقدي، المخزون، تشبع الجمهور)
🧠 CONFIDENCE & SAMPLE / نسبة الثقة وحجم العينة: (النسبة المئوية بناءً على حجم وتاريخ البيانات)
❓ UNKNOWN DATA / البيانات الناقصة: (مع وسوم 🔴 UNKNOWN للبيانات المطلوب من التاجر جمعها أو إدخالها)

عندما يسأل التاجر "ماذا أفعل الآن؟":
ابدأ فوراً بقسم:
🔥 ACTION NOW:
1. افعل: ...
2. أوقف: ...
3. اختبر: ...
4. خصص ميزانية: ...
5. راقب: ...
6. Stop-Loss (حد الخطر): ...
ثم استعرض التحليل المالي والمقارنة بخط الأساس التاريخي.
`.trim();

  const isChatMode = (mode === 'chat');

  let userTaskPrompt = '';
  switch (mode) {
    case 'daily_brief':
      userTaskPrompt = `قم بدور "غرفة القيادة اليومية (Daily Commercial Brief)": أجب عن: 1. ما الذي حدث اليوم؟ 2. ما الذي يربح وما الذي يخسر مالياً؟ 3. ما أخطر مشكلة P0/P1؟ 4. ما الإجراء الفوري الواجب تنفيذه اليوم؟ مع تقييم التدفق المالي وحماية رأس المال.`;
      break;
    case 'weekly_review':
      userTaskPrompt = `قم بدور "المراجعة الأسبوعية للأعمال (Weekly Business Review)": قارن الأسبوع الحالي بخط الأساس التاريخي (🟣 HISTORICAL BASELINE): الإيرادات، صافي الربح المستلم، Delivered CAC، نسبة التسليم، أفضل/أسوأ المنتجات والحملات والولايات، وما يجب تغييره الأسبوع القادم.`;
      break;
    case 'monthly_review':
      userTaskPrompt = `قم بدور "المراجعة الشهرية الشاملة واستراتيجية النمو (Monthly Strategic Review)": حلل محفظة المنتجات، كفاءة رأس المال والميزانية الإعلانية، هوامش الربح الحقيقية، المخاطر الهيكلية، وخطة الشهر القادم لتحقيق نمو مستدام ومربح.`;
      break;
    case 'financial_commander':
      userTaskPrompt = `قم بدور "المدير المالي (Chief Financial Officer - CFO)": حلل اقتصاديات الوحدة (Unit Economics) للمتجر: Gross Margin، تكاليف الشحن الممتصة، Delivered CAC، صافي الربح المستلم الفعلي (Net Delivered Profit)، ونقطة التعادل (Break-even). وافصل بدقة بين الحقائق 🟢 FACT والحسابات 🔵 CALCULATED والمجهول 🔴 UNKNOWN.`;
      break;
    case 'campaign_commander':
      userTaskPrompt = `قم بدور "قائد الحملات الإعلانية والتسويقية (AI Campaign Commander)": حلل الحملات والمجموعات والإعلانات الإبداعية (Creatives) ومؤشرات CTR و CPA و ROAS والتحويلات. حدد ماذا نوقف، ماذا نوسع، وما الإعلانات التي تستنزف الميزانية، واربط الأداء بصافي الربح المستلم. قدم القرار وفق الهيكل التجاري الإلزامي.`;
      break;
    case 'pricing_advisor':
      userTaskPrompt = `قم بدور "مستشار التسعير وحماية الأرباح (AI Pricing Advisor)": حلل قائمة المنتجات وأسعار التكلفة بالجملة (cost_price) والتجزئة. احسب Minimum Safe Price، Recommended Retail Price، Promotion Price، و Maximum Safe Discount لكل منتج، وحدد الخطوط الحمراء لمنع الخسارة مع الشرح الرياضي.`;
      break;
    case 'offer_builder':
      userTaskPrompt = `قم بدور "مهندس العروض التجارية (AI Offer Builder)": ابنِ وقارن بين سيناريوهات العروض (العرض أ: السعر الأساسي، العرض ب: التوصيل المجاني، العرض ج: باقة قطعتين Bundle، العرض د: هدية + شحن مجاني). احسب الهوامش، تكلفة الإعلان المقبولة (Max CAC)، ونقطة التعادل وسمِّ العرض الفائز تجارياً مع توضيح المخاطر.`;
      break;
    case 'budget_commander':
      userTaskPrompt = `قم بدور "قائد إدارة الميزانية وحماية رأس المال (Budget Commander)": التاجر يسألك عن توزيع ميزانية إعلانية (مثلاً 10,000 أو 20,000 دج). ابنِ 3 سيناريوهات: المحافظ (Conservative)، المتوقع (Base)، والمتفائل (Optimistic). حدد ميزانية التوسع، ميزانية الاختبار، الاحتياطي، وسقف الخسارة (Stop-Loss).`;
      break;
    case 'product_profitability':
      userTaskPrompt = `قم بدور "مدير محفظة المنتجات والربحية (Product Portfolio Manager)": صنّف المنتجات وفق مصفوفة الربحية الـ 6 (HIGHLY PROFITABLE، PROFITABLE، MARGIN PRESSURE، HIGH RISK، LOSING MONEY، INSUFFICIENT DATA). حدد المنتجات الجديرة بالتوسع، والمنتجات الخاسرة الواجب إيقافها، والمنتجات الناقصة البيانات.`;
      break;
    case 'delivery_intelligence':
      userTaskPrompt = `قم بدور "محلل استخبارات التوصيل والولايات (Delivery & Wilayas Intelligence)": حلل مصفوفة الولايات الـ 58 والتسليم للمنزل مقابل المكتب (Stop Desk). حدد الولايات الأعلى ربحية وتسليماً، والولايات عالية المخاطر أو ذات تكلفة الإرجاع المرتفعة، واقترح استراتيجيات شحن تقلل الهدر المالي.`;
      break;
    case 'inventory_risk':
      userTaskPrompt = `قم بدور "مدير حماية المخزون ورأس المال (Inventory & Stock Risk Manager)": اربط وتيرة المبيعات (Sales Velocity) بالمخزون المتبقي ومعدل الإنفاق الإعلاني. أطلق تحذيرات للمنتجات ذات المخزون المنخفض قبل التوسع الإعلاني لمنع نفاد المخزون وهدر الميزانية.`;
      break;
    case 'experiment_manager':
    case 'growth_experiments':
      userTaskPrompt = `قم بدور "مدير التجارب التسويقية والنمو العلمي (Experiment & Growth Manager)": صِغ تجارب نمو منضبطة تشمل: {الفرضية HYPOTHESIS، المتغير VARIABLE، التحكم CONTROL، الميزانية BUDGET، المدة DURATION، المؤشر الأساسي PRIMARY KPI، شرط الإيقاف STOP-LOSS، والنتيجة المتوقعة}. وحدد آلية التعلم (KEEP | SCALE | MODIFY | KILL).`;
      break;
    case 'store_overview':
      userTaskPrompt = `قم بتحليل شامل لأداء المتجر العام: المبيعات، الطلبيات، نسبة التأكيد والإلغاء، مصفوفة الولايات، المخزون، وأهم 3 قرارات استراتيجية لزيادة المبيعات وتحسين نسبة الاستلام والأرباح الصافية.`;
      break;
    case 'sales_analysis':
      userTaskPrompt = `قم بتحليل تفصيلي للمبيعات والإيرادات: متوسط قيمة الطلب (AOV)، نسبة الإلغاء، الولايات الأكثر ربحية وتسليماً، وتحديد هوامش الربح الحقيقية ونقاط الهدر.`;
      break;
    case 'product_performance':
      userTaskPrompt = `قم بتحليل أداء المنتجات: المنتجات الأكثر مبيعاً، المنتجات الراكدة، تنبيهات المخزون المنخفض، وأسعار الشراء بالجملة وهوامش الربح لكل منتج واقتراح باقات وعروض رابحة.`;
      break;
    case 'campaign_analysis':
      userTaskPrompt = `قم بتحليل أداء الحملات الإعلانية ومؤشرات ROAS و CPA و CTR. إذا كانت بيانات Meta متصلة، حدد الحملات الرابحة والتي تستنزف الميزانية. إذا لم تكن متصلة، وضح ذلك واقترح استراتيجية إعلانية للمنتجات الأكثر طلباً في فيسبوك وتيك توك.`;
      break;
    case 'budget_recommendations':
      userTaskPrompt = `قم بتحليل الهدر المالي: أين يخسر المتجر المال؟ (مثل الولايات ذات نسب الإلغاء العالية، المنتجات المنخفضة المخزون، أو الحملات ذات الـ CPA المرتفع) واقترح إعادة توزيع أفضل للميزانية بدون خسارة.`;
      break;
    case 'action_plan':
      userTaskPrompt = `ماذا أفعل اليوم؟ قدم خطة عمل يومية تنفيذية من 3 إلى 5 مهام تجارية ذات أولوية قصوى لزيادة المبيعات وتحسين نسبة التأكيد وحل المشاكل القائمة.`;
      break;
    case 'whatsapp_draft':
      userTaskPrompt = customPrompt
        ? `صِغ مسودة رسالة WhatsApp مخصصة للعميل بناءً على السيناريو والتعليمات المحددة التالية: "${customPrompt}". تفاصيل الطلبية المحددة أدناه. التزم بنبرة مهذبة ومحترفة ومطمئنة باللهجة البيضاء المناسبة للسوق الجزائري.`
        : `صِغ مسودة رسالة WhatsApp احترافية ومخصصة للعميل بناءً على بيانات الطلبية المحددة أدناه. اختر نبرة مهذبة ومناسبة للسوق الجزائري (تأكيد الطلب وتحديد موعد التوصيل).`;
      break;
    case 'chat':
    default:
      userTaskPrompt = customPrompt || `حلل الوضع التجاري للمتجر وقدم أهم التوصيات والقرارات المالية.`;
      break;
  }

  // بناء هيكل المحادثة مع دعم الذاكرة التراكمية (Multi-turn Chat Memory حتى 16 دورة)
  const contents = [];

  if (isChatMode && Array.isArray(params.history) && params.history.length > 0) {
    params.history.slice(-16).forEach(msg => {
      const r = (msg.role === 'model' || msg.role === 'assistant') ? 'model' : 'user';
      const t = sanitize(msg.text || msg.content || '', 4000);
      if (t) {
        contents.push({
          role: r,
          parts: [{ text: t }]
        });
      }
    });
  }

  const currentPayloadObj = {
    mode: mode,
    user_task: userTaskPrompt,
    custom_question: customPrompt || null,
    aggregated_store_metrics: aggregatedData,
    target_order_snapshot: orderSnapshot
  };

  if (isChatMode) {
    contents.push({
      role: 'user',
      parts: [
        {
          text: `سؤال واستشارة التاجر:\n"${userTaskPrompt}"\n\nبيانات وسجلات المتجر المتاحة في قاعدة البيانات:\n${JSON.stringify(aggregatedData)}\n${orderSnapshot ? `\nتفاصيل الطلبية المحددة:\n` + JSON.stringify(orderSnapshot) : ''}\n\nأجب كخبير تجارة إلكترونية وسلوك مستهلك جزائري بإجابة وافية ومفصلة ومنسقة بـ Markdown غني وعناوين واضحة وجداول وقوائم عملية.`
        }
      ]
    });
  } else {
    // في أوضاع التقارير المهيكلة: فرض صيغة JSON وافية ومعيارية لنظام التشغيل التجاري
    const jsonInstructions = `
الإجابة حصراً بصيغة JSON وفق البنية المحددة بدقة دون أي اختصار مخل:
{
  "decision": "SCALE | MAINTAIN | OPTIMIZE | TEST | REDUCE | STOP | INSUFFICIENT_DATA",
  "top_priority_today": "أهم إجراء فردي يجب تنفيذه اليوم فوراً لحماية الأرباح ورأس المال...",
  "financial_impact": "الأثر المالي الصافي على Net Delivered Profit...",
  "summary": "موجز تحليلي واستراتيجي صريح ومفصل...",
  "health": "good | warning | critical | insufficient_data",
  "key_metrics": [
    { "label": "إجمالي الإيرادات", "value": "125,000 دج", "status": "positive" },
    { "label": "صافي الربح المستلم", "value": "35,000 دج", "status": "positive" }
  ],
  "insights": [
    "ملاحظة وتحليل 1...",
    "ملاحظة وتحليل 2..."
  ],
  "problems": [
    "مشكلة وهدر مرصود إن وجد..."
  ],
  "recommendations": [
    {
      "priority": "high | medium | low",
      "title": "عنوان التوصية",
      "reason": "السبب والتحليل الميداني",
      "evidence": ["دليل رقمي 1", "دليل رقمي 2"],
      "action": "الإجراء المقترح تنفيذه من الأدمن"
    }
  ],
  "experiment": {
    "hypothesis": "الفرضية التسويقية...",
    "test": "التجربة العملية...",
    "variable": "المتغير المراد اختباره...",
    "budget": "الميزانية المخصصة...",
    "duration": "المدة المقترحة...",
    "primary_kpi": "المؤشر الأساسي...",
    "stop_loss": "حد الإيقاف الفوري لمنع الخسارة..."
  },
  "whatsapp_draft": {
    "target_case": "تأكيد الطلب | تذكير | متابعة شحن",
    "customer_name": "اسم العميل",
    "message": "السلام عليكم أخي...",
    "note": "مسودة مقترحة — يرجى مراجعتها وتعديلها قبل الإرسال اليدوي"
  }
}
`.trim();

    contents.push({
      role: 'user',
      parts: [
        {
          text: `${jsonInstructions}\n\nبيانات المتجر والطلب المطلوب تحليله:\n${JSON.stringify(currentPayloadObj)}`
        }
      ]
    });
  }

  const generationConfig = {
    temperature: isChatMode ? 0.35 : 0.2,
    maxOutputTokens: 8192
  };

  if (!isChatMode) {
    generationConfig.responseMimeType = "application/json";
  }

  const promptPayload = {
    system_instruction: {
      parts: [{ text: systemInstruction }]
    },
    contents: contents,
    generationConfig: generationConfig
  };

  try {
    const resolver = new GeminiModelResolver(env);
    const aiResult = await resolver.generateContentWithFailover(apiKey, promptPayload, { timeoutMs: 30000 });

    if (!aiResult.ok) {
      return {
        ok: false,
        error: aiResult.error || 'تعذر الحصول على استجابة من الذكاء الاصطناعي حالياً (يرجى التحقق من صحة المفتاح ورصيد الحساب)'
      };
    }

    const rawReply = aiResult.reply || '';
    let parsedData = null;

    if (!isChatMode) {
      try {
        parsedData = JSON.parse(rawReply);
      } catch (e) {
        console.warn('[Gemini Non-JSON Output Fallback]', rawReply);
        parsedData = {
          summary: rawReply,
          health: 'good',
          key_metrics: [],
          insights: [],
          problems: [],
          recommendations: [],
          whatsapp_draft: null
        };
      }
    }

    return {
      ok: true,
      mode: mode,
      is_chat: isChatMode,
      text: rawReply,
      data: parsedData,
      model_used: aiResult.model_used,
      raw_metrics: aggregatedData,
      timestamp: new Date().toISOString()
    };

  } catch (err) {
    console.error('[adminAiChat Exception]', err);
    return { ok: false, error: 'تعذر الاتصال بمحرك الذكاء الاصطناعي، يرجى المحاولة لاحقاً.' };
  }
}
