# Changes — v5.8

## Sprint Tracking loads much faster
Two bottlenecks fixed:

1. **Backend N+1 query (the big one).** `GET /api/sprints` enriched each sprint
   by fetching its founder in a separate query — on the team-wide `scope=all`
   view that meant one DB round-trip *per sprint* (thousands of them). Now it
   batch-loads every referenced founder in a **single** `inArray` query and maps
   in memory, so the endpoint goes from N+1 queries to **2**, regardless of row
   count (`artifacts/api-server/src/routes/sprints.ts`).
2. **Rendering thousands of rows.** The page rendered the entire filtered list
   at once (each row has several `<select>`s — very heavy DOM). Added
   **pagination** (50 rows/page) with a First/Prev/Next/Last pager and an "X–Y of
   N" count, for both the table and card views. Filters/sort still apply across
   the whole set; only the current page is rendered
   (`artifacts/thinking-spree/src/pages/sprint-tracking.tsx`).

Net effect: the page should open quickly even with the full ~3,000-row register.
If you want it faster still, a follow-up could add a server-side date-window
default (e.g. last 90 days) — say the word.

## Consultant profile photo
Consultants can now replace the initials disc (e.g. "RP") with their own photo.

- **Settings → Profile**: drag & drop a JPEG/PNG/WebP onto the avatar circle (or
  click it / "Upload photo"). The image is downscaled client-side to ~256px and
  saved; "Change photo" / "Remove" are available.
- The photo then shows in the **sidebar user card** (and anywhere the avatar
  appears), falling back to initials when none is set.
- Stored as a small data URL in the existing `users.avatar_url` column (no object
  storage needed). New endpoint `POST /api/auth/me/avatar` (`{ dataUrl }` or
  `null` to clear); `/api/auth/me` already returns `avatarUrl`.
- Note: photos must be an image — PDFs aren't supported for the avatar (export
  a frame as JPEG/PNG first). The uploader validates type and size.

## Files
- Edited: `artifacts/api-server/src/routes/sprints.ts` (batch enrich),
  `artifacts/api-server/src/routes/auth.ts` (avatar endpoint),
  `artifacts/thinking-spree/src/pages/sprint-tracking.tsx` (pagination),
  `artifacts/thinking-spree/src/pages/settings.tsx` (photo uploader),
  `artifacts/thinking-spree/src/components/Layout.tsx` (sidebar photo).
- No new DB migration — `users.avatar_url` already exists.

## Notes
- Not type-checked or run here. Run `pnpm install && pnpm -r typecheck` and test
  before deploy.
