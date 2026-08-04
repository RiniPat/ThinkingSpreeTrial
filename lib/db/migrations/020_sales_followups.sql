-- 019_sales_followups.sql
-- Sales · Follow-ups: app-owned state layered on top of the read-only
-- "Live Sprint Tracking" Google Sheet.
--
-- The sheet is the source of truth for CLIENT identity + sprint facts (dates,
-- sessions, host, program, email). It is per-SESSION (≈1931 rows / ≈1212
-- clients). This table stores only what the app owns and the sheet cannot:
-- follow-up lifecycle, the saved draft, send/thread ids, and reply state.
--
-- Grain: ONE row per client, keyed by `client_key` = normalised(name)||'|'||
-- normalised(program). Snapshot fields (startup/contact/email/...) are captured
-- so the record stays self-contained even if the sheet later changes.
--
-- Idempotent: safe to re-run on every deploy (CREATE ... IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS sales_followups (
  id                  serial PRIMARY KEY,
  client_key          text NOT NULL,                 -- normalised(name)|normalised(program)

  -- Snapshot of sheet-derived identity (captured/refreshed on sync + on send)
  startup             text NOT NULL,
  contact             text,
  email               text,
  program             text,
  stage               text,
  host                text,
  cohost              text,
  sessions            integer,
  last_sprint_date    date,                           -- latest Sprint Date across the client's rows
  sprint_completed    boolean,                        -- from sheet if the column exists; else NULL

  -- App-owned lifecycle. NULL = derive at read time (not_due / due) from date.
  -- Explicit values once the consultant acts or a reply is detected:
  --   draft | sent | no_reply | replied_not_now | replied_interested | bounced
  status              text,

  -- Saved draft (rich text) before send
  template_key        text,                           -- checkin | next_sprint | nudge
  draft_subject       text,
  draft_body_html     text,

  -- Send + threading (Gmail)
  owner_id            integer,                        -- consultant whose Gmail sent it
  sent_at             timestamptz,
  last_contact_at     timestamptz,
  gmail_thread_id     text,
  gmail_message_id    text,

  -- Reply tracking (auto-detected from inbox, with manual override)
  reply_state         text,                           -- interested | not_now | no_reply
  reply_detected_at   timestamptz,
  reply_is_manual     boolean NOT NULL DEFAULT false, -- true once a human overrides

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_followups_client_key_idx
  ON sales_followups (client_key);
CREATE INDEX IF NOT EXISTS sales_followups_status_idx
  ON sales_followups (status);
CREATE INDEX IF NOT EXISTS sales_followups_thread_idx
  ON sales_followups (gmail_thread_id);
CREATE INDEX IF NOT EXISTS sales_followups_owner_idx
  ON sales_followups (owner_id);
