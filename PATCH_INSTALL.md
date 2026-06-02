# PATCH v5.5 — install guide

You're holding a zip that **extracts directly onto your existing repo root**. Every file lands at the correct path. You then make ~6 small edits to existing files (paths called out below), commit, push, done.

```bash
# from your repo root:
unzip thinking-spree-patches-v5_5.zip
git status   # review what changed
# (make the 6 small edits in step 3 below)
git add .
git commit -m "v5.5 — cohorts, multi-recipient + threaded emails, PDF worker fix, cron sync"
git push
# Render auto-deploys; migration 010 runs on boot
```

> **Heads-up:** `render.yaml` in this zip **overwrites your existing one**. The web-service block is byte-identical to what you have; the additions are an `INTERNAL_TOKEN` env var and a new `cron` service. If you've customised render.yaml recently, diff before committing.

---

## What lands where

```
artifacts/
├── api-server/src/
│   ├── lib/
│   │   ├── pdf-text.ts                  NEW — fixes the pdf.worker.mjs error
│   │   ├── email-threading.ts           NEW — RFC 5322 helpers
│   │   └── cohort-sync.ts               NEW — sheet → cohort reconciliation
│   └── routes/
│       ├── cohorts.ts                   NEW — /api/cohorts CRUD + /sync
│       ├── sprint-emails.ts             NEW — /api/sprints/:id/emails
│       ├── cron.ts                      NEW — /api/cron/sync-cohorts
│       └── _wire-up.md                  doc — how to register the routers
└── thinking-spree/src/
    ├── components/
    │   ├── recipient-input.tsx          NEW — chip-style To/Cc/Bcc input
    │   └── email-composer.tsx           NEW — dialog with thread-it toggle
    └── pages/
        ├── cohorts.tsx                  NEW — /cohorts list
        ├── cohort-detail.tsx            NEW — /cohorts/:slug
        └── _wire-up.md                  doc — how to register routes + sidebar

lib/db/
├── migrations/010_cohorts_and_threading.sql   NEW — runs on boot via run-migrations.mjs
└── schema/cohorts.ts                          NEW — Drizzle types

scripts/src/
└── backfill-sprint-emails.ts            NEW — one-time historical Gmail backfill

render.yaml                              REPLACES yours — adds INTERNAL_TOKEN + cron service
BACKFILL_AND_CRON.md                     doc — backfill + cron operations guide
PATCH_INSTALL.md                         this file
```

---

## The 6 edits you still need to make in YOUR existing files

These I can't make from here because they require touching your existing source, which isn't in the project knowledge I have access to. Each is small.

### 1. Register the 3 new routers in your Express entry

File: `artifacts/api-server/src/index.ts` (or wherever you do `app.use(...)`)

```ts
import { cohortsRouter }      from "./routes/cohorts.js";
import { sprintEmailsRouter } from "./routes/sprint-emails.js";
import { cronRouter }         from "./routes/cron.js";

// cron router MUST be registered BEFORE any session middleware that would
// 401 unauthenticated requests — it uses bearer-token auth, not sessions.
app.use("/api/cron",                cronRouter);

// the other two go after your existing auth middleware:
app.use("/api/cohorts",             cohortsRouter);
app.use("/api/sprints/:id/emails",  sprintEmailsRouter);
```

### 2. Re-export the new Drizzle schema from your barrel

File: `lib/db/schema/index.ts` (your schema barrel)

```ts
export * from "./cohorts.js";   // adds cohorts, cohortCompanies, sprintEmails, latestSprintEmail
```

### 3. Replace `pdf-parse` calls with the new helper

File: `artifacts/api-server/src/routes/builder-growth-reports.ts` (per CHANGES-v5_4.md)

```ts
// BEFORE
import pdfParse from "pdf-parse";
// ...
const { text } = await pdfParse(buffer);

// AFTER
import { extractPdfText } from "../lib/pdf-text.js";
// ...
const text = await extractPdfText(buffer);
```

This is the single change that fixes your production PDF upload error.

### 4. Re-route the pre-sprint email send through the new endpoint

Whatever code currently sends the pre-sprint email via Gmail directly: change it to POST to `/api/sprints/:id/emails` with `kind: "pre-sprint"`. The new endpoint stores the `Message-ID` so the eventual post-sprint email can thread onto it.

This is the wiring that makes threading actually work end-to-end going forward.

### 5. Add the Wouter routes + sidebar item

File: `artifacts/thinking-spree/src/App.tsx` (or your router file)

```tsx
import CohortsPage      from "./pages/cohorts";
import CohortDetailPage from "./pages/cohort-detail";

<Route path="/cohorts"       component={CohortsPage} />
<Route path="/cohorts/:slug" component={CohortDetailPage} />
```

File: `artifacts/thinking-spree/src/components/Layout.tsx` (sidebar)

```tsx
import { Layers } from "lucide-react";
<NavItem href="/cohorts" icon={Layers} label="Cohorts" />
```

### 6. Wire the email composer into the sprint detail page

File: `artifacts/thinking-spree/src/pages/sprint-detail.tsx`

Replace your current pre/post-sprint send buttons with `EmailComposerDialog` (snippet in `artifacts/thinking-spree/src/pages/_wire-up.md`).

---

## After you push

1. Render auto-deploys — migration 010 creates the new tables.
2. The cron job starts running every 5 min (it's a no-op until a cohort has a `source_sheet_url`).
3. PDF uploads start working again.
4. Open `/cohorts` in the UI — you'll see "Wadhwani Foundation companies" already seeded by the migration. Click in → attach the Wadhwani Summary Sheet URL → click "Sync now".
5. (Optional, one-time) Run the backfill to recover historical Gmail Message-IDs:
   ```bash
   pnpm tsx scripts/src/backfill-sprint-emails.ts --dry-run   # preview
   pnpm tsx scripts/src/backfill-sprint-emails.ts             # commit
   ```
   See `BACKFILL_AND_CRON.md` for details.

---

## "ADAPT" markers

Every assumption I made about your existing code is marked `// ADAPT:` in the source. After extracting, run:

```bash
grep -rn "// ADAPT:" artifacts/ lib/ scripts/
```

…to see everything that might need a small tweak to match your conventions (table names, helper function names, etc.). Most are safe defaults; the search just gives you confidence nothing was missed.
