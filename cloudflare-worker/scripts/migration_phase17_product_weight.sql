-- Phase 17 — Additive migration: Optional product weight in kg
-- Safe to run repeatedly is NOT guaranteed for the ALTER (SQLite has no
-- "ADD COLUMN IF NOT EXISTS"), so this must be run once per database.
--
-- Semantics:
--   weight:
--     NULL = no weight specified (default for all existing & new products)
--     > 0  = weight in kilograms (used in tiered shipping calculation)
--
-- No existing data is modified or deleted.

ALTER TABLE products ADD COLUMN weight REAL DEFAULT NULL;
