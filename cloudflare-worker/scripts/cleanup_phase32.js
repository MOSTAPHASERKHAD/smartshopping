import { execSync } from 'node:child_process';

console.log('--- CLEANING UP PHASE 32 TEST TENANTS ---');
// Delete test tenants created during Phase 32 live validation
execSync(`npx wrangler d1 execute smart-shopping-db --remote --command="DELETE FROM users WHERE email LIKE 'phase32-%'; DELETE FROM tenants WHERE id LIKE 'tenant_%' AND id != 'tenant_master_default'; DELETE FROM email_verification_tokens WHERE user_id NOT IN (SELECT id FROM users); DELETE FROM sessions WHERE user_id NOT IN (SELECT id FROM users);"`, { stdio: 'inherit' });
console.log('--- CLEANUP COMPLETE ---');
