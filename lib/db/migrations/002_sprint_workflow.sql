-- ───────────────────────────────────────────────────────────────────────────
-- Migration 002 — Sprint Template upload workflow
--
-- Adds:
--  • founders.excel_data    JSONB blob — parsed Sprint Template content
--  • founders.vision        TEXT       — "About the Startup" → Vision
--  • founders.deck_url      TEXT       — link/attachment from Overview
--  • founders.founder_email_2 already exists, reuse
--  • founders.stage_workflow TEXT      — "pre_sprint" | "sprint_done" | "post_email_sent"
--
--  • company_events         table     — timeline rows (pre-email sent, sprint
--                                       scheduled, sprint done, post-email sent)
--  • email_drafts           table     — keep generated AI drafts before sending
--
-- Idempotent: safe to run multiple times.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE founders ADD COLUMN IF NOT EXISTS excel_data       JSONB;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS vision           TEXT;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS deck_url         TEXT;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS stage_workflow   TEXT NOT NULL DEFAULT 'pre_sprint';
ALTER TABLE founders ADD COLUMN IF NOT EXISTS owner_id         INTEGER;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS sprint_host      TEXT;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS co_host          TEXT;

CREATE INDEX IF NOT EXISTS founders_stage_idx ON founders (stage_workflow);
CREATE INDEX IF NOT EXISTS founders_owner_idx ON founders (owner_id);


-- ───── COMPANY EVENTS (timeline) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_events (
  id           SERIAL PRIMARY KEY,
  founder_id   INTEGER NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL,        -- 'template_uploaded' | 'pre_email_drafted'
                                     -- | 'pre_email_sent'  | 'sprint_scheduled'
                                     -- | 'sprint_completed'| 'post_email_drafted'
                                     -- | 'post_email_sent'
  note         TEXT,
  metadata     JSONB,
  occurred_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS company_events_founder_idx ON company_events (founder_id);
CREATE INDEX IF NOT EXISTS company_events_kind_idx    ON company_events (kind);


-- ───── EMAIL DRAFTS (AI-generated, pre-send) ──────────────────────────────
CREATE TABLE IF NOT EXISTS email_drafts (
  id          SERIAL PRIMARY KEY,
  founder_id  INTEGER NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('pre','post')),
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  to_email    TEXT,
  sent_at     TIMESTAMP WITH TIME ZONE,
  gmail_message_id TEXT,
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS email_drafts_founder_idx ON email_drafts (founder_id);
CREATE INDEX IF NOT EXISTS email_drafts_user_idx    ON email_drafts (user_id);
