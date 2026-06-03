import { Router } from "express";
import multer from "multer";
import { db, foundersTable, incubatorsTable, companyEventsTable, emailDraftsTable, usersTable, isValidWorkflowStage } from "@workspace/db";
import { eq, and, desc, asc, sql } from "drizzle-orm";
import { parseSprintTemplate, parseSprintTemplateWorkbook } from "../lib/sprintTemplateParser";
import { fetchSheetAsWorkbook, extractSheetId } from "../lib/sheetsFetcher";

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
        sourceSheetUrl: foundersTable.sourceSheetUrl,
        vision: foundersTable.vision,
        stageWorkflow: foundersTable.stageWorkflow,
        ownerId: foundersTable.ownerId,
        sprintHost: foundersTable.sprintHost,
        coHost: foundersTable.coHost,
        keyStrength: foundersTable.keyStrength,
        gap: foundersTable.gap,
        mentorRecommendation: foundersTable.mentorRecommendation,
        marketAccess: foundersTable.marketAccess,
        tasks: foundersTable.tasks,
        // Sprint Data extended fields
        visionRaw: foundersTable.visionRaw,
        smartGoal3Months: foundersTable.smartGoal3Months,
        previousFundraiseCr: foundersTable.previousFundraiseCr,
        previousFundraiseOrgs: foundersTable.previousFundraiseOrgs,
        currentBurn: foundersTable.currentBurn,
        runway: foundersTable.runway,
        nextStageGoal: foundersTable.nextStageGoal,
        nextStageRunway: foundersTable.nextStageRunway,
        fundsFor: foundersTable.fundsFor,
        observationsTsDashboard: foundersTable.observationsTsDashboard,
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

// ─── Shared ingestion helper ─────────────────────────────────────────────
/**
 * Given a parsed Sprint Template, upsert the company + cohort + log a
 * timeline event. Returns the company id and whether it's new.
 *
 * Called by both:
 *   - POST /companies/upload-template  (file upload, legacy)
 *   - POST /companies/ingest-sheet     (Google Sheets URL — new in v4.4)
 *   - POST /companies/:id/resync       (re-pull from previously-saved Sheets URL)
 *
 * Behavior is identical across all three entry points so consultants get the
 * same merge semantics whether they upload a file or paste a sheet link.
 */
async function ingestParsedTemplate(opts: {
  userId: number;
  parsed: ReturnType<typeof parseSprintTemplate>;
  cohortOverride?: string;
  founderEmailOverride?: string;
  sourceSheetUrl?: string | null;
  noteVerb: string;          // e.g. "Uploaded", "Synced", "Re-synced"
  sourceLabel: string;       // e.g. "Sprint_Template.xlsx" or "Google Sheet"
}) {
  const { userId, parsed, cohortOverride, founderEmailOverride, sourceSheetUrl, noteVerb, sourceLabel } = opts;

  const cohortName = (cohortOverride?.trim() || parsed.cohort?.trim() || "").trim();
  // Priority: manual form field > parsed Excel value > existing row's email > placeholder.
  const founderEmailInput = (founderEmailOverride?.trim() || parsed.founderEmail?.trim() || "").trim();

  // ── 1. Find or create the cohort ────────────────────────────────────────
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
        type: "incubator",
        description: `Auto-created from Sprint Template`,
      }).returning();
      cohortId = created.id;
    }
  }

  // ── 2. Find or create the founder/company row ──────────────────────────
  const [existing] = await db.select().from(foundersTable)
    .where(and(
      sql`LOWER(${foundersTable.companyName}) = LOWER(${parsed.companyName})`,
      eq(foundersTable.ownerId, userId),
    ))
    .limit(1);

  const payload = {
    companyName: parsed.companyName,
    name: parsed.founderName,
    email: founderEmailInput || existing?.email || `unknown+${Date.now()}@placeholder.local`,
    incubatorId: cohortId ?? existing?.incubatorId ?? null,
    // Vision (AI-summarised): we DON'T copy the parser's value here because
    // the parser intentionally returns null. We DO keep the existing cached
    // summary IF the raw text hasn't changed — see visionRaw below.
    // If the raw paragraph has changed, we wipe the cached summary so the
    // Sprint Data tab regenerates it.
    vision: (parsed.visionRaw && parsed.visionRaw === existing?.visionRaw)
      ? (existing?.vision ?? null)
      : null,
    visionRaw: parsed.visionRaw ?? existing?.visionRaw ?? null,
    deckUrl: parsed.deckUrl ?? existing?.deckUrl ?? null,
    sprintHost: parsed.sprintHost ?? existing?.sprintHost ?? null,
    coHost: parsed.coHost ?? existing?.coHost ?? null,
    keyStrength: parsed.keyStrengths ?? existing?.keyStrength ?? null,
    gap: parsed.gaps ?? existing?.gap ?? null,
    mentorRecommendation: parsed.mentorRecommendation ?? existing?.mentorRecommendation ?? null,
    marketAccess: parsed.marketAccess ?? existing?.marketAccess ?? null,
    // Actionable Tasks (from SMART Goals tab) — stored in the legacy `tasks` column.
    tasks: parsed.actionableSteps ?? existing?.tasks ?? null,
    smartGoal3Months: parsed.smartGoal3Months ?? existing?.smartGoal3Months ?? null,
    previousFundraiseCr: parsed.previousFundraiseCr ?? existing?.previousFundraiseCr ?? null,
    previousFundraiseOrgs: parsed.previousFundraiseOrgs ?? existing?.previousFundraiseOrgs ?? null,
    currentBurn: parsed.currentBurn ?? existing?.currentBurn ?? null,
    runway: parsed.runway ?? existing?.runway ?? null,
    nextStageGoal: parsed.nextStageGoal ?? existing?.nextStageGoal ?? null,
    nextStageRunway: parsed.nextStageRunway ?? existing?.nextStageRunway ?? null,
    fundsFor: parsed.fundsFor ?? existing?.fundsFor ?? null,
    excelData: parsed.raw as any,
    stageWorkflow: parsed.detectedStage === "sprint_done"
      ? (existing?.stageWorkflow === "post_email_sent" ? existing.stageWorkflow : "sprint_done")
      : (existing?.stageWorkflow ?? "pre_sprint"),
    ownerId: userId,
    source: sourceSheetUrl ? "google_sheets_sync" : "sprint_template_upload",
    sourceSheetUrl: sourceSheetUrl ?? existing?.sourceSheetUrl ?? null,
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

  await db.insert(companyEventsTable).values({
    founderId: companyId,
    userId,
    kind: "template_uploaded",
    note: existing ? `${noteVerb} from "${sourceLabel}"` : `${noteVerb} from "${sourceLabel}"`,
    metadata: { detectedStage: parsed.detectedStage, warnings: parsed.warnings, sourceSheetUrl: sourceSheetUrl ?? undefined },
  });

  return { companyId, isNew: !existing };
}

