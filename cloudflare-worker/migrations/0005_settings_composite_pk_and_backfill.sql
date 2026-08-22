-- ============================================================
-- Smart Shopping - Cloudflare D1 Migration 0005
-- Multi-Tenant Settings Isolation & Legacy Data Backfill
-- Non-destructive, Zero-Data-Loss, Backward Compatible
-- ============================================================

-- 1. ترحيل وتأكيد tenant_id لكافة السجلات القديمة المجهولة (NULL Backfill)
UPDATE settings SET tenant_id = 'tenant_master_default' WHERE tenant_id IS NULL;
UPDATE products SET tenant_id = 'tenant_master_default' WHERE tenant_id IS NULL;
UPDATE orders SET tenant_id = 'tenant_master_default' WHERE tenant_id IS NULL;
UPDATE coupons SET tenant_id = 'tenant_master_default' WHERE tenant_id IS NULL;
UPDATE testimonials SET tenant_id = 'tenant_master_default' WHERE tenant_id IS NULL;
UPDATE reviews SET tenant_id = 'tenant_master_default' WHERE tenant_id IS NULL;
UPDATE pages SET tenant_id = 'tenant_master_default' WHERE tenant_id IS NULL;
UPDATE subscribers SET tenant_id = 'tenant_master_default' WHERE tenant_id IS NULL;
UPDATE customers SET tenant_id = 'tenant_master_default' WHERE tenant_id IS NULL;
UPDATE themes SET tenant_id = 'tenant_master_default' WHERE tenant_id IS NULL;

-- 2. ترقية جدول الإعدادات (settings) ليعتمد على المفتاح المركب (tenant_id, key)
CREATE TABLE IF NOT EXISTS settings_v2 (
  tenant_id   TEXT NOT NULL DEFAULT 'tenant_master_default' REFERENCES tenants(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       TEXT DEFAULT '',
  description TEXT DEFAULT '',
  updated_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (tenant_id, key)
);

INSERT OR IGNORE INTO settings_v2 (tenant_id, key, value, description, updated_at)
SELECT 
  COALESCE(tenant_id, 'tenant_master_default') as tenant_id,
  key,
  COALESCE(value, '') as value,
  COALESCE(description, '') as description,
  COALESCE(updated_at, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) as updated_at
FROM settings;

DROP TABLE settings;
ALTER TABLE settings_v2 RENAME TO settings;

CREATE INDEX IF NOT EXISTS idx_settings_tenant_key ON settings(tenant_id, key);
