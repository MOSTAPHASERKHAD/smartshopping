import { execSync } from 'node:child_process';

const queries = [
  { name: 'Tenants count', sql: 'SELECT count(*) as count FROM tenants;' },
  { name: 'Users table schema', sql: 'PRAGMA table_info(users);' },
  { name: 'Sessions table schema', sql: 'PRAGMA table_info(sessions);' },
  { name: 'Password Reset Tokens table schema', sql: 'PRAGMA table_info(password_reset_tokens);' },
  { name: 'Email Verification Tokens table schema', sql: 'PRAGMA table_info(email_verification_tokens);' },
  { name: 'Products count', sql: 'SELECT count(*) as count FROM products;' },
  { name: 'Orders count', sql: 'SELECT count(*) as count FROM orders;' },
  { name: 'Customers count', sql: 'SELECT count(*) as count FROM customers;' }
];

console.log('--- STAGING POST-MIGRATION 0002 INTEGRITY (READ-ONLY) ---\n');

for (const q of queries) {
  try {
    const res = execSync(`npx wrangler d1 execute DB --remote --env staging --json --command="${q.sql}"`, { encoding: 'utf8' });
    const parsed = JSON.parse(res);
    console.log(`✅ [${q.name}]:`, JSON.stringify(parsed[0]?.results));
  } catch (e) {
    console.error(`❌ [${q.name}] ERROR:`, e.message);
  }
}
