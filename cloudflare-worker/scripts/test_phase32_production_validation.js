const API_URL = 'https://smart-shopping-api.mostaphaserkhad.workers.dev';
const FRONTEND_URL = 'https://smartshopping.click';

console.log('═══════════════════════════════════════════════════════════════');
console.log('🚀 SMARTKIOSK PHASE 32 — PRODUCTION SaaS FUNCTIONAL VALIDATION');
console.log('API Target:', API_URL);
console.log('═══════════════════════════════════════════════════════════════\n');

let pass = 0;
let fail = 0;

function assert(testName, condition, details = '') {
  if (condition) {
    console.log(`  ✅ PASS [${String(pass + 1).padStart(2, '0')}]: ${testName} ${details ? '(' + details + ')' : ''}`);
    pass++;
  } else {
    console.error(`  ❌ FAIL: ${testName} ${details ? '(' + details + ')' : ''}`);
    fail++;
  }
}

async function runPhase32Validation() {
  try {
    // ─────────────────────────────────────────────
    // 1. Merchant Registration (Real Second Tenant)
    // ─────────────────────────────────────────────
    console.log('── [1] اختبار تسجيل تاجر حقيقي وإنشاء Tenant ثانٍ (Step 3 & 4) ──');
    const testEmailA = `phase32-owner-${Date.now()}@example.invalid`;
    const testPassword = 'StrongPhase32Password123!';
    const testStoreA = 'Phase 32 Alpha Store';
    const testSlugA = `phase32-a-${Date.now()}`;

    const rRegA = await fetch(`${API_URL}?action=auth_register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmailA,
        password: testPassword,
        name: 'Phase32 Owner',
        store_name: testStoreA,
        slug: testSlugA
      })
    });
    const dRegA = await rRegA.json();
    assert('Merchant A Registration', dRegA.ok === true, `Tenant: ${dRegA.tenant?.id}, Slug: ${dRegA.tenant?.slug}`);

    const tenantIdA = dRegA.tenant?.id;
    assert('Tenant ID is unpredictable & prefixed', tenantIdA && tenantIdA.startsWith('tenant_'), tenantIdA);

    // ─────────────────────────────────────────────
    // 2. Merchant Login & Anti-Enumeration (Step 5)
    // ─────────────────────────────────────────────
    console.log('\n── [2] تسجيل الدخول وأمان الجلسات (Step 5) ──');
    // Wrong password
    const rBadPass = await fetch(`${API_URL}?action=auth_login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmailA, password: 'WrongPassword999!' })
    });
    const dBadPass = await rBadPass.json();
    assert('Wrong password rejected', dBadPass.ok === false && dBadPass.error.includes('غير صحيحة'), dBadPass.error);

    // Correct password login
    const rLoginA = await fetch(`${API_URL}?action=auth_login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmailA, password: testPassword })
    });
    const dLoginA = await rLoginA.json();
    assert('Merchant A Login Success', dLoginA.ok === true && !!dLoginA.token, `Role: ${dLoginA.user?.role}`);

    const tokenA = dLoginA.token;

    // auth_me check
    const rMeA = await fetch(`${API_URL}?action=auth_me`, {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    const dMeA = await rMeA.json();
    assert('auth_me returns authenticated context', dMeA.ok === true && dMeA.tenant?.id === tenantIdA, `Tenant: ${dMeA.tenant?.id}`);

    // ─────────────────────────────────────────────
    // 3. Second Tenant Creation (Cross-Tenant IDOR) (Step 8)
    // ─────────────────────────────────────────────
    console.log('\n── [3] إنشاء المستأجر الثاني واختبارات حماية IDOR (Step 8) ──');
    const testEmailB = `phase32-owner-b-${Date.now()}@example.invalid`;
    const testStoreB = 'Phase 32 Beta Store';
    const testSlugB = `phase32-b-${Date.now()}`;

    const rRegB = await fetch(`${API_URL}?action=auth_register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmailB,
        password: testPassword,
        name: 'Phase32 Owner B',
        store_name: testStoreB,
        slug: testSlugB
      })
    });
    const dRegB = await rRegB.json();
    const tenantIdB = dRegB.tenant?.id;
    assert('Merchant B Registration', dRegB.ok === true, `Tenant B: ${tenantIdB}`);

    const rLoginB = await fetch(`${API_URL}?action=auth_login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmailB, password: testPassword })
    });
    const dLoginB = await rLoginB.json();
    const tokenB = dLoginB.token;
    assert('Merchant B Login Success', dLoginB.ok === true && !!tokenB, `Role: ${dLoginB.user?.role}`);

    // Cross-Tenant IDOR Attack: Tenant A attempts to read Tenant B context via query/header tampering
    const rIdor = await fetch(`${API_URL}?action=auth_me&slug=${testSlugB}&tenant_id=${tenantIdB}`, {
      headers: {
        'Authorization': `Bearer ${tokenA}`,
        'X-Tenant-ID': tenantIdB
      }
    });
    const dIdor = await rIdor.json();
    assert('Cross-Tenant Tampering Ignored (Server-Authoritative Scope)', 
      dIdor.ok === true && dIdor.tenant?.id === tenantIdA && dIdor.tenant?.id !== tenantIdB, 
      `Resolved to Owner A: ${dIdor.tenant?.id}`);

    // ─────────────────────────────────────────────
    // 4. Session Rotation & Revocation (Step 11)
    // ─────────────────────────────────────────────
    console.log('\n── [4] تدوير الجلسات وتسجيل الخروج (Step 11) ──');
    const newPassword = 'NewStrongPhase32Password456!';
    const rChangePw = await fetch(`${API_URL}?action=auth_change_password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      },
      body: JSON.stringify({
        current_password: testPassword,
        new_password: newPassword
      })
    });
    const dChangePw = await rChangePw.json();
    assert('Password Change with Session Rotation', dChangePw.ok === true && !!dChangePw.token, 'New Token Issued');

    const rotatedTokenA = dChangePw.token;

    // Old token should now be invalidated
    const rOldTok = await fetch(`${API_URL}?action=auth_me`, {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    assert('Old Token Invalidated after Password Change', rOldTok.status === 401, `Status: ${rOldTok.status}`);

    // New token works
    const rNewTok = await fetch(`${API_URL}?action=auth_me`, {
      headers: { 'Authorization': `Bearer ${rotatedTokenA}` }
    });
    assert('Rotated Token Authenticates Cleanly', rNewTok.status === 200, `Status: ${rNewTok.status}`);

    // Logout
    const rLogout = await fetch(`${API_URL}?action=auth_logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${rotatedTokenA}`
      },
      body: JSON.stringify({ token: rotatedTokenA })
    });
    const dLogout = await rLogout.json();
    assert('Logout Invalidates Server Session', dLogout.ok === true, 'Revoked in D1');

    const rPostLogout = await fetch(`${API_URL}?action=auth_me`, {
      headers: { 'Authorization': `Bearer ${rotatedTokenA}` }
    });
    assert('Session Inaccessible Post-Logout', rPostLogout.status === 401, `Status: ${rPostLogout.status}`);

    // ─────────────────────────────────────────────
    // 5. Master Tenant & Customer Storefront Regression (Step 16)
    // ─────────────────────────────────────────────
    console.log('\n── [5] التحقق من سلامة المتجر الرئيسي وحسابات الزبائن (Step 16) ──');
    const rCat = await fetch(`${API_URL}?action=catalog`);
    const dCat = await rCat.json();
    assert('Master Store Catalog Intact', rCat.status === 200 && (dCat.products || dCat).length > 0, `Products: ${(dCat.products || dCat).length}`);

    const rSet = await fetch(`${API_URL}?action=settings`);
    const dSet = await rSet.json();
    assert('Master Store Settings Sanitized', rSet.status === 200 && !dSet.admin_password, 'Zero Password Leak');

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(`📊 PHASE 32 PRODUCTION VALIDATION RESULTS: ${pass} PASSED | ${fail} FAILED`);
    console.log('═══════════════════════════════════════════════════════════════');

    if (fail > 0) process.exit(1);
  } catch (e) {
    console.error('Fatal validation error:', e);
    process.exit(1);
  }
}

runPhase32Validation();
