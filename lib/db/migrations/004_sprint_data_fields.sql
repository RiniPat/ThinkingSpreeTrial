-- ───────────────────────────────────────────────────────────────────────────
-- Migration 004 — extended Sprint Data fields
--
-- Adds 4 genuinely new columns:
--   • founders.vision_raw            — the raw "About Startup" paragraph
--   • founders.smart_goal_3_months   — SMART Goal (3 months) from SMART tab
--   • founders.previous_fundraise_cr — Previous Fundraise (text form)
--   • founders.runway                — Runway (raw text)
--
-- founders.previous_fundraise_orgs and founders.current_burn already exist
-- from migration 001 — we don't redeclare them.
--
-- founders.vision already exists (used now for the AI-summarised text).
-- Idempotent.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE founders ADD COLUMN IF NOT EXISTS vision_raw              TEXT;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS smart_goal_3_months     TEXT;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS previous_fundraise_cr   TEXT;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS runway                  TEXT;
