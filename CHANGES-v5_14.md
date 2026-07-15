# v5.14 — Research → Inspiration engine

Adds a consultant-only **Inspiration** sub-tab inside the Research tab. It finds
the closest real-world company to a client and turns it into a sourced,
actionable roadmap. Everything is web-grounded — no vague approximations.

## What's new
- **Inspiration sub-tab** in Research (`Inspiration` / `Research tools` switch).
  The five existing AI tools are untouched, just grouped under "Research tools".
- **Flow:** paste the client's Thinking-Sheet link + name, pick stage / revenue
  stage / industry / specialization → AI proposes the closest real comparables
  (with an honest match %) → pick one or type your own → grounded deep-dive.
- **Sourced deep-dive:** Product, Marketing, Sales Channels, Funding Raised,
  Revenue Generated, and Market research & potential. Every data point shows its
  public source or an explicit "Not publicly disclosed" badge.
- **Phased roadmap** translating the inspiration company's moves into steps the
  client can act on.
- Roadmaps are saved to the existing Research library (they appear in Global
  Search too), tagged `inspiration_roadmap`.

## How it works
- Reuses the existing Google-Sheet ingestion (`fetchSheetAsWorkbook`) so the
  pasted sheet becomes real prompt context.
- Uses **Google Search grounding** on `gemini-2.5-flash`
  (`tools: [{ googleSearch: {} }]`). Because grounding can't be combined with
  forced-JSON, the roadmap runs in two passes: a grounded gather (real citation
  URLs) then a strict-JSON structuring pass.
- No new dependencies — `@google/generative-ai` and `xlsx` were already present.

## Files changed / added
- `lib/db/src/schema/researchOutputs.ts` — added `inspiration_roadmap` to
  `RESEARCH_TOOLS` (no migration; reuses the `research_outputs` table).
- `artifacts/api-server/src/lib/researchAi.inspiration.ts` — **new** generators.
- `artifacts/api-server/src/routes/researchWorkspace.ts` — added
  `POST /research/inspiration/recommend` and `POST /research/inspiration/roadmap`.
- `artifacts/thinking-spree/src/pages/InspirationTab.tsx` — **new** UI.
- `artifacts/thinking-spree/src/pages/research.tsx` — mounted the sub-tab.

## Notes
- Requires `GEMINI_API_KEY` (already used elsewhere). Grounded Search queries
  bill beyond Google's free daily quota — each roadmap is ~3 grounded calls;
  consider a short server-side cache keyed on the inspiration company if
  consultants re-run the same one.
- Match % and roadmap transferability are the model's own honesty estimate —
  treat sub-80% as directional, and glance at the cited links before putting a
  funding/revenue figure in front of a founder.
