-- 023_sales_ops_scoping.sql
-- Sales multi-cohort retargeting: consultant scoping + Operations tracking.
--
-- 1. users.sprint_host_names — per-user alias(es) that match how the person
--    appears in the "Live Sprint Tracking" sheet's Sprint Host / Co-Host
--    columns (free text, comma/newline separated). Used at READ time to scope
--    a consultant to the companies they hosted or co-hosted. Falls back to
--    matching users.name when empty.
--
-- 2. sales_followups skip fields — the PRD "willing to contact?" gate. A
--    consultant (or ops) can mark a due company as NOT being targeted, so the
--    Operations progress view excludes it from the "should have sent" count.
--
-- Idempotent: safe to re-run on every deploy.

ALTER TABLE users ADD COLUMN IF NOT EXISTS sprint_host_names text;

ALTER TABLE sales_followups ADD COLUMN IF NOT EXISTS skipped     boolean NOT NULL DEFAULT false;
ALTER TABLE sales_followups ADD COLUMN IF NOT EXISTS skip_reason text;
ALTER TABLE sales_followups ADD COLUMN IF NOT EXISTS skipped_at  timestamptz;
