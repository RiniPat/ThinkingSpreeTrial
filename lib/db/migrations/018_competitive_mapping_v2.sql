-- 018_competitive_mapping_v2.sql
-- Competitive Mapping v2: 5-stage flow (Data Feed → Fencing → Prioritize →
-- Breakdown → Inspiration) + async jobs + progressive Google Sheet.
--
-- NOTE ON THE WIPE: run-migrations.mjs re-applies every .sql on every deploy and
-- relies on each statement being idempotent. A bare TRUNCATE would therefore
-- wipe data on EVERY deploy. We guard the one-time clean wipe behind a marker
-- table so it fires exactly once (the first deploy this migration lands on) and
-- never again.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'cm_v2_wipe_done') THEN
    -- Clean wipe of all competitive-mapping progress + saved data (one-time).
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'competitive_maps') THEN
      TRUNCATE competitive_maps RESTART IDENTITY;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'map_products') THEN
      TRUNCATE map_products RESTART IDENTITY;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'map_bmc') THEN
      TRUNCATE map_bmc RESTART IDENTITY;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'map_inspiration') THEN
      TRUNCATE map_inspiration RESTART IDENTITY;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'copilot_messages') THEN
      TRUNCATE copilot_messages RESTART IDENTITY;
    END IF;
    CREATE TABLE cm_v2_wipe_done (done boolean NOT NULL DEFAULT true);
    INSERT INTO cm_v2_wipe_done (done) VALUES (true);
  END IF;
END $$;

-- v2 columns on competitive_maps (idempotent).
ALTER TABLE competitive_maps ADD COLUMN IF NOT EXISTS landscape JSONB;
ALTER TABLE competitive_maps ADD COLUMN IF NOT EXISTS selected  JSONB;

-- Async job progress table.
CREATE TABLE IF NOT EXISTS map_jobs (
  id         SERIAL PRIMARY KEY,
  map_id     INTEGER NOT NULL,
  kind       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'queued',
  progress   INTEGER NOT NULL DEFAULT 0,
  total      INTEGER NOT NULL DEFAULT 0,
  message    TEXT,
  error      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS map_jobs_map_idx ON map_jobs(map_id);
