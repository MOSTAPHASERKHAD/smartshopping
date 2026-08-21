-- ============================================================
-- Smart Shopping - Cloudflare D1 Migration 0004
-- Phase 30: Shopify-Like Dynamic Sections & Theme Engine Schema
-- Non-destructive, Zero-Data-Loss, Backward Compatible
-- ============================================================

-- 1. ترقية جدول الثيمات الأساسي لدعم أقسام شوبيفاي والقوالب المعدة مسبقاً
CREATE TABLE IF NOT EXISTS themes_v2 (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL DEFAULT 'tenant_master_default',
  name          TEXT NOT NULL,
  title         TEXT DEFAULT '',
  description   TEXT DEFAULT '',
  version       TEXT DEFAULT '1.0.0',
  author        TEXT DEFAULT '',
  base          TEXT DEFAULT 'light' CHECK(base IN ('light', 'dark')),
  extends       TEXT DEFAULT NULL,
  tokens_json   TEXT NOT NULL DEFAULT '{}',
  sections_json TEXT NOT NULL DEFAULT '{}',
  presets_json  TEXT NOT NULL DEFAULT '{}',
  is_active     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at    TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_themes_v2_tenant ON themes_v2(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_themes_v2_name ON themes_v2(tenant_id, name);

-- 2. جدول إعدادات الأقسام المخصصة لكل منتج أو صفحة (Section Configurations)
CREATE TABLE IF NOT EXISTS theme_section_configs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT NOT NULL DEFAULT 'tenant_master_default',
  target_type   TEXT NOT NULL DEFAULT 'global' CHECK(target_type IN ('global', 'product', 'page', 'collection')),
  target_id     TEXT NOT NULL DEFAULT 'default',
  theme_id      TEXT DEFAULT NULL,
  sections_json TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at    TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(tenant_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_sec_configs_target ON theme_section_configs(tenant_id, target_type, target_id);
