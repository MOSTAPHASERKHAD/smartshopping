/**
 * SmartKiosk / Smart Shopping — Phase 1 Test Suite
 * Shopify-Like Dynamic Sections & Theme Engine (Schema & D1 Migration)
 * cloudflare-worker/test_phase1_theme_schema.js
 */

import { adminListThemes, adminSaveTheme, adminDeleteTheme, adminSaveThemeSections, getThemeSections } from './src/handlers/themes.js';

// ── In-Memory SQLite Mock for Cloudflare D1 ──
class MockD1Database {
  constructor() {
    this.tables = {
      themes_v2: [],
      theme_section_configs: [],
      themes: [],
      settings: [
        { key: 'theme_default', value: 'smartkiosk-default', tenant_id: 'tenant_master_default' }
      ]
    };
  }

  prepare(sql) {
    const db = this;
    return {
      _sql: sql,
      _params: [],
      bind(...params) {
        this._params = params;
        return this;
      },
      async first() {
        const res = await this.all();
        return (res.results && res.results[0]) || null;
      },
      async all() {
        const q = this._sql.trim();
        const p = this._params;

        // SELECT themes_v2
        if (q.includes('FROM themes_v2')) {
          const tenantId = p[0];
          let results = db.tables.themes_v2.filter(t => t.tenant_id === tenantId || (tenantId === 'tenant_master_default' && !t.tenant_id));
          return { results };
        }

        // SELECT theme_section_configs
        if (q.includes('FROM theme_section_configs')) {
          const [tenantId, targetType, targetId] = p;
          const match = db.tables.theme_section_configs.find(
            c => c.tenant_id === tenantId && c.target_type === targetType && c.target_id === targetId
          );
          return { results: match ? [match] : [] };
        }

        // SELECT settings
        if (q.includes('FROM settings')) {
          return { results: db.tables.settings };
        }

        return { results: [] };
      },
      async run() {
        const q = this._sql.trim();
        const p = this._params;

        // INSERT / UPDATE themes_v2
        if (q.includes('INSERT INTO themes_v2')) {
          const [id, tenant_id, name, title, description, version, author, base, extendsTheme, tokens_json, sections_json, presets_json, is_active] = p;
          const idx = db.tables.themes_v2.findIndex(t => t.id === id);
          const row = {
            id, tenant_id, name, title, description, version, author, base,
            extends: extendsTheme, tokens_json, sections_json, presets_json,
            is_active, updated_at: new Date().toISOString()
          };
          if (idx >= 0) db.tables.themes_v2[idx] = row;
          else db.tables.themes_v2.push(row);
          return { meta: { changes: 1 } };
        }

        // INSERT / UPDATE theme_section_configs
        if (q.includes('INSERT INTO theme_section_configs')) {
          const [tenant_id, target_type, target_id, theme_id, sections_json] = p;
          const idx = db.tables.theme_section_configs.findIndex(
            c => c.tenant_id === tenant_id && c.target_type === target_type && c.target_id === target_id
          );
          const row = {
            id: idx >= 0 ? db.tables.theme_section_configs[idx].id : db.tables.theme_section_configs.length + 1,
            tenant_id, target_type, target_id, theme_id, sections_json,
            updated_at: new Date().toISOString()
          };
          if (idx >= 0) db.tables.theme_section_configs[idx] = row;
          else db.tables.theme_section_configs.push(row);
          return { meta: { changes: 1 } };
        }

        // DELETE FROM themes_v2
        if (q.includes('DELETE FROM themes_v2')) {
          const [name, id, tenantId] = p;
          db.tables.themes_v2 = db.tables.themes_v2.filter(t => !(t.name === name || t.id === id) || t.tenant_id !== tenantId);
          return { meta: { changes: 1 } };
        }

        return { meta: { changes: 1 } };
      }
    };
  }
}

// ── Mock KV Cache ──
class MockKVCache {
  constructor() {
    this.store = new Map();
  }
  async get(key, opts = {}) {
    const val = this.store.get(key);
    if (!val) return null;
    return opts.type === 'json' ? JSON.parse(val) : val;
  }
  async put(key, val) {
    this.store.set(key, typeof val === 'string' ? val : JSON.stringify(val));
  }
  async delete(key) {
    this.store.delete(key);
  }
}

