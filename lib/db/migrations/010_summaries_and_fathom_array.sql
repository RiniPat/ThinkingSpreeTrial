-- v5.5 — Phase B Summary Builder + dynamic Fathom transcripts
--
-- 1. Add fathom_texts JSONB array to growth_reports. We keep the old
--    fathom_1_text / fathom_2_text columns for back-compat; the API will
--    write to BOTH (first two entries of the array mirror old columns).
--    Reads prefer the JSONB array when present.
--
-- 2. New wadhwani_summaries table — Phase B mode for Wadhwani Foundation
--    summary sheet entries. Pulls from T-Sheet + Fathom + Sprint Tracking.

ALTER TABLE growth_reports
  ADD COLUMN IF NOT EXISTS fathom_texts JSONB;

-- One-time backfill: if fathom_texts is null but old columns exist,
-- populate the array from the legacy fields. Drops nulls.
UPDATE growth_reports
   SET fathom_texts = (
     SELECT jsonb_agg(t) FROM (
       SELECT fathom_1_text AS t WHERE fathom_1_text IS NOT NULL
       UNION ALL
       SELECT fathom_2_text WHERE fathom_2_text IS NOT NULL
     ) s
   )
 WHERE fathom_texts IS NULL
   AND (fathom_1_text IS NOT NULL OR fathom_2_text IS NOT NULL);

-- Phase B — Wadhwani Foundation Summary Builder
CREATE TABLE IF NOT EXISTS wadhwani_summaries (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER,
  startup_name    TEXT NOT NULL,
  cohort          TEXT,
  tsheet_link     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'drafting',
  error_message   TEXT,

  -- Data pulled from the T-Sheet directly (verbatim, not AI-extracted)
  founder_name    TEXT,
  host            TEXT,
  co_host         TEXT,
  goal            TEXT,
  vp1_date        TEXT,
  vp2_date        TEXT,

  -- AI-extracted from Fathom transcripts
  fathom_texts    JSONB,
  current_revenue TEXT,
  industry_detail TEXT,
  critical_venture TEXT,
  ts_connects     TEXT,
  ts_support      TEXT,

  -- User-chosen from dropdowns
  industry        TEXT,
  tg              TEXT,
  funding         TEXT,

  -- Output: filled when status = 'written_to_sheet'
  sheet_row_index INTEGER,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wadhwani_summaries_user
  ON wadhwani_summaries(user_id);
CREATE INDEX IF NOT EXISTS idx_wadhwani_summaries_cohort
  ON wadhwani_summaries(cohort);
CREATE INDEX IF NOT EXISTS idx_wadhwani_summaries_status
  ON wadhwani_summaries(status);
