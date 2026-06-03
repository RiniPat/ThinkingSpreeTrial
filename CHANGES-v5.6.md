# Changes — v5.6 (Phase B: Summary Builder)

Builds out the **Summary** mode in the Builder tab (previously a placeholder)
for the Wadhwani Foundation format.

## What it does

A resumable, multi-step workflow that mirrors the Growth Report builder:

1. **New Summary** — enter Startup Name + T-Sheet link, optionally attach a
   Fathom transcript. On submit the server:
   - pulls **Startup / Founder / Host / Co-Host / Goal** from the T-Sheet
     (reuses `sheetsFetcher` + `sprintTemplateParser`),
   - AI-extracts the Fathom fields if a transcript was attached
     (**Current Revenue/ARR, Industry Detail, Critical Venture, TS Connects,
     TS Support beyond connects**), and
   - looks up **VP1 / VP2 dates** from Sprint Tracking by matching the company
     in the `sprints` table (earliest two scheduled dates).
2. **Review & edit** — every field is editable. Three color-chip dropdowns:
   - **Industry** (Manufacturing, Fintech, Healthtech, Tech, AI, SaaS, Ed Tech,
     FMCG, Retail, Legal) — colors matched to your palette, **extendable** (type
     a custom value below the chips).
   - **TG** (B2C, B2B, D2C, B2B + D2C, B2B + B2C, B2G, B2G + D2C, B2G + B2C,
     B2G + B2B) — colors matched, **extendable**.
   - **Funding** (Funded, Bootstrapped, NA) — fixed list.
   You can re-run the AI extraction (fills only blank fields, never clobbers
   your edits).
3. **Commit to Summary Sheet** — writes a venture row under the **Wadhwani
   Foundation companies** cohort so it shows on the in-app **Summary Sheet tab**
   (write target option (a)). Re-committing updates the same venture in place.

Field → column mapping on commit: Founder→`name`, Host→`sprint_host`,
Co-Host→`co_host`, Goal→`goal_setting`/`smart_goal_3_months`,
Current Revenue/ARR→`revenue_last_12m`, Industry→`industry`,
Industry Detail→`description`, TS Connects→`market_access`,
TS Support→`t_sprint_intervention`. The full Wadhwani field set (incl. TG,
Funding, VP1/VP2, Critical Venture, notes) is also stored verbatim in
`excel_data.wadhwaniSummary`. The row's `source` is `summary_builder`, which is
now an accepted Summary-tab source.

## Progress is preserved across tab switches
Both the New Summary form and the review form persist to `localStorage`
(per-build key), so switching to a Google tab and back doesn't lose anything.

## New files
- `lib/db/src/schema/summaryBuilds.ts` — `summary_builds` table.
- `lib/db/migrations/011_summary_builds.sql` — idempotent, runs on deploy.
- `artifacts/api-server/src/lib/summaryBuilderAi.ts` — Fathom field extraction
  (Gemini `gemini-2.5-flash`, JSON, temp 0.2).
- `artifacts/api-server/src/routes/summaryBuilderRoutes.ts` — the 7 endpoints
  under `/api/builder/summary-builds`.

## Edited files
- `lib/db/src/schema/index.ts` — export the new schema.
- `artifacts/api-server/src/routes/index.ts` — mount the router.
- `artifacts/api-server/src/routes/incubators.ts` — accept `summary_builder` as
  a Summary-tab source.
- `artifacts/thinking-spree/src/pages/builder.tsx` — replace the Summary
  placeholder with the full builder; footer bumped to v5.6.

## API (all gated to consultant / research / admin)
- `POST   /api/builder/summary-builds` — create + pull (+ optional Fathom extract)
- `POST   /api/builder/summary-builds/:id/extract` — re-run AI on stored Fathom
- `PATCH  /api/builder/summary-builds/:id` — save edits
- `POST   /api/builder/summary-builds/:id/commit` — write to the Summary tab
- `GET    /api/builder/summary-builds` — library list
- `GET    /api/builder/summary-builds/:id` — full record
- `DELETE /api/builder/summary-builds/:id` — remove

