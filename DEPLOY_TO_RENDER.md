# Deploy to Render + Neon (Free Tier)

Total time: ~45 minutes. Total cost: **$0/month**. You'll end up with `app.thinkingspree.com` (or any domain you own) live with everything wired up.

> **What you'll be running:** Web service on Render free tier (sleeps after 15 min idle, wakes in ~10s on first hit), Postgres on Neon free tier (0.5 GB, no sleep), Google OAuth from your free Google Cloud account.

---

## Part 1 — Push the code to GitHub (5 min)

1. Create a new **private** repo on GitHub: <https://github.com/new>. Don't initialise it with anything (no README, no .gitignore).
2. In your terminal, from the unzipped project root:

   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/sprint-automation-suite.git
   git push -u origin main
   ```

> 🔒 **Keep the repo private.** The code contains hardcoded company-specific logic (`@thinkingspree.com` email allow-list, ISB/JU schema). No secrets in the code, but the consultant workflow shouldn't be public.

---

## Part 2 — Provision a free Postgres on Neon (5 min)

1. Go to <https://neon.tech> → sign up with GitHub.
2. **Create Project** → name it `thinking-spree`. Region: pick the one closest to your users (Singapore/Mumbai for India).
3. On the project dashboard, copy the **Connection String** that looks like:
   ```
   postgresql://USER:PASSWORD@ep-xxxx.aws.neon.tech/neondb?sslmode=require
   ```
4. Keep this tab open — you'll paste it into Render in Part 3.

> 💡 **Free forever, no sleep.** Neon's free tier gives you 0.5 GB storage and unlimited reads/writes. It only "pauses" if you have zero connections for 5 minutes, and wakes in ~1 second on first query.

---

## Part 3 — Deploy to Render (10 min)

1. Go to <https://render.com> → sign up with GitHub.
2. **+ New → Blueprint** (not "Web Service" — the project has a `render.yaml` that does the config for you).
3. **Connect** your GitHub account, select the `sprint-automation-suite` repo.
4. Render reads `render.yaml` and shows you the service it'll create. Click **Apply**.
5. While the build runs (~4 minutes), open the new service's **Environment** tab and add these env vars:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | Paste from Neon (Part 2 step 3) |
   | `APP_BASE_URL` | Your Render URL — e.g. `https://thinking-spree.onrender.com` (you'll see it at the top of the service page) |
   | `GOOGLE_CLIENT_ID` | _Leave blank for now — set in Part 5_ |
   | `GOOGLE_CLIENT_SECRET` | _Leave blank for now — set in Part 5_ |
   | `GOOGLE_REDIRECT_URI` | `https://thinking-spree.onrender.com/api/google/oauth/callback` _(use your real Render URL)_ |

   Render auto-generates `SESSION_SECRET` and sets `NODE_ENV=production` for you.

6. Once the first build finishes (Logs tab will show `Server listening`), open the Render URL in a browser. You should see the **Consultant Portal** login page.

> ⚠️ **First request is slow.** The free tier puts the service to sleep after 15 min of inactivity. First request after sleep takes 10–30 seconds to wake. Subsequent requests are instant. For 5–10 consultants using the app during work hours, it'll stay hot most of the day.

---

## Part 4 — Create your first account (1 min)

1. Open the Render URL → click **"Create one"** at the bottom of the login form.
2. Fill in:
   - **Full Name** — exactly how you appear in the summary sheets (e.g. `Vani Agarwal`). This is how the dashboard matches your sprints!
   - **Work Email** — your `@thinkingspree.com` email
   - **Password** — at least 8 characters
3. Click **Create Account**. You'll land on the dashboard (it'll be empty until Part 6 seeds data).

> Anyone else on the team can do the same — they go to your-app-url/signup. The `@thinkingspree.com` domain restriction is enforced server-side.

---

## Part 5 — Wire up Google OAuth (15 min)

Now that you have the Render URL, follow `GOOGLE_INTEGRATION_SETUP.md` in the repo for the full step-by-step. The condensed version:

