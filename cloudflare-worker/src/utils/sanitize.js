/**
 * Smart Shopping — Cloudflare Worker
 * ملف: src/utils/sanitize.js
 * 
 * دوال تنظيف المدخلات وتوليد المعرفات
 * تُحاكي دوال _sanitize() وgenerateOrderId() في GAS
 */

/**
 * تنظيف نص عام: يزيل HTML، يقتطع الطول
 * @param {any} value
 * @param {number} maxLen
 * @returns {string}
 */
export function sanitize(value, maxLen = 500) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[<>"'&]/g, '')   // إزالة محارف HTML الخطرة
    .trim()
    .substring(0, maxLen);
}

/**
 * تنظيف رقم هاتف: أرقام و+ فقط
 * @param {string} phone
 * @returns {string}
 */
export function sanitizePhone(phone) {
  return String(phone || '').replace(/[^0-9+]/g, '').substring(0, 20);
}

/**
 * تطبيع أرقام الهواتف للصيغة المعيارية الدولية بدون علامة +
 * e.g. 0555123456 -> 213555123456
 * e.g. +213555123456 -> 213555123456
 * e.g. 00213555123456 -> 213555123456
 * @param {string} rawPhone
 * @returns {string}
 */
export function normalizePhone(rawPhone) {
  if (!rawPhone) return '';
  let digits = String(rawPhone).replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (digits.startsWith('00213')) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0') && digits.length === 10) {
    digits = '213' + digits.slice(1);
  } else if (digits.length === 9 && (digits.startsWith('5') || digits.startsWith('6') || digits.startsWith('7'))) {
    digits = '213' + digits;
  }
  return digits;
}

/**
 * قائمة الإعدادات الرقمية ومخطط التحقق الصارم من صحتها (Numeric Settings Schema)
 */
export const NUMERIC_SETTINGS_SCHEMA = {
  // أرقام صحيحة غير سالبة (أسعار الشحن والمبالغ بالدينار والحدود)
  shipping_home: {
    type: 'integer',
    min: 0,
    max: 500000,
    name: 'سعر التوصيل للمنزل'
  },
  shipping_office: {
    type: 'integer',
    min: 0,
    max: 500000,
    name: 'سعر التوصيل للمكتب'
  },
  shipping_remote: {
    type: 'integer',
    min: 0,
    max: 500000,
    name: 'سعر التوصيل للمناطق البعيدة'
  },
  minimum_order_amount: {
    type: 'integer',
    min: 0,
    max: 10000000,
    name: 'الحد الأدنى للطلب'
  },
  free_delivery_min: {
    type: 'integer',
    min: 0,
    max: 10000000,
    name: 'الحد الأدنى للتوصيل المجاني'
  },
  free_shipping_min: {
    type: 'integer',
    min: 0,
    max: 10000000,
    name: 'الحد الأدنى للشحن المجاني'
  },
  session_ttl_hours: {
    type: 'integer',
    min: 1,
    max: 720,
    name: 'مدة صلاحية الجلسة'
  },
  rate_limit_admin: {
    type: 'integer',
    min: 1,
    max: 10000,
    name: 'الحد الأقصى لطلبات الإدارة'
  },

  // أرقام عشرية ونسب مئوية
  usd_to_dzd_rate: {
    type: 'decimal',
    min: 1,
    max: 10000,
    name: 'سعر صرف الدولار'
  },
  estimated_product_cost_pct: {
    type: 'decimal',
    min: 0,
    max: 100,
    name: 'نسبة تكلفة البضاعة'
  }
};

/**
 * التحقق من صحة القيمة الرقمية للإعدادات وتطبيعها للصيغة المعيارية
 * @param {string} key
 * @param {any} rawValue
 * @returns {{ valid: boolean, value?: string, error?: string }}
 */
