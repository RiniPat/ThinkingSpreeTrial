# Changes — v5.13

Four fixes to the "Clean the Sheet" + email workflow.

## 1. Cleaned-sheet progress no longer wiped on tab switch
`CleanSheetDialog` now mirrors its state to `localStorage` per company
(`cleanSheet:<companyId>`) — the pasted Fathom transcript, the Fathom link, AND
the last result are restored when you switch browser tabs, navigate away, or
reload and reopen. A "Restored your last clean" banner with a "Discard & start
over" option appears on reopen; the saved draft is cleared when you click
**Done**. (Same pattern the EmailComposer already uses for drafts.)

File: `artifacts/thinking-spree/src/components/CleanSheetDialog.tsx`.

## 2. Content-aware headings + exact Target Group formatting
- **No more single "Action Taken (Sprint …)" label.** The AI now classifies
  each block of phrases and titles it from the sheet's own vocabulary —
  Background, Initial Product Approach, Product Development, Product Evolution,
  Journey, Current Traction, **Future Prospect** (forward-looking plans only),
  Actions Taken So Far, Tasks/Recommendation. One idea can produce several
  headed sub-blocks, written into "Actions taken so far".
- **Target Group table matches the finished sheets.** The audience append now
  writes the correct six columns — Target Audience · Use Cases · Priority ·
  Stakeholders · Sales Channels · Recommendation (previously misaligned into 5),
  applies a thin black border to every new cell, and **highlights the priority
  1 & 2 audience name cells green (`#D9EAD3`)** exactly like the template. The
  extraction now also captures `priority` and `stakeholders`.

Files: `artifacts/api-server/src/lib/tSheetCleaner.ts`,
`artifacts/thinking-spree/src/components/CleanSheetDialog.tsx`.

## 3. Loose phrases regrouped under headings on "Models and priority"
A new orphan-tidy pass scans the workbook for prose sitting in white space
(cells with no row label / outside any table column), then asks the AI to
regroup those exact lines under meaningful headings (Business Model, Target
Audience, Use Cases, Pricing, Competition, Go-To-Market, Additional Notes…). The
result is written as a clearly-labelled **"Re-organised Notes (AI)"** section on
the "Models and priority" tab. The AI only regroups existing text — it never
invents content — and nothing in the sheet is deleted.

File: `artifacts/api-server/src/lib/tSheetCleaner.ts` (`readOrphanText`,
`extractOrphans`), surfaced in the dialog and the company timeline.

## 4. Post-sprint email: reply-in-thread + "here" hyperlink
- **Reply threading** was already implemented (the post email replies inside the
  pre-sprint Gmail thread with `In-Reply-To` / `References` and a `Re:` subject)
  and is unchanged.
- **T-Sheet hyperlinked on the word "here".** The post-sprint template now reads
  "…Thinking Sheet for <Company> [here](…) for your reference." The model emits a
  safe `{{SHEET_URL}}` token (so it can never hallucinate the URL); the server
  substitutes the real Thinking Sheet URL, or unlinks gracefully if none is set.
  The email renderer converts `[here](url)` into a real anchor in the HTML part
  and `here (url)` in the plain-text part; the composer preview shows it as a
  clickable link too.

Files: `artifacts/api-server/src/lib/gemini.ts`,
`artifacts/api-server/src/routes/companyEmails.ts`,
`artifacts/thinking-spree/src/components/EmailComposer.tsx`.

## Verification
`pnpm install`, full `pnpm run typecheck` (libs + all artifacts + scripts, 0
errors), `pnpm --filter @workspace/thinking-spree run build` (Vite) and
`pnpm --filter @workspace/api-server run build` (esbuild) all pass. No new
dependencies and no new DB migration (email threading columns already exist from
migration 010; cleaned-sheet state is client-side localStorage).
