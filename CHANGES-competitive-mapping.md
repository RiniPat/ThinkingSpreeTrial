# Competitive Mapping — now functional for ANY company

A new **Competitive Mapping** tab: a 7-stage competitive-research pipeline
(Data Feed → Company Overview → Fencing → Prioritize → Breakdown → Inspiration →
Generate Sheet). The pipeline is **data-driven** — enter any company and the
backend generates real research with Gemini. Nothing is hardcoded to one company.

## How it works now

1. **Data Feed** — enter a company name (+ optional website / T-Sheet). On "Run",
   the backend calls Gemini and returns a real **Company Overview** for that
   company, plus 3 suggested research directions.
2. **Fencing** — the chosen direction is sent to Gemini, which returns 15+
   product-level competitor rows across 10+ companies, filling the 46-column
   research grid and flagging those that have **scaled beyond** the subject.
3. **Prioritize** — the consultant selects/ranks products (product-level).
4. **Breakdown** — a BMC is generated per selected product on demand.
5. **Inspiration** — the backend suggests aspirational-giant timelines, and
   "+ Add company" generates a timeline for any company entered.
6. **Generate Sheet** — writes a populated Google Sheet to the consultant's Drive.

All AI runs through Gemini 3.5 routing: light → `gemini-3.5-flash-lite`,
heavy → `gemini-3.5-flash` (swap the constant in `competitiveMappingAi.ts` to
`gemini-3.6-flash` to upgrade). **Requires `GEMINI_API_KEY`** (the suite already
uses it). Without a key, every stage falls back to a safe stub / the seeded EV
demo so the UI never breaks — but real per-company research needs the key set.

## Files

Added:
- `artifacts/thinking-spree/src/pages/competitive-mapping.tsx` — data-driven UI
  (React context populated from the backend; seeded EV data only as fallback).
- `artifacts/api-server/src/lib/competitiveMappingAi.ts` — Gemini generators:
  overview, directions, fencing grid, BMC, inspiration, copilot.
- `artifacts/api-server/src/routes/competitiveMapping.ts` — endpoints for each
  generator + saved copilot + Google-Sheet generation.
- `lib/db/src/schema/competitiveMaps.ts` + `lib/db/migrations/017_competitive_mapping.sql`.

Edited (additive only):
- `App.tsx` (route), `Layout.tsx` (sidebar entry), `routes/index.ts` (mount),
  `lib/db/src/schema/index.ts` (export).

## Endpoints

```
POST /api/competitive-maps                     -> { id, overview, directions }
POST /api/competitive-maps/fence               -> { rows }        (15+ competitors)
POST /api/competitive-maps/bmc                 -> { blocks }      (one product's BMC)
POST /api/competitive-maps/inspiration/suggest -> { items }       (2 giants)
POST /api/competitive-maps/inspiration         -> { who, phases } (one company)
GET/POST /api/competitive-maps/:id/copilot     -> saved chat
POST /api/competitive-maps/generate            -> { url }         (Google Sheet)
```

## Notes

- Generation runs synchronously inside the request. Overview ~5-15s, Fencing
  ~15-40s (15+ rows). Fine on Render; if you hit a proxy timeout, move Fencing to
  a background job that flips `competitive_maps.status` (the UI already advances
  on completion; wiring a poll is straightforward).
- The Scrapling sidecar is optional — Gemini alone makes this functional today;
  Scrapling adds freshness/grounding later.
- Run migration `017_competitive_mapping.sql`.
