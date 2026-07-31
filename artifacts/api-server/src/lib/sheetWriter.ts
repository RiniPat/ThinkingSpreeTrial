/**
 * sheetWriter.ts — writes the "Research for [Company]" Google Sheet, progressively
 * and with real formatting that mirrors the uploaded research workbooks
 * (Backend Alpino / Research-EV / Raptee): a navy bold header band, frozen header
 * row, wrapped cells, one tab per company for the Breakdown, and a 6-column
 * Inspiration journey tab that matches the screenshots.
 *
 * The sheet is created at Data Feed and appended to at each later stage, so the
 * consultant watches it fill in live. Images use =IMAGE(url) (USER_ENTERED) so
 * the Product Image column renders an actual picture.
 */
import { google } from "googleapis";
import type { Auth } from "googleapis";
import { BREAKDOWN_COLUMNS, type Landscape } from "./competitiveMappingAi";

type Sheets = ReturnType<typeof google.sheets>;

const NAVY = { red: 0.11, green: 0.21, blue: 0.37 };
const WHITE = { red: 1, green: 1, blue: 1 };
const BAND = { red: 0.93, green: 0.95, blue: 0.98 };

const sanitizeTab = (t: string) => String(t || "Sheet").replace(/[\\/?*\[\]:]/g, " ").slice(0, 95).trim() || "Sheet";

function client(auth: Auth.OAuth2Client): Sheets {
  return google.sheets({ version: "v4", auth });
}

