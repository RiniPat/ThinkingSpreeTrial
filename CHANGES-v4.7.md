# v4.7 — Compressed Vision + new fields + redesigned Sprint Data

## Five changes you asked for

### 1. AI-summarised Vision (lazy)
"About the Startup" used to dump the full paragraph into the Vision section.
Now: the raw text is kept on the company record, but the Sprint Data tab
shows a card with a "Generate Vision with AI" button. On click, Gemini
summarises the raw paragraph into a crisp 2-3 sentence statement (≤60
words) and caches it on the company. Subsequent opens show the cached
summary — no extra Gemini quota.

When does the cache invalidate? When you Re-sync the sheet AND the raw
"About the Startup" text has changed. If you re-sync without changing
that tab, the cached summary is preserved.

### 2. Co-host parsed correctly
Previously the parser looked for a separate "TSprint organised by" row.
Now it walks the same row as "T-Sprint Consultants Assigned": column B
is the label, column C is the host, column D is the co-host. Falls back
to the old layout for backward-compat with older sheets.

### 3. New SMART Goals fields
Pulled from the SMART Goals and Financial tab:
- SMART Goal (3 months) → new card "SMART Goal — Next 3 Months"
- Actionable Tasks → new card "Actionable Tasks"

### 4. New Funding fields
Pulled from the Funding tab:
- Previous Fundraise (in CR) — shown as a stat cell
- Previous Fundraise Organisations — shown as sub-label under Previous Fundraise
- Current Burn — stat cell
- Runway — stat cell
- Fund Ask (in crores) — stat cell

### 5. Visually appealing Sprint Data tab
Complete redesign. The tab now has 5 visual sections:

  1. **Vision hero** — gradient card with gold accent, AI button if not yet generated
  2. **Strategic Direction** — SMART Goal + Actionable Tasks cards (violet & emerald accents)
  3. **SWOT Highlights** — side-by-side Strengths & Gaps (emerald & amber)
  4. **Recommendations** — side-by-side Mentor Connect & Market Access (indigo & rose)
  5. **Financials** — 4-column stat strip with icons

Each section header is a small uppercased label with an icon + horizontal
rule, so the eye can navigate quickly. Empty fields are silently omitted;
the tab only shows an empty state if NO field has data.

The raw parsed JSON is still available as a collapsible "debug" panel at
the bottom for power-user inspection.

## Database changes (migration `004_sprint_data_fields.sql`)

Four new columns, all idempotent:
- `founders.vision_raw` (TEXT)
- `founders.smart_goal_3_months` (TEXT)
- `founders.previous_fundraise_cr` (TEXT)
- `founders.runway` (TEXT)

`founders.previous_fundraise_orgs` and `founders.current_burn` already
existed from migration 001 — we write to them now.

## New API endpoint

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/companies/:id/summarise-vision` | Lazy AI summary of "About the Startup" |

Returns `{ vision: string, cached: boolean }`. Errors with 400 if the
raw text is empty.

## Deploy

`git push` → Render auto-deploys (~4 min). Migration 004 runs automatically
on boot. No new env vars (Gemini key is already set).

## After deploying — important: re-sync existing companies

Your existing companies were parsed before this version, so their new
fields are all empty. To populate them:

1. Open each company's detail page
2. Click **Re-sync from Sheet**
3. The new fields (SMART Goal, Funding details, raw vision text) pull in

## What to test

1. Re-sync an existing company → confirm co-host shows up in the header
2. Open Sprint Data tab → see the redesigned layout
3. Click "Generate Vision with AI" in the Vision card → 2-3 sentences appear
4. Verify Financials strip shows the 4 stat cells
5. Verify Strategic Direction shows SMART Goal and Actionable Tasks
