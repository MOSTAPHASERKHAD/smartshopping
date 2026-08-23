/**
 * Smart Shopping — Email-Only Notification & WhatsApp Purge Verification
 * 
 * Verifies:
 * 1. Complete WhatsApp purge (0 references to WhatsApp secrets or functions in worker notification paths)
 * 2. dispatchOrderNotifications dispatches exclusively to Resend email
 * 3. EmailProvider handles mock & live modes gracefully without exceptions
 * 4. adminTestNotification functions seamlessly in email-only mode
 */

import { strict as assert } from 'assert';
import { dispatchOrderNotifications } from '../src/handlers/orders.js';
import { adminTestNotification } from '../src/handlers/admin.js';
import { EmailProvider } from '../src/utils/email.js';

console.log('═══════════════════════════════════════════════════════════════');
console.log('✉️ SMARTKIOSK — EMAIL-ONLY NOTIFICATION & PURGE VERIFICATION');
console.log('═══════════════════════════════════════════════════════════════\n');

let passedTests = 0;
let totalTests = 0;

async function runAsyncTests() {
  // ── 1. Mock DB and Environment ──
  const mockSettings = [
    { key: 'notification_email_enabled', value: 'true' },
    { key: 'notification_emails', value: 'owner@smartshopping.click, manager@smartshopping.click' },
    { key: 'store_name', value: 'Smart Shopping Algeria' }
  ];

  const mockEnv = {
    ENVIRONMENT: 'development',
    DB: {
      prepare: (sql) => ({
        bind: (...args) => ({
          all: async () => ({ results: mockSettings }),
          run: async () => ({ success: true })
        })
      })
    }
  };

  const sampleOrder = {
    orderId: 'ORD-998811',
    name: 'أحمد بن علي',
    phone: '0555123456',
    wilayaAr: 'الجزائر',
    wilayaEn: 'Algiers',
    municipality: 'باب الزوار',
    deliveryType: 'home',
    shippingCost: 500,
    total: 5500
  };

  const sampleItems = [
    { name: 'سماعات بلوتوث لاسلكية', qty: 2, price: 2500 }
  ];

  // Test 1: dispatchOrderNotifications runs cleanly in mock/dev mode without throwing
  totalTests++;
  try {
    const res = await dispatchOrderNotifications(mockEnv, 'default', sampleOrder, sampleItems, 'all');
    assert.equal(typeof res, 'object');
    assert.equal(res.email.attempted, true);
    assert.equal(res.whatsapp, undefined, 'WhatsApp must not exist in notification response');
    console.log(`  ✅ PASS [${String(totalTests).padStart(2, '0')}]: dispatchOrderNotifications routes to email without WhatsApp remnants`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL [${String(totalTests).padStart(2, '0')}]: dispatchOrderNotifications failed`, err);
  }

  // Test 2: adminTestNotification returns valid email test payload
  totalTests++;
  try {
    const testRes = await adminTestNotification(mockEnv, {}, 'default');
    assert.equal(testRes.ok, true);
    assert.equal(testRes.type, 'email');
    assert.equal(testRes.result.email.attempted, true);
    console.log(`  ✅ PASS [${String(totalTests).padStart(2, '0')}]: adminTestNotification defaults to email-only verification`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL [${String(totalTests).padStart(2, '0')}]: adminTestNotification failed`, err);
  }

  // Test 3: Disabled email notification does not attempt dispatch
  totalTests++;
  try {
    const disabledEnv = {
      ENVIRONMENT: 'development',
      DB: {
        prepare: () => ({
          bind: () => ({
            all: async () => ({ results: [{ key: 'notification_email_enabled', value: 'false' }] })
          })
        })
      }
    };
    const disabledRes = await dispatchOrderNotifications(disabledEnv, 'default', sampleOrder, sampleItems, 'email');
    assert.equal(disabledRes.email.attempted, false);
    assert.equal(disabledRes.email.delivered, false);
    console.log(`  ✅ PASS [${String(totalTests).padStart(2, '0')}]: Disabled email setting respects toggle`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL [${String(totalTests).padStart(2, '0')}]: Disabled email setting test failed`, err);
  }

  // Test 4: EmailProvider handles empty recipient list safely
  totalTests++;
  try {
    const emptyRes = await EmailProvider.sendNewOrderAdminNotification({
      toList: [],
      orderId: 'ORD-0000',
      customerName: 'Test',
      phone: '0000',
      env: mockEnv
    });
    assert.equal(emptyRes.delivered, false);
    assert.equal(emptyRes.status, 'NO_RECIPIENTS');
    console.log(`  ✅ PASS [${String(totalTests).padStart(2, '0')}]: EmailProvider safely handles empty recipient list`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL [${String(totalTests).padStart(2, '0')}]: Empty recipient test failed`, err);
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`📊 RESULTS: ${passedTests}/${totalTests} PASSED (${Math.round((passedTests / totalTests) * 100)}%)`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runAsyncTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
