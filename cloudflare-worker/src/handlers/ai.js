/**
 * [ADMIN] مساعد الذكاء الاصطناعي في لوحة التحكم
 * يعتمد على مفتاح Gemini الموجود في المتغيرات البيئية (env.GEMINI_API_KEY)
 */
export async function adminAiChat(env, params) {
  const prompt = params.prompt || params.message;
  if (!prompt) return { ok: false, error: 'الرسالة مطلوبة' };

  if (!env.GEMINI_API_KEY) {
    return { ok: false, error: 'مفتاح GEMINI_API_KEY غير مكوّن في المتغيرات البيئية' };
  }

  // Rate Limiting بسيط للأدمن (مثلاً 50 طلب في الساعة) يمكن تنفيذه لاحقاً
  // في Cloudflare يمكن استخدام Rate Limiting API

  const payload = {
    contents: [
      {
        parts: [
          { text: prompt }
        ]
      }
    ]
  };

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`;
    
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const json = await res.json();

    if (!res.ok) {
      console.error('Gemini API Error:', json);
      return { ok: false, error: 'حدث خطأ أثناء التواصل مع الذكاء الاصطناعي' };
    }

    const reply = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    return { ok: true, reply };
  } catch (err) {
    return { ok: false, error: 'خطأ داخلي في الذكاء الاصطناعي' };
  }
}