1. <https://console.cloud.google.com> → Create Project `Thinking Spree`.
2. Enable APIs: Calendar, Gmail, Drive, Sheets.
3. **OAuth consent screen** → External → add your Render URL's hostname to Authorised domains → add the 10 scopes listed in the full guide → add `@thinkingspree.com` test users.
4. **Credentials → Create OAuth Client ID → Web application**. Authorized redirect URI: `https://thinking-spree.onrender.com/api/google/oauth/callback`. Save.
5. Copy Client ID + Client Secret → back to Render → Environment → update `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Render auto-redeploys on env changes.
6. Once redeployed, log into the app → **Settings → Google Integrations → Connect** → approve scopes → **Run Test**. All 4 checks should turn green.

---

## Part 6 — Your data is already seeded ✨

The three Excel files (ISB Summary, JU Summary, Sheet Tracking) are **baked into the repo** at `scripts/seed-data/`. When Render builds your service for the first time and connects to an empty Neon database, the build automatically runs them.

You should see this in the **Logs** tab during your first build:

```
🗄  Applying 1 migration(s)…
   → 001_extend_schema.sql
✅ Migrations applied
📦 Found 3 seed file(s); will seed.
🌱 Running first-time seed…
✓ Incubators: ISB=1  JU=2  Demo=3
📊 ISB summary: 47 imported, 2 skipped
📊 JU summary: 13 imported, 1 skipped
📅 Sheet tracking: 1931 imported, 0 skipped, 0 already-existed
✅ Seed complete
```

After the build finishes, log into your app and the dashboard / Summary / Sprint Tracking pages will already have your data.

> 🔁 **Subsequent deploys don't re-seed.** Once the `founders` table has rows, the build's seed step is skipped. To refresh data, use the in-app upload (next section).

### Refresh data later — `/admin/import` (in-app, browser-only)

When the Sheet Tracking file changes (you usually update it weekly), no terminal or laptop work needed:

1. Sign into the app as an **admin** (your first signup is automatically promoted).
2. Sidebar → **Import Data** (only visible to admins).
3. Drag & drop the updated `.xlsx` onto the page → Render parses it.
4. **Append-only**: existing rows (matched by company name + sprint date) are left alone; only genuinely new rows are added. Safe to re-upload the same file many times.

You can also use this for the ISB/JU summary sheets. The page **auto-detects** which kind of sheet you uploaded based on its columns.

### Wipe and start over

If you ever need to re-seed from scratch:

1. Neon → SQL Editor → run:
   ```sql
   TRUNCATE founders, sprints, incubators, email_logs, google_tokens RESTART IDENTITY CASCADE;
   ```
2. Render dashboard → your service → **Manual Deploy → Deploy latest commit**.
3. Build will re-run the seed because `founders` is empty again.

---

## Part 7 — Custom domain `app.thinkingspree.com` (10 min)

1. On Render, go to your service → **Settings → Custom Domains → Add Custom Domain**.
2. Enter `app.thinkingspree.com` → Render shows you a CNAME target like `thinking-spree.onrender.com`.
3. Go to your domain registrar (where you bought `thinkingspree.com` — GoDaddy, Namecheap, Cloudflare, etc.).
4. Add a DNS record:
   - **Type:** CNAME
   - **Host:** `app`
   - **Value:** `thinking-spree.onrender.com` (whatever Render showed you)
   - **TTL:** Auto / 3600
5. Wait 5–15 minutes for DNS propagation. Render automatically issues a Let's Encrypt SSL certificate.
6. **Update Google OAuth** — back to Google Cloud Console, add `https://app.thinkingspree.com/api/google/oauth/callback` as an additional authorized redirect URI.
7. **Update Render env vars:**
   - `APP_BASE_URL` → `https://app.thinkingspree.com`
   - `GOOGLE_REDIRECT_URI` → `https://app.thinkingspree.com/api/google/oauth/callback`

