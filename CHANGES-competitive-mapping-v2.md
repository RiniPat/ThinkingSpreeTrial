# Competitive Mapping v2 — functionality rebuild

Reworks the Competitive Mapping feature from the old 7-stage prototype into a
lean **5-stage, Google-Sheet-first** research pipeline with real scraping, async
AI jobs, live progress, and a dashboard Research Copilot. All seeded/demo data
(the hardcoded EV / Quintinno run) is removed — every run is real, per company.

## The flow

| Stage | Who | What happens |
|------|-----|--------------|
| **Data Feed** | you | Enter company name, T-Sheet link, website (all required) + optional pitch deck. Scrapling crawls the site, the T-Sheet is ingested, Gemini writes the Company Overview, and the **"Research for [Company]" Google Sheet is created** with a styled Overview tab. |
| **Fencing** | AI (async) | Gemini maps the **industry landscape** — quantified, industry-appropriate metrics (not a fixed grid) + an exhaustive company list. Written to two sheet tabs. |
| **Prioritize** | you | Shortlist the companies worth a deep decode. |
| **Breakdown** | AI + Scrapling (async) | Per company: the AI tells Scrapling what to pull → Scrapling fetches the site + product imagery → the AI writes the full **46-column decode** (one row per product) → a dedicated sheet tab per company with `=IMAGE()` product shots. |
| **Inspiration** | you + AI | Pick 1–2 leaders who ran the same journey and out-scaled the company; the AI builds a phased timeline (product, positioning, funding, growth, customers) matching the reference format. |

The Google Sheet fills in **progressively** at every stage, so the consultant
watches it build live.

## Scraping model (no SERP key, no Python service required)

Discovery leans on **Gemini**; **Scrapling verifies + enriches** — it fetches the
real site, pulls readable copy + ranked product images/logo, and replies with
structured evidence the AI grounds on. A clean seam is in place: set
`SCRAPLING_SERVICE_URL` and requests are POSTed to a Python Scrapling sidecar
instead, with the rest of the pipeline unchanged.

## Async jobs

The two heavy stages (Fencing, Breakdown) run as lightweight **DB-backed
in-process jobs** (`map_jobs`) — no Redis/Bull. The route enqueues, fires the
work in the background, and returns a `jobId`; the UI polls
`GET /api/competitive-maps/jobs/:jobId` and renders a progress bar.

## Dashboard Research Copilot

A chat-first dock pinned to the dashboard: pick a saved run, ask anything, get
answers grounded in that run. Threads are saved (`copilot_messages`).

## Data / migration

`lib/db/migrations/018_competitive_mapping_v2.sql`:
- **One-time clean wipe** of all competitive-mapping tables, guarded behind a
  `cm_v2_wipe_done` marker table. This matters because `run-migrations.mjs`
  re-applies every `.sql` on every deploy — the guard ensures the wipe fires
  exactly once and never re-wipes on later deploys.
- Adds `landscape` + `selected` JSONB columns to `competitive_maps`.
- Adds the `map_jobs` table.

## Environment variables

| Var | Required? | Purpose |
|-----|-----------|---------|
| `GEMINI_API_KEY` | for AI output | All AI stages fall back to safe stubs without it. |
| Google OAuth connected (per consultant, in Settings) | for the sheet + T-Sheet | Sheet creation, progressive writes and T-Sheet ingest fail soft if not connected. |
| `SCRAPLING_SERVICE_URL` | optional | Point at a Python Scrapling sidecar (`POST /scrape`) to replace the built-in Node crawler. |
| `SCREENSHOT_API_TEMPLATE` | optional | Rendered product screenshots (used by the crawler's image ranking). |
| `CM_MODEL_HEAVY` / `CM_MODEL_LITE` | optional | Override the Gemini models for heavy vs light tasks. |

## Build

Verified green via the exact Render path (`tsc --build --force` →
`thinking-spree` build → `api-server` build). No new dependencies were added, so
`pnpm-lock.yaml` is unchanged.
