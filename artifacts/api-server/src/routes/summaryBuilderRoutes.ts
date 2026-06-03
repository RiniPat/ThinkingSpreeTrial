/**
 * Summary Builder routes — Builder tab · Phase B (v5.6).
 *
 * Builds a Wadhwani-format venture summary and commits it to the Summary Sheet
 * tab as a venture row under the "Wadhwani Foundation companies" cohort.
 *
 *   1. POST   /builder/summary-builds              create + pull T-Sheet
 *                                                  (+ optional Fathom upload →
 *                                                   AI extract + VP1/VP2 lookup)
 *   2. POST   /builder/summary-builds/:id/extract  (re)run AI on stored Fathom
 *   3. PATCH  /builder/summary-builds/:id          save consultant edits
 *   4. POST   /builder/summary-builds/:id/commit   write to the Summary tab
 *   5. GET    /builder/summary-builds              library list
 *   6. GET    /builder/summary-builds/:id          full record
 *   7. DELETE /builder/summary-builds/:id          remove
 *
 * Authorization: consultant / research / admin (same gate as Growth Reports).
 */
import { Router } from "express";
import multer from "multer";
import {
  db, usersTable, summaryBuildsTable, foundersTable, incubatorsTable,
  sprintsTable, companyEventsTable, canAccessResearch,
} from "@workspace/db";
import { eq, and, desc, asc, sql } from "drizzle-orm";
import { fetchSheetAsWorkbook, extractSheetId } from "../lib/sheetsFetcher";
import { parseSprintTemplateWorkbook } from "../lib/sprintTemplateParser";
import { extractTextFromUpload } from "../lib/fileExtract";
import { extractSummaryFields, emptySummaryAiFields, type SummaryAiFields } from "../lib/summaryBuilderAi";

const router = Router();
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });

const WADHWANI_COHORT = "Wadhwani Foundation companies";

async function getMe(req: any, res: any) {
  const uid = req.session?.userId;
  if (!uid) { res.status(401).json({ error: "Not authenticated" }); return null; }
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, uid)).limit(1);
  if (!u) { res.status(401).json({ error: "User not found" }); return null; }
  return u;
}

type PulledFields = {
  startupName: string;
  founder: string | null;
  host: string | null;
  coHost: string | null;
  goal: string | null;
  revenueBaseline: string | null;
};

/** The consolidated, consultant-editable record committed to the Summary tab. */
type SummaryFields = {
  startupName: string;
  founder: string;
  host: string;
  coHost: string;
  goal: string;
  industry: string;        // dropdown
  tg: string;              // dropdown
  funding: string;         // dropdown
  currentRevenueArr: string;
  industryDetail: string;
  criticalVenture: string;
  tsConnects: string;
  tsSupport: string;
  vp1Date: string | null;  // looked up from Sprint Tracking
  vp2Date: string | null;
  notes: string;
};

function buildFields(pulled: PulledFields, ai: SummaryAiFields, vp: { vp1: string | null; vp2: string | null }): SummaryFields {
  return {
    startupName: pulled.startupName ?? "",
    founder: pulled.founder ?? "",
    host: pulled.host ?? "",
    coHost: pulled.coHost ?? "",
    goal: pulled.goal ?? "",
    industry: "",
    tg: "",
    funding: "",
    currentRevenueArr: ai.currentRevenueArr || pulled.revenueBaseline || "",
    industryDetail: ai.industryDetail || "",
    criticalVenture: ai.criticalVenture || "",
    tsConnects: ai.tsConnects || "",
    tsSupport: ai.tsSupport || "",
    vp1Date: vp.vp1,
    vp2Date: vp.vp2,
    notes: "",
  };
}

