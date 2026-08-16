/**
 * Phase 5C — Admin CRUD contract repair verification (STAGING).
 *
 * Simulates exactly what the fixed admin.html now sends/expects, calling the
 * real staging API directly (no browser available in this environment) to prove
 * the contract is correct end-to-end:
 *   - ORDERS:    list via admin_orders, identify by order_id, update status,
 *                persist, delete synthetic order by order_id, verify deleted,
 *                verify a pre-existing real order is unaffected.
 *   - COUPONS:   create / list / edit-by-id / delete.
 *   - TESTIMONIALS: create / list (verify author_name/content/author_location) /
 *                   edit-by-id / delete.
 *   - REVIEWS:   list (verify real field names product_name, product_id,
 *                author_name, author_phone, content, image_url, rating,
 *                created_at, id), delete-by-id.
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

async function run() {
  console.log('=== PHASE 5C — ADMIN CRUD CONTRACT VERIFICATION (STAGING) ===\n');

  // Synthetic identifiers (cleanup targets)
  const SYNTH_ORDER_ID = 'SK-5C-TEST-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const COUPON_CODE = 'P5C' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const TESTI_AUTHOR = 'Phase5C Test User ' + crypto.randomBytes(2).toString('hex');
  const REVIEW_SLUG = 'p5c-review-' + crypto.randomBytes(3).toString('hex');

  // Cleanup any leftovers from a prior partial run
  d1(`DELETE FROM orders WHERE order_id = '${SYNTH_ORDER_ID}';`);
  d1(`DELETE FROM coupons WHERE code = '${COUPON_CODE}';`);
  d1(`DELETE FROM testimonials WHERE author_name LIKE 'Phase5C Test User%';`);
  d1(`DELETE FROM reviews WHERE image_url = '${REVIEW_SLUG}';`);

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
  log('0. staging admin login (fresh throwaway credential)', adminLogin.data?.ok === true);
  const adminToken = adminLogin.data?.token;
  const adminHeaders = { Authorization: `Bearer ${adminToken}` };

  // ── 1. ORDERS: list, identify by order_id ──
  // Snapshot a real pre-existing order to prove it is unaffected later.
  const preList = await req('admin_orders', {}, adminHeaders);
  const preOrders = preList.data?.orders || [];
  const realOrder = preOrders[0];
  log('1a. admin_orders lists orders', Array.isArray(preOrders) && preOrders.length > 0);

  // Insert a synthetic order directly into staging D1 (no public path needed).
  d1(`INSERT INTO orders (order_id, name, phone, wilaya_ar, delivery_type, items_json, subtotal, status) VALUES ('${SYNTH_ORDER_ID}', 'Phase5C Test', '0500000999', 'الجزائر', 'home', '[]', 0, 'pending');`);

  const listAfterInsert = await req('admin_orders', {}, adminHeaders);
  const foundSynth = (listAfterInsert.data?.orders || []).find(o => o.order_id === SYNTH_ORDER_ID);
  log('1b. synthetic order appears in admin_orders (identify by order_id)', !!foundSynth);

  // ── 2. ORDERS: update status + persist ──
  const upd = await req('admin_update_order', { order_id: SYNTH_ORDER_ID, status: 'confirmed' }, adminHeaders);
  log('2a. admin_update_order by order_id succeeds', upd.data?.ok === true);
  const updatedRow = d1(`SELECT status FROM orders WHERE order_id = '${SYNTH_ORDER_ID}';`);
  log('2b. status persisted (confirmed)', updatedRow[0]?.status === 'confirmed');

  // ── 3. ORDERS: delete synthetic by order_id, verify gone ──
  const del = await req('admin_delete_order', { order_id: SYNTH_ORDER_ID }, adminHeaders);
  log('3a. admin_delete_order by order_id succeeds', del.data?.ok === true);
  const goneRow = d1(`SELECT id FROM orders WHERE order_id = '${SYNTH_ORDER_ID}';`);
  log('3b. synthetic order deleted', goneRow.length === 0);

  // ── 4. ORDERS: pre-existing real order unaffected ──
  const listAfterDel = await req('admin_orders', {}, adminHeaders);
  const realStillThere = (listAfterDel.data?.orders || []).some(o => o.order_id === realOrder?.order_id);
  log('4a. pre-existing real order still present after synthetic CRUD', !!realOrder && realStillThere);

  // ── 5. COUPONS: create ──
  const couponPayload = {
    code: COUPON_CODE,
    discount_type: 'percent',
    discount_value: 10,
    min_order: 1000,
    max_uses: 5,
    expires_at: '2027-12-31',
    active: '1',
  };
  const addCoupon = await req('admin_add_coupon', couponPayload, adminHeaders);
  log('5a. admin_add_coupon succeeds', addCoupon.data?.ok === true && !!addCoupon.data?.id);
  const couponId = addCoupon.data?.id;

  // ── 6. COUPONS: list + identify by id ──
  const listCoupons = await req('admin_list_coupons', {}, adminHeaders);
  const foundCoupon = (listCoupons.data?.coupons || []).find(c => c.id === couponId);
  log('6a. coupon found in admin_list_coupons by id', !!foundCoupon && foundCoupon.code === COUPON_CODE);

  // ── 7. COUPONS: edit by id + persist ──
  const editCoupon = await req('admin_edit_coupon', { ...couponPayload, id: couponId, discount_value: 15 }, adminHeaders);
  log('7a. admin_edit_coupon by id succeeds', editCoupon.data?.ok === true);
  const couponRow = d1(`SELECT discount_value, code FROM coupons WHERE id = ${couponId};`);
  log('7b. coupon edit persisted', couponRow[0]?.discount_value === 15 && couponRow[0]?.code === COUPON_CODE);

  // ── 8. COUPONS: delete by id + verify gone ──
  const delCoupon = await req('admin_delete_coupon', { id: couponId }, adminHeaders);
  log('8a. admin_delete_coupon by id succeeds', delCoupon.data?.ok === true);
  const couponGone = d1(`SELECT id FROM coupons WHERE id = ${couponId};`);
  log('8b. coupon deleted', couponGone.length === 0);

  // ── 9. TESTIMONIALS: create ──
  const testiPayload = {
    author_name: TESTI_AUTHOR,
    author_location: 'الجزائر',
    content: 'تجربة رائعة جداً مع منتجات Smart Shopping',
    rating: 5,
    active: '1',
  };
  const addTesti = await req('admin_add_testimonial', testiPayload, adminHeaders);
  log('9a. admin_add_testimonial succeeds', addTesti.data?.ok === true && !!addTesti.data?.id);
  const testiId = addTesti.data?.id;

  // ── 10. TESTIMONIALS: list + verify author_name/content/author_location ──
  const listTesti = await req('admin_list_testimonials', {}, adminHeaders);
  const foundTesti = (listTesti.data?.testimonials || []).find(t => t.id === testiId);
  log('10a. testimonial found by id', !!foundTesti);
  log('10b. testimonial author_name/content/author_location correct',
    foundTesti?.author_name === TESTI_AUTHOR && foundTesti?.content === testiPayload.content && foundTesti?.author_location === 'الجزائر');

  // ── 11. TESTIMONIALS: edit by id + persist ──
  const editTesti = await req('admin_edit_testimonial', { ...testiPayload, id: testiId, content: 'محتوى معدل', rating: 4 }, adminHeaders);
  log('11a. admin_edit_testimonial by id succeeds', editTesti.data?.ok === true);
  const testiRow = d1(`SELECT content, rating FROM testimonials WHERE id = ${testiId};`);
  log('11b. testimonial edit persisted', testiRow[0]?.content === 'محتوى معدل' && testiRow[0]?.rating === 4);

  // ── 12. TESTIMONIALS: delete by id + verify gone ──
  const delTesti = await req('admin_delete_testimonial', { id: testiId }, adminHeaders);
  log('12a. admin_delete_testimonial by id succeeds', delTesti.data?.ok === true);
  const testiGone = d1(`SELECT id FROM testimonials WHERE id = ${testiId};`);
  log('12b. testimonial deleted', testiGone.length === 0);

  // ── 13. REVIEWS: list exposes the real contract field names ──
  // Insert a synthetic review (no public admin-add endpoint exists) using the
  // exact columns the fixed loadReviews() now renders.
  const productId = (await req('catalog', {}))?.data?.products?.[0]?.id || 1;
  d1(`INSERT INTO reviews (product_id, author_name, author_phone, content, rating, image_url, status) VALUES (${productId}, 'Phase5C Review', '0500000998', 'محتوى تقييم', 5, '${REVIEW_SLUG}', 'approved');`);

  const listReviews = await req('admin_list_reviews', {}, adminHeaders);
  const foundReview = (listReviews.data?.reviews || []).find(r => r.image_url === REVIEW_SLUG);
  log('13a. admin_list_reviews returns the synthetic review', !!foundReview);
  log('13b. review exposes product_name/product_id', !!foundReview && (!!foundReview.product_name || !!foundReview.product_id));
  log('13c. review exposes author_name/author_phone/content', !!foundReview && foundReview.author_name === 'Phase5C Review' && foundReview.author_phone === '0500000998' && foundReview.content === 'محتوى تقييم');
  log('13d. review exposes rating/created_at/id', !!foundReview && foundReview.rating === 5 && !!foundReview.created_at && !!foundReview.id);

  // ── 14. REVIEWS: delete by id + verify gone ──
  const delReview = await req('admin_delete_review', { id: foundReview?.id }, adminHeaders);
  log('14a. admin_delete_review by id succeeds', delReview.data?.ok === true);
  const reviewGone = d1(`SELECT id FROM reviews WHERE image_url = '${REVIEW_SLUG}';`);
  log('14b. review deleted', reviewGone.length === 0);

  // ── 15. Final safety: no synthetic artifacts remain anywhere ──
  const leftOrders = d1(`SELECT id FROM orders WHERE order_id = '${SYNTH_ORDER_ID}';`);
  const leftCoupons = d1(`SELECT id FROM coupons WHERE code = '${COUPON_CODE}';`);
  const leftTestis = d1(`SELECT id FROM testimonials WHERE author_name LIKE 'Phase5C Test User%';`);
  const leftReviews = d1(`SELECT id FROM reviews WHERE image_url = '${REVIEW_SLUG}';`);
  log('15. all synthetic test data removed',
    leftOrders.length === 0 && leftCoupons.length === 0 && leftTestis.length === 0 && leftReviews.length === 0);

  console.log(`\n=== SUMMARY: pass=${pass} fail=${fail} ===`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
