/**
 * Smart Shopping — Cloudflare Worker
 * ملف: src/utils/response.js
 * 
 * دوال مساعدة لبناء استجابات JSON موحدة (Standardized Responses)
 * تضمن توافق الـ API مع الويب والتطبيقات المحمولة مستقبلاً
 */

/**
 * ترويسات CORS - تُطبَّق على جميع الاستجابات
 * @param {string} origin - أصل الطلب الوارد
 * @param {string} allowedOrigins - النطاقات المسموح بها (من env)
 * @returns {Headers}
 */
export function buildCorsHeaders(origin, allowedOrigins) {
  const allowed = (allowedOrigins || '').split(',').map(o => o.trim());
  
  // في بيئة التطوير المحلي، اسمح بكل الأصول
  const isDev = allowed.includes('*') || allowed.length === 0;
  const isAllowed = isDev || allowed.includes(origin);
  
  return {
    'Access-Control-Allow-Origin':  isAllowed ? origin : allowed[0] || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token',
    'Access-Control-Max-Age':       '86400',
    'Vary':                         'Origin',
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
      ...corsHeaders,
    },
  });
}
