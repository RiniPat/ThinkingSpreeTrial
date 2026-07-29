# Competitive Mapping — fixes for the 7 reported issues (v5.22)

This patch makes the Competitive Mapping pipeline research the **company you
enter**, end to end — no more Quintinno Labs bleed-through — with real scraping,
real product images, a populated Company Overview, a working Inspiration tab, a
per-company Research Copilot, and saved runs you can reopen.

## Root causes found

1. **Every AI call was silently failing.** `competitiveMappingAi.ts` used model
   names `gemini-3.5-flash` / `gemini-3.5-flash-lite` / `gemini-3.6-flash`, which
   **don't exist**. Each call threw and fell back to a stub, so the UI kept its
   seeded Quintinno EV demo. Fixed to `gemini-2.5-flash` (heavy) /
   `gemini-2.5-flash-lite` (light), env-overridable, with a one-shot retry on a
   known-good model if a name is ever rejected.
2. **The Generate stage ignored live data.** `StageGenerate` read the module-level
   seed constants directly instead of `useData()` context, and hardcoded
   "Quintinno Labs" strings. It now reads live per-company research from context.
3. **No ingestion.** The overview only sent the company *name* to Gemini. It now
   ingests the scraped website, the T-Sheet, and the uploaded pitch deck.
4. **Scrapling was UI-only.** There was a button and a fake terminal but no
   backend crawl and no images. Added a real Node scraper.
5. **Nothing was persisted/revisitable.** The `map_products` / `map_inspiration`
   tables existed but were never written, and there was no list UI.

## What each reported issue maps to

1. **Sheet was hardcoded to Quintinno** → root causes 1 + 2. Fixed.
2. **Inspiration tab wouldn't generate** → root cause 1. `suggestInspiration` /
   `generateInspirationFor` now return real timelines; the stage passes the real
   overview and persists each timeline.
3. **Is Scrapling functional?** → New `artifacts/api-server/src/lib/scraper.ts`
   actually fetches the homepage + high-signal sub-pages (about / products /
   pricing), extracts readable text, and stores the fenced competitor rows in
   `map_products`. (Render has no headless browser, so this is a Node crawler
   doing Scrapling's *job* rather than the Python package — see "Notes".)
4. **Product images** → the scraper resolves a real image per company
   (`og:image` → Clearbit logo → Google favicon), the grid renders it (with a
   logo fallback), and the sheet embeds it via `=IMAGE("…")`.
5. **Empty Company Overview** → `generateOverview` now receives
   `{ websiteText, sheetText, deckText }` and is told to write from that
   evidence. The Data Feed deck box is now a **real** PDF/DOCX upload that runs
   through the existing `extractTextFromUpload` (unpdf + Gemini OCR fallback).
6. **Copilot hardcoded to Quintinno** → root cause 1 for the backend; the dock's
   suggestions and the offline fallback now use the real subject company.
7. **Revisit past research** → new `GET /api/competitive-maps` (list) and
   `GET /api/competitive-maps/:id` (full run). Fencing rows and inspiration
   timelines are persisted; the Data Feed shows a **"Your saved research"** panel —
   click any company to reopen it with its overview, grid, and timelines rehydrated.

## Files

Added:
- `artifacts/api-server/src/lib/scraper.ts`

Changed:
- `artifacts/api-server/src/lib/competitiveMappingAi.ts` (model fix + retry + ingestion-aware overview)
- `artifacts/api-server/src/routes/competitiveMapping.ts` (ingestion, image resolution, persistence, list/detail, deck upload, `=IMAGE()`)
- `artifacts/thinking-spree/src/pages/competitive-mapping.tsx` (context-driven Generate, real images, dynamic Copilot, real deck upload, Saved Research panel)

No DB change needed — migration `017_competitive_mapping.sql` already creates the
tables and runs idempotently on deploy.

## New / changed endpoints

```
POST /api/competitive-maps                 scrape + overview + directions (now ingests site/sheet/deck)
POST /api/competitive-maps/ingest-deck     multipart PDF/DOCX → extracted text
POST /api/competitive-maps/fence           grid + real images, persisted to map_products
GET  /api/competitive-maps                 list this consultant's saved runs
GET  /api/competitive-maps/:id             one saved run (overview + rows + inspiration)
POST /api/competitive-maps/inspiration     now persists to map_inspiration
```

## Deploy notes

- **`GEMINI_API_KEY` must be set** on the API service. Without it, the AI stages
  fall back to safe stubs and Fencing can't populate (so the seeded demo shows).
  This is the single most important env var for making per-company research work.
- **Google must be connected** (Settings → Google) for T-Sheet ingestion and for
  the Generate-Sheet step; both fail soft if it isn't.
- Optional model override: set `CM_MODEL_HEAVY` / `CM_MODEL_LITE` to upgrade
  (e.g. `CM_MODEL_HEAVY=gemini-2.5-pro`).
- The Generate step now writes with `valueInputOption: USER_ENTERED` so `=IMAGE()`
  renders as an actual picture in the Product Image column.

## Notes

- **"Scrapling" naming.** The UI keeps the Scrapling branding, but the crawl runs
  in Node (global `fetch` + light HTML parsing) because Render has no headless
  browser and the suite is TypeScript, not Python. It performs the same job —
  fetch, parse, extract text + imagery, and persist. If you later want the actual
  Python Scrapling package for JS-rendered pages and true screenshots, stand it up
  as a sidecar service and point `scraper.ts` at it; the wiring (one function,
  `scrapeCompanyProfile`) is isolated so the swap is small.
- Re-fencing a run replaces its stored rows (idempotent), so you can iterate.

## Update — real product-image scraping

Scrapling now pulls **actual product images off each competitor's site**, not just
a logo. For every company it visits the homepage plus about/products/pricing,
reads `<img>` (including `srcset`, `data-src`, and lazy-load attributes) together
with `og:image` / `twitter:image`, makes every URL absolute, throws out icons,
sprites, tracking pixels, payment badges, and social glyphs, then ranks what's
left by size hints, position on the page, and product-y keywords
(`product`, `screenshot`, `hero`, `dashboard`, `app`, `mockup`, `gallery`…).

- The fence step now returns a **ranked list** of images per company, not one URL.
  The grid's `ProductImage` walks that list — if the top image 404s or hotlink-blocks,
  it automatically tries the next, and only falls back to the Clearbit logo tile if
  every candidate fails. The generated sheet embeds the best image via `=IMAGE()`.
- The full list is persisted in `map_products.data.images`, so reopening a saved
  run shows the same imagery without re-scraping.

Optional true screenshots: set `SCREENSHOT_API_TEMPLATE` to a screenshot-service
URL containing a literal `{url}` placeholder (e.g. a thum.io / screenshotone /
urlbox endpoint). When set, a rendered screenshot is ranked first for every
company; when unset, nothing is called and there's no cost or dependency. This is
the seam for plugging in a headless-browser service later without touching the
pipeline.

Note: some sites block hotlinking or serve images only to a real browser, so a
logo fallback can still appear for those — the list-with-fallback design means one
stubborn site never leaves the cell blank.
