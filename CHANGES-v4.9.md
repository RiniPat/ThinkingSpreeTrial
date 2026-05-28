# v4.9 — Backtested + parser bugs fixed

This is **v4.8 plus three real bug fixes** I caught by running unit tests
on the parser against synthesised Sprint Templates. The original v4.8 ZIP
shipped, but these three parser bugs would have hit production:

## Critical parser fixes

### Bug 1 — "Current Burn" returned the string "Runway"
When a consultant uploaded a sheet where the Funding tab existed but the
Current Burn cell was empty, `findValueByLabel` would walk one row down
looking for a value — and find the label "Runway" instead. So the parser
stored "Runway" as the burn value.

**Fix**: introduced a `KNOWN_LABEL_SET` of every label string the parser
recognises. When walking down to find a value, skip the cell if it's
itself a known label.

### Bug 2 — "Previous Fundraise (in CR)" returned "Previous Fundraise Organisations"
Same root cause as bug 1. The label "Previous Fundraise Organisations"
sat one row below "Previous Fundraise (in CR)". Empty value cell → walk
down → grab the next row's label.

### Bug 3 — "SMART Goal (3 months)" returned "Actionable Task"
Same root cause. SMART Goal label sat above Actionable Task label.

### Bug 4 (knock-on) — stage detection over-eager
The parser was detecting `sprint_done` whenever `direction` (from
Milestones tab) was filled. But consultants often fill the Direction
column *before* the sprint as part of initial sheet setup.

**Fix**: narrowed `postSessionSignals` to SWOT fields only (Key Strengths,
Gaps, Mentor Connect, Market Access). These are only ever filled during
or after the sprint session — they're reliable stage indicators.

## All v4.8 features still here

- ✅ Gemini model swapped to `gemini-2.5-flash` (fixes the 404 error)
- ✅ Manual workflow dropdown (5 stages, free-form forward/backward)
- ✅ Observations by TS Team textarea on Sprint Data tab
- ✅ Summary Sheet auto-populates with Sprint Template cohorts
- ✅ Sprint Tracking has Companies-by-Cohort section
- ✅ Numbered actionable steps in post-sprint emails
- ✅ Stage-changed timeline events show with proper icon (fixed since v4.8)

## Backtest results
Ran 56 unit tests across 4 test suites:
- Parser integration (27 tests): pre-sprint workbook + post-sprint workbook
- Hyperlink regex (9 tests): all formula variations
- Sheet URL extraction (8 tests): full URLs, bare IDs, garbage
- Workflow stage validator (12 tests): all 5 stages + edge cases

All 56 tests pass.

## Deploy

`git push` → Render auto-deploys. Migration 005 runs on boot if not
already applied. No new env vars.

## What to expect

After deploy, paste your Sprint Template Google Sheets URL on Companies
page. The parser will now correctly:

- Recognise empty Funding cells as actually empty (not the next row's label)
- Recognise empty SMART cells as empty
- Only detect "sprint_done" when SWOT is actually filled in
- Extract co-host from the cell to the right of the host (v4.7)
- Extract hyperlinks from `=HYPERLINK()` formulas (v4.6)

Other features (emails, workflow, observations, Summary auto-population)
behave exactly as documented in CHANGES-v4.8.md.
