const BASE = 'http://127.0.0.1:8787';

// 1x1 GIF (Transparent)
const gifBase64 = 'R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
// Invalid File (Text)
const textBase64 = Buffer.from('Hello World').toString('base64');

async function testUploads() {
  console.log('--- ☁️ اختبار الرفع (Uploads) ---');

  console.log('\n[1] Upload Valid Image (GIF)');
  const uploadBody = new URLSearchParams({
    action: 'upload_image',
    data: gifBase64
  });
  
  const res1 = await fetch(`${BASE}/`, { method: 'POST', body: uploadBody });
  const json1 = await res1.json();
  if (json1.ok && json1.url) {
    console.log('✅ PASS: Image uploaded successfully. URL:', json1.url);
  } else {
    console.log('❌ FAIL: Upload failed:', json1);
    process.exit(1);
  }

  console.log('\n[2] Upload Invalid Image (Magic Bytes Check)');
  const uploadBody2 = new URLSearchParams({
    action: 'upload_image',
    data: textBase64
  });
  
  const res2 = await fetch(`${BASE}/`, { method: 'POST', body: uploadBody2 });
  const json2 = await res2.json();
  if (!json2.ok && json2.error.includes('نوع الملف غير مدعوم')) {
    console.log('✅ PASS: Invalid image rejected correctly.');
  } else {
    console.log('❌ FAIL: Invalid image was not rejected correctly:', json2);
    process.exit(1);
  }
}

testUploads().catch(console.error);
