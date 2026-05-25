# Google Integration Setup Guide

Step-by-step instructions to wire **Google Calendar, Gmail, Drive, and Sheets** into the Sprint Automation Suite. You'll need ~30 minutes and access to a Google Cloud account (your $300 free trial credit is more than enough — none of the APIs we use typically incur charges at consultant-scale volume).

---

## What you'll end up with

* Each consultant clicks **Connect Google account** in **Settings → Integrations** and authorises Thinking Spree with one click.
* The dashboard pulls **today's real Google Calendar events** instead of falling back to local sprint records.
* Gmail send, Drive uploads, and Sheets sync work the same way (one OAuth, four scopes).
* A built-in **Run Connection Test** button hits each service so you'll know immediately if a scope works.

---

## Part 1 — Google Cloud Console (one-time, ~15 min)

### 1.1 Create a project

1. Go to <https://console.cloud.google.com/>.
2. Click the project dropdown (top bar) → **New Project**.
3. Name it `Thinking Spree` → **Create**.

### 1.2 Enable the four APIs

Open each link and click **Enable** (make sure the right project is selected at the top):

| API | Link |
| --- | --- |
| Google Calendar API | <https://console.cloud.google.com/apis/library/calendar-json.googleapis.com> |
| Gmail API | <https://console.cloud.google.com/apis/library/gmail.googleapis.com> |
| Google Drive API | <https://console.cloud.google.com/apis/library/drive.googleapis.com> |
| Google Sheets API | <https://console.cloud.google.com/apis/library/sheets.googleapis.com> |

> 💸 **Cost:** all four APIs have a generous free quota. With ~10 consultants doing typical day-to-day work, you'll stay well within free limits. Your $300 trial credit is essentially untouched.

### 1.3 Configure the OAuth consent screen

1. **APIs & Services → OAuth consent screen** (left nav).
2. **User Type:** `External` → **Create**.
3. App information:
   * **App name:** `Thinking Spree`
   * **User support email:** your work email
   * **App logo:** optional (`attached_assets/thinkingspree_logo_*.jpg` works)
4. **App domain — Authorised domains:** add the domain you'll deploy on (e.g. `thinkingspree.com` or your Replit/Render/Fly domain — no `https://`, just the host).
5. **Developer contact information:** your work email → **Save and Continue**.
6. **Scopes → Add or Remove Scopes** — add these ten scopes:

   ```
   openid
   .../auth/userinfo.email
   .../auth/userinfo.profile
   .../auth/calendar
   .../auth/gmail.send
   .../auth/gmail.readonly
   .../auth/drive.readonly
   .../auth/drive.file
   .../auth/spreadsheets
   ```

   Save → Continue.

7. **Test users** — add every `@thinkingspree.com` consultant who needs access (up to 100 while in *Testing* mode). When you're ready, click **Publish App** to remove the test-user limit. For internal-only use you can stay in Testing forever.

### 1.4 Create OAuth client credentials

1. **APIs & Services → Credentials** → **+ Create Credentials → OAuth client ID**.
2. **Application type:** `Web application`.
3. **Name:** `Thinking Spree — Web`.
4. **Authorized redirect URIs** — add **all** the URIs you'll deploy on, with the path `/api/google/oauth/callback`. For example:
   ```
   http://localhost:5000/api/google/oauth/callback
   https://your-app.replit.app/api/google/oauth/callback
   https://app.thinkingspree.com/api/google/oauth/callback
   ```
5. **Create** → Google shows you a **Client ID** and **Client Secret**. Copy both.

---

## Part 2 — Server environment variables

Set these on whichever host runs the API server (Replit Secrets, `.env`, Fly secrets, etc.):

| Variable | Value | Example |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | From step 1.4 | `1234567890-abcd…apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | From step 1.4 | `GOCSPX-xxxx…` |
| `GOOGLE_REDIRECT_URI` | Must exactly match one of the redirect URIs you registered | `https://your-app.replit.app/api/google/oauth/callback` |
| `APP_BASE_URL` | Where the user gets sent after callback (your frontend) | `https://your-app.replit.app` |

