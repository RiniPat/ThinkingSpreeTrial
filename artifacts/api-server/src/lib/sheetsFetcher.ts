/**
 * Fetches a Google Sheet by URL and feeds it into the existing
 * Sprint Template parser.
 *
 * v4.6: now extracts hyperlinks. When a cell uses `=HYPERLINK(url, label)`,
 * the values API with FORMATTED_VALUE only returns the label string — the
 * URL is dropped. We make a second cheap batchGet with valueRenderOption:
 * FORMULA, which returns the raw `=HYPERLINK("...", "...")` formula text,
 * then merge: if a cell's formula is a HYPERLINK, replace its display
 * value with the URL inside it.
 *
 * Net result: a cell that displays "Pitch Deck" but links to
 * https://drive.google.com/... now gets parsed as the actual URL.
 */

import { google } from "googleapis";
import XLSX from "xlsx";
import { getAuthedClient } from "./google";

export function extractSheetId(input: string): string | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  if (/^[A-Za-z0-9_-]{20,80}$/.test(s)) return s;
  const m = s.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

const MAX_RANGE = "A1:Z200";

/**
 * If `formula` is `=HYPERLINK("https://...", "Label")`, return the URL.
 * Otherwise return null. Handles single & double quotes and the rare
 * "URL only" form `=HYPERLINK("...")`.
 */
function extractHyperlinkUrl(formula: string | null | undefined): string | null {
  if (!formula || typeof formula !== "string") return null;
  // case-insensitive; \s* tolerates whitespace inside
  const m = formula.match(/^\s*=\s*HYPERLINK\s*\(\s*["']([^"']+)["']/i);
  return m ? m[1] : null;
}

export async function fetchSheetAsWorkbook(
  userId: number,
  sheetUrlOrId: string,
): Promise<XLSX.WorkBook> {
  const id = extractSheetId(sheetUrlOrId);
  if (!id) {
    throw new Error(
      "That doesn't look like a Google Sheets URL. Paste the full URL or just the spreadsheet ID.",
    );
  }

  const client = await getAuthedClient(userId);
  if (!client) {
    throw new Error(
      "Google isn't connected for this account. Open Settings → Google Connections and connect Sheets access.",
    );
  }

  const sheets = google.sheets({ version: "v4", auth: client });

  // ── Step 1: get tab titles only ─────────────────────────────────────
  let titles: string[];
  try {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: id,
      fields: "sheets.properties.title",
    });
    titles = (meta.data.sheets ?? [])
      .map((s) => s.properties?.title)
      .filter((t): t is string => Boolean(t));
  } catch (err: any) {
    const code = err?.response?.status ?? err?.code;
    if (code === 404) throw new Error("Sheet not found. Check the URL or that the sheet is shared with your Google account (Viewer is enough).");
    if (code === 403) throw new Error("Access denied. Either share the sheet with your Google account (Viewer is enough) or set link sharing to 'Anyone with the link'.");
    if (code === 401) throw new Error("Google authorization expired. Sign out and sign in again with Google to refresh your tokens.");
    throw new Error(err?.message || "Failed to fetch the Google Sheet.");
  }

  if (titles.length === 0) throw new Error("The sheet appears to be empty (no tabs).");

  const ranges = titles.map((t) => `'${t.replace(/'/g, "''")}'!${MAX_RANGE}`);

  // ── Step 2: two parallel batchGets ──────────────────────────────────
  // - displayBatch  → what the user sees in each cell (e.g. "Pitch Deck")
  // - formulaBatch  → the raw formula (e.g. =HYPERLINK("https://...", "Pitch Deck"))
  //
  // Both are tiny — capped at A1:Z200 — so total memory stays well under
  // 50 KB. The cost of two calls is one extra HTTP round trip (~200 ms).
  let displayPerSheet: string[][][];
  let formulaPerSheet: string[][][];
  try {
    const [displayBatch, formulaBatch] = await Promise.all([
      sheets.spreadsheets.values.batchGet({
        spreadsheetId: id,
        ranges,
        valueRenderOption: "FORMATTED_VALUE",
      }),
      sheets.spreadsheets.values.batchGet({
        spreadsheetId: id,
        ranges,
        valueRenderOption: "FORMULA",
      }),
    ]);
    displayPerSheet = (displayBatch.data.valueRanges ?? []).map(
      (vr) => (vr.values as string[][] | undefined) ?? [],
    );
    formulaPerSheet = (formulaBatch.data.valueRanges ?? []).map(
      (vr) => (vr.values as string[][] | undefined) ?? [],
    );
  } catch (err: any) {
    const code = err?.response?.status ?? err?.code;
    if (code === 403) throw new Error("Access denied while reading sheet data. Share the sheet with your Google account, or set link sharing to 'Anyone with the link'.");
    throw new Error(err?.message || "Failed to read sheet data.");
  }

  // ── Step 3: merge display + formula, replacing HYPERLINK labels with URLs
  //
  // For every cell, if its formula is =HYPERLINK("url", "label"), we
  // override the display value with the URL. The parser is label-based,
  // so the Overview row "Attachment of their Deck/Information about them"
  // → looks at the cell to the right → sees the URL → stores it as deckUrl.
  // Other cells (plain values, normal formulas) are passed through unchanged.
  const wb = XLSX.utils.book_new();
  for (let i = 0; i < titles.length; i++) {
    const title = titles[i];
    const displayRows = displayPerSheet[i] ?? [];
    const formulaRows = formulaPerSheet[i] ?? [];

    const merged: (string | number | null)[][] = displayRows.map((row, r) =>
      row.map((cell, c) => {
        const formula = formulaRows[r]?.[c];
        const url = extractHyperlinkUrl(formula);
        return url ?? cell;
      })
    );

    const ws = XLSX.utils.aoa_to_sheet(merged.length > 0 ? merged : [[""]]);
    XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31));
  }

  return wb;
}
