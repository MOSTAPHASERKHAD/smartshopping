-- Phase 7 — Additive migration: per-product landing page configuration.
-- Safe to run repeatedly is NOT guaranteed for the ALTER (SQLite has no
-- "ADD COLUMN IF NOT EXISTS"), so this must be run exactly once per database.
-- Column is NOT NULL with a literal DEFAULT '{}' (empty config = existing
-- automatic landing behavior preserved exactly). No existing data is modified,
-- deleted, or re-encoded.
--
-- NOTE for staging ops:
--   This migration targets STAGING ONLY. Verify the column is absent first:
--     npx wrangler d1 execute smart-shopping-db-staging --env staging --remote \
--       --command "SELECT COUNT(*) AS has_col FROM pragma_table_info('products') WHERE name='landing_config_json';"
--   then apply this file, then re-run the check to confirm has_col = 1.

ALTER TABLE products ADD COLUMN landing_config_json TEXT DEFAULT '{}';