export function validateNumericSetting(key, rawValue) {
  const schema = NUMERIC_SETTINGS_SCHEMA[key];
  if (!schema) {
    return { valid: true, value: String(rawValue ?? '') };
  }

  if (rawValue === null || rawValue === undefined || String(rawValue).trim() === '') {
    return { valid: false, error: `قيمة ${schema.name || key} لا يمكن أن تكون فارغة` };
  }

  const str = String(rawValue).trim();

  // فحص القيم الخاصة كعلامات لا نهائية (Sentinels مثل -1) إذا كانت معرفة
  if (schema.allowSentinel && schema.allowSentinel.includes(Number(str))) {
    return { valid: true, value: String(Number(str)) };
  }

  if (schema.type === 'integer') {
    if (!/^-?\d+$/.test(str)) {
      return { valid: false, error: `قيمة ${schema.name || key} يجب أن تكون رقماً صحيحاً صالحاً` };
    }
    const num = Number(str);
    if (!Number.isSafeInteger(num)) {
      return { valid: false, error: `قيمة ${schema.name || key} تتجاوز النطاق الرقمي المسموح` };
    }
    if (schema.min !== undefined && num < schema.min) {
      return { valid: false, error: `قيمة ${schema.name || key} لا يمكن أن تقل عن ${schema.min}` };
    }
    if (schema.max !== undefined && num > schema.max) {
      return { valid: false, error: `قيمة ${schema.name || key} لا يمكن أن تزيد عن ${schema.max}` };
    }
    return { valid: true, value: String(num) };
  }

  if (schema.type === 'decimal') {
    if (!/^-?\d+(\.\d+)?$/.test(str)) {
      return { valid: false, error: `قيمة ${schema.name || key} يجب أن تكون رقماً صالحاً` };
    }
    const num = Number(str);
    if (isNaN(num) || !Number.isFinite(num)) {
      return { valid: false, error: `قيمة ${schema.name || key} غير صالحة` };
    }
    if (schema.min !== undefined && num < schema.min) {
      return { valid: false, error: `قيمة ${schema.name || key} لا يمكن أن تقل عن ${schema.min}` };
    }
    if (schema.max !== undefined && num > schema.max) {
      return { valid: false, error: `قيمة ${schema.name || key} لا يمكن أن تزيد عن ${schema.max}` };
    }
    return { valid: true, value: String(num) };
  }

  return { valid: true, value: str };
}

/**
 * تنظيف رقم مالي: أرقام ونقطة عشرية فقط
 * @param {any} value
 * @returns {number}
 */
export function sanitizeNumber(value) {
  const cleaned = String(value || '0').replace(/[^0-9.]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : Math.max(0, num);
}

/**
 * تنظيف عناصر الطلب (items_json) — يقتل XSS المخزَّن
 * يُحاكي _sanitizeOrderItems() في GAS
 * @param {string|any[]} itemsInput
 * @returns {string} JSON نظيف
 */
export function sanitizeOrderItems(itemsInput) {
  let items = [];
  try {
    items = typeof itemsInput === 'string'
      ? JSON.parse(itemsInput)
      : itemsInput;
  } catch {
    items = [];
  }

  if (!Array.isArray(items)) return '[]';

  const cleaned = items
    .filter(it => it && typeof it === 'object')
    .map(it => {
      const c = {};
      for (const [k, v] of Object.entries(it)) {
        if (k === 'title' || k === 'name') {
          c[k] = sanitize(v, 300);
        } else if (typeof v === 'string') {
          c[k] = sanitize(v, 500);
        } else if (typeof v === 'number') {
          c[k] = isFinite(v) ? v : 0;
        } else {
          c[k] = v;
        }
      }
      return c;
    });

  return JSON.stringify(cleaned);
}

/**
 * توليد معرّف الطلب بتنسيق: SK-YYYYMMDD-XXXX
 * مطابق لما كان يفعله GAS
 * @returns {string}
 */
export function generateOrderId() {
  const now  = new Date();
  const yyyy = now.getUTCFullYear();
  const mm   = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd   = String(now.getUTCDate()).padStart(2, '0');
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `SK-${yyyy}${mm}${dd}-${rand}`;
}

/**
 * تنسيق التاريخ بتوقيت الجزائر
 * @param {Date|string} date
 * @returns {string} ISO 8601 string
 */
export function formatAlgeriaTime(date = new Date()) {
  return new Date(date).toLocaleString('en-CA', {
    timeZone:   'Africa/Algiers',
    year:       'numeric',
    month:      '2-digit',
    day:        '2-digit',
    hour:       '2-digit',
    minute:     '2-digit',
    second:     '2-digit',
    hour12:     false,
  }).replace(',', '');
}