/** Pull the venture scaffold from the T-Sheet. */
async function pullTSheet(userId: number, tsheetLink: string): Promise<PulledFields> {
  const wb = await fetchSheetAsWorkbook(userId, tsheetLink);
  const parsed: any = parseSprintTemplateWorkbook(wb);
  const revenueBaseline =
    parsed?.revenueLast12Months ??
    parsed?.raw?.smart?.revenueLast12Months ??
    null;
  return {
    startupName: parsed?.companyName ?? "",
    founder: parsed?.founderName ?? null,
    host: parsed?.sprintHost ?? null,
    coHost: parsed?.coHost ?? null,
    goal: parsed?.smartGoal3Months ?? parsed?.nextStageGoal ?? null,
    revenueBaseline: revenueBaseline ? String(revenueBaseline) : null,
  };
}

/**
 * Look up VP1 / VP2 (sprint) dates from Sprint Tracking by matching an existing
 * founder on company name. Returns the earliest two scheduled sprint dates.
 * Returns nulls if the company isn't tracked yet — the consultant can fill them
 * in manually during review.
 */
async function lookupVpDates(companyName: string): Promise<{ vp1: string | null; vp2: string | null }> {
  if (!companyName.trim()) return { vp1: null, vp2: null };
  const [founder] = await db
    .select({ id: foundersTable.id })
    .from(foundersTable)
    .where(sql`LOWER(${foundersTable.companyName}) = LOWER(${companyName})`)
    .limit(1);
  if (!founder) return { vp1: null, vp2: null };
  const sprints = await db
    .select({ scheduledDate: sprintsTable.scheduledDate })
    .from(sprintsTable)
    .where(eq(sprintsTable.founderId, founder.id))
    .orderBy(asc(sprintsTable.scheduledDate));
  return {
    vp1: sprints[0]?.scheduledDate ?? null,
    vp2: sprints[1]?.scheduledDate ?? null,
  };
}

// ── Step 1: create + pull (+ optional Fathom extract) ────────────────────
router.post("/builder/summary-builds", upload.single("fathom"), async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessResearch(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }

  const startupName = String(req.body?.startup_name ?? "").trim();
  const tsheetLink = String(req.body?.tsheet_link ?? "").trim();
  const cohort = req.body?.cohort ? String(req.body.cohort).trim() : WADHWANI_COHORT;

  if (!startupName) { res.status(400).json({ error: "startup_name required" }); return; }
  if (!tsheetLink) { res.status(400).json({ error: "tsheet_link required" }); return; }
  if (!extractSheetId(tsheetLink)) { res.status(400).json({ error: "That doesn't look like a Google Sheets URL." }); return; }

  try {
    const pulled = await pullTSheet(me.id, tsheetLink);
    // Prefer the T-Sheet's company name if present; fall back to typed name.
    pulled.startupName = pulled.startupName || startupName;

    // Optional Fathom transcript → AI extract.
    let fathomText: string | null = null;
    let ai: SummaryAiFields = emptySummaryAiFields();
    const file = (req as any).file as Express.Multer.File | undefined;
    if (file) {
      fathomText = await extractTextFromUpload(file.originalname, file.buffer);
      if (fathomText && fathomText.length > 40) {
        ai = await extractSummaryFields({
          startupName: pulled.startupName,
          transcript: fathomText,
          context: { founder: pulled.founder, goal: pulled.goal },
        });
      }
    }

    const vp = await lookupVpDates(pulled.startupName);
    const fields = buildFields(pulled, ai, vp);

    const [created] = await db.insert(summaryBuildsTable).values({
      userId: me.id,
      startupName: pulled.startupName,
      cohort,
      tsheetLink,
      status: "ready",
      fathomText,
      pulled: pulled as any,
      aiFields: ai as any,
      fields: fields as any,
    }).returning();

    res.json({ build: created });
  } catch (err: any) {
    req.log.error({ err }, "Summary build create failed");
    const msg = err?.message ?? "Failed to build summary";
    const code = /access|expired|not connected|Google|URL|Sheet|Founder|Company/i.test(msg) ? 400 : 500;
    res.status(code).json({ error: msg });
  }
});

