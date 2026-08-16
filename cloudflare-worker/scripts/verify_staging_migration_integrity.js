import { execSync } from 'node:child_process';

const queries = [
  { name: 'Master Tenant check', sql: `SELECT id, name, slug, domain FROM tenants WHERE id = 'tenant_master_default';` },
  { name: 'Null tenant_id in products', sql: `SELECT COUNT(*) as count FROM products WHERE tenant_id IS NULL;` },
  { name: 'Null tenant_id in orders', sql: `SELECT COUNT(*) as count FROM orders WHERE tenant_id IS NULL;` },
  { name: 'Null tenant_id in customers', sql: `SELECT COUNT(*) as count FROM customers WHERE tenant_id IS NULL;` },
  { name: 'Null tenant_id in settings', sql: `SELECT COUNT(*) as count FROM settings WHERE tenant_id IS NULL;` },
  { name: 'Non-master tenant_id backfill check in orders', sql: `SELECT COUNT(*) as count FROM orders WHERE tenant_id != 'tenant_master_default';` },
  { name: 'Indexes check in products', sql: `PRAGMA index_list(products);` },
  { name: 'Indexes check in orders', sql: `PRAGMA index_list(orders);` },
  { name: 'Sessions table schema', sql: `PRAGMA table_info(sessions);` },
  { name: 'Audit logs table schema', sql: `PRAGMA table_info(audit_logs);` }
];

console.log('Verifying Staging D1 Post-Migration Integrity...\n');

for (const q of queries) {
  try {
    const res = execSync(`npx wrangler d1 execute DB --remote --env staging --command="${q.sql}" --json`, { encoding: 'utf8' });
    const parsed = JSON.parse(res);
    console.log(`✅ [${q.name}]:`, JSON.stringify(parsed[0]?.results));
  } catch (e) {
    console.error(`❌ [${q.name}] ERROR:`, e.message);
  }
}
