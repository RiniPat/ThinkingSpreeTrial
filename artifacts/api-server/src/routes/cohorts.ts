// artifacts/api-server/src/routes/cohorts.ts
//
// ============================================================================
// Cohorts API
// ============================================================================
//
// Endpoints (all gated by requireAuth; mutations also requireAdmin):
//
//   GET    /api/cohorts                  — list cohorts the caller can see
//   GET    /api/cohorts/:slug            — cohort detail + companies
//   GET    /api/cohorts/:slug/companies  — just the companies (table view)
//   POST   /api/cohorts                  — create (admin)
//   PATCH  /api/cohorts/:id              — update (admin) — e.g. attach source sheet
//   POST   /api/cohorts/:id/sync         — manual sync from source_sheet_url (admin)
//   POST   /api/cohorts/:id/companies    — { founderIds: number[] } add manually (admin)
//   DELETE /api/cohorts/:id/companies/:founderId — remove (admin)
//
// Wire-up (in your existing app.ts / index.ts):
//
//     import { cohortsRouter } from "./routes/cohorts.js";
//     app.use("/api/cohorts", cohortsRouter);
// ============================================================================

import { Router } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

// ADAPT: paths/exports to match your project conventions
import { db } from "../db.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { cohorts, cohortCompanies } from "@workspace/db/schema/cohorts";
import { founders } from "@workspace/db/schema/founders";
import { syncCohortFromSheet } from "../lib/cohort-sync.js";

export const cohortsRouter = Router();

// ─── List cohorts ─────────────────────────────────────────────────────────
cohortsRouter.get("/", requireAuth, async (_req, res) => {
    const rows = await db
        .select({
            id: cohorts.id,
            name: cohorts.name,
            slug: cohorts.slug,
            description: cohorts.description,
            sourceSheetUrl: cohorts.sourceSheetUrl,
            lastSyncedAt: cohorts.lastSyncedAt,
            lastSyncError: cohorts.lastSyncError,
            // Computed count via correlated subquery — cheap because of the FK index.
            companyCount: sql<number>`(
                SELECT COUNT(*)::int FROM cohort_companies cc WHERE cc.cohort_id = ${cohorts.id}
            )`.as("company_count"),
        })
        .from(cohorts)
        .orderBy(desc(cohorts.updatedAt));

    res.json({ cohorts: rows });
});

// ─── Get cohort detail (by slug — friendlier URLs) ────────────────────────
cohortsRouter.get("/:slug", requireAuth, async (req, res) => {
    const slug = req.params.slug;
    const [cohort] = await db.select().from(cohorts).where(eq(cohorts.slug, slug)).limit(1);
    if (!cohort) return res.status(404).json({ error: "Cohort not found" });

    // ADAPT: this SELECT mirrors whatever shape your Companies/Founders table
    // is exposed to the frontend as. If your existing /api/founders route
    // returns more fields (e.g. industry, stage, lastSprintAt), add them here.
    const companies = await db
        .select({
            id: founders.id,
            name: founders.name,
            // industry: founders.industry,
            // stage:    founders.stage,
            // founderName: founders.founderName,
            // founderEmail: founders.founderEmail,
            addedAt: cohortCompanies.addedAt,
            source: cohortCompanies.source,
        })
        .from(cohortCompanies)
        .innerJoin(founders, eq(founders.id, cohortCompanies.founderId))
        .where(eq(cohortCompanies.cohortId, cohort.id))
        .orderBy(desc(cohortCompanies.addedAt));

    res.json({ cohort, companies });
});

// ─── Just the companies (table-friendly, supports filters) ───────────────
cohortsRouter.get("/:slug/companies", requireAuth, async (req, res) => {
    const [cohort] = await db.select().from(cohorts).where(eq(cohorts.slug, req.params.slug)).limit(1);
    if (!cohort) return res.status(404).json({ error: "Cohort not found" });

    const founderIds = await db
        .select({ id: cohortCompanies.founderId })
        .from(cohortCompanies)
        .where(eq(cohortCompanies.cohortId, cohort.id));

    if (founderIds.length === 0) return res.json({ companies: [] });

    const companies = await db
        .select()
        .from(founders)
        .where(inArray(founders.id, founderIds.map((r) => r.id)));

    res.json({ companies });
});

