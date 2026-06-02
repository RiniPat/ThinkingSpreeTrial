# What's new in v4.1 (live verification + 5 bug fixes)

After v4 was packaged, I ran the entire stack end-to-end against a real Postgres 16 instance with the real seed data (47 ISB-summary + 13 JU-summary + 1,930 sprint rows). Five additional bugs surfaced that wouldn't have been caught by typecheck or unit testing. All fixed.

## Bug 1 — Migration not idempotent on redeploy
**Symptom:** Every redeploy after the first crashed with `relation "users_google_sub_unique" already exists`.

**Root cause:** The DO block in `001_extend_schema.sql` caught `duplicate_object` but Postgres 16 actually raises `duplicate_table` (`42P07`) for unique constraints backed by an implicit index.

**Fix:** Added `WHEN duplicate_table THEN NULL` to the exception handler.

**Verification:** Ran migrations 3× in a row — clean each time, founder/sprint counts identical.

## Bug 2 — Importer crashed on fractional Sprint Session Numbers
**Symptom:** `error: invalid input syntax for type integer: "0.5"` aborted the entire seed.

**Root cause:** Your real `Sheet_Tracking.xlsx` has fractional session numbers (`0.5` and `5.1` for half-sessions). The importer was passing the raw float to a Postgres INTEGER column.

**Fix:** Added an `ni()` helper that truncates to int via `Math.trunc`. Applied to all integer columns: `sprintNumber`, `teamSize`, `week`, `month`, `cyYear`.

**Verification:** Full seed now completes: 47 ISB summary + 13 JU summary + 1,930 sprints across 1,211 unique companies.

## Bug 3 — Summary page polluted with auto-created tracking founders
**Symptom:** ISB tab showed 456 ventures, JU tab showed 46 — not the 47/13 you curated.

**Root cause:** When the Sheet Tracking importer sees a row where `Program Name` contains "ISB" or "JU", it auto-creates a founder row and tags it with that incubator's `incubator_id`. So the Summary page (which queries `WHERE incubator_id = $1`) returned ~700 tracking-only founders alongside the curated ones.

**Fix:** Added a `source` column to the founders table (values: `isb-summary` / `ju-summary` / `sheet-tracking`). The Summary endpoints now filter to founders matching the matching summary source. Migration is additive (`ADD COLUMN IF NOT EXISTS`) so safe on existing deployments.

**Verification after fix:**
```
source         | count
---------------+-------
isb-summary    |    47
ju-summary     |    13
sheet-tracking | 1,151
```

`GET /incubators` returns 47 / 13 venture counts — clean.

## Bug 4 — Reseed created duplicate NULL-sprint-number rows
**Symptom:** Each call to `/admin/reseed` added 3 new rows even though the underlying xlsx was unchanged. Sprint count drifted upward: 1,930 → 1,933 → 1,936 …

**Root cause:** Dedup key was `sprintNumber ?? -1`. For rows where Sprint Session Number is blank (3 of them in your data), the importer compared `WHERE sprint_number = -1` against existing DB rows where the column was `NULL`. SQL `NULL` never equals anything, so the existing rows were never found — every reseed re-imported them.

**Fix:** Branch the dedup query: when the new row has no sprint number, use `WHERE sprint_number IS NULL`; when it has one, equality compare.

**Verification:** Sprint count remained at 1,930 across 3 consecutive `/admin/reseed` calls and 3 consecutive CLI seeds.

## Bug 5 — `trust proxy` missing breaks sessions behind Render's TLS terminator
**Symptom:** In production, login returns 200 but no `Set-Cookie` header — session never persists, every request looks unauthenticated.

**Root cause:** Render terminates TLS in front of the app and forwards as plain HTTP with `X-Forwarded-Proto: https`. Without `app.set("trust proxy", 1)`, Express sees `req.secure === false` and refuses to send a Set-Cookie header for `cookie.secure: true`.

**Fix:** Added `app.set("trust proxy", 1)` in `app.ts` before the session middleware.

**Verification:** Login + `auth/me` roundtrip works end-to-end. (Test ran in dev mode; the trust-proxy line is what matters for prod.)

## Test summary

22/22 endpoint tests passed in the final run, against real PG with real data:

| Test | Result |
|------|--------|
| server boot                                    | ✅ |
| login (session cookie set)                     | ✅ |
| auth/me after login                            | ✅ |
| GET /sprints?scope=all (1,930 rows)            | ✅ |
| GET /incubators (ISB+JU only, no Demo)         | ✅ |
| GET /incubators/:id ISB has 47 ventures        | ✅ |
| GET /incubators/:id JU has 13 ventures         | ✅ |
| GET /calendar/events default (1d)              | ✅ |
| GET /calendar/events?days=7 (week)             | ✅ |
| GET /stats/overview                            | ✅ |
| PATCH /sprints/:id (status)                    | ✅ |
| PATCH /sprints/:id (sessionType + paymentStatus) | ✅ |
| PATCH /founders/:id extended fields            | ✅ |
| Founder extended fields persisted              | ✅ |
| POST /admin/reseed (idempotent)                | ✅ |
| Sprint count unchanged after reseed (append-only) | ✅ |
| POST /ai/sheet-emails (graceful 5xx)           | ✅ |
| POST /ai/sprints/:id/summary-update (graceful 5xx) | ✅ |
| POST /sprints/:id/pre-email (template fallback) | ✅ |
| POST /sprints/:id/post-email (template fallback) | ✅ |
| POST /emails/send (no Gmail → simulated)       | ✅ |
| GET /google/status (unconfigured)              | ✅ |

Plus:
- 3 consecutive migration runs → idempotent, no errors
- 3 consecutive seed runs → 1,930 sprints stable (append-only verified)

## Files touched in v4.1 (relative to v4)

- `lib/db/migrations/001_extend_schema.sql` — added `WHEN duplicate_table` to EXCEPTION handler (Bug 1); added `source` column + index to `founders` (Bug 3)
- `lib/db/src/schema/founders.ts` — added `source: text("source")` to the drizzle schema (Bug 3)
- `lib/importer/src/index.ts` — added `ni()` integer-coercion helper applied to all integer columns (Bug 2); proper `isNull()` dedup branch (Bug 4); stamps `source` on every insert (Bug 3)
- `artifacts/api-server/src/routes/incubators.ts` — filters founders by `source` matching the incubator's summary type (Bug 3)
- `artifacts/api-server/src/app.ts` — added `app.set("trust proxy", 1)` (Bug 5)

## What's still NOT verified (and why)

Requires real credentials I don't have access to:
- **Live Google OAuth flow** (needs your `GOOGLE_CLIENT_ID/SECRET`)
- **Live Gmail send** (verified the fallback path; actual send needs a connected user)
- **Live OpenAI calls** (fall back to templates works; actual AI needs `AI_INTEGRATIONS_OPENAI_API_KEY`)
- **Live Sheets read** (same dependency)

The code paths for all of these have been static-audited against the official googleapis and openai SDK contracts, and the fallback paths (template emails, log-only send, graceful 5xx for AI without keys) are all explicitly verified.
