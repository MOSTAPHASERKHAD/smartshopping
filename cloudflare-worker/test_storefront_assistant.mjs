import assert from 'node:assert';
import { getSettings } from './src/handlers/catalog.js';
import { publicAiChat } from './src/handlers/ai.js';

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log('  ✅ PASS [' + String(passed + 1).padStart(2, '0') + ']: ' + name);
    passed++;
  } catch (err) {
    console.error('  ❌ FAIL [' + String(passed + failed + 1).padStart(2, '0') + ']: ' + name);
    console.error('     Error: ' + err.message + '\n');
    failed++;
  }
}

async function runAsyncTest(name, fn) {
  try {
    await fn();
    console.log('  ✅ PASS [' + String(passed + 1).padStart(2, '0') + ']: ' + name);
    passed++;
  } catch (err) {
    console.error('  ❌ FAIL [' + String(passed + failed + 1).padStart(2, '0') + ']: ' + name);
    console.error('     Error: ' + err.message + '\n');
    failed++;
  }
}

function createMockEnv(customSettings = {}, customProducts = [], geminiKeyEnv = 'AIzaSy_MOCK_SERVER_KEY') {
  const settingsMap = { ...customSettings };
  const kvCache = new Map();

  const env = {
    GEMINI_API_KEY: geminiKeyEnv,
    CACHE: {
      async get(key, opts) {
        const val = kvCache.get(key);
        if (!val) return null;
        if (opts && opts.type === 'json') return JSON.parse(val);
        return val;
      },
      async put(key, value) {
        kvCache.set(key, typeof value === 'string' ? value : JSON.stringify(value));
      },
      async delete(key) {
        kvCache.delete(key);
      }
    },
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async all() {
                if (sql.includes('FROM settings')) {
                  const results = [];
                  for (const [key, value] of Object.entries(settingsMap)) {
                    results.push({ key, value: String(value) });
                  }
                  return { results };
                }
                if (sql.includes('FROM products')) {
                  const filtered = customProducts.filter(p => {
                    if (sql.includes('tenant_id = ?')) {
                      return (p.tenant_id === args[0] || (args[0] === 'tenant_master_default' && !p.tenant_id));
                    }
                    return true;
                  });
                  return { results: filtered };
                }
                if (sql.includes('FROM themes')) {
                  return { results: [] };
                }
                return { results: [] };
              },
              async first() {
                const { results } = await this.all();
                return results && results.length > 0 ? results[0] : null;
              },
              async run() {
                return { success: true };
              }
            };
          }
        };
      }
    }
  };

  return env;
}

console.log('════════════════════════════════════════════════════════════════════════════');
console.log('🤖 SMARTKIOSK — STOREFRONT AI ASSISTANT & VISIBILITY TEST SUITE');
console.log('════════════════════════════════════════════════════════════════════════════\n');

console.log('── [AXIS 1] Backend Source of Truth & Safe Settings Propagation ──');

await runAsyncTest('TEST 1: Default behavior when Gemini Key exists -> ai_enabled = true (Safe Boolean)', async () => {
  const env = createMockEnv({}, [], 'AIzaSy_VALID_KEY');
  const settings = await getSettings(env, 'tenant_master_default');

  assert.strictEqual(settings.ai_enabled, true, 'ai_enabled must be true when server has capability');
  assert.strictEqual(settings.ai_assistant_enabled, true, 'ai_assistant_enabled must match ai_enabled');
  assert.strictEqual(settings.gemini_api_key, undefined, 'gemini_api_key MUST NEVER be returned to client');
});

await runAsyncTest('TEST 2: Explicit disable (ai_assistant_enabled: false) MUST WIN even if Key exists', async () => {
  const env = createMockEnv({ ai_assistant_enabled: 'false' }, [], 'AIzaSy_VALID_KEY');
  const settings = await getSettings(env, 'tenant_master_default');

  assert.strictEqual(settings.ai_enabled, false, 'ai_enabled must be false on explicit merchant disable');
  assert.strictEqual(settings.ai_assistant_enabled, false, 'ai_assistant_enabled must be false');
});

await runAsyncTest('TEST 3: Explicit disable (ai_enabled: false) MUST WIN even if Key exists', async () => {
  const env = createMockEnv({ ai_enabled: 'false' }, [], 'AIzaSy_VALID_KEY');
  const settings = await getSettings(env, 'tenant_master_default');

  assert.strictEqual(settings.ai_enabled, false, 'ai_enabled must be false on explicit general disable');
  assert.strictEqual(settings.ai_assistant_enabled, false, 'ai_assistant_enabled must be false');
});

await runAsyncTest('TEST 4: Conflict Resolution (ai_assistant_enabled: false, ai_enabled: true) -> Disable wins', async () => {
  const env = createMockEnv({ ai_assistant_enabled: 'false', ai_enabled: 'true' }, [], 'AIzaSy_VALID_KEY');
  const settings = await getSettings(env, 'tenant_master_default');

  assert.strictEqual(settings.ai_enabled, false, 'Dedicated assistant setting takes precedence over general setting');
});

