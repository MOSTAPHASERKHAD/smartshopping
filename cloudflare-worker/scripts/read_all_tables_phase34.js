import { execSync } from 'node:child_process';

const sql1 = `
SELECT 'tenants' as tbl, count(*) as count FROM tenants
UNION ALL SELECT 'users', count(*) FROM users
UNION ALL SELECT 'sessions', count(*) FROM sessions
UNION ALL SELECT 'admin_sessions', count(*) FROM admin_sessions
UNION ALL SELECT 'products', count(*) FROM products
UNION ALL SELECT 'orders', count(*) FROM orders
UNION ALL SELECT 'customers', count(*) FROM customers
UNION ALL SELECT 'settings', count(*) FROM settings;
`;

const sql2 = `
SELECT 'subscribers' as tbl, count(*) as count FROM subscribers
UNION ALL SELECT 'themes', count(*) FROM themes
UNION ALL SELECT 'coupons', count(*) FROM coupons
UNION ALL SELECT 'testimonials', count(*) FROM testimonials
UNION ALL SELECT 'reviews', count(*) FROM reviews
UNION ALL SELECT 'pages', count(*) FROM pages
UNION ALL SELECT 'customer_sessions', count(*) FROM customer_sessions
UNION ALL SELECT 'password_reset_tokens', count(*) FROM password_reset_tokens
UNION ALL SELECT 'email_verification_tokens', count(*) FROM email_verification_tokens
UNION ALL SELECT 'audit_logs', count(*) FROM audit_logs;
`;

const res1 = execSync(`npx wrangler d1 execute smart-shopping-db --remote --command="${sql1.replace(/\n/g, ' ')}"`, { encoding: 'utf8' });
console.log(res1);

const res2 = execSync(`npx wrangler d1 execute smart-shopping-db --remote --command="${sql2.replace(/\n/g, ' ')}"`, { encoding: 'utf8' });
console.log(res2);