// ─── POST /companies/upload-template — file upload (kept for back-compat) ─
router.post("/companies/upload-template", upload.single("file"), async (req, res) => {
  const userId = await requireUser(req, res); if (!userId) return;
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }

  let parsed: ReturnType<typeof parseSprintTemplate>;
  try {
    parsed = parseSprintTemplate(req.file.buffer);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Could not parse template" });
    return;
  }

  try {
    const { companyId, isNew } = await ingestParsedTemplate({
      userId,
      parsed,
      cohortOverride: req.body?.cohortOverride,
      founderEmailOverride: req.body?.founderEmail,
      sourceSheetUrl: null,
      noteVerb: req.body?.cohortOverride ? "Re-uploaded" : "Uploaded",
      sourceLabel: req.file.originalname,
    });
    res.json({ companyId, isNew, detectedStage: parsed.detectedStage, parsed, warnings: parsed.warnings });
  } catch (err) {
    req.log.error({ err }, "Failed to upload template");
    res.status(500).json({ error: "Failed to upload template" });
  }
});

// ─── POST /companies/ingest-sheet — Google Sheets URL ingestion ──────────
/**
 * Body: { sheetUrl: string, cohortOverride?: string, founderEmail?: string }
 * Pulls the sheet via the user's connected Google account, parses with the
 * same logic as the file uploader, and saves the URL so future Re-syncs
 * don't need the consultant to paste it again.
 */
router.post("/companies/ingest-sheet", async (req, res) => {
  const userId = await requireUser(req, res); if (!userId) return;
  const sheetUrl = String(req.body?.sheetUrl ?? "").trim();
  if (!sheetUrl) { res.status(400).json({ error: "sheetUrl required" }); return; }

  if (!extractSheetId(sheetUrl)) {
    res.status(400).json({ error: "That doesn't look like a Google Sheets URL." });
    return;
  }

  try {
    const wb = await fetchSheetAsWorkbook(userId, sheetUrl);
    const parsed = parseSprintTemplateWorkbook(wb);

    const { companyId, isNew } = await ingestParsedTemplate({
      userId,
      parsed,
      cohortOverride: req.body?.cohortOverride,
      founderEmailOverride: req.body?.founderEmail,
      sourceSheetUrl: sheetUrl,
      noteVerb: "Synced",
      sourceLabel: "Google Sheet",
    });

    res.json({ companyId, isNew, detectedStage: parsed.detectedStage, parsed, warnings: parsed.warnings });
  } catch (err) {
    req.log.error({ err }, "Failed to ingest sheet");
    const msg = err instanceof Error ? err.message : "Failed to ingest sheet";
    // 400 for user-fixable errors (bad URL, no access), 500 for server errors
    const code = /access|expired|not connected|empty|URL|Founder|Company/i.test(msg) ? 400 : 500;
    res.status(code).json({ error: msg });
  }
});

