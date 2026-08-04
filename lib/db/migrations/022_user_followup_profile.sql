-- 021_user_followup_profile.sql
-- Consultant sign-off fields used to auto-fill follow-up templates:
--   [Name]          → users.name (already present)
--   [Title]         → users.title
--   [Phone]         → users.phone
--   [Calendar link] → users.calendar_link
-- Idempotent.

ALTER TABLE users ADD COLUMN IF NOT EXISTS title         text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone         text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS calendar_link text;
