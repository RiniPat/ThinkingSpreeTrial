# v5.3 — Compare Sessions tab

A new **Compare Sessions** tab on every company detail page. Two views in
one place, no extra navigation.

## Side-by-side diff
Pick any two sessions (including "Latest" = current live data) from the
Left/Right dropdowns. The table shows ten Sprint Data fields side-by-side:

- Key Strengths
- Gaps
- Mentor Connect
- Market Access
- SMART Goal (3 months)
- Actionable Tasks
- Next Stage Goal
- Previous Fundraise
- Current Burn
- Runway

A "Changed" pill appears next to fields that differ between the two
sessions. Identical rows are dimmed so the eye lands on what's different.
Empty fields show "—".

Defaults to **most recent archived session vs Latest** so the page is
useful with zero clicks.

## Progression line chart
Pick a metric from the dropdown, see how it moved across sessions over
time. Metrics:

- Fund Ask (₹ Cr) — from the typed column
- Revenue (last 12 months) — extracted from excelData
- MRR (last month) — extracted from excelData
- Team Size — extracted from excelData
- Previous Fundraise — extracted from raw text
- Runway — extracted from raw text
- Current Burn — extracted from raw text

Each session is a point on the x-axis (in order: Sprint 1 → Sprint 2 →
… → Latest). Empty sessions create gaps (not zero-points) so the line
doesn't lie about missing data.

## How numbers come out of raw text
The fields above store strings like "₹2.5 Cr (Pre-seed)" or "10 months".
The chart extracts the first numeric run from each: "₹2.5 Cr (Pre-seed)"
→ `2.5`, "10 months" → `10`. The unit (Cr / L / months / headcount) is
shown in the chart label — but the numbers themselves are just numbers,
so don't compare apples to oranges by switching metrics mid-conversation.

## Empty states
- **Only one session exists**: tab shows a banner telling you to use
  "Save as new session" first.
- **No data for the chosen metric**: chart area shows a hint to re-sync
  the sheet.

## No DB changes
Pure frontend feature. All data is read from existing endpoints:
- `GET /companies/:id` for the live company
- `GET /companies/:id/sessions` for archived sessions

## Footer version bumped
The detail-page footer was still showing "v4.4" — fixed to "v5.3".

## Backtests
- 24 new tests for number extraction across real-world cell formats
  (₹2.5 Cr, ₹40 L, 8.5 months, comma decimal, empty, null, undefined,
  dash, NA, NaN, negatives, etc.)
- All 134 prior tests still passing

**158 tests passing total before shipping.**

## Deploy
`git push` → Render auto-deploys. No migration. No env vars.

## After deploying
1. Open any company with at least one archived sprint session
2. Click the new "Compare Sessions" tab
3. Eyeball the diff, then switch the chart metric to "Fund Ask" or "Team Size"
