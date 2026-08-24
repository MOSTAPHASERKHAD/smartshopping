/**
 * Smart Shopping — Cloudflare Worker
 * ملف: src/utils/gemini_resolver.js
 * 
 * 🤖 GeminiModelResolver
 * ─────────────────────────────────────────────────────────────
 * • اكتشاف النماذج المتاحة ديناميكياً عبر GET /v1beta/models?key=...
 * • التحقق من دعم generateContent وتوافقها مع الـ Structured Output / JSON
 * • ترتيب النماذج ديناميكياً حسب القدرات والسرعة والحداثة
 * • Caching لقائمة النماذج في الذاكرة و KV لتقليل استدعاءات Discovery
 * • تتبع صحة النماذج وإخفاقاتها (Health & Failure tracking with cooldown)
 * • Automatic Failover للنموذج التالي فوراً عند فشل النموذج الحالي لأسباب قابلة للمحاولة
 * • إعادة الاكتشاف (Rediscovery) عند ظهور خطأ Model Not Found أو انتهاء الـ Cache
 * • الأمان التام: عدم كشف المفاتيح أو نصوصها في السجلات أو الرسائل
 */

// قائمة النماذج الاحتياطية المضمونة في حال تعذر الوصول لواجهة الاكتشاف
export const DEFAULT_FALLBACK_MODELS = [
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-pro'
];

// ذاكرة التخزين المؤقت المحلية للـ Worker
const inMemoryCache = {
  models: null,
  cachedAt: 0,
  ttlMs: 6 * 60 * 60 * 1000 // 6 ساعات
};

// تتبع صحة النماذج (Model Health Map)
const modelHealthMap = new Map();

/**
 * تقييم أولوية النموذج بناءً على اسمه ومميزاته
 */
