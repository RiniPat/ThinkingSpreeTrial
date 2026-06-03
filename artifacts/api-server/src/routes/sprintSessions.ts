/**
 * Sprint sessions API.
 *
 * GET    /companies/:id/sessions               — list all sessions for a company
 * POST   /companies/:id/sessions               — create a new session (snapshot current state)
 * PATCH  /companies/:id/sessions/:sessionId    — rename a session (label only)
 * DELETE /companies/:id/sessions/:sessionId    — delete a session
 *
 * Snapshot mechanics:
 *   The consultant clicks "New Sprint Session" → we copy the current
 *   Sprint Data fields off the founders row into a fresh sprint_sessions
 *   row, with session_number = max(existing) + 1. The founders row itself
 *   is left untouched (it's the "live" data).
 *
 *   Use case: consultant just finished Sprint 1, before starting Sprint 2,
 *   they archive the Sprint 1 results. Now Sprint 2's re-sync overwrites
 *   the live data; Sprint 1's results live in sprint_sessions forever.
 */
import { Router } from "express";
import { db, foundersTable, sprintSessionsTable, companyEventsTable } from "@workspace/db";
import { eq, desc, asc, max } from "drizzle-orm";

const router = Router();

async function requireUser(req: any, res: any): Promise<number | null> {
  const uid = req.session?.userId;
  if (!uid) { res.status(401).json({ error: "Not authenticated" }); return null; }
  return uid;
}

router.get("/companies/:id/sessions", async (req, res) => {
  const userId = await requireUser(req, res); if (!userId) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const rows = await db.select().from(sprintSessionsTable)
      .where(eq(sprintSessionsTable.founderId, id))
      .orderBy(asc(sprintSessionsTable.sessionNumber));
    res.json({ sessions: rows });
  } catch (err) {
    req.log.error({ err }, "List sprint sessions failed");
    res.status(500).json({ error: "Failed to list sessions" });
  }
});

/**
 * Snapshot the current Sprint Data into a new session row.
 * Body (all optional): { label }
 */
router.post("/companies/:id/sessions", async (req, res) => {
  const userId = await requireUser(req, res); if (!userId) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const [company] = await db.select().from(foundersTable).where(eq(foundersTable.id, id)).limit(1);
    if (!company) { res.status(404).json({ error: "Company not found" }); return; }
    if (company.ownerId && company.ownerId !== userId) { res.status(403).json({ error: "Not authorized" }); return; }

    // Determine next session_number (1-indexed).
    const [agg] = await db.select({ max: max(sprintSessionsTable.sessionNumber) })
      .from(sprintSessionsTable).where(eq(sprintSessionsTable.founderId, id));
    const nextNumber = (agg?.max ?? 0) + 1;

    const label = typeof req.body?.label === "string" && req.body.label.trim()
      ? req.body.label.trim()
      : `Sprint ${nextNumber}`;

    const [created] = await db.insert(sprintSessionsTable).values({
      founderId: id,
      label,
      sessionNumber: nextNumber,
      stageWorkflow: company.stageWorkflow,
      vision: company.vision,
      visionRaw: company.visionRaw,
      keyStrength: company.keyStrength,
      gap: company.gap,
      mentorRecommendation: company.mentorRecommendation,
      marketAccess: company.marketAccess,
      tasks: company.tasks,
      smartGoal3Months: company.smartGoal3Months,
      previousFundraiseCr: company.previousFundraiseCr,
      previousFundraiseOrgs: company.previousFundraiseOrgs,
      currentBurn: company.currentBurn,
      runway: company.runway,
      nextStageGoal: company.nextStageGoal,
      nextStageRunway: company.nextStageRunway,
      fundsFor: company.fundsFor,
      observationsTsDashboard: company.observationsTsDashboard,
      excelData: company.excelData as any,
    }).returning();

    // Audit trail event.
    await db.insert(companyEventsTable).values({
      founderId: id, userId,
      sessionId: created.id,
      kind: "sprint_session_snapshot",
      note: `Created session: ${created.label}`,
      metadata: { sessionNumber: created.sessionNumber },
    });

    res.json({ session: created });
  } catch (err) {
    req.log.error({ err }, "Create sprint session failed");
    res.status(500).json({ error: "Failed to create session" });
  }
});

router.patch("/companies/:id/sessions/:sessionId", async (req, res) => {
  const userId = await requireUser(req, res); if (!userId) return;
  const id = Number(req.params.id);
  const sessionId = Number(req.params.sessionId);
  if (!Number.isFinite(id) || !Number.isFinite(sessionId)) {
    res.status(400).json({ error: "Invalid id" }); return;
  }
  const label = typeof req.body?.label === "string" ? req.body.label.trim() : null;
  if (!label) { res.status(400).json({ error: "label required" }); return; }

  try {
    await db.update(sprintSessionsTable)
      .set({ label })
      .where(eq(sprintSessionsTable.id, sessionId));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Patch sprint session failed");
    res.status(500).json({ error: "Failed to rename session" });
  }
});

router.delete("/companies/:id/sessions/:sessionId", async (req, res) => {
  const userId = await requireUser(req, res); if (!userId) return;
  const sessionId = Number(req.params.sessionId);
  if (!Number.isFinite(sessionId)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(sprintSessionsTable).where(eq(sprintSessionsTable.id, sessionId));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Delete sprint session failed");
    res.status(500).json({ error: "Failed to delete session" });
  }
});

export default router;
