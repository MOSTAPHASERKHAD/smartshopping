/**
 * Phase 1 — Production Admin Auth Hardening — Post-Deploy Verification
 * Target: https://smart-shopping-api.mostaphaserkhad.workers.dev
 *
 * Verifies fail-closed auth AFTER deploying e87273a + setting ADMIN_PASSWORD_HASH.
 * NOTE: never prints the real hash. Only boolean assertions + safe metadata.
 * TRACK: keeps wrong-password attempts low to avoid tripping the 5-fail lockout.
 */

const BASE_URL = 'https://smart-shopping-api.mostaphaserkhad.workers.dev';
const ALLOWED_ORIGIN = 'https://smartshopping.click';
const DISALLOWED_ORIGIN = 'https://evil-hacker.com';

const results = [];
let pass = 0, fail = 0;

function log(name, passed, detail = '') {
  const status = passed ? 'PASS' : 'FAIL';
  console.log(`${status} | ${name}${detail ? ' — ' + detail : ''}`);
  results.push({ name, passed, detail });
  passed ? pass++ : fail++;
}

async function req(action, params = {}, method = 'GET', headers = {}) {
  const start = Date.now();
  try {
    const url = `${BASE_URL}?action=${encodeURIComponent(action)}`;
    const options = {
      method,
      headers: { Origin: ALLOWED_ORIGIN, ...headers },
    };
    if (method === 'POST') {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(params);
    }
    const res = await fetch(url, options);
    const ms = Date.now() - start;
    let data = {};
    try { data = await res.json(); } catch { /* non-JSON */ }
    return { res, data, ms };
  } catch (e) {
    return { res: null, data: { error: e.message }, ms: Date.now() - start };
  }
}

