-- Phase 4 — Additive migration: link orders to customers by session ownership.
-- Safe to run repeatedly is NOT guaranteed for the ALTER (SQLite has no
-- "ADD COLUMN IF NOT EXISTS"), so this must be run exactly once per database.
-- Nullable, no default needed (defaults to NULL for all existing rows).
-- No existing data is modified or deleted.

ALTER TABLE orders ADD COLUMN customer_id INTEGER REFERENCES customers(id);

CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
