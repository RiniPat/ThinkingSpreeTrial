# Sales · Follow-ups — setup (already wired into this repo)

All code + edits are already in this codebase. What's left is env + one sheet
column + a smoke test. Migrations run automatically on deploy.

## Environment (Render dashboard → Environment)
- `LIVE_TRACKING_SHEET_URL` = https://docs.google.com/spreadsheets/d/1fOt_wi7JAqacmviiq4sMlsgWS7ucbhHzk0dCnuQ754c/edit
- `CRON_SECRET` = a long random string (for reply-scan cron)
- (optional in-process scan instead of cron) `FOLLOWUP_SCAN_ENABLED=true`, `FOLLOWUP_SCAN_INTERVAL_MIN=15`

No new Google scopes — gmail.send, gmail.readonly, spreadsheets already granted.

## Migrations (auto)
`run-migrations.mjs` applies 020/021/022 on deploy (idempotent):
- 020_sales_followups.sql — follow-up state table
- 021_followup_templates.sql — adds subject/sort_order to email_templates + seeds the 3 templates
- 022_user_followup_profile.sql — adds title/phone/calendar_link to users

## Dependency (auto)
`sanitize-html` (+ @types) added to artifacts/api-server/package.json. Render's
build runs `pnpm install --frozen-lockfile=false`, so it installs on deploy — no
local install needed.

## The one manual data step
Add a **"Sprint Completed"** (Yes/No) column to the tracking sheet. Until then the
page shows an amber banner and marks nothing "Due"; everything else works.

## Reply-scan cron (recommended)
Render → New → Cron Job, every 15 min:
```
curl -fsS -X POST https://<your-app>/api/sales/followups/cron-scan -H "x-cron-secret: $CRON_SECRET"
```

## Smoke test after deploy
1. Log in (consultant/sales/admin) → Sales tab visible.
2. Refresh → clients + stats populate.
3. Open a client → pick template → merge + sign-off fill; unfilled [brackets] highlighted; Send guard works; email arrives formatted.
4. Reply from client → Scan replies (or cron) → chip flips; classify Interested/Not now/No reply.
5. Templates tab: edit/add/delete + save your sign-off. Log client / Clients / Pipeline tabs work.

Security: every route gated server-side (requireSales: consultant|sales|admin);
HTML sanitised on store + send; cron gated by x-cron-secret.