// ── Step 2: (re)run AI extraction on the stored Fathom text ──────────────
router.post("/builder/summary-builds/:id/extract", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessResearch(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const [row] = await db.select().from(summaryBuildsTable).where(eq(summaryBuildsTable.id, id)).limit(1);
    if (!row) { res.status(404).json({ error: "Build not found" }); return; }
    if (!row.fathomText || row.fathomText.length < 40) {
      res.status(400).json({ error: "No Fathom transcript on this build to extract from." }); return;
    }
    const pulled = (row.pulled ?? {}) as PulledFields;
    const ai = await extractSummaryFields({
      startupName: row.startupName,
      transcript: row.fathomText,
      context: { founder: pulled.founder, goal: pulled.goal },
    });
    // Merge AI output into the editable fields without clobbering manual edits
    // the consultant already made (only fill blanks + the AI-owned fields).
    const existing = (row.fields ?? {}) as SummaryFields;
    const merged: SummaryFields = {
      ...existing,
      currentRevenueArr: ai.currentRevenueArr || existing.currentRevenueArr || "",
      industryDetail: ai.industryDetail || existing.industryDetail || "",
      criticalVenture: ai.criticalVenture || existing.criticalVenture || "",
      tsConnects: ai.tsConnects || existing.tsConnects || "",
      tsSupport: ai.tsSupport || existing.tsSupport || "",
    };
    await db.update(summaryBuildsTable)
      .set({ aiFields: ai as any, fields: merged as any, status: "ready", errorMessage: null, updatedAt: new Date() })
      .where(eq(summaryBuildsTable.id, id));
    res.json({ aiFields: ai, fields: merged });
  } catch (err: any) {
    req.log.error({ err }, "Summary extract failed");
    await db.update(summaryBuildsTable)
      .set({ status: "failed", errorMessage: String(err?.message ?? err).slice(0, 1000), updatedAt: new Date() })
      .where(eq(summaryBuildsTable.id, id));
    res.status(500).json({ error: err?.message ?? "Extract failed" });
  }
});

// ── Step 3: save edits ───────────────────────────────────────────────────
router.patch("/builder/summary-builds/:id", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessResearch(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const fields = req.body?.fields;
  if (!fields || typeof fields !== "object") { res.status(400).json({ error: "fields object required" }); return; }
  try {
    await db.update(summaryBuildsTable)
      .set({ fields: fields as any, status: "ready", updatedAt: new Date() })
      .where(eq(summaryBuildsTable.id, id));
    res.json({ ok: true });
  } catch (err: any) {
    req.log.error({ err }, "Save summary build failed");
    res.status(500).json({ error: "Failed to save" });
  }
});

// ── Step 4: commit to the Summary Sheet tab ──────────────────────────────
/**
 * Writes a venture row to the founders table under the Wadhwani cohort. Core
 * fields map to founder columns (so they render on the Summary page); the full
 * Wadhwani field set is also stored in excelData.wadhwaniSummary for fidelity.
 * Find-or-create on company name (per owner) so re-committing updates in place.
 */
