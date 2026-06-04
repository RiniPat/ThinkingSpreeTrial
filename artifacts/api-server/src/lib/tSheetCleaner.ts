/**
 * T-Sheet Cleaner.
 *
 * Powers the "Clean the Sheet" button on the Company page. After a sprint, the
 * consultant pastes the Fathom transcript; Gemini reads it and we write the
 * organised output straight into the company's live Google Sheet:
 *
 *   • Most content lands in the "Actions taken so far" column of the
 *     "Models and priority" tab, APPENDED under the matching "Ideas/ Products"
 *     row as concise 3–4 word phrases. We never delete existing text.
 *   • Audience rows are appended to the Target Audience tab's table.
 *   • Anything important the transcript did NOT cover becomes a suggestion
 *     written BELOW the pink separator row on the "Models and priority" tab.
 *
 * Formatting matches the finished T-Sheets: Arial, the dark-blue header
 * (#073763, white bold), the pink separator (#F4CCCC), wrapped top-left cells.
 *
 * The OAuth scope group `sheets` already grants read+write
 * (https://www.googleapis.com/auth/spreadsheets), so no new consent is needed.
 */
import { google, type sheets_v4 } from "googleapis";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getAuthedClient } from "./google";
import { extractSheetId } from "./sheetsFetcher";

const MODELS_TAB = "Models and priority";
const FONT = "Arial";

// Template colours (0–1 normalised RGB, as the Sheets API expects).
const HEADER_BLUE = rgb(0x07, 0x37, 0x63);
const PINK = rgb(0xf4, 0xcc, 0xcc);

function rgb(r: number, g: number, b: number) {
  return { red: r / 255, green: g / 255, blue: b / 255 };
}

function colLetter(idx0: number): string {
  // 0-based column index → A1 letter.
  let n = idx0 + 1, s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/** True if a Sheets backgroundColor is close to the pink separator colour. */
function isPink(c?: sheets_v4.Schema$Color | null): boolean {
  if (!c) return false;
  const r = c.red ?? 0, g = c.green ?? 0, b = c.blue ?? 0;
  return r > 0.9 && g > 0.7 && g < 0.92 && b > 0.7 && b < 0.92 && Math.abs(g - b) < 0.06;
}

function norm(s: string): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// ─── Layout discovery ───────────────────────────────────────────────────────
type ColMap = {
  ideas?: number; core?: number; actions?: number;
  useCase?: number; target?: number; priority?: number; tasks?: number;
};
export type IdeaRow = { row: number; label: string; idea: string; actions: string };
export type ModelsLayout = {
  sheetId: number;
  headerRow: number;        // 0-based grid row of the header
  pinkRow: number | null;   // 0-based grid row of the pink separator, if any
  cols: ColMap;
  ideas: IdeaRow[];
  lastContentRow: number;   // 0-based last row that holds anything (for fallback placement)
};

function mapHeaderColumns(headerCells: sheets_v4.Schema$CellData[]): ColMap {
  const cols: ColMap = {};
  headerCells.forEach((cell, i) => {
    const t = norm(cell?.formattedValue ?? "");
    if (!t) return;
    if (cols.ideas === undefined && /\bidea|product/.test(t)) cols.ideas = i;
    else if (cols.core === undefined && /core|by product|pivot|focus/.test(t)) cols.core = i;
    else if (cols.actions === undefined && /action/.test(t)) cols.actions = i;
    else if (cols.useCase === undefined && /use case/.test(t)) cols.useCase = i;
    else if (cols.target === undefined && /target|audience/.test(t)) cols.target = i;
    else if (cols.priority === undefined && /priorit|score/.test(t)) cols.priority = i;
    else if (cols.tasks === undefined && /task|recommend/.test(t)) cols.tasks = i;
  });
  return cols;
}

/**
 * Read the "Models and priority" tab WITH formatting so we can locate the
 * header row, the "Actions taken so far" column, every idea row, and the pink
 * separator. We only pull A1:Z60 — the active region is tiny.
 */
async function readModelsLayout(
  sheets: sheets_v4.Sheets, spreadsheetId: string,
): Promise<ModelsLayout> {
  const resp = await sheets.spreadsheets.get({
    spreadsheetId,
    ranges: [`'${MODELS_TAB.replace(/'/g, "''")}'!A1:Z60`],
    includeGridData: true,
    fields: "sheets(properties(sheetId,title),data(rowData(values(formattedValue,effectiveFormat(backgroundColor)))))",
  });
  const sheet = resp.data.sheets?.[0];
  if (!sheet) throw new Error(`The sheet has no "${MODELS_TAB}" tab. Open the company's Google Sheet and confirm the tab name.`);
  const sheetId = sheet.properties?.sheetId ?? 0;
  const rows = sheet.data?.[0]?.rowData ?? [];

  // Header row = first row whose cells include an "Ideas/Products" header.
  let headerRow = -1;
  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r]?.values ?? [];
    if (cells.some(c => /\bidea|product/.test(norm(c?.formattedValue ?? "")))
        && cells.some(c => /action/.test(norm(c?.formattedValue ?? "")))) { headerRow = r; break; }
  }
  if (headerRow < 0) headerRow = 0;
  const cols = mapHeaderColumns(rows[headerRow]?.values ?? []);
  if (cols.actions === undefined) {
    throw new Error(`Could not find the "Actions taken so far" column on the "${MODELS_TAB}" tab.`);
  }
  if (cols.ideas === undefined) cols.ideas = Math.max(0, cols.actions - 1);

  // Pink separator = first row at/after the header whose cells are pink.
  let pinkRow: number | null = null;
  for (let r = headerRow + 1; r < rows.length; r++) {
    const cells = rows[r]?.values ?? [];
    const pinkCount = cells.filter(c => isPink(c?.effectiveFormat?.backgroundColor)).length;
    if (pinkCount >= 3) { pinkRow = r; break; }
  }

  // Idea rows = rows between header and pink line that have an Ideas/Products value.
  const limit = pinkRow ?? rows.length;
  const ideas: IdeaRow[] = [];
  let lastContentRow = headerRow;
  for (let r = headerRow + 1; r < limit; r++) {
    const cells = rows[r]?.values ?? [];
    if (cells.some(c => (c?.formattedValue ?? "").trim() !== "")) lastContentRow = r;
    const idea = (cells[cols.ideas!]?.formattedValue ?? "").trim();
    if (idea) {
      ideas.push({
        row: r,
        label: (cells[0]?.formattedValue ?? "").trim(),
        idea,
        actions: (cells[cols.actions!]?.formattedValue ?? "").trim(),
      });
    }
  }
  return { sheetId, headerRow, pinkRow, cols, ideas, lastContentRow };
}

