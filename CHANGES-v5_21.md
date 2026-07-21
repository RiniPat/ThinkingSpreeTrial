# v5.21 — Inbox CRM: Gmail-contacted-only + richer AI categories

Two fixes to the Sales → Inbox CRM.

## 1. Only show people you actually emailed from Gmail

Before, the inbox sync ingested *every* counterparty in the mailbox window —
including cold inbound, newsletters, automated notifications, and synthetic
imported placeholder addresses (`@tracking.imported`, `@pre-sprint.local`,
`@placeholder.local`). That produced the "random emails".

Now the contact set is derived **from sent mail only**:

- `artifacts/api-server/src/routes/contacts.ts`
  - `isRealContact()` gate rejects self, malformed addresses, and all
    synthetic/imported placeholder domains.
  - Two-phase aggregation: a contact is **seeded only from a message you sent**.
    Inbound mail merely adds reply/received counts, and only for counterparties
    already known (present in this sync's sent mail *or* already in your CRM, so
    replies to older outreach still attach during an incremental refresh).
  - Every sync purges any placeholder/imported rows a previous build may have
    written, plus inbound-only rows (`sent_count = 0`).
- `lib/db/migrations/016_inbox_contacts_cleanup.sql` — one-time DB cleanup of
  synthetic and inbound-only contacts. Idempotent.

Result: the grid, stats, reply rate, and distribution reflect genuine outreach.

## 2. AI segregates into more categories than founder / investor

The coarse bucket set expanded from 4 to 9: **founder, investor, partner,
mentor, customer, vendor, media, talent, other**. The AI also now emits a
specific free-form sub-label (e.g. "Accelerator", "Angel investor",
"Design agency", "Journalist") shown as a pill next to each contact.

- `artifacts/api-server/src/lib/contactsAi.ts` — expanded taxonomy, richer
  heuristics (media / accelerator / institution domains), and the classifier
  now returns `{ role, roleLabel, confidence, reason }`.
- `contacts.ts` — persists the AI `roleLabel`; list filter and PATCH accept the
  full role set. User-set roles/labels stay locked from re-sync overwrite.
- `lib/db/src/schema/contacts.ts` — `CONTACT_ROLES` expanded (role column is
  free text, so no destructive migration needed).
- `artifacts/thinking-spree/src/pages/sales-inbox.tsx` — new category colours,
  filter chips, distribution legend, per-row dropdown, and an editable
  sub-label field on any contact.

No breaking API or schema changes; existing user-locked roles are preserved.
