/**
 * Phase 5A — Media pipeline root-cause fix verification (STAGING).
 *
 * Verifies the full lifecycle: admin upload -> R2 storage -> absolute URL
 * -> GET /media/<key> served by the Worker -> correct Content-Type/bytes ->
 * cache headers -> banner settings round-trip -> cleanup.
 */
const crypto = require('crypto');
const { execSync } = require('child_process');

const BASE = 'https://smart-shopping-api-staging.mostaphaserkhad.workers.dev';
const ORIGIN = 'https://smartshopping.click';

let pass = 0, fail = 0;
function log(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' — ' + detail : ''}`);
  ok ? pass++ : fail++;
}
function sha256(s) { return crypto.createHash('sha256').update(s, 'utf8').digest('hex'); }

async function req(action, params = {}, headers = {}) {
  const url = `${BASE}?action=${encodeURIComponent(action)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(params),
  });
  let data = {};
  try { data = await res.json(); } catch { /* ignore */ }
  return { status: res.status, data };
}

// 1x1 red pixel PNG (valid magic bytes, tiny)
const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function run() {
  console.log('=== PHASE 5A — MEDIA PIPELINE VERIFICATION (STAGING) ===\n');

  // ── 0. fresh throwaway admin credential ──
  const rawAdminPw = crypto.randomBytes(24).toString('hex');
  const once = sha256(rawAdminPw);
  const twice = sha256(once);
  execSync('npx wrangler secret put ADMIN_PASSWORD_HASH --env staging', { input: twice });
  await new Promise(r => setTimeout(r, 12000));
  let adminLogin = { data: {} };
  for (let i = 0; i < 3; i++) {
    adminLogin = await req('verify_admin', { password: once });
    if (adminLogin.data?.ok) break;
    await new Promise(r => setTimeout(r, 10000));
  }
  log('0. staging admin login', adminLogin.data?.ok === true);
  const adminToken = adminLogin.data?.token;
  const adminHeaders = { Authorization: `Bearer ${adminToken}` };

  // ── 1. Admin uploads a test image (banners folder) ──
  const upload = await req('admin_upload_image', { data: TINY_PNG_B64, folder: 'banners' }, adminHeaders);
  log('1a. upload succeeds', upload.data?.ok === true && !!upload.data?.url);
  const mediaUrl = upload.data?.url;
  log('1b. returned URL is ABSOLUTE (starts with http)', /^https?:\/\//.test(mediaUrl || ''));
  log('1c. returned URL points at /media/ path', (mediaUrl || '').includes('/media/banners/'));
  const mediaKey = upload.data?.key;

  // ── 2. Fetch the image back via the returned URL (cold, no cache headers sent) ──
  const imgRes1 = await fetch(mediaUrl);
  log('2a. GET media URL returns 200', imgRes1.status === 200);
  log('2b. Content-Type is image/png', (imgRes1.headers.get('content-type') || '').includes('image/png'));
  log('2c. Cache-Control is long-lived/immutable', (imgRes1.headers.get('cache-control') || '').includes('immutable'));
  const bodyBuf = Buffer.from(await imgRes1.arrayBuffer());
  const expectedBuf = Buffer.from(TINY_PNG_B64, 'base64');
  log('2d. served bytes match uploaded bytes exactly', bodyBuf.equals(expectedBuf));
  const etag = imgRes1.headers.get('etag');
  log('2e. ETag present', !!etag);

  // ── 3. Repeat GET is consistent (same bytes, same ETag) ──
  const imgRes2 = await fetch(mediaUrl);
  const etag2 = imgRes2.headers.get('etag');
  log('3. repeat GET returns identical ETag/content', imgRes2.status === 200 && etag2 === etag);

  // ── 4. Nonexistent key -> 404, not 500, no crash ──
  const missing = await fetch(`${BASE}/media/banners/does-not-exist.png`);
  log('4. nonexistent media key returns 404 (graceful)', missing.status === 404);

  // ── 5. Path traversal attempt is rejected ──
  const traversal = await fetch(`${BASE}/media/../../etc/passwd`);
  log('5. path traversal attempt rejected (not 200)', traversal.status !== 200);

  // ── 6. Banner settings round-trip: save banner1_img = our uploaded URL, read it back ──
  const saveSettings = await req('admin_update_settings', { banner1_img: mediaUrl, banner1_title: 'Phase5A Test' }, adminHeaders);
  log('6a. admin_update_settings accepts banner fields', saveSettings.data?.ok === true);
  const publicSettings = await req('settings', {});
  log('6b. public settings reflects banner1_img', publicSettings.data?.banner1_img === mediaUrl || publicSettings.data?.settings?.banner1_img === mediaUrl);

  // ── 7. Cleanup: remove test banner settings + R2 object ──
  await req('admin_update_settings', { banner1_img: '', banner1_title: '' }, adminHeaders);
  const del = await req('admin_delete_media', { key: mediaKey }, adminHeaders);
  log('7a. admin_delete_media succeeds', del.data?.ok === true);
  const afterDelete = await fetch(mediaUrl);
  log('7b. deleted media now returns 404', afterDelete.status === 404);

  console.log(`\n=== SUMMARY: pass=${pass} fail=${fail} ===`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