// ─── POST /companies/:id/resync — re-pull from saved Sheets URL ──────────
router.post("/companies/:id/resync", async (req, res) => {
  const userId = await requireUser(req, res); if (!userId) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const [c] = await db.select().from(foundersTable).where(eq(foundersTable.id, id)).limit(1);
    if (!c) { res.status(404).json({ error: "Company not found" }); return; }
    if (c.ownerId && c.ownerId !== userId) { res.status(403).json({ error: "Not authorized" }); return; }
    if (!c.sourceSheetUrl) {
      res.status(400).json({ error: "No source sheet URL saved for this company. Use ingest-sheet first." });
      return;
    }

    const wb = await fetchSheetAsWorkbook(userId, c.sourceSheetUrl);
    const parsed = parseSprintTemplateWorkbook(wb);

    const { companyId } = await ingestParsedTemplate({
      userId,
      parsed,
      sourceSheetUrl: c.sourceSheetUrl,
      noteVerb: "Re-synced",
      sourceLabel: "Google Sheet",
    });

    res.json({ companyId, detectedStage: parsed.detectedStage, parsed, warnings: parsed.warnings });
  } catch (err) {
    req.log.error({ err }, "Failed to resync");
    const msg = err instanceof Error ? err.message : "Failed to resync";
    const code = /access|expired|not connected|empty|URL|Founder|Company/i.test(msg) ? 400 : 500;
    res.status(code).json({ error: msg });
  }
});

// ─── PATCH /companies/:id — inline edit ──────────────────────────────────
/**
 * Body: { companyName?, founderName?, founderEmail?, cohortName?, deckUrl?,
 *         sprintHost?, coHost? }
 * Cohort is given by NAME, not ID — we find-or-create the same way ingestion
 * does. This lets the consultant rename or move a company between cohorts
 * without round-tripping through the upload flow.
 */
