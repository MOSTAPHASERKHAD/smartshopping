const { spawnSync } = require('child_process');
const fs = require('fs');

const testFiles = [
  'test_migration_safety.js',
  'test_multi_tenant_harness.js',
  'test_phase29_merchant_auth.js',
  'test_worker.js',
  'test_order_security.js',
  'test_customers.js',
  'test_subscribers.js',
  'test_themes.js',
  'test_uploads.js',
  'test_capi.js',
  'test_ai.js'
];

console.log('🚀 بدء حزمة اختبارات الانحدار (Regression Suite)...\n');

let failed = 0;
let passed = 0;

for (const file of testFiles) {
  if (!fs.existsSync(file)) {
    console.error(`⚠️ تخطي ${file} (غير موجود)`);
    continue;
  }
  
  console.log(`\n▶️ جاري تشغيل ${file}...`);
  const result = spawnSync('node', [file], { stdio: 'inherit' });
  
  if (result.status === 0) {
    console.log(`✅ نجح ${file}`);
    passed++;
  } else {
    console.error(`❌ فشل ${file}`);
    failed++;
  }
}

console.log('\n======================================');
console.log(`📊 النتيجة النهائية: ${passed} ناجح | ${failed} فاشل`);
console.log('======================================');

if (failed > 0) {
  process.exit(1);
}
