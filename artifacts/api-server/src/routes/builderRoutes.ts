/**
 * Builder routes — Growth Report flow (v5.4 Phase A).
 *
 * Multi-step workflow:
 *
 *   1. POST /builder/growth-reports
 *        Accepts multipart upload: startup_name, cohort, tsheet_link,
 *        num_sprints, strategic_canvas (PDF, required),
 *        fathom_1, fathom_2, checkin (any, optional).
 *        Extracts text from each upload, stores text-only, discards files.
 *        → status 'drafting'
 *
 *   2. POST /builder/growth-reports/:id/extract-anchors
 *        Runs Prompt 1 (extractAnchors).
 *        → status 'anchors_ready'
 *
 *   3. PATCH /builder/growth-reports/:id/anchors
 *        Body: { anchors: GrowthReportAnchors }
 *        Saves the consultant's edits before final generation.
 *
 *   4. POST /builder/growth-reports/:id/generate-report
 *        Runs Prompt 2 (generateJourneyReport), then assembles DOCX.
 *        → status 'report_ready'
 *
 *   5. GET /builder/growth-reports
 *        List all reports for the library tab.
 *
 *   6. GET /builder/growth-reports/:id
 *        Fetch full record (incl. anchors/report JSON; not the DOCX bytes).
 *
 *   7. GET /builder/growth-reports/:id/docx
 *        Stream the DOCX back. base64 → Buffer.
 *
 *   8. DELETE /builder/growth-reports/:id
 *        Remove from library.
 *
 * Authorization: same as Research Workspace — consultant / research / admin.
 */

import { Router } from "express";
import multer from "multer";
import {
  db, usersTable, growthReportsTable,
  canAccessResearch,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import {
  extractAnchors, generateJourneyReport,
  type GrowthReportAnchors, emptyAnchors,
} from "../lib/growthReportAi";
import { buildJourneyReportDocx } from "../lib/growthReportDocx";
import { extractTextFromUpload } from "../lib/fileExtract";

const router = Router();

// 10 MB per file is plenty; transcripts are typically < 1 MB.
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });

async function getMe(req: any, res: any) {
  const uid = req.session?.userId;
  if (!uid) { res.status(401).json({ error: "Not authenticated" }); return null; }
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, uid)).limit(1);
  if (!u) { res.status(401).json({ error: "User not found" }); return null; }
  return u;
}

/**
 * Step 1 — Create report + extract text from uploads.
 * Returns { id } for the next step. Raw buffers are NOT stored.
 */