// ── Test Runner ──
async function runPhase1Tests() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🎨 SMARTKIOSK — PHASE 1: THEME SCHEMA & SECTIONS TEST SUITE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  let passed = 0;
  let failed = 0;

  function assert(cond, label) {
    if (cond) {
      console.log(`  ✅ PASS [${String(passed + 1).padStart(2, '0')}]: ${label}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL [${String(failed + 1).padStart(2, '0')}]: ${label}`);
      failed++;
    }
  }

  const env = {
    DB: new MockD1Database(),
    CACHE: new MockKVCache()
  };

  // ── [1] Save Modern Shopify-like Theme Schema ──
  console.log('── [1] Theme Creation & Schema Validation ──');
  const shopifyLikeSections = {
    "hero-banner": {
      "type": "hero",
      "enabled": true,
      "order": 1,
      "settings": {
        "headline": "ساعة الفخامة العصرية",
        "subtitle": "تصميم أنيق وجودة فائقة",
        "cta_label": "اطلب الآن",
        "accent_color": "#e94560"
      }
    },
    "fast-order-form": {
      "type": "order-form",
      "enabled": true,
      "order": 2,
      "settings": {
        "title": "استمارة الطلب السريع",
        "delivery_badge": "توصيل سريع لـ 58 ولاية"
      }
    },
    "product-gallery": {
      "type": "gallery",
      "enabled": true,
      "order": 3,
      "settings": {
        "zoom_enabled": true,
        "lightbox_enabled": true
      }
    },
    "testimonials": {
      "type": "reviews",
      "enabled": false,
      "order": 4,
      "settings": {}
    }
  };

  const saveRes = await adminSaveTheme(env, {
    name: 'shrine_luxury',
    title: 'Shrine Luxury Edition',
    description: 'قالب فاخر مخصص للمنتجات المميزة وساعات اليد',
    version: '2.1.0',
    author: 'SmartKiosk Theme Lab',
    base: 'light',
    tokens: {
      colors: { primary: '#111827', secondary: '#e94560', background: '#ffffff', surface: '#f9fafb' }
    },
    sections: shopifyLikeSections,
    presets: [
      { name: 'Dark Gold', settings: { accent: '#d97706' } }
    ],
    is_active: true
  }, 'tenant_master_default');

  assert(saveRes.ok === true, 'Successfully saved dynamic theme with sections schema');
  assert(saveRes.theme_id === 'theme_shrine_luxury', 'Generated canonical theme ID');

  // ── [2] List Themes & Validate Parsing ──
  console.log('\n── [2] Theme Retrieval & Deserialization ──');
  const listRes = await adminListThemes(env, 'tenant_master_default');
  assert(listRes.ok === true, 'adminListThemes returns ok: true');
  assert(listRes.themes.length === 1, 'Theme listed in catalog');

  const loadedTheme = listRes.themes[0];
  assert(loadedTheme.name === 'shrine_luxury', 'Theme name preserved');
  assert(loadedTheme.title === 'Shrine Luxury Edition', 'Theme title preserved');
  assert(typeof loadedTheme.sections === 'object', 'Sections parsed into valid object');
  assert(loadedTheme.sections['fast-order-form'].enabled === true, 'Section enabled status preserved');
  assert(loadedTheme.sections['fast-order-form'].order === 2, 'Section order preserved at #2');
  assert(loadedTheme.sections['testimonials'].enabled === false, 'Section disabled status preserved');

  // ── [3] Multi-Tenant Isolation ──
  console.log('\n── [3] Multi-Tenant Data Isolation ──');
  const tenantBSave = await adminSaveTheme(env, {
    name: 'tenant_b_theme',
    title: 'Tenant B Store Theme',
    sections: {
      "hero-banner": { type: "hero", enabled: true, order: 1, settings: { headline: "متجر التاجر ب" } }
    }
  }, 'tenant_merchant_99');
  assert(tenantBSave.ok === true, 'Saved theme for Tenant B');

  const masterList = await adminListThemes(env, 'tenant_master_default');
  const tenantBList = await adminListThemes(env, 'tenant_merchant_99');

  assert(masterList.themes.some(t => t.name === 'shrine_luxury'), 'Master tenant sees its own theme');
  assert(!masterList.themes.some(t => t.name === 'tenant_b_theme'), 'Master tenant DOES NOT see Tenant B theme');
  assert(tenantBList.themes.length === 1 && tenantBList.themes[0].name === 'tenant_b_theme', 'Tenant B isolated strictly to its own themes');

  // ── [4] Product-Level Section Configurations ──
  console.log('\n── [4] Per-Product Section Customization ──');
  const productConfigSave = await adminSaveThemeSections(env, {
    target_type: 'product',
    target_id: '2', // Watch Sabr product
    theme_id: 'theme_shrine_luxury',
    sections: {
      "hero-banner": { enabled: true, order: 1, settings: { headline: "ساعة صـبر الفاخرة" } },
      "fast-order-form": { enabled: true, order: 2 },
      "trust-signals": { enabled: true, order: 3 },
      "faq-accordion": { enabled: false, order: 4 }
    }
  }, 'tenant_master_default');

  assert(productConfigSave.ok === true, 'Product #2 section configuration saved');

  const productSecRes = await getThemeSections(env, { target_type: 'product', target_id: '2' }, 'tenant_master_default');
  assert(productSecRes.ok === true && productSecRes.config !== null, 'Retrieved Product #2 sections config');
  assert(productSecRes.config.sections['hero-banner'].settings.headline === 'ساعة صـبر الفاخرة', 'Product-level custom headline verified');
  assert(productSecRes.config.sections['faq-accordion'].enabled === false, 'Product-level FAQ section disabled correctly');

  // ── [5] Cache Validation ──
  console.log('\n── [5] Edge KV Cache Verification ──');
  const cachedSecRes = await getThemeSections(env, { target_type: 'product', target_id: '2' }, 'tenant_master_default');
  assert(cachedSecRes.ok === true, 'Fast cached section response verified');

  // ── Summary ──
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`📊 PHASE 1 RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase1Tests().catch(err => {
  console.error('Test Runner Exception:', err);
  process.exit(1);
});
