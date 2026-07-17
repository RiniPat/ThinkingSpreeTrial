-- ───────────────────────────────────────────────────────────────────────────
-- Migration 008 — Sprint sessions for multi-sprint support (v5.2)
--
-- Stores point-in-time snapshots of a company's Sprint Data. Each row is
-- a "session" — the data as it existed when the consultant clicked
-- "New Sprint Session". This lets a single company go through multiple
-- sprints over time while preserving the history of each one.
--
-- Snapshot fields mirror the founders columns that the Sprint Template
-- writes to. We don't include name/email/cohort etc. — those belong to
-- the company itself, not a specific session.
--
-- Idempotent.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sprint_sessions (
  id                          SERIAL PRIMARY KEY,
  founder_id                  INTEGER NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  -- Display label, e.g. "Sprint 1 - Q1 2026". Defaults to "Sprint <N>".
  label                       TEXT NOT NULL,
  -- 1-indexed within a founder (1 = first sprint, 2 = second, etc.).
  -- Computed at insert time. Used for chart x-axis + sort ordering.
  session_number              INTEGER NOT NULL,
  -- Workflow stage AT THE TIME OF SNAPSHOT (frozen).
  stage_workflow              TEXT,
  -- ─── Snapshot of Sprint Data fields ─────────────────────────────────
  vision                      TEXT,
  vision_raw                  TEXT,
  key_strength                TEXT,
  gap                         TEXT,
  mentor_recommendation       TEXT,
  market_access               TEXT,
  tasks                       TEXT,            -- actionable steps
  smart_goal_3_months         TEXT,
  previous_fundraise_cr       TEXT,
  previous_fundraise_orgs     TEXT,
  current_burn                TEXT,
  runway                      TEXT,
  next_stage_goal             TEXT,
  next_stage_runway           TEXT,
  funds_for                   TEXT,
  observations_ts_dashboard   TEXT,
  -- Excel data blob at the time of snapshot.
  excel_data                  JSONB,
  created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sprint_sessions_founder_idx ON sprint_sessions (founder_id);
CREATE INDEX IF NOT EXISTS sprint_sessions_founder_number_idx ON sprint_sessions (founder_id, session_number);

-- ─── Per-session email draft scoping ────────────────────────────────────
-- email_drafts already exists; we add session_id so each session can have
-- its own pre/post email. NULL session_id = legacy draft (pre-v5.2 era,
-- not tied to a session). The UI filters by session_id when present.
ALTER TABLE email_drafts ADD COLUMN IF NOT EXISTS session_id INTEGER REFERENCES sprint_sessions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS email_drafts_session_idx ON email_drafts (session_id);

-- Same for company_events — useful to know which session a timeline event
-- belongs to (e.g. "Pre-email sent" → which sprint?).
ALTER TABLE company_events ADD COLUMN IF NOT EXISTS session_id INTEGER REFERENCES sprint_sessions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS company_events_session_idx ON company_events (session_id);
