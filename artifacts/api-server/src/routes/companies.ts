import { Router } from "express";
import multer from "multer";
import { db, foundersTable, incubatorsTable, companyEventsTable, usersTable } from "@workspace/db";
import { eq, and, desc, asc, sql } from "drizzle-orm";
import { parseSprintTemplate } from "../lib/sprintTemplateParser";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype.includes("sheet")
      || file.mimetype.includes("excel")
      || file.originalname.toLowerCase().endsWith(".xlsx");
    if (ok) cb(null, true);
    else cb(new Error("Only .xlsx files are accepted") as any, false);
  },
});

/** Auth gate — re-used across all routes here. */
async function requireUser(req: any, res: any): Promise<number | null> {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return null; }
  return userId;
}

// ─── GET /companies — list grouped by cohort ──────────────────────────────
/**
 * Returns all companies owned by the signed-in user, with cohort name resolved
 * inline. The frontend groups by cohort client-side so we keep this endpoint
 * cheap and simple.
 */
router.get("/companies", async (req, res) => {
  const userId = await requireUser(req, res); if (!userId) return;
  try {
    const rows = await db
      .select({
        id: foundersTable.id,
        companyName: foundersTable.companyName,
        founderName: foundersTable.name,
        founderEmail: foundersTable.email,
        cohortId: foundersTable.incubatorId,
        cohortName: incubatorsTable.name,
        deckUrl: foundersTable.deckUrl,
        vision: foundersTable.vision,
        stageWorkflow: foundersTable.stageWorkflow,
        ownerId: foundersTable.ownerId,
        sprintHost: foundersTable.sprintHost,
        coHost: foundersTable.coHost,
        createdAt: foundersTable.createdAt,
      })
      .from(foundersTable)
      .leftJoin(incubatorsTable, eq(foundersTable.incubatorId, incubatorsTable.id))
      .where(eq(foundersTable.ownerId, userId))
      .orderBy(desc(foundersTable.createdAt));

    res.json({ companies: rows });
  } catch (err) {
    req.log.error({ err }, "Failed to list companies");
    res.status(500).json({ error: "Failed to list companies" });
  }
});

// ─── GET /companies/cohorts — list of cohort names for autocomplete ──────
/**
 * For the cohort autocomplete on the upload dialog. Returns distinct cohort
 * names already in use by any company in the workspace (not just the
 * signed-in user), so consultants don't accidentally create near-duplicates.
 */
router.get("/companies/cohorts", async (req, res) => {
  const userId = await requireUser(req, res); if (!userId) return;
  try {
    const rows = await db
      .select({ id: incubatorsTable.id, name: incubatorsTable.name })
      .from(incubatorsTable)
      .orderBy(asc(incubatorsTable.name));
    res.json({ cohorts: rows });
  } catch (err) {
    req.log.error({ err }, "Failed to list cohorts");
    res.status(500).json({ error: "Failed to list cohorts" });
  }
});

// ─── GET /companies/:id — detail + parsed Excel + timeline ───────────────
router.get("/companies/:id", async (req, res) => {
  const userId = await requireUser(req, res); if (!userId) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const [company] = await db
      .select({
        id: foundersTable.id,
        companyName: foundersTable.companyName,
        founderName: foundersTable.name,
        founderEmail: foundersTable.email,
        founder2Name: foundersTable.founder2Name,
        founder2Email: foundersTable.founder2Email,
        cohortId: foundersTable.incubatorId,
        cohortName: incubatorsTable.name,
        deckUrl: foundersTable.deckUrl,
        thinkingSheetUrl: foundersTable.thinkingSheetUrl,
        vision: foundersTable.vision,
        stageWorkflow: foundersTable.stageWorkflow,
        ownerId: foundersTable.ownerId,
        sprintHost: foundersTable.sprintHost,
        coHost: foundersTable.coHost,
        keyStrength: foundersTable.keyStrength,
        gap: foundersTable.gap,
        mentorRecommendation: foundersTable.mentorRecommendation,
        marketAccess: foundersTable.marketAccess,
        excelData: foundersTable.excelData,
        createdAt: foundersTable.createdAt,
      })
      .from(foundersTable)
      .leftJoin(incubatorsTable, eq(foundersTable.incubatorId, incubatorsTable.id))
      .where(eq(foundersTable.id, id))
      .limit(1);

    if (!company) { res.status(404).json({ error: "Company not found" }); return; }
    if (company.ownerId !== null && company.ownerId !== userId) {
      // Soft access control: companies created before owner tracking existed
      // (ownerId === null) are readable; otherwise must be the owner.
      res.status(403).json({ error: "Not authorized to view this company" });
      return;
    }

    const events = await db
      .select()
      .from(companyEventsTable)
      .where(eq(companyEventsTable.founderId, id))
      .orderBy(desc(companyEventsTable.occurredAt));

    res.json({ company, events });
  } catch (err) {
    req.log.error({ err }, "Failed to load company");
    res.status(500).json({ error: "Failed to load company" });
  }
});

