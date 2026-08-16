import { execSync } from 'node:child_process';

const queries = [
  { name: 'tenants', sql: 'SELECT count(*) as count FROM tenants;' },
  { name: 'users', sql: 'SELECT count(*) as count FROM users;' },
  { name: 'sessions', sql: 'SELECT count(*) as count FROM sessions;' },
  { name: 'admin_sessions', sql: 'SELECT count(*) as count FROM admin_sessions;' },
  { name: 'products', sql: 'SELECT count(*) as count FROM products;' },
  { name: 'orders', sql: 'SELECT count(*) as count FROM orders;' },
  { name: 'customers', sql: 'SELECT count(*) as count FROM customers;' },
  { name: 'settings', sql: 'SELECT count(*) as count FROM settings;' },
  { name: 'coupons', sql: 'SELECT count(*) as count FROM coupons;' },
  { name: 'testimonials', sql: 'SELECT count(*) as count FROM testimonials;' },
  { name: 'reviews', sql: 'SELECT count(*) as count FROM reviews;' },
  { name: 'pages', sql: 'SELECT count(*) as count FROM pages;' },
  { name: 'subscribers', sql: 'SELECT count(*) as count FROM subscribers;' },
  { name: 'themes', sql: 'SELECT count(*) as count FROM themes;' },
  { name: 'customer_sessions', sql: 'SELECT count(*) as count FROM customer_sessions;' },
  { name: 'null_products', sql: 'SELECT count(*) as count FROM products WHERE tenant_id IS NULL;' },
  { name: 'null_orders', sql: 'SELECT count(*) as count FROM orders WHERE tenant_id IS NULL;' },
  { name: 'null_customers', sql: 'SELECT count(*) as count FROM customers WHERE tenant_id IS NULL;' },
  { name: 'null_settings', sql: 'SELECT count(*) as count FROM settings WHERE tenant_id IS NULL;' }
];

console.log('--- PRODUCTION PRE-MIGRATION 0002 BASELINE (READ-ONLY) ---\n');

const counts = {};
for (const q of queries) {
  try {
    const res = execSync(`npx wrangler d1 execute smart-shopping-db --remote --json --command="${q.sql}"`, { encoding: 'utf8' });
    const parsed = JSON.parse(res);
    counts[q.name] = parsed[0]?.results[0]?.count ?? null;
    console.log(`📊 [${q.name}]:`, counts[q.name]);
  } catch (e) {
    console.error(`❌ [${q.name}] ERROR:`, e.message);
  }
}