async function run() {
  console.log(`=== PHASE 1 PRODUCTION AUTH VERIFICATION ===\nTarget: ${BASE_URL}\n`);

  // ── A. Public routes still healthy (no collateral regression) ──
  let r = await req('catalog');
  log('A1 catalog', r.res?.status === 200 && Array.isArray(r.data?.products), `items=${r.data?.products?.length}, status=${r.res?.status}`);

  r = await req('settings');
  const hasSettings = r.data?.store_name !== undefined || r.data?.settings?.store_name !== undefined;
  log('A2 settings', r.res?.status === 200 && hasSettings, `status=${r.res?.status}`);

  r = await req('testimonials');
  log('A3 testimonials', r.res?.status === 200, `status=${r.res?.status}`);

  r = await req('get_reviews', { product_id: '1' });
  log('A4 get_reviews', r.res?.status === 200, `status=${r.res?.status}, reviews=${r.data?.reviews?.length ?? 0}`);

  r = await req('get_pages');
  log('A5 get_pages', r.res?.status === 200, `status=${r.res?.status}, pages=${r.data?.pages?.length ?? 0}`);

  r = await req('validate_coupon', { code: 'FAKECOUPON99' }, 'POST');
  log('A6 validate_coupon(invalid)', r.res?.status === 200 && r.data?.valid === false, `status=${r.res?.status}, valid=${r.data?.valid}`);

  // ── B. verify_admin FAIL-CLOSED (the vuln regression tests) ──
  // Wrong password: must be {ok:false}, MUST NOT be {ok:true, setup_mode:true}
  r = await req('verify_admin', { password: 'BCB2F2C6A76C8F4A249EC9A9E6E1D4F0A1B2C3D4E5F60718293A4B5C6D7E8F90' }, 'POST', { 'X-Should-Not': 'assert' });
  const leakedSetup = JSON.stringify(r.data).includes('setup_mode');
  log('B1 verify_admin wrong pw', r.res?.status === 200 && r.data?.ok === false && !r.data?.token, `ok=${r.data?.ok}`);
  log('B2 no setup_mode leak', !leakedSetup, leakedSetup ? 'setup_mode PRESENT in response' : 'absent');

  // Empty password → rejected
  r = await req('verify_admin', { password: '' }, 'POST');
  log('B3 verify_admin empty pw', r.data?.ok === false, `ok=${r.data?.ok}`);

  // Missing param → rejected
  r = await req('verify_admin', {}, 'POST');
  log('B4 verify_admin no param', r.data?.ok === false, `ok=${r.data?.ok}`);

  // ── C. adminGate: no token / forged token → 401 ──
  r = await req('admin_update_settings', { store_name: 'hack' }, 'POST');
  log('C1 admin_update_settings no token', r.res?.status === 401, `status=${r.res?.status}`);

  r = await req('admin_list', {}, 'GET', { Authorization: 'Bearer FORGEDTOKEN123456789012345678901234' });
  log('C2 admin_list forged token', r.res?.status === 401, `status=${r.res?.status}`);

  r = await req('admin_orders', {}, 'POST', { 'X-Admin-Token': 'SHORT' });
  log('C3 admin_orders short token', r.res?.status === 401, `status=${r.res?.status}`);

  // ── D. admin_logout is admin_-prefixed → gate enforces auth (fail-closed)
  r = await req('admin_logout', {}, 'POST');
  log('D1 admin_logout no token', r.res?.status === 401, `status=${r.res?.status}`);

  // ── E. Immutable settings keys do not appear in public settings
  r = await req('settings');
  const pub = r.data?.settings ?? r.data ?? {};
  const hasAdminHash = JSON.stringify(pub).includes('admin_password_hash');
  log('E1 settings no admin_password_hash leak', !hasAdminHash, hasAdminHash ? 'hash key present' : 'absent');

  // ── F. CORS ──
  r = await req('catalog', {}, 'GET', { Origin: ALLOWED_ORIGIN });
  const acao = r.res?.headers?.get('access-control-allow-origin');
  log('F1 CORS allowed origin', !!acao && acao === ALLOWED_ORIGIN, `acao=${acao}`);

  r = await req('catalog', {}, 'GET', { Origin: DISALLOWED_ORIGIN });
  const acaoBad = r.res?.headers?.get('access-control-allow-origin');
  log('F2 CORS disallowed blocked', !!acaoBad !== (acaoBad === DISALLOWED_ORIGIN), `acao=${acaoBad || 'none'}`);

  // ── G. OPTIONS preflight
  const preflight = await fetch(`${BASE_URL}?action=catalog`, {
    method: 'OPTIONS',
    headers: { Origin: ALLOWED_ORIGIN, 'Access-Control-Request-Method': 'GET' },
  });
  log('G1 OPTIONS preflight', preflight.status === 204 || preflight.status === 200, `status=${preflight.status}`);

  // ── H. Unknown action → safe UNKNOWN_ACTION, not 500
  r = await req('no_such_action_plz');
  log('H1 unknown action', r.res?.status === 200 && r.data?.ok === false, `status=${r.res?.status}, code=${r.data?.error?.code}`);

  // ── I. JSON content type enforcement
  r = await req('catalog');
  const ct = r.res?.headers?.get('content-type');
  log('I1 json content-type', ct?.includes('application/json'), `ct=${ct}`);

  // ── J. admin_settings (protected) requires token
  r = await req('admin_settings', {}, 'GET');
  log('J1 admin_settings no token', r.res?.status === 401, `status=${r.res?.status}`);

  // Summary
  console.log(`\n=== SUMMARY: total=${results.length} pass=${pass} fail=${fail} ===`);

  require('fs').writeFileSync(
    'scripts/phase1_prod_verify.json',
    JSON.stringify({
      target: BASE_URL,
      timestamp: new Date().toISOString(),
      summary: { total: results.length, pass, fail },
      results,
    }, null, 2),
  );
  console.log('Report written to scripts/phase1_prod_verify.json');
  process.exit(fail === 0 ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });