-- ============================================================
-- Smart Shopping - Cloudflare D1 Migration 0001
-- Multi-Tenant SaaS & RBAC Foundation (PHASE 28)
-- Non-destructive, Zero-Data-Loss, Backward Compatible
-- ============================================================

-- 1. جدول المستأجرين / المتاجر (Tenants)
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

-- 2. جدول المستخدمين والتجار (Users)
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT DEFAULT '',
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'OWNER' CHECK(role IN ('OWNER', 'ADMIN', 'ORDER_MANAGER', 'SUPPORT', 'VIEWER')),
  status        TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'suspended')),
  created_at    TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at    TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- 3. جدول الجلسات الموحدة والمشفرة (Sessions)
CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role         TEXT NOT NULL,
  expires_at   INTEGER NOT NULL,
  created_at   TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  last_seen_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  revoked_at   TEXT DEFAULT NULL
);

-- 4. جدول سجل التدقيق الأمني (Audit Logs)
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

-- 5. إنشاء Master Tenant الافتراضي للمتجر القائم
INSERT OR IGNORE INTO tenants (id, name, slug, domain, status, plan)
VALUES ('tenant_master_default', 'Smart Shopping Master', 'main', 'smartshopping.click', 'active', 'master');

-- 6. إضافة عمود tenant_id للجداول القائمة (Safe Non-destructive Backfill)
-- SQLite / D1 يدعم ADD COLUMN مع DEFAULT value بأمان تام
ALTER TABLE products ADD COLUMN tenant_id TEXT DEFAULT 'tenant_master_default';
ALTER TABLE orders ADD COLUMN tenant_id TEXT DEFAULT 'tenant_master_default';
ALTER TABLE coupons ADD COLUMN tenant_id TEXT DEFAULT 'tenant_master_default';
ALTER TABLE settings ADD COLUMN tenant_id TEXT DEFAULT 'tenant_master_default';
ALTER TABLE testimonials ADD COLUMN tenant_id TEXT DEFAULT 'tenant_master_default';
ALTER TABLE reviews ADD COLUMN tenant_id TEXT DEFAULT 'tenant_master_default';
ALTER TABLE pages ADD COLUMN tenant_id TEXT DEFAULT 'tenant_master_default';
ALTER TABLE subscribers ADD COLUMN tenant_id TEXT DEFAULT 'tenant_master_default';
ALTER TABLE customers ADD COLUMN tenant_id TEXT DEFAULT 'tenant_master_default';
ALTER TABLE themes ADD COLUMN tenant_id TEXT DEFAULT 'tenant_master_default';

-- 7. إنشاء الفهارس المعزولة لأداء واستعلامات الـ Multi-Tenant
CREATE INDEX IF NOT EXISTS idx_products_tenant ON products(tenant_id, active, sort_order);
CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers(tenant_id, phone);
CREATE INDEX IF NOT EXISTS idx_coupons_tenant ON coupons(tenant_id, active);
CREATE INDEX IF NOT EXISTS idx_reviews_tenant ON reviews(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_settings_tenant ON settings(tenant_id, key);
CREATE INDEX IF NOT EXISTS idx_themes_tenant ON themes(tenant_id, name);
CREATE INDEX IF NOT EXISTS idx_sessions_tenant ON sessions(tenant_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id, created_at DESC);
