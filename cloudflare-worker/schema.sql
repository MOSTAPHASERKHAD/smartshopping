-- ============================================================
-- Smart Shopping - Cloudflare D1 (SQLite) Database Schema
-- يُشغَّل مرة واحدة لإنشاء قاعدة البيانات
-- الأمر (local):  wrangler d1 execute smart-shopping-db --local --file=schema.sql
-- الأمر (remote): wrangler d1 execute smart-shopping-db --remote --file=schema.sql
-- ============================================================
-- ملاحظة: لا تُضَف PRAGMA هنا — Cloudflare D1 يُديرها داخلياً
-- (WAL mode مفعَّل افتراضياً، و foreign_keys تُطبَّق على مستوى الكود)

-- ─────────────────────────────────────────────────────────────
-- 1. جدول المنتجات (Catalog / Products)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  -- الوصف القصير الظاهر في بطاقة المنتج
  description     TEXT    DEFAULT '',
  -- وصف تفصيلي (HTML مسموح داخله للأدمن فقط)
  description_long TEXT   DEFAULT '',
  -- السعر الأصلي قبل الخصم (يُخزَّن بالدينار الجزائري بدون فواصل)
  price           REAL    NOT NULL CHECK(price >= 0),
  -- سعر ما بعد الخصم (NULL يعني لا يوجد خصم)
  price_old       REAL    DEFAULT NULL CHECK(price_old IS NULL OR price_old >= 0),
  -- رابط الصورة الرئيسية (CDN أو Google Drive أو Cloudflare Images)
  image_url       TEXT    DEFAULT '',
  -- مصفوفة JSON للصور الإضافية: ["url1","url2"]
  gallery_json    TEXT    DEFAULT '[]',
  -- خيارات المتغيرات (مقاسات/ألوان) بصيغة JSON:
  -- [{"label":"اللون","values":["أحمر","أزرق"]},{"label":"المقاس","values":["S","M","L"]}]
  variant_options TEXT    DEFAULT '[]',
  -- الفئة الرئيسية (للفلترة)
  category        TEXT    DEFAULT '',
  -- الكمية المتاحة (-1 = غير محدودة)
  stock           INTEGER DEFAULT -1,
  -- هل المنتج ظاهر للزوار؟
  active          INTEGER DEFAULT 1 CHECK(active IN (0,1)),
  -- ترتيب العرض (الأصغر أولاً)
  sort_order      INTEGER DEFAULT 0,
  -- وسوم (tags) بصيغة JSON: ["جديد","الأكثر مبيعاً"]
  tags_json       TEXT    DEFAULT '[]',
  -- SKU الخاص بالمنتج (للمستودع)
  sku             TEXT    DEFAULT '',
  created_at      TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at      TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ─────────────────────────────────────────────────────────────
-- 2. جدول الطلبات (Orders)
-- يعكس تماماً أعمدة Google Sheets القديمة لتسهيل النقل
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  -- معرّف الطلب (تنسيق: SK-YYYYMMDD-XXXX)
  order_id      TEXT    NOT NULL UNIQUE,
  created_at    TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

  -- ── بيانات الزبون ──
  name          TEXT    NOT NULL,
  phone         TEXT    NOT NULL,
  -- بيانات التوصيل
  wilaya_code   TEXT    DEFAULT '',
  wilaya_ar     TEXT    DEFAULT '',
  wilaya_en     TEXT    DEFAULT '',
  municipality  TEXT    DEFAULT '',
  -- 'home' | 'office' | 'pickup'
  delivery_type TEXT    DEFAULT 'home',

  -- ── محتوى الطلب ──
  -- مصفوفة JSON للعناصر المطلوبة:
  -- [{"id":1,"name":"منتج","qty":2,"price":1200,"variant":"أحمر / L"}]
  items_json    TEXT    NOT NULL DEFAULT '[]',
  subtotal      REAL    NOT NULL DEFAULT 0 CHECK(subtotal >= 0),
  -- سعر التوصيل (يُحدَّد لاحقاً من الأدمن)
  shipping_cost REAL    DEFAULT 0,
  -- مبلغ الخصم من كوبون (0 = لا يوجد)
  discount      REAL    DEFAULT 0,
  -- كود الكوبون المستخدم (إن وُجد)
  coupon_code   TEXT    DEFAULT '',

  -- ── حالة الطلب ──
  -- pending | confirmed | shipped | delivered | cancelled
  status        TEXT    DEFAULT 'pending'
                        CHECK(status IN ('pending','confirmed','shipped','delivered','cancelled')),
  -- ملاحظة الشحن (تُظهر للزبون عند التتبع)
  shipping_note TEXT    DEFAULT 'سعر التوصيل يُحدد بعد التأكيد',
  -- ملاحظة خاصة بالأدمن فقط
  admin_note    TEXT    DEFAULT '',
  -- ملاحظة الزبون
  notes         TEXT    DEFAULT '',

  -- ── تتبع الحملات الإعلانية (UTM) ──
  utm_source    TEXT    DEFAULT '',
  utm_medium    TEXT    DEFAULT '',
  utm_campaign  TEXT    DEFAULT ''
);

-- فهرس على رقم الهاتف للبحث السريع عن طلبات الزبون
CREATE INDEX IF NOT EXISTS idx_orders_phone      ON orders(phone);
-- فهرس على الحالة (لفلترة الأدمن)
CREATE INDEX IF NOT EXISTS idx_orders_status     ON orders(status);
-- فهرس على تاريخ الإنشاء (للترتيب التنازلي)
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);

