-- Migration 001 — full schema bootstrap + extensions.
-- Safe to run multiple times: every statement is IF NOT EXISTS.

-- ───── BASE TABLES (so a fresh database works) ────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT,            -- nullable: Google-only users have no password
  role          TEXT NOT NULL DEFAULT 'consultant',
  avatar_url    TEXT,
  google_sub    TEXT UNIQUE,     -- Google's stable user ID (sub claim)
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS incubators (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'isb',
  sheet_url   TEXT,
  description TEXT,
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS founders (
  id                  SERIAL PRIMARY KEY,
  incubator_id        INTEGER,
  name                TEXT NOT NULL,
  email               TEXT NOT NULL,
  company_name        TEXT NOT NULL,
  sector              TEXT,
  accelerator_program TEXT,
  thinking_sheet_url  TEXT,
  stage               TEXT,
  description         TEXT,
  created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sprints (
  id                        SERIAL PRIMARY KEY,
  founder_id                INTEGER NOT NULL,
  scheduled_date            TEXT NOT NULL,
  scheduled_time            TEXT,
  consultant_name           TEXT NOT NULL,
  status                    TEXT NOT NULL DEFAULT 'scheduled',
  tsheet_url                TEXT,
  fathom_url                TEXT,
  session_type              TEXT,
  sprint_number             INTEGER,
  strengths                 TEXT,
  gaps                      TEXT,
  swot_analysis             TEXT,
  next_goal                 TEXT,
  actionable_steps          TEXT,
  mentorship_recommendation TEXT,
  market_connections        TEXT,
  meet_link                 TEXT,
  pre_email_sent_at         TIMESTAMP WITH TIME ZONE,
  post_email_sent_at        TIMESTAMP WITH TIME ZONE,
  created_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_logs (
  id         SERIAL PRIMARY KEY,
  sprint_id  INTEGER NOT NULL,
  email_type TEXT NOT NULL,
  to_email   TEXT NOT NULL,
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  message_id TEXT,
  sent_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_sessions (
  sid    VARCHAR NOT NULL COLLATE "default",
  sess   JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL,
  CONSTRAINT user_sessions_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE
) WITH (OIDS=FALSE);

CREATE INDEX IF NOT EXISTS IDX_user_sessions_expire ON user_sessions (expire);

-- ───── USER table extensions (in case it pre-existed without these cols) ──
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT;
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_google_sub_unique UNIQUE (google_sub);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table  THEN NULL; -- PG raises this when the backing index name exists
END $$;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- ───── SPRINTS new columns ────────────────────────────────────────────────
ALTER TABLE sprints ADD COLUMN IF NOT EXISTS end_time TEXT;
ALTER TABLE sprints ADD COLUMN IF NOT EXISTS total_duration TEXT;
ALTER TABLE sprints ADD COLUMN IF NOT EXISTS sprint_host TEXT;
ALTER TABLE sprints ADD COLUMN IF NOT EXISTS co_host TEXT;
ALTER TABLE sprints ADD COLUMN IF NOT EXISTS payment_status TEXT;
ALTER TABLE sprints ADD COLUMN IF NOT EXISTS billed_to TEXT;
ALTER TABLE sprints ADD COLUMN IF NOT EXISTS bill_number TEXT;
ALTER TABLE sprints ADD COLUMN IF NOT EXISTS price NUMERIC(12,2);
ALTER TABLE sprints ADD COLUMN IF NOT EXISTS week INTEGER;
ALTER TABLE sprints ADD COLUMN IF NOT EXISTS month INTEGER;
ALTER TABLE sprints ADD COLUMN IF NOT EXISTS cy_year INTEGER;
ALTER TABLE sprints ADD COLUMN IF NOT EXISTS fy_year INTEGER;
ALTER TABLE sprints ADD COLUMN IF NOT EXISTS quarter TEXT;

CREATE INDEX IF NOT EXISTS sprints_scheduled_date_idx ON sprints (scheduled_date DESC);
CREATE INDEX IF NOT EXISTS sprints_consultant_idx     ON sprints (consultant_name);
CREATE INDEX IF NOT EXISTS sprints_host_idx           ON sprints (sprint_host);

-- ───── FOUNDERS new columns ───────────────────────────────────────────────
ALTER TABLE founders ADD COLUMN IF NOT EXISTS contact TEXT;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS founder_2_name TEXT;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS founder_2_email TEXT;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS founder_2_contact TEXT;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS industry TEXT;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS partner_name TEXT;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS goal_setting TEXT;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS revenue_last_12m TEXT;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS revenue_last_month_mrr TEXT;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS team_size INTEGER;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS key_strength TEXT;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS gap TEXT;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS concept_and_sessions TEXT;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS mentor_recommendation TEXT;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS market_access TEXT;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS ideal_customer_list TEXT;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS timeline_for_market_access TEXT;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS observations_ts TEXT;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS recommendation_for_vc TEXT;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS previous_fundraise_inr NUMERIC(18,2);
ALTER TABLE founders ADD COLUMN IF NOT EXISTS previous_fundraise_orgs TEXT;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS current_burn TEXT;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS fund_ask_cr NUMERIC(12,2);
ALTER TABLE founders ADD COLUMN IF NOT EXISTS fundraise_commitments TEXT;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS fundraise_notes TEXT;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS fathom_link TEXT;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS current_problem TEXT;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS suggested_next_step TEXT;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS next_five_sprints TEXT;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS case_study_worthy BOOLEAN;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS case_study_theme TEXT;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS training_worthy BOOLEAN;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS training_theme TEXT;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS level TEXT;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS t_sprint_intervention TEXT;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS tasks TEXT;

-- Tracks which import created this founder row. The Summary page only shows
-- founders with source IN ('isb-summary', 'ju-summary'), so the curated lists
-- from the two Summary sheets stay clean even after the Sheet Tracking import
-- creates ~700 additional founder rows for tracking-only companies.
ALTER TABLE founders ADD COLUMN IF NOT EXISTS source TEXT;

CREATE INDEX IF NOT EXISTS founders_incubator_idx ON founders (incubator_id);
CREATE INDEX IF NOT EXISTS founders_source_idx    ON founders (source);

-- ───── GOOGLE TOKENS ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS google_tokens (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL UNIQUE,
  access_token   TEXT,
  refresh_token  TEXT,
  scope          TEXT,
  token_type     TEXT,
  expiry_date    TIMESTAMP WITH TIME ZONE,
  has_calendar   TEXT,
  has_gmail      TEXT,
  has_drive      TEXT,
  has_sheets     TEXT,
  google_email   TEXT,
  google_profile JSONB,
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- ───── First-admin bootstrap ──────────────────────────────────────────────
-- If users table has rows but no admin yet, promote the oldest user.
-- This ensures the first signup automatically becomes admin.
UPDATE users SET role = 'admin'
WHERE id = (SELECT id FROM users ORDER BY id ASC LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin');
