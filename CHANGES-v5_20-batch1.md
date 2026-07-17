# v5.20 — Batch 1 (UI/UX fixes)

Scope: the four contained changes. The Emails tab lands in Batch 2.

## 1. State persists across browser-tab switches (the "resets to New company" bug)
Root cause: `AuthGuard` in `App.tsx` rendered the loading skeleton on every
*fetch* of the `me` query — not just the first load. React Query's default
`refetchOnWindowFocus` re-ran that query each time the tab regained focus, so
the whole page unmounted and remounted blank.

Fixes (`src/App.tsx`):
- `refetchOnWindowFocus: false` on the query client.
- `AuthGuard` now blocks only on the initial load (`isLoading`), never on
  background revalidation.

Bonus (`src/pages/pre-sprint.tsx`): the selected company + active analysis tab
are mirrored into the URL (`?company=..&tab=..`), so even a hard refresh or a
shared link restores the exact screen.

## 2. Pre-Sprint decluttered
`src/pages/pre-sprint.tsx`:
- The always-on "Saved companies" left column is gone. The workspace now uses
  the full width.
- Saved companies live in a click-to-open slide-over (top-right "Saved
  companies" button with a live count). Selecting one loads it and closes the
  panel; a "New company" action sits in both the header and the panel.

## 3. Companies list page fully retired
- Deleted `src/pages/companies.tsx`.
- `src/App.tsx`: removed the `/companies` route + import; `/companies`,
  `/ventures`, `/sprints` now redirect to `/sprint-tracking` (the master list).
- `src/pages/post-sprint.tsx`: removed the Companies card.
- `src/components/Layout.tsx`: dropped `/companies` from the Post-Sprint nav match.
- `src/pages/dashboard.tsx`: "View companies" → "View tracking".
- NOTE: the company **detail** page (`/companies/:id`) is intentionally kept —
  Summary, Sprint Tracking and Growth Report deep-link into it.

## 4. Admin reworked
- New `src/pages/admin/home.tsx`: Admin now opens on Roles, Team and Settings
  (the things admins manage), instead of dropping onto the noisy import screen.
- `src/App.tsx`: `/admin` renders the new home; `/admin/import` still exists but
  is demoted to a secondary "Data import" utility on the home page.
- Roles / Team / Settings pages themselves are unchanged.

## Verified
All changed files pass a TSX syntax parse. Full typecheck/build should be run in
your environment (`pnpm run build`) as usual.
