-- ───────────────────────────────────────────────────────────────────────────
-- Migration 005 — TS team observations + workflow stage tweaks
--
-- Adds:
--   • founders.observations_ts_dashboard — internal "Observations by TS Team"
--     written by the host AFTER the sprint. Different from the legacy
--     observations_ts column (migration 001) which holds CSV-imported notes.
--
-- The legacy stageWorkflow stays as TEXT — we add a new constraint-free
-- 'scheduled' value to the allowed set on the application side only, no
-- DB CHECK constraint needed since the column is unconstrained TEXT.
--
-- Idempotent.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE founders ADD COLUMN IF NOT EXISTS observations_ts_dashboard TEXT;
