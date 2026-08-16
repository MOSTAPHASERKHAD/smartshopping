/**
 * ═══════════════════════════════════════════════════════════════════
 * SMARTKIOSK PHASE 37 — MULTI-STORE STOREFRONT & DYNAMIC ROUTING SUITE
 * ═══════════════════════════════════════════════════════════════════
 */

import worker from './src/index.js';
import { DEFAULT_MASTER_TENANT_ID, normalizeHostname, RESERVED_SLUGS } from './src/utils/auth.js';

// In-Memory SQLite Mock for Multi-Tenant Harness
function createMockDB() {
  const tenants = [
    {
      id: DEFAULT_MASTER_TENANT_ID,
      name: 'Smart Shopping Master',
      slug: 'main',
      domain: 'smartshopping.click',
      status: 'active',
      plan: 'master'
    },
    {
      id: 'tenant_alpha_123',
      name: 'Alpha Fashion Store',
      slug: 'store-a',
      domain: null,
      status: 'active',
      plan: 'starter'
    },
    {
      id: 'tenant_beta_456',
      name: 'Beta Electronics',
      slug: 'store-b',
      domain: 'brand-custom.dz',
      status: 'active',
      plan: 'pro'
    },
    {
      id: 'tenant_suspended_789',
      name: 'Suspended Boutique',
      slug: 'suspended-store',
      domain: 'suspended.dz',
      status: 'suspended',
      plan: 'starter'
    }
  ];

  const products = [
    {
      id: 1,
      tenant_id: DEFAULT_MASTER_TENANT_ID,
      name: 'Master Product 1',
      price: 1500,
      active: 1,
      sort_order: 0,
      created_at: '2026-01-01T00:00:00Z',
      landing_config_json: '{}'
    },
    {
      id: 101,
      tenant_id: 'tenant_alpha_123',
      name: 'Alpha Designer Dress',
      price: 4500,
      active: 1,
      sort_order: 0,
      created_at: '2026-01-02T00:00:00Z',
      landing_config_json: '{}'
    },
    {
      id: 201,
      tenant_id: 'tenant_beta_456',
      name: 'Beta Wireless Earbuds',
      price: 8900,
      active: 1,
      sort_order: 0,
      created_at: '2026-01-03T00:00:00Z',
      landing_config_json: '{}'
    }
  ];

  const settings = [
    { tenant_id: DEFAULT_MASTER_TENANT_ID, key: 'store_name', value: 'Smart Shopping Master' },
    { tenant_id: DEFAULT_MASTER_TENANT_ID, key: 'store_phone', value: '0555000000' },
    { tenant_id: 'tenant_alpha_123', key: 'store_name', value: 'Alpha Fashion Store' },
    { tenant_id: 'tenant_alpha_123', key: 'store_phone', value: '0555111111' },
    { tenant_id: 'tenant_alpha_123', key: 'primary_color', value: '#e11d48' },
    { tenant_id: 'tenant_beta_456', key: 'store_name', value: 'Beta Electronics' },
    { tenant_id: 'tenant_beta_456', key: 'store_phone', value: '0555222222' }
  ];

  const sessions = [];
  const auditLogs = [];

  return {
    prepare(sql) {
      let bound = [];
      const normalizedSql = sql.trim().replace(/\s+/g, ' ');

      return {
        bind(...args) {
          bound = args;
          return this;
        },
        async first() {
          const res = await this.all();
          return res.results && res.results.length ? res.results[0] : null;
        },
        async all() {
          // Tenants by slug
          if (normalizedSql.includes('SELECT id, status FROM tenants WHERE slug = ?')) {
            const slugParam = (bound[0] || '').toLowerCase();
            const found = tenants.find(t => t.slug.toLowerCase() === slugParam);
            return { results: found ? [{ id: found.id, status: found.status }] : [] };
          }
          // Tenants by domain
          if (normalizedSql.includes('SELECT id, status FROM tenants WHERE domain = ?')) {
            const domainParam = (bound[0] || '').toLowerCase();
            const found = tenants.find(t => (t.domain || '').toLowerCase() === domainParam);
            return { results: found ? [{ id: found.id, status: found.status }] : [] };
          }
          // Tenants by id
          if (normalizedSql.includes('SELECT id, name, slug, domain, status FROM tenants WHERE id = ?')) {
            const found = tenants.find(t => t.id === bound[0]);
            return { results: found ? [found] : [] };
          }
          // Products
          if (normalizedSql.includes('FROM products')) {
            const targetTenant = bound[0];
            const isMaster = targetTenant === DEFAULT_MASTER_TENANT_ID;
            let filtered = products.filter(p => {
              if (!p.active) return false;
              if (isMaster) {
                return p.tenant_id === DEFAULT_MASTER_TENANT_ID || !p.tenant_id;
              }
              return p.tenant_id === targetTenant;
            });
            return { results: filtered };
          }
          // Settings
          if (normalizedSql.includes('FROM settings')) {
            const targetTenant = bound[0];
            const isMaster = targetTenant === DEFAULT_MASTER_TENANT_ID;
            let filtered = settings.filter(s => {
              if (isMaster) {
                return s.tenant_id === DEFAULT_MASTER_TENANT_ID || !s.tenant_id;
              }
              return s.tenant_id === targetTenant;
            });
            return { results: filtered };
          }
          // Themes
          if (normalizedSql.includes('FROM themes')) {
            return { results: [] };
          }
          // Sessions check
          if (normalizedSql.includes('FROM sessions')) {
            const hash = bound[0];
            const s = sessions.find(x => x.token_hash === hash && !x.revoked_at);
            return { results: s ? [s] : [] };
          }
          return { results: [] };
        },
        async run() {
          if (normalizedSql.includes('INSERT INTO audit_logs')) {
            auditLogs.push(bound);
            return { success: true };
          }
          return { success: true };
        }
      };
    }
  };
}

