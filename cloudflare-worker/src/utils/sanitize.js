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