// ─── Target Audience tab discovery ──────────────────────────────────────────
type TargetLayout = {
  title: string; sheetId: number;
  headerRow: number;            // 0-based grid row of the table header
  firstCol: number;             // column index where the table starts (Target Audience)
  lastDataRow: number;          // 0-based last data row of the table
};

async function readTargetLayout(
  sheets: sheets_v4.Sheets, spreadsheetId: string, allTitles: string[],
): Promise<TargetLayout | null> {
  // Pick the audience tab by name (varies: "Target Audience", "Target Group",
  // "TG Usecase Prioritisation").
  const title = allTitles.find(t => {
    const n = norm(t);
    return n.includes("target audience") || n.includes("target group")
      || n.startsWith("tg ") || n.includes("audience");
  });
  if (!title) return null;

  const resp = await sheets.spreadsheets.get({
    spreadsheetId,
    ranges: [`'${title.replace(/'/g, "''")}'!A1:Z80`],
    includeGridData: true,
    fields: "sheets(properties(sheetId,title),data(rowData(values(formattedValue))))",
  });
  const sheet = resp.data.sheets?.[0];
  if (!sheet) return null;
  const sheetId = sheet.properties?.sheetId ?? 0;
  const rows = sheet.data?.[0]?.rowData ?? [];

  // Table header = a row containing "Target Audience" AND "Use Cases".
  let headerRow = -1, firstCol = 0;
  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r]?.values ?? [];
    const tIdx = cells.findIndex(c => /target|audience/.test(norm(c?.formattedValue ?? "")));
    const hasUse = cells.some(c => /use case/.test(norm(c?.formattedValue ?? "")));
    if (tIdx >= 0 && hasUse) { headerRow = r; firstCol = tIdx; break; }
  }
  if (headerRow < 0) return { title, sheetId, headerRow: -1, firstCol: 0, lastDataRow: rows.length };

  let lastDataRow = headerRow;
  for (let r = headerRow + 1; r < rows.length; r++) {
    const cells = rows[r]?.values ?? [];
    if ((cells[firstCol]?.formattedValue ?? "").trim() !== "") lastDataRow = r;
  }
  return { title, sheetId, headerRow, firstCol, lastDataRow };
}

