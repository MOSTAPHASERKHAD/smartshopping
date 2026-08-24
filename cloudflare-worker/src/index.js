/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║          Smart Shopping — Cloudflare Worker (API Gateway)        ║
 * ║                        src/index.js                              ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  يُحاكي سلوك Google Apps Script (doGet + doPost) تماماً         ║
 * ║  مع دعم action-based routing، CORS، Auth، و JSON موحد          ║
 * ╚══════════════════════════════════════════════════════════════════╝
 * 
 * الفلسفة المعمارية:
 * ─────────────────
 * 1. كل الطلبات (GET و POST) تمر عبر نقطة دخول واحدة: fetch()
 * 2. يُحلَّل الـ action من الـ query string أو body
 * 3. يُطبَّق adminGate() قبل تنفيذ أي action محمي
 * 4. كل استجابة بصيغة JSON موحدة { ok, data } أو { ok, error }
 * 5. CORS يُطبَّق على جميع الاستجابات بما فيها OPTIONS (preflight)
 * 
 * توافق الـ Frontend الحالي:
 * ─────────────────────────
 * - يرسل action=catalog, action=order, action=admin_orders ...إلخ
 * - يرسل token في params أو headers
 * - يتوقع JSON مباشراً (نفس ما كان يرسله GAS)
 */

import { buildCorsHeaders, jsonResponse } from './utils/response.js';
import { adminGate, validateSession, resolveTenant, recordAuditLog, DEFAULT_MASTER_TENANT_ID } from './utils/auth.js';
import { canExecuteAction, ROLES } from './utils/rbac.js';
import { sanitize, sanitizePhone } from './utils/sanitize.js';

// ── استيراد معالجات الكتالوج ──
import {
  getCatalog, getSettings, getStoreContext, getTestimonials,
  getReviews, getPages, validateCoupon,
  adminListProducts, adminAddProduct,
  adminEditProduct,  adminDeleteProduct,
} from './handlers/catalog.js';

// ── استيراد معالجات الطلبات ──
import {
  createOrder, trackOrder, customerOrders,
  adminListOrders, adminUpdateOrder, adminDeleteOrder,
} from './handlers/orders.js';

// ── استيراد معالجات العملاء ──
import {
  customerRegister, customerLogin, customerProfile, customerLogout,
  adminListCustomers
} from './handlers/customers.js';

// ── استيراد معالجات النشرة البريدية ──
import {
  newsletterSubscribe, adminListSubscribers
} from './handlers/subscribers.js';

// ── استيراد معالجات الثيمات والأقسام الديناميكية ──
import {
  adminListThemes, adminGetTheme, adminSaveTheme, adminDeleteTheme, adminSetDefaultTheme,
  adminSaveThemeSections, getThemeSections
} from './handlers/themes.js';

// ── استيراد معالجات الرفع (Uploads) ──
import {
  publicUploadImage, adminUploadImage, adminDeleteMedia, serveMedia,
} from './handlers/uploads.js';

// ── استيراد معالجات التسويق والتحليلات (CAPI & Analytics) ──
import { adminCapiTest } from './handlers/marketing.js';
import { trackPublicAnalyticsEvent, getCampaignAnalytics } from './handlers/analytics.js';

// ── استيراد معالجات الذكاء الاصطناعي ──
import { adminAiChat } from './handlers/ai.js';

// ── استيراد معالجات مصادقة التجار (Phase 29) ──
import {
  authRegister, authLogin, authLogout, authMe,
  authForgotPassword, authResetPassword, authVerifyEmail, authResendVerification,
  authChangePassword, authListSessions, authRevokeAll,
} from './handlers/merchant_auth.js';

// ── استيراد معالجات الأدمن ──
import {
  verifyAdmin, adminLogout, adminUpdateSettings, adminTestNotification,
  adminListCoupons, adminAddCoupon, adminEditCoupon, adminDeleteCoupon,
  adminListTestimonials, adminAddTestimonial,
  adminEditTestimonial,  adminDeleteTestimonial,
  adminListReviews, adminDeleteReview, adminApproveReview,
  adminListPages, adminSavePage, adminListAuditLogs,
} from './handlers/admin.js';

