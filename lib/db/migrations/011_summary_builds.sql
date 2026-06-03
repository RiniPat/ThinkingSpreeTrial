-- ───────────────────────────────────────────────────────────────────────────
-- Migration 011 — Summary Builder (Builder tab · Phase B, v5.6)
--
-- Server-persisted, resumable workflow state for building Wadhwani-format
-- venture summaries: pull from the T-Sheet, AI-extract Fathom fields, look up
-- VP1/VP2 dates from Sprint Tracking, review/edit, then commit a venture row
-- to the Summary Sheet tab (under the Wadhwani Foundation companies cohort).
--
-- Idempotent.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS summary_builds (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL,
  startup_name  TEXT NOT NULL,
  cohort        TEXT,
  tsheet_link   TEXT,
  status        TEXT NOT NULL DEFAULT 'drafting',
  error_message TEXT,
  fathom_text   TEXT,
  pulled        JSONB,
  ai_fields     JSONB,
  fields        JSONB,
  founder_id    INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS summary_builds_user_idx   ON summary_builds (user_id);
CREATE INDEX IF NOT EXISTS summary_builds_status_idx ON summary_builds (status);
