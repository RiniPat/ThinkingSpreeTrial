# v5.2 — Multi-sprint sessions · Outcomes report · Brand-aware proposals

## Multi-sprint sessions

You can now run multiple sprints with the same company while preserving
each session's data as immutable snapshots.

**How it works:**
- Below the company header is a new "Sprint Session" bar with a dropdown
  (Latest, Sprint 1, Sprint 2…) and a "Save as new session" button
- Click **Save as new session** to snapshot the current Sprint Data
  (vision, SWOT, funding, SMART, observations, everything). You can label
  it ("Sprint 1", "Q1 2026 Refresh", whatever)
- Then re-sync the Google Sheet for the next sprint — the live data
  updates, the snapshot remains frozen
- Switch the dropdown back to "Latest" anytime to edit. Snapshots are
  read-only (you can rename or delete them, but not edit fields)
- Email drafts and timeline events created during a session are tagged
  with the session ID for future per-session views

**Why "explicit save" not "auto on re-sync":** consultants sometimes
re-sync just to fix a typo. We don't want a new session created every
time. The button is one click — explicit and intentional.

## Sprint Outcomes Report (`/reports/outcomes`)

New report page available to consultants, research team, and admins. Shows:

- **Totals strip**: Companies tracked, Sprints completed, Completion rate,
  Pre/Post emails sent, Observations logged
- **Companies by Stage**: horizontal bar list with counts
- **By Cohort**: same view, grouped by cohort name
- **Top themes in observations**: word-frequency tag cloud across the
  Observations by TS Team field. Size scales with frequency. Useful for
  spotting recurring themes in consultant feedback
- **Recent completed sprints**: clickable list of the 10 most recent

**Filters**: date range (defaults to last 30 days, with Last 7d / 30d / 90d
quick buttons) AND cohort dropdown.

## Proposal Builder — brand-aware AI

Per your About PDF, the proposal builder's "Fill with AI" button now
prompts Gemini with the Thinking Spree brand context:

- Tagline: "Making Strategy realtime, consumable and actionable for startups"
- 6 methodology pillars (New Strategy Frameworks, Customer Centricity,
  AI-Driven Insights, etc.)
- Track record stats (₹1500 Cr+, 1000+ ventures, 190+ micro-sectors, 2x MRR)
- 8 typical challenges (Revenue Scale to 10x, GTM, Unit Economics, etc.)

Result: AI-filled sections lead with what's distinctive about Thinking
Spree (Design Thinking + BMC + Agility), reference the track record where
it fits, and avoid generic consulting boilerplate.

The prompt also explicitly tells AI NOT to invent fees, timelines, or
numbers — say "we'll confirm with you" instead.

To update the brand context (when positioning changes), edit
`artifacts/api-server/src/lib/brandContext.ts`.

## Database changes
Migration `008_sprint_sessions.sql`:
- `sprint_sessions` table — point-in-time snapshots of Sprint Data
- `email_drafts.session_id` (nullable FK) — drafts tagged to a session
- `company_events.session_id` (nullable FK) — events tagged to a session

## New API endpoints
- `GET    /companies/:id/sessions` — list sessions
- `POST   /companies/:id/sessions` — create snapshot (optional `label`)
- `PATCH  /companies/:id/sessions/:sessionId` — rename
- `DELETE /companies/:id/sessions/:sessionId` — remove
- `GET    /reports/outcomes?from=&to=&cohort=` — outcomes report

## Deploy
`git push` → Render auto-deploys. Migration 008 runs on boot.

## After deploying
1. Open any existing company → notice the new Sprint Session bar
2. Try clicking "Save as new session" to create Sprint 1
3. Open `/reports/outcomes` from the sidebar to see your data sliced
4. Try generating a proposal — the AI tone should be noticeably more
   Thinking Spree-flavored

## Backtests
- 18 brand-context tests (constants present, summary length, key strings)
- 8 session-merge logic tests (overlay correctness, live passthrough)
- All 108 prior tests still passing

134 tests passing total before shipping.
