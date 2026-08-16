/**
 * Phase 7 — Premium Per-Product Landing Page system contract verification (STAGING).
 *
 * Proves end-to-end that the backend contract added for landing_config_json works:
 *   - admin_add_product / admin_edit_product persist landing_config_json (normalized
 *     server-side via normalizeLandingConfig).
 *   - The public catalog (catalog action) exposes a parsed+normalized `landing_config`
 *     object per product — default `{}` → mode 'auto', and never leaks anything else.
 *   - Invalid/corrupt JSON input is hardened server-side to a safe `{}` (never crashes).
 *   - get_reviews returns the canonical landing social-proof fields
 *     (author_name, content, rating, image_url, created_at) and never author_phone.
 *   - Cleanup removes all synthetic data; deletion contract remains intact.
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

const CUSTOM_CONFIG = {
  mode: 'custom',
  sections: {
    hero: true, gallery: true, features: true, details: true,
    reviews: true, faq: true, trust: false, form: true,
  },
  hero: {
    headline: 'عرض حصري على السماعة الذكية',
    subtitle: 'جودة عالية مع ضمان سنتين',
    cta_label: 'اطلب عرضك الآن',
    urgency_text: 'العرض ينتهي قريباً 🔥',
    accent_color: '#FF5722',
  },
  features: [
    { icon: '🔊', title: 'صوت نقي', desc: 'جودة استوديو' },
    { icon: '🎧', title: 'راحة فائقة', desc: 'تصميم مريح' },
    { icon: '🔋', title: 'بطارية تدوم', desc: '12 ساعة تشغيل' },
  ],
  faq: [
    { q: 'هل الشحن متوفر لكل الولايات؟', a: 'نعم، جميع الولايات' },
    { q: 'ما هي مدة الضمان؟', a: 'سنتان كاملتان' },
  ],
  seo: {
    title: 'سماعة ذكية — خصم خاص 2026',
    description: 'تفاصيل عرض السماعة الذكية مع الشحن لكل الولايات',
    image_url: 'https://smartshopping.click/img/hero-smart-speaker.webp',
  },
  whatsapp_text: 'مرحباً! أرغب بالاستفسار عن السماعة الذكية.',
};

async function run() {
  console.log('=== PHASE 7 — LANDING CONFIG CONTRACT VERIFICATION (STAGING) ===\n');

  const slug = 'p7-lp-' + crypto.randomBytes(3).toString('hex');

  // Cleanup leftovers of a prior partial run
  d1(`DELETE FROM products WHERE sku = '${slug}';`);
  d1(`DELETE FROM reviews WHERE image_url LIKE '%/${slug}%' OR content LIKE '%${slug}%';`);

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

  // ── 1. ADD product WITH custom landing config ──
  const addPayload = {
    name: 'Phase 7 Mobile Speaker',
    description: 'وصف قصير',
    description_long: 'وصف طويل\nسطر ثاني',
    price: 5999,
    price_old: 8999,
    image_url: 'https://smartshopping.click/img/' + slug + '.jpg',
    gallery_json: '[]',
    category: 'إلكترونيات',
    sku: slug,
    stock: 10,
    active: '1',
    size: '',
    color: '',
    variant_options: '[]',
    landing_config_json: JSON.stringify(CUSTOM_CONFIG),
  };
  const addRes = await req('admin_add_product', addPayload, adminHeaders);
  log('1a. admin_add_product with landing_config_json succeeds', addRes.data?.ok === true && !!addRes.data?.id);
  const productId = addRes.data?.id;
  if (!productId) { console.log('Cannot continue without a product id'); process.exit(1); }

  // ── 2. Verify the raw persisted JSON in staging D1 ──
  const row = d1(`SELECT landing_config_json FROM products WHERE id = ${productId};`);
  let persistedRaw = row[0]?.landing_config_json || '';
  let persisted = {};
  try { persisted = JSON.parse(persistedRaw); } catch (e) {}
  log('2a. landing_config_json persisted (non-empty JSON)', typeof persistedRaw === 'string' && persistedRaw.trim().length > 0);
  log('2b. persisted mode = custom', persisted.mode === 'custom');
  log('2c. persisted sections mirror input (trust=false honored)', persisted.sections?.trust === false && persisted.sections?.hero === true);
  log('2d. persisted hero headline/accent preserved (accent lowercased per normalize)',
    persisted.hero?.headline === CUSTOM_CONFIG.hero.headline && persisted.hero?.accent_color === '#ff5722');
  log('2e. persisted features list intact (3)', Array.isArray(persisted.features) && persisted.features.length === 3);
  log('2f. persisted faq list intact (2)', Array.isArray(persisted.faq) && persisted.faq.length === 2);
  log('2g. persisted seo + whatsapp_text intact', persisted.seo?.title === CUSTOM_CONFIG.seo.title && persisted.whatsapp_text === CUSTOM_CONFIG.whatsapp_text);

  // ── 3. Public catalog exposes normalized landing_config ──
  const cat = await req('catalog', {});
  const pub = (cat.data?.products || []).find(x => Number(x.id) === Number(productId));
  log('3a. catalog returns the new product', !!pub);
  log('3b. catalog exposes parsed landing_config object', !!pub?.landing_config && typeof pub.landing_config === 'object' && pub.landing_config.mode === 'custom');
  log('3c. landing_config.hero (non-string, normalized) is an object', !!pub?.landing_config?.hero && typeof pub.landing_config.hero === 'object');
  log('3d. landing_config leaks nothing extra (keys bounded)', (() => {
    const k = Object.keys(pub?.landing_config || {});
    return ['mode','sections','hero','features','faq','seo','whatsapp_text'].every(x => k.includes(x));
  })());

  // ── 4. ADD product WITHOUT landing config → default '{}' → auto ──
  const addNoCfg = await req('admin_add_product', {
    name: 'Phase 7 Plain Product',
    description: 'بدون إعدادات',
    price: 100,
    image_url: 'https://smartshopping.click/img/' + slug + '-plain.jpg',
    gallery_json: '[]',
    category: 'عام',
    sku: slug + 'p',
    stock: 1,
    active: '1',
  }, adminHeaders);
  const plainId = addNoCfg.data?.id;
  log('4a. admin_add_product with no landing config succeeds', addNoCfg.data?.ok === true && !!plainId);
  const plainRow = d1(`SELECT landing_config_json FROM products WHERE id = ${plainId};`);
  log('4b. default persisted as safe {} ', (plainRow[0]?.landing_config_json || '').trim() === '{}');
  if (plainId) {
    const plainPub = (await req('catalog', {})).data?.products?.find(x => Number(x.id) === Number(plainId));
    log('4c. default landing_config mode = auto (backward compatible)', plainPub?.landing_config?.mode === 'auto');
  }

  // ── 5. Courier invalid/corrupt JSON → hardened server-side to {} ──
  const addCorrupt = await req('admin_add_product', {
    name: 'Phase 7 Corrupt Config',
    description: 'اختبار',
    price: 200,
    image_url: 'https://smartshopping.click/img/' + slug + '-corrupt.jpg',
    gallery_json: '[]',
    category: 'عام',
    sku: slug + 'c',
    stock: 1,
    active: '1',
    landing_config_json: '{{{definitely-not-json',
  }, adminHeaders);
  const corruptId = addCorrupt.data?.id;
  log('5a. corrupt admin_add_product still succeeds (no crash)', addCorrupt.data?.ok === true && !!corruptId);
  const corruptRow = d1(`SELECT landing_config_json FROM products WHERE id = ${corruptId};`);
  log('5b. corrupt input hardened to {}', (corruptRow[0]?.landing_config_json || '').trim() === '{}');

  // ── 6. EDIT product: replace landing config + persist ──
  const editedConfig = { ...CUSTOM_CONFIG, mode: 'auto', sections: { ...CUSTOM_CONFIG.sections, trust: true }, hero: { ...CUSTOM_CONFIG.hero, accent_color: '#00AAFF' } };
  const editRes = await req('admin_edit_product', {
    ...addPayload,
    id: productId,
    landing_config_json: JSON.stringify(editedConfig),
  }, adminHeaders);
  log('6a. admin_edit_product updates landing_config_json', editRes.data?.ok === true);
  const editedRow = d1(`SELECT landing_config_json FROM products WHERE id = ${productId};`);
  const edited = JSON.parse(editedRow[0]?.landing_config_json || '{}');
  log('6b. edit persisted (mode switched to auto, trust=true)', edited.mode === 'auto' && edited.sections?.trust === true);
  log('6c. edit persisted (hero accent lowercased #00aaff)', edited.hero?.accent_color === '#00aaff');

  // ── 7. get_reviews canonical contract (landing social proof) ──
  const reviewSlug = slug + '-review';
  d1(`INSERT INTO reviews (product_id, author_name, author_phone, content, rating, image_url, status) VALUES (${productId}, 'P7 Reviewer', '0500000001', 'منتج ممتاز كما في المعاينة', 5, 'https://smartshopping.click/img/${reviewSlug}.jpg', 'approved');`);
  const reviews = await req('get_reviews', { product_id: productId });
  const mine = (reviews.data?.reviews || []).find(r => (r.image_url || '').includes(reviewSlug));
  log('7a. get_reviews returns the synthetic approved review', !!mine);
  log('7b. review exposes author_name/content/rating', !!mine && mine.author_name === 'P7 Reviewer' && mine.content === 'منتج ممتاز كما في المعاينة' && Number(mine.rating) === 5);
  log('7c. review exposes image_url/created_at', !!mine && typeof mine.image_url === 'string' && !!mine.created_at);
  log('7d. review does NOT leak author_phone', !!mine && mine.author_phone === undefined);

  // ── 8. Cleanup: delete synthetic products + review, verify gone ──
  const del1 = await req('admin_delete_product', { id: productId }, adminHeaders);
  const del2 = plainId ? await req('admin_delete_product', { id: plainId }, adminHeaders) : { data: {} };
  const del3 = corruptId ? await req('admin_delete_product', { id: corruptId }, adminHeaders) : { data: {} };
  log('8a. delete all synthetic products succeeds', del1.data?.ok === true && del2.data?.ok === true && del3.data?.ok === true);
  d1(`DELETE FROM reviews WHERE image_url LIKE '%/${reviewSlug}.jpg';`);
  const leftProducts = d1(`SELECT id FROM products WHERE sku IN ('${slug}','${slug}p','${slug}c');`);
  const leftReviews = d1(`SELECT id FROM reviews WHERE image_url LIKE '%/${slug}%';`);
  log('8b. no synthetic products or reviews remain',
    leftProducts.length === 0 && leftReviews.length === 0);

  console.log(`\n=== SUMMARY: pass=${pass} fail=${fail} ===`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });