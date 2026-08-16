/**
 * Phase 6 — Storefront review data-contract verification (STAGING).
 *
 * Proves the canonical review contract end-to-end against the real staging
 * API, exactly matching what the fixed storefront (index.html) now sends/reads:
 *
 *   - upload_image  → { ok, url, key } (absolute /media/ URL, R2 folder reviews/)
 *   - add_review    → accepts { product_id, author_name, content, rating,
 *                     image_url, phone } and stores author_phone; review is
 *                     stored status='pending' until admin approval.
 *   - get_reviews   → { reviews: [{ id, author_name, content, rating,
 *                     image_url, created_at }] } — NO legacy fields
 *                     (r.name / r.text / r.photos / r.location).
 *
 * Also asserts that the OLD legacy submit payload (name/text/photo fields)
 * is REJECTED, which is exactly why the frontend fix was required.
 * All synthetic data (review row + uploaded R2 object) is cleaned up.
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
  console.log('=== PHASE 6 — STOREFRONT REVIEW CONTRACT VERIFICATION (STAGING) ===\n');

  // ── 0. Scaffolding ──
  // A real product id from the live catalog.
  const catalog = await req('catalog', {});
  const productId = catalog.data?.products?.[0]?.id;
  log('0a. catalog returns a real product id', Number.isInteger(productId) && productId > 0, String(productId));

  const SYNC = crypto.randomBytes(3).toString('hex');
  const AUTHOR = 'Phase6 Test ' + SYNC;
  const REVIEW_MARK = 'p6-review-' + SYNC;
  const PHONE = '0550' + String(Math.floor(100000 + Math.random() * 899999));

  // Cleanup any leftover from a prior partial run
  d1(`DELETE FROM reviews WHERE image_url = '${REVIEW_MARK}' OR image_url LIKE '${REVIEW_MARK}%';`);

  // ── 1. upload_image returns the canonical {ok,url,key} ──
  // Minimal valid 1x1 JPEG (magic bytes FF D8 FF → sniffed as image/jpeg).
  const jpegBase64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==';
  const up = await req('upload_image', {
    data: jpegBase64,
    fileName: 'p6_' + SYNC + '.jpg',
    mimeType: 'image/jpeg',
  });
  log('1a. upload_image returns ok:true', up.data?.ok === true);
  const mediaUrl = up.data?.url;
  const mediaKey = up.data?.key;
  log('1b. upload_image returns absolute url', typeof mediaUrl === 'string' && /^https:\/\/.+?\/media\/reviews\//.test(mediaUrl), String(mediaUrl));
  log('1c. upload_image returns key under reviews/', typeof mediaKey === 'string' && mediaKey.startsWith('reviews/'), String(mediaKey));

  if (mediaUrl) {
    const imgRes = await fetch(mediaUrl, { headers: { Origin: ORIGIN } });
    const buf = Buffer.from(await imgRes.arrayBuffer());
    const isJpeg = buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
    log('1d. uploaded image is servable and is a real JPEG', imgRes.status === 200 && isJpeg, `HTTP ${imgRes.status}, ${buf.length} bytes`);
  } else {
    log('1d. uploaded image is servable and is a real JPEG', false, 'no url to fetch');
  }

  // ── 2. add_review accepts the canonical payload (phone + image_url) ──
  const addRes = await req('add_review', {
    product_id: productId,
    author_name: AUTHOR,
    content: 'Phase6 content ' + SYNC,
    rating: 5,
    image_url: mediaUrl || REVIEW_MARK,
    phone: PHONE,
  });
  log('2a. add_review with canonical payload succeeds', addRes.data?.ok === true, JSON.stringify(addRes.data));

  const row = d1(`SELECT author_name, author_phone, content, rating, image_url, status FROM reviews WHERE author_name = '${AUTHOR}';`);
  const r = row[0];
  log('2b. review row stored with author_name', r?.author_name === AUTHOR);
  log('2c. phone persisted to author_phone column', r?.author_phone === PHONE);
  log('2d. content/rating/image_url persisted', r?.content === 'Phase6 content ' + SYNC && r?.rating === 5 && !!r?.image_url);
  log('2e. review stored as pending (waits admin approval)', r?.status === 'pending', String(r?.status));

  // ── 3. Legacy (old GAS) payload is REJECTED — the contract fix is required ──
  const legacy = await req('add_review', {
    product_id: productId,
    name: 'Legacy Name ' + SYNC,
    text: 'legacy text',
    rating: 4,
    photos: [{ url: mediaUrl }],
    location: 'Algiers',
  });
  const legacyBlocked = legacy.data?.ok !== true && !!legacy.data?.error;
  const legacyRows = d1(`SELECT id FROM reviews WHERE author_name = 'Legacy Name ${SYNC}';`);
  log('3a. legacy {name,text,photos,location} payload is rejected', legacyBlocked, JSON.stringify(legacy.data));
  log('3b. rejected legacy payload writes nothing to DB', legacyRows.length === 0);

  // ── 4. get_reviews returns only canonical fields ──
  // Approve the synthetic review the same way an admin would (D1 status flip),
  // because get_reviews filters status='approved'.
  d1(`UPDATE reviews SET status='approved' WHERE author_name = '${AUTHOR}';`);

  const reviews = await req('get_reviews', { product_id: productId });
  const found = (reviews.data?.reviews || []).find(x => x.author_name === AUTHOR);
  log('4a. get_reviews returns the approved review', !!found);
  log('4b. review exposes canonical id/author_name/content', !!found && !!found.id && found.author_name === AUTHOR && found.content === 'Phase6 content ' + SYNC);
  log('4c. review exposes canonical rating/image_url/created_at', !!found && found.rating === 5 && !!found.image_url && !!found.created_at, JSON.stringify(found));
  const keys = found ? Object.keys(found) : [];
  const forbidden = keys.filter(k => ['name', 'text', 'photos', 'location'].includes(k));
  log('4d. NO legacy fields (name/text/photos/location) in review payload', found && forbidden.length === 0, forbidden.join(',') || 'clean');

  // ── 5. Negative: unknown product rejected ──
  const badProduct = await req('add_review', { product_id: 999999999, author_name: AUTHOR, content: 'x', rating: 5 });
  log('5a. add_review for non-existent product is rejected', badProduct.data?.ok !== true, JSON.stringify(badProduct.data));

  // ── 6. Cleanup — remove review row + uploaded R2 object ──
  d1(`DELETE FROM reviews WHERE author_name = '${AUTHOR}';`);
  const goneRow = d1(`SELECT id FROM reviews WHERE author_name = '${AUTHOR}';`);
  log('6a. synthetic review deleted from D1', goneRow.length === 0);

  if (mediaKey) {
    try {
      execSync(`npx wrangler r2 object delete smart-shopping-media-staging/${mediaKey} --env staging`, { encoding: 'utf8' });
      const stillThere = await fetch(mediaUrl, { headers: { Origin: ORIGIN } });
      log('6b. uploaded R2 object deleted (wrangler r2 object delete)', stillThere.status === 404, `HTTP ${stillThere.status}`);
    } catch (e) {
      log('6b. uploaded R2 object deleted (wrangler r2 object delete)', false, String(e.message).split('\n')[0]);
    }
  } else {
    log('6b. uploaded R2 object deleted', false, 'no key captured');
  }

  const finalLeft = d1(`SELECT id FROM reviews WHERE image_url = '${REVIEW_MARK}' OR image_url LIKE '${REVIEW_MARK}%' OR author_name = '${AUTHOR}';`);
  log('6c. no synthetic review artifacts remain', finalLeft.length === 0);

  console.log(`\n=== SUMMARY: pass=${pass} fail=${fail} ===`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