router.post(
  "/builder/growth-reports",
  upload.fields([
    { name: "strategic_canvas", maxCount: 1 },
    // Dynamic Fathom slots — accept up to 10. Frontend sends as many as the
    // consultant attaches (v5.5 removed the old 2-slot limit). We also keep
    // the legacy names fathom_1/fathom_2 working in case any old client
    // is still around. Filtered out at process time if missing.
    { name: "fathom_1", maxCount: 1 },
    { name: "fathom_2", maxCount: 1 },
    { name: "fathom_3", maxCount: 1 },
    { name: "fathom_4", maxCount: 1 },
    { name: "fathom_5", maxCount: 1 },
    { name: "fathom_6", maxCount: 1 },
    { name: "fathom_7", maxCount: 1 },
    { name: "fathom_8", maxCount: 1 },
    { name: "fathom_9", maxCount: 1 },
    { name: "fathom_10", maxCount: 1 },
    { name: "checkin", maxCount: 1 },
  ]),
  async (req, res) => {
    const me = await getMe(req, res); if (!me) return;
    if (!canAccessResearch(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }

    const startupName = String(req.body?.startup_name ?? "").trim();
    const cohort = req.body?.cohort ? String(req.body.cohort).trim() : null;
    const tsheetLink = String(req.body?.tsheet_link ?? "").trim();
    const numSprints = Math.max(1, Math.min(2, Number(req.body?.num_sprints ?? 1)));

    if (!startupName) { res.status(400).json({ error: "startup_name required" }); return; }
    if (!tsheetLink) { res.status(400).json({ error: "tsheet_link required" }); return; }

    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const canvas = files?.strategic_canvas?.[0];
    if (!canvas) { res.status(400).json({ error: "Strategic Canvas file is required" }); return; }

    try {
      // Extract text from every upload. We do these sequentially rather
      // than in parallel — small files, parallelism adds risk of resource
      // contention on the free-tier dyno.
      const strategicCanvasText = await extractTextFromUpload(canvas.originalname, canvas.buffer);

      // Collect all Fathom transcripts in order. We support up to 10 slots,
      // numbered fathom_1..fathom_10. Missing slots are skipped — the array
      // is dense (no holes). Two legacy columns mirror the first two entries
      // so old code paths that still read fathom1Text/fathom2Text continue
      // to work; new code should always read fathomTexts.
      const fathomTexts: string[] = [];
      for (let i = 1; i <= 10; i++) {
        const f = files?.[`fathom_${i}`]?.[0];
        if (!f) continue;
        const text = await extractTextFromUpload(f.originalname, f.buffer);
        if (text) fathomTexts.push(text);
      }
      const fathom1Text = fathomTexts[0] ?? null;
      const fathom2Text = fathomTexts[1] ?? null;

      const checkinText = files?.checkin?.[0]
        ? await extractTextFromUpload(files.checkin[0].originalname, files.checkin[0].buffer)
        : null;

      // Sanity check: canvas must have produced *something*.
      if (!strategicCanvasText || strategicCanvasText.length < 50) {
        res.status(400).json({
          error: "Strategic Canvas appears empty after extraction. Make sure the PDF has selectable text (not scanned images).",
        });
        return;
      }

      const [created] = await db.insert(growthReportsTable).values({
        userId: me.id,
        startupName,
        cohort,
        tsheetLink,
        status: "drafting",
        strategicCanvasText,
        fathomTexts: fathomTexts.length > 0 ? fathomTexts : null,
        fathom1Text,
        fathom2Text,
        checkinText,
        numSprints,
      }).returning();

      res.json({ report: created });
    } catch (err: any) {
      req.log.error({ err }, "Growth report create failed");
      res.status(500).json({ error: err?.message ?? "Failed to process uploads" });
    }
  },
);

/** Step 2 — Run Prompt 1, save anchors, transition to 'anchors_ready'. */
router.post("/builder/growth-reports/:id/extract-anchors", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessResearch(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const [row] = await db.select().from(growthReportsTable).where(eq(growthReportsTable.id, id)).limit(1);
    if (!row) { res.status(404).json({ error: "Report not found" }); return; }
    if (!row.strategicCanvasText) {
      res.status(400).json({ error: "Strategic Canvas text missing — re-upload required" }); return;
    }

    // Prefer the new JSONB array (v5.5+). Fall back to legacy columns for
    // rows created before migration 010 ran.
    const fathomTexts: string[] = (Array.isArray(row.fathomTexts) ? row.fathomTexts : null)
      ?? [row.fathom1Text, row.fathom2Text].filter((s): s is string => !!s);

    const anchors = await extractAnchors({
      startupName: row.startupName,
      strategicCanvasText: row.strategicCanvasText,
      fathomTexts,
      checkinText: row.checkinText ?? undefined,
    });

    await db.update(growthReportsTable)
      .set({ anchors: anchors as any, status: "anchors_ready", updatedAt: new Date(), errorMessage: null })
      .where(eq(growthReportsTable.id, id));

    res.json({ anchors });
  } catch (err: any) {
    req.log.error({ err }, "Anchor extraction failed");
    await db.update(growthReportsTable)
      .set({ status: "failed", errorMessage: String(err?.message ?? err).slice(0, 1000), updatedAt: new Date() })
      .where(eq(growthReportsTable.id, id));
    res.status(500).json({ error: err?.message ?? "Anchor extraction failed" });
  }
});

/** Step 3 — Save consultant edits to anchors (no status change). */
router.patch("/builder/growth-reports/:id/anchors", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessResearch(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const anchors = req.body?.anchors as GrowthReportAnchors | undefined;
  if (!anchors || typeof anchors !== "object") { res.status(400).json({ error: "anchors object required" }); return; }

  try {
    await db.update(growthReportsTable)
      .set({ anchors: anchors as any, updatedAt: new Date() })
      .where(eq(growthReportsTable.id, id));
    res.json({ ok: true });
  } catch (err: any) {
    req.log.error({ err }, "Save anchors failed");
    res.status(500).json({ error: err?.message ?? "Save anchors failed" });
  }
});

