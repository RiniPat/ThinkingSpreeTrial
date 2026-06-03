# Changes — v5.5

Five fixes/features on top of v5.4.

## 1. Fix: PDF upload "Setting up fake worker failed"
`pdf-parse@2.4.5` bundles `pdfjs-dist`, whose worker (`pdf.worker.mjs`) is loaded
as a sibling file resolved relative to the importing module. When esbuild
inlined `pdf-parse` into `dist/index.mjs`, that worker path resolved to
`dist/pdf.worker.mjs` — a file that does not exist — producing:

> Setting up fake worker failed: "Cannot find module
> '/opt/render/project/src/artifacts/api-server/dist/pdf.worker.mjs' ..."

**Fix:** `pdf-parse`, `pdfjs-dist`, and `@napi-rs/canvas` are now in the esbuild
`external` list (`artifacts/api-server/build.mjs`). The dynamic
`import("pdf-parse")` in `fileExtract.ts` now resolves from `node_modules`,
where the worker file ships alongside the package. (Matches how other
unbundleable packages are already handled.)

## 2. Cohort updates now reflect on the Summary Sheet tab
The Summary page only lists founders whose `source` is a curated value
(`isb-summary`, `ju-summary`, `sprint_template_upload`, `google_sheets_sync`),
so a company moved into a cohort by hand stayed hidden.

**Fix:**
- `manual_curation` is now an accepted summary source (`incubators.ts`).
- `PATCH /companies/:id` sets `source = 'manual_curation'` when a company is
  assigned to a cohort and isn't already from a summary source
  (`companies.ts`). Bulk session-tracking imports remain excluded until a
  consultant explicitly touches them.

## 3. "Wadhwani Foundation companies" cohort
- Created idempotently in migration `010_email_threading_and_cohort.sql`
  (type `wadhwani`).
- Wadhwani styling added to the Summary page (`summary.tsx`).
- Assign companies to it via the company edit dialog (Cohort field) — they then
  appear on the Summary Sheet tab automatically (see #2).
- NOTE: no companies are auto-assigned, since the membership list wasn't
  specified.

## 4. Multiple email recipients
`POST /companies/:id/send-email` now accepts multiple recipients:
- `toEmail` may be a single address OR a comma/semicolon-separated list.
- `toEmails: string[]` is also accepted.
- Optional `cc` (same formats).
Invalid/placeholder addresses are dropped; at least one valid recipient is
required. The composer UI (`EmailComposer.tsx`) supports multi-recipient `To`
and adds a `Cc` field.

## 5. Post-sprint email sent as a reply to the pre-sprint email
- New columns on `email_drafts`: `gmail_thread_id`, `rfc_message_id`
  (migration 010 + `emailDrafts.ts`).
- On a **pre** send, the Gmail thread id and the RFC 2822 Message-ID are
  captured and stored.
- On a **post** send, the latest sent pre-sprint email for that company is
  looked up; the post email is sent within the same thread
  (`threadId` + `In-Reply-To`/`References` headers, subject normalised to
  `Re: <pre subject>`), so the founder sees one continuous thread.

## Migration
`lib/db/migrations/010_email_threading_and_cohort.sql` is idempotent and runs
automatically on deploy (applied alphabetically after 009).
