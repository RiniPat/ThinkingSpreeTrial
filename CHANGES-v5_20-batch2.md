# v5.20 — Batch 2 (Emails tab)

New "Emails" tab in the sidebar, directly below Pre-Sprint, with two composers:
Pre-Sprint email and Post-Sprint email. Reuses the existing Gemini + Gmail
pipeline; adds a sheet-link-first entry point and a consultant-managed template
library.

## Sidebar + routing
- `Layout.tsx`: new "Emails" nav item (Mail icon) below Pre-Sprint.
- `App.tsx`: `/emails` route.

## New page — `src/pages/emails.tsx`
Three-zone workspace (matches the approved mock), Pre/Post toggle persisted in
the URL (`?mode=`):
- Left: paste T-Sheet link → "Pull data from T-Sheet". AI-extracted Company /
  Founder / Cohort show as editable fields. Post-Sprint adds an engagement
  toggle (Single / Multi-sprint); Multi reveals next sprint number + a date
  picker (calendar popover) + a time picker (hour / minute / AM-PM).
- Center: Recipients picker — attendee chips pulled from the Google Calendar
  invite; tap to cycle To → Cc → off; plus manual email add. Below it, the
  draft editor: subject + body with a Bold / Highlight / Link toolbar and a
  Preview toggle. Generate / Regenerate / Send.
- Right: Templates rail — select, add, edit, delete. Templates persist until
  deleted (no seeds).

Formatting markers (`**bold**`, `==highlight==`, `[text](url)`) render in the
sent email's HTML part and degrade to clean plain text.

## New DB table — `email_templates`
- `lib/db/src/schema/emailTemplates.ts` + export in `schema/index.ts`.
- `lib/db/migrations/014_email_templates.sql` (idempotent `CREATE TABLE IF NOT
  EXISTS`). Workspace-wide; no seed rows.

## Backend — `src/routes/emailWorkspace.ts` (mounted at `/api/email/*`)
- `GET/POST/PATCH/DELETE /email/templates` — template CRUD (per kind).
- `POST /email/extract-sheet` — fetches the Google Sheet, Gemini extracts
  company/founder/cohort, and Google Calendar supplies invite attendees as
  candidate recipients (per the "emails come from the calendar invite" rule).
- `POST /email/draft` — Gemini drafts subject+body using the selected template
  as the scaffold + the sheet/calendar context (+ multi-sprint details).
- `POST /email/send` — sends via the consultant's Gmail (multipart text+HTML,
  To/Cc, bold/highlight/link).
- Registered in `routes/index.ts`.

## Gemini — `src/lib/gemini.ts`
- `generateEmail(kind, ctx, templateOverride?)` — optional template override
  (existing callers unaffected).
- `EmailContext` gains `engagementType` + `nextSprint{Number,Date,Time}`;
  the prompt confirms the next session for multi-sprint engagements.
- New `extractSheetProfile(sheetText)` helper.

## Requirements to run
- `GEMINI_API_KEY` set on the server (already used elsewhere).
- Each consultant connects Google in Settings with Calendar + Gmail + Sheets
  scopes (already part of the OAuth scope set).
- Run migrations (`014` is picked up automatically on deploy).

## Verified
All new/changed files pass a TSX/TS parse. Run `pnpm run build` for a full
typecheck against the workspace.

## Still open (your call)
- Real templates: the library starts empty by design; add them in-app via
  "New template", or send them to me and I'll pre-load a seed set if you'd
  prefer.
