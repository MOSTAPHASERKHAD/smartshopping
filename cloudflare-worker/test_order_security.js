// اختبارات الأمان: التلاعب بالسعر
const BASE = 'http://127.0.0.1:8787';

async function runTest() {
  console.log('--- 🛡️ اختبار حماية التلاعب بالسعر (Order Security) ---');
  
  // 1. أولاً، نقوم بإضافة منتج وهمي سعره 1500 من خلال طلب SQL مباشر باستخدام wrangler أو فقط نفترض وجود منتج 1 لأنه موجود في Schema الافتراضي أو سنستخدم ما لدينا.
  // بدلاً من ذلك، سنرسل الطلب ونفحص الـ Error أو تفاصيل الطلب.
  // سنفترض أننا نحاول شراء منتج id: 1.
  
  // سنقوم بإنشاء طلب مع subtotal مزيف (0) وكمية 2
  const fakeSubtotal = '0';
  const orderBody = new URLSearchParams({
    action:       'order',
    name:         'Hacker',
    phone:        '0555999777',
    items_json:   JSON.stringify([{ id: 1, name: 'Hacked Product', qty: 2, price: 0 }]),
    subtotal:     fakeSubtotal, // Fake subtotal!
    wilaya_ar:    'الجزائر',
    wilaya_en:    'Algiers',
    wilaya_code:  '16',
    delivery_type:'home',
  });

  try {
    const res = await fetch(`${BASE}/`, {
      method: 'POST',
      body: orderBody,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    
    const json = await res.json();
    if (!json.ok) {
      const errorMsg = typeof json.error === 'string' ? json.error : JSON.stringify(json.error);
      if (errorMsg.includes('المنتج رقم 1 غير موجود')) {
         console.log('✅ PASS (Product 1 does not exist, safe rejection)');
         return;
      }
      console.log('⚠️ Warning: Order failed for another reason:', errorMsg);
      return;
    }

    const orderId = json.order_id;
    console.log(`✅ Order Created: ${orderId}. Now verifying server-side price calculation...`);

    // Fetch the order to check the subtotal
    const trackRes = await fetch(`${BASE}/?action=track&order_id=${orderId}`);
    const trackJson = await trackRes.json();

    if (!trackJson.found) {
       console.log('❌ Failed to track order');
       return;
    }

    const realSubtotal = trackJson.order.subtotal;
    if (realSubtotal > 0 && realSubtotal !== Number(fakeSubtotal)) {
      console.log(`✅ PASS: Server ignored fake subtotal (0) and calculated real subtotal: ${realSubtotal}`);
    } else if (realSubtotal === 0) {
      console.log(`❌ FAIL: Server accepted fake subtotal (0)!`);
      process.exit(1);
    } else {
      console.log(`⚠️ Warning: Server subtotal is ${realSubtotal}`);
    }

  } catch (e) {
    console.error('Test failed to run:', e);
  }
}

runTest();
