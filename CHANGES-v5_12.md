# Changes — v5.12 (Clean the Sheet · dashboard fallback)

Builds on v5.11. The "Clean the Sheet" feature now degrades gracefully when the
connected Google account can't edit the linked sheet.

## Behaviour
- The cleaner still tries to write directly into the Google Sheet (primary path).
- If the write fails — most commonly because the connected Google account only
  has **view** access (HTTP 403) — it no longer errors out. Instead it returns
  `wrote: false` plus the full cleaned output, and the route saves that output to
  the company (in the `sheet_cleaned` timeline event metadata).
- A new **Cleaned T-Sheet output** card appears on the company's Overview tab:
  - Badge "Written to sheet" (green) or "Apply manually" (amber).
  - When not written, it shows the exact **Actions taken so far** blocks per idea
    (with per-block Copy), the Target Audience table, and the suggestions —
    everything the consultant needs to paste in by hand.
  - Shows the run timestamp.
- The dialog's result view mirrors this: green "written" banner, or an amber
  "couldn't edit — saved to dashboard" banner with the reason and copyable blocks.

Manual/dashboard application is used **only** when the sheet can't be edited; on a
successful write the card is just a record (with the "Written to sheet" badge).

## Files changed
- **`artifacts/api-server/src/lib/tSheetCleaner.ts`** — all Sheets writes wrapped
  in try/catch; `CleanReport` gains `wrote`, `writeError`, `actionBlocks`,
  `targetTabFound`; returns the composed per-idea text blocks for manual apply.
- **`artifacts/api-server/src/routes/tSheet.ts`** — stores the full cleaned
  output (`extracted`, `actionBlocks`, `wrote`, `writeError`) in the
  `sheet_cleaned` event metadata; response includes `wrote`/`writeError`.
- **`artifacts/thinking-spree/src/components/CleanSheetDialog.tsx`** — write-status
  banners, copyable per-idea blocks, audience table, "copy all" suggestions;
  exports `CleanedReportBody` + `Report` for reuse.
- **`artifacts/thinking-spree/src/pages/company-detail.tsx`** — derives the latest
  `sheet_cleaned` event and renders the Cleaned T-Sheet output card on Overview.

## Notes
- No schema migration — the cleaned output rides in the existing jsonb event
  metadata (a few KB).
- esbuild syntax pass clean; still not typechecked in a built workspace.
