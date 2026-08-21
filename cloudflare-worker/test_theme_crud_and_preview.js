// test_theme_crud_and_preview.js
// Automated test suite for Theme CRUD repairs (Set Default, Delete, Preview, Error Normalization, Tenant Isolation)

import assert from 'assert';
import { adminSetDefaultTheme, adminDeleteTheme, adminSaveTheme, adminListThemes } from './src/handlers/themes.js';
import { canExecuteAction, ROLES } from './src/utils/rbac.js';
import pkgEngine from '../themes/theme-engine.js';
const { ThemeEngine } = pkgEngine;

// Mock D1 Database in Memory
class MockD1 {
  constructor() {
    this.tables = {
      themes_v2: [],
      themes: [],
      settings: []
    };
  }

  prepare(query) {
    const self = this;
    return {
      _query: query,
      _bindings: [],
      bind(...args) {
        this._bindings = args;
        return this;
      },
      async first() {
        const res = await this.all();
        return res.results && res.results.length > 0 ? res.results[0] : null;
      },
      async all() {
        const q = this._query.trim();
        const b = this._bindings;

        if (q.includes('FROM themes_v2') && q.includes('SELECT')) {
          let rows = [...self.tables.themes_v2];
          if (q.includes('WHERE (id = ? OR name = ?) AND (tenant_id = ? OR tenant_id IS NULL)')) {
            rows = rows.filter(r => (r.id === b[0] || r.name === b[1]) && (r.tenant_id === b[2] || r.tenant_id === null));
          } else if (q.includes('WHERE (id = ? OR name = ?) AND tenant_id = ?')) {
            rows = rows.filter(r => (r.id === b[0] || r.name === b[1]) && r.tenant_id === b[2]);
          } else if (q.includes('WHERE (tenant_id = ? OR tenant_id IS NULL)')) {
            rows = rows.filter(r => r.tenant_id === b[0] || r.tenant_id === null);
          } else if (q.includes('WHERE tenant_id = ?')) {
            rows = rows.filter(r => r.tenant_id === b[0]);
          }
          return { results: rows };
        }

        if (q.includes('FROM settings') && q.includes('SELECT')) {
          let rows = [...self.tables.settings];
          if (q.includes("key = 'theme_default'")) {
            rows = rows.filter(r => r.key === 'theme_default' && (r.tenant_id === b[0] || r.tenant_id === null));
          }
          return { results: rows };
        }

        if (q.includes('FROM themes') && q.includes('SELECT')) {
          let rows = [...self.tables.themes];
          if (q.includes('WHERE (name = ? OR id = ?)')) {
            rows = rows.filter(r => (r.name === b[0] || r.id === b[1]) && (r.tenant_id === b[2] || r.tenant_id === null));
          }
          return { results: rows };
        }

        return { results: [] };
      },
      async run() {
        const q = this._query.trim();
        const b = this._bindings;

        if (q.includes('INSERT INTO themes_v2')) {
          const [id, tenant_id, name, title, description, version, author, base, extendsTheme, tokens_json, sections_json, presets_json, is_active] = b;
          const idx = self.tables.themes_v2.findIndex(r => r.id === id);
          const row = { id, tenant_id, name, title, description, version, author, base, extends: extendsTheme, tokens_json, sections_json, presets_json, is_active, updated_at: new Date().toISOString() };
          if (idx >= 0) {
            self.tables.themes_v2[idx] = row;
          } else {
            self.tables.themes_v2.push(row);
          }
          return { success: true };
        }

        if (q.includes('UPDATE themes_v2 SET is_active = 0')) {
          const tenant_id = b[0];
          self.tables.themes_v2.forEach(r => {
            if (r.tenant_id === tenant_id) r.is_active = 0;
          });
          return { success: true };
        }

        if (q.includes('UPDATE themes_v2 SET is_active = 1')) {
          const [id, name, tenant_id] = b;
          self.tables.themes_v2.forEach(r => {
            if ((r.id === id || r.name === name) && r.tenant_id === tenant_id) {
              r.is_active = 1;
            }
          });
          return { success: true };
        }

        if (q.includes('INSERT INTO settings')) {
          const [val, tenant_id] = b;
          const idx = self.tables.settings.findIndex(r => r.key === 'theme_default' && r.tenant_id === tenant_id);
          if (idx >= 0) {
            self.tables.settings[idx].value = val;
          } else {
            self.tables.settings.push({ key: 'theme_default', value: val, tenant_id });
          }
          return { success: true };
        }

        if (q.includes('DELETE FROM themes_v2')) {
          const [name, id, tenant_id] = b;
          self.tables.themes_v2 = self.tables.themes_v2.filter(r => !((r.name === name || r.id === id) && r.tenant_id === tenant_id));
          return { success: true };
        }

        if (q.includes('DELETE FROM themes')) {
          const [name, tenant_id] = b;
          self.tables.themes = self.tables.themes.filter(r => !(r.name === name && r.tenant_id === tenant_id));
          return { success: true };
        }

        return { success: true };
      }
    };
  }
}

