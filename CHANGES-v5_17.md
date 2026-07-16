# v5.17 — Pre-Sprint & lifecycle navigation

## Navigation
Sidebar is now the sprint **lifecycle**: Dashboard · Pre-Sprint · Post-Sprint ·
Sales · Admin. Old routes (`/summary`, `/builder`, `/companies`,
`/sprint-tracking`, `/reports/outcomes`, `/research`, `/sales/*`, `/admin/*`)
all still work.

## Pre-Sprint (new)  — `/pre-sprint`
- Intake: pitch-deck upload (PDF/DOCX/TXT), optional website, and company
  fields. **Auto-fill** reads the deck (+ website) with Gemini and pre-fills
  the profile; the consultant corrects rather than types.
- A Pre-Sprint company is a real `founders` row (`source='pre_sprint'`,
  `stage_workflow='pre_sprint'`), so it appears in Companies / Sprint Tracking
  immediately.
- Everything autosaves (on blur + tab-switch). Companies persist in a left
  rail and can be deleted (cascades their analyses).
- Four analysis tabs, each **generated once and cached** (shown permanently
  until *Regenerate*):
  - **Overview** — scannable snapshot from the company's own material.
  - **Research Tools** — ICP, TAM/SAM/SOM, Industry Landscape, BMC, seeded
    from the profile (no retyping).
  - **Market Potential** — grounded Blue/Red-Ocean concentration analysis with
    live sources.
  - **Demand Landscape** — state-level India choropleth (real GeoJSON, no new
    dependency) + global markets, with sources.
- Market figures are shown as sourced estimates flagged for verification.

## Post-Sprint  — `/post-sprint`
Hosts the **Inspiration Research** workbench (relocated from the old Research
tab). Quick-links keep Summaries, Builder, Growth Report, Companies and Sprint
Tracking reachable.

## Backend
- `lib/preSprintAi.ts` — profile extraction + Overview (ungrounded, faithful to
  the deck) and Blue/Red-Ocean + Demand Landscape (grounded via Google Search,
  graceful fallback to ungrounded).
- `lib/websiteText.ts` — url → text.
- `routes/preSprint.ts` — company CRUD, `/extract`, cached `/generate`.
- `research_outputs` gains 3 tool keys + a unique `(founder_id, tool)` index.
- `founders` gains `specialization`, `revenue_stage`, `website_url`,
  `deck_text`, `pre_sprint_profile` (migration 013 + Drizzle schema).

## Setup
1. `pnpm install`
2. `pnpm run typecheck`  (recommended before pushing)
3. run migration 013 (`node scripts/run-migrations.mjs` or `pnpm run render:migrate`)
4. Ensure `GEMINI_API_KEY` is set; enable Google Search grounding for live
   citations; allow outbound egress for website fetches.

The `india-states.geojson` map asset ships in `artifacts/thinking-spree/public/`.
