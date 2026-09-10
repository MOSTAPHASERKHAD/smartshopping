-- ============================================================
-- Smart Shopping - Cloudflare D1 Migration 0007
-- Expand Tenant Status CHECK Constraint
-- Non-destructive, Zero-Data-Loss, Backward Compatible
-- Supports statuses: 'active', 'suspended', 'archived', 'pending', 'rejected'
-- ============================================================

PRAGMA foreign_keys = OFF;

-- 1. إنشاء الجدول الجديد tenants_v2 بالقيد الموسّع
CREATE TABLE IF NOT EXISTS tenants_v2 (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  domain      TEXT DEFAULT NULL UNIQUE,
  status      TEXT DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'archived', 'pending', 'rejected')),
  plan        TEXT DEFAULT 'master' CHECK(plan IN ('master', 'starter', 'pro', 'enterprise')),
  created_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- 2. نقل كافة البيانات القائمة بالكامل وبلا أي تعديل
INSERT INTO tenants_v2 (id, name, slug, domain, status, plan, created_at, updated_at)
SELECT id, name, slug, domain, status, plan, created_at, updated_at
FROM tenants;

-- 3. استبدال الجدول القديم بالجدول المرقّى
DROP TABLE tenants;
ALTER TABLE tenants_v2 RENAME TO tenants;

-- 4. التحقق من سلامة المفاتيح الأجنبية وإعادة تفعيلها
PRAGMA foreign_key_check;
PRAGMA foreign_keys = ON;