router.patch("/companies/:id", async (req, res) => {
  const userId = await requireUser(req, res); if (!userId) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const [c] = await db.select().from(foundersTable).where(eq(foundersTable.id, id)).limit(1);
    if (!c) { res.status(404).json({ error: "Company not found" }); return; }
    if (c.ownerId && c.ownerId !== userId) { res.status(403).json({ error: "Not authorized" }); return; }

    // Translate cohortName → cohortId (find-or-create), if provided
    let nextCohortId: number | null | undefined = undefined;
    const cohortName = req.body?.cohortName != null ? String(req.body.cohortName).trim() : undefined;
    if (cohortName !== undefined) {
      if (cohortName === "") {
        nextCohortId = null;  // explicit clear
      } else {
        const [existing] = await db.select().from(incubatorsTable)
          .where(sql`LOWER(${incubatorsTable.name}) = LOWER(${cohortName})`)
          .limit(1);
        if (existing) nextCohortId = existing.id;
        else {
          const [created] = await db.insert(incubatorsTable).values({
            name: cohortName, type: "incubator", description: "Created via company edit",
          }).returning();
          nextCohortId = created.id;
        }
      }
    }

    const patch: Record<string, unknown> = {};
    if (req.body?.companyName != null)  patch.companyName  = String(req.body.companyName).trim();
    if (req.body?.founderName != null)  patch.name         = String(req.body.founderName).trim();
    if (req.body?.founderEmail != null) patch.email        = String(req.body.founderEmail).trim() || c.email;
    if (req.body?.deckUrl != null)      patch.deckUrl      = String(req.body.deckUrl).trim() || null;
    if (req.body?.sprintHost != null)   patch.sprintHost   = String(req.body.sprintHost).trim() || null;
    if (req.body?.coHost != null)       patch.coHost       = String(req.body.coHost).trim() || null;
    if (nextCohortId !== undefined)     patch.incubatorId  = nextCohortId;

    // When a consultant explicitly assigns this company to a cohort, make sure
    // it shows up on the Summary Sheet tab. The Summary view only lists
    // founders whose `source` is one of the curated summary sources; a company
    // created via a bulk/session-tracking import (or any other path) would
    // otherwise stay hidden even after being moved into the cohort. Marking it
    // `manual_curation` — itself a recognised summary source — closes that gap
    // without disturbing companies that already came from an upload or sync.
    const SUMMARY_SOURCES = new Set(["isb-summary", "ju-summary", "sprint_template_upload", "google_sheets_sync", "manual_curation"]);
    if (nextCohortId != null && !SUMMARY_SOURCES.has(c.source ?? "")) {
      patch.source = "manual_curation";
    }

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "Nothing to update" }); return;
    }

    await db.update(foundersTable).set(patch).where(eq(foundersTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to edit company");
    res.status(500).json({ error: "Failed to edit company" });
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

// ─── DELETE /companies/:id — permanent delete with cascade cleanup ────
router.delete("/companies/:id", async (req, res) => {
  const userId = await requireUser(req, res); if (!userId) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const [c] = await db.select().from(foundersTable).where(eq(foundersTable.id, id)).limit(1);
    if (!c) { res.status(404).json({ error: "Company not found" }); return; }
    if (c.ownerId && c.ownerId !== userId) {
      const [me] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      if (me?.role !== "admin") { res.status(403).json({ error: "Not authorized" }); return; }
    }

    // Explicit cleanup of child rows. The FK constraints declared in the
    // schema also cascade, but doing it explicitly lets us return counts
    // to the UI so the toast can say "Deleted ABC + 3 events + 2 drafts".
    const drafts = await db.delete(emailDraftsTable)
      .where(eq(emailDraftsTable.founderId, id))
      .returning({ id: emailDraftsTable.id });
    const events = await db.delete(companyEventsTable)
      .where(eq(companyEventsTable.founderId, id))
      .returning({ id: companyEventsTable.id });
    await db.delete(foundersTable).where(eq(foundersTable.id, id));

    res.json({
      ok: true,
      deleted: { events: events.length, drafts: drafts.length },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to delete company");
    res.status(500).json({ error: "Failed to delete company" });
  }
});

// ─── PATCH /companies/:id/stage — manually set workflow stage ────────────
/**
 * Body: { stage: WorkflowStage }
 *
 * Free-form: consultants can go forward or backward freely. The system
 * never blocks a stage change. The auto-advance from email sending still
 * works as before — this endpoint is for manual edits.
 *
 * Logs a "stage_changed" timeline event so the audit trail captures who
 * moved a company from X to Y and when.
 */
router.patch("/companies/:id/stage", async (req, res) => {
  const userId = await requireUser(req, res); if (!userId) return;
  const id = Number(req.params.id);
  const stage = String(req.body?.stage ?? "").trim();
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!isValidWorkflowStage(stage)) { res.status(400).json({ error: "Invalid stage" }); return; }

  try {
    const [c] = await db.select().from(foundersTable).where(eq(foundersTable.id, id)).limit(1);
    if (!c) { res.status(404).json({ error: "Company not found" }); return; }
    if (c.ownerId && c.ownerId !== userId) { res.status(403).json({ error: "Not authorized" }); return; }

    const previous = c.stageWorkflow;
    if (previous === stage) {
      res.json({ ok: true, unchanged: true });
      return;
    }

    await db.update(foundersTable).set({ stageWorkflow: stage }).where(eq(foundersTable.id, id));
    await db.insert(companyEventsTable).values({
      founderId: id, userId,
      kind: "stage_changed",
      note: `Stage manually changed: ${previous} → ${stage}`,
      metadata: { from: previous, to: stage },
    });

    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to set workflow stage");
    res.status(500).json({ error: "Failed to set workflow stage" });
  }
});

// ─── PATCH /companies/:id/observations — set TS team observations ────────
/**
 * Body: { observations: string }
 *
 * Plain-text observations written by the Host after the sprint session.
 * Internal use only — never sent to the founder. Surfaces on the Sprint
 * Data tab and is passed to Gemini as additional context when generating
 * the post-sprint email (so the email can subtly reflect the team's view).
 */
router.patch("/companies/:id/observations", async (req, res) => {
  const userId = await requireUser(req, res); if (!userId) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  // Allow empty string to clear the observations.
  const observations = typeof req.body?.observations === "string" ? req.body.observations : "";

  try {
    const [c] = await db.select().from(foundersTable).where(eq(foundersTable.id, id)).limit(1);
    if (!c) { res.status(404).json({ error: "Company not found" }); return; }
    if (c.ownerId && c.ownerId !== userId) { res.status(403).json({ error: "Not authorized" }); return; }

    await db.update(foundersTable)
      .set({ observationsTsDashboard: observations.trim() || null })
      .where(eq(foundersTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to save observations");
    res.status(500).json({ error: "Failed to save observations" });
  }
});

export default router;
