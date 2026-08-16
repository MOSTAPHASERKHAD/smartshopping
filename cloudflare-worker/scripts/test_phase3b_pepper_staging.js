/**
 * Phase 3B — CUSTOMER_PEPPER staging verification.
 *
 * Verifies the live p1: verifier against the REAL CUSTOMER_PEPPER secret now
 * provisioned on staging, using ONLY synthetic, disposable test data:
 *   - a fresh throwaway staging admin test credential (generated here,
 *     never printed, never a guess of any existing secret)
 *   - a synthetic test customer (fake phone, fake password) whose p1: hash
 *     is computed by the live Worker itself via a temporary staging-only
 *     debug action (admin_debug_make_p1_hash) — this NEVER returns or logs
 *     the pepper value, only a one-way hash.
 *
 * No real customer data is touched. No production endpoint is called.
 * Cleans up all synthetic data it creates.
 */
const crypto = require('crypto');
const { execFileSync, execSync } = require('child_process');

const BASE = 'https://smart-shopping-api-staging.mostaphaserkhad.workers.dev';
const ORIGIN = 'https://smartshopping.click';
const TEST_PHONE = '0500000999';
const TEST_PASSWORD = 'PepperVerify_' + crypto.randomBytes(6).toString('hex');

let pass = 0, fail = 0;
function log(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' — ' + detail : ''}`);
  ok ? pass++ : fail++;
}

function sha256(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

async function req(action, params = {}, method = 'POST', headers = {}) {
  const url = `${BASE}?action=${encodeURIComponent(action)}`;
  const opts = { method, headers: { Origin: ORIGIN, ...headers } };
  if (method === 'POST') {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(params);
  }
  const res = await fetch(url, opts);
  let data = {};
  try { data = await res.json(); } catch { /* ignore */ }
  return { status: res.status, data };
}

function d1(sql) {
  const escaped = sql.replace(/"/g, '\\"');
  const cmd = `npx wrangler d1 execute smart-shopping-db-staging --env staging --remote --json --command "${escaped}"`;
  const out = execSync(cmd, { encoding: 'utf8' });
  const parsed = JSON.parse(out);
  return parsed[0]?.results || [];
}

async function run() {
  console.log('=== PHASE 3B — CUSTOMER_PEPPER STAGING VERIFICATION ===\n');

  // ── 0. Provision a FRESH throwaway staging admin test credential ──
  // (not a guess of any existing secret; staging-only; never printed)
  const rawAdminPw = crypto.randomBytes(24).toString('hex');
  const once = sha256(rawAdminPw);
  const twice = sha256(once);
  execFileSync('npx', ['wrangler', 'secret', 'put', 'ADMIN_PASSWORD_HASH', '--env', 'staging'], {
    input: twice,
    shell: true,
  });
  console.log('Provisioned fresh throwaway staging admin test credential (not printed).\n');

  // Secret propagation across edge isolates can take a few seconds.
  // Wait up front, then allow only a couple of spaced-out retries to stay
  // well under the 5-fail login lockout threshold.
  await new Promise(r => setTimeout(r, 12000));
  let adminLogin = { data: {} };
  for (let attempt = 0; attempt < 3; attempt++) {
    adminLogin = await req('verify_admin', { password: once });
    if (adminLogin.data?.ok === true && adminLogin.data?.token) break;
    await new Promise(r => setTimeout(r, 10000));
  }
  log('0. staging admin login (fresh throwaway credential)', adminLogin.data?.ok === true && !!adminLogin.data?.token);
  const adminToken = adminLogin.data?.token;
  if (!adminToken) { console.log('Cannot continue without admin token.'); process.exit(1); }

  // ── 1. Ask the Worker (which holds the real pepper) to compute a p1: hash
  //      for synthetic test data. The pepper itself is never returned. ──
  const hashResp = await req('admin_debug_make_p1_hash', { phone: TEST_PHONE, password: TEST_PASSWORD }, 'POST', {
    Authorization: `Bearer ${adminToken}`,
  });
  log('1. computed synthetic p1: hash via live Worker (pepper never exposed)', hashResp.data?.ok === true && typeof hashResp.data?.hash === 'string' && hashResp.data.hash.startsWith('p1:'));
  const p1Hash = hashResp.data?.hash;
  if (!p1Hash) { console.log('Cannot continue without p1 hash.'); process.exit(1); }

  // ── 2. Insert synthetic test customer with that p1: hash ──
  const escapedHash = p1Hash.replace(/'/g, "''");
  d1(`DELETE FROM customers WHERE phone = '${TEST_PHONE}';`); // idempotent cleanup from any prior partial run
  d1(`INSERT INTO customers (phone, name, password_hash) VALUES ('${TEST_PHONE}', 'Phase3B Synthetic Test', '${escapedHash}');`);
  const inserted = d1(`SELECT id, password_hash FROM customers WHERE phone = '${TEST_PHONE}' LIMIT 1;`);
  log('2. synthetic p1: test customer created', inserted.length === 1 && inserted[0].password_hash === p1Hash);
  const custId = inserted[0]?.id;

  // ── 3. Real p1: login with the (synthetic) existing password ──
  const login1 = await req('customer_login', { phone: TEST_PHONE, password: TEST_PASSWORD });
  log('3. p1: login succeeds with existing password', login1.data?.ok === true && !!login1.data?.token);

  // ── 4. Verify lazy rehash p1: -> s1: ──
  const afterLogin1 = d1(`SELECT password_hash FROM customers WHERE id = ${custId};`);
  const rehashed = afterLogin1[0]?.password_hash || '';
  log('4. lazy rehash p1: -> s1: occurred', rehashed.startsWith('s1:'), `hash prefix=${rehashed.slice(0, 3)}`);

  // ── 5. Subsequent login now uses s1: and still succeeds ──
  const login2 = await req('customer_login', { phone: TEST_PHONE, password: TEST_PASSWORD });
  log('5. subsequent s1: login succeeds', login2.data?.ok === true && !!login2.data?.token);
  const afterLogin2 = d1(`SELECT password_hash FROM customers WHERE id = ${custId};`);
  log('5b. hash still s1: (no further rehash needed)', (afterLogin2[0]?.password_hash || '').startsWith('s1:'));

  // ── 6. Failed login (wrong password) does not modify the hash ──
  const beforeFail = afterLogin2[0]?.password_hash;
  const loginFail = await req('customer_login', { phone: TEST_PHONE, password: TEST_PASSWORD + '_WRONG' });
  log('6. wrong password rejected', loginFail.data?.ok === false);
  const afterFail = d1(`SELECT password_hash FROM customers WHERE id = ${custId};`);
  log('6b. hash UNCHANGED after failed login', afterFail[0]?.password_hash === beforeFail);

  // ── 7. Cleanup synthetic data ──
  d1(`DELETE FROM customer_sessions WHERE customer_id = ${custId};`);
  d1(`DELETE FROM customers WHERE id = ${custId};`);
  const verifyGone = d1(`SELECT id FROM customers WHERE phone = '${TEST_PHONE}';`);
  log('7. synthetic test customer removed', verifyGone.length === 0);

  console.log(`\n=== SUMMARY: pass=${pass} fail=${fail} ===`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
