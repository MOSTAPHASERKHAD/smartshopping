/**
 * Phase 3 — Customer login/register regression tests (Real SQLite D1 emulator)
 *
 * Run: node scripts/test_phase3_customer_regression.js
 */
import { DatabaseSync } from 'node:sqlite';
import { customerRegister, customerLogin } from '../src/handlers/customers.js';
import {
  sha256, hashCustomerPasswordS1, verifyCustomerPassword,
  CUSTOMER_PW_S1, CUSTOMER_PW_P1,
} from '../src/utils/auth.js';

const TEST_PEPPER = 'phase3-regression-pepper-only'; // fixture, NOT the real secret

let pass = 0, fail = 0;
function log(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' — ' + detail : ''}`);
  ok ? pass++ : fail++;
}

function createD1(rawDb) {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              const stmt = rawDb.prepare(sql);
              return stmt.get(...args) || null;
            },
            async all() {
              const stmt = rawDb.prepare(sql);
              return { results: stmt.all(...args) };
            },
            async run() {
              const stmt = rawDb.prepare(sql);
              const info = stmt.run(...args);
              return {
                success: true,
                meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) }
              };
            }
          };
        },
        async first() {
          const stmt = rawDb.prepare(sql);
          return stmt.get() || null;
        },
        async all() {
          const stmt = rawDb.prepare(sql);
          return { results: stmt.all() };
        },
        async run() {
          const stmt = rawDb.prepare(sql);
          const info = stmt.run();
          return {
            success: true,
            meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) }
          };
        }
      };
    },
    async batch(stmts) {
      const res = [];
      for (const s of stmts) {
        res.push(await (s.run ? s.all() : s));
      }
      return res;
    }
  };
}

async function run() {
  console.log('── Phase 3 customer_login / customer_register regression ──');

  const rawDb = new DatabaseSync(':memory:');
  rawDb.exec(`
    CREATE TABLE customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT DEFAULT 'tenant_master_default',
      phone TEXT NOT NULL,
      name TEXT DEFAULT '',
      wilaya_code TEXT DEFAULT '',
      wilaya_ar TEXT DEFAULT '',
      wilaya_en TEXT DEFAULT '',
      municipality TEXT DEFAULT '',
      delivery_type TEXT DEFAULT '',
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE TABLE customer_sessions (
      token TEXT PRIMARY KEY,
      customer_id INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);

  const db = createD1(rawDb);
  const env = { DB: db, CUSTOMER_PEPPER: TEST_PEPPER };

  // 1. register stores s1 hash
  {
    const r = await customerRegister(env, { phone: '0551000000', password: 'plainPassword123', name: 'Fresh User' });
    log('register succeeds + issues token', r.ok === true && typeof r.token === 'string');

    const row = await db.prepare('SELECT password_hash FROM customers WHERE phone = ?').bind('0551000000').first();
    const isS1 = typeof row?.password_hash === 'string' && row.password_hash.startsWith('s1:');
    log('register stores s1: hash (no plaintext)', isS1);

    const v = await verifyCustomerPassword('plainPassword123', '0551000000', row?.password_hash);
    log('register hash verifies via verifier', v.ok === true && v.scheme === 's1');
  }

  // 2. login s1 account
  {
    const r = await customerLogin(env, { phone: '0551000000', password: 'plainPassword123' });
    log('login s1 account ok', r.ok === true && typeof r.token === 'string' && r.customer?.phone === '0551000000');

    const rBad = await customerLogin(env, { phone: '0551000000', password: 'wrongPassword' });
    log('login s1 wrong password rejected', rBad.ok === false);
  }

  // 3. numeric legacy account -> auto upgrade to s1 on login
  {
    await db.prepare('INSERT INTO customers (phone, name, password_hash) VALUES (?, ?, ?)').bind('0552000000', 'Numeric User', '1234').run();
    const r = await customerLogin(env, { phone: '0552000000', password: '1234' });
    log('numeric legacy login ok', r.ok === true);

    const row = await db.prepare('SELECT password_hash FROM customers WHERE phone = ?').bind('0552000000').first();
    log('numeric legacy lazy-rehashed to s1', row.password_hash.startsWith('s1:'));
  }

  // 4. sha256 legacy account -> auto upgrade to s1
  {
    const bareSha = await sha256('shaPass:0553000000');
    await db.prepare('INSERT INTO customers (phone, name, password_hash) VALUES (?, ?, ?)').bind('0553000000', 'Sha User', bareSha).run();
    const r = await customerLogin(env, { phone: '0553000000', password: 'shaPass' });
    log('sha256 legacy login ok', r.ok === true);

    const row = await db.prepare('SELECT password_hash FROM customers WHERE phone = ?').bind('0553000000').first();
    log('sha256 legacy lazy-rehashed to s1', row.password_hash.startsWith('s1:'));
  }

  // 5. p1 legacy account -> auto upgrade with pepper
  {
    const p1Hash = `${CUSTOMER_PW_P1}${await sha256('p1Pass:0554000000:' + TEST_PEPPER)}`;
    await db.prepare('INSERT INTO customers (phone, name, password_hash) VALUES (?, ?, ?)').bind('0554000000', 'P1 User', p1Hash).run();
    const r = await customerLogin(env, { phone: '0554000000', password: 'p1Pass' });
    log('p1 legacy login ok (fixture pepper)', r.ok === true);

    const row = await db.prepare('SELECT password_hash FROM customers WHERE phone = ?').bind('0554000000').first();
    log('p1 legacy lazy-rehashed to s1', row.password_hash.startsWith('s1:'));

    // subsequent login uses upgraded s1
    const r2 = await customerLogin(env, { phone: '0554000000', password: 'p1Pass' });
    log('subsequent login uses s1', r2.ok === true);
  }

  // 6. failed login never modifies password_hash
  {
    const p1Hash = `${CUSTOMER_PW_P1}${await sha256('realPass:0555000000:' + TEST_PEPPER)}`;
    await db.prepare('INSERT INTO customers (phone, name, password_hash) VALUES (?, ?, ?)').bind('0555000000', 'Untouched User', p1Hash).run();
    const r = await customerLogin(env, { phone: '0555000000', password: 'wrongAttempt' });
    log('failed login rejected', r.ok === false);

    const row = await db.prepare('SELECT password_hash FROM customers WHERE phone = ?').bind('0555000000').first();
    log('failed login hash UNCHANGED', row.password_hash === p1Hash);
  }

  // 7. p1 login without pepper -> rejected and untouched
  {
    const p1Hash = `${CUSTOMER_PW_P1}${await sha256('noPepperPass:0556000000:' + TEST_PEPPER)}`;
    await db.prepare('INSERT INTO customers (phone, name, password_hash) VALUES (?, ?, ?)').bind('0556000000', 'NoPepper User', p1Hash).run();
    const envNoPepper = { DB: db };
    const r = await customerLogin(envNoPepper, { phone: '0556000000', password: 'noPepperPass' });
    log('p1 login without pepper rejected', r.ok === false);

    const row = await db.prepare('SELECT password_hash FROM customers WHERE phone = ?').bind('0556000000').first();
    log('p1 without pepper hash UNCHANGED', row.password_hash === p1Hash);
  }

  // 8. validations
  {
    const r1 = await customerRegister(env, { phone: '0557000000', password: '123' });
    log('register short-password rejected', r1.ok === false);

    const r2 = await customerRegister(env, { phone: '123', password: 'validPassword' });
    log('register bad-phone rejected', r2.ok === false);

    const rDup = await customerRegister(env, { phone: '0551000000', password: 'anotherPassword' });
    log('duplicate phone rejected', rDup.ok === false);
  }

  console.log(`\nRESULT: ${pass} PASS, ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch(e => { console.error('FATAL', e); process.exit(1); });
