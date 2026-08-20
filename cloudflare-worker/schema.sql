-- ============================================================
-- Smart Shopping - Cloudflare D1 (SQLite) Database Schema
-- Multi-Tenant SaaS & RBAC Architecture
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 0.1 جدول المتاجر والتجار (Tenants)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  domain      TEXT DEFAULT NULL UNIQUE,
  status      TEXT DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'archived')),
  plan        TEXT DEFAULT 'master' CHECK(plan IN ('master', 'starter', 'pro', 'enterprise')),
  created_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Master Tenant الافتراضي
INSERT OR IGNORE INTO tenants (id, name, slug, domain, status, plan)
VALUES ('tenant_master_default', 'Smart Shopping Master', 'main', 'smartshopping.click', 'active', 'master');

-- ─────────────────────────────────────────────────────────────
-- 0.2 جدول المستخدمين والتجار (Users)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email               TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name                TEXT DEFAULT '',
  password_hash       TEXT NOT NULL,
  role                TEXT NOT NULL DEFAULT 'OWNER' CHECK(role IN ('OWNER', 'ADMIN', 'ORDER_MANAGER', 'SUPPORT', 'VIEWER')),
  status              TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'suspended', 'pending_verification')),
  email_verified_at   TEXT DEFAULT NULL,
  password_changed_at TEXT DEFAULT NULL,
  last_login_at       TEXT DEFAULT NULL,
  created_at          TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at          TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ─────────────────────────────────────────────────────────────
-- 0.3 جدول الجلسات الموحدة والمشفرة (Sessions)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  token_hash    TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role          TEXT NOT NULL,
  expires_at    INTEGER NOT NULL,
  created_at    TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  last_seen_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  revoked_at    TEXT DEFAULT NULL,
  revoke_reason TEXT DEFAULT NULL
);

-- ─────────────────────────────────────────────────────────────
-- 0.4 جدول رموز استعادة كلمة المرور (Password Reset Tokens)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  INTEGER NOT NULL,
  used_at     TEXT DEFAULT NULL,
  created_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_reset_tokens_hash ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_reset_tokens_user ON password_reset_tokens(user_id);

-- ─────────────────────────────────────────────────────────────
-- 0.5 جدول رموز تأكيد البريد الإلكتروني (Email Verification Tokens)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  INTEGER NOT NULL,
  used_at     TEXT DEFAULT NULL,
  created_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_verify_tokens_hash ON email_verification_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_verify_tokens_user ON email_verification_tokens(user_id);

-- ─────────────────────────────────────────────────────────────
-- 0.6 جدول سجل التدقيق الأمني (Audit Logs)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL,
  user_id       TEXT DEFAULT NULL,
  action        TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id   TEXT DEFAULT NULL,
  ip_hash       TEXT DEFAULT '',
  user_agent    TEXT DEFAULT '',
  metadata_json TEXT DEFAULT '{}',
  created_at    TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ─────────────────────────────────────────────────────────────
-- 1. جدول المنتجات (Catalog / Products)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id       TEXT    DEFAULT 'tenant_master_default' REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT    NOT NULL,
  description     TEXT    DEFAULT '',
  description_long TEXT   DEFAULT '',
  price           REAL    NOT NULL CHECK(price >= 0),
  price_old       REAL    DEFAULT NULL CHECK(price_old IS NULL OR price_old >= 0),
  image_url       TEXT    DEFAULT '',
  gallery_json    TEXT    DEFAULT '[]',
  variant_options TEXT    DEFAULT '[]',
  category        TEXT    DEFAULT '',
  stock           INTEGER DEFAULT -1,
  active          INTEGER DEFAULT 1 CHECK(active IN (0,1)),
  sort_order      INTEGER DEFAULT 0,
  landing_config_json TEXT    DEFAULT '{}',
  tags_json       TEXT    DEFAULT '[]',
  sku             TEXT    DEFAULT '',
  weight          REAL    DEFAULT NULL,
  created_at      TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at      TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ─────────────────────────────────────────────────────────────
