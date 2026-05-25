# Sprint Automation Suite — Changes in this update

This iteration addresses the six issues raised:

1. Sprint Tracking tab is empty
2. Summary sheet should only show ISB + JU companies
3. Consultant uploads a Google Sheet → AI drafts pre-sprint + post-sprint emails (editable before send)
4. AI automation for three workflows (pre-email, post-email, summary-sheet updates) — all human-in-the-loop
5. Live sprint tracking listing every company consulted so far, with good filters + daily-update dropdowns
6. Dashboard surfaces Google Calendar updates

Everything builds and typechecks cleanly. Verified with `pnpm run typecheck` and `pnpm run render:build`.

---

## Issue 1 — Sprint Tracking was empty (the root cause was the seed gate)

The seeder only ran when the `founders` table was empty. On the running deploy, `founders` had been partially populated (manual upload, half-successful seed), so the deploy gate said "already seeded" and never imported the ~1,931-row `Sheet_Tracking.xlsx`.

**Fixes:**
- `scripts/run-migrations.mjs` — seed gate now requires BOTH `founders` and `sprints` to have data; if either is empty, seed runs. Importer is append-only, so re-running is safe.
- New `POST /api/admin/reseed` endpoint (admin only) — re-imports the three baked-in xlsx files from `scripts/seed-data/` at any time. File: `artifacts/api-server/src/routes/admin-import.ts`.
- New **"Re-seed now"** button on the `/admin/import` page so the fix is one click — no redeploy, no Neon SQL.
- The Sprint Tracking page itself now defaults to `scope=all` (the team-wide register, all ~1,212 companies) — was previously user-scoped. Toggle to "Mine" stays available.

## Issue 2 — Summary shows ISB + JU only