// ── استيراد معالجات الإدارة المركزية (Super Admin & Platform) ──
import {
  superListTenants, superPlatformStats, superUpdateTenant,
} from './handlers/super_admin.js';

// ════════════════════════════════════════════
// ── نقطة الدخول الوحيدة للـ Worker ──
// ════════════════════════════════════════════
export default {
  /**
   * المعالج الرئيسي: يستقبل كل الطلبات الواردة
   * @param {Request} request
   * @param {Env}     env       - متغيرات البيئة + bindings (DB, CACHE)
   * @param {ExecutionContext} ctx
   */
  async fetch(request, env, ctx) {

    // ── 1. استخراج أصل الطلب لبناء ترويسات CORS ──
    const origin      = request.headers.get('Origin') || '';
    const corsHeaders = buildCorsHeaders(origin, env.ALLOWED_ORIGINS || '*');

    // ── 2. معالجة Preflight (OPTIONS) ──
    // المتصفح يرسلها قبل كل طلب cross-origin
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // ── 2.5. مسار تقديم ملفات R2 المرفوعة: GET /media/<key> ──
    if (request.method === 'GET') {
      const pathname = new URL(request.url).pathname;
      if (pathname.startsWith('/media/')) {
        const key = decodeURIComponent(pathname.slice('/media/'.length));
        const mediaCors = { 'Access-Control-Allow-Origin': '*', 'Vary': 'Origin' };
        return serveMedia(env, key, request, mediaCors);
      }
    }

    // ── 3. السماح بـ GET و POST فقط ──
    if (!['GET', 'POST'].includes(request.method)) {
      return jsonResponse(
        { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'GET و POST فقط مسموح بهما' } },
        405, corsHeaders,
      );
    }

    // ── 4. تحليل الـ params من URL أو Body ──
    let params = {};
    try {
      params = await parseParams(request);
    } catch (e) {
      return jsonResponse(
        { ok: false, error: { code: 'BAD_REQUEST', message: 'تعذَّر تحليل بيانات الطلب' } },
        400, corsHeaders,
      );
    }

    const action = String(params.action || '').trim();

    if (!action) {
      // ── تقديم الملفات الثابتة لمتاجر الـ Subdomain من أصل Pages المحمي ──
      if (request.method === 'GET') {
        const url = new URL(request.url);
        const resolvedTenant = await resolveTenant(request, env, null, null);
        if (resolvedTenant && typeof resolvedTenant === 'object' && resolvedTenant.error === 'STORE_SUSPENDED') {
          return jsonResponse(
            { ok: false, error: { code: 'STORE_SUSPENDED', message: 'هذا المتجر موقوف مؤقتاً' } },
            403, corsHeaders,
          );
        }
        if (!resolvedTenant) {
          return jsonResponse(
            { ok: false, error: { code: 'STORE_NOT_FOUND', message: 'المتجر غير موجود' } },
            404, corsHeaders,
          );
        }

        const PAGES_ORIGIN = 'https://smartshopping-76x.pages.dev';
        const targetUrl = new URL(url.pathname + url.search, PAGES_ORIGIN);
        const pagesRes = await fetch(targetUrl.toString(), {
          method: 'GET',
          headers: {
            'Accept': request.headers.get('Accept') || '*/*',
            'Accept-Encoding': request.headers.get('Accept-Encoding') || 'gzip, deflate, br',
            'User-Agent': request.headers.get('User-Agent') || 'Cloudflare-Worker-Router',
          },
        });

        const newHeaders = new Headers(pagesRes.headers);
        newHeaders.set('Vary', 'Origin, Host');
        newHeaders.set('X-Content-Type-Options', 'nosniff');
        return new Response(pagesRes.body, {
          status: pagesRes.status,
          statusText: pagesRes.statusText,
          headers: newHeaders,
        });
      }

      return jsonResponse(
        { ok: false, error: { code: 'MISSING_ACTION', message: 'المتغير action مطلوب' } },
        400, corsHeaders,
      );
    }

    // ── 5. استخراج وتحقق الـ token (من params أو Authorization header) ──
    const token =
      params.token ||
      (request.headers.get('Authorization') || '').replace('Bearer ', '').trim() ||
      request.headers.get('X-Admin-Token') ||
      null;

    let authSession = null;
    if (token) {
      const sessionRes = await validateSession(env.DB, token);
      if (sessionRes.valid) {
        authSession = sessionRes.session;
      }
    }

    // ── 5.5. تحديد سياق التاجر الموثوق على الخادم (Authoritative Tenant Resolution) ──
    // لا نثق بأي tenant_id مرسل من العميل؛ إذا كانت الجلسة مصادقة يُشتق من الجلسة حصرياً.
    const explicitSlug = params.store || params.tenant_slug || params.slug || null;
    const resolvedTenant = await resolveTenant(request, env, authSession, explicitSlug);

    let tenantId = null;
    let tenantError = null;

    if (resolvedTenant && typeof resolvedTenant === 'object' && resolvedTenant.error) {
      tenantError = resolvedTenant.error;
      tenantId = resolvedTenant.tenantId;
    } else {
      tenantId = resolvedTenant;
    }

    // التحقق من حالة المستأجر للمسارات العامة
    if (!authSession && !action.startsWith('auth_')) {
      if (tenantError === 'STORE_SUSPENDED') {
        return jsonResponse(
          { ok: false, error: { code: 'STORE_SUSPENDED', message: 'هذا المتجر موقوف مؤقتاً' } },
          403, corsHeaders,
        );
      }
      if (!tenantId) {
        return jsonResponse(
          { ok: false, error: { code: 'STORE_NOT_FOUND', message: 'المتجر غير موجود' } },
          404, corsHeaders,
        );
      }
    }

    // ── 6. تطبيق حارس المسارات المحمية و RBAC ──
    const isAuthorized = await adminGate(action, token, env.DB);
    if (!isAuthorized) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code:    'UNAUTHORIZED',
            message: 'غير مصرح: انتهت الجلسة. سجل الدخول من جديد.',
          },
        },
        401, corsHeaders,
      );
    }

    // التحقق من صلاحيات الدور (RBAC Matrix)
    if (action.startsWith('admin_') && authSession && authSession.role) {
      const allowed = canExecuteAction(authSession.role, action, authSession.tenantId);
      if (!allowed) {
        return jsonResponse(
          {
            ok: false,
            error: {
              code:    'FORBIDDEN',
              message: 'ليس لديك الصلاحية الكافية لتنفيذ هذا الإجراء',
            },
          },
          403, corsHeaders,
        );
      }
    }

    // ── 7. توجيه الطلب (Router) ──
    let result;

    try {
      result = await route(action, params, token, env, ctx, request, tenantId, authSession);

      // تسجيل العمليات الإدارية الحساسة في سجل التدقيق
      if (action.startsWith('admin_') && action !== 'admin_list' && action !== 'admin_orders') {
        ctx.waitUntil(recordAuditLog(env.DB, {
          tenant_id: tenantId,
          user_id: authSession?.userId || 'admin',
          action: action,
          resource_type: action.replace('admin_', '').split('_')[0],
          resource_id: params.id || params.order_id || params.code || null,
          metadata: { ok: result?.ok },
          request,
        }));
      }
    } catch (error) {
      // خطأ غير متوقع: سجِّله دون كشفه للمستخدم
      console.error(`[Worker Error] action=${action}`, error?.message, error?.stack);
      return jsonResponse(
        {
          ok: false,
          error: {
            code:    'INTERNAL_ERROR',
            message: 'حدث خطأ داخلي، يرجى المحاولة مجدداً',
          },
        },
        500, corsHeaders,
      );
    }

    // ── 8. إرجاع النتيجة بصيغة JSON موحدة ──
    return jsonResponse(result, 200, corsHeaders);
  },
};

