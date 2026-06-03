-- ───────────────────────────────────────────────────────────────────────────
-- Migration 006 — Research & Sales workspace
--
-- Adds:
--   • users.role expanded — supports 'consultant' | 'sales' | 'research' | 'admin'.
--     Existing 'user' rows are migrated to 'consultant' (semantically equivalent).
--   • research_outputs   — generic table for AI-generated research artefacts
--     (customer segmentation, ICP, TAM/SAM/SOM, industry landscape, BMC).
--   • sales_leads        — CRM-lite tracker for the sales team.
--   • proposals          — hybrid proposal builder (sections JSON + AI-filled bodies).
--
-- All operations are idempotent.
-- ───────────────────────────────────────────────────────────────────────────

-- ─── ROLES ────────────────────────────────────────────────────────────────
-- Existing users may have role='user' or 'admin'. We migrate 'user' → 'consultant'
-- so the new role system is consistent. The actual column stays TEXT (no enum
-- constraint) so future additions don't require a DB migration.
UPDATE users SET role = 'consultant' WHERE role = 'user';

-- ─── RESEARCH OUTPUTS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS research_outputs (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- Tool that produced this. One of:
  --   'customer_segmentation' | 'icp_mapping' | 'tam_sam_som'
  --   | 'industry_landscape'  | 'business_model_canvas'
  tool         TEXT NOT NULL,
  -- Optional link to an existing company (Companies / founders.id).
  -- NULL when the consultant ran the tool in standalone mode against a
  -- prospect that isn't in the DB.
  founder_id   INTEGER REFERENCES founders(id) ON DELETE SET NULL,
  -- Free-text label so consultants can find this output later (e.g.
  -- "ICP for prospective EdTech startup").
  title        TEXT NOT NULL,
  -- Inputs that produced the output. JSON shape varies per tool; we store
  -- it so we can re-run with the same inputs later (regenerate button).
  inputs       JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Structured AI output. JSON shape varies per tool; the frontend knows
  -- how to render each tool's shape.
  output       JSONB,
  -- Any consultant edits on top of the AI output, kept separate so we can
  -- show "AI version" vs "edited version" if needed.
  notes        TEXT,
  created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS research_outputs_user_idx   ON research_outputs (user_id);
CREATE INDEX IF NOT EXISTS research_outputs_tool_idx   ON research_outputs (tool);
CREATE INDEX IF NOT EXISTS research_outputs_founder_idx ON research_outputs (founder_id);

-- ─── SALES LEADS (CRM-lite) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales_leads (
  id            SERIAL PRIMARY KEY,
  owner_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  company_name  TEXT NOT NULL,
  contact_name  TEXT,
  contact_email TEXT,
  contact_role  TEXT,
  linkedin_url  TEXT,
  -- Stage values: 'cold' | 'contacted' | 'meeting_booked' | 'proposal_sent' | 'won' | 'lost'
  stage         TEXT NOT NULL DEFAULT 'cold',
  source        TEXT,                -- where this lead came from (inbound / referral / cold)
  notes         TEXT,
  last_touch_at TIMESTAMP WITH TIME ZONE,
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sales_leads_owner_idx ON sales_leads (owner_id);
CREATE INDEX IF NOT EXISTS sales_leads_stage_idx ON sales_leads (stage);

-- ─── PROPOSALS ───────────────────────────────────────────────────────────
-- Hybrid: user provides the section structure, AI fills each section's body.
-- Stored as a JSON array of { heading, body, ai_generated } objects.
CREATE TABLE IF NOT EXISTS proposals (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  lead_id         INTEGER REFERENCES sales_leads(id) ON DELETE SET NULL,
  prospect_name   TEXT NOT NULL,
  prospect_company TEXT NOT NULL,
  brief           TEXT,                       -- high-level brief that informs all sections
  sections        JSONB NOT NULL DEFAULT '[]'::jsonb,
  status          TEXT NOT NULL DEFAULT 'draft', -- 'draft' | 'final'
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS proposals_user_idx ON proposals (user_id);
CREATE INDEX IF NOT EXISTS proposals_lead_idx ON proposals (lead_id);