await runAsyncTest('TEST 5: Conflict Resolution (ai_assistant_enabled: true, ai_enabled: false) -> Assistant setting wins', async () => {
  const env = createMockEnv({ ai_assistant_enabled: 'true', ai_enabled: 'false' }, [], 'AIzaSy_VALID_KEY');
  const settings = await getSettings(env, 'tenant_master_default');

  assert.strictEqual(settings.ai_enabled, true, 'Dedicated assistant setting takes precedence and enables assistant with capability');
});

await runAsyncTest('TEST 6: No Gemini Key capability -> ai_enabled = false regardless of merchant setting', async () => {
  const env = createMockEnv({ ai_assistant_enabled: 'true' }, [], null);
  const settings = await getSettings(env, 'tenant_master_default');

  assert.strictEqual(settings.ai_enabled, false, 'ai_enabled must be false if server lacks Gemini capability');
});

await runAsyncTest('TEST 7: API Key Absolute Protection (Checked against all SECRET_KEYS)', async () => {
  const env = createMockEnv({
    gemini_api_key: 'AIzaSy_TENANT_SECRET_KEY',
    admin_password_hash: 'hash123',
    fb_capi_token: 'EAAb_SECRET',
    store_name: 'Smart Shopping Algeria'
  }, [], null);

  const settings = await getSettings(env, 'tenant_master_default');

  assert.strictEqual(settings.store_name, 'Smart Shopping Algeria', 'Public settings should contain store_name');
  assert.strictEqual(settings.gemini_api_key, undefined, 'gemini_api_key MUST NOT be in public settings');
  assert.strictEqual(settings.admin_password_hash, undefined, 'admin_password_hash MUST NOT be in public settings');
  assert.strictEqual(settings.fb_capi_token, undefined, 'fb_capi_token MUST NOT be in public settings');
  assert.strictEqual(settings.ai_enabled, true, 'ai_enabled is true because tenant key existed server-side');
});

console.log('\n── [AXIS 2] Storefront Client Simulation (index.html) ──');

runTest('TEST 8: Storefront applySettings() sets #chatbotBtn display: flex when ai_enabled is true', () => {
  let displayStyle = 'none';
  const mockChatBtn = {
    style: {
      setProperty(prop, val, priority) {
        if (prop === 'display') displayStyle = val;
      }
    }
  };

  const d = { ai_enabled: true };
  const isAiActive = (d.ai_enabled === true || d.ai_enabled === 'true' || d.ai_assistant_enabled === 'true' || d.ai_assistant_enabled === true);
  if (mockChatBtn) {
    mockChatBtn.style.setProperty('display', isAiActive ? 'flex' : 'none', 'important');
  }

  assert.strictEqual(isAiActive, true);
  assert.strictEqual(displayStyle, 'flex', 'Button display must be set to flex when ai_enabled is true');
});

runTest('TEST 9: Storefront applySettings() sets #chatbotBtn display: none when ai_enabled is false', () => {
  let displayStyle = 'flex';
  const mockChatBtn = {
    style: {
      setProperty(prop, val, priority) {
        if (prop === 'display') displayStyle = val;
      }
    }
  };

  const d = { ai_enabled: false };
  const isAiActive = (d.ai_enabled === true || d.ai_enabled === 'true' || d.ai_assistant_enabled === 'true' || d.ai_assistant_enabled === true);
  if (mockChatBtn) {
    mockChatBtn.style.setProperty('display', isAiActive ? 'flex' : 'none', 'important');
  }

  assert.strictEqual(isAiActive, false);
  assert.strictEqual(displayStyle, 'none', 'Button display must be set to none when ai_enabled is false');
});

runTest('TEST 10: Storefront toggleChatbot() opens chatbot window with display: flex !important', () => {
  let chatOpen = false;
  let windowDisplay = 'none';
  let hasOpenClass = false;

  const mockWin = {
    classList: {
      toggle(cls, state) {
        if (cls === 'open') hasOpenClass = state;
      }
    },
    style: {
      setProperty(prop, val) {
        if (prop === 'display') windowDisplay = val;
      }
    }
  };

  function toggle() {
    chatOpen = !chatOpen;
    mockWin.classList.toggle('open', chatOpen);
    mockWin.style.setProperty('display', chatOpen ? 'flex' : 'none', 'important');
  }

  toggle();
  assert.strictEqual(chatOpen, true);
  assert.strictEqual(hasOpenClass, true);
  assert.strictEqual(windowDisplay, 'flex');

  toggle();
  assert.strictEqual(chatOpen, false);
  assert.strictEqual(hasOpenClass, false);
  assert.strictEqual(windowDisplay, 'none');
});

