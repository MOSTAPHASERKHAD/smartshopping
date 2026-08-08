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
import { adminGate }                      from './utils/auth.js';
import { sanitize, sanitizePhone }        from './utils/sanitize.js';

// ── استيراد معالجات الكتالوج ──
import {
  getCatalog, getSettings, getTestimonials,
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

// ── استيراد معالجات الثيمات ──
import {
  adminListThemes, adminSaveTheme, adminDeleteTheme
} from './handlers/themes.js';

// ── استيراد معالجات الرفع (Uploads) ──
import {
  publicUploadImage, adminUploadImage, adminDeleteMedia, adminListMedia
} from './handlers/uploads.js';

// ── استيراد معالجات التسويق (CAPI) ──
import { adminCapiTest } from './handlers/marketing.js';

// ── استيراد معالجات الذكاء الاصطناعي ──
import { adminAiChat } from './handlers/ai.js';

// ── استيراد معالجات الأدمن ──
import {
  verifyAdmin, adminLogout, adminUpdateSettings,
  adminListCoupons, adminAddCoupon, adminEditCoupon, adminDeleteCoupon,
  adminListTestimonials, adminAddTestimonial,
  adminEditTestimonial,  adminDeleteTestimonial,
  adminListReviews, adminDeleteReview, adminApproveReview,
  adminListPages, adminSavePage,
} from './handlers/admin.js';

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
      return jsonResponse(
        { ok: false, error: { code: 'MISSING_ACTION', message: 'المتغير action مطلوب' } },
        400, corsHeaders,
      );
    }

    // ── 5. استخراج الـ token (من params أو Authorization header) ──
    //    يدعم الإرسال القديم (token في params) والحديث (Authorization: Bearer <token>)
    const token =
      params.token ||
      (request.headers.get('Authorization') || '').replace('Bearer ', '').trim() ||
      request.headers.get('X-Admin-Token') ||
      null;

    // ── 6. تطبيق حارس المسارات المحمية ──
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

    // ── 7. توجيه الطلب (Router) ──
    //    يُحاكي switch(action) في دوال doGet/doPost في GAS تماماً
    let result;

    try {
      result = await route(action, params, token, env, ctx, request);
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
 * يُحاكي تماماً الـ switch(action) في doGet و doPost في GAS.
 * كل action يُعيد كائن JavaScript (وليس Response) — التحويل لـ JSON يتم في fetch().
 * 
 * @param {string} action
 * @param {object} params
 * @param {string|null} token
 * @param {Env} env
 * @param {ExecutionContext} ctx
 * @param {Request} request
 * @returns {Promise<object>}
 */
async function route(action, params, token, env, ctx, request) {

  // ══════════════════════════════════════════
  // ── مسارات عامة (Public Routes) ──
  // ══════════════════════════════════════════

  // ── الكتالوج والمنتجات ──
  if (action === 'catalog')         return getCatalog(env);

  // ── الإعدادات العامة للمتجر ──
  if (action === 'settings')        return getSettings(env);

  // ── الشهادات والتقييمات ──
  if (action === 'testimonials')    return getTestimonials(env);
  if (action === 'get_reviews')     return getReviews(env, params);
  if (action === 'add_review')      return addPublicReview(env, params);

  // ── الصفحات المخصصة ──
  if (action === 'get_pages')       return getPages(env);

  // ── النشرة البريدية ──
  if (action === 'newsletter_subscribe') return newsletterSubscribe(env, params);

  // ── رفع الملفات ──
  if (action === 'upload_image') return publicUploadImage(env, params);

  // ── الكوبونات (التحقق العام) ──
  if (action === 'validate_coupon') return validateCoupon(env, params);

  // ── الطلبات ──
  if (action === 'order')           return createOrder(env, params, request, ctx);
  if (action === 'track')           return trackOrder(env, params.order_id);
  if (action === 'customer_orders') return customerOrders(env, params.phone);

  // ── العملاء ──
  if (action === 'customer_register') return customerRegister(env, params);
  if (action === 'customer_login')    return customerLogin(env, params);
  if (action === 'customer_profile')  return customerProfile(env, token);
  if (action === 'customer_logout')   return customerLogout(env, token);

  // ── مصادقة الأدمن ──
  if (action === 'verify_admin')    return verifyAdmin(env, params);
  if (action === 'admin_logout')    return adminLogout(env, token);

  // ══════════════════════════════════════════
  // ── مسارات الأدمن (Admin Routes) ──
  // ملاحظة: تم التحقق من الصلاحية أعلاه بواسطة adminGate()
  // ══════════════════════════════════════════

  // ── المنتجات ──
  if (action === 'admin_list')           return adminListProducts(env);
  if (action === 'admin_add_product')    return adminAddProduct(env, params);
  if (action === 'admin_edit_product')   return adminEditProduct(env, params);
  if (action === 'admin_delete_product') return adminDeleteProduct(env, params);

  // ── الطلبات ──
  if (action === 'admin_orders')         return adminListOrders(env, params);
  if (action === 'admin_update_order')   return adminUpdateOrder(env, params);
  if (action === 'admin_delete_order')   return adminDeleteOrder(env, params);

  // ── الإعدادات ──
  if (action === 'admin_settings')        return getSettings(env);
  if (action === 'admin_update_settings') return adminUpdateSettings(env, params);

  // ── الكوبونات ──
  if (action === 'admin_list_coupons')   return adminListCoupons(env);
  if (action === 'admin_add_coupon')     return adminAddCoupon(env, params);
  if (action === 'admin_edit_coupon')    return adminEditCoupon(env, params);
  if (action === 'admin_delete_coupon')  return adminDeleteCoupon(env, params);

  // ── الشهادات ──
  if (action === 'admin_list_testimonials')  return adminListTestimonials(env);
  if (action === 'admin_add_testimonial')    return adminAddTestimonial(env, params);
  if (action === 'admin_edit_testimonial')   return adminEditTestimonial(env, params);
  if (action === 'admin_delete_testimonial') return adminDeleteTestimonial(env, params);

  // ── التقييمات ──
  if (action === 'admin_list_reviews')   return adminListReviews(env);
  if (action === 'admin_delete_review')  return adminDeleteReview(env, params);
  if (action === 'admin_approve_review') return adminApproveReview(env, params);

  // ── الصفحات ──
  if (action === 'admin_list_pages') return adminListPages(env);
  if (action === 'admin_save_page')  return adminSavePage(env, params);

  // ── العملاء ──
  if (action === 'admin_list_customers') return adminListCustomers(env, params);

  // ── النشرة البريدية ──
  if (action === 'admin_list_subscribers') return adminListSubscribers(env, params);

  // ── الثيمات ──
  if (action === 'admin_list_themes')   return adminListThemes(env);
  if (action === 'admin_save_theme')    return adminSaveTheme(env, params);
  if (action === 'admin_delete_theme')  return adminDeleteTheme(env, params);

  // ── رفع الملفات ──
  if (action === 'admin_upload_image')  return adminUploadImage(env, params);
  if (action === 'admin_delete_media')  return adminDeleteMedia(env, params);
  if (action === 'admin_list_media')    return adminListMedia(env, params);

  // ── التسويق ──
  if (action === 'admin_capi_test') return adminCapiTest(env, params, request);

  // ── الذكاء الاصطناعي ──
  if (action === 'admin_ai_chat')   return adminAiChat(env, params);

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
 * [PUBLIC] إضافة تقييم على منتج من زبون
 * التقييم يذهب لحالة pending حتى يوافق عليه الأدمن
 */
async function addPublicReview(env, params) {
  const productId  = parseInt(params.product_id || 0);
  const authorName = sanitize(params.author_name, 200);
  const content    = sanitize(params.content, 2000);
  const rating     = Math.min(5, Math.max(1, parseInt(params.rating ?? 5)));
  const imageUrl   = sanitize(params.image_url, 500);
  const phone      = sanitizePhone(params.phone);

  if (!productId)  return { ok: false, error: 'معرّف المنتج مطلوب' };
  if (!authorName) return { ok: false, error: 'الاسم مطلوب' };
  if (!content)    return { ok: false, error: 'نص التقييم مطلوب' };

  // تحقق من وجود المنتج
  const product = await env.DB.prepare(
    `SELECT id FROM products WHERE id = ? AND active = 1 LIMIT 1`
  ).bind(productId).first();

  if (!product) return { ok: false, error: 'المنتج غير موجود' };

  await env.DB.prepare(`
    INSERT INTO reviews (product_id, author_name, author_phone, content, rating, image_url)
    VALUES (?,?,?,?,?,?)
  `).bind(productId, authorName, phone, content, rating, imageUrl).run();

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
    }
  }

  return params;
}
