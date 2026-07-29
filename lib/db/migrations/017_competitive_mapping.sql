-- 017_competitive_mapping.sql — Competitive Mapping tables
CREATE TABLE IF NOT EXISTS competitive_maps (
  id                   SERIAL PRIMARY KEY,
  consultant_id        INTEGER,
  company_name         TEXT NOT NULL,
  website              TEXT,
  tsheet_url           TEXT,
  deck_file_id         TEXT,
  status               TEXT NOT NULL DEFAULT 'scraping',
  direction            TEXT,
  overview             JSONB,
  generated_sheet_id   TEXT,
  generated_sheet_url  TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS map_products (
  id            SERIAL PRIMARY KEY,
  map_id        INTEGER NOT NULL,
  sr_no         INTEGER NOT NULL,
  company       TEXT NOT NULL,
  product       TEXT NOT NULL,
  image_url     TEXT,
  seg           TEXT,
  scaled_beyond BOOLEAN NOT NULL DEFAULT FALSE,
  data          JSONB NOT NULL,
  selected      BOOLEAN NOT NULL DEFAULT FALSE,
  rank          INTEGER
);
CREATE INDEX IF NOT EXISTS map_products_map_idx ON map_products(map_id);
CREATE TABLE IF NOT EXISTS map_bmc (
  id         SERIAL PRIMARY KEY,
  map_id     INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  blocks     JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS map_inspiration (
  id           SERIAL PRIMARY KEY,
  map_id       INTEGER NOT NULL,
  company_name TEXT NOT NULL,
  phases       JSONB NOT NULL,
  ai_generated BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS copilot_messages (
  id            SERIAL PRIMARY KEY,
  map_id        INTEGER NOT NULL,
  role          TEXT NOT NULL,
  focus_company TEXT,
  content       JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS copilot_messages_map_idx ON copilot_messages(map_id);
