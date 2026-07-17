-- 014_email_templates.sql
-- Consultant-authored email templates for the Emails tab (Pre-Sprint &
-- Post-Sprint composers). Workspace-wide library, no seed rows: it starts
-- empty and each template lives until explicitly deleted.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS email_templates (
  id         serial PRIMARY KEY,
  kind       text NOT NULL,                                  -- 'pre' | 'post'
  name       text NOT NULL,
  body       text NOT NULL,
  created_by integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_templates_kind_idx ON email_templates (kind);
