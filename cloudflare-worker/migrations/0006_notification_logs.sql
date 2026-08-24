-- ============================================================
-- Smart Shopping - Cloudflare D1 Migration 0006
-- Notification Logs & Reliable Delivery Tracking (FIX-05)
-- Non-destructive, Zero-Data-Loss, Backward Compatible
-- ============================================================

CREATE TABLE IF NOT EXISTS notification_logs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id         TEXT NOT NULL DEFAULT 'tenant_master_default',
  order_id          TEXT NOT NULL,
  notification_type TEXT NOT NULL,
  idempotency_key   TEXT NOT NULL UNIQUE,
  recipient         TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'sending', 'sent', 'failed', 'retrying')),
  attempts          INTEGER DEFAULT 0,
  last_error        TEXT DEFAULT NULL,
  provider          TEXT DEFAULT 'resend',
  provider_msg_id   TEXT DEFAULT NULL,
  created_at        TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at        TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_notif_tenant_order ON notification_logs(tenant_id, order_id);
CREATE INDEX IF NOT EXISTS idx_notif_status ON notification_logs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_notif_idempotency ON notification_logs(idempotency_key);