router.post("/builder/summary-builds/:id/commit", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessResearch(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const [row] = await db.select().from(summaryBuildsTable).where(eq(summaryBuildsTable.id, id)).limit(1);
    if (!row) { res.status(404).json({ error: "Build not found" }); return; }
    const f = (row.fields ?? {}) as SummaryFields;
    const companyName = (f.startupName || row.startupName || "").trim();
    if (!companyName) { res.status(400).json({ error: "Startup name is required to commit" }); return; }

    // Find or create the cohort (matches the migration-seeded Wadhwani cohort).
    const cohortName = (row.cohort || WADHWANI_COHORT).trim();
    let [cohort] = await db.select().from(incubatorsTable)
      .where(sql`LOWER(${incubatorsTable.name}) = LOWER(${cohortName})`).limit(1);
    if (!cohort) {
      [cohort] = await db.insert(incubatorsTable).values({
        name: cohortName, type: "wadhwani", description: "Created via Summary Builder",
      }).returning();
    }

    // The full Wadhwani field set kept verbatim under excelData.
    const wadhwaniSummary = {
      ...f,
      vp1Date: f.vp1Date ?? null,
      vp2Date: f.vp2Date ?? null,
      builtVia: "summary_builder",
      summaryBuildId: row.id,
    };

    // Core fields mapped to founder columns so they surface on the Summary tab.
    const mapped = {
      companyName,
      name: (f.founder || "Unknown").trim(),
      industry: f.industry || null,
      sprintHost: f.host || null,
      coHost: f.coHost || null,
      goalSetting: f.goal || null,
      smartGoal3Months: f.goal || null,
      revenueLast12Months: f.currentRevenueArr || null,
      marketAccess: f.tsConnects || null,         // TS Connects
      tSprintIntervention: f.tsSupport || null,    // TS Support (beyond connects)
      description: f.industryDetail || null,
      incubatorId: cohort.id,
      source: "summary_builder",
      ownerId: me.id,
    };

    // Find-or-create the venture (per owner, by company name).
    const [existing] = await db.select().from(foundersTable)
      .where(and(
        sql`LOWER(${foundersTable.companyName}) = LOWER(${companyName})`,
        eq(foundersTable.ownerId, me.id),
      )).limit(1);

    let founderId: number;
    if (existing) {
      const mergedExcel = { ...((existing.excelData as any) ?? {}), wadhwaniSummary };
      const [updated] = await db.update(foundersTable)
        .set({ ...mapped, email: existing.email, excelData: mergedExcel as any })
        .where(eq(foundersTable.id, existing.id))
        .returning();
      founderId = updated.id;
    } else {
      const [createdF] = await db.insert(foundersTable).values({
        ...mapped,
        email: `unknown+${Date.now()}@placeholder.local`,
        excelData: { wadhwaniSummary } as any,
        stageWorkflow: "pre_sprint",
      }).returning();
      founderId = createdF.id;
    }

    await db.insert(companyEventsTable).values({
      founderId, userId: me.id,
      kind: "template_uploaded",
      note: `Committed from Summary Builder to ${cohortName}`,
      metadata: { summaryBuildId: row.id, via: "summary_builder" },
    });

    await db.update(summaryBuildsTable)
      .set({ status: "committed", founderId, updatedAt: new Date() })
      .where(eq(summaryBuildsTable.id, id));

    res.json({ ok: true, founderId, cohortId: cohort.id });
  } catch (err: any) {
    req.log.error({ err }, "Summary commit failed");
    res.status(500).json({ error: err?.message ?? "Commit failed" });
  }
});

// ── Library list ─────────────────────────────────────────────────────────
router.get("/builder/summary-builds", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessResearch(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }
  try {
    const rows = await db.select({
      id: summaryBuildsTable.id,
      startupName: summaryBuildsTable.startupName,
      cohort: summaryBuildsTable.cohort,
      status: summaryBuildsTable.status,
      founderId: summaryBuildsTable.founderId,
      createdAt: summaryBuildsTable.createdAt,
      updatedAt: summaryBuildsTable.updatedAt,
    }).from(summaryBuildsTable)
      .where(eq(summaryBuildsTable.userId, me.id))
      .orderBy(desc(summaryBuildsTable.updatedAt));
    res.json({ builds: rows });
  } catch (err: any) {
    req.log.error({ err }, "List summary builds failed");
    res.status(500).json({ error: "Failed to list" });
  }
});

// ── Single record ────────────────────────────────────────────────────────
router.get("/builder/summary-builds/:id", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessResearch(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [row] = await db.select().from(summaryBuildsTable).where(eq(summaryBuildsTable.id, id)).limit(1);
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    // Don't ship the full transcript to the client; just whether one exists.
    const { fathomText, ...rest } = row;
    res.json({ build: { ...rest, hasFathom: !!fathomText } });
  } catch (err: any) {
    req.log.error({ err }, "Get summary build failed");
    res.status(500).json({ error: "Failed to load" });
  }
});

router.delete("/builder/summary-builds/:id", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessResearch(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(summaryBuildsTable).where(eq(summaryBuildsTable.id, id));
    res.json({ ok: true });
  } catch (err: any) {
    req.log.error({ err }, "Delete summary build failed");
    res.status(500).json({ error: "Failed to delete" });
  }
});

export default router;
