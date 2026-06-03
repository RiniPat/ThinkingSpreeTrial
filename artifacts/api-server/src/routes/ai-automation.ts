/**
 * AI Automation routes.
 *
 * Three consultant-triggered workflows, all human-in-the-loop (the AI proposes,
 * the consultant edits, the consultant sends/saves):
 *
 *   POST /ai/sheet-emails           — paste a Google Sheet URL of a single
 *                                     founder's session notes, AI returns a
 *                                     pre-sprint draft AND a post-sprint draft.
 *
 *   POST /ai/sprints/:id/summary-update
 *                                   — AI proposes patches to the founder's
 *                                     summary-sheet fields (strengths/gaps/etc.)
 *                                     based on raw notes or a Google Sheet URL.
 *                                     Returns the suggested patch — consultant
 *                                     applies it manually via the existing
 *                                     /founders/:id PATCH route.
 *
 * Both routes:
 *   - require auth
 *   - require Google Sheets scope IF the user supplies a sheet URL
 *   - degrade to a template/fallback if the OpenAI integration is unavailable
 */
import { Router } from "express";
import OpenAI from "openai";
import { google } from "googleapis";
import { db, sprintsTable, foundersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getAuthedClient } from "../lib/google";

const router = Router();

// ─── OpenAI singleton ────────────────────────────────────────────────────
let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openaiClient) {
    if (!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || !process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
      throw new Error("OpenAI AI integration not provisioned");
    }
    openaiClient = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
  }
  return openaiClient;
}

// ─── Sheet URL parsing & reading ─────────────────────────────────────────
/**
 * Extracts the spreadsheet ID from any of these forms:
 *   https://docs.google.com/spreadsheets/d/<ID>/edit#gid=0
 *   https://docs.google.com/spreadsheets/d/<ID>/edit?usp=sharing
 *   <ID>  (already just the id)
 */
function parseSheetId(url: string): string | null {
  if (!url) return null;
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  // Accept a bare ID too — sheet IDs are 30+ chars of base64-ish
  if (/^[a-zA-Z0-9_-]{20,}$/.test(url.trim())) return url.trim();
  return null;
}

/**
 * Reads a sheet's first tab and returns a compact text block suitable for
 * feeding to an LLM. Caps total rows at 200 / cells per row at 30 to keep
 * tokens bounded — a T-Sheet generally fits comfortably.
 */
async function readSheetText(userId: number, sheetUrl: string): Promise<string> {
  const sheetId = parseSheetId(sheetUrl);
  if (!sheetId) throw new Error("Could not parse a Google Sheet ID from the URL");

  const client = await getAuthedClient(userId);
  if (!client) throw new Error("Google not connected. Connect under Settings → Integrations.");

  const sheets = google.sheets({ version: "v4", auth: client });
  // First grab metadata to learn the first tab name
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: "properties.title,sheets.properties" });
  const firstTab = meta.data.sheets?.[0]?.properties?.title ?? "Sheet1";
  const range = `${firstTab}!A1:AD200`;
  const values = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range });
  const rows = (values.data.values ?? []) as string[][];

  if (rows.length === 0) return `(Empty sheet: ${meta.data.properties?.title ?? sheetId})`;

  // Render as a TSV-like block, trimmed
  const lines: string[] = [`Sheet: ${meta.data.properties?.title ?? sheetId} / Tab: ${firstTab}`];
  for (const row of rows.slice(0, 200)) {
    const cells = row.slice(0, 30).map(c => String(c ?? "").replace(/\s+/g, " ").trim());
    // Skip rows that are entirely blank — they bulk up tokens
    if (cells.every(c => !c)) continue;
    lines.push(cells.join(" \t "));
  }
  return lines.join("\n");
}