Done. `https://app.thinkingspree.com` now points to your app.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Application failed to respond" / 502 | Service is waking from sleep. Wait 30s and refresh. If it persists, check Logs tab on Render. |
| Dashboard shows no sprints after seed | Sign up with a name that **exactly matches** the Host column in Sheet_Tracking.xlsx (e.g. `Vani`, not `Vani Agarwal` if the sheet says just "Vani"). The scope filter is name-based. |
| "redirect_uri_mismatch" during Google connect | Check that `GOOGLE_REDIRECT_URI` on Render exactly matches the redirect URI registered in Google Cloud Console — same scheme, host, path. No trailing slash. |
| Build fails on Render with "pnpm: not found" | Render's Node images include corepack but not pnpm. The build command runs `corepack enable && corepack prepare pnpm@10.33.4 --activate` first which downloads the right pnpm version. If it still fails, check NODE_VERSION env var is `22`. |
| Build fails with `[ERR_PNPM_IGNORED_BUILDS]` mentioning esbuild | Means Render is using pnpm 11 instead of pnpm 10 (we pin to 10 via `packageManager` in `package.json`). Verify `package.json` contains `"packageManager": "pnpm@10.33.4"` and that `render.yaml`'s buildCommand starts with `corepack enable && corepack prepare pnpm@10.33.4 --activate`. |
| Build fails with `preinstall: Use pnpm instead` | The Replit-specific guard script is back in `package.json`. Confirm `package.json` has no `"preinstall"` key. |
| Migration error: `relation "sprints" does not exist` | Old version of the migration file. The current one (`lib/db/migrations/001_extend_schema.sql`) creates tables first, then extends. Pull the latest from the repo. |
| Login succeeds but the next request returns 401 / kicks back to login | Session not persisting. The current auth route calls `req.session.save()` explicitly before responding — verify `artifacts/api-server/src/routes/auth.ts` has `respondWithSession()` wrappers around the `res.json()` calls. |
| Sessions don't persist (logged out on every refresh) | The `connect-pg-simple` table didn't create. Open Neon SQL Editor and run: `SELECT * FROM user_sessions LIMIT 1;` If the table is missing, the migration didn't run. Trigger **Manual Deploy → Deploy latest commit** to re-run it. |
| Dashboard empty / `/admin/import` not in sidebar | Sidebar shows admin pages only for users with `role='admin'`. The very first signup is auto-promoted; subsequent users are consultants. To promote someone, log in as the first user → Settings → Admin Tools → Team Management. If no admin exists yet, open Neon SQL Editor: `UPDATE users SET role='admin' WHERE email='you@thinkingspree.com';` |
| Google login → "Access blocked: This app is not verified" | Your OAuth consent screen is still in Testing mode. Either add the user as a test user (Google Cloud → APIs & Services → OAuth consent screen → Audience → Test users), or Publish the app (still free, no verification needed for `<100 users`). |
| Upload xlsx → "Could not detect sheet type" | The file's first sheet's headers don't match any known format. Click the explicit type (ISB Summary / JU Summary / Sheet Tracking) button on the import page instead of Auto-detect. |
| Free tier exceeded ("This service has been spun down due to inactivity") | Normal. First request wakes it up in ~10s. To avoid sleeping during business hours, use a free uptime monitor like UptimeRobot (5-min ping) — but this counts against your 750 free hours/month, so the service will sleep again about ~6 days before month-end. |

---

## What's running where

```
                                ┌──────────────────────┐
   User browser                 │  GitHub repo         │
        │                       │  (private)           │
        │                       └──────────┬───────────┘
        │                                  │ git push
        │                                  ▼
        │ HTTPS               ┌──────────────────────┐
        ├────────────────────►│  Render Web Service  │
        │                     │  ────────────────    │
        │                     │  Express + Vite SPA  │
        │                     │  (bundled)           │
        │                     │  $0 — 750 hr/mo      │
        │                     │  sleeps after 15 min │
        │                     └──────────┬───────────┘
        │                                │
        │                  ┌─────────────┼──────────────┐
        │                  │             │              │
        │                  ▼             ▼              ▼
        │           ┌──────────┐  ┌──────────┐  ┌─────────────┐
        │           │  Neon    │  │  Google  │  │  Anthropic? │
        │           │ Postgres │  │   APIs   │  │   OpenAI?   │
        │           │  $0      │  │   $0     │  │  (optional) │
        │           │ 0.5 GB   │  │ free use │  │             │
        │           └──────────┘  └──────────┘  └─────────────┘
        │
        └─ Custom domain: app.thinkingspree.com (free SSL via Render)
```

That's it. Monthly running cost: **$0**. If usage grows beyond the free tier (unlikely for a 10-person team), Render Starter is $7/mo and removes sleep.
