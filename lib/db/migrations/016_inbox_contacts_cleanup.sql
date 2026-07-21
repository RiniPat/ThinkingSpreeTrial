-- 016_inbox_contacts_cleanup.sql
-- The Inbox CRM must only contain people the consultant actually emailed from
-- their connected Gmail. Earlier builds could ingest inbound-only senders and
-- synthetic/imported placeholder addresses (e.g. *@tracking.imported,
-- *@pre-sprint.local, *@placeholder.local) that the app mints for founders
-- without a real email. Purge those so they never show up as "random emails".
-- Idempotent; safe to re-run. The background sync also repeats this cleanup.

DELETE FROM contacts
WHERE email LIKE '%@tracking.imported'
   OR email LIKE '%@pre-sprint.local'
   OR email LIKE '%@placeholder.local'
   OR email LIKE '%.imported'
   OR email LIKE '%.local'
   OR email LIKE '%.internal'
   OR email LIKE '%.invalid'
   OR email LIKE '%.test'
   OR email LIKE '%.example'
   OR email LIKE '%.localhost';

-- Contacts we have never sent a single email to are inbound-only (newsletters,
-- cold inbound, notifications). The CRM is an outreach tool, so drop them.
DELETE FROM contacts WHERE sent_count = 0;