-- ─────────────────────────────────────────────────────────────
-- 3. جدول الكوبونات (Coupons)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coupons (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  code            TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  -- نوع الخصم: 'percent' (نسبة مئوية) | 'fixed' (مبلغ ثابت)
  discount_type   TEXT    NOT NULL DEFAULT 'percent'
                          CHECK(discount_type IN ('percent','fixed')),
  -- قيمة الخصم (% أو DZD)
  discount_value  REAL    NOT NULL CHECK(discount_value > 0),
  -- الحد الأدنى للطلب لتفعيل الكوبون (0 = بدون حد)
  min_order       REAL    DEFAULT 0,
  -- الحد الأقصى لعدد مرات الاستخدام (0 = غير محدود)
  max_uses        INTEGER DEFAULT 0,
  -- عداد الاستخدام الفعلي
  used_count      INTEGER DEFAULT 0,
  -- تاريخ انتهاء الصلاحية (ISO 8601 أو NULL = لا ينتهي)
  expires_at      TEXT    DEFAULT NULL,
  active          INTEGER DEFAULT 1 CHECK(active IN (0,1)),
  created_at      TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ─────────────────────────────────────────────────────────────
-- 4. جدول الإعدادات (Settings)
-- نموذج مفتاح/قيمة مرن يستبدل Settings sheet
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT DEFAULT '',
  -- وصف اختياري للمساعدة في لوحة التحكم
  description TEXT DEFAULT '',
  updated_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- إعدادات افتراضية للمتجر
INSERT OR IGNORE INTO settings (key, value, description) VALUES
  ('store_name',        'Smart Shopping',         'اسم المتجر'),
  ('store_logo',        '',                        'رابط شعار المتجر'),
  ('store_currency',    'DZD',                     'عملة المتجر'),
  ('store_phone',       '',                        'رقم هاتف التواصل'),
  ('store_address',     '',                        'عنوان المتجر'),
  ('whatsapp_number',   '',                        'رقم واتساب للطلبات'),
  ('delivery_price',    '0',                       'سعر التوصيل الافتراضي'),
  ('free_delivery_min', '0',                       'حد الشحن المجاني (0=لا يوجد)'),
  ('pixel_id',          '',                        'Facebook Pixel ID'),
  ('fb_capi_token',     '',                        'Facebook CAPI Token (سري - لا يُرسَل للعميل)'),
  ('capi_enabled',      'false',                   'تفعيل Facebook CAPI'),
  ('gemini_api_key',    '',                        'مفتاح Gemini AI (سري)'),
  ('admin_password_hash','',                       'هاش SHA-256 لكلمة مرور الأدمن'),
  ('admin_recovery_hash','',                       'هاش كود الاسترداد'),
  ('theme_default',     'default',                 'اسم الثيم النشط'),
  ('seo_title',         'Smart Shopping',          'عنوان الصفحة الرئيسية'),
  ('seo_description',   '',                        'وصف SEO للمتجر'),
  ('maintenance_mode',  'false',                   'وضع الصيانة');

-- ─────────────────────────────────────────────────────────────
-- 5. جدول الشهادات/التقييمات (Testimonials)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS testimonials (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  -- اسم صاحب الشهادة
  author_name TEXT    NOT NULL,
  -- مدينته/منطقته
  author_location TEXT DEFAULT '',
  -- نص الشهادة
  content     TEXT    NOT NULL,
  -- تقييم من 1 إلى 5 نجوم
  rating      INTEGER DEFAULT 5 CHECK(rating BETWEEN 1 AND 5),
  -- رابط صورة المراجع (اختياري)
  avatar_url  TEXT    DEFAULT '',
  -- هل تظهر للزوار؟ (الأدمن يتحكم)
  active      INTEGER DEFAULT 1 CHECK(active IN (0,1)),
  sort_order  INTEGER DEFAULT 0,
  created_at  TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ─────────────────────────────────────────────────────────────
-- 6. جدول تقييمات المنتجات (Product Reviews)
-- تقييمات يكتبها الزبائن على منتجات محددة
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  -- ربط التقييم بالمنتج
  product_id  INTEGER REFERENCES products(id) ON DELETE CASCADE,
  author_name TEXT    NOT NULL,
  author_phone TEXT   DEFAULT '',
  content     TEXT    NOT NULL,
  rating      INTEGER DEFAULT 5 CHECK(rating BETWEEN 1 AND 5),
  -- رابط صورة إثبات الشراء (اختياري)
  image_url   TEXT    DEFAULT '',
  -- pending | approved | rejected
  status      TEXT    DEFAULT 'pending'
                      CHECK(status IN ('pending','approved','rejected')),
  created_at  TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_status  ON reviews(status);

-- ─────────────────────────────────────────────────────────────
-- 7. جدول الصفحات المخصصة (Custom Pages)
-- للسياسة الخاصة / الشروط / من نحن وما شابه
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  -- slug فريد للرابط مثل: about | privacy | terms
  slug        TEXT    NOT NULL UNIQUE,
  title       TEXT    NOT NULL,
  -- محتوى HTML (يُعقَّم قبل الحفظ)
  content     TEXT    DEFAULT '',
  active      INTEGER DEFAULT 1 CHECK(active IN (0,1)),
  updated_at  TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ─────────────────────────────────────────────────────────────
-- 8. جدول المشتركين في النشرة البريدية (Newsletter Subscribers)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscribers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  phone      TEXT    NOT NULL UNIQUE,
  name       TEXT    DEFAULT '',
  active     INTEGER DEFAULT 1,
  created_at TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ─────────────────────────────────────────────────────────────
-- 9. جدول جلسات الأدمن (Admin Sessions)
-- يحل محل PropertiesService.getProperty لتخزين الـ tokens
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_sessions (
  token      TEXT    PRIMARY KEY,
  -- وقت انتهاء الجلسة (Unix timestamp بالميلي ثانية)
  expires_at INTEGER NOT NULL,
  created_at TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
