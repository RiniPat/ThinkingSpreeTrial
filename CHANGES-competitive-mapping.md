# Competitive Mapping — added to the Suite

A new **Competitive Mapping** tab: a 7-stage competitive-research pipeline
(Data Feed → Company Overview → Fencing → Prioritize → Breakdown → Inspiration →
Generate Sheet) that ends by writing a *TS Research for {company}* workbook to
the consultant's Google Drive.

## Files added

- `artifacts/thinking-spree/src/pages/competitive-mapping.tsx` — the feature UI,
  wrapped in the standard `Layout`. Uses the suite's navy/ivory/gold identity.
- `artifacts/api-server/src/routes/competitiveMapping.ts` — API: create run,
  saved Research Copilot chat, Google-Sheet generation.
- `artifacts/api-server/src/lib/competitiveMappingAi.ts` — Gemini routing:
  light → `gemini-3.5-flash-lite`, heavy → `gemini-3.5-flash` (one-constant swap
  to `gemini-3.6-flash`). Uses the existing `@google/generative-ai` SDK.
- `lib/db/src/schema/competitiveMaps.ts` — 5 tables (maps, products, bmc,
  inspiration, copilot messages).
- `lib/db/migrations/017_competitive_mapping.sql` — matching migration.

## Files edited

- `artifacts/thinking-spree/src/App.tsx` — added the `/competitive-mapping` route.
- `artifacts/thinking-spree/src/components/Layout.tsx` — added the sidebar entry
  (Radar icon), sitting under Research.
- `artifacts/api-server/src/routes/index.ts` — mounted the router.
- `lib/db/src/schema/index.ts` — exported the new schema.

## Run the migration

The suite auto-runs migrations on deploy to an empty DB; to apply to an existing
DB, run `017_competitive_mapping.sql` (or `pnpm drizzle-kit` per your flow).

## What's live vs seeded

- **Research Copilot** — fully live. Persists per map (`copilot_messages`);
  answers come from **Gemini 3.5 Flash** when `GEMINI_API_KEY` is set, and from a
  built-in deterministic analysis otherwise (so it never hard-fails).
- **Generate Sheet** — fully live. Creates + populates a real Google Sheet in the
  consultant's Drive via the existing Google OAuth (Sheets + Drive scopes).
- **Scrape / Fencing / BMC data** — currently a seeded EV dataset in the page so
  the flow is demoable end-to-end. Wiring these to the Scrapling sidecar + a
  background job runner (flipping `competitive_maps.status`, which the UI already
  polls) is the next step.

## Follow-ups (marked TODO in code)

- Loop closers in `/competitive-maps/generate`: push the overview to the
  **Summary** tab and append the company to **Sprint Tracking** (mirror the
  writers in `admin-import`).
- Background scrape/fence jobs + the Scrapling sidecar.

Nothing in the existing app was removed or behaviourally changed; this is purely
additive.
