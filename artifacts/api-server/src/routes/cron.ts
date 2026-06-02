// artifacts/api-server/src/routes/cron.ts
//
// ============================================================================
// Cron endpoints — protected by INTERNAL_TOKEN, not session auth.
// ============================================================================
//
// Designed to be hit by:
//   • Render Cron Job (recommended — free tier supports cron jobs)
//   • GitHub Actions on a schedule
//   • cron-job.org or any external HTTP scheduler
//
// All callers must send:
//   Authorization: Bearer <INTERNAL_TOKEN>
//
// Set INTERNAL_TOKEN in your Render env vars to a random 32-byte hex string.
// Generate one with:  node -e "console.log(crypto.randomBytes(32).toString('hex'))"
//
// Wire-up:
//   import { cronRouter } from "./routes/cron.js";
//   app.use("/api/cron", cronRouter);
// ============================================================================

import { Router } from "express";
import { eq, isNotNull } from "drizzle-orm";

import { db } from "../db.js";
import { cohorts } from "@workspace/db/schema/cohorts";
import { syncCohortFromSheet } from "../lib/cohort-sync.js";

export const cronRouter = Router();

// ─── Token gate ────────────────────────────────────────────────────────────
cronRouter.use((req, res, next) => {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    const expected = process.env.INTERNAL_TOKEN;
    if (!expected) {
        return res.status(500).json({ error: "INTERNAL_TOKEN is not configured on the server" });
    }
    if (!token || !timingSafeEq(token, expected)) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    next();
});

// ─── Sync all cohorts that have a source sheet ────────────────────────────
//
// POST /api/cron/sync-cohorts
//
// Iterates every cohort with source_sheet_url set, calls the sync engine for
// each, catches per-cohort errors so one bad sheet doesn't abort the batch.
// Returns a per-cohort result array — useful for the cron service log.
cronRouter.post("/sync-cohorts", async (_req, res) => {
    const rows = await db
        .select({
            id: cohorts.id,
            slug: cohorts.slug,
            name: cohorts.name,
            sourceSheetUrl: cohorts.sourceSheetUrl,
            sourceSheetTab: cohorts.sourceSheetTab,
            createdBy: cohorts.createdBy,
        })
        .from(cohorts)
        .where(isNotNull(cohorts.sourceSheetUrl));

    const results: Array<
        | { slug: string; ok: true; added: number; skipped: number; unresolved: number }
        | { slug: string; ok: false; error: string }
    > = [];

    for (const c of rows) {
        try {
            // Sheets API needs an OAuth token. We use the cohort creator's
            // tokens. If the cohort has no creator (created via SQL seed),
            // skip it — the admin needs to claim it via PATCH first.
            if (!c.createdBy) {
                throw new Error(
                    `Cohort "${c.slug}" has no created_by. Open it in the UI and re-save once to claim ownership, or run PATCH /api/cohorts/${c.id} as an admin.`,
                );
            }
            const r = await syncCohortFromSheet({
                cohortId: c.id,
                sheetUrl: c.sourceSheetUrl!,
                sheetTab: c.sourceSheetTab ?? null,
                userId: c.createdBy,
            });
            await db
                .update(cohorts)
                .set({ lastSyncedAt: new Date(), lastSyncError: null, updatedAt: new Date() })
                .where(eq(cohorts.id, c.id));
            results.push({
                slug: c.slug,
                ok: true,
                added: r.added,
                skipped: r.skipped,
                unresolved: r.unresolved.length,
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown sync error";
            await db.update(cohorts).set({ lastSyncError: message }).where(eq(cohorts.id, c.id));
            results.push({ slug: c.slug, ok: false, error: message });
        }
    }

    const okCount = results.filter((r) => r.ok).length;
    res.json({
        ok: true,
        cohortsProcessed: rows.length,
        succeeded: okCount,
        failed: rows.length - okCount,
        results,
    });
});

// ─── Constant-time string compare ──────────────────────────────────────────
// Prevents token-leak via response timing.
function timingSafeEq(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let mismatch = 0;
    for (let i = 0; i < a.length; i++) {
        mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return mismatch === 0;
}