-- 2. جدول الطلبات (Orders)
-- يعكس تماماً أعمدة Google Sheets القديمة لتسهيل النقل
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT    DEFAULT 'tenant_master_default' REFERENCES tenants(id) ON DELETE CASCADE,
  order_id      TEXT    NOT NULL UNIQUE,
  created_at    TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  name          TEXT    NOT NULL,
  phone         TEXT    NOT NULL,
  wilaya_code   TEXT    DEFAULT '',
  wilaya_ar     TEXT    DEFAULT '',
  wilaya_en     TEXT    DEFAULT '',
  municipality  TEXT    DEFAULT '',
  delivery_type TEXT    DEFAULT 'home',
  items_json    TEXT    NOT NULL DEFAULT '[]',
  subtotal      REAL    NOT NULL DEFAULT 0 CHECK(subtotal >= 0),
  shipping_cost REAL    DEFAULT 0,
  discount      REAL    DEFAULT 0,
  coupon_code   TEXT    DEFAULT '',
  status        TEXT    DEFAULT 'pending'
                        CHECK(status IN ('pending','confirmed','shipped','delivered','cancelled')),
  shipping_note TEXT    DEFAULT 'سعر التوصيل يُحدد بعد التأكيد',
  admin_note    TEXT    DEFAULT '',
  notes         TEXT    DEFAULT '',
  utm_source    TEXT    DEFAULT '',
  utm_medium    TEXT    DEFAULT '',
  utm_campaign  TEXT    DEFAULT '',
  utm_term      TEXT    DEFAULT '',
  utm_content   TEXT    DEFAULT '',
  fbclid        TEXT    DEFAULT '',
  session_id    TEXT    DEFAULT '',
  customer_id   INTEGER REFERENCES customers(id),
  delivery_company TEXT DEFAULT 'yalidine',
  tracking_code    TEXT DEFAULT '',
  stock_decremented INTEGER DEFAULT 0,
  stock_processed_at TEXT    DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_phone      ON orders(phone);
CREATE INDEX IF NOT EXISTS idx_orders_status     ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_tenant     ON orders(tenant_id, status, created_at DESC);

