/**
 * Smart Shopping — Cloudflare Worker
 * ملف: src/handlers/analytics.js
 * 
 * معالج التحليلات وإسناد الحملات الإعلانية ومزامنة Meta Insights API
 * ─────────────────────────────────────────────────────────────
 * Public:
 *   trackPublicAnalyticsEvent() → action=track_analytics_event
 * 
 * Admin (تتطلب token):
 *   getCampaignAnalytics()       → action=admin_campaign_analytics
 */

import { sanitize } from '../utils/sanitize.js';
import { DEFAULT_MASTER_TENANT_ID } from '../utils/auth.js';

/**
 * [PUBLIC] تسجيل حدث سلوكي / تحليلي خفيف غير معطل
 */
export async function trackPublicAnalyticsEvent(env, params = {}, request, tenantId = DEFAULT_MASTER_TENANT_ID) {
  try {
    const eventName   = sanitize(params.event_name, 50) || 'PageView';
    const productId   = sanitize(params.product_id, 100);
    const sessionId   = sanitize(params.session_id, 100);
    const utmSource   = sanitize(params.utm_source, 100);
    const utmMedium   = sanitize(params.utm_medium, 100);
    const utmCampaign = sanitize(params.utm_campaign, 100);
    const utmTerm     = sanitize(params.utm_term, 100);
    const utmContent  = sanitize(params.utm_content, 150);
    const fbclid      = sanitize(params.fbclid, 150);
    const ipCountry   = request?.headers?.get('CF-IPCountry') || '';

    await env.DB.prepare(`
      INSERT INTO analytics_events (
        tenant_id, session_id, event_name, product_id,
        utm_source, utm_medium, utm_campaign, utm_term, utm_content,
        fbclid, ip_country
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      tenantId, sessionId, eventName, productId,
      utmSource, utmMedium, utmCampaign, utmTerm, utmContent,
      fbclid, ipCountry
    ).run();

    return { ok: true };
  } catch (err) {
    // Fail-safe: لا تُعطّل تجربة الزبون أبداً
    return { ok: true, ignored_error: err?.message };
  }
}

/**
 * توليد استعلام النطاق الزمني لـ SQLite
 */
function buildDateCondition(preset) {
  switch (preset) {
    case 'today':
      return "date(created_at) = date('now')";
    case 'yesterday':
      return "date(created_at) = date('now', '-1 day')";
    case 'last_7d':
      return "created_at >= datetime('now', '-7 days')";
    case 'last_30d':
      return "created_at >= datetime('now', '-30 days')";
    case 'maximum':
    case 'lifetime':
    case 'all':
      return "1=1";
    default:
      return "date(created_at) = date('now')";
  }
}

/**
 * تحويل الـ preset لصيغة Meta Graph API
 */
function mapPresetToMeta(preset) {
  switch (preset) {
    case 'today': return 'today';
    case 'yesterday': return 'yesterday';
    case 'last_7d': return 'last_7d';
    case 'last_30d': return 'last_30d';
    case 'maximum':
    case 'lifetime':
    case 'all':
      return 'maximum';
    default: return 'today';
  }
}

/**
 * [ADMIN] لوحة تحليلات الحملات والأرباح ومزامنة Meta Insights API
 */
export async function getCampaignAnalytics(env, params = {}, tenantId = DEFAULT_MASTER_TENANT_ID) {
  try {
    const preset = sanitize(params.preset, 30) || 'today';
    const dateCondition = buildDateCondition(preset);
    const metaPreset = mapPresetToMeta(preset);

    // 1. جلب إعدادات Meta وحساب العملة من D1
    const { results: settingRows } = await env.DB.prepare(`
      SELECT key, value FROM settings WHERE key IN (
        'fb_capi_token', 'fb_ad_account_id', 'ad_account_id', 'usd_to_dzd_rate',
        'fb_pixel_id', 'pixel_id', 'estimated_product_cost_pct'
      ) AND (tenant_id = ? OR tenant_id IS NULL)
    `).bind(tenantId).all();

    const settings = {};
    settingRows.forEach(r => { settings[r.key] = r.value; });

    const fbToken = settings.fb_capi_token || '';
    const rawAdAccountId = params.ad_account_id || settings.fb_ad_account_id || settings.ad_account_id || '';
    const cleanAdAccountId = String(rawAdAccountId).trim().replace(/^act_/, '');
    const usdToDzdRate = Number(params.usd_to_dzd || settings.usd_to_dzd_rate) || 230;
    const productCostPct = Number(settings.estimated_product_cost_pct) || 30; // افتراضي 30% من سعر المنتج

    // 2. جلب بيانات الإنفاق من Meta Graph Insights API (مع عزل أمني وفشل آمن)
    let metaAdsData = [];
    let metaError = null;
    let metaConnected = false;

    if (fbToken && cleanAdAccountId) {
      try {
        const metaUrl = `https://graph.facebook.com/v19.0/act_${cleanAdAccountId}/insights?level=ad&date_preset=${metaPreset}&fields=campaign_name,adset_name,ad_name,spend,impressions,clicks,cpc,ctr&limit=500&access_token=${encodeURIComponent(fbToken)}`;
        const metaRes = await fetch(metaUrl, { method: 'GET', headers: { 'Accept': 'application/json' } });
        const metaJson = await metaRes.json();

        if (metaRes.ok && Array.isArray(metaJson.data)) {
          metaAdsData = metaJson.data;
          metaConnected = true;
        } else if (metaJson.error) {
          metaError = metaJson.error.message || 'خطأ في استجابة Meta Graph API';
          console.warn('[Meta Insights Error]', metaJson.error);
        }
      } catch (mErr) {
        metaError = mErr.message || 'تعذر الاتصال بـ Meta API';
        console.warn('[Meta Insights Fetch Exception]', mErr);
      }
    }

    // 3. جلب بيانات الطلبات المسجلة في D1 ومجموع المبيعات
    let ordersRows = [];
    try {
      const { results: oRows } = await env.DB.prepare(`
        SELECT 
          COALESCE(NULLIF(utm_campaign, ''), '[Direct / Organic]') AS utm_campaign,
          COALESCE(NULLIF(utm_term, ''), '[Unspecified AdSet]') AS utm_term,
          COALESCE(NULLIF(utm_content, ''), '[Unspecified Ad]') AS utm_content,
          status,
          COUNT(*) AS order_count,
          SUM(COALESCE(subtotal, 0) - COALESCE(discount, 0) + COALESCE(shipping_cost, 0)) AS total_revenue,
          SUM(COALESCE(subtotal, 0)) AS total_subtotal,
          SUM(COALESCE(shipping_cost, 0)) AS total_shipping
        FROM orders
        WHERE (tenant_id = ? OR tenant_id IS NULL) AND ${dateCondition}
        GROUP BY utm_campaign, utm_term, utm_content, status
      `).bind(tenantId).all();
      ordersRows = oRows || [];
    } catch (dbErr) {
      console.warn('[Analytics D1 Orders Query Warning]', dbErr?.message);
    }

    // 4. جلب أحداث الزوار وبدء إتمام الشراء من D1
    let eventsRows = [];
    try {
      const { results: eRows } = await env.DB.prepare(`
        SELECT 
          COALESCE(NULLIF(utm_campaign, ''), '[Direct / Organic]') AS utm_campaign,
          COALESCE(NULLIF(utm_term, ''), '[Unspecified AdSet]') AS utm_term,
          COALESCE(NULLIF(utm_content, ''), '[Unspecified Ad]') AS utm_content,
          event_name,
          COUNT(*) AS event_count
        FROM analytics_events
        WHERE (tenant_id = ? OR tenant_id IS NULL) AND ${dateCondition}
        GROUP BY utm_campaign, utm_term, utm_content, event_name
      `).bind(tenantId).all();
      eventsRows = eRows || [];
    } catch (eDbErr) {
      console.warn('[Analytics D1 Events Query Warning]', eDbErr?.message);
    }

    // 5. دمج وهيكلة البيانات (Campaign -> AdSet -> Ad)
    const tree = new Map();

    function getOrCreateNode(map, key, defaults = {}) {
      if (!map.has(key)) {
        map.set(key, {
          name: key,
          spend_usd: 0,
          spend_dzd: 0,
          impressions: 0,
          clicks: 0,
          visitors: 0,
          initiate_checkout: 0,
          purchases: 0,
          confirmed_orders: 0,
          cancelled_orders: 0,
          revenue_dzd: 0,
          estimated_profit_dzd: 0,
          children: new Map(),
          ...defaults
        });
      }
      return map.get(key);
    }

    // دمج بيانات Meta Ads
    metaAdsData.forEach(ad => {
      const cName = ad.campaign_name || '[Unassigned Campaign]';
      const sName = ad.adset_name || '[Unassigned AdSet]';
      const aName = ad.ad_name || '[Unassigned Ad]';

      const spendUsd = parseFloat(ad.spend || 0);
      const spendDzd = Math.round(spendUsd * usdToDzdRate);
      const impressions = parseInt(ad.impressions || 0, 10);
      const clicks = parseInt(ad.clicks || 0, 10);

      // Campaign Node
      const cNode = getOrCreateNode(tree, cName);
      cNode.spend_usd += spendUsd;
      cNode.spend_dzd += spendDzd;
      cNode.impressions += impressions;
      cNode.clicks += clicks;

      // AdSet Node
      const sNode = getOrCreateNode(cNode.children, sName);
      sNode.spend_usd += spendUsd;
      sNode.spend_dzd += spendDzd;
      sNode.impressions += impressions;
      sNode.clicks += clicks;

      // Ad Node
      const aNode = getOrCreateNode(sNode.children, aName);
      aNode.spend_usd += spendUsd;
      aNode.spend_dzd += spendDzd;
      aNode.impressions += impressions;
      aNode.clicks += clicks;
    });

    // دمج بيانات أحداث D1 (Visitors / InitiateCheckout)
    eventsRows.forEach(row => {
      const cName = row.utm_campaign;
      const sName = row.utm_term;
      const aName = row.utm_content;
      const count = Number(row.event_count || 0);

      const cNode = getOrCreateNode(tree, cName);
      const sNode = getOrCreateNode(cNode.children, sName);
      const aNode = getOrCreateNode(sNode.children, aName);

      if (row.event_name === 'PageView' || row.event_name === 'ViewContent') {
        cNode.visitors += count;
        sNode.visitors += count;
        aNode.visitors += count;
      } else if (row.event_name === 'InitiateCheckout') {
        cNode.initiate_checkout += count;
        sNode.initiate_checkout += count;
        aNode.initiate_checkout += count;
      }
    });

    // دمج بيانات الطلبات والمبيعات من D1
    ordersRows.forEach(row => {
      const cName = row.utm_campaign;
      const sName = row.utm_term;
      const aName = row.utm_content;
      const count = Number(row.order_count || 0);
      const revenue = Number(row.total_revenue || 0);

      const cNode = getOrCreateNode(tree, cName);
      const sNode = getOrCreateNode(cNode.children, sName);
      const aNode = getOrCreateNode(sNode.children, aName);

      cNode.purchases += count;
      cNode.revenue_dzd += revenue;

      sNode.purchases += count;
      sNode.revenue_dzd += revenue;

      aNode.purchases += count;
      aNode.revenue_dzd += revenue;

      if (row.status === 'confirmed' || row.status === 'shipped' || row.status === 'delivered') {
        cNode.confirmed_orders += count;
        sNode.confirmed_orders += count;
        aNode.confirmed_orders += count;
      } else if (row.status === 'cancelled') {
        cNode.cancelled_orders += count;
        sNode.cancelled_orders += count;
        aNode.cancelled_orders += count;
      }
    });

    // 6. حساب المؤشرات المشتقة وتحويل الشجرة إلى مصفوفات
    let totalSpendUsd = 0;
    let totalSpendDzd = 0;
    let totalImpressions = 0;
    let totalClicks = 0;
    let totalVisitors = 0;
    let totalCheckouts = 0;
    let totalOrders = 0;
    let totalRevenueDzd = 0;

    function finalizeNode(node) {
      // إذا كانت الزيارات من D1 صفر، ولكن توجد نقرات من Meta، نستخدم النقرات كتقدير أدنى للزيارات
      const effectiveVisitors = Math.max(node.visitors, node.clicks);
      node.visitors = effectiveVisitors;

      // CTR (Link Click-Through Rate)
      node.ctr = node.impressions > 0 ? ((node.clicks / node.impressions) * 100).toFixed(2) + '%' : '0.00%';

      // Conversion Rate % (CR)
      node.cr = effectiveVisitors > 0 ? ((node.purchases / effectiveVisitors) * 100).toFixed(2) + '%' : '0.00%';

      // CPA (Cost Per Result / Order) in DZD
      node.cpa_dzd = node.purchases > 0 ? Math.round(node.spend_dzd / node.purchases) : (node.spend_dzd > 0 ? node.spend_dzd : 0);

      // ROAS (Return on Ad Spend)
      node.roas = node.spend_dzd > 0 ? (node.revenue_dzd / node.spend_dzd).toFixed(2) + 'x' : (node.revenue_dzd > 0 ? '∞' : '0.00x');

      // Estimated Net Profit = Revenue - (Ad Spend + Estimated Product Cost)
      const estimatedCost = Math.round(node.revenue_dzd * (productCostPct / 100));
      node.estimated_profit_dzd = Math.round(node.revenue_dzd - node.spend_dzd - estimatedCost);

      // Status Indicator
      if (node.name.includes('Direct') || node.name.includes('Organic')) {
        node.status_badge = '🌐 Direct';
      } else if (node.spend_dzd > 0 || node.clicks > 0) {
        node.status_badge = '🟢 Active';
      } else {
        node.status_badge = '⚪ Inactive';
      }

      // Convert children Map to Array recursively
      const childArray = [];
      for (const [_, childNode] of node.children) {
        childArray.push(finalizeNode(childNode));
      }
      // Sort children by Revenue DESC, then Spend DESC
      childArray.sort((a, b) => b.revenue_dzd - a.revenue_dzd || b.spend_dzd - a.spend_dzd);
      node.children = childArray;

      return node;
    }

    const campaigns = [];
    for (const [_, cNode] of tree) {
      const finalized = finalizeNode(cNode);
      campaigns.push(finalized);

      totalSpendUsd += finalized.spend_usd;
      totalSpendDzd += finalized.spend_dzd;
      totalImpressions += finalized.impressions;
      totalClicks += finalized.clicks;
      totalVisitors += finalized.visitors;
      totalCheckouts += finalized.initiate_checkout;
      totalOrders += finalized.purchases;
      totalRevenueDzd += finalized.revenue_dzd;
    }

    // فرز الحملات حسب الإيرادات والإنفاق
    campaigns.sort((a, b) => b.revenue_dzd - a.revenue_dzd || b.spend_dzd - a.spend_dzd);

    const overallRoas = totalSpendDzd > 0 ? (totalRevenueDzd / totalSpendDzd).toFixed(2) + 'x' : (totalRevenueDzd > 0 ? '∞' : '0.00x');
    const overallCpa = totalOrders > 0 ? Math.round(totalSpendDzd / totalOrders) : (totalSpendDzd > 0 ? totalSpendDzd : 0);
    const overallCtr = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) + '%' : '0.00%';
    const overallCr = totalVisitors > 0 ? ((totalOrders / totalVisitors) * 100).toFixed(2) + '%' : '0.00%';
    const totalEstimatedCost = Math.round(totalRevenueDzd * (productCostPct / 100));
    const totalNetProfit = Math.round(totalRevenueDzd - totalSpendDzd - totalEstimatedCost);

    return {
      ok: true,
      data: {
        summary: {
          total_spend_usd: Math.round(totalSpendUsd * 100) / 100,
          total_spend_dzd: totalSpendDzd,
          total_impressions: totalImpressions,
          total_clicks: totalClicks,
          total_visitors: totalVisitors,
          total_checkouts: totalCheckouts,
          total_orders: totalOrders,
          total_revenue_dzd: totalRevenueDzd,
          overall_roas: overallRoas,
          overall_cpa_dzd: overallCpa,
          overall_ctr: overallCtr,
          overall_cr: overallCr,
          total_net_profit_dzd: totalNetProfit
        },
        campaigns: campaigns,
        meta_connected: metaConnected,
        meta_error: metaError,
        ad_account_id: cleanAdAccountId ? `act_${cleanAdAccountId}` : '',
        currency_rate: usdToDzdRate,
        preset: preset
      }
    };
  } catch (err) {
    console.error('[getCampaignAnalytics Fatal Error]', err);
    return {
      ok: false,
      error: {
        code: 'ANALYTICS_ERROR',
        message: 'تعذر جلب بيانات التحليلات: ' + err.message
      }
    };
  }
}
