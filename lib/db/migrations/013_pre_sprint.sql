-- 013_pre_sprint.sql
-- Pre-Sprint intake: extend the existing `founders` (companies) table so a
-- company created from the Pre-Sprint page is the SAME row that shows up in
-- Companies / Sprint Tracking. No new "pre_sprint_companies" table — a company
-- exists once, and its stage_workflow tells you where it is in the lifecycle.
--
-- Idempotent: safe to re-run.

ALTER TABLE founders ADD COLUMN IF NOT EXISTS specialization      text;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS revenue_stage       text;
ALTER TABLE founders ADD COLUMN IF NOT EXISTS website_url         text;

-- Cached plain-text extraction of the uploaded pitch deck (+ website). Stored
-- so every analysis tab reads the deck ONCE — we never re-parse the PDF per
-- tool, and the AI always works from the same source of truth.
ALTER TABLE founders ADD COLUMN IF NOT EXISTS deck_text           text;

-- The AI-extracted / consultant-corrected company profile used to auto-fill
-- the intake form and seed every generator. JSONB so the shape can evolve
-- without a migration.
ALTER TABLE founders ADD COLUMN IF NOT EXISTS pre_sprint_profile  jsonb;

-- Fast lookup of "my saved Pre-Sprint companies".
CREATE INDEX IF NOT EXISTS founders_source_idx        ON founders (source);
CREATE INDEX IF NOT EXISTS founders_stage_workflow_idx ON founders (stage_workflow);

-- One cached research artefact per (company, tool). Generating an analysis
-- (Industry Landscape, BMC, Blue/Red Ocean, …) writes here and is shown
-- permanently; "Regenerate" replaces the row rather than stacking duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS research_outputs_company_tool_uidx
  ON research_outputs (founder_id, tool)
  WHERE founder_id IS NOT NULL;
