import { sanitize } from '../utils/sanitize.js';
import { generateToken, sha256 } from '../utils/auth.js';

/**
 * دالة مساعدة لعمل هاش للبيانات الشخصية قبل إرسالها للفيسبوك
 * يتطلب فيسبوك SHA-256، حروف صغيرة
 */
async function hashForFB(text) {
  if (!text) return undefined;
  return await sha256(text.trim().toLowerCase());
}

/**
 * تطبيع أرقام الهواتف الجزائرية للصيغة المعيارية الدولية بدون علامة +
 * e.g. 0555123456 -> 213555123456
 * e.g. +213555123456 -> 213555123456
 * e.g. 00213555123456 -> 213555123456
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
 * تطبيع البريد الإلكتروني (حروف صغيرة وإزالة المسافات)
 */
export function normalizeEmail(rawEmail) {
  if (!rawEmail) return '';
  const trimmed = String(rawEmail).trim().toLowerCase();
  return trimmed.includes('@') ? trimmed : '';
}

/**
 * التحقق من صيغة Click ID (fbc) وتنسيقها وفق معايير Meta
 */
export function formatFbc(fbcVal, creationTime) {
  if (!fbcVal) return undefined;
  const clean = String(fbcVal).trim();
  if (!clean) return undefined;
  if (clean.startsWith('fb.1.')) return clean;
  const time = creationTime || Date.now();
  return `fb.1.${time}.${clean}`;
}

/**
 * الإرسال الفعلي لحدث إلى Facebook CAPI
 * هذه الدالة ستُنفَّذ في الخلفية عبر ctx.waitUntil()
 */
export async function sendCapiEvent(env, eventName, eventData, userData = {}, requestObj) {
  try {
    // 1. تحقق مما إذا كان CAPI مفعلاً
    const { results } = await env.DB.prepare(`
      SELECT key, value FROM settings WHERE key IN ('capi_enabled', 'fb_capi_token', 'fb_pixel_id')
    `).all();

    const settings = {};
    results.forEach(r => settings[r.key] = r.value);

    if (settings.capi_enabled !== 'true' || !settings.fb_capi_token || !settings.fb_pixel_id) {
      return; // غير مفعل أو غير مكتمل الإعدادات
    }

    // 2. تجهيز وتطبيع بيانات المستخدم (SHA-256 Hashing)
    let hashedPhone;
    if (userData && userData.phone) {
      const cleanPhone = normalizePhone(userData.phone);
      if (cleanPhone) {
        hashedPhone = await hashForFB(cleanPhone);
      }
    }

    let hashedEmail;
    if (userData && userData.email) {
      const cleanEmail = normalizeEmail(userData.email);
      if (cleanEmail) {
        hashedEmail = await hashForFB(cleanEmail);
      }
    }

    let cleanFbc;
    if (userData && userData.fbc) {
      cleanFbc = formatFbc(userData.fbc);
    }

    let cleanFbp;
    if (userData && userData.fbp) {
      const rawFbp = String(userData.fbp).trim();
      if (rawFbp) cleanFbp = rawFbp;
    }

    // IP & User Agent (استخراج آمن من Cloudflare Headers)
    const clientIp = requestObj?.headers?.get('CF-Connecting-IP') || 
                     requestObj?.headers?.get('X-Forwarded-For')?.split(',')[0]?.trim() || 
                     undefined;
    const userAgent = requestObj?.headers?.get('User-Agent') || undefined;

    const payload = {
      data: [
        {
          event_name: eventName,
          event_time: Math.floor(Date.now() / 1000),
          event_id: eventData.order_id ? String(eventData.order_id) : undefined,
          action_source: "website",
          user_data: {
            client_ip_address: clientIp,
            client_user_agent: userAgent,
            fbc: cleanFbc || undefined,
            fbp: cleanFbp || undefined,
            ph: hashedPhone ? [hashedPhone] : undefined,
            em: hashedEmail ? [hashedEmail] : undefined,
          },
          custom_data: {
            currency: "DZD",
            value: eventData.value || 0,
            content_ids: eventData.content_ids || [],
            content_type: "product",
          }
        }
      ]
    };

    if (eventName === 'Purchase' && eventData.order_id) {
      payload.data[0].custom_data.order_id = String(eventData.order_id);
    }

    const fbUrl = `https://graph.facebook.com/v19.0/${settings.fb_pixel_id}/events?access_token=${settings.fb_capi_token}`;

    const res = await fetch(fbUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Facebook CAPI Error:', errText);
    }
  } catch (err) {
    console.error('sendCapiEvent Error:', err.message);
  }
}

/**
 * [ADMIN] فحص اتصال CAPI وإرسال حدث اختباري
 */
export async function adminCapiTest(env, params, request) {
  try {
    const { results } = await env.DB.prepare(`
      SELECT key, value FROM settings WHERE key IN ('capi_enabled', 'fb_capi_token', 'fb_pixel_id')
    `).all();

    const settings = {};
    results.forEach(r => settings[r.key] = r.value);

    if (!settings.fb_capi_token || !settings.fb_pixel_id) {
      return { ok: false, error: 'إعدادات CAPI غير مكتملة (يرجى إدخال Pixel ID و Token)' };
    }

    const payload = {
      data: [
        {
          event_name: "TestEvent",
          event_time: Math.floor(Date.now() / 1000),
          action_source: "website",
          user_data: {
            client_ip_address: request.headers.get('CF-Connecting-IP') || '127.0.0.1',
            client_user_agent: request.headers.get('User-Agent') || 'TestAgent',
          },
          custom_data: {
            currency: "DZD",
            value: 0
          }
        }
      ],
      test_event_code: params.test_code || undefined // إذا كان المستخدم يريد اختباره عبر Events Manager
    };

    const fbUrl = `https://graph.facebook.com/v19.0/${settings.fb_pixel_id}/events?access_token=${settings.fb_capi_token}`;
    
    const res = await fetch(fbUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const fbJson = await res.json();
    
    if (res.ok) {
      return { ok: true, message: 'تم إرسال حدث الاختبار بنجاح', fb_response: fbJson };
    } else {
      return { ok: false, error: 'حدث خطأ من فيسبوك', fb_response: fbJson };
    }
  } catch (err) {
    return { ok: false, error: 'خطأ داخلي: ' + err.message };
  }
}
