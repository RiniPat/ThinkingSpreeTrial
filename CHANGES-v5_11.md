# Changes — v5.11 (Step 4 · Clean the Sheet)

Adds the "Clean the Sheet" feature: after a sprint, the consultant pastes the
Fathom transcript and the AI organises it straight into the company's live
Google Sheet.

## What it does
- New **Clean the Sheet** button on the Company page action bar (shows when a
  Google Sheet is linked via `sourceSheetUrl` or `thinkingSheetUrl`).
- Opens a dialog to paste the transcript (+ optional Fathom link). On run, the
  server:
  1. Reads the **Models and priority** tab WITH formatting to locate the header
     row, the **Actions taken so far** column, every **Ideas/Products** row, and
     the **pink separator** row (`#F4CCCC`).
  2. Finds the **Target Audience** tab (handles the naming variants
     "Target Audience" / "Target Group" / "TG Usecase Prioritisation").
  3. Calls Gemini to condense the transcript into **3–4 word phrases**, mapped to
     the right idea, plus audience rows and a list of still-missing items.
  4. Writes back:
     - Appends the concise phrases under the matching idea in **Actions taken so
       far** (value-only write, so existing formatting is preserved and **nothing
       is deleted** — new notes are added beneath the old, under an
       `Action Taken (Sprint <date>)` header).
     - Appends audience rows to the Target Audience table (Arial, wrapped,
       priority left blank for the consultant).
     - Writes **suggestions below the pink line** (bold header + one item per row
       in the wide Actions column).
- Logs a `sheet_cleaned` timeline event and shows a report (idea notes,
  audience rows, suggestions) with an **Open Sheet** link.

Formatting matches the finished T-Sheets: Arial, header blue `#073763` (white
bold), pink separator `#F4CCCC`, wrapped top-left cells.

## Files
- **`artifacts/api-server/src/lib/tSheetCleaner.ts`** (new) — layout discovery,
  Gemini extraction, and the Sheets API write-back (preserves format).
- **`artifacts/api-server/src/routes/tSheet.ts`** (new) —
  `POST /companies/:id/clean-sheet`.
- **`artifacts/api-server/src/routes/index.ts`** — mounts the new router.
- **`artifacts/thinking-spree/src/components/CleanSheetDialog.tsx`** (new) —
  paste-transcript dialog + report view.
- **`artifacts/thinking-spree/src/pages/company-detail.tsx`** — button, dialog
  wiring, and a `sheet_cleaned` timeline entry.

## Notes / scope
- No new OAuth consent needed — the `sheets` scope group is already read+write
  (`auth/spreadsheets`).
- The cleaner never deletes; it appends. Re-running adds another dated block.
- Suggestions are written starting at the row just below the pink line; if a tab
  has no pink line, they go two rows below the last content.
- Not typechecked in a built workspace here (no `node_modules`); files pass an
  esbuild syntax pass. The Sheets write path can only be fully exercised against
  a live sheet, so review the first cleaned sheet to confirm placement.
- A faithful demo (`T_Sheet_cleaning_DEMO_Varahi.xlsx`) was produced from the
  real Varahi sample to validate the layout-detection and placement logic.
