-- ───────────────────────────────────────────────────────────────────────────
-- Migration 007 — Metrics tab fields (v5.1)
--
-- Adds three new columns for the Metrics tab in the Sprint Template.
-- All values are TEXT because the source cells may contain qualitative
-- descriptions (e.g. "24 months post-seed", "build mobile app + scale ops")
-- not just numbers.
--
-- Idempotent.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE founders ADD COLUMN IF NOT EXISTS next_stage_goal     TEXT;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS next_stage_runway   TEXT;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS funds_for           TEXT;