/** Step 4 — Generate full report + DOCX. */
router.post("/builder/growth-reports/:id/generate-report", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessResearch(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const [row] = await db.select().from(growthReportsTable).where(eq(growthReportsTable.id, id)).limit(1);
    if (!row) { res.status(404).json({ error: "Report not found" }); return; }
    if (!row.anchors) { res.status(400).json({ error: "Anchors not yet extracted" }); return; }
    if (!row.strategicCanvasText) { res.status(400).json({ error: "Source text missing" }); return; }

    const fathomTexts: string[] = (Array.isArray(row.fathomTexts) ? row.fathomTexts : null)
      ?? [row.fathom1Text, row.fathom2Text].filter((s): s is string => !!s);

    const report = await generateJourneyReport({
      startupName: row.startupName,
      anchors: row.anchors as GrowthReportAnchors,
      strategicCanvasText: row.strategicCanvasText,
      fathomTexts,
      checkinText: row.checkinText ?? undefined,
    });

    const docxBuffer = await buildJourneyReportDocx({ startupName: row.startupName, report });
    const docxB64 = docxBuffer.toString("base64");

    await db.update(growthReportsTable)
      .set({ report: report as any, docxB64, status: "report_ready", updatedAt: new Date(), errorMessage: null })
      .where(eq(growthReportsTable.id, id));

    res.json({ ok: true, report });
  } catch (err: any) {
    req.log.error({ err }, "Report generation failed");
    await db.update(growthReportsTable)
      .set({ status: "failed", errorMessage: String(err?.message ?? err).slice(0, 1000), updatedAt: new Date() })
      .where(eq(growthReportsTable.id, id));
    res.status(500).json({ error: err?.message ?? "Report generation failed" });
  }
});

/** Library list. Excludes the heavy text + docx fields. */
router.get("/builder/growth-reports", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessResearch(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }
  try {
    const rows = await db
      .select({
        id: growthReportsTable.id,
        startupName: growthReportsTable.startupName,
        cohort: growthReportsTable.cohort,
        status: growthReportsTable.status,
        numSprints: growthReportsTable.numSprints,
        createdAt: growthReportsTable.createdAt,
        updatedAt: growthReportsTable.updatedAt,
      })
      .from(growthReportsTable)
      .orderBy(desc(growthReportsTable.updatedAt));
    res.json({ reports: rows });
  } catch (err: any) {
    req.log.error({ err }, "List growth reports failed");
    res.status(500).json({ error: "Failed to list" });
  }
});

/** Single record (no DOCX). */
router.get("/builder/growth-reports/:id", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessResearch(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [row] = await db.select({
      id: growthReportsTable.id,
      userId: growthReportsTable.userId,
      startupName: growthReportsTable.startupName,
      cohort: growthReportsTable.cohort,
      tsheetLink: growthReportsTable.tsheetLink,
      status: growthReportsTable.status,
      errorMessage: growthReportsTable.errorMessage,
      numSprints: growthReportsTable.numSprints,
      anchors: growthReportsTable.anchors,
      report: growthReportsTable.report,
      hasDocx: growthReportsTable.docxB64,   // we'll convert to boolean below
      createdAt: growthReportsTable.createdAt,
      updatedAt: growthReportsTable.updatedAt,
    }).from(growthReportsTable).where(eq(growthReportsTable.id, id)).limit(1);
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    // Replace base64 blob with a boolean marker — keep payload small.
    const { hasDocx, ...rest } = row;
    res.json({ report: { ...rest, hasDocx: !!hasDocx } });
  } catch (err: any) {
    req.log.error({ err }, "Get growth report failed");
    res.status(500).json({ error: "Failed to load" });
  }
});

/** DOCX download. Streams binary. */
router.get("/builder/growth-reports/:id/docx", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessResearch(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [row] = await db.select({
      startupName: growthReportsTable.startupName,
      docxB64: growthReportsTable.docxB64,
    }).from(growthReportsTable).where(eq(growthReportsTable.id, id)).limit(1);
    if (!row || !row.docxB64) { res.status(404).json({ error: "DOCX not yet generated" }); return; }
    const buf = Buffer.from(row.docxB64, "base64");
    const safeName = row.startupName.replace(/[^A-Za-z0-9._-]+/g, "_");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}_Growth_Journey_Report.docx"`);
    res.setHeader("Content-Length", String(buf.length));
    res.end(buf);
  } catch (err: any) {
    req.log.error({ err }, "DOCX download failed");
    res.status(500).json({ error: "Failed to download" });
  }
});

router.delete("/builder/growth-reports/:id", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessResearch(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(growthReportsTable).where(eq(growthReportsTable.id, id));
    res.json({ ok: true });
  } catch (err: any) {
    req.log.error({ err }, "Delete growth report failed");
    res.status(500).json({ error: "Failed to delete" });
  }
});

/** Helper to expose the empty-anchor shape to the frontend (for new draft UIs). */
router.get("/builder/empty-anchors", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessResearch(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }
  res.json({ anchors: emptyAnchors() });
});

export default router;
