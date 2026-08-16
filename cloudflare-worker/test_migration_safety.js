/**
 * Smart Shopping — Zero Data Loss & Migration Safety Test
 * ملف: cloudflare-worker/test_migration_safety.js
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testMigrationSafety() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🛡️ SMARTKIOSK PHASE 28 — ZERO DATA LOSS MIGRATION VERIFIER');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const rawDb = new DatabaseSync(':memory:');

  // 1. بناء قاعدة بيانات Single-Tenant قديمة (Legacy Schema)
  console.log('[Step 1] بناء قاعدة بيانات Single-Tenant قديمة وتعبئتها بالبيانات...');
  rawDb.exec(`
    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      sort_order INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1
    );
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT UNIQUE NOT NULL,
      created_at TEXT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      subtotal REAL NOT NULL,
      status TEXT DEFAULT 'pending'
    );
    CREATE TABLE coupons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      discount_value REAL NOT NULL,
      active INTEGER DEFAULT 1
    );
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE testimonials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_name TEXT NOT NULL,
      content TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1
    );
    CREATE TABLE reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      author_name TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT DEFAULT 'pending'
    );
    CREATE TABLE pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      active INTEGER DEFAULT 1
    );
    CREATE TABLE subscribers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL
    );
    CREATE TABLE customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT UNIQUE NOT NULL,
      name TEXT
    );
    CREATE TABLE themes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      config_json TEXT
    );
  `);

  // إدراج عينات بيانات في جميع الجداول
  rawDb.exec(`
    INSERT INTO products (name, description, price) VALUES ('Legacy Shoes', 'Comfortable', 4500), ('Legacy Watch', 'Luxury', 8900);
    INSERT INTO orders (order_id, name, phone, subtotal) VALUES ('ORD-2026-001', 'Ali Ben', '0555123456', 4500);
    INSERT INTO coupons (code, discount_value) VALUES ('WELCOME10', 10);
    INSERT INTO settings (key, value) VALUES ('store_name', 'Smart Shopping Classic'), ('shipping_home', '600');
    INSERT INTO testimonials (author_name, content) VALUES ('Mohamed', 'Great store!');
    INSERT INTO reviews (product_id, author_name, content) VALUES (1, 'Samir', 'High quality');
    INSERT INTO pages (slug, title, content) VALUES ('about-us', 'About Us', 'We are the best.');
    INSERT INTO subscribers (email) VALUES ('fan@mail.com');
    INSERT INTO customers (phone, name) VALUES ('0555123456', 'Ali Ben');
    INSERT INTO themes (name, config_json) VALUES ('default', '{}');
  `);

  // 2. قراءة عدد السجلات قبل الترحيل (Baseline Inventory)
  const tables = ['products', 'orders', 'coupons', 'settings', 'testimonials', 'reviews', 'pages', 'subscribers', 'customers', 'themes'];
  const countsBefore = {};
  for (const tbl of tables) {
    const row = rawDb.prepare(`SELECT COUNT(*) as count FROM ${tbl}`).get();
    countsBefore[tbl] = row.count;
  }
  console.log('📊 جدول الإحصائيات قبل الترحيل:', countsBefore);

  // 3. تطبيق سكربت الترحيل غير الهدام
  console.log('\n[Step 2] جاري تطبيق migration: 0001_multi_tenant_foundation.sql...');
  const migrationSql = fs.readFileSync(path.join(__dirname, 'migrations', '0001_multi_tenant_foundation.sql'), 'utf8');
  rawDb.exec(migrationSql);
  console.log('✅ تم تنفيذ الترحيل بنجاح وبدون أي أخطاء SQL.');

  // 4. قراءة عدد السجلات بعد الترحيل والتحقق من الصفر فقدان للبيانات
  console.log('\n[Step 3] التحقق من مطابقة عدد السجلات (Zero Data Loss Verification):');
  const countsAfter = {};
  let totalRows = 0;
  for (const tbl of tables) {
    const row = rawDb.prepare(`SELECT COUNT(*) as count FROM ${tbl}`).get();
    countsAfter[tbl] = row.count;
    totalRows += row.count;

    if (countsBefore[tbl] === countsAfter[tbl]) {
      console.log(`  ✅ ${tbl.padEnd(14)}: قبل = ${countsBefore[tbl]} | بعد = ${countsAfter[tbl]} (مطابقة تامة 100%)`);
    } else {
      console.error(`  ❌ فقدان بيانات في الجدول ${tbl}! قبل = ${countsBefore[tbl]} | بعد = ${countsAfter[tbl]}`);
      process.exit(1);
    }
  }

  // 5. التحقق من أن جميع السجلات القديمة أُسندت إلى Master Tenant الافتراضي
  console.log('\n[Step 4] التحقق من الإسناد التلقائي للمستأجر الرئيسي الافتراضي (Backfill Integrity):');
  for (const tbl of tables) {
    const unassigned = rawDb.prepare(`SELECT COUNT(*) as count FROM ${tbl} WHERE tenant_id IS NULL OR tenant_id != 'tenant_master_default'`).get();
    if (unassigned.count === 0) {
      console.log(`  ✅ ${tbl.padEnd(14)}: جميع السجلات تحمل tenant_id = 'tenant_master_default'`);
    } else {
      console.error(`  ❌ سجلات غير مسندة في ${tbl}: ${unassigned.count}`);
      process.exit(1);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`🎉 النتيجة: تم ترحيل ${totalRows} سجلاً عبر 10 جداول بصفر فقدان للبيانات (Zero Data Loss Verified).`);
  console.log('═══════════════════════════════════════════════════════════════');
}

testMigrationSafety().catch(err => {
  console.error('\n❌ Migration safety check failed:', err);
  process.exit(1);
});