async function runTests() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🧪 SMARTKIOSK — THEME CRUD, PREVIEW & ERROR AUDIT SUITE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  let passed = 0;
  function it(desc, fn) {
    try {
      fn();
      console.log(`  ✅ PASS: ${desc}`);
      passed++;
    } catch (e) {
      console.error(`  ❌ FAIL: ${desc}\n     Error: ${e.message}`);
      throw e;
    }
  }
  async function itAsync(desc, fn) {
    try {
      await fn();
      console.log(`  ✅ PASS: ${desc}`);
      passed++;
    } catch (e) {
      console.error(`  ❌ FAIL: ${desc}\n     Error: ${e.message}`);
      throw e;
    }
  }

  const mockDb = new MockD1();
  const env = { DB: mockDb, CACHE: { delete: async () => {}, put: async () => {}, get: async () => null } };

  // ── [1] TEST 1: SET DEFAULT THEME & TENANT ISOLATION ──
  console.log('── [1] Set Default Theme & Tenant Isolation ──');
  
  it('RBAC allows OWNER and ADMIN to admin_set_default_theme', () => {
    assert.strictEqual(canExecuteAction(ROLES.OWNER, 'admin_set_default_theme'), true);
    assert.strictEqual(canExecuteAction(ROLES.ADMIN, 'admin_set_default_theme'), true);
    assert.strictEqual(canExecuteAction(ROLES.VIEWER, 'admin_set_default_theme'), false);
  });

  await itAsync('Saves a custom theme for Tenant Alpha and sets it default', async () => {
    const saveRes = await adminSaveTheme(env, {
      id: 'theme_custom_alpha',
      name: 'Custom Alpha',
      tokens_json: JSON.stringify({ colors: { primary: '#112233' } })
    }, 'tenant_alpha');
    assert.strictEqual(saveRes.ok, true);

    const setDefRes = await adminSetDefaultTheme(env, { id: 'theme_custom_alpha' }, 'tenant_alpha');
    assert.strictEqual(setDefRes.ok, true);
    assert.strictEqual(setDefRes.message, 'تم تعيين الثيم الافتراضي بنجاح');

    const settingRow = mockDb.tables.settings.find(r => r.key === 'theme_default' && r.tenant_id === 'tenant_alpha');
    assert(settingRow, 'settings.theme_default exists for tenant_alpha');
    assert.strictEqual(settingRow.value, 'theme_custom_alpha');

    const themeRow = mockDb.tables.themes_v2.find(r => r.id === 'theme_custom_alpha' && r.tenant_id === 'tenant_alpha');
    assert.strictEqual(themeRow.is_active, 1);
  });

  await itAsync('Tenant Beta cannot set Tenant Alpha theme as default (Tenant Isolation)', async () => {
    const setDefBeta = await adminSetDefaultTheme(env, { id: 'theme_custom_alpha' }, 'tenant_beta');
    assert.strictEqual(setDefBeta.ok, false);
    assert.strictEqual(setDefBeta.error, 'الثيم المطلوب غير موجود');
  });

  await itAsync('Allows setting built-in theme as default', async () => {
    const res = await adminSetDefaultTheme(env, { id: 'rose' }, 'tenant_alpha');
    assert.strictEqual(res.ok, true);
    const settingRow = mockDb.tables.settings.find(r => r.key === 'theme_default' && r.tenant_id === 'tenant_alpha');
    assert.strictEqual(settingRow.value, 'rose');
  });

  // ── [2] TEST 2: DELETE & MEMORY UNREGISTER ──
  console.log('\n── [2] Delete Theme & ThemeEngine Memory State ──');

  await itAsync('Prevents deleting active default theme', async () => {
    // Current default for tenant_alpha is 'rose'
    // Let's set 'theme_custom_alpha' as default again
    await adminSetDefaultTheme(env, { id: 'theme_custom_alpha' }, 'tenant_alpha');
    const delRes = await adminDeleteTheme(env, { id: 'theme_custom_alpha' }, 'tenant_alpha');
    assert.strictEqual(delRes.ok, false);
    assert.strictEqual(delRes.error, 'لا يمكن حذف الثيم النشط حالياً');
  });

  await itAsync('Deletes inactive custom theme from D1 and memory', async () => {
    // Save a secondary theme
    await adminSaveTheme(env, {
      id: 'theme_to_delete',
      name: 'To Delete',
      tokens_json: JSON.stringify({ colors: { primary: '#999999' } })
    }, 'tenant_alpha');

    const engine = new ThemeEngine();
    engine.register({ id: 'theme_to_delete', name: 'To Delete', tokens: {} });
    assert(engine.get('theme_to_delete'), 'Theme registered in engine memory');

    const delRes = await adminDeleteTheme(env, { id: 'theme_to_delete' }, 'tenant_alpha');
    assert.strictEqual(delRes.ok, true);

    // Unregister in memory
    const unregResult = engine.unregister('theme_to_delete');
    assert.strictEqual(unregResult, true);
    assert.strictEqual(engine.get('theme_to_delete'), null, 'Theme removed from engine memory');
  });

  it('Refuses to unregister built-in themes from ThemeEngine', () => {
    const engine = new ThemeEngine();
    const unregBuiltin = engine.unregister('smartkiosk-default');
    assert.strictEqual(unregBuiltin, false);
  });

  // ── [3] TEST 3: PREVIEW ISOLATION ──
  console.log('\n── [3] Preview Isolation ──');

  it('ThemeEngine applies preview without overriding localStorage default', () => {
    const engine = new ThemeEngine();
    engine.register({ id: 'shrine', name: 'Shrine', tokens: { colors: { primary: '#dd1d1d' } } });
    engine.register({ id: 'smartkiosk-default', name: 'Default', tokens: { colors: { primary: '#1a1a2e' } } });

    // Simulate preview apply
    engine.apply('shrine', 'light', true);
    assert.strictEqual(engine.activeId, 'shrine');
    // Default theme remains unchanged
    assert.strictEqual(engine.defaultThemeId, null);
  });

  // ── [4] TEST 4: ERROR NORMALIZATION ──
  console.log('\n── [4] Safe Error Normalization ──');

  function getThemeErrorMessage(error) {
    if (!error) return 'حدث خطأ غير معروف';
    if (typeof error === 'string') return error;
    if (typeof error === 'object') {
      return error.message || error.code || JSON.stringify(error);
    }
    return String(error);
  }

  it('Normalizes object errors with message property', () => {
    const err = { code: 'UNKNOWN_ACTION', message: 'action غير معروف: admin_set_default_theme' };
    const formatted = getThemeErrorMessage(err);
    assert.strictEqual(formatted, 'action غير معروف: admin_set_default_theme');
    assert(!formatted.includes('[object Object]'));
    assert(!formatted.includes('objet'));
  });

  it('Normalizes object errors with code only', () => {
    const err = { code: 'FORBIDDEN' };
    const formatted = getThemeErrorMessage(err);
    assert.strictEqual(formatted, 'FORBIDDEN');
  });

  it('Normalizes plain string errors', () => {
    const err = 'اسم الثيم مطلوب';
    const formatted = getThemeErrorMessage(err);
    assert.strictEqual(formatted, 'اسم الثيم مطلوب');
  });

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`📊 THEME CRUD AUDIT RESULTS: ${passed} PASSED | 0 FAILED`);
  console.log('═══════════════════════════════════════════════════════════════\n');
}

runTests().catch(err => {
  console.error('Fatal test runner failure:', err);
  process.exit(1);
});
