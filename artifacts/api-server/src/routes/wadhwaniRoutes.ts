/**
 * Wadhwani Foundation Summary Builder routes (v5.5 Phase B).
 *
 * Workflow:
 *
 *   1. POST /builder/wadhwani-summaries
 *        Multipart: startup_name (override hint), cohort, tsheet_link,
 *        industry, tg, funding (chosen dropdown values),
 *        fathom_1..fathom_10 (any, optional).
 *        Pulls T-Sheet fields, runs Fathom AI extraction, returns the
 *        merged record for the consultant to edit.
 *        → status 'extracted' (or 'failed')
 *
 *   2. PATCH /builder/wadhwani-summaries/:id
 *        Body: { ...editable fields }
 *        Saves consultant edits before final write-to-sheet.
 *
 *   3. POST /builder/wadhwani-summaries/:id/write-to-sheet
 *        Body: { summary_sheet_link: string }
 *        Appends a row to the user's Wadhwani Summary Sheet.
 *        → status 'written_to_sheet'
 *
 *   4. GET /builder/wadhwani-summaries
 *        List for the library tab.
 *
 *   5. GET /builder/wadhwani-summaries/:id
 *        Fetch full record.
 *
 *   6. DELETE /builder/wadhwani-summaries/:id
 */

import { Router } from "express";
import multer from "multer";
import {
  db, usersTable, wadhwaniSummariesTable,
  canAccessResearch,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { google } from "googleapis";
import { extractTextFromUpload } from "../lib/fileExtract";
import { extractWadhwaniFields } from "../lib/wadhwaniSummaryAi";
import { parseWadhwaniSheet } from "../lib/wadhwaniSheetParser";
import { extractSheetId } from "../lib/sheetsFetcher";
import { getAuthedClient } from "../lib/google";

const router = Router();
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });

async function getMe(req: any, res: any) {
  const uid = req.session?.userId;
  if (!uid) { res.status(401).json({ error: "Not authenticated" }); return null; }
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, uid)).limit(1);
  if (!u) { res.status(401).json({ error: "User not found" }); return null; }
  return u;
}