// ─── Create cohort (admin) ───────────────────────────────────────────────
const CreateCohortBody = z.object({
    name: z.string().min(1).max(120),
    slug: z.string()
        .min(2)
        .max(80)
        .regex(/^[a-z0-9-]+$/, "slug must be lowercase letters, numbers, hyphens"),
    description: z.string().max(2000).optional(),
    sourceSheetUrl: z.string().url().optional(),
    sourceSheetTab: z.string().max(120).optional(),
});

cohortsRouter.post("/", requireAuth, requireAdmin, async (req, res) => {
    const parsed = CreateCohortBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    try {
        const [row] = await db
            .insert(cohorts)
            .values({ ...parsed.data, createdBy: req.user!.id })
            .returning();
        res.status(201).json({ cohort: row });
    } catch (err: unknown) {
        // Unique violation on slug
        if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23505") {
            return res.status(409).json({ error: "A cohort with that slug already exists" });
        }
        throw err;
    }
});

// ─── Update cohort (admin) ───────────────────────────────────────────────
const UpdateCohortBody = CreateCohortBody.partial().omit({ slug: true });

cohortsRouter.patch("/:id", requireAuth, requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const parsed = UpdateCohortBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const [row] = await db
        .update(cohorts)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(cohorts.id, id))
        .returning();

    if (!row) return res.status(404).json({ error: "Cohort not found" });
    res.json({ cohort: row });
});

// ─── Manual sync from source sheet (admin) ───────────────────────────────
//
// In addition to this on-demand endpoint, register the same function on a
// timer (Render Cron Job, or your existing scheduler) so cohorts with
// source_sheet_url set update automatically every N minutes.
cohortsRouter.post("/:id/sync", requireAuth, requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const [cohort] = await db.select().from(cohorts).where(eq(cohorts.id, id)).limit(1);
    if (!cohort) return res.status(404).json({ error: "Cohort not found" });
    if (!cohort.sourceSheetUrl) {
        return res.status(400).json({
            error: "This cohort has no source_sheet_url. Set one with PATCH /api/cohorts/:id first.",
        });
    }

    try {
        const result = await syncCohortFromSheet({
            cohortId: cohort.id,
            sheetUrl: cohort.sourceSheetUrl,
            sheetTab: cohort.sourceSheetTab ?? null,
            userId: req.user!.id,
        });
        await db
            .update(cohorts)
            .set({ lastSyncedAt: new Date(), lastSyncError: null, updatedAt: new Date() })
            .where(eq(cohorts.id, id));
        res.json({ ok: true, ...result });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown sync error";
        await db.update(cohorts).set({ lastSyncError: message }).where(eq(cohorts.id, id));
        res.status(500).json({ error: message });
    }
});

// ─── Add companies manually (admin) ──────────────────────────────────────
const AddCompaniesBody = z.object({
    founderIds: z.array(z.number().int().positive()).min(1).max(500),
});

cohortsRouter.post("/:id/companies", requireAuth, requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const parsed = AddCompaniesBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    await db
        .insert(cohortCompanies)
        .values(parsed.data.founderIds.map((fid) => ({ cohortId: id, founderId: fid, source: "manual" })))
        .onConflictDoNothing();

    res.json({ ok: true, added: parsed.data.founderIds.length });
});

// ─── Remove a company (admin) ────────────────────────────────────────────
cohortsRouter.delete("/:id/companies/:founderId", requireAuth, requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const fid = Number(req.params.founderId);
    await db
        .delete(cohortCompanies)
        .where(and(eq(cohortCompanies.cohortId, id), eq(cohortCompanies.founderId, fid)));
    res.json({ ok: true });
});