// ─── POST /companies/upload-template — the magic endpoint ────────────────
/**
 * multipart/form-data:
 *   file:           .xlsx — the Sprint Template
 *   cohortOverride: (optional) cohort name to use if Excel cell is empty
 *   founderEmail:   (optional) manual founder email if Excel didn't have one
 *
 * Behavior:
 *   1. Parse the template (throws 400 if Company / Founder missing).
 *   2. Find-or-create the cohort (uses incubators table).
 *   3. Find-or-create the founder row (matched by companyName + ownerId).
 *      • Existing row → merge: only fill empty fields, never overwrite.
 *   4. Log a 'template_uploaded' event.
 *   5. Return the parsed payload + the created/updated company id.
 */
router.post("/companies/upload-template", upload.single("file"), async (req, res) => {
  const userId = await requireUser(req, res); if (!userId) return;
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }

  let parsed: ReturnType<typeof parseSprintTemplate>;
  try {
    parsed = parseSprintTemplate(req.file.buffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not parse template";
    res.status(400).json({ error: msg });
    return;
  }

  const cohortName = (req.body?.cohortOverride?.trim() || parsed.cohort?.trim() || "").trim();
  // Priority: manual form field > parsed Excel value > existing row's email > placeholder.
  const founderEmailInput = (req.body?.founderEmail?.trim() || parsed.founderEmail?.trim() || "").trim();

  try {
    // ── 2. Find or create the cohort ──────────────────────────────────────
    let cohortId: number | null = null;
    if (cohortName) {
      const [existingCohort] = await db.select().from(incubatorsTable)
        .where(sql`LOWER(${incubatorsTable.name}) = LOWER(${cohortName})`)
        .limit(1);
      if (existingCohort) {
        cohortId = existingCohort.id;
      } else {
        const [created] = await db.insert(incubatorsTable).values({
          name: cohortName,
          type: "incubator",  // legacy required column — generic value
          description: `Auto-created from Sprint Template upload`,
        }).returning();
        cohortId = created.id;
      }
    }

    // ── 3. Find or create the founder/company row ────────────────────────
    // Matching key: companyName + ownerId. This means each consultant has
    // their own copy of a company even if multiple consultants work on the
    // same startup — which is the safer default for our access model.
    const [existing] = await db.select().from(foundersTable)
      .where(and(
        sql`LOWER(${foundersTable.companyName}) = LOWER(${parsed.companyName})`,
        eq(foundersTable.ownerId, userId),
      ))
      .limit(1);

    // Build the merge payload: only overwrite if the new value exists.
    const payload = {
      companyName: parsed.companyName,
      name: parsed.founderName,
      email: founderEmailInput || existing?.email || `unknown+${Date.now()}@placeholder.local`,
      incubatorId: cohortId ?? existing?.incubatorId ?? null,
      vision: parsed.vision ?? existing?.vision ?? null,
      deckUrl: parsed.deckUrl ?? existing?.deckUrl ?? null,
      sprintHost: parsed.sprintHost ?? existing?.sprintHost ?? null,
      coHost: parsed.coHost ?? existing?.coHost ?? null,
      keyStrength: parsed.keyStrengths ?? existing?.keyStrength ?? null,
      gap: parsed.gaps ?? existing?.gap ?? null,
      mentorRecommendation: parsed.mentorRecommendation ?? existing?.mentorRecommendation ?? null,
      marketAccess: parsed.marketAccess ?? existing?.marketAccess ?? null,
      excelData: parsed.raw as any,
      // Only advance stage forward, never backward.
      stageWorkflow: parsed.detectedStage === "sprint_done"
        ? (existing?.stageWorkflow === "post_email_sent" ? existing.stageWorkflow : "sprint_done")
        : (existing?.stageWorkflow ?? "pre_sprint"),
      ownerId: userId,
      source: "sprint_template_upload",
    };

    let companyId: number;
    if (existing) {
      const [updated] = await db.update(foundersTable)
        .set(payload)
        .where(eq(foundersTable.id, existing.id))
        .returning();
      companyId = updated.id;
    } else {
      const [created] = await db.insert(foundersTable).values(payload).returning();
      companyId = created.id;
    }

    // ── 4. Log the upload event ───────────────────────────────────────────
    await db.insert(companyEventsTable).values({
      founderId: companyId,
      userId,
      kind: "template_uploaded",
      note: existing
        ? `Re-uploaded "${req.file.originalname}"`
        : `Uploaded "${req.file.originalname}"`,
      metadata: { detectedStage: parsed.detectedStage, warnings: parsed.warnings },
    });

    res.json({
      companyId,
      isNew: !existing,
      detectedStage: parsed.detectedStage,
      parsed,
      warnings: parsed.warnings,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to upload template");
    res.status(500).json({ error: "Failed to upload template" });
  }
});

// ─── POST /companies/:id/founder-email — update founder email manually ────
router.post("/companies/:id/founder-email", async (req, res) => {
  const userId = await requireUser(req, res); if (!userId) return;
  const id = Number(req.params.id);
  const email = (req.body?.email ?? "").trim();
  if (!Number.isFinite(id) || !email) { res.status(400).json({ error: "id and email required" }); return; }

  try {
    const [c] = await db.select().from(foundersTable).where(eq(foundersTable.id, id)).limit(1);
    if (!c) { res.status(404).json({ error: "Company not found" }); return; }
    if (c.ownerId && c.ownerId !== userId) { res.status(403).json({ error: "Not authorized" }); return; }

    await db.update(foundersTable).set({ email }).where(eq(foundersTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to update founder email");
    res.status(500).json({ error: "Failed to update founder email" });
  }
});

// ─── POST /companies/:id/events — log a manual timeline event ─────────────
/**
 * Body: { kind, note?, metadata? }
 * Used by the UI to mark "Sprint completed" manually.
 */
router.post("/companies/:id/events", async (req, res) => {
  const userId = await requireUser(req, res); if (!userId) return;
  const id = Number(req.params.id);
  const kind = String(req.body?.kind ?? "").trim();
  if (!Number.isFinite(id) || !kind) { res.status(400).json({ error: "id and kind required" }); return; }

  // Allow-list of kinds the UI can write directly. AI / send routes have
  // their own auto-loggers that don't go through this endpoint.
  const allowed = new Set(["sprint_scheduled", "sprint_completed"]);
  if (!allowed.has(kind)) { res.status(400).json({ error: "Unsupported event kind" }); return; }

  try {
    const [c] = await db.select().from(foundersTable).where(eq(foundersTable.id, id)).limit(1);
    if (!c) { res.status(404).json({ error: "Company not found" }); return; }
    if (c.ownerId && c.ownerId !== userId) { res.status(403).json({ error: "Not authorized" }); return; }

    await db.insert(companyEventsTable).values({
      founderId: id,
      userId,
      kind,
      note: req.body?.note ?? null,
      metadata: req.body?.metadata ?? null,
    });

    // Advance workflow stage if we just completed the sprint.
    if (kind === "sprint_completed" && c.stageWorkflow !== "post_email_sent") {
      await db.update(foundersTable)
        .set({ stageWorkflow: "sprint_done" })
        .where(eq(foundersTable.id, id));
    }

    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to log event");
    res.status(500).json({ error: "Failed to log event" });
  }
});

// ─── DELETE /companies/:id — let the consultant remove a stale upload ────
router.delete("/companies/:id", async (req, res) => {
  const userId = await requireUser(req, res); if (!userId) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const [c] = await db.select().from(foundersTable).where(eq(foundersTable.id, id)).limit(1);
    if (!c) { res.status(404).json({ error: "Company not found" }); return; }
    if (c.ownerId && c.ownerId !== userId) {
      // Admins can delete anything; consultants only their own.
      const [me] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      if (me?.role !== "admin") { res.status(403).json({ error: "Not authorized" }); return; }
    }
    await db.delete(foundersTable).where(eq(foundersTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete company");
    res.status(500).json({ error: "Failed to delete company" });
  }
});

export default router;
