-- 024_sales_interest.sql
-- Sales · Follow-ups triage. Adds the "interest" field that drives the new
-- triage-first UX (interested | maybe | not_now | NULL=untriaged). This is
-- SEPARATE from the legacy `skipped` "not targeting" gate (migration 023) —
-- do not overload it. Only `interested`/`maybe` are drafted/sent and counted
-- in Ops "should-have-sent". `not_now` means the client is not interested.
--
-- Idempotent (run-migrations.mjs re-applies every migration on every deploy).

ALTER TABLE sales_followups ADD COLUMN IF NOT EXISTS interest        text;        -- 'interested' | 'maybe' | 'not_now' | NULL (untriaged)
ALTER TABLE sales_followups ADD COLUMN IF NOT EXISTS interest_set_at timestamptz;