## Bug fix: Growth Report PDF upload ("DOMMatrix is not defined")
The Strategic Canvas upload was failing with **"DOMMatrix is not defined"** (and,
when the process crashed outright, a masked **"Unexpected end of JSON input"** in
the UI). Cause: `pdf-parse` v2 loads the *browser* build of pdf.js, which
references DOM globals (`DOMMatrix`, `Path2D`, `ImageData`) that don't exist
under Node, so extraction threw or crashed the dyno.

Fix:
- Swapped PDF text extraction to **`unpdf`** — a serverless/Node build of pdf.js
  that needs no DOM, canvas, or worker setup (`artifacts/api-server/src/lib/fileExtract.ts`).
  `pdf-parse` is removed from dependencies; `unpdf` (`^1.6.2`) added.
- Updated the esbuild `external` list accordingly (`build.mjs`): `unpdf` is kept
  external so its pdf.js assets resolve from `node_modules` at runtime.
- Hardened the Builder forms (`builder.tsx`): a new `readErr()` helper reads a
  failed response as text and only then tries JSON, so a crashed/HTML/empty
  response now surfaces the real error (or the HTTP status) instead of
  "Unexpected end of JSON input". Applied to every Growth Report and Summary
  Builder request.

This affects both Builder modes, since both extract uploaded files through the
same path.

## Summary Builder — refinements & fixes (this round)

**Image-only / scanned PDFs now work (OCR fallback).** When a PDF has no
selectable text layer (e.g. the Strategic Focus Canvas exported as an image),
extraction falls back to Gemini vision OCR — the raw PDF is sent to
`gemini-2.5-flash` to transcribe its text. Applies to *both* Builder modes, so
the "…appears empty. Make sure the PDF has selectable text" error no longer
blocks an image PDF (`fileExtract.ts`). Needs `GEMINI_API_KEY`; files >14MB are
skipped.

**Builder state survives tab switches, navigating away, and reloads.** A new
`usePersistentState` hook mirrors Builder state to `localStorage`: which mode
(Growth vs Summary), which report/build is open, and the in-progress New-form
text. Summary review edits were already auto-saved per build; navigation is now
too, so returning reopens where you left off. (Uploaded files still need
re-attaching after a *hard* reload — browsers won't let us persist file bytes —
but once you've pulled/uploaded, the draft is saved server-side and reopens
fully.)

**Two Fathom transcripts.** The New Summary form now has Transcript 1 & 2 slots;
both are extracted, combined, and sent to the AI together (`fathom_1`/`fathom_2`).

**AI prompts match the exact questions** for Current Revenue (ARR), Industry
Detail (one short phrase), Critical Venture (one short phrase), Thinking Spree
Connects, and TS Support apart from connects.

**T-Sheet mapping confirmed** — Startup/Founder from Overview, Host from
"T-Sprint Consultants Assigned", Co-Host from the cell beside it, Sheet Link =
submitted URL. The parser already reads exactly this, so no change was needed.

**Summary tab shows the Wadhwani fields.** Beyond the already-mapped Industry /
Revenue / Market Access (TS Connects) / T-Sprint Intervention (TS Support), the
venture detail now also shows **TG, Funding, Critical Venture, VP1 Call Date,
and VP2 Call Date** when present (hidden for non-Wadhwani ventures).

## Notes / caveats
- VP date lookup matches an **existing** tracked company by name; if the venture
  isn't in Sprint Tracking yet, VP1/VP2 come back blank and you fill them in
  during review. `sprints.scheduled_date` is stored as text, so ordering assumes
  the ISO-ish format already used elsewhere in the app.
- Committed ventures are created with a placeholder email
  (`unknown+<ts>@placeholder.local`) when none is known, since `founders.email`
  is NOT NULL. Edit it on the company later if you need to send mail.
- Not type-checked or run here (no `node_modules` / DB / Google creds in this
  environment). Run `pnpm install && pnpm -r typecheck` and test the flow before
  deploying.
