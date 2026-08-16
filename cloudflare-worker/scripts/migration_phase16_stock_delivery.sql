-- Phase 16 — Additive migration: delivery-confirmed stock idempotency fields on orders.
-- Safe to run repeatedly is NOT guaranteed for the ALTER (SQLite has no
-- "ADD COLUMN IF NOT EXISTS"), so this must be run exactly once per database.
--
-- Semantics:
--   stock_decremented:
--     0 = not processed (default for ALL existing + new rows)
--     1 = stock processed on delivery (set only inside processDeliveredOrderStock)
--   stock_processed_at:
--     NULL = not processed
--     timestamp of successful delivery stock processing
--
-- No backfill.
-- No UPDATE of existing orders.
-- No decrement for existing orders.
-- Status CHECK constraint is NOT touched.
-- All 17 current production orders are `pending` → they remain stock_decremented = 0.

ALTER TABLE orders ADD COLUMN stock_decremented INTEGER DEFAULT 0;
ALTER TABLE orders ADD COLUMN stock_processed_at TEXT DEFAULT NULL;