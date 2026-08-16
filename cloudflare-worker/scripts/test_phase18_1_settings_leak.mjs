/**
 * Phase 18.1 — DB2 phone-leak remediation tests (mock D1, in-process)
 *
 * Run: node scripts/test_phase18_1_settings_leak.mjs
 *
 * Verifies:
 *  - public getSettings() never exposes any spam_order_* key
 *  - public getSettings() still returns all other public settings
 *  - orderSpamGuard still works (writes state, blocks within 60s window)
 *  - SECRET_KEYS filtering is unchanged (admin/secret keys still hidden)
 */
import { getSettings } from '../src/handlers/catalog.js';
import { orderSpamGuard } from '../src/utils/auth.js';

let pass = 0, fail = 0;
function log(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' — ' + detail : ''}`);
  ok ? pass++ : fail++;
}

// ── Minimal in-memory D1 mock (settings-only) ──
class MockDB {
  constructor(rows) {
    this.settings = new Map(rows.map(r => [r.key, r.value]));
    this._sql = '';
    this._bind = [];
  }
  prepare(sql) { this._sql = sql; this._bind = []; return this; }
  bind(...args) { this._bind = args; return this; }
  async first() {
    const s = this._sql;
    if (/SELECT value FROM settings WHERE key = \? LIMIT 1/.test(s)) {
      return this.settings.has(this._bind[0])
        ? { value: this.settings.get(this._bind[0]) }
        : null;
    }
    return null;
  }
  async all() {
    const s = this._sql;
    if (/SELECT key, value FROM settings/.test(s)) {
      const rows = [];
      for (const [key, value] of this.settings) rows.push({ key, value });
      return { results: rows };
    }
    return { results: [] };
  }
  async run() {
    const s = this._sql;
    if (/INSERT OR REPLACE INTO settings\(key, value\)/.test(s)) {
      this.settings.set(this._bind[0], this._bind[1]);
      return { success: true };
    }
    if (/DELETE FROM settings WHERE key IN/.test(s)) {
      for (const key of this._bind[0]) this.settings.delete(key);
      return { success: true };
    }
    return { success: true };
  }
  async batch(stmts) { return stmts.map(() => ({ results: [] })); }
}

async function run() {
  console.log('── Phase 18.1 getSettings() spam_order_* leak regression ──');

  const rows = [
    { key: 'store_name',        value: 'Smart Shopping' },
    { key: 'currency',          value: 'DZD' },
    { key: 'theme_default',     value: 'default' },
    { key: 'spam_order_0777111222',   value: String(Date.now()) },
    { key: 'spam_order_07885195272',  value: String(Date.now()) },
    { key: 'admin_password_hash',     value: 'deadbeef' },
    { key: 'fb_capi_token',            value: 'secret-token' },
  ];

  // 1. spam_order_* never exposed by getSettings
  {
    const db = new MockDB(rows);
    const s = await getSettings({ DB: db });
    const leaked = Object.keys(s).filter(k => k.startsWith('spam_order_'));
    log('no spam_order_* leaked in public settings', leaked.length === 0, `found=${leaked.join(',') || 'none'}`);
  }

  // 2. other public settings still returned
  {
    const db = new MockDB(rows);
    const s = await getSettings({ DB: db });
    log('store_name still returned', s.store_name === 'Smart Shopping');
    log('currency still returned', s.currency === 'DZD');
  }

  // 3. SECRET_KEYS still filtered
  {
    const db = new MockDB(rows);
    const s = await getSettings({ DB: db });
    log('admin_password_hash hidden', !('admin_password_hash' in s));
    log('fb_capi_token hidden', !('fb_capi_token' in s));
  }

  // 4. orderSpamGuard still blocks within 60s and writes state
  {
    const db = new MockDB(rows);
    const first = await orderSpamGuard(db, '0555111222');
    log('orderSpamGuard allows first order', first === true);
    const stored = db.settings.get('spam_order_0555111222');
    log('orderSpamGuard stores spam_order_ state', typeof stored === 'string' && /^\d+$/.test(stored));
    const second = await orderSpamGuard(db, '0555111222');
    log('orderSpamGuard blocks second order within 60s', second === false);
  }

  // 5. orderSpamGuard still allows after different phone number
  {
    const db = new MockDB(rows);
    await orderSpamGuard(db, '0555111222');
    const other = await orderSpamGuard(db, '0555999888');
    log('orderSpamGuard allows other phone', other === true);
  }

  const verdict = fail === 0 ? 'ALL PASS' : 'FAILURES PRESENT';
  console.log(`\n── Result: ${verdict} (${pass} pass, ${fail} fail) ──`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch(e => { console.error('FATAL', e); process.exit(1); });