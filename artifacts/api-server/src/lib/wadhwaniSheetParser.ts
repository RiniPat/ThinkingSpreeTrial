/**
 * Wadhwani Summary T-Sheet parser.
 *
 * Reads structured fields from a startup's T-Sheet for the Wadhwani
 * Foundation summary sheet. Tabs we touch:
 *
 *   - Overview         → Startup Name, Founder, Host (T-Sprint Consultants
 *                        Assigned), Co-Host (cell right of Host)
 *   - SMART            → Goal (entire SMART definition as-is)
 *   - Sprint Tracking  → VP1 and VP2 dates (first & second row where the
 *                        company name appears in column A or B)
 *
 * Tolerant of layout drift: label-based lookups, case-insensitive, picks
 * the first cell to the right of the label. Empty fields return "" rather
 * than throwing — the UI lets the consultant edit before saving.
 */

import XLSX from "xlsx";
import { fetchSheetAsWorkbook } from "./sheetsFetcher";

export type WadhwaniSheetData = {
  startupName: string;
  founderName: string;
  host: string;
  coHost: string;
  goal: string;
  vp1Date: string;
  vp2Date: string;
};

const EMPTY: WadhwaniSheetData = {
  startupName: "", founderName: "", host: "", coHost: "",
  goal: "", vp1Date: "", vp2Date: "",
};

function cleanCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

/** Find the sheet whose name matches any of `candidates` (case-insensitive,
 *  partial match). Returns the actual sheet object or null. */
function findSheet(wb: XLSX.WorkBook, candidates: string[]): XLSX.WorkSheet | null {
  const cand = candidates.map(c => c.toLowerCase());
  const match = wb.SheetNames.find(n => {
    const ln = n.toLowerCase();
    return cand.some(c => ln === c || ln.includes(c));
  });
  return match ? wb.Sheets[match] : null;
}

function sheetToRows(ws: XLSX.WorkSheet | null): string[][] {
  if (!ws) return [];
  const json = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "" });
  return json.map(row => (row ?? []).map(cleanCell));
}

/** Find a row containing a label (case-insensitive contains) in any cell,
 *  return the value of the cell *immediately to the right* of the matched
 *  cell. Used for Overview-style "Label | Value" rows. */
function lookupRightOf(rows: string[][], label: string): string {
  const ln = label.toLowerCase();
  for (const row of rows) {
    for (let c = 0; c < row.length; c++) {
      const cell = (row[c] ?? "").toLowerCase();
      if (cell.includes(ln)) {
        // Return first non-empty cell to the right
        for (let d = c + 1; d < row.length; d++) {
          const v = cleanCell(row[d]);
          if (v) return v;
        }
        return "";
      }
    }
  }
  return "";
}

/** Like lookupRightOf, but also returns the column index of the matched
 *  cell so we can grab the cell two columns over (used for Co-Host =
 *  the cell to the right of Host). Returns null if no match. */
function lookupRightOfWithCol(rows: string[][], label: string): { value: string; col: number; row: number } | null {
  const ln = label.toLowerCase();
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      const cell = (row[c] ?? "").toLowerCase();
      if (cell.includes(ln)) {
        // Find first non-empty cell to the right and record its col
        for (let d = c + 1; d < row.length; d++) {
          const v = cleanCell(row[d]);
          if (v) return { value: v, col: d, row: r };
        }
        return { value: "", col: c + 1, row: r };
      }
    }
  }
  return null;
}

/** Concatenate the SMART tab into a single readable block. We don't parse
 *  the cells — the consultant wants the whole SMART definition verbatim
 *  to paste into the summary. */
function joinSmartTab(rows: string[][]): string {
  return rows
    .filter(row => row.some(c => c && c.trim().length > 0))
    .map(row => row.filter(c => c && c.trim().length > 0).join(" | "))
    .join("\n")
    .trim();
}

/** Find every row in Sprint Tracking where col A or B contains the
 *  startup name (case-insensitive). For each match, find the first cell
 *  in that row that looks like a date (heuristic). Returns the dates of
 *  the first two such rows. */
function findVpDates(rows: string[][], startupName: string): { vp1: string; vp2: string } {
  if (!startupName) return { vp1: "", vp2: "" };
  const needle = startupName.toLowerCase();
  // Match anything that looks date-y: 2-3 digit groups separated by /, -, or .
  // E.g. "5/12/26", "2026-05-01", "01.06.2026", "May 5, 2026", "5-May-26"
  const dateRe = /(\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{2,4})/;
  const hits: string[] = [];
  for (const row of rows) {
    const colA = (row[0] ?? "").toLowerCase();
    const colB = (row[1] ?? "").toLowerCase();
    if (!colA.includes(needle) && !colB.includes(needle)) continue;
    for (const cell of row) {
      const m = (cell ?? "").match(dateRe);
      if (m) { hits.push(m[0]); break; }
    }
    if (hits.length >= 2) break;
  }
  return { vp1: hits[0] ?? "", vp2: hits[1] ?? "" };
}

export async function parseWadhwaniSheet(input: {
  userId: number;
  sheetUrlOrId: string;
  /** Used to disambiguate rows in Sprint Tracking. Required for date lookup. */
  startupNameHint?: string;
}): Promise<WadhwaniSheetData> {
  const wb = await fetchSheetAsWorkbook(input.userId, input.sheetUrlOrId);

  const overview = findSheet(wb, ["overview"]);
  const smart = findSheet(wb, ["smart"]);
  const sprintTracking = findSheet(wb, ["sprint tracking", "sprint-tracking", "sprinttracking"]);

  const overviewRows = sheetToRows(overview);
  const smartRows = sheetToRows(smart);
  const sprintRows = sheetToRows(sprintTracking);

  // Startup name — Overview tab. Common labels: "Startup", "Startup Name",
  // "Company", "Venture Name". Try a few.
  const startupName =
    lookupRightOf(overviewRows, "startup name") ||
    lookupRightOf(overviewRows, "startup") ||
    lookupRightOf(overviewRows, "company name") ||
    lookupRightOf(overviewRows, "venture name") ||
    input.startupNameHint || "";

  const founderName =
    lookupRightOf(overviewRows, "founder name") ||
    lookupRightOf(overviewRows, "founder") ||
    "";

  // Host = T-Sprint Consultants Assigned. Co-Host = the cell right of Host
  // value (the spec says "next to Host" — i.e. typically 2 consultants share
  // one row). We use the with-col variant to find the host's column index,
  // then grab the next non-empty cell to its right.
  const hostHit = lookupRightOfWithCol(overviewRows, "t-sprint consultants assigned")
    ?? lookupRightOfWithCol(overviewRows, "consultants assigned")
    ?? lookupRightOfWithCol(overviewRows, "consultant assigned")
    ?? lookupRightOfWithCol(overviewRows, "host");

  let host = "", coHost = "";
  if (hostHit) {
    host = hostHit.value;
    const row = overviewRows[hostHit.row] ?? [];
    // Co-Host = first non-empty cell strictly to the right of the host cell
    for (let d = hostHit.col + 1; d < row.length; d++) {
      const v = cleanCell(row[d]);
      if (v) { coHost = v; break; }
    }
  }

  const goal = joinSmartTab(smartRows);

  // Try the startup name from the sheet first, then the hint, for date lookup
  const { vp1, vp2 } = findVpDates(sprintRows, startupName || input.startupNameHint || "");

  return {
    ...EMPTY,
    startupName,
    founderName,
    host,
    coHost,
    goal,
    vp1Date: vp1,
    vp2Date: vp2,
  };
}