// ════════════════════════════════════════════
// ── الـ Router ──
// ════════════════════════════════════════════

/**
 * توجيه الـ Action مع سياق التاجر المعزول
 */
async function route(action, params, token, env, ctx, request, tenantId, authSession) {

  // ══════════════════════════════════════════
  // ── مسارات عامة (Public Routes) ──
  // ══════════════════════════════════════════

  // ── الكتالوج والمنتجات ──
  if (action === 'catalog')         return getCatalog(env, tenantId);

  // ── سياق وهوية المتجر العامة ──
  if (action === 'store_context')   return getStoreContext(env, tenantId, request);

  // ── الإعدادات العامة للمتجر ──
  if (action === 'settings')        return getSettings(env, tenantId);

  // ── الشهادات والتقييمات ──
  if (action === 'testimonials')    return getTestimonials(env, tenantId);
  if (action === 'get_reviews' || action === 'reviews') return getReviews(env, params, tenantId);
  if (action === 'add_review')      return addPublicReview(env, params, tenantId);

  // ── الصفحات المخصصة ──
  if (action === 'get_pages' || action === 'pages') return getPages(env, tenantId);

  // ── النشرة البريدية ──
  if (action === 'newsletter_subscribe') return newsletterSubscribe(env, params);

  // ── رفع الملفات ──
  if (action === 'upload_image') return publicUploadImage(env, params, request, tenantId);

  // ── الكوبونات (التحقق العام) ──
  if (action === 'validate_coupon') return validateCoupon(env, params, tenantId);

  // ── أحداث التحليلات العامة ──
  if (action === 'track_analytics_event') return trackPublicAnalyticsEvent(env, params, request, tenantId);

  // ── أقسام الثيمات الديناميكية (عام) ──
  if (action === 'get_theme_sections') return getThemeSections(env, params, tenantId);

  // ── الطلبات ──
  if (action === 'order')           return createOrder(env, params, request, ctx, token, tenantId);
  if (action === 'track')           return trackOrder(env, params.order_id, tenantId);
  if (action === 'customer_orders') return customerOrders(env, token, tenantId);

  // ── العملاء ──
  if (action === 'customer_register') return customerRegister(env, params, tenantId);
  if (action === 'customer_login')    return customerLogin(env, params, tenantId);
  if (action === 'customer_profile')  return customerProfile(env, token, tenantId);
  if (action === 'customer_logout')   return customerLogout(env, token);

  // ── مصادقة التجار (Merchant Auth - Phase 29) ──
  if (action === 'auth_register')            return authRegister(env, params, request);
  if (action === 'auth_login')               return authLogin(env, params, request);
  if (action === 'auth_logout')              return authLogout(env, token, authSession, request);
  if (action === 'auth_me')                  return authMe(env, token, authSession);
  if (action === 'auth_forgot_password')     return authForgotPassword(env, params, request);
  if (action === 'auth_reset_password')      return authResetPassword(env, params, request);
  if (action === 'auth_verify_email')        return authVerifyEmail(env, params, request);
  if (action === 'auth_resend_verification') return authResendVerification(env, params, request);
  if (action === 'auth_change_password')     return authChangePassword(env, params, token, authSession, request);
  if (action === 'auth_sessions')            return authListSessions(env, token, authSession);
  if (action === 'auth_revoke_session')      return authRevokeSession(env, params.token_hash || params.id, authSession);
  if (action === 'auth_revoke_all')          return authRevokeAll(env, token, authSession, request);

  // ── مصادقة الأدمن القديمة (Legacy Fallback) ──
  if (action === 'verify_admin')    return verifyAdmin(env, params);
  if (action === 'admin_logout')    return adminLogout(env, token);

  // ══════════════════════════════════════════
  // ── مسارات الأدمن (Admin Routes) ──
  // ══════════════════════════════════════════

  // ── المنتجات ──
  if (action === 'admin_list')           return adminListProducts(env, tenantId);
  if (action === 'admin_add_product')    return adminAddProduct(env, params, tenantId);
  if (action === 'admin_edit_product')   return adminEditProduct(env, params, tenantId);
  if (action === 'admin_delete_product') return adminDeleteProduct(env, params, tenantId);

  // ── الطلبات ──
  if (action === 'admin_orders')         return adminListOrders(env, params, tenantId);
  if (action === 'admin_update_order')   return adminUpdateOrder(env, params, tenantId);
  if (action === 'admin_delete_order')   return adminDeleteOrder(env, params, tenantId);

  // ── الإعدادات والإشعارات ──
  if (action === 'admin_settings')          return getSettings(env, tenantId);
  if (action === 'admin_update_settings')   return adminUpdateSettings(env, params, tenantId);
  if (action === 'admin_test_notification') return adminTestNotification(env, params, tenantId);

  // ── الكوبونات ──
  if (action === 'admin_list_coupons')   return adminListCoupons(env, tenantId);
  if (action === 'admin_add_coupon')     return adminAddCoupon(env, params, tenantId);
  if (action === 'admin_edit_coupon')    return adminEditCoupon(env, params, tenantId);
  if (action === 'admin_delete_coupon')  return adminDeleteCoupon(env, params, tenantId);

  // ── الشهادات ──
  if (action === 'admin_list_testimonials')  return adminListTestimonials(env, tenantId);
  if (action === 'admin_add_testimonial')    return adminAddTestimonial(env, params, tenantId);
  if (action === 'admin_edit_testimonial')   return adminEditTestimonial(env, params, tenantId);
  if (action === 'admin_delete_testimonial') return adminDeleteTestimonial(env, params, tenantId);

  // ── التقييمات ──
  if (action === 'admin_list_reviews')   return adminListReviews(env, tenantId);
  if (action === 'admin_delete_review')  return adminDeleteReview(env, params, tenantId);
  if (action === 'admin_approve_review') return adminApproveReview(env, params, tenantId);

  // ── الصفحات ──
  if (action === 'admin_list_pages') return adminListPages(env, tenantId);
  if (action === 'admin_save_page')  return adminSavePage(env, params, tenantId);

  // ── العملاء ──
  if (action === 'admin_list_customers') return adminListCustomers(env, params, tenantId);

  // ── النشرة البريدية ──
  if (action === 'admin_list_subscribers') return adminListSubscribers(env, params);

  // ── الثيمات والأقسام الديناميكية ──
  if (action === 'admin_list_themes')          return adminListThemes(env, tenantId);
  if (action === 'admin_get_theme')           return adminGetTheme(env, params, tenantId);
  if (action === 'admin_save_theme')           return adminSaveTheme(env, params, tenantId);
  if (action === 'admin_delete_theme')         return adminDeleteTheme(env, params, tenantId);
  if (action === 'admin_set_default_theme')    return adminSetDefaultTheme(env, params, tenantId);
  if (action === 'admin_save_theme_sections')  return adminSaveThemeSections(env, params, tenantId);

  // ── رفع الملفات ──
  if (action === 'admin_upload_image')  return adminUploadImage(env, params, request, tenantId);
  if (action === 'admin_delete_media')  return adminDeleteMedia(env, params, tenantId);

  // ── سجل التدقيق ──
  if (action === 'admin_list_audit_logs') return adminListAuditLogs(env, params, tenantId);

  // ── التسويق والتحليلات ──
  if (action === 'admin_capi_test') return adminCapiTest(env, params, request);
  if (action === 'admin_campaign_analytics') return getCampaignAnalytics(env, params, tenantId);

  // ── الذكاء الاصطناعي ──
  if (action === 'admin_ai_chat' || action === 'admin_ai_analysis') {
    return adminAiChat(env, params, tenantId, authSession);
  }

  // ── الإدارة المركزية والمنصة (Super Admin) ──
  if (action === 'admin_super_list_tenants')   return superListTenants(env, authSession);
  if (action === 'admin_super_platform_stats') return superPlatformStats(env, authSession);
  if (action === 'admin_super_update_tenant')  return superUpdateTenant(env, params, authSession);

  // ── action غير معروف ──
  return {
    ok: false,
    error: { code: 'UNKNOWN_ACTION', message: `action غير معروف: ${action}` },
  };
}

