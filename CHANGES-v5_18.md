# v5.18 — Pre-Sprint UX pass

## Navigation
- Removed the gold **AI** badge on Pre-Sprint.
- New **Research** tab sits between Pre-Sprint and Post-Sprint. It hosts the
  Inspiration Research workbench (moved out of Post-Sprint).
- **Post-Sprint** is now the operational hub: Summaries, Builder, Growth Report,
  Companies, Sprint Tracking.
- Old research-tools page still reachable at `/research/tools`.

## Pre-Sprint intake
- Removed the separate "add a company" step. You land straight on the profile
  form; the company **auto-saves the moment it's named** (or after deck
  auto-fill), then the analysis tabs unlock. No two-step flow.

## Overview (less wordy, more visual)
- **Target audience** is now a top-down **funnel** (Total market → Segment →
  ICP → Beachhead) so a founder can see how the market narrows to their wedge.
- New **Traction** row: customers/logos, growth, social-media metrics,
  partnerships, and highlights — bucketed, not prose.
- Everything else trimmed to short chips/facts.

## ICP Mapping (grounded)
- Now returns concise **buyer personas** (pains/goals/channels as chips) plus
  **real example target accounts** with website + public **LinkedIn** links,
  pulled from live sources. URLs are only shown when found in a real source
  (never fabricated), with a "confirm before outreach" note.

## Market Potential (Blue/Red Ocean)
- Rebuilt the chart: solid **numbered** markers (no more hazy overlapping
  translucent blobs or piled-up labels). Names/reasons live in a numbered list
  beside the quadrant. Concise rationale per segment.

## Demand Landscape
- Added a **"Why these states"** panel next to the map: each highlighted state
  shows its demand score and a short reason (clusters, GCCs, income, hiring…).
  Global markets get the same reasoning.

## AI prompts
- All Pre-Sprint generators instructed to return short, bucketed content
  (strings capped ~12–14 words) instead of paragraphs.

Setup unchanged from v5.17 (see CHANGES-v5_17.md): `pnpm install` →
`pnpm run typecheck` → run migration 013 → set `GEMINI_API_KEY` (+ Google
Search grounding, outbound egress).
