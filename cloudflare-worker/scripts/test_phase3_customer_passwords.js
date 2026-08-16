/**
 * Phase 3 — Customer Password Migration — Unit Tests (verifier + hashing)
 *
 * Run: node scripts/test_phase3_customer_passwords.js
 *
 * Never prints real secret values. TEST pepper below is a NON-SECRET fixture
 * used only to exercise the legacy p1: code path. It is NOT CUSTOMER_PEPPER.
 */
import {
  sha256, timingSafeEqualHex, timingSafeEqualStr,
  generateSaltHex, hashCustomerPasswordS1,
  verifyCustomerPassword, CUSTOMER_PW_S1, CUSTOMER_PW_P1,
} from '../src/utils/auth.js';

const TEST_PEPPER = 'phase3-unit-test-pepper-only'; // fixture, NOT the real secret

let pass = 0, fail = 0;
function log(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' — ' + detail : ''}`);
  ok ? pass++ : fail++;
}

// ── Helpers to build hashes for each legacy scheme (test-only) ──
const g_sha = (s) => sha256(s);

// ── Tests ──
async function run() {
  console.log('── Phase 3 customer password verifier (unit) ──');

  // 1. s1 valid password
  {
    const h = await hashCustomerPasswordS1('secret123');
    const r = await verifyCustomerPassword('secret123', '0550000000', h);
    log('s1 valid password', r.ok === true && r.scheme === 's1' && r.needsUpgrade === false, `scheme=${r.scheme}`);
  }

  // 2. s1 wrong password
  {
    const h = await hashCustomerPasswordS1('secret123');
    const r = await verifyCustomerPassword('wrongpass', '0550000000', h);
    log('s1 wrong password', r.ok === false, `scheme=${r.scheme}`);
  }

  // 3. wrong salt
  {
    const h = await hashCustomerPasswordS1('secret123', generateSaltHex());
    const other = await hashCustomerPasswordS1('secret123'); // different random salt
    const [, saltOther] = other.split(':');
    const rebuilt = `${CUSTOMER_PW_S1}${saltOther}:${h.split(':')[2]}`;
    const r = await verifyCustomerPassword('secret123', '0550000000', rebuilt);
    log('wrong salt rejected', r.ok === false, `scheme=${r.scheme}`);
  }

  // 4. malformed hash (bad prefix structure)
  {
    const r1 = await verifyCustomerPassword('secret123', '0550000000', 's1:abc:nothex');
    const r2 = await verifyCustomerPassword('secret123', '0550000000', 'p1:onlyone');
    const r3 = await verifyCustomerPassword('secret123', '0550000000', 'garbage!!!');
    log('malformed hash rejected', r1.ok === false && r2.ok === false && r3.ok === false,
      `s1=${r1.ok} p1=${r2.ok} garbage=${r3.ok}`);
  }

  // 5. legacy p1 valid (with TEST pepper) → ok + needsUpgrade
  {
    const stored = `${CUSTOMER_PW_P1}${await g_sha('legacyPass' + ':' + '0551111111' + ':' + TEST_PEPPER)}`;
    const r = await verifyCustomerPassword('legacyPass', '0551111111', stored, { CUSTOMER_PEPPER: TEST_PEPPER });
    log('legacy p1 valid password', r.ok === true && r.scheme === 'p1' && r.needsUpgrade === true, `scheme=${r.scheme}`);
  }

  // 6. legacy p1 wrong password
  {
    const stored = `${CUSTOMER_PW_P1}${await g_sha('legacyPass' + ':' + '0551111111' + ':' + TEST_PEPPER)}`;
    const r = await verifyCustomerPassword('wrongPass', '0551111111', stored, { CUSTOMER_PEPPER: TEST_PEPPER });
    log('legacy p1 wrong password', r.ok === false, `scheme=${r.scheme}`);
  }

  // 6b. legacy p1 WITHOUT pepper → blocked, fail-closed, never guessed
  {
    const stored = `${CUSTOMER_PW_P1}${await g_sha('legacyPass' + ':' + '0551111111' + ':' + TEST_PEPPER)}`;
    const r = await verifyCustomerPassword('legacyPass', '0551111111', stored, {});
    log('legacy p1 without pepper → blocked (no guess)', r.ok === false && r.blocked === true, `blocked=${r.blocked}`);
  }

  // 7. bare sha256: GAS legacy sha256(pass:phone)
  {
    const stored = await g_sha('plainPass' + ':' + '0552222222');
    const r = await verifyCustomerPassword('plainPass', '0552222222', stored);
    log('sha256 GAS legacy (pass:phone) valid', r.ok === true && r.scheme === 'sha256' && r.needsUpgrade === true, `scheme=${r.scheme}`);
  }

  // 7b. bare sha256: old Worker sha256(pass)
  {
    const stored = await g_sha('plainPass');
    const r = await verifyCustomerPassword('plainPass', '0552222222', stored);
    log('sha256 old-Worker (pass) valid', r.ok === true && r.scheme === 'sha256' && r.needsUpgrade === true, `scheme=${r.scheme}`);
  }

  // 7c. bare sha256 wrong password
  {
    const stored = await g_sha('plainPass' + ':' + '0552222222');
    const r = await verifyCustomerPassword('wrongPass', '0552222222', stored);
    log('sha256 wrong password', r.ok === false, `scheme=${r.scheme}`);
  }

  // 8. numeric legacy (4-digit PIN stored directly)
  {
    const r = await verifyCustomerPassword('1234', '0553333333', '1234');
    log('numeric legacy valid PIN', r.ok === true && r.scheme === 'numeric' && r.needsUpgrade === true, `scheme=${r.scheme}`);
    const rw = await verifyCustomerPassword('9999', '0553333333', '1234');
    log('numeric legacy wrong PIN', rw.ok === false, `scheme=${rw.scheme}`);
  }

  // 9. empty password
  {
    const h = await hashCustomerPasswordS1('secret123');
    const r = await verifyCustomerPassword('', '0550000000', h);
    const rn = await verifyCustomerPassword(null, '0550000000', h);
    log('empty/null password rejected', r.ok === false && rn.ok === false);
  }

  // 10. malformed/null password_hash
  {
    const r1 = await verifyCustomerPassword('secret123', '0550000000', null);
    const r2 = await verifyCustomerPassword('secret123', '0550000000', '');
    log('null/empty stored hash rejected', r1.ok === false && r2.ok === false);
  }

  // 11. timing-safe helpers sanity
  {
    const a = '0123456789abcdef0123456789abcdef';
    const b = '0123456789abcdef0123456789abcde0';
    log('timingSafeEqualHex true/false', timingSafeEqualHex(a, a) === true && timingSafeEqualHex(a, b) === false && timingSafeEqualHex(a, 'abc') === false);
    log('timingSafeEqualStr true/false', timingSafeEqualStr('hello', 'hello') === true && timingSafeEqualStr('hello', 'hellp') === false);
  }

  // 12. lazy rehash target: hashCustomerPasswordS1 always yields s1:salt:hash
  {
    const h = await hashCustomerPasswordS1('somePassword');
    const parts = h.split(':');
    log('s1 format correct', parts.length === 3 && parts[0] === 's1' && parts[1].length === 32 && parts[2].length === 64, `len=${h.length}`);
    const r = await verifyCustomerPassword('somePassword', '0554444444', h);
    log('s1 hash round-trips', r.ok === true && r.needsUpgrade === false);
  }

  console.log(`\nRESULT: ${pass} PASS, ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch(e => { console.error('FATAL', e); process.exit(1); });
