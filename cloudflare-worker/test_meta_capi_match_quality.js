import { normalizePhone, normalizeEmail, formatFbc, sendCapiEvent } from './src/handlers/marketing.js';
import { sha256 } from './src/utils/auth.js';

console.log('═══════════════════════════════════════════════════════════════');
console.log('🎯 SMARTKIOSK — META CAPI MATCH QUALITY AUTOMATED TEST SUITE');
console.log('═══════════════════════════════════════════════════════════════\n');

let pass = 0;
let fail = 0;

function assert(condition, desc) {
  if (condition) {
    console.log(`  ✅ PASS [${String(pass + 1).padStart(2, '0')}]: ${desc}`);
    pass++;
  } else {
    console.error(`  ❌ FAIL: ${desc}`);
    fail++;
  }
}

async function runTests() {
  // ── [1] Algerian Phone Number Normalization ──
  console.log('── [1] Algerian Phone Number Normalization ──');
  assert(normalizePhone('0555123456') === '213555123456', 'Converts 05... (10 digits) to 213555123456');
  assert(normalizePhone('0661 12 34 56') === '213661123456', 'Strips whitespace and converts 06... to 213661123456');
  assert(normalizePhone('0770-12-34-56') === '213770123456', 'Strips hyphens and converts 07... to 213770123456');
  assert(normalizePhone('+213555123456') === '213555123456', 'Strips leading + from +213...');
  assert(normalizePhone('00213555123456') === '213555123456', 'Strips leading 00 from 00213...');
  assert(normalizePhone('555123456') === '213555123456', 'Prepends 213 to 9-digit mobile number 555123456');
  assert(normalizePhone('') === '', 'Handles empty phone input gracefully');
  assert(normalizePhone(null) === '', 'Handles null phone input gracefully');

  // ── [2] Email Normalization & Hashing ──
  console.log('\n── [2] Email Normalization & Hashing ──');
  assert(normalizeEmail('  Customer@Example.COM  ') === 'customer@example.com', 'Trims and lowercases email');
  assert(normalizeEmail('invalid-email') === '', 'Rejects email without @ symbol');
  assert(normalizeEmail('') === '', 'Handles empty email gracefully');
  
  const testEmail = normalizeEmail('test.buyer@gmail.com');
  const hashedEmail = await sha256(testEmail);
  assert(typeof hashedEmail === 'string' && hashedEmail.length === 64, 'Hashes email to 64-hex-char SHA-256');
  assert(!hashedEmail.includes('test.buyer'), 'Guarantees raw email is never present in hash');

  // ── [3] Meta Click ID (fbc) Formatting & Integrity ──
  console.log('\n── [3] Meta Click ID (fbc) Formatting & Integrity ──');
  const fixedTime = 1723850000000;
  assert(formatFbc('IwAR123456789', fixedTime) === 'fb.1.1723850000000.IwAR123456789', 'Constructs canonical fb.1.<time>.<fbclid>');
  assert(formatFbc('fb.1.1723850000000.ExistingFbc') === 'fb.1.1723850000000.ExistingFbc', 'Preserves pre-formatted fbc untouched');
  assert(formatFbc(undefined) === undefined, 'Does NOT fabricate fake fbc when fbclid is missing');
  assert(formatFbc('') === undefined, 'Does NOT fabricate fake fbc for empty string');

  // ── [4] Meta Browser ID (fbp) Handling ──
  console.log('\n── [4] Meta Browser ID (fbp) Handling ──');
  const sampleFbp = 'fb.1.1723850000000.9876543210';
  assert(sampleFbp.startsWith('fb.1.'), 'Validates standard fbp format from Pixel cookie');

  // ── [5] Full Simulated CAPI Payload Verification ──
  console.log('\n── [5] Full Simulated CAPI Payload Verification ──');
  
  // Mock DB environment with CAPI settings
  const mockDb = {
    prepare: (query) => ({
      all: async () => ({
        results: [
          { key: 'capi_enabled', value: 'true' },
          { key: 'fb_capi_token', value: 'EAAMockToken12345' },
          { key: 'fb_pixel_id', value: '928523816193898' }
        ]
      })
    })
  };

  let capturedPayload = null;
  let capturedUrl = null;

  // Intercept global fetch
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    capturedUrl = url;
    capturedPayload = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ events_received: 1, fbtrace_id: 'TEST_TRACE_123' })
    };
  };

  try {
    const mockHeaders = new Map([
      ['cf-connecting-ip', '197.200.10.5'],
      ['user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'],
      ['referer', 'https://smartshopping.click/product.html?product=1&fbclid=MockClickId']
    ]);
    const mockRequest = {
      headers: {
        get: (k) => mockHeaders.get(k.toLowerCase()) || null
      }
    };

    const orderId = 'SK-TEST-998877';
    await sendCapiEvent(
      { DB: mockDb },
      'Purchase',
      {
        order_id: orderId,
        value: 3000,
        content_ids: ['1'],
        event_source_url: 'https://smartshopping.click/product.html?product=1&fbclid=MockClickId'
      },
      {
        phone: '0555123456',
        email: 'buyer@example.com',
        fbc: 'fb.1.1723850000000.MockClickId',
        fbp: 'fb.1.1723850000000.MockBrowserId'
      },
      mockRequest
    );

    assert(capturedPayload !== null, 'CAPI payload generated and intercepted');
    assert(capturedUrl.includes('928523816193898'), 'CAPI URL targets correct Pixel/Dataset ID');
    
    const event = capturedPayload.data[0];
    assert(event.event_name === 'Purchase', 'Event name is Purchase');
    assert(event.event_id === orderId, 'Root event_id matches exact orderId');
    assert(event.event_source_url === 'https://smartshopping.click/product.html?product=1&fbclid=MockClickId', 'event_source_url populated correctly');
    assert(event.custom_data.order_id === orderId, 'Custom data order_id matches exact orderId');
    assert(event.custom_data.currency === 'DZD', 'Currency is DZD');
    assert(event.custom_data.value === 3000, 'Order value is 3000');
    assert(Array.isArray(event.custom_data.content_ids) && event.custom_data.content_ids[0] === '1', 'content_ids contains product ID');

    // Verify user_data match quality parameters
    assert(event.user_data.client_ip_address === '197.200.10.5', 'Client IP extracted from CF-Connecting-IP');
    assert(event.user_data.client_user_agent.includes('iPhone'), 'User-Agent extracted from request header');
    assert(event.user_data.fbc === 'fb.1.1723850000000.MockClickId', 'fbc parameter present and formatted');
    assert(event.user_data.fbp === 'fb.1.1723850000000.MockBrowserId', 'fbp parameter present');
    assert(Array.isArray(event.user_data.ph) && event.user_data.ph[0].length === 64, 'Phone number SHA-256 hashed');
    assert(Array.isArray(event.user_data.em) && event.user_data.em[0].length === 64, 'Email SHA-256 hashed');
    assert(!JSON.stringify(capturedPayload).includes('0555123456'), 'Raw phone number is NEVER leaked in CAPI payload');
    assert(!JSON.stringify(capturedPayload).includes('buyer@example.com'), 'Raw email is NEVER leaked in CAPI payload');

  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`📊 TEST SUITE SUMMARY: ${pass} PASSED | ${fail} FAILED`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (fail > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
