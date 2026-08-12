-- 026_sales_pipeline.sql
-- Sales · Retargeting pipeline stages + richer client-response tracking.
--
-- Pipeline chain (7 days per step, consultant sends each stage manually):
--   1st outreach (existing sent_at) -> Nudge sent -> Reminder-with-Toffee sent
--   -> Dead lead. A client response at ANY stage breaks the chain.
--
-- Response tracking replaces the coarse interested/not_now with the states the
-- consultant actually needs; `response_note` holds any free-text remark.
--
-- Idempotent (run-migrations.mjs re-applies every migration on every deploy).

ALTER TABLE sales_followups ADD COLUMN IF NOT EXISTS response_state   text;        -- interested | quotation_sent | no_reply_after_quotation | other | NULL
ALTER TABLE sales_followups ADD COLUMN IF NOT EXISTS response_note    text;        -- free-text remark (consultant, or AI later)
ALTER TABLE sales_followups ADD COLUMN IF NOT EXISTS response_set_at  timestamptz;
ALTER TABLE sales_followups ADD COLUMN IF NOT EXISTS nudge_sent_at    timestamptz; -- stage 2 send
ALTER TABLE sales_followups ADD COLUMN IF NOT EXISTS toffee_sent_at   timestamptz; -- stage 3 (Reminder with Toffee) send
