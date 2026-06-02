-- ============================================================================
-- Migration 010 — Cohorts + email threading
-- ============================================================================
-- Idempotent. Safe to run multiple times.
--
-- Adds:
--   • cohorts                — named groupings of companies (e.g. "Wadhwani
--                              Foundation companies"). Optionally bound to a
--                              source Google Sheet for one-way sync.
--   • cohort_companies       — join table; one company can be in many cohorts.
--   • sprint_emails          — record of every email sent from a sprint, with
--                              RFC 5322 Message-ID so post-sprint can reply.
--   • columns on sprints     — convenient denormalised pointers (optional;
--                              kept here so the email composer doesn't have
--                              to JOIN sprint_emails on every render).
-- ============================================================================

CREATE TABLE IF NOT EXISTS cohorts (
    id                BIGSERIAL PRIMARY KEY,
    name              TEXT        NOT NULL,
    slug              TEXT        NOT NULL UNIQUE,
    description       TEXT,
    -- One-way sync source. NULL = manual cohort (no auto-sync).
    -- For Wadhwani Foundation companies, set this to the Wadhwani Summary
    -- Sheet URL and any new row in that sheet becomes a member.
    source_sheet_url  TEXT,
    source_sheet_tab  TEXT,
    last_synced_at    TIMESTAMPTZ,
    last_sync_error   TEXT,
    created_by        BIGINT      REFERENCES users(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cohorts_slug ON cohorts(slug);

-- Seed the Wadhwani Foundation cohort. The source_sheet_url is left NULL
-- here; an admin sets it in the UI once. The migration is idempotent so
-- the ON CONFLICT keeps re-runs safe.
INSERT INTO cohorts (name, slug, description)
VALUES (
    'Wadhwani Foundation companies',
    'wadhwani-foundation',
    'Companies sponsored by the Wadhwani Foundation. Auto-synced from the Wadhwani Summary Sheet.'
)
ON CONFLICT (slug) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- Join table.
-- ADAPT: replace `founders(id)` with whatever your companies table is.
-- Per CHANGES.md the companies table is `founders`; if you've renamed it,
-- change here AND in cohorts.ts.
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cohort_companies (
    cohort_id   BIGINT      NOT NULL REFERENCES cohorts(id)  ON DELETE CASCADE,
    founder_id  BIGINT      NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Provenance: was this added by the sync job or by a human?
    source      TEXT        NOT NULL DEFAULT 'manual'
                            CHECK (source IN ('manual', 'sheet-sync')),
    PRIMARY KEY (cohort_id, founder_id)
);

CREATE INDEX IF NOT EXISTS idx_cohort_companies_founder ON cohort_companies(founder_id);

-- ────────────────────────────────────────────────────────────────────────────
-- sprint_emails — every email sent from a sprint detail page.
-- This is the source of truth for threading: post-sprint email looks up
-- the pre-sprint row here and threads on its message_id.
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sprint_emails (
    id              BIGSERIAL   PRIMARY KEY,
    sprint_id       BIGINT      NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    kind            TEXT        NOT NULL CHECK (kind IN ('pre-sprint', 'post-sprint', 'check-in', 'other')),
    -- Recipients as arrays of email strings. Trimmed + lowercased on insert.
    recipients_to   TEXT[]      NOT NULL DEFAULT '{}',
    recipients_cc   TEXT[]      NOT NULL DEFAULT '{}',
    recipients_bcc  TEXT[]      NOT NULL DEFAULT '{}',
    subject         TEXT        NOT NULL,
    body_html       TEXT        NOT NULL,
    body_text       TEXT,
    -- RFC 5322 headers — used to thread post-sprint as a reply to pre-sprint.
    -- message_id is set when we send (Gmail returns it; or we generate one).
    message_id      TEXT,
    in_reply_to     TEXT,
    references_ids  TEXT[]      NOT NULL DEFAULT '{}',
    -- Gmail thread ID (so we can also use the Gmail API's threadId param,
    -- which is the cleanest path when you're on Gmail end-to-end).
    gmail_thread_id TEXT,
    sent_by         BIGINT      REFERENCES users(id) ON DELETE SET NULL,
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (sprint_id, kind, sent_at)
);

CREATE INDEX IF NOT EXISTS idx_sprint_emails_sprint     ON sprint_emails(sprint_id);
CREATE INDEX IF NOT EXISTS idx_sprint_emails_message_id ON sprint_emails(message_id);

-- ────────────────────────────────────────────────────────────────────────────
-- Convenience: rebuild a view of "latest email per sprint per kind"
-- so the composer can ask "did this sprint have a pre-sprint email?" in
-- one query instead of a window function each time.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_latest_sprint_email AS
SELECT DISTINCT ON (sprint_id, kind)
    sprint_id,
    kind,
    id           AS email_id,
    message_id,
    gmail_thread_id,
    subject,
    sent_at
FROM sprint_emails
ORDER BY sprint_id, kind, sent_at DESC;
