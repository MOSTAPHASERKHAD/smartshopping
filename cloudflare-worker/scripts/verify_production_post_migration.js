import { execSync } from 'node:child_process';

const tables = [
  'products', 'orders', 'settings', 'coupons',
  'testimonials', 'reviews', 'pages', 'subscribers',
  'customers', 'themes', 'admin_sessions', 'customer_sessions',
  'tenants', 'users', 'sessions', 'audit_logs'
];

console.log('Verifying PRODUCTION D1 Post-Migration State (READ-ONLY)...\n');

const counts = {};
for (const table of tables) {
  try {
    const cmd = `npx wrangler d1 execute smart-shopping-db --remote --command="SELECT COUNT(*) as count FROM ${table};" --json`;
    const res = execSync(cmd, { encoding: 'utf8' });
    const parsed = JSON.parse(res);
    counts[table] = parsed[0]?.results[0]?.count ?? 'N/A';
  } catch (e) {
    counts[table] = 'ERROR: ' + e.message;
  }
}

console.log('--- PRODUCTION POST-MIGRATION COUNTS ---');
console.log(JSON.stringify(counts, null, 2));

const checks = [
  { name: 'Master Tenant check', sql: `SELECT id, name, slug, domain, status, plan FROM tenants WHERE id = 'tenant_master_default';` },
  { name: 'Null tenant_id in products', sql: `SELECT COUNT(*) as count FROM products WHERE tenant_id IS NULL;` },
  { name: 'Null tenant_id in orders', sql: `SELECT COUNT(*) as count FROM orders WHERE tenant_id IS NULL;` },
  { name: 'Null tenant_id in customers', sql: `SELECT COUNT(*) as count FROM customers WHERE tenant_id IS NULL;` },
  { name: 'Null tenant_id in settings', sql: `SELECT COUNT(*) as count FROM settings WHERE tenant_id IS NULL;` },
  { name: 'Null tenant_id in themes', sql: `SELECT COUNT(*) as count FROM themes WHERE tenant_id IS NULL;` },
  { name: 'Null tenant_id in subscribers', sql: `SELECT COUNT(*) as count FROM subscribers WHERE tenant_id IS NULL;` },
  { name: 'Non-master tenant_id backfill check in orders', sql: `SELECT COUNT(*) as count FROM orders WHERE tenant_id != 'tenant_master_default';` },
  { name: 'Indexes check in products', sql: `PRAGMA index_list(products);` },
  { name: 'Indexes check in orders', sql: `PRAGMA index_list(orders);` },
  { name: 'Indexes check in customers', sql: `PRAGMA index_list(customers);` },
  { name: 'Sessions table structure', sql: `PRAGMA table_info(sessions);` },
  { name: 'Audit logs table structure', sql: `PRAGMA table_info(audit_logs);` }
];

console.log('\n--- PRODUCTION INTEGRITY & BACKFILL CHECKS ---');
for (const check of checks) {
  try {
    const res = execSync(`npx wrangler d1 execute smart-shopping-db --remote --command="${check.sql}" --json`, { encoding: 'utf8' });
    const parsed = JSON.parse(res);
    console.log(`✅ [${check.name}]:`, JSON.stringify(parsed[0]?.results));
  } catch (e) {
    console.error(`❌ [${check.name}] ERROR:`, e.message);
  }
}
