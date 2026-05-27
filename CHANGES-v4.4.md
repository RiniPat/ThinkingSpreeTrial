# Consultant Suite v4.4 — Google Sheets + Edit/Delete + Calendar-driven stats

## TL;DR

Four big changes since v4.3:

1. **Google Sheets URL ingestion** — no more file uploads. Paste a Sheets link.
2. **Edit + Re-sync + Delete buttons** — full CRUD on every company.
3. **Dashboard stats from Google Calendar** — "T-Sprint for ..." event titles drive the monthly counts.
4. **Add Incubator** dropdown now has ISB / JU / Wadhwani / Ashoka + free text.

## Detailed changes

### Google Sheets ingestion
- Companies page replaces the drag-drop file zone with a URL input
- Pastes a Sheets URL → server pulls via the consultant's connected Google account
- Works for **private sheets** (consultant has Viewer access) and **public sheets** (Anyone with the link)
- The sheet URL is saved on the company row — enables one-click Re-sync later
- Old file-upload endpoint still works (kept for backward compatibility)

**Sheet sharing requirements:** the consultant must either be granted Viewer access to the sheet, OR the sheet must be set to "Anyone with the link can view".

### Edit + Re-sync + Delete

**Companies list** (`/companies`):
- Hover any row → trash icon appears on the right
- Click → confirmation dialog → type "DELETE" → permanent delete
- Cascades to all timeline events + email drafts for that company

**Company detail page** (`/companies/:id`):
- New **Edit** button — inline dialog to change name, founder, email, cohort, deck URL, hosts
- Cohort field is a typeable combobox with autocomplete from existing cohorts
- New cohort names auto-create on save (same as upload flow)
- New **Re-sync from Sheet** button (only shown if a sheet URL is on file) — re-pulls latest data
- New **Delete** button — same two-step confirmation

### Dashboard stats from Google Calendar

The four stat cards now derive from **this calendar month**, not lifetime totals:

| Card | Source |
|---|---|
| **My T-Sprints** | Count of "T-Sprint for ..." events in your Google Calendar this month |
| **Scheduled** | Of those events, the ones in the future |
| **Completion Rate** | (companies with `post_email_sent` this month) / total T-Sprint events this month |
| **Emails This Month** | `email_drafts.sent_at` count for this user this month |

**Critical naming convention:** for an event to count as a sprint, the calendar event title must contain "T-Sprint" (case-insensitive, hyphenated or not). The match is fuzzy: "T-Sprint for Lumen", "T Sprint - Acme", "t-sprint with Verdant" all count. A generic "Strategy meeting" won't.

The "Recent T-Sprints" table at the bottom now shows the actual calendar events with their titles, dates, and times — Past events show "completed" badge, future events show "scheduled".

### "Completed" semantics

Per spec: a sprint is **completed** when the post-sprint email is sent. The workflow stage on a company flips to `post_email_sent` automatically when the email goes out via Gmail. This drives:
- The "Completed" count on the dashboard
- The "Completion Rate" percentage
- The status chip on the Companies list

You no longer need to manually click "Mark complete" before generating the post-sprint email — the manual button is still there in the timeline for cases where the post-email won't be sent through the suite.

### Add Incubator dropdown (Summary page)

The Type field is now a **typeable combobox**:
- Suggestions: ISB · JU · Wadhwani · Ashoka
- Type any other name and it gets saved as-is
- Existing data unchanged — old isb/ju values keep working
- Helper text: "Pick a suggestion or type any incubator name."

## Database changes (migration `003_source_sheet_url.sql`)

One new column:
- `founders.source_sheet_url` (TEXT) — remembers which Google Sheet a company was synced from

Idempotent migration; no data loss.

## New API endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/companies/ingest-sheet` | Pull from Google Sheets URL |
| `POST` | `/api/companies/:id/resync` | Re-pull from saved sheet URL |
| `PATCH` | `/api/companies/:id` | Inline edit (name, founder, email, cohort, deck, hosts) |
| `GET` | `/api/stats/dashboard` | Calendar-driven monthly stats |

The legacy `POST /api/companies/upload-template` (file upload) still works.

## Required Google scope

The Sheets read-only scope (`https://www.googleapis.com/auth/spreadsheets`) is already in your OAuth consent screen from earlier setup. Each signed-in consultant will need to re-authorize if they haven't granted it yet — they'll see Google's permission screen on next login. No action needed in Cloud Console.

## Deployment

```bash
# 1. Replace your local repo with this zip's contents
# 2. Push to GitHub
git add -A
git commit -m "v4.4: Sheets ingestion + CRUD + Calendar-driven stats"
git push

# 3. Render auto-redeploys (~4 min); migration 003 runs automatically
```

No new env vars needed. No Google Cloud Console changes needed.

## Things to test after deploying

1. Login → Companies → paste a Google Sheets URL of your filled template
2. Sheet pulls → company appears in the list
3. Click into the company → Edit button works
4. Change cohort to "Wadhwani" → save → company appears under that cohort heading
5. Re-sync button → updates from sheet
6. Delete the test company → type DELETE → confirmed gone
7. Go to Summary → Add Incubator → type field now shows ISB/JU/Wadhwani/Ashoka suggestions
8. Dashboard → stat cards show this month's counts (will be 0 if no T-Sprint events in your calendar)
9. Add a calendar event titled "T-Sprint for Test Co" today → refresh dashboard → My T-Sprints count goes up

## Files changed since v4.3

| File | Change |
|---|---|
| `lib/db/migrations/003_source_sheet_url.sql` | NEW migration |
| `lib/db/src/schema/founders.ts` | Added `sourceSheetUrl` column |
| `artifacts/api-server/src/lib/sheetsFetcher.ts` | NEW — Google Sheets fetcher |
| `artifacts/api-server/src/lib/sprintTemplateParser.ts` | Split into buffer + workbook parsers |
| `artifacts/api-server/src/routes/companies.ts` | New endpoints; shared ingest helper |
| `artifacts/api-server/src/routes/dashboardStats.ts` | NEW — Calendar-driven stats |
| `artifacts/api-server/src/routes/index.ts` | Mounts new router |
| `artifacts/thinking-spree/src/components/EditCompanyDialog.tsx` | NEW — inline edit dialog |
| `artifacts/thinking-spree/src/pages/companies.tsx` | Sheet URL form + row delete |
| `artifacts/thinking-spree/src/pages/company-detail.tsx` | Edit + Re-sync + Delete buttons |
| `artifacts/thinking-spree/src/pages/dashboard.tsx` | New stats endpoint + Calendar events table |
| `artifacts/thinking-spree/src/pages/summary.tsx` | Type combobox with 4 suggestions |
