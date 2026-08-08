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
 * الإرسال الفعلي لحدث إلى Facebook CAPI
 * هذه الدالة ستُنفَّذ في الخلفية عبر ctx.waitUntil()
 */
export async function sendCapiEvent(env, eventName, eventData, userData, requestObj) {
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

    // 2. تجهيز بيانات المستخدم (يجب تشفيرها SHA-256)
    let hashedPhone;
    if (userData.phone) {
      // إزالة كل شيء عدا الأرقام (أو علامة +)
      const cleanPhone = userData.phone.replace(/[^0-9]/g, '');
      hashedPhone = await hashForFB(cleanPhone);
    }

    const payload = {
      data: [
        {
          event_name: eventName,
          event_time: Math.floor(Date.now() / 1000),
          action_source: "website",
          user_data: {
            client_ip_address: requestObj?.headers?.get('CF-Connecting-IP') || undefined,
            client_user_agent: requestObj?.headers?.get('User-Agent') || undefined,
            ph: hashedPhone ? [hashedPhone] : undefined,
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
      payload.data[0].custom_data.order_id = eventData.order_id;
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
