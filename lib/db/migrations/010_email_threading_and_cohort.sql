-- ───────────────────────────────────────────────────────────────────────────
-- Migration 010 — Email threading + Wadhwani Foundation cohort (v5.5)
--
-- 1. Email threading: store the Gmail thread id and the RFC 2822 Message-ID
--    of a sent email so the post-sprint email can be sent as a reply within
--    the same thread as the pre-sprint email.
--
-- 2. Create the "Wadhwani Foundation companies" cohort (incubator) so
--    consultants can group Wadhwani ventures. Idempotent — only inserts if a
--    cohort with that name doesn't already exist.
--
-- Idempotent.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE email_drafts ADD COLUMN IF NOT EXISTS gmail_thread_id TEXT;
ALTER TABLE email_drafts ADD COLUMN IF NOT EXISTS rfc_message_id  TEXT;

-- Seed the Wadhwani Foundation cohort. Matches on a case-insensitive name so
-- re-running the migration (or a prior manual create) won't produce a dupe.
INSERT INTO incubators (name, type, description)
SELECT 'Wadhwani Foundation companies', 'wadhwani',
       'Ventures supported through the Wadhwani Foundation program.'
WHERE NOT EXISTS (
  SELECT 1 FROM incubators WHERE LOWER(name) = LOWER('Wadhwani Foundation companies')
);