// ─── AI extraction ──────────────────────────────────────────────────────────
export type CleanResult = {
  actions: { idea: string; additions: string[] }[];
  targetAudience: { audience: string; useCases: string; channels: string; recommendations: string }[];
  suggestions: string[];
};

function getModel(temperature: number) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured on the server.");
  const genai = new GoogleGenerativeAI(apiKey);
  return genai.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { temperature, responseMimeType: "application/json" },
  });
}

export async function extractFromTranscript(opts: {
  companyName: string;
  transcript: string;
  ideas: IdeaRow[];
}): Promise<CleanResult> {
  const { companyName, transcript, ideas } = opts;
  const ideaList = ideas.length
    ? ideas.map((i, n) => `${n + 1}. "${i.idea}"${i.actions ? ` (already has notes)` : ""}`).join("\n")
    : "(none yet — the sheet has no idea rows; use \"General\")";

  const prompt = `You are a Thinking Spree consultant CLEANING a startup's T-Sheet after a sprint, using the session (Fathom) transcript. Startup: ${companyName}.

The "Models and priority" tab lists these Ideas/Products (the "Actions taken so far" column sits beside each):
${ideaList}

Your job:
1) For each idea, pull what the transcript says was DONE / learned / the current state, as CONCISE 3-4 WORD PHRASES (telegraphic, not sentences). Map each phrase to the idea it belongs to using the EXACT idea name from the list. Content that fits no specific idea goes under "General".
2) Extract TARGET AUDIENCE entries discussed: who the customer is, their use case, the channels to reach them, and any recommendation. Short phrases only.
3) List SUGGESTIONS: important T-Sheet information that the transcript did NOT cover and the consultant should still fill in (e.g. "Pricing per consult not stated", "Team size unclear"). Short prompts.

Rules:
- Use ONLY information present in the transcript. Never invent facts. If something is absent, leave it out (and, if important, raise it under suggestions instead).
- Phrases must be 3-4 words where possible, plain text, no markdown, no trailing punctuation.
- Match idea names verbatim to the list above; otherwise use "General".

Return STRICT JSON, nothing else:
{
  "actions": [ { "idea": "<exact idea name or General>", "additions": ["short phrase", "..."] } ],
  "targetAudience": [ { "audience": "...", "useCases": "...", "channels": "...", "recommendations": "..." } ],
  "suggestions": ["...", "..."]
}

TRANSCRIPT:
${transcript.slice(0, 28000)}`;

  const m = getModel(0.25);
  const result = await m.generateContent(prompt);
  const text = result.response.text();
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  let parsed: any;
  try { parsed = JSON.parse(cleaned); }
  catch { throw new Error(`The AI returned malformed output. First 300 chars: ${cleaned.slice(0, 300)}`); }

  const actions = Array.isArray(parsed?.actions) ? parsed.actions
    .map((a: any) => ({
      idea: String(a?.idea ?? "General").trim() || "General",
      additions: (Array.isArray(a?.additions) ? a.additions : [])
        .map((s: any) => String(s ?? "").trim()).filter(Boolean),
    }))
    .filter((a: any) => a.additions.length) : [];
  const targetAudience = Array.isArray(parsed?.targetAudience) ? parsed.targetAudience
    .map((t: any) => ({
      audience: String(t?.audience ?? "").trim(),
      useCases: String(t?.useCases ?? "").trim(),
      channels: String(t?.channels ?? "").trim(),
      recommendations: String(t?.recommendations ?? "").trim(),
    }))
    .filter((t: any) => t.audience) : [];
  const suggestions = Array.isArray(parsed?.suggestions)
    ? parsed.suggestions.map((s: any) => String(s ?? "").trim()).filter(Boolean) : [];

  return { actions, targetAudience, suggestions };
}