function createMockKV() {
  const store = new Map();
  return {
    async get(key, opts) {
      const val = store.get(key);
      if (!val) return null;
      if (opts && opts.type === 'json') {
        try { return JSON.parse(val); } catch (e) { return null; }
      }
      return val;
    },
    async put(key, val, opts) {
      store.set(key, typeof val === 'string' ? val : JSON.stringify(val));
    },
    async delete(key) {
      store.delete(key);
    },
    _raw: store
  };
}

async function runPhase37Tests() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🏛️ SMARTKIOSK PHASE 37 — STOREFRONT & ROUTING TEST HARNESS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  const db = createMockDB();
  const kv = createMockKV();
  const env = {
    DB: db,
    CACHE: kv,
    ALLOWED_ORIGINS: 'https://smartshopping.click,https://store-a.smartshopping.click'
  };

  const ctx = { waitUntil(p) {} };

  // ── 1. Host Normalization ──
  console.log('── [1] اختبارات تطبيع أسماء النطاقات (Host Normalization) ──');
  assert(normalizeHostname('Demo.smartshopping.click') === 'demo.smartshopping.click', 'Normalizes uppercase');
  assert(normalizeHostname('store-a.smartshopping.click.') === 'store-a.smartshopping.click', 'Strips trailing dot');
  assert(normalizeHostname('store-a.smartshopping.click:8787') === 'store-a.smartshopping.click', 'Strips port number');
  assert(normalizeHostname('   STORE-A.smartshopping.click:443.   ') === 'store-a.smartshopping.click', 'Handles complex unnormalized string');

  // ── 2. Master Domain Routing ──
  console.log('\n── [2] توجيه المتجر الرئيسي (Master Domain Invariants) ──');
  {
    const req = new Request('https://smartshopping.click/?action=catalog', {
      headers: { 'Host': 'smartshopping.click' }
    });
    const res = await worker.fetch(req, env, ctx);
    const data = await res.json();
    assert(res.status === 200, 'Master domain returns 200');
    assert(data.products && data.products.length === 1 && data.products[0].name === 'Master Product 1', 'Master domain serves master catalog');
  }

  {
    const req = new Request('https://www.smartshopping.click/?action=catalog', {
      headers: { 'Host': 'www.smartshopping.click' }
    });
    const res = await worker.fetch(req, env, ctx);
    const data = await res.json();
    assert(res.status === 200, 'www.smartshopping.click returns 200');
    assert(data.products[0].name === 'Master Product 1', 'www.smartshopping.click serves master catalog');
  }

  {
    const req = new Request('https://smartshopping-76x.pages.dev/?action=catalog', {
      headers: { 'Host': 'smartshopping-76x.pages.dev' }
    });
    const res = await worker.fetch(req, env, ctx);
    const data = await res.json();
    assert(res.status === 200, 'Pages preview domain returns 200');
    assert(data.products[0].name === 'Master Product 1', 'Pages preview domain serves master catalog');
  }

  // ── 3. Subdomain Routing & Isolation ──
  console.log('\n── [3] توجيه وعزل النطاقات الفرعية (Subdomain Routing & Data Isolation) ──');
  {
    const req = new Request('https://store-a.smartshopping.click/?action=catalog', {
      headers: { 'Host': 'store-a.smartshopping.click' }
    });
    const res = await worker.fetch(req, env, ctx);
    const data = await res.json();
    assert(res.status === 200, 'Subdomain store-a returns 200');
    assert(data.products.length === 1 && data.products[0].name === 'Alpha Designer Dress', 'Subdomain store-a serves Tenant Alpha catalog exclusively');
    assert(res.headers.get('Vary') && res.headers.get('Vary').includes('Host'), 'Response includes Vary: Host header for CDN cache isolation');
  }

  {
    // KV Cache check
    const cachedEntry = await kv.get('tenant:host:store-a.smartshopping.click', { type: 'json' });
    assert(cachedEntry && cachedEntry.tenantId === 'tenant_alpha_123', 'Tenant Alpha host mapping cached properly in KV');
  }

  {
    // Case Insensitive Subdomain
    const req = new Request('https://STORE-A.smartshopping.click/?action=catalog', {
      headers: { 'Host': 'STORE-A.smartshopping.click' }
    });
    const res = await worker.fetch(req, env, ctx);
    const data = await res.json();
    assert(res.status === 200 && data.products[0].name === 'Alpha Designer Dress', 'Case-insensitive host matches Tenant Alpha');
  }

  // ── 4. Custom Domain Routing ──
  console.log('\n── [4] توجيه النطاقات المخصصة (Custom Domain Routing) ──');
  {
    const req = new Request('https://brand-custom.dz/?action=catalog', {
      headers: { 'Host': 'brand-custom.dz' }
    });
    const res = await worker.fetch(req, env, ctx);
    const data = await res.json();
    assert(res.status === 200, 'Custom domain returns 200');
    assert(data.products.length === 1 && data.products[0].name === 'Beta Wireless Earbuds', 'Custom domain serves Tenant Beta catalog');
  }

  // ── 5. Reserved Slugs Protection ──
  console.log('\n── [5] حماية النطاقات المحجوزة للمنصة (Reserved Slugs) ──');
  {
    const reqAdmin = new Request('https://admin.smartshopping.click/?action=catalog', {
      headers: { 'Host': 'admin.smartshopping.click' }
    });
    const resAdmin = await worker.fetch(reqAdmin, env, ctx);
    const dataAdmin = await resAdmin.json();
    assert(resAdmin.status === 200 && dataAdmin.products[0].name === 'Master Product 1', 'admin.smartshopping.click safely falls back to Master');

    const reqApi = new Request('https://api.smartshopping.click/?action=catalog', {
      headers: { 'Host': 'api.smartshopping.click' }
    });
    const resApi = await worker.fetch(reqApi, env, ctx);
    const dataApi = await resApi.json();
    assert(resApi.status === 200 && dataApi.products[0].name === 'Master Product 1', 'api.smartshopping.click safely falls back to Master');
  }

  // ── 6. Unknown Subdomain / Custom Domain ──
  console.log('\n── [6] النطاقات غير المسجلة (Unknown Subdomain & Custom Domain) ──');
  {
    const reqUnknown = new Request('https://nonexistent-store.smartshopping.click/?action=catalog', {
      headers: { 'Host': 'nonexistent-store.smartshopping.click' }
    });
    const resUnknown = await worker.fetch(reqUnknown, env, ctx);
    const dataUnknown = await resUnknown.json();
    assert(resUnknown.status === 404, 'Unknown subdomain returns 404');
    assert(dataUnknown.error && dataUnknown.error.code === 'STORE_NOT_FOUND', 'Returns STORE_NOT_FOUND code without leaking master data');

    const reqCustomUnknown = new Request('https://randombrand.dz/?action=catalog', {
      headers: { 'Host': 'randombrand.dz' }
    });
    const resCustomUnknown = await worker.fetch(reqCustomUnknown, env, ctx);
    assert(resCustomUnknown.status === 404, 'Unknown custom domain returns 404');
  }

  // ── 7. Suspended Tenant Handling ──
  console.log('\n── [7] المتاجر الموقوفة (Suspended Tenant Defense) ──');
  {
    const reqSuspended = new Request('https://suspended-store.smartshopping.click/?action=catalog', {
      headers: { 'Host': 'suspended-store.smartshopping.click' }
    });
    const resSuspended = await worker.fetch(reqSuspended, env, ctx);
    const dataSuspended = await resSuspended.json();
    assert(resSuspended.status === 403, 'Suspended tenant returns 403 Forbidden');
    assert(dataSuspended.error && dataSuspended.error.code === 'STORE_SUSPENDED', 'Returns STORE_SUSPENDED code');
  }

  // ── 8. Anti-Spoofing & Header Injection Defense ──
  console.log('\n── [8] الحماية من التلاعب بالترويسات وهجمات IDOR (Anti-Spoofing & IDOR) ──');
  {
    // Header Spoofing Attempt: Host=A but X-Forwarded-Host=B
    const reqSpoofHeader = new Request('https://store-a.smartshopping.click/?action=catalog', {
      headers: {
        'Host': 'store-a.smartshopping.click',
        'X-Forwarded-Host': 'brand-custom.dz'
      }
    });
    const resSpoofHeader = await worker.fetch(reqSpoofHeader, env, ctx);
    const dataSpoofHeader = await resSpoofHeader.json();
    assert(dataSpoofHeader.products[0].name === 'Alpha Designer Dress', 'Ignores spoofed X-Forwarded-Host header');
  }

  {
    // Query Parameter Tenant ID Spoofing Attempt: Host=A but ?tenant_id=tenant_beta
    const reqSpoofQuery = new Request('https://store-a.smartshopping.click/?action=catalog&tenant_id=tenant_beta_456', {
      headers: { 'Host': 'store-a.smartshopping.click' }
    });
    const resSpoofQuery = await worker.fetch(reqSpoofQuery, env, ctx);
    const dataSpoofQuery = await resSpoofQuery.json();
    assert(dataSpoofQuery.products[0].name === 'Alpha Designer Dress', 'Ignores unauthenticated client ?tenant_id query parameter');
  }

  // ── 9. Path / Query Fallback ──
  console.log('\n── [9] المسارات البديلة (Path / Query Fallback on Master Host) ──');
  {
    const reqFallback = new Request('https://smartshopping.click/?action=catalog&store=store-a', {
      headers: { 'Host': 'smartshopping.click' }
    });
    const resFallback = await worker.fetch(reqFallback, env, ctx);
    const dataFallback = await resFallback.json();
    assert(resFallback.status === 200, 'Path fallback returns 200');
    assert(dataFallback.products[0].name === 'Alpha Designer Dress', 'Path fallback serves Tenant Alpha catalog');
  }

  // ── 10. Store Context Endpoint ──
  console.log('\n── [10] نقطة النهاية لسياق المتجر العام (Store Context Endpoint) ──');
  {
    const reqContext = new Request('https://store-a.smartshopping.click/?action=store_context', {
      headers: { 'Host': 'store-a.smartshopping.click' }
    });
    const resContext = await worker.fetch(reqContext, env, ctx);
    const dataContext = await resContext.json();
    assert(resContext.status === 200, 'Store context returns 200');
    assert(dataContext.ok === true && dataContext.store, 'Returns ok: true and store object');
    assert(dataContext.store.slug === 'store-a', 'Returns correct store slug');
    assert(dataContext.store.canonical_url === 'https://store-a.smartshopping.click', 'Returns correct canonical URL');
    assert(dataContext.store.branding.primary_color === '#e11d48', 'Returns store primary color');
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`📊 PHASE 37 TEST RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase37Tests().catch(err => {
  console.error('Fatal Test Error:', err);
  process.exit(1);
});
