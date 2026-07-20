-- 015_inbox_contacts.sql
-- Inbox CRM (new Sales tab): deduped contacts derived from each Sales/Admin
-- user's connected Gmail, plus per-user sync state for the Refresh button and
-- incremental refresh. Idempotent.

CREATE TABLE IF NOT EXISTS contacts (
  id              serial PRIMARY KEY,
  owner_id        integer NOT NULL,
  email           text NOT NULL,
  name            text,
  company         text,
  domain          text,
  role            text NOT NULL DEFAULT 'other',
  role_label      text,
  role_source     text NOT NULL DEFAULT 'ai',
  confidence      real,
  emails_total    integer NOT NULL DEFAULT 0,
  sent_count      integer NOT NULL DEFAULT 0,
  received_count  integer NOT NULL DEFAULT 0,
  first_seen      timestamptz,
  last_contact_at timestamptz,
  last_direction  text,
  reply_status    text NOT NULL DEFAULT 'none',
  linkedin_url    text,
  notes           text,
  promoted_lead_id integer,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_owner_email_uq ON contacts (owner_id, email);
CREATE INDEX IF NOT EXISTS contacts_owner_role_idx ON contacts (owner_id, role);
CREATE INDEX IF NOT EXISTS contacts_owner_last_idx ON contacts (owner_id, last_contact_at);

CREATE TABLE IF NOT EXISTS contact_sync_state (
  owner_id       integer PRIMARY KEY,
  status         text NOT NULL DEFAULT 'idle',
  phase          text,
  window_months  integer,
  processed      integer NOT NULL DEFAULT 0,
  total          integer NOT NULL DEFAULT 0,
  last_synced_at timestamptz,
  message        text,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