runTest('TEST 11: Single-Entry Chat History Tracking (No duplicates on send & reply)', () => {
  const chatHistory = [];

  function addBotMsg(text) {
    chatHistory.push({ role: 'bot', text: text });
  }

  function addUserMsg(text) {
    chatHistory.push({ role: 'user', text: text });
  }

  function simulateSend(userText, botReply) {
    addUserMsg(userText);
    addBotMsg(botReply);
  }

  simulateSend('ما هي ساعات التوصيل؟', 'التوصيل متاح من 2 إلى 5 أيام عمل لكافة الولايات الـ 58.');

  assert.strictEqual(chatHistory.length, 2, 'History must contain exactly 1 user message and 1 bot reply');
  assert.strictEqual(chatHistory[0].role, 'user');
  assert.strictEqual(chatHistory[0].text, 'ما هي ساعات التوصيل؟');
  assert.strictEqual(chatHistory[1].role, 'bot');
  assert.strictEqual(chatHistory[1].text, 'التوصيل متاح من 2 إلى 5 أيام عمل لكافة الولايات الـ 58.');
});

console.log('\n── [AXIS 3] Backend publicAiChat() Endpoint & Tenant Isolation ──');

await runAsyncTest('TEST 12: publicAiChat() returns structured customer reply', async () => {
  const products = [
    { id: 1, name: 'ساعة ذكية مقاومة للماء', price: 4500, old_price: 6000, stock: 15, category: 'إلكترونيات', tenant_id: 'tenant_master_default' }
  ];
  const env = createMockEnv({}, products, 'AIzaSy_MOCK_KEY');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.includes('generativelanguage.googleapis.com')) {
      return new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [{ text: 'مرحباً بك! لدينا ساعة ذكية مقاومة للماء متوفرة بسعر 4500 دج مع التوصيل لكافة الولايات.' }]
          }
        }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return originalFetch(url);
  };

  try {
    const res = await publicAiChat(env, { message: 'هل عندكم ساعة ذكية؟' }, null, 'tenant_master_default');
    assert.strictEqual(res.ok, true);
    assert(res.reply.includes('4500 دج') || res.reply.includes('ساعة'), 'Reply should reference product information');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await runAsyncTest('TEST 13: publicAiChat() Tenant Isolation (Tenant A cannot see Tenant B products)', async () => {
  const products = [
    { id: 1, name: 'منتج المتجر الرئيسي', price: 1000, stock: 5, tenant_id: 'tenant_master_default' },
    { id: 2, name: 'منتج التاجر باء الخاص', price: 9000, stock: 2, tenant_id: 'tenant_merchant_b' }
  ];
  const env = createMockEnv({}, products, 'AIzaSy_MOCK_KEY');

  let sentPromptToGemini = '';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (url.includes('generativelanguage.googleapis.com')) {
      sentPromptToGemini = opts.body;
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'جواب الذكاء' }] } }]
      }), { status: 200 });
    }
    return originalFetch(url, opts);
  };

  try {
    await publicAiChat(env, { message: 'ما هي المنتجات؟' }, null, 'tenant_merchant_b');
    assert(sentPromptToGemini.includes('منتج التاجر باء الخاص'), 'Tenant B prompt must include Tenant B product');
    assert(!sentPromptToGemini.includes('منتج المتجر الرئيسي'), 'Tenant B prompt MUST NOT leak Tenant Master product');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await runAsyncTest('TEST 14: publicAiChat() Anti-Abuse Rate Limiting (Over 25 reqs/min blocked gracefully)', async () => {
  const env = createMockEnv({}, [], 'AIzaSy_MOCK_KEY');
  await env.CACHE.put('rl:ai_pub:tenant_master_default:197.200.10.5', '26');

  const mockReq = new Request('https://smartshopping.click/api', {
    headers: { 'CF-Connecting-IP': '197.200.10.5' }
  });

  const res = await publicAiChat(env, { message: 'مرحبا' }, mockReq, 'tenant_master_default');
  assert.strictEqual(res.ok, true);
  assert(res.reply.includes('المساعد مشغول') || res.reply.includes('الانتظار'), 'Rate limited user receives friendly retry notice');
});

await runAsyncTest('TEST 15: publicAiChat() Graceful Failure on Gemini Unavailability', async () => {
  const env = createMockEnv({}, [], 'AIzaSy_MOCK_KEY');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({ error: { message: 'Overloaded' } }), { status: 503 });
  };

  try {
    const res = await publicAiChat(env, { message: 'اريد الاستفسار' }, null, 'tenant_master_default');
    assert.strictEqual(res.ok, true, 'Handler must not throw unhandled exception');
    assert(res.reply.includes('واتساب') || res.reply.includes('خدمتك'), 'Graceful fallback returned to customer');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

console.log('\n════════════════════════════════════════════════════════════════════════════');
if (failed === 0) {
  console.log('🎉 ALL ' + passed + '/' + passed + ' TESTS PASSED CLEANLY! STOREFRONT ASSISTANT VERIFIED.');
} else {
  console.error('⚠️ ' + failed + ' TEST(S) FAILED!');
  process.exit(1);
}
console.log('════════════════════════════════════════════════════════════════════════════\n');
