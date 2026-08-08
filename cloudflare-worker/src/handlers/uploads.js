import { generateToken } from '../utils/auth.js';

// الحد الأقصى للصورة للزوار (مثلاً 2 ميجابايت) وللأدمن (مثلاً 5 ميجابايت)
const MAX_PUBLIC_SIZE = 2 * 1024 * 1024;
const MAX_ADMIN_SIZE  = 5 * 1024 * 1024;

/**
 * دالة مساعدة لتحويل base64 إلى Uint8Array
 */
function base64ToUint8Array(base64) {
  // إزالة الترويسة إذا كانت موجودة (مثال: data:image/png;base64,)
  const b64Data = base64.replace(/^data:image\/\w+;base64,/, '');
  const binaryString = atob(b64Data);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * فحص نوع الملف (Magic Bytes) لتجنب رفع ملفات خبيثة
 */
function getMimeTypeFromMagicBytes(bytes) {
  if (bytes.length < 4) return null;
  
  // JPEG: FF D8 FF
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    return 'image/jpeg';
  }
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
    return 'image/png';
  }
  // WEBP: RIFF...WEBP (52 49 46 46 ... 57 45 42 50)
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'image/webp';
  }
  // GIF: GIF8
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return 'image/gif';
  }
  
  return null;
}

/**
 * المنطق المشترك لرفع الصورة
 */
async function processAndUpload(env, base64Data, maxSize, folder) {
  if (!env.MEDIA) return { ok: false, error: 'R2 Bucket is not configured' };
  if (!base64Data) return { ok: false, error: 'لم يتم إرسال بيانات الصورة' };

  let bytes;
  try {
    bytes = base64ToUint8Array(base64Data);
  } catch (err) {
    return { ok: false, error: 'تنسيق الصورة غير صالح' };
  }

  if (bytes.byteLength > maxSize) {
    return { ok: false, error: `حجم الصورة يتجاوز الحد المسموح (${Math.round(maxSize/1024/1024)}MB)` };
  }

  const mimeType = getMimeTypeFromMagicBytes(bytes);
  if (!mimeType) {
    return { ok: false, error: 'نوع الملف غير مدعوم (فقط JPG, PNG, WEBP, GIF)' };
  }

  // امتداد الملف من الـ MIME
  const ext = mimeType.split('/')[1];
  const filename = `${folder}/${Date.now()}_${generateToken().substring(0,8)}.${ext}`;

  await env.MEDIA.put(filename, bytes, {
    httpMetadata: { contentType: mimeType }
  });

  // إعادة رابط يمكن الوصول إليه (إذا كان الـ Bucket عاماً)
  // أو الرابط النسبي ليتم معالجته لاحقاً عبر Workers
  const url = `/${filename}`;

  return { ok: true, url, message: 'تم رفع الصورة بنجاح' };
}

/**
 * [PUBLIC] رفع صورة من الزوار (مثلاً في التقييمات)
 */
export async function publicUploadImage(env, params) {
  // يمكن تطبيق rate limiting إضافي هنا أو CAPTCHA
  return processAndUpload(env, params.data || params.image, MAX_PUBLIC_SIZE, 'reviews');
}

/**
 * [ADMIN] رفع صورة من الأدمن (المنتجات، البانرات)
 */
export async function adminUploadImage(env, params) {
  return processAndUpload(env, params.data || params.image, MAX_ADMIN_SIZE, 'products');
}

/**
 * [ADMIN] حذف ملف من R2
 */
export async function adminDeleteMedia(env, params) {
  if (!env.MEDIA) return { ok: false, error: 'R2 Bucket is not configured' };
  const key = params.key;
  if (!key) return { ok: false, error: 'مفتاح الملف مطلوب' };
  if (key.includes('..')) return { ok: false, error: 'مسار غير مسموح به' };
  await env.MEDIA.delete(key);
  return { ok: true, message: 'تم حذف الملف' };
}

/**
 * [ADMIN] قائمة الملفات من R2
 */
export async function adminListMedia(env, params) {
  if (!env.MEDIA) return { ok: false, error: 'R2 Bucket is not configured' };
  const prefix = params.prefix || '';
  const listed = await env.MEDIA.list({ prefix, limit: 100 });
  return {
    ok: true,
    files: listed.objects.map(o => ({
      key:          o.key,
      size:         o.size,
      uploaded:     o.uploaded,
      content_type: o.httpMetadata?.contentType,
    })),
    truncated: listed.truncated,
  };
}
