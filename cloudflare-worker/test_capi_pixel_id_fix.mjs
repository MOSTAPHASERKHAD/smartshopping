import { sendCapiEvent } from './src/handlers/marketing.js';

console.log('═══════════════════════════════════════════════════════════════');
console.log('🔬 FORENSIC TEST: CAPI PIXEL_ID vs FB_PIXEL_ID VERIFICATION');
console.log('═══════════════════════════════════════════════════════════════\n');

let pass = 0;
let fail = 0;

function assert(condition, desc) {
  if (condition) {
    console.log(`  ✅ PASS: ${desc}`);
    pass++;
  } else {
    console.error(`  ❌ FAIL: ${desc}`);
    fail++;
  }
}

async function runForensicVerification() {
  // ── [Test 1] Real Database Model (Only 'pixel_id' exists in settings) ──
  console.log('── [Test 1] Real D1 Settings Model (Key = "pixel_id") ──');

  const realWorldDb = {
    prepare: (query) => ({
      all: async () => ({
        results: [
          { key: 'capi_enabled', value: 'true' },
          { key: 'fb_capi_token', value: 'EAAbTestValidToken12345' },
          { key: 'pixel_id', value: '928523816193898' } // Official DB Key from schema.sql & admin.html
        ]
      })
    })
  };

  let interceptedUrl = null;
  let interceptedPayload = null;
  let fetchCallCount = 0;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    fetchCallCount++;
    interceptedUrl = url;
    interceptedPayload = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ events_received: 1, fbtrace_id: 'TRACE_FB_FORENSIC_001' }),
      json: async () => ({ events_received: 1, fbtrace_id: 'TRACE_FB_FORENSIC_001' })
    };
  };

  try {
    const mockRequest = {
      headers: {
        get: (k) => {
          const map = {
            'cf-connecting-ip': '105.101.45.12',
            'user-agent': 'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 Chrome/128.0.0.0 Mobile Safari/537.36',
            'referer': 'https://smartshopping.click/product.html?product=4&fbclid=IwAR2xY6Z8ABC'
          };
          return map[k.toLowerCase()] || null;
        }
      }
    };

    const orderId = 'SK-2026-990011';
    await sendCapiEvent(
      { DB: realWorldDb },
      'Purchase',
      {
        order_id: orderId,
        value: 4500,
        content_ids: ['4'],
        event_source_url: 'https://smartshopping.click/product.html?product=4&fbclid=IwAR2xY6Z8ABC'
      },
      {
        phone: '0555123456',
        email: 'test.shopper@gmail.com',
        fbc: 'fb.1.1723850000000.IwAR2xY6Z8ABC',
        fbp: 'fb.1.1723850000000.1234567890'
      },
      mockRequest
    );

    assert(fetchCallCount === 1, 'HTTP request WAS sent to Meta Graph API (Did not abort!)');
    assert(interceptedUrl && interceptedUrl.includes('/928523816193898/events'), 'Target Pixel ID in URL is 928523816193898');
    assert(interceptedUrl.includes('access_token=EAAbTestValidToken12345'), 'Target Token is attached');
    
    const event = interceptedPayload.data[0];
    assert(event.event_name === 'Purchase', 'event_name === Purchase');
    assert(event.event_id === orderId, `event_id === ${orderId} (Exact match to order_id for deduplication)`);
    assert(event.event_source_url === 'https://smartshopping.click/product.html?product=4&fbclid=IwAR2xY6Z8ABC', 'event_source_url is the product URL');
    assert(event.action_source === 'website', 'action_source === website');
    assert(event.user_data.fbc === 'fb.1.1723850000000.IwAR2xY6Z8ABC', 'fbc parameter matches');
    assert(event.user_data.fbp === 'fb.1.1723850000000.1234567890', 'fbp parameter matches');
    assert(event.user_data.client_ip_address === '105.101.45.12', 'client_ip_address extracted from CF header');
    assert(event.user_data.client_user_agent.includes('Android 14'), 'client_user_agent extracted from header');
    assert(Array.isArray(event.user_data.ph) && event.user_data.ph[0].length === 64, 'ph is 64-character SHA-256 hash');
    assert(event.custom_data.order_id === orderId, 'custom_data.order_id === order_id');
    assert(event.custom_data.currency === 'DZD', 'custom_data.currency === DZD');
    assert(event.custom_data.value === 4500, 'custom_data.value === 4500');
    assert(event.custom_data.content_ids[0] === '4', 'custom_data.content_ids === ["4"]');

    // ── [Test 2] Backward Compatibility with 'fb_pixel_id' ──
    console.log('\n── [Test 2] Backward Compatibility with legacy "fb_pixel_id" ──');
    fetchCallCount = 0;
    interceptedUrl = null;

    const legacyDb = {
      prepare: (query) => ({
        all: async () => ({
          results: [
            { key: 'capi_enabled', value: 'true' },
            { key: 'fb_capi_token', value: 'EAAbLegacyToken' },
            { key: 'fb_pixel_id', value: '112233445566' }
          ]
        })
      })
    };

    await sendCapiEvent(
      { DB: legacyDb },
      'Purchase',
      { order_id: 'SK-LEGACY-01', value: 1200, content_ids: ['1'] },
      { phone: '0661123456' },
      mockRequest
    );

    assert(fetchCallCount === 1, 'Legacy fb_pixel_id successfully supported');
    assert(interceptedUrl && interceptedUrl.includes('/112233445566/events'), 'Target Pixel ID in URL is 112233445566');

  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`📊 FORENSIC TEST SUMMARY: ${pass} PASSED | ${fail} FAILED`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (fail > 0) process.exit(1);
}

runForensicVerification().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
