import { generateToken, DEFAULT_MASTER_TENANT_ID } from '../utils/auth.js';

// الحد الأقصى للصورة للزوار (مثلاً 2 ميجابايت) وللأدمن (مثلاً 5 ميجابايت)
const MAX_PUBLIC_SIZE = 2 * 1024 * 1024;
const MAX_ADMIN_SIZE  = 5 * 1024 * 1024;

/**
 * دالة مساعدة لتحويل base64 إلى Uint8Array
 */
function base64ToUint8Array(base64) {
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
  
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    return 'image/jpeg';
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'image/webp';
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return 'image/gif';
  }
  
  return null;
}

/**
 * المنطق المشترك لرفع الصورة مع عزل مسارات المستأجر (Tenant Isolated R2 Storage)
 */
async function processAndUpload(env, base64Data, maxSize, folder, request, tenantId = DEFAULT_MASTER_TENANT_ID) {
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

  const ext = mimeType.split('/')[1];
  const filename = `tenants/${tenantId}/${folder}/${Date.now()}_${generateToken().substring(0,8)}.${ext}`;

  await env.MEDIA.put(filename, bytes, {
    httpMetadata: { contentType: mimeType }
  });

  const origin = request ? new URL(request.url).origin : '';
  const url = `${origin}/media/${filename}`;

  return { ok: true, url, key: filename, message: 'تم رفع الصورة بنجاح' };
}

/**
 * [PUBLIC] رفع صورة من الزوار (مثلاً في التقييمات)
 */
export async function publicUploadImage(env, params, request, tenantId = DEFAULT_MASTER_TENANT_ID) {
  return processAndUpload(env, params.data || params.image, MAX_PUBLIC_SIZE, 'reviews', request, tenantId);
}

/**
 * [ADMIN] رفع صورة من الأدمن مع عزل التاجر
 */
export async function adminUploadImage(env, params, request, tenantId = DEFAULT_MASTER_TENANT_ID) {
  const ALLOWED_FOLDERS = new Set(['products', 'banners', 'logos']);
  const folder = ALLOWED_FOLDERS.has(params.folder) ? params.folder : 'products';
  return processAndUpload(env, params.data || params.image, MAX_ADMIN_SIZE, folder, request, tenantId);
}

/**
 * [PUBLIC][GET] خدمة ملف مخزَّن في R2 مع دعم المسارات المعزولة والتوافقية القديمة
 */
export async function serveMedia(env, key, request, corsHeaders) {
  if (!env.MEDIA || !key) {
    return new Response('Not found', { status: 404, headers: corsHeaders });
  }

  // منع path traversal
  if (key.includes('..')) {
    return new Response('Not found', { status: 404, headers: corsHeaders });
  }

  // دعم المسارات الحديثة tenants/... والمسارات القديمة products/..., banners/..., logos/..., reviews/...
  const ALLOWED_PREFIXES = ['tenants/', 'products/', 'banners/', 'logos/', 'reviews/'];
  if (!ALLOWED_PREFIXES.some(p => key.startsWith(p))) {
    return new Response('Not found', { status: 404, headers: corsHeaders });
  }

  const object = await env.MEDIA.get(key);

  if (object === null) {
    return new Response('Not found', {
      status: 404,
      headers: { ...corsHeaders, 'Cache-Control': 'no-store' },
    });
  }

  const headers = new Headers(corsHeaders);
  headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('ETag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('Content-Length', String(object.size));

  return new Response(object.body, { status: 200, headers });
}

/**
 * [ADMIN] حذف ملف من R2 مع حماية عزل التاجر (IDOR Protection)
 */
export async function adminDeleteMedia(env, params, tenantId = DEFAULT_MASTER_TENANT_ID) {
  if (!env.MEDIA) return { ok: false, error: 'R2 Bucket is not configured' };
  const key = params.key;
  if (!key) return { ok: false, error: 'مفتاح الملف مطلوب' };
  if (key.includes('..')) return { ok: false, error: 'مسار غير مسموح به' };

  // التحقق من أن المفتاح يتبع لهذا التاجر تحديداً
  const isOwnTenantMedia = key.startsWith(`tenants/${tenantId}/`);
  const isMasterLegacy = (tenantId === DEFAULT_MASTER_TENANT_ID && !key.startsWith('tenants/'));

  if (!isOwnTenantMedia && !isMasterLegacy) {
    return { ok: false, error: 'لا تملك صلاحية حذف هذا الملف' };
  }

  await env.MEDIA.delete(key);
  return { ok: true, message: 'تم حذف الملف بنجاح' };
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