/** Step 1 — Create summary: pull T-Sheet, extract Fathom fields, save. */
router.post(
  "/builder/wadhwani-summaries",
  upload.fields([
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
  ]),
  async (req, res) => {
    const me = await getMe(req, res); if (!me) return;
    if (!canAccessResearch(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }

    const startupNameInput = String(req.body?.startup_name ?? "").trim();
    const cohort = req.body?.cohort ? String(req.body.cohort).trim() : null;
    const tsheetLink = String(req.body?.tsheet_link ?? "").trim();
    const industry = req.body?.industry ? String(req.body.industry).trim() : null;
    const tg = req.body?.tg ? String(req.body.tg).trim() : null;
    const funding = req.body?.funding ? String(req.body.funding).trim() : null;

    if (!tsheetLink) { res.status(400).json({ error: "tsheet_link required" }); return; }

    try {
      // 1. Pull structured fields from T-Sheet (Overview / SMART / Sprint Tracking)
      const sheetData = await parseWadhwaniSheet({
        userId: me.id,
        sheetUrlOrId: tsheetLink,
        startupNameHint: startupNameInput || undefined,
      });

      const finalStartupName = sheetData.startupName || startupNameInput;
      if (!finalStartupName) {
        res.status(400).json({
          error: "Couldn't find a startup name in the T-Sheet's Overview tab. Enter one manually in the form.",
        });
        return;
      }

      // 2. Extract Fathom transcripts (text only, raw discarded)
      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const fathomTexts: string[] = [];
      for (let i = 1; i <= 10; i++) {
        const f = files?.[`fathom_${i}`]?.[0];
        if (!f) continue;
        const text = await extractTextFromUpload(f.originalname, f.buffer);
        if (text) fathomTexts.push(text);
      }

      // 3. Run AI extraction on Fathom transcripts (5 fields)
      const aiFields = await extractWadhwaniFields({
        startupName: finalStartupName,
        fathomTexts,
      });

      // 4. Persist
      const [created] = await db.insert(wadhwaniSummariesTable).values({
        userId: me.id,
        startupName: finalStartupName,
        cohort,
        tsheetLink,
        status: "extracted",
        founderName: sheetData.founderName || null,
        host: sheetData.host || null,
        coHost: sheetData.coHost || null,
        goal: sheetData.goal || null,
        vp1Date: sheetData.vp1Date || null,
        vp2Date: sheetData.vp2Date || null,
        fathomTexts: fathomTexts.length > 0 ? fathomTexts : null,
        currentRevenue: aiFields.currentRevenue || null,
        industryDetail: aiFields.industryDetail || null,
        criticalVenture: aiFields.criticalVenture || null,
        tsConnects: aiFields.tsConnects || null,
        tsSupport: aiFields.tsSupport || null,
        industry,
        tg,
        funding,
      }).returning();

      res.json({ summary: created });
    } catch (err: any) {
      req.log.error({ err }, "Wadhwani summary create failed");
      res.status(500).json({ error: err?.message ?? "Failed to process T-Sheet" });
    }
  },
);

/** Step 2 — Save consultant edits. */
router.patch("/builder/wadhwani-summaries/:id", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessResearch(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const body = req.body ?? {};
  // Only allow these editable fields; never let arbitrary keys through.
  const allow = [
    "startupName", "cohort",
    "founderName", "host", "coHost", "goal", "vp1Date", "vp2Date",
    "currentRevenue", "industryDetail", "criticalVenture", "tsConnects", "tsSupport",
    "industry", "tg", "funding",
  ] as const;
  const updates: Record<string, any> = {};
  for (const k of allow) {
    if (k in body) {
      const v = body[k];
      updates[k] = typeof v === "string" ? v.trim() : v ?? null;
    }
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No editable fields in body" });
    return;
  }
  updates.updatedAt = new Date();

  try {
    await db.update(wadhwaniSummariesTable)
      .set(updates)
      .where(eq(wadhwaniSummariesTable.id, id));
    res.json({ ok: true });
  } catch (err: any) {
    req.log.error({ err }, "Wadhwani summary update failed");
    res.status(500).json({ error: err?.message ?? "Update failed" });
  }
});

/** Step 3 — Write the row to the Summary Sheet (Google Sheets append). */
router.post("/builder/wadhwani-summaries/:id/write-to-sheet", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessResearch(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const summarySheetLink = String(req.body?.summary_sheet_link ?? "").trim();
  if (!summarySheetLink) { res.status(400).json({ error: "summary_sheet_link required" }); return; }

  const sheetId = extractSheetId(summarySheetLink);
  if (!sheetId) { res.status(400).json({ error: "Invalid Summary Sheet URL" }); return; }

  try {
    const [row] = await db.select().from(wadhwaniSummariesTable)
      .where(eq(wadhwaniSummariesTable.id, id)).limit(1);
    if (!row) { res.status(404).json({ error: "Summary not found" }); return; }

    const client = await getAuthedClient(me.id);
    if (!client) {
      res.status(403).json({ error: "Google isn't connected. Open Settings → Google Connections." });
      return;
    }

    const sheets = google.sheets({ version: "v4", auth: client });

    // Find a tab named "Summary Sheet" (or similar). Default to first tab.
    let targetTab: string;
    try {
      const meta = await sheets.spreadsheets.get({
        spreadsheetId: sheetId,
        fields: "sheets.properties.title",
      });
      const titles = (meta.data.sheets ?? [])
        .map(s => s.properties?.title)
        .filter((t): t is string => !!t);
      const found = titles.find(t => /summary/i.test(t));
      targetTab = found ?? titles[0] ?? "Sheet1";
    } catch (err: any) {
      const code = err?.response?.status ?? err?.code;
      if (code === 404) throw new Error("Summary Sheet not found. Check the URL.");
      if (code === 403) throw new Error("Access denied to Summary Sheet. Share it with your Google account.");
      throw err;
    }

    // Column order matches the typical Wadhwani summary sheet layout. If the
    // user's template differs, they can move columns after the append — the
    // append goes to the last row regardless.
    const rowValues = [
      row.startupName ?? "",
      row.founderName ?? "",
      row.host ?? "",
      row.coHost ?? "",
      row.cohort ?? "",
      row.industry ?? "",
      row.industryDetail ?? "",
      row.tg ?? "",
      row.funding ?? "",
      row.currentRevenue ?? "",
      row.vp1Date ?? "",
      row.vp2Date ?? "",
      row.goal ?? "",
      row.criticalVenture ?? "",
      row.tsConnects ?? "",
      row.tsSupport ?? "",
    ];

    const result = await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `'${targetTab.replace(/'/g, "''")}'!A1`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [rowValues] },
    });

    // updatedRange looks like "Summary Sheet!A42:P42" — pull row index
    const updatedRange = result.data.updates?.updatedRange ?? "";
    const rowMatch = updatedRange.match(/[A-Z]+(\d+):/);
    const rowIndex = rowMatch ? Number(rowMatch[1]) : null;

    await db.update(wadhwaniSummariesTable)
      .set({
        status: "written_to_sheet",
        sheetRowIndex: rowIndex,
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(wadhwaniSummariesTable.id, id));

    res.json({ ok: true, sheetRowIndex: rowIndex, tab: targetTab });
  } catch (err: any) {
    req.log.error({ err }, "Wadhwani write-to-sheet failed");
    await db.update(wadhwaniSummariesTable)
      .set({ errorMessage: String(err?.message ?? err).slice(0, 1000), updatedAt: new Date() })
      .where(eq(wadhwaniSummariesTable.id, id));
    res.status(500).json({ error: err?.message ?? "Write failed" });
  }
});

/** Step 4 — List for library tab. */
router.get("/builder/wadhwani-summaries", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessResearch(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }
  try {
    const rows = await db.select().from(wadhwaniSummariesTable)
      .where(eq(wadhwaniSummariesTable.userId, me.id))
      .orderBy(desc(wadhwaniSummariesTable.updatedAt))
      .limit(100);
    res.json({ summaries: rows });
  } catch (err: any) {
    req.log.error({ err }, "Wadhwani list failed");
    res.status(500).json({ error: err?.message ?? "List failed" });
  }
});

/** Step 5 — Get one. */
router.get("/builder/wadhwani-summaries/:id", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessResearch(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [row] = await db.select().from(wadhwaniSummariesTable)
      .where(eq(wadhwaniSummariesTable.id, id)).limit(1);
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ summary: row });
  } catch (err: any) {
    req.log.error({ err }, "Wadhwani get failed");
    res.status(500).json({ error: err?.message ?? "Get failed" });
  }
});

/** Step 6 — Delete. */
router.delete("/builder/wadhwani-summaries/:id", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessResearch(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(wadhwaniSummariesTable)
      .where(eq(wadhwaniSummariesTable.id, id));
    res.json({ ok: true });
  } catch (err: any) {
    req.log.error({ err }, "Wadhwani delete failed");
    res.status(500).json({ error: err?.message ?? "Delete failed" });
  }
});

export default router;