function calculateModelScore(modelName, modelObj = {}) {
  const name = String(modelName || '').toLowerCase().replace(/^models\//, '');

  // استبعاد النماذج غير المخصصة للمحادثة وتوليد النصوص المهيكلة
  if (name.includes('embedding') || name.includes('aqa') || name.includes('imagen') || name.includes('tts')) {
    return -1000;
  }

  let score = 0;

  // تفضيل نماذج 2.x
  if (name.includes('gemini-2.5') || name.includes('2.5-flash')) score += 1000;
  else if (name.includes('gemini-2.0') || name.includes('2.0-flash')) score += 800;
  else if (name.includes('gemini-1.5-flash')) score += 600;
  else if (name.includes('gemini-1.5-pro')) score += 500;
  else if (name.includes('gemini-1.0-pro') || name === 'gemini-pro') score += 200;
  else if (name.startsWith('gemini')) score += 100;

  // تفضيل نماذج Flash للسرعة والاستجابة اللحظية في لوحة الإدارة
  if (name.includes('flash')) score += 150;
  if (name.includes('latest')) score += 50;

  // تخفيض نماذج التجريبية غير المستقرة قليلاً
  if (name.includes('exp') || name.includes('experimental')) score -= 30;

  return score;
}

export class GeminiModelResolver {
  constructor(env = {}) {
    this.env = env;
  }

  /**
   * تسجيل نجاح النموذج وإعادة تعيين عداد الإخفاق
   */
  recordSuccess(modelName) {
    const cleanName = String(modelName).replace(/^models\//, '');
    modelHealthMap.set(cleanName, {
      failures: 0,
      lastFailedAt: 0,
      cooldownUntil: 0
    });
  }

  /**
   * تسجيل إخفاق النموذج وتفعيل فترة التهدئة (Cooldown)
   */
  recordFailure(modelName, statusCode = 0) {
    const cleanName = String(modelName).replace(/^models\//, '');
    const current = modelHealthMap.get(cleanName) || { failures: 0, lastFailedAt: 0, cooldownUntil: 0 };
    const newFailures = current.failures + 1;
    
    // فترة التهدئة تتصاعد بناءً على عدد الإخفاقات (30 ثانية إلى 5 دقائق)
    const cooldownDuration = Math.min(300000, 30000 * Math.pow(2, newFailures - 1));
    const cooldownUntil = Date.now() + cooldownDuration;

    modelHealthMap.set(cleanName, {
      failures: newFailures,
      lastFailedAt: Date.now(),
      cooldownUntil: cooldownUntil,
      lastStatus: statusCode
    });

    console.warn(`[GeminiModelResolver] Model ${cleanName} failed (status ${statusCode}). Cooldown active for ${Math.round(cooldownDuration / 1000)}s.`);
  }

  /**
   * التحقق مما إذا كان النموذج في فترة تهدئة
   */
  isModelInCooldown(modelName) {
    const cleanName = String(modelName).replace(/^models\//, '');
    const record = modelHealthMap.get(cleanName);
    if (!record) return false;
    return Date.now() < (record.cooldownUntil || 0);
  }

  /**
   * إبطال الـ Cache لإجبار النظام على إعادة الاكتشاف
   */
  invalidateCache() {
    inMemoryCache.models = null;
    inMemoryCache.cachedAt = 0;
  }

  /**
   * اكتشاف وترتيب النماذج المتاحة ديناميكياً
   */
  async getPrioritizedModels(apiKey, forceRefresh = false) {
    const now = Date.now();

    // 1. فحص الـ Memory Cache
    if (!forceRefresh && inMemoryCache.models && (now - inMemoryCache.cachedAt) < inMemoryCache.ttlMs) {
      return this.filterHealthyModels(inMemoryCache.models);
    }

    // 2. فحص KV Cache إن وجد
    if (!forceRefresh && this.env?.CACHE) {
      try {
        const cachedRaw = await this.env.CACHE.get('gemini_discovered_models', 'json');
        if (cachedRaw && Array.isArray(cachedRaw.models) && cachedRaw.models.length > 0) {
          inMemoryCache.models = cachedRaw.models;
          inMemoryCache.cachedAt = cachedRaw.cachedAt || now;
          return this.filterHealthyModels(cachedRaw.models);
        }
      } catch (_) {}
    }

    // 3. الاتصال بـ Google API لجلب النماذج المتاحة فعلياً
    let discoveredList = [];

    try {
      const discoveryUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout for discovery

      const res = await fetch(discoveryUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (res.ok) {
        const json = await res.json();
        const rawModels = Array.isArray(json.models) ? json.models : [];

        // فلترة النماذج التي تدعم generateContent
        const validCandidates = rawModels.filter(m => {
          const methods = Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
          return methods.includes('generateContent');
        });

        // ترتيب النماذج وفق نقاط الكفاءة
        const scoredModels = validCandidates.map(m => {
          const cleanName = String(m.name || '').replace(/^models\//, '');
          return {
            name: cleanName,
            score: calculateModelScore(cleanName, m)
          };
        }).filter(m => m.score > 0);

        scoredModels.sort((a, b) => b.score - a.score);
        discoveredList = scoredModels.map(m => m.name);
      } else {
        console.warn(`[GeminiModelResolver Discovery Warning] Endpoint returned status ${res.status}`);
      }
    } catch (discErr) {
      console.warn('[GeminiModelResolver Discovery Exception]', discErr?.message);
    }

    // 4. الدمج مع القائمة الاحتياطية لضمان عدم بقاء القائمة فارغة
    const mergedSet = new Set([...discoveredList, ...DEFAULT_FALLBACK_MODELS]);
    const finalModels = Array.from(mergedSet);

    // تحديث الـ Cache
    inMemoryCache.models = finalModels;
    inMemoryCache.cachedAt = now;

    if (this.env?.CACHE) {
      try {
        await this.env.CACHE.put('gemini_discovered_models', JSON.stringify({
          models: finalModels,
          cachedAt: now
        }), { expirationTtl: 21600 }); // 6 hours
      } catch (_) {}
    }

    return this.filterHealthyModels(finalModels);
  }

  /**
   * فلترة النماذج وتفضيل السليمة مع إبقاء النماذج في فترة التهدئة في ذيل القائمة كاحتياط أخير
   */
  filterHealthyModels(modelsList) {
    const healthy = [];
    const inCooldown = [];

    modelsList.forEach(m => {
      if (this.isModelInCooldown(m)) {
        inCooldown.push(m);
      } else {
        healthy.push(m);
      }
    });

    // السليمة أولاً، ثم التي في فترة التهدئة إن لزم
    return [...healthy, ...inCooldown];
  }

  /**
   * تنفيذ طلب توليد المحتوى مع التبديل التلقائي (Automatic Failover)
   */
  async generateContentWithFailover(apiKey, promptPayload, options = {}) {
    const timeoutMs = options.timeoutMs || 20000;
    const candidateModels = await this.getPrioritizedModels(apiKey, Boolean(options.forceRefresh));

    if (candidateModels.length === 0) {
      candidateModels.push(...DEFAULT_FALLBACK_MODELS);
    }

    let lastError = null;
    let attemptedModels = [];

    for (const model of candidateModels) {
      attemptedModels.push(model);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(promptPayload),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        const json = await res.json();

        // نجاح الطلب
        if (res.ok) {
          this.recordSuccess(model);
          const rawReply = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          return {
            ok: true,
            model_used: model,
            reply: rawReply,
            raw_response: json
          };
        }

        // معالجة الأخطاء
        const status = res.status;
        const errMsg = json?.error?.message || `HTTP ${status}`;
        lastError = errMsg;

        // إذا كان الخطأ 404 (Model Not Found / Deprecated)
        if (status === 404) {
          console.warn(`[Gemini Failover] Model ${model} not found (404). Invalidating cache and failing over.`);
          this.recordFailure(model, 404);
          this.invalidateCache();
          continue; // الانتقال للنموذج التالي فوراً
        }

        // إذا كان الخطأ 429 (Rate Limit / Quota) أو 500 / 503 (Server Error)
        if (status === 429 || status >= 500) {
          console.warn(`[Gemini Failover] Model ${model} returned ${status} (${errMsg}). Failing over to next candidate.`);
          this.recordFailure(model, status);
          continue; // الانتقال للنموذج التالي فوراً
        }

        // إذا كان الخطأ 400 بسبب عدم دعم ميزة معينة في النموذج (مثل JSON mode)
        if (status === 400 && (errMsg.includes('not supported') || errMsg.includes('format') || errMsg.includes('responseMimeType'))) {
          console.warn(`[Gemini Failover] Model ${model} rejected generation config: ${errMsg}. Trying next candidate.`);
          this.recordFailure(model, 400);
          continue;
        }

        // أخطاء التوثيق القاتلة (مفتاح خاطئ 401 / 403) لا فائدة من تكرارها
        if (status === 401 || status === 403) {
          return {
            ok: false,
            error: 'مفتاح Gemini غير صالح أو منتهي الصلاحية (يرجى مراجعة إعدادات المفتاح).'
          };
        }

        // أي خطأ آخر غير قابل للتجاوز
        console.warn(`[Gemini Failover] Model ${model} failed with non-retryable status ${status}: ${errMsg}`);
        this.recordFailure(model, status);

      } catch (fetchErr) {
        if (fetchErr.name === 'AbortError') {
          console.warn(`[Gemini Failover] Model ${model} timed out after ${timeoutMs}ms. Failing over.`);
          this.recordFailure(model, 408);
          continue;
        }

        console.warn(`[Gemini Failover] Network exception on model ${model}:`, fetchErr?.message);
        this.recordFailure(model, 599);
        continue;
      }
    }

    // إذا فشلت كافة النماذج
    return {
      ok: false,
      error: `تعذر تشغيل المساعد الذكي بعد محاولة النماذج المتاحة (${attemptedModels.join(', ')}).`,
      last_error: lastError
    };
  }
}
