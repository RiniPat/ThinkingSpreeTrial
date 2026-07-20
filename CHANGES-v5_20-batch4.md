# v5.20 — Batch 4 (Sales tab → Inbox CRM / Gmail analyser)

The entire Sales tab is replaced by a Gmail-powered inbox CRM. Sales/Admin only.

## Retired
- Frontend pages deleted: `sales-leads.tsx`, `linkedin-outreach.tsx`,
  `proposal-builder.tsx`. Their routes now redirect to `/sales`.
- (`sales_leads` table is kept — it's the target of "promote to pipeline".)

## New feature — Sales → Inbox CRM (`src/pages/sales-inbox.tsx`)
Reads every email the Sales/Admin user has sent or received, dedupes senders/
recipients into one contact per address, and presents them as an editable,
filterable CRM sheet with inbox analytics.

- Analytics tiles: Contacts · Emails analysed (sent/received) · Reply rate ·
  Going cold. Plus a role-distribution bar.
- Filters: search, role chips (Founder/Investor/Partner/Other), status
  (Awaiting reply / Replied / Going cold), and sort. All server-side + paginated.
- Contact roles are AI-assigned with a confidence dot; the user can change any
  role from a dropdown, which locks it (shows "You") so a later sync never
  overwrites it. "Other" takes a free-text label (Vendor, Press, Mentor…).
- Source column dropped (everything is from the inbox) — replaced by a reply-
  status + "promote to pipeline" column. Promote creates a `sales_leads` row.
- Time window selector: 3 / 6 / 12 / 18 / 24 / 36 months / All time. "Analyse
  window" runs a full pass; "Refresh" pulls only new mail since the last sync.

## Performance (built so the platform never slows)
- Gmail is touched ONLY in a background job (fire-and-forget). Sync/Refresh
  return 202 immediately; the UI polls a small status row and shows progress.
- The grid/analytics read the `contacts` table (indexed, paginated, filtered
  server-side) — never Gmail on render.
- Message fetches are headers-only (`format: metadata`), bounded concurrency,
  capped per run. Classification uses domain heuristics first, AI only for the
  ambiguous remainder, batched (~40/call) → tens of model calls per inbox.
- Refresh is incremental (only mail newer than last sync).

## Backend
- New tables: `contacts` (per-user, deduped) and `contact_sync_state`
  (`lib/db/src/schema/contacts.ts`, migration `015_inbox_contacts.sql`).
- New route `src/routes/contacts.ts`: `POST /contacts/sync`,
  `GET /contacts/sync-status`, `GET /contacts`, `GET /contacts/stats`,
  `PATCH /contacts/:id`, `POST /contacts/:id/promote`. Registered in index.ts.
- New lib `src/lib/contactsAi.ts`: `heuristicRole` + batched
  `classifyContactsBatch` (Gemini 2.5 Flash).
- Access gate: new `canAccessInboxCrm` (sales + admin) in `roles.ts`, exposed
  via `/me/permissions`; Sales nav + all `/contacts` endpoints require it.

## Notes / assumptions
- Per-user: each Sales/Admin analyses their own connected Gmail (matches the
  "refresh the connected gmail" flow). An org-wide roll-up can be added later.
- Uses the `gmail.readonly` scope you already request — no new consent.
- First "All time" run on a large mailbox processes in the background over some
  minutes; the UI stays fully usable throughout.

## Verified
All new/changed files pass a TSX/TS parse. Run `pnpm run build` for a full
typecheck and `pnpm --filter @workspace/db run push` / migrations on deploy.

## Hotfix (batch 4a)
- `sales-inbox.tsx`: guard the role→style lookup with `metaFor()` so an unexpected/empty contact role can never throw `Cannot read properties of undefined (reading 'bg')`. Falls back to the "Other" style.
