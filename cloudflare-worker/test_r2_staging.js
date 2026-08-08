// اختبار R2 على Staging الحقيقي
const BASE = 'https://smart-shopping-api-staging.mostaphaserkhad.workers.dev';

// GIF 1x1 pixel
const gifBase64 = 'R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
// ملف نصي (سيُرفض)
const textBase64 = Buffer.from('Hello World! This is not an image.').toString('base64');
// ملف كبير (5.1MB — سيُرفض لتجاوز الحد العام 2MB)
const bigBase64 = Buffer.alloc(5.1 * 1024 * 1024, 0xFF).toString('base64');

async function getAdminToken() {
  // في البيئة الجديدة تكون DB فارغة فتعمل setup_mode
  const setup = new URLSearchParams({ action: 'admin_update_settings', admin_password: 'testpass' });
  const sr = await fetch(`${BASE}/`, { method: 'POST', body: setup });
  const sj = await sr.json();
  console.log('Setup response:', sj);

  const login = new URLSearchParams({ action: 'verify_admin', password: 'testpass' });
  const res = await fetch(`${BASE}/`, { method: 'POST', body: login });
  const json = await res.json();
  console.log('Login response:', json);
  return json.token;
}

async function testR2Staging() {
  console.log('=== 🪣 اختبار R2 على Staging ===\n');

  const token = await getAdminToken();
  if (!token) { console.log('❌ لم أتمكن من تسجيل الدخول'); process.exit(1); }
  console.log('✅ تسجيل الدخول ناجح\n');

  const headers = { 'Authorization': `Bearer ${token}` };

  let uploadedKey = null;

  // ─── 1. رفع صورة صحيحة ───
  console.log('[1] رفع صورة GIF صحيحة...');
  const r1 = await fetch(`${BASE}/`, {
    method: 'POST', headers,
    body: new URLSearchParams({ action: 'admin_upload_image', data: gifBase64 })
  });
  const j1 = await r1.json();
  if (j1.ok && j1.url) {
    uploadedKey = j1.url.replace(/^\//, '');
    console.log(`✅ PASS — رُفعت على: ${j1.url}\n`);
  } else {
    console.log('❌ FAIL:', j1); process.exit(1);
  }

  // ─── 2. رفض ملف نصي (Magic Bytes) ───
  console.log('[2] رفض ملف نصي (فحص Magic Bytes)...');
  const r2 = await fetch(`${BASE}/`, {
    method: 'POST', headers,
    body: new URLSearchParams({ action: 'admin_upload_image', data: textBase64 })
  });
  const j2 = await r2.json();
  if (!j2.ok && j2.error?.includes('غير مدعوم')) {
    console.log('✅ PASS — رُفض بشكل صحيح\n');
  } else {
    console.log('❌ FAIL:', j2); process.exit(1);
  }

  // ─── 3. رفض ملف كبير ───
  console.log('[3] رفض ملف يتجاوز الحجم (5MB للأدمن = مسموح، 5.1MB = مرفوض)...');
  const r3 = await fetch(`${BASE}/`, {
    method: 'POST', headers,
    body: new URLSearchParams({ action: 'admin_upload_image', data: bigBase64 })
  });
  const j3 = await r3.json();
  if (!j3.ok && j3.error?.includes('يتجاوز الحد')) {
    console.log('✅ PASS — رُفض بشكل صحيح\n');
  } else {
    console.log('❌ FAIL:', j3); process.exit(1);
  }

  // ─── 4. قراءة قائمة الملفات ───
  console.log('[4] قراءة قائمة ملفات R2...');
  const r4 = await fetch(`${BASE}/?action=admin_list_media`, { headers });
  const j4 = await r4.json();
  if (j4.ok && Array.isArray(j4.files)) {
    console.log(`✅ PASS — عدد الملفات: ${j4.files.length}\n`);
  } else {
    console.log('❌ FAIL:', j4); process.exit(1);
  }

  // ─── 5. حذف الملف المرفوع ───
  console.log('[5] حذف الملف المرفوع...');
  const r5 = await fetch(`${BASE}/`, {
    method: 'POST', headers,
    body: new URLSearchParams({ action: 'admin_delete_media', key: uploadedKey })
  });
  const j5 = await r5.json();
  if (j5.ok) {
    console.log('✅ PASS — حُذف بنجاح\n');
  } else {
    console.log('❌ FAIL:', j5); process.exit(1);
  }

  // ─── 6. التحقق من الحذف ───
  console.log('[6] التحقق أن الملف غير موجود بعد الحذف...');
  const r6 = await fetch(`${BASE}/?action=admin_list_media`, { headers });
  const j6 = await r6.json();
  const stillExists = j6.files?.some(f => f.key === uploadedKey);
  if (!stillExists) {
    console.log('✅ PASS — الملف محذوف من R2\n');
  } else {
    console.log('❌ FAIL: الملف لا يزال موجوداً'); process.exit(1);
  }

  console.log('======================================');
  console.log('🏆 جميع اختبارات R2 نجحت على Staging!');
  console.log('======================================');
}

testR2Staging().catch(console.error);
