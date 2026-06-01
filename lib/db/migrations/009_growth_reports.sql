-- ───────────────────────────────────────────────────────────────────────────
-- Migration 009 — Growth Reports (Builder, Phase A) — v5.4
--
-- Stores the multi-step state of a Growth Report:
--   1. Inputs (extracted text only — raw files discarded after extraction)
--   2. Anchors (JSON) — the consultant can edit these before report generation
--   3. Final report (JSON sections + DOCX bytes)
--
-- One row per report; status drives which step the UI shows on resume.
-- Idempotent.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS growth_reports (
  id                     SERIAL PRIMARY KEY,
  user_id                INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- Required-on-create:
  startup_name           TEXT NOT NULL,
  cohort                 TEXT,                          -- for grouping in the library
  tsheet_link            TEXT NOT NULL,
  -- Status drives which step the UI shows:
  --   'drafting'        — uploads accepted, anchors not yet extracted
  --   'anchors_ready'   — anchors extracted, awaiting consultant edits
  --   'report_ready'    — journey report generated; DOCX available
  --   'failed'          — extraction or generation errored; see error_message
  status                 TEXT NOT NULL DEFAULT 'drafting',
  error_message          TEXT,
  -- Extracted text (raw uploads themselves are discarded):
  strategic_canvas_text  TEXT,
  fathom_1_text          TEXT,
  fathom_2_text          TEXT,
  checkin_text           TEXT,
  num_sprints            INTEGER NOT NULL DEFAULT 1,
  -- Anchors (the structured output of Prompt 1). JSON shape defined by
  -- the GrowthReportAnchors type in growthReportAi.ts.
  anchors                JSONB,
  -- Final report sections (the output of Prompt 2). JSON shape defined by
  -- the JourneyReport type in growthReportAi.ts.
  report                 JSONB,
  -- The assembled DOCX (binary, base64-encoded for transport simplicity).
  -- ~50-200 KB typical; bounded by the report structure.
  docx_b64               TEXT,
  created_at             TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS growth_reports_user_idx   ON growth_reports (user_id);
CREATE INDEX IF NOT EXISTS growth_reports_cohort_idx ON growth_reports (cohort);
CREATE INDEX IF NOT EXISTS growth_reports_status_idx ON growth_reports (status);
