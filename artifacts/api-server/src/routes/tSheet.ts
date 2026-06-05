/**
 * "Clean the Sheet" endpoint.
 *
 *   POST /companies/:id/clean-sheet   body: { transcript: string, fathomLink?: string }
 *
 * Reads the company's linked Google Sheet, asks Gemini to organise the pasted
 * Fathom transcript into concise notes, and writes them into the
 * "Models and priority" + Target Audience tabs (see lib/tSheetCleaner.ts).
 * Returns a report the dialog renders so the consultant can review what landed.
 */
import { Router } from "express";
import { db, foundersTable, companyEventsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isGeminiConfigured } from "../lib/gemini";
import { cleanSheet } from "../lib/tSheetCleaner";

const router = Router();

async function requireUser(req: any, res: any): Promise<number | null> {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return null; }
  return userId;
}

router.post("/companies/:id/clean-sheet", async (req, res) => {
  const userId = await requireUser(req, res); if (!userId) return;
  const id = Number(req.params.id);
  const transcript = String(req.body?.transcript ?? "").trim();
  const fathomLink = String(req.body?.fathomLink ?? "").trim() || null;

  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid company id" }); return; }
  if (transcript.length < 40) {
    res.status(400).json({ error: "Paste the full Fathom transcript — that looks too short to clean." });
    return;
  }
  if (!await isGeminiConfigured()) {
    res.status(503).json({ error: "AI is not configured. The server admin must set GEMINI_API_KEY." });
    return;
  }

  try {
    const [c] = await db.select().from(foundersTable).where(eq(foundersTable.id, id)).limit(1);
    if (!c) { res.status(404).json({ error: "Company not found" }); return; }
    if (c.ownerId && c.ownerId !== userId) { res.status(403).json({ error: "Not authorized for this company" }); return; }

    const sheetUrl = c.sourceSheetUrl ?? c.thinkingSheetUrl;
    if (!sheetUrl) {
      res.status(400).json({ error: "This company has no linked Google Sheet. Add the sheet URL (Edit) and try again." });
      return;
    }

    const report = await cleanSheet({
      userId,
      companyName: c.companyName,
      sheetUrlOrId: sheetUrl,
      transcript,
    });

    // Persist the Fathom link if the consultant supplied one.
    if (fathomLink && fathomLink !== c.fathomLink) {
      await db.update(foundersTable).set({ fathomLink }).where(eq(foundersTable.id, id));
    }

    // Timeline event for the company history. We store the FULL cleaned output
    // in metadata so the company dashboard can render it as recommendations —
    // this is what the consultant applies manually when the sheet couldn't be
    // edited (wrote === false).
    const note = report.wrote
      ? `Cleaned T-Sheet from transcript — wrote ${report.actionsWritten} idea note(s), ${report.audienceRowsAdded} audience row(s), ${report.suggestionsAdded} suggestion(s), ${report.reorganizedAdded} regrouped note(s) to the sheet.`
      : `Cleaned T-Sheet from transcript — sheet not editable, ${report.actionsWritten + report.audienceRowsAdded + report.suggestionsAdded + report.reorganizedAdded} item(s) saved to the dashboard.`;
    await db.insert(companyEventsTable).values({
      founderId: id, userId, kind: "sheet_cleaned",
      note,
      metadata: {
        wrote: report.wrote,
        writeError: report.writeError,
        ideasTouched: report.ideasTouched,
        audienceRowsAdded: report.audienceRowsAdded,
        suggestionsAdded: report.suggestionsAdded,
        reorganizedAdded: report.reorganizedAdded,
        targetTabFound: report.targetTabFound,
        actionBlocks: report.actionBlocks,
        extracted: report.extracted,
        spreadsheetId: report.spreadsheetId,
        cleanedAt: new Date().toISOString(),
      },
    });

    res.json({ ok: true, wrote: report.wrote, writeError: report.writeError, report, sheetUrl });
  } catch (err) {
    req.log.error({ err }, "Clean-sheet failed");
    const msg = err instanceof Error ? err.message : "Failed to clean the sheet";
    res.status(500).json({ error: msg });
  }
});

export default router;
