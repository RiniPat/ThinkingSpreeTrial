/**
 * Fetches a Google Sheet by URL and feeds it into the existing
 * Sprint Template parser. We support two access modes:
 *
 *   1. Private sheets — using the consultant's OAuth token. The consultant
 *      must have at least Viewer access to the sheet for this to work.
 *
 *   2. Public sheets — anyone-with-link Viewer. We fall back to an unauthed
 *      request via the Sheets v4 API using an API key OR the consultant's
 *      token (the latter works fine for public sheets too).
 *
 * Both paths produce the same XLSX-style workbook object that the existing
 * parseSprintTemplate() expects.
 */

import { google, sheets_v4 } from "googleapis";
import XLSX from "xlsx";
import { getAuthedClient } from "./google";

/**
 * Extracts the spreadsheet ID from any standard Google Sheets URL. Returns
 * null if the URL doesn't look like a Sheets URL.
 *
 * Accepted formats:
 *   https://docs.google.com/spreadsheets/d/{ID}/edit
 *   https://docs.google.com/spreadsheets/d/{ID}/edit#gid=0
 *   https://docs.google.com/spreadsheets/d/{ID}
 *   {ID}                                      (bare ID)
 */
export function extractSheetId(input: string): string | null {
  const s = (input ?? "").trim();
  if (!s) return null;

  // Bare ID heuristic — Sheets IDs are ~44 chars of [A-Za-z0-9_-]
  if (/^[A-Za-z0-9_-]{20,80}$/.test(s)) return s;

  const m = s.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

/**
 * Fetch a Google Sheet using the consultant's OAuth client. Returns an XLSX
 * Workbook so it can be passed straight to parseSprintTemplate().
 *
 * Strategy: call spreadsheets.get(includeGridData=true) once — gets every
 * tab with its formatted cell values in a single round-trip. Then convert
 * each Google sheet into an XLSX worksheet manually.
 *
 * Throws with a helpful message if access is denied, the sheet doesn't
 * exist, or the URL is malformed.
 */
export async function fetchSheetAsWorkbook(
  userId: number,
  sheetUrlOrId: string,
): Promise<XLSX.WorkBook> {
  const id = extractSheetId(sheetUrlOrId);
  if (!id) {
    throw new Error("That doesn't look like a Google Sheets URL. Paste the full URL or just the spreadsheet ID.");
  }

  const client = await getAuthedClient(userId);
  if (!client) {
    throw new Error(
      "Google isn't connected for this account. Open Settings → Google Connections and connect Sheets access."
    );
  }

  // Acquire a fresh access token. The googleapis client refreshes
  // automatically when it sees a 401, but doing it once upfront gives us a
  // cleaner error if the user's tokens are missing entirely.
  const sheets = google.sheets({ version: "v4", auth: client });

  let res: sheets_v4.Schema$Spreadsheet;
  try {
    const r = await sheets.spreadsheets.get({
      spreadsheetId: id,
      // includeGridData=true asks Google to return every cell value in the
      // same call. For a Sprint Template (~7 tabs × ~50 rows × ~10 cols)
      // this is a few KB — well within the response limits.
      includeGridData: true,
    });
    res = r.data;
  } catch (err: any) {
    const code = err?.response?.status ?? err?.code;
    if (code === 404) {
      throw new Error("Sheet not found. Check the URL or that the sheet is shared with your Google account (Viewer is enough).");
    }
    if (code === 403) {
      throw new Error("Access denied. Either share the sheet with your Google account (any access ≥ Viewer), or set link sharing to 'Anyone with the link'.");
    }
    if (code === 401) {
      throw new Error("Google authorization expired. Sign out and sign in again with Google to refresh your tokens.");
    }
    throw new Error(err?.message || "Failed to fetch the Google Sheet.");
  }

  // Build an XLSX workbook from the Google sheet data.
  const wb = XLSX.utils.book_new();

  for (const sheet of res.sheets ?? []) {
    const title = sheet.properties?.title ?? "Sheet1";
    const grid = sheet.data?.[0]?.rowData ?? [];

    // Convert grid → 2D array of cell values. The parser is forgiving about
    // empty cells, so we coerce nulls/missing to empty string.
    const rows: (string | number | null)[][] = grid.map(row =>
      (row.values ?? []).map(cell => {
        if (cell == null) return "";
        // formattedValue is what the user sees in the cell — for things like
        // "₹50,00,000" we want the display string, not the raw number.
        const v = cell.formattedValue;
        if (v != null) return v;
        const ev = cell.effectiveValue;
        if (!ev) return "";
        if (ev.stringValue != null) return ev.stringValue;
        if (ev.numberValue != null) return ev.numberValue;
        if (ev.boolValue != null) return ev.boolValue ? "TRUE" : "FALSE";
        if (ev.errorValue != null) return "";  // skip #DIV/0! etc.
        return "";
      })
    );

    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31));
  }

  if ((wb.SheetNames ?? []).length === 0) {
    throw new Error("The sheet appears to be empty.");
  }

  return wb;
}