Restart the API server.

> ⚠️ **Trailing slash matters.** Google validates the redirect URI byte-for-byte. If you register `…/callback`, you must use `…/callback` (no trailing `/`) in the env var.

---

## Part 3 — Database migration & seed

From the project root:

```bash
# Apply the schema migration (sprints + founders extensions + google_tokens table)
psql "$DATABASE_URL" -f lib/db/migrations/001_extend_schema.sql

# Drop the three Excel files into the seed-data folder
mkdir -p scripts/seed-data
cp /path/to/ISB_Summary_Sheet.xlsx   scripts/seed-data/
cp /path/to/JU_Summary_Sheet.xlsx    scripts/seed-data/
cp /path/to/Sheet_Tracking.xlsx      scripts/seed-data/

# Run the seed
cd scripts && pnpm run seed:summary
```

The seed is **idempotent** — re-running it updates existing rows in place instead of duplicating them. It creates three incubators (`ISB IVI 4.0`, `JU Cohort`, `Demo Program`) and imports all the rich summary fields (Goal Setting, Key Strength, Gap, Market Access, Fund Ask, Case Study theme, etc.) plus the 1,900+ tracked sprints with Sprint Host / Co-Host fields.

---

## Part 4 — Connect your account & test

1. Log in as a consultant (`@thinkingspree.com`).
2. **Settings → Google Integrations → Connect Google account**.
3. Approve the four scopes (Calendar, Gmail, Drive, Sheets).
4. You'll land back on `/settings?google=connected`.
5. Click **Run test**. You should see four green check-marks within ~2 s:
   * ✅ Calendar — "Found N calendar(s)"
   * ✅ Gmail — "Mailbox: you@thinkingspree.com"
   * ✅ Drive — "Drive of you@thinkingspree.com"
   * ✅ Sheets — "Sheets API reachable; N sheet(s) visible"

If any service fails, the error message comes straight from Google — usually it's a missing scope (run through 1.3 again) or a redirect-URI mismatch (1.4).

---

## Part 5 — How each service is used

| Service | Where it shows up |
| --- | --- |
| **Calendar** | `Dashboard → Today's Schedule` pulls live Calendar events. If disconnected, falls back to today's sprints assigned to you. |
| **Gmail** | Send button in `Sprint Detail → Pre/Post emails` uses your Gmail send scope. The from-address is your real Gmail; replies come back to your inbox. |
| **Drive** | T-Sheets and Fathom recordings can be linked or uploaded from Drive (currently link-only; upload available via `drive.file` scope). |
| **Sheets** | Each incubator has a `sheetUrl`. With the Sheets scope, the seed script can also be re-run from a Google Sheet URL instead of a local `.xlsx`. |

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| "redirect_uri_mismatch" | The `GOOGLE_REDIRECT_URI` env var must **exactly** match a URI registered in step 1.4 — same scheme, host, port, and path. |
| "Access blocked: This app's request is invalid" | The OAuth consent screen isn't published and the user isn't in the test-user list. Add them (step 1.3 step 7) or publish the app. |
| Test returns "Insufficient Permission" for a service | The scope wasn't approved during OAuth. Click **Disconnect**, then **Connect** again and approve all scopes on the consent screen. |
| Tokens stop working after 7 days | Your OAuth app is still in Testing mode (Google expires refresh tokens after 7 days for unverified apps). Publish the app or accept that consultants will re-auth weekly. |
| 503 "Google OAuth not configured" | Server-side env vars are missing — confirm `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` are all set, then restart. |

---

## Security notes

* Refresh tokens are stored in the `google_tokens` table per user. Disconnecting deletes the row.
* The OAuth state parameter is generated as a cryptographically random hex string and stored in the session — protects against CSRF on the callback.
* The OAuth client secret never leaves the server.
* No tokens are ever logged.
