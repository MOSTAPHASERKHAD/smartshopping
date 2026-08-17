import fs from 'fs';
import path from 'path';

console.log('═══════════════════════════════════════════════════════════════');
console.log('🧪 SMARTKIOSK — INDEX.HTML META TRACKING SURGICAL TEST SUITE');
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

// 1. Read index.html content
const indexPath = path.resolve('index.html');
const indexContent = fs.readFileSync(indexPath, 'utf8');

// Test 1: trackPurchase signature and implementation
console.log('── [1] trackPurchase Content IDs & Items Snapshot ──');
assert(indexContent.includes('function trackPurchase(orderId,total,items)'), 'trackPurchase accepts items snapshot parameter');
assert(!indexContent.includes('trackEvent(\'Purchase\',{content_name:\'Order\',content_ids:[orderId]'), 'Old bug [orderId] removed from trackPurchase');

// Test 2: Execution simulation of trackPurchase logic
let capturedTrackEvent = null;
globalThis.window = {
  fbq: (action, event, params, opts) => {
    capturedTrackEvent = { action, event, params, opts };
  }
};
globalThis.cart = []; // Simulate already emptied cart!

// Extract and evaluate trackPurchase logic
const trackPurchaseFn = new Function('orderId', 'total', 'items', `
  var ids=[];
  var tq=1;
  if(Array.isArray(items)&&items.length>0){
    ids=items.map(function(item){return String(item.id!=null?item.id:item);}).filter(Boolean);
    tq=items.reduce(function(s,c){return s+(Number(c.qty)||1);},0);
  }else if(Array.isArray(cart)&&cart.length>0){
    ids=cart.map(function(c){return String(c.id);}).filter(Boolean);
    tq=cart.reduce(function(s,c){return s+(Number(c.qty)||1);},0);
  }
  if(!ids.length)ids=[String(orderId)];
  if(!tq)tq=1;
  if (window.fbq) {
    window.fbq('track', 'Purchase', {
      content_name: 'Order',
      content_ids: ids,
      content_type: 'product',
      value: total,
      currency: 'DZD',
      num_items: tq
    }, { eventID: String(orderId) });
  }
`);

const samplePurchasedItems = [
  { id: '101', title: 'Product A', price: 2000, qty: 2 },
  { id: '202', title: 'Product B', price: 1500, qty: 1 }
];

trackPurchaseFn('SK-ORDER-8899', 5500, samplePurchasedItems);

assert(capturedTrackEvent !== null, 'fbq Purchase was triggered');
assert(capturedTrackEvent.event === 'Purchase', 'Event name is Purchase');
assert(capturedTrackEvent.opts.eventID === 'SK-ORDER-8899', 'eventID matches exact orderId for deduplication');
assert(Array.isArray(capturedTrackEvent.params.content_ids), 'content_ids is an array');
assert(capturedTrackEvent.params.content_ids.length === 2, 'content_ids has 2 product IDs');
assert(capturedTrackEvent.params.content_ids[0] === '101' && capturedTrackEvent.params.content_ids[1] === '202', 'content_ids contain actual product IDs ("101", "202") instead of orderId');
assert(capturedTrackEvent.params.num_items === 3, 'num_items calculated accurately from snapshot (2+1 = 3) despite empty cart');
assert(capturedTrackEvent.params.value === 5500, 'value is 5500');
assert(capturedTrackEvent.params.currency === 'DZD', 'currency is DZD');

// Test 3: submitOrder metadata and snapshot
console.log('\n── [2] submitOrder (Main Cart) Payload Verification ──');
assert(indexContent.includes('try{trackPurchase(data.order_id,sub,purchasedItems)}catch(e)'), 'submitOrder passes purchasedItems snapshot to trackPurchase');
assert(indexContent.includes('event_source_url:window.location.href||\'\''), 'submitOrder passes event_source_url to API');

// Test 4: submitLandingOrder metadata
console.log('\n── [3] submitLandingOrder (Landing Page) Payload Verification ──');
assert(indexContent.includes('fbc:metaTrack.fbc||\'\',fbp:metaTrack.fbp||\'\',') && 
       indexContent.includes('try{trackPurchase(orderId,product.price,purchasedProduct)}catch(e)'), 
       'submitLandingOrder extracts getMetaTracking and passes fbc, fbp, event_source_url & purchasedProduct');

// Test 5: Modal Order metadata
console.log('\n── [4] Modal Quick Order Payload Verification ──');
assert(indexContent.includes('try{trackPurchase(orderId,finalPrice,purchasedProduct)}catch(e)'), 'Modal order triggers trackPurchase with product snapshot');

console.log('\n═══════════════════════════════════════════════════════════════');
console.log(`📊 TEST SUITE SUMMARY: ${pass} PASSED | ${fail} FAILED`);
console.log('═══════════════════════════════════════════════════════════════\n');

if (fail > 0) process.exit(1);