/** Create the workbook with a single Company Overview tab. */
export async function createResearchSheet(
  auth: Auth.OAuth2Client, companyName: string,
): Promise<{ spreadsheetId: string; url: string }> {
  const sheets = client(auth);
  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: `Research for ${companyName}` },
      sheets: [{ properties: { title: "Company Overview" } }],
    },
  });
  const spreadsheetId = created.data.spreadsheetId!;
  return { spreadsheetId, url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}` };
}

/** Find a tab's numeric id by title; add it if missing. */
async function ensureTab(sheets: Sheets, spreadsheetId: string, title: string): Promise<number> {
  const t = sanitizeTab(title);
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
  const existing = (meta.data.sheets || []).find((s) => s.properties?.title === t);
  if (existing?.properties?.sheetId != null) return existing.properties.sheetId;
  const res = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: t } } }] },
  });
  const added = res.data.replies?.[0]?.addSheet?.properties?.sheetId;
  return added ?? 0;
}

/** Overwrite a tab's values from A1 (clears first so re-runs are idempotent). */
async function writeValues(sheets: Sheets, spreadsheetId: string, title: string, values: any[][]) {
  const t = sanitizeTab(title);
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: `'${t}'` }).catch(() => {});
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${t}'!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });
}

/** Apply the shared look: frozen header row(s), navy bold header, wrapped cells. */
async function style(
  sheets: Sheets, spreadsheetId: string, tabId: number,
  opts: { headerRows: number; colCount: number; rowCount: number },
) {
  const { headerRows, colCount, rowCount } = opts;
  const requests: any[] = [
    { updateSheetProperties: {
        properties: { sheetId: tabId, gridProperties: { frozenRowCount: headerRows } },
        fields: "gridProperties.frozenRowCount",
    } },
    // Header band: navy fill, white bold text, centered.
    { repeatCell: {
        range: { sheetId: tabId, startRowIndex: 0, endRowIndex: headerRows, startColumnIndex: 0, endColumnIndex: colCount },
        cell: { userEnteredFormat: {
          backgroundColor: NAVY,
          textFormat: { foregroundColor: WHITE, bold: true, fontSize: 10 },
          horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE", wrapStrategy: "WRAP",
        } },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)",
    } },
    // Body: wrap + top align so long cells read cleanly.
    { repeatCell: {
        range: { sheetId: tabId, startRowIndex: headerRows, endRowIndex: Math.max(headerRows + 1, rowCount), startColumnIndex: 0, endColumnIndex: colCount },
        cell: { userEnteredFormat: { wrapStrategy: "WRAP", verticalAlignment: "TOP" } },
        fields: "userEnteredFormat(wrapStrategy,verticalAlignment)",
    } },
  ];
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } }).catch((e) => {
    console.warn("[sheetWriter] style failed:", (e as Error).message);
  });
}

/** Shade a single label column (used on the Overview key/value layout). */
async function shadeColumn(sheets: Sheets, spreadsheetId: string, tabId: number, rowCount: number) {
  const requests: any[] = [{
    repeatCell: {
      range: { sheetId: tabId, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: 1 },
      cell: { userEnteredFormat: { backgroundColor: BAND, textFormat: { bold: true } } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  }];
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } }).catch(() => {});
}

/* ── Company Overview ─────────────────────────────────────────────────────── */
export async function writeOverviewTab(
  auth: Auth.OAuth2Client, spreadsheetId: string, companyName: string, overview: any,
) {
  const sheets = client(auth);
  const o = overview ?? {};
  const values: any[][] = [
    ["Company Overview", companyName],
    ["Tagline", o.tagline ?? ""],
    ["Website", o.website ?? ""],
    ["Founded", o.founded ?? ""],
    ["HQ", o.hq ?? ""],
    ["Stage", o.stage ?? ""],
    [],
    ["Key Metrics", ""],
    ...(Array.isArray(o.metrics) ? o.metrics : []).map((m: any) => [m.label ?? "", `${m.value ?? ""}${m.note ? ` (${m.note})` : ""}`]),
    [],
    ["Products", "Revenue · Segment · Problem"],
    ...(Array.isArray(o.products) ? o.products : []).map((p: any) => [p.name ?? "", `${p.rev ?? ""} · ${p.seg ?? ""} · ${p.problem ?? ""}`]),
  ];
  const tabId = await ensureTab(sheets, spreadsheetId, "Company Overview");
  await writeValues(sheets, spreadsheetId, "Company Overview", values);
  await style(sheets, spreadsheetId, tabId, { headerRows: 1, colCount: 2, rowCount: values.length });
  await shadeColumn(sheets, spreadsheetId, tabId, values.length);
}

/* ── Fencing: Industry Landscape ──────────────────────────────────────────── */
export async function writeFencingTab(
  auth: Auth.OAuth2Client, spreadsheetId: string, landscape: Landscape,
) {
  const sheets = client(auth);
  const metrics = landscape?.metrics ?? [];
  const companies = landscape?.companies ?? [];

  // Tab 1: Industry Landscape (summary + metrics)
  const lvals: any[][] = [
    ["Industry Landscape", "", ""],
    ["Summary", landscape?.summary ?? "", ""],
    [],
    ["Metric", "Value", "Note / Basis"],
    ...metrics.map((m) => [m.label ?? "", m.value ?? "", m.note ?? ""]),
  ];
  const lId = await ensureTab(sheets, spreadsheetId, "Fencing — Landscape");
  await writeValues(sheets, spreadsheetId, "Fencing — Landscape", lvals);
  await style(sheets, spreadsheetId, lId, { headerRows: 1, colCount: 3, rowCount: lvals.length });

  // Tab 2: All Companies (the exhaustive list Prioritize filters)
  const cvals: any[][] = [
    ["Sr", "Company", "Type", "Size", "HQ", "Website", "What they do"],
    ...companies.map((c, i) => [
      String(i + 1), c.name ?? "", c.type ?? "", c.size ?? "", c.hq ?? "", c.website ?? "", c.note ?? "",
    ]),
  ];
  const cId = await ensureTab(sheets, spreadsheetId, "Fencing — All Companies");
  await writeValues(sheets, spreadsheetId, "Fencing — All Companies", cvals);
  await style(sheets, spreadsheetId, cId, { headerRows: 1, colCount: 7, rowCount: cvals.length });
}

/* ── Breakdown: one 46-column tab per company ─────────────────────────────── */
export async function writeBreakdownTab(
  auth: Auth.OAuth2Client, spreadsheetId: string, company: string, rows: any[],
) {
  const sheets = client(auth);
  const cols = BREAKDOWN_COLUMNS;
  const header = cols.map((c) => c.label);
  const body = (rows || []).map((r) =>
    cols.map((c) => {
      if (c.key === "image") {
        const img = r.image || r.imageUrl || (Array.isArray(r.images) ? r.images[0] : "");
        return img ? `=IMAGE("${String(img).replace(/"/g, "")}")` : "NA";
      }
      const v = r[c.key];
      return v === undefined || v === null || v === "" ? "NA" : v;
    }),
  );
  const title = `Breakdown — ${company}`;
  const tabId = await ensureTab(sheets, spreadsheetId, title);
  await writeValues(sheets, spreadsheetId, title, [header, ...body]);
  await style(sheets, spreadsheetId, tabId, { headerRows: 1, colCount: cols.length, rowCount: body.length + 1 });
  // Give the image column some height so pictures are visible.
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{
      updateDimensionProperties: {
        range: { sheetId: tabId, dimension: "ROWS", startIndex: 1, endIndex: body.length + 1 },
        properties: { pixelSize: 90 }, fields: "pixelSize",
      },
    }] },
  }).catch(() => {});
}

/* ── Inspiration: 6-column journey tab (matches the screenshots) ──────────── */
export async function writeInspirationTab(
  auth: Auth.OAuth2Client, spreadsheetId: string, who: string, phases: any[],
) {
  const sheets = client(auth);
  const header = [
    "Timeline & Growth Phase", "Product & Capability Evolution", "Marketing & Positioning",
    "Funding / Investment", "Quantified Growth", "Key Customers / Partners",
  ];
  const body = (phases || []).map((p) => [
    p.era ?? "", p.product ?? "", p.market ?? "", p.funding ?? "", p.growth ?? "", p.customers ?? "",
  ]);
  const title = `Inspiration — ${who}`;
  const tabId = await ensureTab(sheets, spreadsheetId, title);
  await writeValues(sheets, spreadsheetId, title, [header, ...body]);
  await style(sheets, spreadsheetId, tabId, { headerRows: 1, colCount: header.length, rowCount: body.length + 1 });
}
