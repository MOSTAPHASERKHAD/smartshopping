import { execSync } from 'node:child_process';

const queries = [
  { name: 'Tenants', sql: 'SELECT * FROM tenants;' },
  { name: 'Users', sql: 'SELECT id, tenant_id, email, name, role, status, created_at FROM users;' },
  { name: 'Sessions', sql: 'SELECT token_hash, user_id, tenant_id, role, expires_at, created_at, last_seen_at FROM sessions;' },
  { name: 'Admin Sessions (Legacy)', sql: 'SELECT token, expires_at, created_at FROM admin_sessions;' },
  { name: 'Audit Logs', sql: 'SELECT id, tenant_id, user_id, action, resource_type, resource_id, created_at FROM audit_logs ORDER BY id DESC LIMIT 5;' }
];

console.log('--- PRODUCTION AUTH TABLES STATE (READ-ONLY) ---\n');

for (const q of queries) {
  try {
    const res = execSync(`npx wrangler d1 execute smart-shopping-db --remote --json --command="${q.sql}"`, { encoding: 'utf8' });
    const parsed = JSON.parse(res);
    console.log(`📋 [${q.name}]:`, JSON.stringify(parsed[0]?.results, null, 2));
  } catch (e) {
    console.error(`❌ [${q.name}] ERROR:`, e.message);
  }
}
