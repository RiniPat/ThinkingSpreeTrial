# Lovable Insight Dashboard Integration

This document records the visual redesign applied to the Sprint Automation
Suite, drawing inspiration from the Lovable "Insight Dashboard" template.

## What changed

All changes are **purely cosmetic / UI-layer** — no API, database, or auth
behaviour was modified. Everything still runs against the same Express +
Drizzle + Postgres backend.

### Theme (`src/index.css`)

Replaced the generic blue-on-white palette with the Lovable consulting
aesthetic:

- **Ivory canvas** (`--background: 40 28% 97%`) instead of grey-white
- **Deep navy** (`--primary: 222 55% 22%`) as the ink color
- **Brass gold** (`--gold: hsl(36 65% 56%)`) as the secondary accent
- **Instrument Serif** loaded as the display font for all `<h1>/<h2>/<h3>`
  and any element with `.font-serif`
- **JetBrains Mono** added as a sibling for monospace numerics
- HSL variable architecture preserved so existing shadcn/ui components keep
  working without modification

### Fonts (`index.html`)

Now loads Inter + Instrument Serif + JetBrains Mono from Google Fonts.

### Layout sidebar (`src/components/Layout.tsx`)

- Logo presented inside a white card (no more `.invert` filter hack)
- Brand block now shows "Thinking Spree" in serif + "Consultant Suite"
  caption underneath
- Added "Workspace" section header above nav items
- Active nav item gets a small **gold dot** on the right edge
- User card at the bottom now has a **gold avatar disc** with initials in
  serif, plus a discrete sign-out icon button
- Mobile logo also uses the white card treatment

### Dashboard (`src/pages/dashboard.tsx`)

Complete visual rebuild while preserving all data hooks
(`useGetStatsOverview`, `useListSprints`, `useGetMe`, calendar query):

- Greeting with **serif italic name** ("Good morning, *Pritesh*.")
- "All integrations connected" status pill in the top-right
- Stat cards now use a serif display number, delta + trend label, and a
  hover-reveal `ArrowUpRight` icon
- Today's Schedule restructured into a time-prefixed list with day-group
  headers (Today / Tomorrow / explicit date)
- New **Sprint Pipeline** widget with gradient progress bars (gold middle
  bar for emphasis)
- Recent T-Sprints rendered as a proper table with founder, date, host,
  status chip, and "Open" action
- Wider max-width (1400px) to take advantage of the new full-bleed layout

### Login page (`src/pages/login.tsx`)

- Card-on-ivory layout with soft blurred gradient orbs in the background
  (primary + gold)
- Brand block uses serif "Thinking Spree" wordmark
- Google sign-in button promoted to the top with the official Google logo
  and the same `handleGoogle` flow as before — **no auth code changed**
- Email/password form kept as the secondary option below an "or with
  email" separator

### Add Incubator dialog (`src/pages/summary.tsx`)

**The `type` field stays** — per the request, the Sprint Automation Suite
keeps the existing ISB/JU type selector. Only cosmetic changes:

- Title switched to serif ("Add Incubator")
- Labels lifted to uppercase-tracking style (matches the new dashboard)
- Backdrop now uses a subtle blur
- Action buttons separated by a top border for visual breathing room
- Close button gets a hover background

## What did **not** change

- All API routes and database schema (`type` column still required)
- Google OAuth flow (`/api/auth/google/start` → `/api/auth/google/callback`)
- Email/password auth and signup flow
- TanStack Query data hooks and cache keys
- Wouter routing
- Render deployment config (`render.yaml`)
- All other pages (Ventures, Sprints, Sprint Detail, Sprint Tracking,
  Settings, Admin) — they inherit the new theme automatically through CSS
  variables but retain their original layouts

## Verification

```bash
pnpm install
pnpm run typecheck:libs     # builds api-client-react .d.ts files
pnpm --filter "@workspace/thinking-spree" run typecheck   # passes
pnpm --filter "@workspace/thinking-spree" run build       # passes
```
