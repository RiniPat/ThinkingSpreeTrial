-- ───────────────────────────────────────────────────────────────────────────
-- Migration 012 — Manual calendar → sprint marks (v5.7)
--
-- Lets a consultant flag any Google Calendar event as a T-Sprint (or un-flag a
-- false positive), so sessions that aren't named "T-Sprint for ..." still count
-- on the dashboard. Idempotent.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS calendar_sprint_marks (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL,
  google_event_id TEXT NOT NULL,
  title           TEXT,
  start_iso       TEXT,
  end_iso         TEXT,
  marked          BOOLEAN NOT NULL DEFAULT TRUE,
  founder_id      INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS calendar_sprint_marks_user_event_ux
  ON calendar_sprint_marks (user_id, google_event_id);
