-- 025_sales_followup_context.sql
-- Sales · Follow-up enrichment context + submitted docs.
--
-- One enrichment row per follow-up (keyed by client_key so it lines up with
-- every `:key` route), plus a child table for the zero-to-many docs the
-- consultant submits (Google Doc links and/or uploaded files stored in Drive).
-- Summaries are denormalised as text — the cheapest thing that feeds a prompt.
--
-- Also stores the Growth Prospects brief (§11) JSON + rendered Drive refs so
-- the consultant can re-render without another LLM call.
--
-- Idempotent (run-migrations.mjs re-applies every migration on every deploy).

CREATE TABLE IF NOT EXISTS sales_followup_context (
  client_key            text PRIMARY KEY,
  t_sheet_url           text,
  t_sheet_summary       text,
  docs_summary          text,          -- combined summary across ALL submitted docs
  enrichment_status     text,          -- 'idle' | 'running' | 'ok' | 'partial' | 'error'
  enrichment_error      text,
  enriched_at           timestamptz,

  -- Growth Prospects document (§11). Persisted so it is editable + re-renderable.
  growth_brief          jsonb,         -- GrowthProspectsBrief JSON (LLM output, consultant-editable)
  growth_docx_url       text,          -- Drive webViewLink of the rendered DOCX
  growth_docx_file_id   text,          -- Drive fileId of the DOCX
  growth_pdf_url        text,          -- Drive webViewLink of the rendered PDF (best-effort)
  growth_pdf_file_id    text,          -- Drive fileId of the PDF
  growth_generated_at   timestamptz,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Zero-to-many docs the consultant submits for a follow-up. Google Doc links
-- and/or uploaded files. Optional — a follow-up may have none.
CREATE TABLE IF NOT EXISTS sales_followup_docs (
  id             serial PRIMARY KEY,
  client_key     text NOT NULL,
  source_type    text NOT NULL,     -- 'gdoc' | 'upload'
  url            text,              -- Google Doc URL (source_type='gdoc') OR Drive webViewLink of the stored upload
  drive_file_id  text,              -- Drive fileId (uploads are stored in Google Drive)
  title          text,
  extracted_text text,              -- raw text pulled from the doc
  status         text,              -- 'ok' | 'error'
  error          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_followup_docs_client_key_idx
  ON sales_followup_docs (client_key);
