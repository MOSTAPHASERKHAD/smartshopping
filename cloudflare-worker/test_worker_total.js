import { createOrder } from './src/handlers/orders.js';

const mockEnv = {
  DB: {
    prepare: (query) => ({
      bind: (...args) => ({
        first: async () => {
          if (query.includes('FROM coupons')) return null;
          if (query.includes('FROM orders')) return null;
          if (query.includes('SELECT value FROM settings WHERE key = ? LIMIT 1')) return null;
          if (query.includes('last_insert_rowid')) return { 'last_insert_rowid()': 99 };
          return null;
        },
        all: async () => {
          if (query.includes('FROM products')) {
            return {
              results: [
                { id: 1, name: 'Product 1', price: 3000, active: 1, stock: 10 }
              ]
            };
          }
          if (query.includes('FROM settings WHERE key IN')) {
            return {
              results: [
                { key: 'shipping_home', value: '600' },
                { key: 'shipping_office', value: '400' },
                { key: 'shipping_remote', value: '200' }
              ]
            };
          }
          return { results: [] };
        },
        run: async () => ({ success: true })
      })
    })
  },
  META_API_TOKEN: 'fake_token',
  META_PIXEL_ID: '928523816193898'
};

const mockRequest = {
  headers: new Headers({
    'CF-Connecting-IP': '197.200.10.5',
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X)'
  })
};

const mockCtx = {
  waitUntil: (promise) => {
    promise.catch(e => console.error('Background task failed:', e));
  }
};

async function runTests() {
  console.log('--- TEST 1: Free Shipping (Hardcoded mock to 0) ---');
  // I will just mock a free shipping scenario by changing the wilaya and delivery type to something that is free if the mock was free, but our mock has home=600.
  // Wait, I can just not pass delivery_type to see what happens, or I can dynamically change the mock.
  
  // Let's dynamically change the mock Env for Free shipping test
  const freeMockEnv = JSON.parse(JSON.stringify(mockEnv)); // deep copy doesn't work for functions
  
  const createMock = (home, office, remote) => ({
    DB: {
      prepare: (query) => ({
        bind: (...args) => ({
          first: async () => {
            if (query.includes('last_insert_rowid')) return { 'last_insert_rowid()': 99 };
            return null;
          },
          all: async () => {
            if (query.includes('FROM products')) {
              return { results: [{ id: 1, name: 'Product 1', price: 3000, active: 1, stock: 10 }] };
            }
            if (query.includes('FROM settings WHERE key IN')) {
              return {
                results: [
                  { key: 'shipping_home', value: home.toString() },
                  { key: 'shipping_office', value: office.toString() },
                  { key: 'shipping_remote', value: remote.toString() }
                ]
              };
            }
            return { results: [] };
          },
          run: async () => ({ success: true })
        })
      })
    }
  });

  const envFree = createMock(0, 0, 0);
  const paramsFree = {
    name: 'Test Buyer', phone: '0555123456', items_json: JSON.stringify([{ id: 1, qty: 1 }]),
    wilaya_code: '16', delivery_type: 'Home'
  };
  const resFree = await createOrder(envFree, paramsFree, mockRequest, mockCtx, null, 1);
  console.log('Response (Free Shipping):', resFree);

  console.log('\n--- TEST 2: Shipping Office (Normal Wilaya) ---');
  const envOffice = createMock(600, 400, 200);
  const paramsOffice = {
    name: 'Test Buyer', phone: '0555123456', items_json: JSON.stringify([{ id: 1, qty: 1 }]),
    wilaya_code: '16', delivery_type: 'Office'
  };
  const resOffice = await createOrder(envOffice, paramsOffice, mockRequest, mockCtx, null, 1);
  console.log('Response (Office 400):', resOffice);

  console.log('\n--- TEST 3: Shipping Home (Remote Wilaya) ---');
  const paramsHomeRemote = {
    name: 'Test Buyer', phone: '0555123456', items_json: JSON.stringify([{ id: 1, qty: 1 }]),
    wilaya_code: '01', delivery_type: 'Home'
  };
  const resHomeRemote = await createOrder(envOffice, paramsHomeRemote, mockRequest, mockCtx, null, 1);
  console.log('Response (Home 600 + Remote 200 = 800):', resHomeRemote);
}

runTests().catch(console.error);