-- ─────────────────────────────────────────────────────────────
-- 3. جدول الكوبونات (Coupons)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coupons (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id       TEXT    DEFAULT 'tenant_master_default' REFERENCES tenants(id) ON DELETE CASCADE,
  code            TEXT    NOT NULL COLLATE NOCASE,
  discount_type   TEXT    NOT NULL DEFAULT 'percent'
                          CHECK(discount_type IN ('percent','fixed')),
  discount_value  REAL    NOT NULL CHECK(discount_value > 0),
  min_order       REAL    DEFAULT 0,
  max_uses        INTEGER DEFAULT 0,
  used_count      INTEGER DEFAULT 0,
  expires_at      TEXT    DEFAULT NULL,
  active          INTEGER DEFAULT 1 CHECK(active IN (0,1)),
  created_at      TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_coupons_tenant ON coupons(tenant_id, active);

-- ─────────────────────────────────────────────────────────────
-- 4. جدول الإعدادات (Settings)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  tenant_id   TEXT DEFAULT 'tenant_master_default' REFERENCES tenants(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       TEXT DEFAULT '',
  description TEXT DEFAULT '',
  updated_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (tenant_id, key)
);

-- إعدادات افتراضية للمتجر Master
INSERT OR IGNORE INTO settings (tenant_id, key, value, description) VALUES
  ('tenant_master_default', 'store_name',        'Smart Shopping',         'اسم المتجر'),
  ('tenant_master_default', 'store_logo',        '',                        'رابط شعار المتجر'),
  ('tenant_master_default', 'store_currency',    'DZD',                     'عملة المتجر'),
  ('tenant_master_default', 'store_phone',       '',                        'رقم هاتف التواصل'),
  ('tenant_master_default', 'store_address',     '',                        'عنوان المتجر'),
  ('tenant_master_default', 'whatsapp_number',   '',                        'رقم واتساب للطلبات'),
  ('tenant_master_default', 'delivery_price',    '0',                       'سعر التوصيل الافتراضي'),
  ('tenant_master_default', 'free_delivery_min', '0',                       'حد الشحن المجاني (0=لا يوجد)'),
  ('tenant_master_default', 'pixel_id',          '',                        'Facebook Pixel ID'),
  ('tenant_master_default', 'fb_capi_token',     '',                        'Facebook CAPI Token (سري - لا يُرسَل للعميل)'),
  ('tenant_master_default', 'capi_enabled',      'false',                   'تفعيل Facebook CAPI'),
  ('tenant_master_default', 'gemini_api_key',    '',                        'مفتاح Gemini AI (سري)'),
  ('tenant_master_default', 'admin_password_hash','',                       'هاش SHA-256 لكلمة مرور الأدمن'),
  ('tenant_master_default', 'admin_recovery_hash','',                       'هاش كود الاسترداد'),
  ('tenant_master_default', 'theme_default',     'default',                 'اسم الثيم النشط'),
  ('tenant_master_default', 'seo_title',         'Smart Shopping',          'عنوان الصفحة الرئيسية'),
  ('tenant_master_default', 'seo_description',   '',                        'وصف SEO للمتجر'),
  ('tenant_master_default', 'maintenance_mode',  'false',                   'وضع الصيانة');

-- ─────────────────────────────────────────────────────────────
-- 5. جدول الشهادات/التقييمات (Testimonials)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS testimonials (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   TEXT    DEFAULT 'tenant_master_default' REFERENCES tenants(id) ON DELETE CASCADE,
  author_name TEXT    NOT NULL,
  author_location TEXT DEFAULT '',
  content     TEXT    NOT NULL,
  rating      INTEGER DEFAULT 5 CHECK(rating BETWEEN 1 AND 5),
  avatar_url  TEXT    DEFAULT '',
  active      INTEGER DEFAULT 1 CHECK(active IN (0,1)),
  sort_order  INTEGER DEFAULT 0,
  created_at  TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_testimonials_tenant ON testimonials(tenant_id, active, sort_order);

-- ─────────────────────────────────────────────────────────────
-- 6. جدول تقييمات المنتجات (Product Reviews)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   TEXT    DEFAULT 'tenant_master_default' REFERENCES tenants(id) ON DELETE CASCADE,
  product_id  INTEGER REFERENCES products(id) ON DELETE CASCADE,
  author_name TEXT    NOT NULL,
  author_phone TEXT   DEFAULT '',
  content     TEXT    NOT NULL,
  rating      INTEGER DEFAULT 5 CHECK(rating BETWEEN 1 AND 5),
  image_url   TEXT    DEFAULT '',
  status      TEXT    DEFAULT 'pending'
                      CHECK(status IN ('pending','approved','rejected')),
  created_at  TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_status  ON reviews(status);
CREATE INDEX IF NOT EXISTS idx_reviews_tenant  ON reviews(tenant_id, status);

-- ─────────────────────────────────────────────────────────────
-- 7. جدول الصفحات المخصصة (Custom Pages)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   TEXT    DEFAULT 'tenant_master_default' REFERENCES tenants(id) ON DELETE CASCADE,
  slug        TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  content     TEXT    DEFAULT '',
  active      INTEGER DEFAULT 1 CHECK(active IN (0,1)),
  updated_at  TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_pages_tenant ON pages(tenant_id, slug);

-- ─────────────────────────────────────────────────────────────
-- 8. جدول المشتركين في النشرة البريدية (Newsletter Subscribers)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscribers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id  TEXT    DEFAULT 'tenant_master_default' REFERENCES tenants(id) ON DELETE CASCADE,
  phone      TEXT    NOT NULL,
  name       TEXT    DEFAULT '',
  active     INTEGER DEFAULT 1,
  created_at TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(tenant_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_subscribers_tenant ON subscribers(tenant_id, phone);

-- ─────────────────────────────────────────────────────────────
-- 9. جدول جلسات الأدمن القديمة (Legacy Admin Sessions Compatibility)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_sessions (
  token      TEXT    PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  created_at TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ─────────────────────────────────────────────────────────────
-- 10. جدول العملاء (Customers)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT    DEFAULT 'tenant_master_default' REFERENCES tenants(id) ON DELETE CASCADE,
  phone         TEXT    NOT NULL,
  name          TEXT    DEFAULT '',
  wilaya_code   TEXT    DEFAULT '',
  wilaya_ar     TEXT    DEFAULT '',
  wilaya_en     TEXT    DEFAULT '',
  municipality  TEXT    DEFAULT '',
  delivery_type TEXT    DEFAULT 'home',
  password_hash TEXT    NOT NULL,
  created_at    TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at    TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(tenant_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers(tenant_id, phone);

-- ─────────────────────────────────────────────────────────────
-- 11. جدول جلسات العملاء (Customer Sessions)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_sessions (
  token       TEXT    PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL,
  created_at  TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ─────────────────────────────────────────────────────────────
-- 12. جدول الثيمات المخصصة (Themes)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS themes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   TEXT    DEFAULT 'tenant_master_default' REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  config_json TEXT    DEFAULT '{}',
  updated_at  TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_themes_tenant ON themes(tenant_id, name);

-- ─────────────────────────────────────────────────────────────
-- 13. جدول أحداث التحليلات وتتبع الزوار (Analytics Events)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analytics_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT    DEFAULT 'tenant_master_default' REFERENCES tenants(id) ON DELETE CASCADE,
  session_id    TEXT    DEFAULT '',
  event_name    TEXT    NOT NULL,
  product_id    TEXT    DEFAULT '',
  utm_source    TEXT    DEFAULT '',
  utm_medium    TEXT    DEFAULT '',
  utm_campaign  TEXT    DEFAULT '',
  utm_term      TEXT    DEFAULT '',
  utm_content   TEXT    DEFAULT '',
  fbclid        TEXT    DEFAULT '',
  ip_country    TEXT    DEFAULT '',
  created_at    TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_analytics_tenant_event ON analytics_events(tenant_id, event_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_campaign ON analytics_events(tenant_id, utm_campaign, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at DESC);
