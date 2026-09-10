/**
 * Smart Shopping — Cloudflare Worker
 * ملف: src/utils/response.js
 * 
 * دوال مساعدة لبناء استجابات JSON موحدة (Standardized Responses)
 * تضمن توافق الـ API مع الويب والتطبيقات المحمولة مستقبلاً
 */

/**
 * ترويسات CORS - تُطبَّق على جميع الاستجابات
 * @param {string} origin        - أصل الطلب الوارد
 * @param {string} allowedOrigins - النطاقات المسموح بها (من env)، مفصولة بفاصلة
 * @returns {object} corsHeaders
 *
 * السياسة الأمنية:
 *  1. مطابقة حرفية دقيقة للنطاقات الصريحة (exact match).
 *  2. مطابقة آمنة لـ Preview subdomains من نفس مشروع Pages فقط
 *     (بروتوكول https + hostname ينتهي بـ .smartshopping-76x.pages.dev).
 *  3. أي origin غير مسموح → يُرسَل 'null' (رفض كامل، لا يُعيد origin بديل).
 *  4. لا wildcard (*) للـ API — فقط لمسار /media/ العام.
 */
export function buildCorsHeaders(origin, allowedOrigins) {
  const allowed = (allowedOrigins || '').split(',').map(o => o.trim()).filter(Boolean);

  // بيئة التطوير: ALLOWED_ORIGINS = "*" أو فارغة → اسمح بكل شيء
  if (allowed.includes('*') || allowed.length === 0) {
    return {
      'Access-Control-Allow-Origin':  origin || '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token',
      'Access-Control-Max-Age':       '86400',
      'Vary':                         'Origin, Host',
    };
  }

  // 1. مطابقة حرفية دقيقة
  if (allowed.includes(origin)) {
    return {
      'Access-Control-Allow-Origin':  origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token',
      'Access-Control-Max-Age':       '86400',
      'Vary':                         'Origin, Host',
    };
  }

  // 2. مطابقة آمنة للنطاقات الفرعية الموثوقة:
  //    أ) Pages preview deployments: https://<hash>.smartshopping-76x.pages.dev
  //    ب) Storefront tenant subdomains: https://<slug>.smartshopping.click
  const PAGES_SUFFIX = '.smartshopping-76x.pages.dev';
  const STOREFRONT_SUFFIX = '.smartshopping.click';

  const isTrustedSubdomain = (function() {
    if (!origin) return false;
    // يجب أن يبدأ بـ https:// فقط — يمنع http:// downgrade
    if (!origin.startsWith('https://')) return false;
    let parsed;
    try { parsed = new URL(origin); } catch (_) { return false; }
    // يجب ألا يحتوي على path أو query أو port غير افتراضي
    if (parsed.pathname !== '/' && parsed.pathname !== '') return false;
    if (parsed.search || parsed.hash || parsed.port) return false;

    const host = parsed.hostname;

    // أ) Pages preview
    if (host.endsWith(PAGES_SUFFIX)) {
      const prefix = host.slice(0, host.length - PAGES_SUFFIX.length);
      if (prefix && !prefix.includes('.')) return true;
    }

    // ب) Storefront tenant subdomains (*.smartshopping.click)
    if (host.endsWith(STOREFRONT_SUFFIX)) {
      const prefix = host.slice(0, host.length - STOREFRONT_SUFFIX.length);
      // التحقق: slug غير فارغ، لا يحتوي على نقاط (لا nested subdomains)، وصيغة slug صالحة
      if (prefix && !prefix.includes('.') && /^[a-z0-9-]+$/i.test(prefix) && !prefix.startsWith('-') && !prefix.endsWith('-')) {
        return true;
      }
    }

    return false;
  })();

  if (isTrustedSubdomain) {
    return {
      'Access-Control-Allow-Origin':  origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token',
      'Access-Control-Max-Age':       '86400',
      'Vary':                         'Origin, Host',
    };
  }

  // 3. Origin مرفوض — إرسال 'null' يمنع المتصفح من الوصول
  //    (لا نُعيد allowed[0] لأن ذلك يكشف معلومات عن نطاقاتنا)
  return {
    'Access-Control-Allow-Origin':  'null',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token',
    'Access-Control-Max-Age':       '86400',
    'Vary':                         'Origin, Host',
  };
}

/**
 * استجابة نجاح موحدة
 * {
 *   "ok": true,
 *   "data": { ... },        ← البيانات الفعلية
 *   "meta": {               ← معلومات إضافية (اختيارية)
 *     "total": 50,
 *     "page": 1
 *   }
 * }
 */
export function successResponse(data, meta = null, status = 200) {
  const body = { ok: true, data };
  if (meta) body.meta = meta;
  return body;
}

/**
 * استجابة خطأ موحدة
 * {
 *   "ok": false,
 *   "error": {
 *     "code":    "UNAUTHORIZED",   ← رمز الخطأ للمعالجة البرمجية
 *     "message": "...",            ← رسالة بشرية (عربية/إنجليزية)
 *   }
 * }
 */
export function errorResponse(message, code = 'ERROR', status = 400) {
  return {
    body: { ok: false, error: { code, message } },
    status,
  };
}

/**
 * بناء Response كامل مع ترويسات CORS
 * @param {object} bodyObj - كائن JSON
 * @param {number} status  - HTTP status code
 * @param {object} corsHeaders - ترويسات CORS
 */
export function jsonResponse(bodyObj, status = 200, corsHeaders = {}) {
  return new Response(JSON.stringify(bodyObj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Vary': 'Host, Origin',
      ...corsHeaders,
    },
  });
}