// ════════════════════════════════════════════
// ── إضافة تقييم منتج (Public) ──
// ════════════════════════════════════════════

/**
 * [PUBLIC] إضافة تقييم على منتج من زبون مع عزل التاجر
 */
async function addPublicReview(env, params, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const productId  = parseInt(params.product_id || 0);
  const authorName = sanitize(params.author_name, 200);
  const content    = sanitize(params.content, 2000);
  const rating     = Math.min(5, Math.max(1, parseInt(params.rating ?? 5)));
  const imageUrl   = sanitize(params.image_url, 500);
  const phone      = sanitizePhone(params.phone);

  if (!productId)  return { ok: false, error: 'معرّف المنتج مطلوب' };
  if (!authorName) return { ok: false, error: 'الاسم مطلوب' };
  if (!content)    return { ok: false, error: 'نص التقييم مطلوب' };

  const product = await env.DB.prepare(
    `SELECT id FROM products WHERE id = ? AND active = 1 AND (tenant_id = ? OR tenant_id IS NULL) LIMIT 1`
  ).bind(productId, tenantId).first();

  if (!product) return { ok: false, error: 'المنتج غير موجود' };

  await env.DB.prepare(`
    INSERT INTO reviews (tenant_id, product_id, author_name, author_phone, content, rating, image_url)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(tenantId, productId, authorName, phone, content, rating, imageUrl).run();

  return { ok: true, message: 'شكراً! سيتم مراجعة تقييمك قريباً' };
}

// ════════════════════════════════════════════
// ── تحليل الـ params (parseParams) ──
// ════════════════════════════════════════════

/**
 * يستخرج الـ parameters من:
 * 1. Query String (لطلبات GET)
 * 2. application/x-www-form-urlencoded body (الصيغة القديمة في GAS)
 * 3. application/json body (للتطبيقات المحمولة)
 * 4. multipart/form-data (لرفع الملفات مستقبلاً)
 * 
 * @param {Request} request
 * @returns {Promise<object>}
 */
async function parseParams(request) {
  const url    = new URL(request.url);
  const params = {};

  // ── استخرج من query string أولاً ──
  for (const [key, value] of url.searchParams.entries()) {
    params[key] = value;
  }

  // ── إذا كان POST: استخرج من الـ body ──
  if (request.method === 'POST') {
    const contentType = (request.headers.get('Content-Type') || '').toLowerCase();

    if (contentType.includes('application/json')) {
      // JSON body (للتطبيقات المحمولة والاستخدام الحديث)
      try {
        const json = await request.json();
        Object.assign(params, json);
      } catch { /* body غير صالح: تجاهَل */ }

    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      // ✅ الصيغة المستخدمة حالياً في Vanilla JS frontend
      // هذه الصيغة تُبقي التوافق مع الكود الموجود بدون أي تغيير
      const text       = await request.text();
      const formParams = new URLSearchParams(text);
      for (const [key, value] of formParams.entries()) {
        params[key] = value;
      }

    } else if (contentType.includes('multipart/form-data')) {
      // للمستقبل: دعم رفع الصور من الأدمن
      const formData = await request.formData();
      for (const [key, value] of formData.entries()) {
        params[key] = value;
      }
    } else {
      // دعم نداءات sendBeacon و text/plain و fallback
      try {
        const text = await request.text();
        if (text && text.trim()) {
          try {
            const json = JSON.parse(text);
            Object.assign(params, json);
          } catch {
            const formParams = new URLSearchParams(text);
            for (const [key, value] of formParams.entries()) {
              params[key] = value;
            }
          }
        }
      } catch {}
    }
  }

  return params;
}
