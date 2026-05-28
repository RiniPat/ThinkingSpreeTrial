/**
 * Fetches a Google Sheet by URL and feeds it into the existing
 * Sprint Template parser.
 *
 * v4.5 rewrite: uses the lightweight Sheets `values` API instead of the
 * heavy `spreadsheets.get(includeGridData=true)` path. The grid-data path
 * returns full cell metadata (formatting, formulas, borders, ~3-5 KB per
 * cell) which can balloon a small-looking sheet into a 100+ MB JSON
 * response and OOM-crash a free-tier Node process.
 *
 * The values API returns only display strings — typically <1 KB per sheet
 * even for pages with hundreds of rows. We bound the fetch range to
 * A1:Z200 per sheet (well past the Sprint Template's actual data area)
 * so totals stay predictable regardless of how many empty rows the
 * source sheet contains.
 */

import { google } from "googleapis";
import XLSX from "xlsx";
import { getAuthedClient } from "./google";

/**
 * Extract the spreadsheet ID from any standard Google Sheets URL.
 * Accepts the full URL, the URL with #gid, or a bare ID.
 */
export function extractSheetId(input: string): string | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  if (/^[A-Za-z0-9_-]{20,80}$/.test(s)) return s;
  const m = s.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

// Bound the fetch to avoid OOM on free-tier hosts and protect against
// pre-formatted empty templates that report thousands of "rows".
// A1:Z200 is generous — every Sprint Template tab fits in well under
// 50 rows and 10 columns of real data.
const MAX_RANGE = "A1:Z200";

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

  // ── Step 1: tiny metadata-only call to get sheet titles ───────────────
  // No grid data — just the sheet titles. Returns ~1 KB regardless of
  // sheet size.
  let titles: string[];
  try {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: id,
      // fields= mask drops everything except sheet titles, so the response
      // is tiny even for a sheet with 50 tabs.
      fields: "sheets.properties.title",
    });
    titles = (meta.data.sheets ?? [])
      .map((s) => s.properties?.title)
      .filter((t): t is string => Boolean(t));
  } catch (err: any) {
    const code = err?.response?.status ?? err?.code;
    if (code === 404) {
      throw new Error(
        "Sheet not found. Check the URL or that the sheet is shared with your Google account (Viewer is enough).",
      );
    }
    if (code === 403) {
      throw new Error(
        "Access denied. Either share the sheet with your Google account (Viewer is enough) or set link sharing to 'Anyone with the link'.",
      );
    }
    if (code === 401) {
      throw new Error(
        "Google authorization expired. Sign out and sign in again with Google to refresh your tokens.",
      );
    }
    throw new Error(err?.message || "Failed to fetch the Google Sheet.");
  }

  if (titles.length === 0) {
    throw new Error("The sheet appears to be empty (no tabs).");
  }

  // ── Step 2: batch fetch values for all tabs in one call ───────────────
  // values.batchGet returns only display strings, no formatting metadata.
  // We cap each range at A1:Z200. Even if the source sheet has 10,000
  // rows of empty pre-formatted cells, we only see the first 200 — which
  // is well past where Sprint Template data lives.
  const ranges = titles.map((t) => `'${t.replace(/'/g, "''")}'!${MAX_RANGE}`);

  let valuesPerSheet: (string[] | undefined)[][];
  try {
    const batch = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: id,
      ranges,
      // FORMATTED_VALUE = what you'd see in the cell (e.g. "₹50,00,000")
      valueRenderOption: "FORMATTED_VALUE",
      // dateTimeRenderOption defaults to SERIAL_NUMBER but with
      // FORMATTED_VALUE it gets ignored anyway.
    });
    valuesPerSheet = (batch.data.valueRanges ?? []).map(
      (vr) => (vr.values as string[][] | undefined) ?? [],
    );
  } catch (err: any) {
    const code = err?.response?.status ?? err?.code;
    if (code === 403) {
      throw new Error(
        "Access denied while reading sheet data. Share the sheet with your Google account, or set link sharing to 'Anyone with the link'.",
      );
    }
    throw new Error(err?.message || "Failed to read sheet data.");
  }

  // ── Step 3: build an XLSX workbook from the values ──────────────────
  // aoa_to_sheet just needs a 2D array. The values API gives us exactly
  // that. We never allocate large objects, so memory stays flat.
  const wb = XLSX.utils.book_new();
  for (let i = 0; i < titles.length; i++) {
    const title = titles[i];
    const rows = (valuesPerSheet[i] ?? []) as (string | number | null)[][];
    const ws = XLSX.utils.aoa_to_sheet(rows.length > 0 ? rows : [[""]]);
    // Sheet names in xlsx can't exceed 31 chars — same as Google's limit.
    XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31));
  }

  return wb;
}