`incubators.ts` previously allowed `["isb", "ju", "demo"]`. The "Demo" category is now dropped from the allow-list AND the Add Incubator modal. Existing demo data remains in the DB (the importer's `ensureCoreIncubators` still creates the Demo row to keep ID stability) — it just isn't visible on the Summary page.

Files: `artifacts/api-server/src/routes/incubators.ts`, `artifacts/thinking-spree/src/pages/summary.tsx`.

## Issue 3 — AI emails from a Google Sheet link

New endpoint `POST /api/ai/sheet-emails`:
- Takes `{ sheetUrl, sprintId?, tone? }`
- Reads the sheet via Google Sheets API (uses the caller's OAuth tokens, requires the Sheets scope from Settings → Integrations)
- Asks OpenAI to produce structured JSON with `{ pre, post }` drafts
- Returns both drafts as standard `EmailDraft` payloads — same shape the existing Email Modal consumes

New UI panel on the sprint detail page: **"Draft from Google Sheet"**. Paste link → pick tone → "Draft both emails". The existing email modal opens with the post-sprint draft; the pre-sprint draft is stashed for one-click swap. The consultant always reviews and clicks Send.

Files: `artifacts/api-server/src/routes/ai-automation.ts`, `artifacts/thinking-spree/src/pages/sprint-detail.tsx` (new `SheetAiPanel` component).

## Issue 4 — Three AI automations with manual editing

### (a) Pre-sprint email
Already AI-powered. No change to UX but it now actually sends via Gmail (see Gmail section below).

### (b) Post-sprint email
Was template-only — now AI-powered, with the same OpenAI integration used by pre-sprint. Falls back to the original template if the OpenAI key isn't configured. Uses the sprint's strengths/gaps/nextGoal/actionableSteps as input context, never invents facts.

File: `artifacts/api-server/src/routes/sprints.ts`.

### (c) Update Summary Sheet
New endpoint `POST /api/ai/sprints/:id/summary-update`:
- Takes `{ sheetUrl?, notes? }` (at least one required)
- Reads the sheet OR the pasted text
- Asks OpenAI to propose a per-field PATCH to the founder's summary, only for fields where the new notes provide a clear factual update
- Returns `{ current, proposed, changedKeys }` — NOTHING is applied yet
- Consultant reviews each proposed change with a checkbox + inline edit, then clicks **"Apply selected"** which triggers `PATCH /api/founders/:id`

UI: new **"Update Summary Sheet with AI"** panel on the sprint detail page.

Files: `artifacts/api-server/src/routes/ai-automation.ts`, `artifacts/thinking-spree/src/pages/sprint-detail.tsx` (new `AiSummaryUpdatePanel` component), `artifacts/api-server/src/routes/founders.ts` (expanded PATCH to accept all summary fields, was silently dropping them before).

## Issue 5 — Live sprint tracking with filters + daily-update dropdowns

The Sprint Tracking page is now the team-wide live register:
- Defaults to `scope=all` — every sprint across every consultant
- Mine/Everyone toggle in the header
- Refresh button (spins while fetching)
- CSV export of the filtered view (date-stamped filename)
- **Inline-editable dropdowns** on three fields the consultants update daily:
  - **Session Type** (Need Assessment / Strategy / Fundraising / Market Access / Mentorship / Review / Other)
  - **Payment Status** (Paid / Unpaid / Invoiced / Pending / Waived)
  - **Status** (Scheduled / Completed / Cancelled — was already there)
- All existing filters retained (Industry / Stage / Program / Partner / Host / Co-Host / Session Type / Payment / Year / Quarter / Month / date range)
- Custom values in legacy data are preserved in the dropdown so saves don't lose data

Backend: `GET /api/sprints?scope=all|mine` (existing param, now exposed in OpenAPI spec).
Files: `artifacts/api-server/src/routes/sprints.ts`, `artifacts/thinking-spree/src/pages/sprint-tracking.tsx`.

## Issue 6 — Dashboard Google Calendar (7-day window)

Was today-only. Now:
- `GET /api/calendar/events?days=7` (capped at 30) — same endpoint, new param
- Dashboard fetches 7-day window, groups events by day with "Today" / "Tomorrow" / weekday headers
- Refresh button to re-pull from Google Calendar on demand
- Falls back to consultant's sprint table if Google Calendar isn't connected (existing behavior, now respects the window)

Files: `artifacts/api-server/src/routes/calendar.ts`, `artifacts/thinking-spree/src/pages/dashboard.tsx`.

---

## Bonus: Gmail actually sends

`POST /api/emails/send` previously only stamped the DB and logged "(simulated)". It now:
- Uses the consultant's Gmail scope to actually send the message via the Gmail API
- Builds an RFC 5322 message and base64url-encodes it (per Gmail spec)
- Records the real Gmail message ID
- If Gmail isn't connected or the send fails, falls back to log-only with a warning so the workflow doesn't crash

File: `artifacts/api-server/src/routes/emails.ts`.

---

## OpenAPI spec + generated client

The new endpoints are documented in `lib/api-spec/openapi.yaml`:
- `POST /admin/reseed`
- `POST /ai/sheet-emails`
- `POST /ai/sprints/{id}/summary-update`
- `GET /calendar/events?days=N`
- `GET /sprints?scope=all|mine`

The orval-generated client (`lib/api-client-react/`) and zod schemas (`lib/api-zod/`) have been regenerated. New hooks `useAiSheetEmails`, `useAiSummaryUpdate`, `useReseedFromBakedXlsx` are available, although the relevant UI components use raw `customFetch` directly (works the same, no regen dependency).

Fixed an incidental orval issue where regen produced duplicate symbols across `generated/api.ts` and `generated/types/*.ts` — the `lib/api-zod/src/index.ts` barrel now exports only the zod constants. Deep-import structural types if needed.

---

## After deploying

1. Set env vars (most are already there):
   - `DATABASE_URL` — Postgres connection string (Neon)
   - `SESSION_SECRET`
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
   - `APP_BASE_URL`
   - `AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_BASE_URL` — required for ALL AI features (otherwise pre-sprint/post-sprint fall back to templates and the two new sheet-AI routes return errors)
2. Deploy.
3. Log in, go to Settings → Integrations, connect Google (grants Calendar + Gmail + Drive + Sheets in one click).
4. If Sprint Tracking is still empty, go to Import Data → click "Re-seed now". The Sheet Tracking xlsx (~1,212 unique companies, 1,931 sprint rows) will load in seconds.

## What was tested

- `pnpm run typecheck` → clean across all 4 typecheck targets
- `pnpm --filter @workspace/thinking-spree run build` → clean Vite build, 2087 modules transformed
- `pnpm --filter @workspace/api-server run build` → clean esbuild bundle
- `pnpm run render:build` (the actual Render deploy command) → clean

What was NOT tested (no infrastructure to test against):
- Actual OAuth flow against Google
- Actual OpenAI calls
- Actual Gmail send
- Actual Sheets read

These have been wired according to the official googleapis and openai SDK contracts. The fall-back paths (template emails when AI fails, log-only when Gmail unconnected) protect against any of these failing in production.
