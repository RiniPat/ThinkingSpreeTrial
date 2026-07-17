# Changes — v5.7

## Calendar T-Sprints: manual + automatic detection
Previously the dashboard only counted calendar events whose title matched
"T-Sprint for ..." — sessions named anything else were missed. Now:

- **Automatic** — the title rule still applies (any event matching `t-sprint`).
- **Manual** — a consultant can flag *any* calendar event this month as a
  T-Sprint, and can un-flag a false positive. Manual marks override the title
  rule.

How it works:
- New table `calendar_sprint_marks` (migration `012`) records a mark per
  (user, Google event id), with a snapshot of the title/time and a `marked`
  boolean.
- New endpoint `POST /api/calendar/sprint-marks` upserts a mark
  (`{ googleEventId, title?, startISO?, endISO?, marked? }`).
- `GET /api/stats/dashboard` now pulls **all** of the month's calendar events,
  classifies each as a sprint via *title rule OR manual mark*, and returns the
  sprint list (with a `manual` flag) plus an `otherEvents` list of the
  non-sprint events.
- Dashboard UI: "My T-Sprints This Month" shows a **Manual** badge (with an
  *unmark* link) on manually-added sessions, and a collapsible **"Other calendar
  events this month"** panel with a **+ Mark as T-Sprint** button on each.

## Enabler: Stage of business / Industry editable via API
`PATCH /api/companies/:id` now accepts `stage` (Stage of business) and
`industry`. This is the write path used when a sprint is marked done and the
consultant fills in the stage, and for inline edits in the Live Sprint Tracking
view. (Price is per-sprint and already updatable via `PATCH /api/sprints/:id`.)

## New / edited files
- New: `lib/db/src/schema/calendarSprintMarks.ts`,
  `lib/db/migrations/012_calendar_sprint_marks.sql`.
- Edited: `lib/db/src/schema/index.ts` (export),
  `artifacts/api-server/src/routes/dashboardStats.ts` (classify all events),
  `artifacts/api-server/src/routes/calendar.ts` (mark endpoint),
  `artifacts/api-server/src/routes/companies.ts` (stage/industry in PATCH),
  `artifacts/thinking-spree/src/pages/dashboard.tsx` (mark UI).

## Live Sprint Tracking — spreadsheet view, mark-done, add/remove
The Sprint Tracking page's table now works like the Live Sprint Tracking sheet,
with inline editing:
- **Stage of business** — inline dropdown using the sheet's stages (Idea, MVP,
  Prototype, Early Traction, Early Growth, Growth, Business Expansion, Market
  Expansion, 1:many), editable (legacy/typed values preserved); writes to the
  company via `PATCH /api/companies/:id`.
- **Price** — inline manual entry (commits on blur) → `PATCH /api/sprints/:id`.
- **Billed To** — inline dropdown (National Entrepreneurship Network, Ashoka,
  ISB, JU, TISS, Elecroom, WInspire).
- **Payment Status** — dropdown aligned to the sheet (Received / NA / Pending /
  Bill Raised).
- **Program** — shown and filtered by *family* (first word), so "Wadhwani 11.1",
  "Wadhwani 4.2", … all group under "Wadhwani".
- **Mark Done** — one-click "Done" per row sets the sprint completed; Stage and
  Price are filled inline, so the row updates in place in Live Sprint Tracking.
- **Add Startup** — header button opens a quick-add dialog (Company, Founder,
  Email, Stage, Industry, Cohort/Program with autocomplete) → new
  `POST /api/companies`.
- **Remove** — per-row trash removes the startup (with confirm) via
  `DELETE /api/companies/:id`.

## Dashboard visuals
- Stat cards gained a tone-colored top accent and a soft hover glow.
- The Sprint Pipeline card now leads with an animated **SVG completion ring**
  for the month's completion rate, above the gradient stage bars.

## Notes / caveats
- Not type-checked or run here. Run `pnpm install && pnpm -r typecheck` and test
  before deploy. Migration `012` runs automatically on deploy.
- Manual calendar marks are per consultant (scoped to the signed-in user).
- "Add Startup" creates a company; it appears as a Live Sprint Tracking row once
  it has a sprint session (consistent with the sheet being session-per-row).
