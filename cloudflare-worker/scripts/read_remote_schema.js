import { execSync } from 'node:child_process';

const tables = [
  'products', 'orders', 'settings', 'coupons',
  'testimonials', 'reviews', 'pages', 'subscribers',
  'customers', 'themes', 'admin_sessions', 'customer_sessions'
];

console.log('Fetching remote D1 inventory (READ-ONLY)...');

const counts = {};
const schemaInfo = {};

for (const table of tables) {
  try {
    const countRes = execSync(
      `npx wrangler d1 execute smart-shopping-db --remote --json --command="SELECT COUNT(*) as count FROM ${table};"`,
      { encoding: 'utf8' }
    );
    const parsedCount = JSON.parse(countRes);
    counts[table] = parsedCount[0]?.results[0]?.count ?? 'N/A';

    const infoRes = execSync(
      `npx wrangler d1 execute smart-shopping-db --remote --json --command="PRAGMA table_info(${table});"`,
      { encoding: 'utf8' }
    );
    const parsedInfo = JSON.parse(infoRes);
    schemaInfo[table] = {
      columns: parsedInfo[0]?.results?.map(c => ({ name: c.name, type: c.type, pk: c.pk, notnull: c.notnull })),
    };

    const indexRes = execSync(
      `npx wrangler d1 execute smart-shopping-db --remote --json --command="PRAGMA index_list(${table});"`,
      { encoding: 'utf8' }
    );
    const parsedIndex = JSON.parse(indexRes);
    schemaInfo[table].indexes = parsedIndex[0]?.results?.map(i => ({ name: i.name, unique: i.unique }));
  } catch (e) {
    counts[table] = 'ERROR: ' + e.message;
  }
}

console.log('\n--- REMOTE D1 COUNTS ---');
console.log(JSON.stringify(counts, null, 2));

console.log('\n--- REMOTE D1 SCHEMA INFO ---');
console.log(JSON.stringify(schemaInfo, null, 2));
