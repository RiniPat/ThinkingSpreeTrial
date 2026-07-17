# Sprint Automation Suite

Internal consultant workspace for **Thinking Spree** — a single sign-on portal where consultants manage founders, run T-Sprint sessions, and track engagement across ISB / JU / Demo programs with native Google Workspace integration.

## Deploy

👉 **[DEPLOY_TO_RENDER.md](./DEPLOY_TO_RENDER.md)** — full step-by-step guide. Free tier on Render + Neon Postgres. Total cost: **$0/month**.

👉 **[GOOGLE_INTEGRATION_SETUP.md](./GOOGLE_INTEGRATION_SETUP.md)** — wiring up Google Calendar, Gmail, Drive, and Sheets.

## What's in it

- **Sign in with Google** (primary) — `@thinkingspree.com` Workspace accounts only. One click grants Calendar/Gmail/Drive/Sheets access at the same time as login.
- **Email/password** (backup) — for accounts not yet on Workspace, with optional Google linking later via Settings.
- **Dashboard** — consultant-scoped view of your assigned sprints, today's schedule pulled live from Google Calendar.
- **Summary Sheet** — ISB / JU / Demo programs displayed as card grids with full venture detail (Goal Setting, Key Strength, Gap, Fund Ask, Case Study theme, etc.) across four detail tabs (Overview / Fundraising / Sprint History / Case & Training).
- **Sprint Tracking** — table view with Excel-parity filters (Industry, Stage, Program, Partner, Host, Co-Host, Session Type, Payment, Year, Quarter, Month, date range), sortable columns defaulting to most-recent-first. **Status is editable inline** — click the chip to mark a sprint Scheduled / Completed / Cancelled.
- **T-Sprints** — per-sprint detail page with pre/post email drafts (template-based by default; AI-generated when an OpenAI/Anthropic/Gemini API key is provided in env).
- **Admin tools** (sidebar shows these only for admins):
  - **Import Data** — drag-drop xlsx upload (`/admin/import`). Auto-detects ISB/JU/Sheet Tracking format. Append-only — re-uploading the same file never creates duplicates.
  - **Team Management** — promote consultants to admin, view who's connected to Google.
- **Settings → Google Integrations** — per-service connection status (Calendar / Gmail / Drive / Sheets) plus a Run Test button that hits each service to verify scopes work.

## How data flows in

The three Excel files (`ISB_Summary_Sheet.xlsx`, `JU_Summary_Sheet.xlsx`, `Sheet_Tracking.xlsx`) are **baked into the repo** at `scripts/seed-data/`. On the very first deploy to an empty database, the build automatically runs them. Subsequent deploys skip seeding because the `founders` table is no longer empty.

To **refresh data**, admins use `/admin/import` in the browser — no laptop, no terminal needed.

## Stack

- **Frontend** — React 19 + Vite 7 + Wouter + TanStack Query + Tailwind + shadcn/ui
- **Backend** — Express 5 + Drizzle ORM + Postgres-backed sessions (`connect-pg-simple`)
- **Auth** — Google OAuth 2.0 (primary) + email/password with bcryptjs (backup). `@thinkingspree.com` domain restriction.
- **DB** — Postgres on Neon free tier (0.5 GB)
- **File uploads** — `multer` + `xlsx`, parsed server-side via `@workspace/importer`
- **API contract** — OpenAPI 3.1 → Orval-generated TanStack Query hooks
- **Hosting** — Render free tier (750 hr/mo web service)

## Local development

```bash
# Prerequisites: Node 22+, pnpm 10+
corepack enable
corepack prepare pnpm@10.33.4 --activate

# Install
pnpm install

# Set up env
cp .env.example .env  # fill in DATABASE_URL, SESSION_SECRET, optionally GOOGLE_*

# Run the full build (also applies migrations + seeds if DB is empty)
pnpm run render:build

# Start the production server (both API + frontend on one port)
pnpm run render:start    # http://localhost:10000

# Or run dev mode (separate API + Vite dev server):
pnpm --filter @workspace/api-server run dev      # http://localhost:5000
pnpm --filter @workspace/thinking-spree run dev  # http://localhost:5173
```

## Repo layout

```
artifacts/
  api-server/        Express API + serves the React SPA in production
  thinking-spree/    Vite + React frontend
lib/
  api-spec/          OpenAPI 3.1 source + Orval codegen config
  api-client-react/  Generated TanStack Query hooks
  api-zod/           Generated Zod schemas
  db/                Drizzle schema + idempotent SQL migrations
  importer/          Shared xlsx-parsing logic (used by both seed + /admin/import)
scripts/
  run-migrations.mjs            Build-time migrator + first-deploy auto-seed
  src/seed-summary-sheets.ts    Manual seed runner
  src/seed-dry-run.ts           Parse-only validator (no DB writes)
  seed-data/                    The three xlsx files baked into the repo
```

## License

Proprietary — internal use only.
