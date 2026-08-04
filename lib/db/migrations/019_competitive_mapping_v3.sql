-- 019_competitive_mapping_v3.sql
-- Competitive Mapping v3: Fencing now takes an explicit SCOPE (geography +
-- industry) and produces two richer artifacts alongside the landscape:
--   * Industry Mapping — a demand/application map (products x applications).
--   * Competitive Landscape — selection logic + business canvas + benchmarks.
-- Both are written to the "Research for [Company]" Google Sheet as new tabs.
--
-- All statements are idempotent (run-migrations.mjs re-applies every deploy).

ALTER TABLE competitive_maps ADD COLUMN IF NOT EXISTS geography       TEXT;
ALTER TABLE competitive_maps ADD COLUMN IF NOT EXISTS industry        TEXT;
ALTER TABLE competitive_maps ADD COLUMN IF NOT EXISTS demand_map      JSONB;
ALTER TABLE competitive_maps ADD COLUMN IF NOT EXISTS competitive_doc JSONB;
