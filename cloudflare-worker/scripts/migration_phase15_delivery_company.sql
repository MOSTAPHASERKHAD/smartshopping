-- Phase 15 — Additive migration: Yalidine-ready delivery fields on orders.
-- Safe to run repeatedly is NOT guaranteed for the ALTER (SQLite has no
-- "ADD COLUMN IF NOT EXISTS"), so this must be run exactly once per database.
-- delivery_company defaults to 'yalidine' (internal default carrier).
-- tracking_code defaults to '' (empty until shipment is created later).
-- No existing data is modified or deleted.

ALTER TABLE orders ADD COLUMN delivery_company TEXT DEFAULT 'yalidine';
ALTER TABLE orders ADD COLUMN tracking_code TEXT DEFAULT '';