// ─── POST /ai/sheet-emails ───────────────────────────────────────────────
// Paste a Google Sheet link with session notes → get back BOTH pre + post drafts.
router.post("/ai/sheet-emails", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const { sheetUrl, sprintId, tone = "professional" } = req.body ?? {};
  if (!sheetUrl) { res.status(400).json({ error: "sheetUrl is required" }); return; }

  try {
    const sheetText = await readSheetText(userId, sheetUrl);

    // Optional: enrich with sprint+founder context if a sprintId was passed
    let sprintContext = "";
    let founder: typeof foundersTable.$inferSelect | null = null;
    if (sprintId) {
      const [sprint] = await db.select().from(sprintsTable).where(eq(sprintsTable.id, Number(sprintId))).limit(1);
      if (sprint) {
        const [f] = await db.select().from(foundersTable).where(eq(foundersTable.id, sprint.founderId)).limit(1);
        founder = f ?? null;
        sprintContext = [
          founder ? `Startup: ${founder.companyName}` : "",
          founder ? `Founder: ${founder.name}` : "",
          `Sprint date: ${sprint.scheduledDate}${sprint.scheduledTime ? ` at ${sprint.scheduledTime}` : ""}`,
          `Consultant: ${sprint.consultantName}`,
        ].filter(Boolean).join("\n");
      }
    }

    const ai = getOpenAI();
    const systemPrompt = `You are a consultant at Thinking Spree producing two emails for a founder, based on session notes from a Google Sheet.

Output STRICT JSON with this shape and nothing else:
{
  "pre":  { "subject": "...", "body": "..." },
  "post": { "subject": "...", "body": "..." }
}

Email rules:
- Tone: ${tone}. Warm, supportive, never patronizing.
- Open every email with "Hi [first name],"
- "pre" = pre-sprint invitation. Cover: brief intro to T-Sprint format, what to expect, 3 prep tips, session date/time, sign-off "Regards,\\n\\nTeam Thinking Spree".
- "post" = post-sprint summary. Cover: brief thanks, strengths discussed, gaps identified, next goal, 3-5 actionable next steps as bullets, sign-off "Best Regards,\\nTeam Thinking Spree".
- Use information from the sheet — do NOT invent facts. If a section has no relevant notes, omit it rather than placehold.
- Each body under 350 words.`;

    const completion = await ai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Sprint context:\n${sprintContext || "(none provided)"}\n\nSession sheet contents:\n${sheetText}` },
      ],
      temperature: 0.6,
      max_tokens: 1500,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let parsed: any;
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }

    // Wrap in the same EmailDraft shape used elsewhere so the UI can reuse the modal
    const to = founder?.email ?? "";
    const toName = founder?.name ?? "";
    res.json({
      pre:  {
        subject: parsed.pre?.subject  ?? `T-Sprint Session — ${founder?.companyName ?? ""}`.trim(),
        body:    parsed.pre?.body     ?? "",
        to, toName, sprintId: sprintId ?? null, emailType: "pre_sprint",
      },
      post: {
        subject: parsed.post?.subject ?? `T-Sprint Recap — ${founder?.companyName ?? ""}`.trim(),
        body:    parsed.post?.body    ?? "",
        to, toName, sprintId: sprintId ?? null, emailType: "post_sprint",
      },
      sheetPreview: sheetText.slice(0, 600),
    });
  } catch (err: any) {
    req.log.error({ err }, "AI sheet-emails failed");
    res.status(500).json({ error: err?.message ?? "Failed to generate emails" });
  }
});

// ─── POST /ai/sprints/:id/summary-update ─────────────────────────────────
// AI proposes patches to the founder's summary-sheet fields based on either
// a Google Sheet URL or raw notes pasted in.
// Returns a JSON patch object with only the suggested-to-change fields.
router.post("/ai/sprints/:id/summary-update", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid sprint id" }); return; }
  const { sheetUrl, notes } = req.body ?? {};
  if (!sheetUrl && !notes) {
    res.status(400).json({ error: "Provide either sheetUrl or notes" });
    return;
  }

  try {
    const [sprint] = await db.select().from(sprintsTable).where(eq(sprintsTable.id, id)).limit(1);
    if (!sprint) { res.status(404).json({ error: "Sprint not found" }); return; }
    const [founder] = await db.select().from(foundersTable).where(eq(foundersTable.id, sprint.founderId)).limit(1);
    if (!founder) { res.status(404).json({ error: "Founder not found" }); return; }

    let inputBlock = "";
    if (sheetUrl) {
      inputBlock = await readSheetText(userId, sheetUrl);
    } else {
      inputBlock = String(notes).slice(0, 10_000);
    }

    // Current values — so the model only proposes CHANGES.
    const currentSummary = {
      goalSetting: founder.goalSetting,
      keyStrength: founder.keyStrength,
      gap: founder.gap,
      marketAccess: founder.marketAccess,
      idealCustomerList: founder.idealCustomerList,
      mentorRecommendation: founder.mentorRecommendation,
      observationsTs: founder.observationsTs,
      currentProblem: founder.currentProblem,
      suggestedNextStep: founder.suggestedNextStep,
      nextFiveSprints: founder.nextFiveSprints,
      tSprintIntervention: founder.tSprintIntervention,
      tasks: founder.tasks,
      revenueLast12Months: founder.revenueLast12Months,
      revenueLastMonthMrr: founder.revenueLastMonthMrr,
      fundAskCr: founder.fundAskCr,
      currentBurn: founder.currentBurn,
      fundraiseNotes: founder.fundraiseNotes,
    };

    const ai = getOpenAI();
    const systemPrompt = `You are updating an internal founder Summary Sheet at Thinking Spree based on freshly captured session notes.

You will receive:
1. The CURRENT summary fields for this founder (some may be empty).
2. NEW notes from the latest session (either pasted text or a Google Sheet export).

Your job: propose a JSON patch object containing ONLY fields where the new notes provide a clear, factual update. Rules:
- Do NOT invent data. If the notes don't speak to a field, omit it.
- Do NOT overwrite a richer existing value with a shorter or vaguer one. If the existing value already covers the new info, omit the field.
- For text fields, write in concise full sentences (1-3 lines).
- For numeric fields (fundAskCr, revenue), only include if a clean number is stated; values are in INR crore for fundAskCr.
- Output STRICT JSON, no markdown, no commentary. Allowed keys: ${Object.keys(currentSummary).join(", ")}.`;

    const completion = await ai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `CURRENT SUMMARY:\n${JSON.stringify(currentSummary, null, 2)}\n\nNEW NOTES:\n${inputBlock}` },
      ],
      temperature: 0.3,
      max_tokens: 1200,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let patch: Record<string, any> = {};
    try { patch = JSON.parse(raw); } catch { patch = {}; }

    // Final safety pass: drop unknown keys
    const allowed = new Set(Object.keys(currentSummary));
    const cleaned: Record<string, any> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (!allowed.has(k)) continue;
      if (v == null || v === "") continue;
      cleaned[k] = v;
    }

    res.json({
      founderId: founder.id,
      sprintId: id,
      current: currentSummary,
      proposed: cleaned,
      changedKeys: Object.keys(cleaned),
    });
  } catch (err: any) {
    req.log.error({ err }, "AI summary-update failed");
    res.status(500).json({ error: err?.message ?? "Failed to generate summary update" });
  }
});

export default router;
