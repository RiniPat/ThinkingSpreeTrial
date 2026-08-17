/**
 * ISB master-sheet mapping (Retargeting autofill).
 *
 * For the ISB programmes (ISB Cleantech, ISB IRA 2.0) the T-Sheet link and the
 * session transcript Google-Doc link already live in a master summary sheet on
 * the "For ISB" tab, keyed by the startup name:
 *   - col B  (index 1)  → startup
 *   - col Z  (index 25) → "Sheet link"          (the T-Sheet)
 *   - col AA (index 26) → "Transcript Gdoc Link" (the session transcript Doc)
 *
 * We read those columns via the consultant's own OAuth Google client and expose
 * a { sheetLink, transcriptGdocUrl } lookup by normalised startup name so the
 * Retargeting compose drawer can auto-fill both fields. The consultant then just
 * clicks "Analyse" — the existing enrich flow reads the T-Sheet and the
 * transcript Doc (passed as a docUrl) with no further manual entry.
 *
 * Links may be stored as plain URLs OR as `=HYPERLINK(url, label)` cells, so we
 * merge FORMATTED_VALUE with FORMULA and prefer the URL inside a HYPERLINK — the
 * same technique sheetsFetcher.ts uses.
 */

import { google } from "googleapis";
import { getAuthedClient } from "./google";
import { extractSheetId } from "./sheetsFetcher";
import { memoAsync, TTL } from "./aiClient";

/** Master summary sheet + tab that hold the ISB T-Sheet / transcript links. */
export const ISB_MAPPING_SHEET_URL =
  process.env.ISB_MAPPING_SHEET_URL?.trim() ||
  "https://docs.google.com/spreadsheets/d/1RXGM5JCijqeBi_0KC31zZwYDU7V30iB3ijvNBHSfMgc/edit";
export const ISB_MAPPING_TAB = process.env.ISB_MAPPING_TAB?.trim() || "For ISB";

// Column indices on the "For ISB" tab (0-based).
const COL_STARTUP = 1;      // B
const COL_SHEET_LINK = 25;  // Z
const COL_TRANSCRIPT = 26;  // AA
const RANGE = "A1:AB2000";

export type IsbLinks = { sheetLink: string | null; transcriptGdocUrl: string | null };

/** True for the ISB retargeting programmes we auto-fill (ISB Cleantech, ISB IRA 2.0). */
export function isIsbProgram(program: string | null | undefined): boolean {
  return /isb|cleantech|ira\s*2/i.test(String(program ?? ""));
}

function norm(s: unknown): string {
  return String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** If `formula` is `=HYPERLINK("https://…", "Label")`, return the URL, else null. */
function extractHyperlinkUrl(formula: unknown): string | null {
  if (!formula || typeof formula !== "string") return null;
  const m = formula.match(/^\s*=\s*HYPERLINK\s*\(\s*["']([^"']+)["']/i);
  return m ? m[1] : null;
}

/** Prefer a HYPERLINK URL, else the display value if it looks like a URL. */
function cellUrl(display: unknown, formula: unknown): string | null {
  const fromFormula = extractHyperlinkUrl(formula);
  if (fromFormula) return fromFormula.trim();
  const d = String(display ?? "").trim();
  return /^https?:\/\//i.test(d) ? d : null;
}

/** Resolve the tab we should read: exact configured name, else a "For ISB"/"ISB" match. */
async function resolveTab(sheets: ReturnType<typeof google.sheets>, id: string): Promise<string> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: "sheets.properties.title" });
  const titles = (meta.data.sheets ?? [])
    .map((s) => s.properties?.title)
    .filter((t): t is string => Boolean(t));
  const exact = titles.find((t) => norm(t) === norm(ISB_MAPPING_TAB));
  if (exact) return exact;
  const forIsb = titles.find((t) => /for\s*isb/i.test(t)) ?? titles.find((t) => /isb/i.test(t));
  if (forIsb) return forIsb;
  throw new Error(`Couldn't find the "${ISB_MAPPING_TAB}" tab in the ISB master sheet.`);
}

/**
 * Read + parse the "For ISB" tab into a startup → links map. Cached briefly
 * (same sheet for every consultant) so repeated drawer opens don't re-fetch.
 */
export async function loadIsbLinkMap(userId: number): Promise<Map<string, IsbLinks>> {
  const id = extractSheetId(ISB_MAPPING_SHEET_URL);
  if (!id) throw new Error("ISB_MAPPING_SHEET_URL is not a valid Google Sheets URL.");

  return memoAsync(`isbMapping:${id}:${norm(ISB_MAPPING_TAB)}`, TTL.medium, async () => {
    const client = await getAuthedClient(userId);
    if (!client) {
      throw new Error("Google isn't connected for this account. Open Settings → Google Connections and connect Sheets access.");
    }
    const sheets = google.sheets({ version: "v4", auth: client });
    const tab = await resolveTab(sheets, id);
    const range = `'${tab.replace(/'/g, "''")}'!${RANGE}`;

    const [displayResp, formulaResp] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId: id, range, valueRenderOption: "FORMATTED_VALUE" }),
      sheets.spreadsheets.values.get({ spreadsheetId: id, range, valueRenderOption: "FORMULA" }),
    ]);
    const display = (displayResp.data.values as unknown[][] | undefined) ?? [];
    const formula = (formulaResp.data.values as unknown[][] | undefined) ?? [];

    const map = new Map<string, IsbLinks>();
    // Row 0 is the header; data starts at row 1.
    for (let r = 1; r < display.length; r++) {
      const dRow = display[r] ?? [];
      const fRow = formula[r] ?? [];
      const startup = norm(dRow[COL_STARTUP]);
      if (!startup) continue;
      const sheetLink = cellUrl(dRow[COL_SHEET_LINK], fRow[COL_SHEET_LINK]);
      const transcriptGdocUrl = cellUrl(dRow[COL_TRANSCRIPT], fRow[COL_TRANSCRIPT]);
      if (!sheetLink && !transcriptGdocUrl) continue;
      // First non-empty row for a startup wins; don't overwrite with a blank later row.
      if (!map.has(startup)) map.set(startup, { sheetLink, transcriptGdocUrl });
    }
    return map;
  });
}

/** Look up one startup's links (empty object when not found / no access). */
export async function lookupIsbLinks(userId: number, startup: string): Promise<IsbLinks> {
  const map = await loadIsbLinkMap(userId);
  return map.get(norm(startup)) ?? { sheetLink: null, transcriptGdocUrl: null };
}
