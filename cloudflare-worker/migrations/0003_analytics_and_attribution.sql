-- ============================================================
-- Smart Shopping - Cloudflare D1 Migration 0003
-- Phase 38: First-Party Marketing Attribution & Analytics Dashboard
-- ============================================================

-- 1. إضافة أعمدة الإسناد التسويقي لجدول الطلبات (orders)
ALTER TABLE orders ADD COLUMN utm_term TEXT DEFAULT '';
ALTER TABLE orders ADD COLUMN utm_content TEXT DEFAULT '';
ALTER TABLE orders ADD COLUMN fbclid TEXT DEFAULT '';
ALTER TABLE orders ADD COLUMN session_id TEXT DEFAULT '';

-- 2. جدول أحداث التحليلات وسلوك الزوار (analytics_events)
CREATE TABLE IF NOT EXISTS analytics_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     TEXT DEFAULT 'tenant_master_default' REFERENCES tenants(id) ON DELETE CASCADE,
  session_id    TEXT DEFAULT '',
  event_name    TEXT NOT NULL,
  product_id    TEXT DEFAULT '',
  utm_source    TEXT DEFAULT '',
  utm_medium    TEXT DEFAULT '',
  utm_campaign  TEXT DEFAULT '',
  utm_term      TEXT DEFAULT '',
  utm_content   TEXT DEFAULT '',
  fbclid        TEXT DEFAULT '',
  ip_country    TEXT DEFAULT '',
  created_at    TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_analytics_tenant_event ON analytics_events(tenant_id, event_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_campaign ON analytics_events(tenant_id, utm_campaign, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at DESC);
