const fs = require('fs');
const path = require('path');

const INPUT_FILE = path.join(__dirname, 'smart_shopping_gas_export.json');
const OUTPUT_FILE = path.join(__dirname, 'import.sql');

if (!fs.existsSync(INPUT_FILE)) {
  console.error(`❌ Data file not found: ${INPUT_FILE}`);
  process.exit(1);
}

const db = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8'));
let sql = ['-- Migration from Google Sheets to D1\n'];

function escapeSql(val) {
  if (val === null || val === undefined || val === '') return 'NULL';
  if (typeof val === 'number') return val;
  if (typeof val === 'boolean') return val ? 1 : 0;
  return `'${String(val).replace(/'/g, "''")}'`;
}

// 1. Settings
if (db.Settings) {
  sql.push('\n-- Settings');
  for (const row of db.Settings) {
    const k = Object.keys(row)[0];
    const v = row[k];
    if (k && v !== undefined) {
      sql.push(`INSERT OR REPLACE INTO settings (key, value) VALUES (${escapeSql(k)}, ${escapeSql(v)});`);
    }
  }
}

// 2. Products
if (db.Catalog) {
  sql.push('\n-- Products');
  for (const row of db.Catalog) {
    const name = row.title_ar || row.title_en || 'بدون اسم';
    const desc = row.desc_ar || row.desc_en || '';
    const images = [];
    if (row.image2) images.push(row.image2);
    if (row.image3) images.push(row.image3);
    if (row.image4) images.push(row.image4);
    if (row.image5) images.push(row.image5);
    if (row.image6) images.push(row.image6);
    const gallery = JSON.stringify(images);
    const price = parseFloat(row.price) || 0;
    const oldPrice = parseFloat(row.old_price) || null;
    const active = row.active === true || row.active === 'TRUE' || row.active === 1 ? 1 : 0;
    const stock = row.stock !== undefined && row.stock !== '' ? parseInt(row.stock) : -1;

    sql.push(`INSERT OR REPLACE INTO products (sku, name, description, price, price_old, image_url, gallery_json, category, stock, active) VALUES ` +
      `(${escapeSql(row.id)}, ${escapeSql(name)}, ${escapeSql(desc)}, ${price}, ${escapeSql(oldPrice)}, ` +
      `${escapeSql(row.image1)}, ${escapeSql(gallery)}, ${escapeSql(row.category_ar)}, ${stock}, ${active});`
    );
  }
}

// 3. Orders
if (db.Orders) {
  sql.push('\n-- Orders');
  for (const row of db.Orders) {
    // Check if items_json is in another column due to shifting
    let items = row.items_json;
    if (String(row.delivery_type).startsWith('[')) {
      items = row.delivery_type;
      row.delivery_type = row.municipality;
    }
    const subtotal = parseFloat(row.subtotal) || 0;
    sql.push(`INSERT OR IGNORE INTO orders (order_id, created_at, name, phone, wilaya_code, wilaya_ar, wilaya_en, municipality, delivery_type, items_json, subtotal, shipping_note, status, notes, utm_source, utm_medium, utm_campaign) VALUES ` +
      `(${escapeSql(row.order_id)}, ${escapeSql(row.created_at)}, ${escapeSql(row.name)}, ${escapeSql(row.phone)}, ` +
      `${escapeSql(row.wilaya_code)}, ${escapeSql(row.wilaya_ar)}, ${escapeSql(row.wilaya_en)}, ` +
      `${escapeSql(row.municipality)}, ${escapeSql(row.delivery_type)}, ${escapeSql(items)}, ` +
      `${subtotal}, ${escapeSql(row.shipping_note)}, ${escapeSql(row.status || 'pending')}, ` +
      `${escapeSql(row.notes)}, ${escapeSql(row.utm_source)}, ${escapeSql(row.utm_medium)}, ${escapeSql(row.utm_campaign)});`
    );
  }
}

// 4. Customers
if (db.Customers) {
  sql.push('\n-- Customers');
  for (const row of db.Customers) {
    sql.push(`INSERT OR IGNORE INTO customers (phone, name, password_hash, created_at) VALUES ` +
      `(${escapeSql(row.phone)}, ${escapeSql(row.name)}, ${escapeSql(row.password)}, ${escapeSql(row.created_at)});`
    );
  }
}

// 5. Subscribers
if (db.Newsletter) {
  sql.push('\n-- Subscribers');
  for (const row of db.Newsletter) {
    sql.push(`INSERT OR IGNORE INTO subscribers (phone, name, created_at) VALUES (${escapeSql(row.email)}, ${escapeSql(row.email)}, ${escapeSql(row.subscribed_at)});`);
  }
}

// 6. Themes
if (db.Themes) {
  sql.push('\n-- Themes');
  for (const row of db.Themes) {
    sql.push(`INSERT OR IGNORE INTO themes (name, config_json, updated_at) VALUES ` +
      `(${escapeSql(row.name)}, ${escapeSql(row.theme_json)}, ${escapeSql(row.created_at)});`
    );
  }
}

// 7. Pages, Testimonials, Reviews, Coupons (if any exist)
if (db.Coupons) {
  sql.push('\n-- Coupons');
  for (const row of db.Coupons) {
    sql.push(`INSERT OR IGNORE INTO coupons (code, discount_type, discount_value, min_order, max_uses, used_count, expires_at, active) VALUES ` +
      `(${escapeSql(row.code)}, ${escapeSql(row.type||'percent')}, ${parseFloat(row.value)||0}, ${parseFloat(row.min_order)||0}, ` +
      `${parseInt(row.max_uses)||0}, ${parseInt(row.used_count)||0}, ${escapeSql(row.expires_at)}, ${row.active ? 1 : 0});`
    );
  }
}

fs.writeFileSync(OUTPUT_FILE, sql.join('\n'));
console.log(`✅ SQL file generated: ${OUTPUT_FILE}`);
