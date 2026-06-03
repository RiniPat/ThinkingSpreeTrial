-- ───────────────────────────────────────────────────────────────────────────
-- Migration 003 — Google Sheets ingestion
--
-- Adds founders.source_sheet_url so we can remember which sheet a company
-- was ingested from and re-sync later without the consultant pasting it again.
--
-- Idempotent.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE founders ADD COLUMN IF NOT EXISTS source_sheet_url TEXT;