// ─── Matching AI ideas → sheet rows ─────────────────────────────────────────
function matchIdeaRow(name: string, ideas: IdeaRow[]): IdeaRow | null {
  if (!ideas.length) return null;
  const n = norm(name);
  if (!n || n === "general") {
    // "General" → a Background/Overview row if present, else the first idea.
    return ideas.find(i => /background|overview/.test(norm(i.idea))) ?? ideas[0];
  }
  let best: IdeaRow | null = null, bestScore = 0;
  for (const i of ideas) {
    const ni = norm(i.idea);
    let score = 0;
    if (ni === n) score = 100;
    else if (ni.includes(n) || n.includes(ni)) score = 60;
    else {
      const a = new Set(n.split(" ")), b = new Set(ni.split(" "));
      score = [...a].filter(w => w.length > 2 && b.has(w)).length * 15;
    }
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return bestScore >= 15 ? best : ideas[0];
}

// ─── The end-to-end clean ───────────────────────────────────────────────────
export type ActionBlock = { idea: string; row: number; block: string };
export type CleanReport = {
  spreadsheetId: string;
  /** Whether the cleaned output was successfully written into the Google Sheet.
   *  false → the consultant lacks edit access (or the write failed); the output
   *  is returned for the dashboard fallback instead. */
  wrote: boolean;
  writeError: string | null;
  actionsWritten: number;     // ideas that received new notes (planned)
  ideasTouched: string[];
  audienceRowsAdded: number;  // audience rows (planned)
  suggestionsAdded: number;   // suggestions (planned)
  /** Exact text blocks composed per idea — used by the dashboard fallback so the
   *  consultant can copy them straight into the sheet's Actions column. */
  actionBlocks: ActionBlock[];
  targetTabFound: boolean;
  unmatched: { idea: string; additions: string[] }[];
  extracted: CleanResult;
};

export async function cleanSheet(opts: {
  userId: number;
  companyName: string;
  sheetUrlOrId: string;
  transcript: string;
}): Promise<CleanReport> {
  const spreadsheetId = extractSheetId(opts.sheetUrlOrId);
  if (!spreadsheetId) throw new Error("No linked Google Sheet found for this company. Add the sheet URL on the company, then try again.");

  const client = await getAuthedClient(opts.userId);
  if (!client) throw new Error("Google isn't connected. Open Settings → Google Connections and connect Sheets access.");
  const sheets = google.sheets({ version: "v4", auth: client });

  // Discover layout of both tabs.
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
  const titles = (meta.data.sheets ?? []).map(s => s.properties?.title).filter((t): t is string => !!t);
  const layout = await readModelsLayout(sheets, spreadsheetId);
  const target = await readTargetLayout(sheets, spreadsheetId, titles);

  // AI pass.
  const extracted = await extractFromTranscript({
    companyName: opts.companyName, transcript: opts.transcript, ideas: layout.ideas,
  });

  // 1) Append concise phrases into each idea's "Actions taken so far" cell.
  //    Value-only writes preserve the cell's existing format. We never delete.
  const valueData: sheets_v4.Schema$ValueRange[] = [];
  const ideasTouched: string[] = [];
  const unmatched: { idea: string; additions: string[] }[] = [];
  const stamp = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const actCol = colLetter(layout.cols.actions!);

  // Merge additions that resolve to the same row, and compose the exact text
  // block we'll append (also returned for the dashboard fallback).
  const byRow = new Map<number, { idea: IdeaRow; phrases: string[] }>();
  for (const a of extracted.actions) {
    const row = matchIdeaRow(a.idea, layout.ideas);
    if (!row) { unmatched.push(a); continue; }
    const entry = byRow.get(row.row) ?? { idea: row, phrases: [] };
    entry.phrases.push(...a.additions);
    byRow.set(row.row, entry);
  }
  const actionBlocks: ActionBlock[] = [];
  for (const { idea, phrases } of byRow.values()) {
    const block = `Action Taken (Sprint ${stamp})\n` + phrases.map(p => `- ${p}`).join("\n");
    const merged = idea.actions ? `${idea.actions}\n\n${block}` : block;
    valueData.push({ range: `'${MODELS_TAB}'!${actCol}${idea.row + 1}`, values: [[merged]] });
    ideasTouched.push(idea.idea);
    actionBlocks.push({ idea: idea.idea, row: idea.row + 1, block });
  }

  const targetTabFound = !!(target && target.headerRow >= 0);

  // ── Attempt all sheet writes. If the consultant can't edit the sheet (403)
  //    or any write fails, we DON'T throw — we return wrote=false plus the full
  //    cleaned output so the company dashboard can show it as recommendations.
  let wrote = true;
  let writeError: string | null = null;
  try {
    // 1) Append concise phrases into each idea's "Actions taken so far" cell.
    //    Value-only writes preserve the cell's existing format. We never delete.
    if (valueData.length) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: "RAW", data: valueData },
      });
    }

    // 2) Append Target Audience rows to that tab's table.
    if (targetTabFound && extracted.targetAudience.length) {
      const startRow = target!.lastDataRow + 1; // 0-based grid row to write at
      const fc = target!.firstCol;
      const taValues = extracted.targetAudience.map(t => [t.audience, t.useCases, "", t.channels, t.recommendations]);
      const startA1 = `${colLetter(fc)}${startRow + 1}`;
      const endA1 = `${colLetter(fc + 4)}${startRow + taValues.length}`;
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${target!.title}'!${startA1}:${endA1}`,
        valueInputOption: "RAW",
        requestBody: { values: taValues },
      });
      // Light format pass so the new rows match: Arial, wrap, top-left.
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            repeatCell: {
              range: {
                sheetId: target!.sheetId,
                startRowIndex: startRow, endRowIndex: startRow + taValues.length,
                startColumnIndex: fc, endColumnIndex: fc + 5,
              },
              cell: { userEnteredFormat: {
                textFormat: { fontFamily: FONT },
                wrapStrategy: "WRAP", verticalAlignment: "TOP", horizontalAlignment: "LEFT",
              } },
              fields: "userEnteredFormat(textFormat.fontFamily,wrapStrategy,verticalAlignment,horizontalAlignment)",
            },
          }],
        },
      });
    }

    // 3) Suggestions below the pink line on the Models tab.
    if (extracted.suggestions.length) {
      // Anchor: row after the pink line; if no pink line, two rows below content.
      const anchor = (layout.pinkRow ?? layout.lastContentRow + 1) + 1; // 0-based
      const ideasCol = layout.cols.ideas ?? 0;
      const headerText = `AI Suggestions — confirm & fill (Sprint ${stamp})`;
      const reqs: sheets_v4.Schema$Request[] = [];

      // Header cell (bold).
      reqs.push({
        updateCells: {
          rows: [{ values: [{
            userEnteredValue: { stringValue: headerText },
            userEnteredFormat: {
              textFormat: { fontFamily: FONT, bold: true },
              wrapStrategy: "WRAP", verticalAlignment: "TOP",
            },
          }] }],
          fields: "userEnteredValue,userEnteredFormat(textFormat,wrapStrategy,verticalAlignment)",
          start: { sheetId: layout.sheetId, rowIndex: anchor, columnIndex: ideasCol },
        },
      });
      // One suggestion per row in the (wide) Actions column.
      extracted.suggestions.forEach((s, i) => {
        reqs.push({
          updateCells: {
            rows: [{ values: [{
              userEnteredValue: { stringValue: `- ${s}` },
              userEnteredFormat: {
                textFormat: { fontFamily: FONT },
                wrapStrategy: "WRAP", verticalAlignment: "TOP", horizontalAlignment: "LEFT",
              },
            }] }],
            fields: "userEnteredValue,userEnteredFormat(textFormat,wrapStrategy,verticalAlignment,horizontalAlignment)",
            start: { sheetId: layout.sheetId, rowIndex: anchor + 1 + i, columnIndex: layout.cols.actions! },
          },
        });
      });
      await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: reqs } });
    }
  } catch (err: any) {
    // Most common: 403 (the linked Google account has view-only access). We
    // degrade gracefully — the route persists `extracted` to the dashboard.
    wrote = false;
    const code = err?.response?.status ?? err?.code;
    const detail = err?.errors?.[0]?.message ?? err?.message ?? "Unknown error";
    writeError = code === 403
      ? "Can't edit this Google Sheet — the connected Google account only has view access. Recommendations saved to the dashboard instead. (Give the account Editor access, then re-run to write directly.)"
      : `Couldn't write to the Google Sheet (${detail}). Recommendations saved to the dashboard instead.`;
  }

  return {
    spreadsheetId,
    wrote,
    writeError,
    actionsWritten: byRow.size,
    ideasTouched,
    audienceRowsAdded: extracted.targetAudience.length,
    suggestionsAdded: extracted.suggestions.length,
    actionBlocks,
    targetTabFound,
    unmatched,
    extracted,
  };
}
