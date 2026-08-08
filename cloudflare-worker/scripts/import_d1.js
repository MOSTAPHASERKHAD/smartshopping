const fs = require('fs');
const path = require('path');

// اسم ملف الـ JSON الذي تم تصديره من GAS
const INPUT_FILE = path.join(__dirname, 'smart_shopping_gas_export.json');
const OUTPUT_FILE = path.join(__dirname, 'import.sql');

if (!fs.existsSync(INPUT_FILE)) {
  console.error(`❌ لم يتم العثور على ملف البيانات: ${INPUT_FILE}`);
  console.error('يرجى استخدام gas_exporter.gs للحصول على البيانات أولاً.');
  process.exit(1);
}

const db = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8'));
let sqlStatements = ['-- تحويل بيانات Google Sheets إلى Cloudflare D1\n'];

// دالة مساعدة لتجنب أخطاء الاقتباس في SQL
function escapeSql(val) {
  if (val === null || val === undefined || val === '') return 'NULL';
  if (typeof val === 'number' || typeof val === 'boolean') return val;
  return `'${String(val).replace(/'/g, "''")}'`;
}

// 1. تحويل المنتجات
if (db.Products && db.Products.length > 0) {
  sqlStatements.push('-- إدراج المنتجات');
  for (const row of db.Products) {
    const imagesJson = escapeSql(JSON.stringify(row.images ? String(row.images).split(',') : []));
    sqlStatements.push(
      `INSERT OR IGNORE INTO products (id, name, description, category, price, discount, cost, sku, stock, active, images_json) VALUES ` +
      `(${escapeSql(row.id)}, ${escapeSql(row.name)}, ${escapeSql(row.description)}, ${escapeSql(row.category)}, ` +
      `${escapeSql(row.price)}, ${escapeSql(row.discount)}, ${escapeSql(row.cost)}, ${escapeSql(row.sku)}, ` +
      `${escapeSql(row.stock)}, ${escapeSql(row.status === 'نشط' || row.status === true ? 1 : 0)}, ${imagesJson});`
    );
  }
}

// 2. تحويل الإعدادات
if (db.Settings && db.Settings.length > 0) {
  sqlStatements.push('\n-- إدراج الإعدادات');
  for (const row of db.Settings) {
    sqlStatements.push(
      `INSERT OR REPLACE INTO settings (key, value) VALUES (${escapeSql(row.key)}, ${escapeSql(row.value)});`
    );
  }
}

// 3. تحويل الطلبات
if (db.Orders && db.Orders.length > 0) {
  sqlStatements.push('\n-- إدراج الطلبات');
  for (const row of db.Orders) {
    sqlStatements.push(
      `INSERT OR IGNORE INTO orders (order_id, created_at, name, phone, wilaya_ar, municipality, delivery_type, items_json, subtotal, discount, coupon_code, status, notes) VALUES ` +
      `(${escapeSql(row.order_id)}, ${escapeSql(row.date)}, ${escapeSql(row.name)}, ${escapeSql(row.phone)}, ` +
      `${escapeSql(row.wilaya)}, ${escapeSql(row.municipality)}, ${escapeSql(row.delivery_type)}, ` +
      `${escapeSql(row.items)}, ${escapeSql(row.subtotal)}, ${escapeSql(row.discount)}, ${escapeSql(row.coupon_code)}, ` +
      `${escapeSql(row.status || 'pending')}, ${escapeSql(row.notes)});`
    );
  }
}

// يمكنك إضافة المزيد من الجداول (Coupons, Testimonials...) بنفس الطريقة.

fs.writeFileSync(OUTPUT_FILE, sqlStatements.join('\n'));
console.log(`✅ تم إنشاء ملف SQL بنجاح: ${OUTPUT_FILE}`);
console.log(`\nلتطبيق البيانات على قاعدة البيانات المحلية:`);
console.log(`npx wrangler d1 execute smart-shopping-db --local --file=scripts/import.sql`);
console.log(`\nلتطبيق البيانات على قاعدة الإنتاج (بعد التأكد):`);
console.log(`npx wrangler d1 execute smart-shopping-db --remote --file=scripts/import.sql`);
