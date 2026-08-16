import { execSync } from 'node:child_process';

const tables = [
  'products', 'orders', 'settings', 'coupons',
  'testimonials', 'reviews', 'pages', 'subscribers',
  'customers', 'themes', 'admin_sessions', 'customer_sessions'
];

console.log('Fetching STAGING D1 counts...');

const counts = {};

for (const table of tables) {
  try {
    const cmd = `npx wrangler d1 execute DB --remote --env staging --command="SELECT COUNT(*) as count FROM ${table};" --json`;
    const res = execSync(cmd, { encoding: 'utf8' });
    const parsed = JSON.parse(res);
    counts[table] = parsed[0]?.results[0]?.count ?? 'N/A';
  } catch (e) {
    counts[table] = 'ERROR: ' + e.message;
  }
}

console.log(JSON.stringify(counts, null, 2));
