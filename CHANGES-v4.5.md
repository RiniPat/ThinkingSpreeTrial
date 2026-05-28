# Consultant Suite v4.5 — Sheets fetcher memory fix

## What's fixed

**Bug**: Pasting a Google Sheets URL caused the server to silently crash
(OOM) and Render restarted the process. Symptom from the user side: a
generic "Sheet sync failed: 502" toast, followed by being signed out
(because the in-memory state was wiped by the crash).

**Cause**: the v4.4 fetcher called `spreadsheets.get(includeGridData=true)`,
which downloads every cell's metadata (formatting, formulas, borders) for
every defined range. On a Sprint Template with 900+ pre-formatted empty
rows × 7 tabs, this could balloon to a 100+ MB JSON allocation that
overran Render's free-tier 512 MB process limit.

**Fix**: two-step fetch using the lightweight values API:
  1. Tiny metadata-only call (`fields=sheets.properties.title`) gets the
     list of tab names — returns ~1 KB regardless of sheet size.
  2. `values.batchGet` with explicit ranges (A1:Z200 per tab) fetches only
     display strings. Total response is typically <50 KB even for a busy
     Sprint Template.

The values path skips cell metadata entirely — no formatting, no formula
sources, no border info — which we don't need for parsing anyway.

## Process safety
Added `uncaughtException` / `unhandledRejection` handlers in `app.ts` so
future silent crashes at least leave a log line before the process exits.
Without these, an OOM kill on Render shows up as "service restarted" with
no indication of what failed.

## Files changed

| File | Change |
|---|---|
| `artifacts/api-server/src/lib/sheetsFetcher.ts` | Rewrite to use values API + bounded range |
| `artifacts/api-server/src/app.ts` | Process-level crash handlers |

## Deploy

Same as before — `git push` and Render auto-deploys (~4 min). No new env
vars, no Cloud Console changes.

## Expected behavior after deploy

- Paste a Sprint Template Google Sheets URL → server pulls ~50 KB → company
  appears in the list within 2-3 seconds
- Even on free-tier Render, memory stays under 100 MB during the fetch
- Re-sync from the company detail page works the same way
- No more auto-sign-outs from the sheet sync path

## How to verify the fix once deployed

1. Sign in (you may need to sign in again if your session was lost
   during the crash storm)
2. Companies → paste your sheet URL → Pull Data
3. Should succeed without signing you out
4. If it still fails, Render logs will now contain an explicit error
   (the crash handlers ensure that) — send me a screenshot
