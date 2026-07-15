# v5.16 — Inspiration: segments, quantified matching, timeline roadmap

Reworks the Inspiration experience per consultant feedback.

## Comparables — two segments, quantified
- Suggestions now come in **two buckets**:
  - **Similar peers — one level up:** same problem, target and revenue band as
    the client, but a step ahead (a level they can reach next).
  - **Next level — scaled 5–10×:** the same space, well ahead — the journey to
    aspire to.
- Cards are now **data-first**: quantifiable metric chips (Revenue, Team size,
  Funding, Growth) instead of long paragraphs.
- **Match is multi-parameter**, not a single number: an overall score ring plus
  a 0–100 breakdown across Revenue, Growth, Target market, Problem–solution and
  Business model. Anything not public shows “N/D” — no invented figures.

## Roadmap — growth-phase timeline (like the reference tables)
- The roadmap is now a **phase-by-phase timeline table**: Timeline · Product &
  capability · Marketing & positioning · Funding & investment · Quantified
  growth · Key customers / partners — everything on one screen.
- **Every phase is clickable** — click a row to expand the full, readable detail
  for that stage plus its sources. (Fixes not being able to read a generated
  roadmap.)
- Header shows a quantifiable snapshot (Founded, HQ, Total funding, Latest
  revenue, Team size, Growth) + the multi-parameter match.

## Comparison tab — quantifiable + clickable
- Columns are now hard numbers: Match, Founded, HQ, Latest revenue, Team size,
  Total funding, Growth (long text removed).
- **Click any row to reopen that company's full roadmap.** CSV export updated to
  the quantifiable columns.

## Reliability
- Grounded Google Search now **degrades gracefully**: if the search tool isn't
  available on the installed SDK, the roadmap still generates (without live
  citations) instead of failing — so a roadmap is always accessible.

## Files changed
- `artifacts/api-server/src/lib/researchAi.inspiration.ts` — two-segment
  recommendations, multi-parameter match, phased-timeline roadmap, grounding
  fallback.
- `artifacts/api-server/src/routes/researchWorkspace.ts` — session stores the
  two segments.
- `artifacts/thinking-spree/src/pages/InspirationTab.tsx` — new cards, clickable
  timeline roadmap, quantifiable clickable comparison.
