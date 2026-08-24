import { sanitize } from '../utils/sanitize.js';
import { generateToken, sha256, DEFAULT_MASTER_TENANT_ID } from '../utils/auth.js';

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
  if (clean.startsWith('fb.1.') || clean.startsWith('fb.2.')) return clean;
  const time = creationTime || Date.now();
  return `fb.1.${time}.${clean}`;
}

/**
 * الإرسال الفعلي لحدث إلى Facebook CAPI مع العزل الصارم للمستأجر (Tenant Context Scoped)
 * هذه الدالة ستُنفَّذ في الخلفية عبر ctx.waitUntil()
 */
export async function sendCapiEvent(env, eventName, eventData, userData = {}, requestObj, tenantId = DEFAULT_MASTER_TENANT_ID) {
  try {
    // 1. استعلام الإعدادات المعزولة للمستأجر
    const isMaster = tenantId === DEFAULT_MASTER_TENANT_ID;
    const stmt = isMaster
      ? env.DB.prepare(`
          SELECT key, value FROM settings
          WHERE (tenant_id = ? OR tenant_id IS NULL)
            AND key IN ('capi_enabled', 'fb_capi_token', 'fb_pixel_id', 'pixel_id', 'fb_test_event_code', 'test_event_code')
        `).bind(tenantId)
      : env.DB.prepare(`
          SELECT key, value FROM settings
          WHERE tenant_id = ?
            AND key IN ('capi_enabled', 'fb_capi_token', 'fb_pixel_id', 'pixel_id', 'fb_test_event_code', 'test_event_code')
        `).bind(tenantId);

    const { results } = await stmt.all();

    const settings = {};
    (results || []).forEach(r => settings[r.key] = r.value);

    const pixelId = settings.fb_pixel_id || settings.pixel_id;

    if (settings.capi_enabled !== 'true' || !settings.fb_capi_token || !pixelId) {
      console.log('[CAPI Diagnostic Check]', {
        tenant_id: tenantId,
        capi_enabled: settings.capi_enabled,
        has_token: !settings.fb_capi_token,
        has_pixel_id: !pixelId,
        aborted: true
      });
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

    // Event Source URL (الرابط الفعلي لصفحة المنتج من الطلب أو ترويسة Referer)
    const eventSourceUrl = eventData?.event_source_url || 
                           requestObj?.headers?.get('Referer') || 
                           requestObj?.headers?.get('referer') || 
                           undefined;

    const payload = {
      data: [
        {
          event_name: eventName,
          event_time: Math.floor(Date.now() / 1000),
          event_id: eventData.order_id ? String(eventData.order_id) : undefined,
          event_source_url: eventSourceUrl || undefined,
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
      ],
      test_event_code: settings.fb_test_event_code || settings.test_event_code || undefined
    };

    if (eventName === 'Purchase' && eventData.order_id) {
      payload.data[0].custom_data.order_id = String(eventData.order_id);
    }

    const fbUrl = `https://graph.facebook.com/v19.0/${pixelId}/events?access_token=${settings.fb_capi_token}`;

    const res = await fetch(fbUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    let resText = '';
    let resJson = null;
    if (typeof res.text === 'function') {
      resText = await res.text();
      try { resJson = JSON.parse(resText); } catch (_) {}
    } else if (typeof res.json === 'function') {
      resJson = await res.json();
      resText = JSON.stringify(resJson);
    }

    console.log('[CAPI Response Diagnostic]', {
      capi_enabled: settings.capi_enabled,
      has_token: !!settings.fb_capi_token,
      pixel_id: pixelId,
      event_id: payload.data[0].event_id,
      event_name: eventName,
      http_status: res.status,
      events_received: resJson?.events_received ?? null,
      fbtrace_id: resJson?.fbtrace_id ?? null,
      response_body: resJson || resText
    });

    if (!res.ok) {
      console.error('Facebook CAPI Error:', resText);
    }
  } catch (err) {
    console.error('sendCapiEvent Error:', err.message);
  }
}

/**
 * [ADMIN] فحص اتصال CAPI وإرسال حدث اختباري
 */
export async function adminCapiTest(env, params, request, tenantId = DEFAULT_MASTER_TENANT_ID) {
  try {
    const isMaster = tenantId === DEFAULT_MASTER_TENANT_ID;
    const stmt = isMaster
      ? env.DB.prepare(`
          SELECT key, value FROM settings
          WHERE (tenant_id = ? OR tenant_id IS NULL)
            AND key IN ('capi_enabled', 'fb_capi_token', 'fb_pixel_id', 'pixel_id')
        `).bind(tenantId)
      : env.DB.prepare(`
          SELECT key, value FROM settings
          WHERE tenant_id = ?
            AND key IN ('capi_enabled', 'fb_capi_token', 'fb_pixel_id', 'pixel_id')
        `).bind(tenantId);

    const { results } = await stmt.all();

    const settings = {};
    (results || []).forEach(r => settings[r.key] = r.value);

    const pixelId = settings.fb_pixel_id || settings.pixel_id;

    if (!settings.fb_capi_token || !pixelId) {
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

    const fbUrl = `https://graph.facebook.com/v19.0/${pixelId}/events?access_token=${settings.fb_capi_token}`;
    
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
