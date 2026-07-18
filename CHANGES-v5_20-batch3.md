# v5.20 — Batch 3 (Pre-Sprint: tabs + Demand Landscape heatmap)

## 1. Tab renames & tool move (`src/pages/pre-sprint.tsx`)
- Pre-Sprint tab **"Research Tools" → "Industry Landscape"**.
- **TAM / SAM / SOM moved** out of that tab into the **Market Potential** tab,
  which now shows two cards: Blue / Red Ocean and TAM / SAM / SOM (new
  `MarketPotential` component).
- The Industry Landscape tab now holds ICP Mapping, Industry Overview and
  Business Model Canvas. (The inner "Industry Landscape" card was relabelled
  **"Industry Overview"** so it doesn't clash with the tab name — one-line
  revert if you'd rather keep the old label.)

## 2. Demand Landscape → city-cluster heatmap with reach-out (both files)

### Frontend (`pre-sprint.tsx`)
Replaced the state-only choropleth with a **city / district hub heatmap**:
- India base map shaded faintly by state, with **city-hub pins** sized &
  coloured by ICP concentration (e.g. textile → Ludhiana, Amritsar, Surat,
  Tiruppur).
- **Hover a hub** → card shows **Key major players** in that cluster (no longer
  a bare "Demand" number).
- **Reach-out panel beside the map**: for the selected/hovered hub it lists the
  major players and **contacts** — decision-maker name/role, **LinkedIn**,
  **email** (mailto), and **company site** — whichever are publicly available.
- Ranked hub list under the map; click to drive the panel. Overseas regions
  shown as chips. Backward-compatible: older cached results still render (with a
  prompt to re-run for the new view).

### Backend (`src/lib/preSprintAi.ts`)
`generateDemandLandscape` reworked (still web-search grounded):
- New output types `CityCluster`, `ClusterPlayer`, `ClusterContact`; response now
  returns `clusters[]` (city, district, state, lat/lng, intensity 0-100, why,
  majorPlayers, contacts) alongside the state base layer.
- Prompt asks for 5-9 real industry hubs, 2-5 named major players each, and how
  to reach decision-makers (LinkedIn / site / **publicly-listed** email).
- **Honesty guardrails baked in:** the model is told never to fabricate emails
  or profiles, and the server strips any contact field that doesn't look like a
  real URL/email. Personal Gmail addresses of ICP heads are rarely public, so
  expect LinkedIn + company site + business email far more often than a personal
  inbox — the UI degrades gracefully and flags leads as "verify before outreach".

## Verified
Both files pass a TSX/TS parse. Route returns tool output as raw JSONB, so the
new fields flow through untouched. Run `pnpm run build` for a full typecheck.

## Note
Existing Demand Landscape results are cached per company; hit **Re-generate** on
that tab to produce the new city-cluster + contacts output.
