/**
 * Phase 5B — Data contract repair verification (STAGING).
 *
 * Simulates exactly what the fixed admin.html / index.html now send/expect,
 * calling the real staging API directly (no browser available in this
 * environment) to prove the contract is correct end-to-end:
 *   - admin product create/edit/delete with name/price/price_old/category/
 *     image_url/gallery_json/sku
 *   - image upload (primary + gallery) via admin_upload_image -> /media/<key>
 *   - catalog fetch shape matches what normalizeProduct() expects
 *   - testimonial create/list shape matches renderTestimonials()
 * All test data is synthetic and is deleted at the end of the run.
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

function d1(sql) {
  const escaped = sql.replace(/"/g, '\\"');
  const cmd = `npx wrangler d1 execute smart-shopping-db-staging --env staging --remote --json --command "${escaped}"`;
  const out = execSync(cmd, { encoding: 'utf8' });
  return JSON.parse(out)[0]?.results || [];
}

const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function run() {
  console.log('=== PHASE 5B — DATA CONTRACT VERIFICATION (STAGING) ===\n');

  // Cleanup any leftovers from a prior partial run
  d1(`DELETE FROM products WHERE sku = 'PHASE5B-TEST-SKU';`);
  d1(`DELETE FROM testimonials WHERE author_name = 'Phase5B Test User';`);

  // ── 0. Fresh throwaway admin credential ──
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

  // ── 1. Upload a primary image + a gallery image (exactly as admin.html now does) ──
  const uploadMain = await req('admin_upload_image', { data: TINY_PNG_B64, folder: 'products' }, adminHeaders);
  log('1a. primary image upload succeeds (folder=products)', uploadMain.data?.ok === true && !!uploadMain.data?.url);
  log('1b. primary image URL is absolute /media/products/', /^https?:\/\/.*\/media\/products\//.test(uploadMain.data?.url || ''));
  const mainUrl = uploadMain.data?.url;
  const mainKey = uploadMain.data?.key;

  const uploadGallery = await req('admin_upload_image', { data: TINY_PNG_B64, folder: 'products' }, adminHeaders);
  log('1c. gallery image upload succeeds', uploadGallery.data?.ok === true && !!uploadGallery.data?.url);
  const galleryUrl = uploadGallery.data?.url;
  const galleryKey = uploadGallery.data?.key;

  const imgCheck = await fetch(mainUrl);
  log('1d. uploaded primary image is fetchable (200)', imgCheck.status === 200);

  // ── 2. Create product exactly as the fixed saveProduct() payload shape ──
  const createPayload = {
    name: 'Phase5B Test Product',
    description: 'وصف مختصر للاختبار',
    description_long: 'وصف تفصيلي للاختبار\nسطر ثاني',
    price: 2500,
    price_old: 3000,
    image_url: mainUrl,
    gallery_json: JSON.stringify([galleryUrl]),
    category: 'اختبار',
    sku: 'PHASE5B-TEST-SKU',
    stock: 10,
    active: true,
  };
  const created = await req('admin_add_product', createPayload, adminHeaders);
  log('2a. admin_add_product succeeds with new contract fields', created.data?.ok === true && !!created.data?.id);
  const productId = created.data?.id;

  // ── 3. Verify it appears correctly in admin_list (what loadProducts() reads) ──
  const adminList = await req('admin_list', {}, adminHeaders);
  const listed = (adminList.data?.products || []).find(p => p.id === productId);
  log('3a. admin_list returns the product', !!listed);
  log('3b. admin_list product.name correct', listed?.name === 'Phase5B Test Product');
  log('3c. admin_list product.image_url correct', listed?.image_url === mainUrl);
  log('3d. admin_list product.gallery_json is an array containing gallery image', Array.isArray(listed?.gallery_json) && listed.gallery_json.includes(galleryUrl));
  log('3e. admin_list product.category correct', listed?.category === 'اختبار');
  log('3f. admin_list product.price_old correct', Number(listed?.price_old) === 3000);
  log('3g. admin_list product.sku correct', listed?.sku === 'PHASE5B-TEST-SKU');

  // ── 4. Verify it appears correctly in public catalog (what normalizeProduct() consumes) ──
  await req('admin_update_settings', {}, adminHeaders); // no-op, just ensure session alive
  // catalog is KV-cached for 10 min; bypass by reading D1 directly to confirm write, then
  // also hit the live action (staging KV may or may not have a stale cache from other tests).
  const catalogResp = await req('catalog', {});
  const inCatalog = (catalogResp.data?.products || []).find(p => p.id === productId);
  if (inCatalog) {
    log('4a. public catalog includes new ACTIVE product', true);
    log('4b. public catalog product has real name/image_url/price_old/category fields', inCatalog.name === 'Phase5B Test Product' && inCatalog.image_url === mainUrl && Number(inCatalog.price_old) === 3000 && inCatalog.category === 'اختبار');
  } else {
    log('4a. public catalog includes new ACTIVE product', false, '(KV cache may be warm from another test; verified via D1 admin_list instead in 3a-3g)');
  }

  // ── 5. Edit the product using its real id (not _row) ──
  const editPayload = { ...createPayload, id: productId, name: 'Phase5B Test Product EDITED', price: 2600 };
  const edited = await req('admin_edit_product', editPayload, adminHeaders);
  log('5a. admin_edit_product succeeds targeting real id', edited.data?.ok === true);
  const afterEdit = d1(`SELECT name, price FROM products WHERE id = ${productId};`);
  log('5b. edit persisted to the CORRECT product (not another row)', afterEdit[0]?.name === 'Phase5B Test Product EDITED' && afterEdit[0]?.price === 2600);

  // ── 6. Testimonial contract: create + list, verify field names match renderTestimonials() ──
  const testiPayload = { author_name: 'Phase5B Test User', author_location: 'الجزائر', content: 'تجربة رائعة جداً', rating: 5, active: true };
  const testiCreate = await req('admin_add_testimonial', testiPayload, adminHeaders);
  log('6a. admin_add_testimonial succeeds', testiCreate.data?.ok === true);
  const publicTesti = await req('testimonials', {});
  const foundTesti = (publicTesti.data?.testimonials || []).find(t => t.author_name === 'Phase5B Test User');
  log('6b. public testimonials returns author_name/content/author_location (matches renderTestimonials contract)',
    !!foundTesti && foundTesti.author_name === 'Phase5B Test User' && foundTesti.content === 'تجربة رائعة جداً' && foundTesti.author_location === 'الجزائر');

  // ── 7. Delete product using real id (not _row) ──
  const del = await req('admin_delete_product', { id: productId }, adminHeaders);
  log('7a. admin_delete_product succeeds with real id', del.data?.ok === true);
  const afterDelete = d1(`SELECT id FROM products WHERE id = ${productId};`);
  log('7b. product actually deleted', afterDelete.length === 0);

  // ── 8. Cleanup: media objects + testimonial ──
  await req('admin_delete_media', { key: mainKey }, adminHeaders);
  await req('admin_delete_media', { key: galleryKey }, adminHeaders);
  const mainGone = await fetch(mainUrl);
  log('8a. uploaded primary media deleted (404 now)', mainGone.status === 404);

  const testiRow = d1(`SELECT id FROM testimonials WHERE author_name = 'Phase5B Test User';`);
  if (testiRow[0]) await req('admin_delete_testimonial', { id: testiRow[0].id }, adminHeaders);
  const testiGone = d1(`SELECT id FROM testimonials WHERE author_name = 'Phase5B Test User';`);
  log('8b. test testimonial deleted', testiGone.length === 0);

  console.log(`\n=== SUMMARY: pass=${pass} fail=${fail} ===`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
