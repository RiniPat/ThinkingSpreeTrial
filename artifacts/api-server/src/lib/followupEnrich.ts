/**
 * Sales follow-up enrichment pipeline (§4).
 *
 * Reads the consultant's pasted T-sheet (Google Sheet, via the Sheets API) and
 * any submitted meeting docs — Google Doc links (Drive export) and/or uploaded
 * files (stored in Drive, text via fileExtract) — summarises them with Gemini,
 * and persists the summaries + the doc set so the AI draft ("Generate") and
 * "Re-draft" are cheap and never re-read the docs.
 *
 * NO scraping. One bad or huge doc must never break Analyse for the rest.
 */

import type XLSX from "xlsx";
import { and, eq, inArray } from "drizzle-orm";
import {
  db, salesFollowupContextTable, salesFollowupDocsTable, type SalesFollowupDoc,
} from "@workspace/db";
import { fetchSheetAsWorkbook } from "./sheetsFetcher";
import { extractTextFromUpload } from "./fileExtract";
import { summariseTSheet, summariseFollowupDocs } from "./gemini";
import {
  driveFor, ensureSalesFolder, uploadToDrive, readGoogleDocText, deleteDriveFile,
  extractDriveFileId,
} from "./salesDrive";

/** Flatten every tab of a fetched workbook to bounded plain text. */
export function flattenWorkbookToText(wb: XLSX.WorkBook): string {
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const text = sheetToRows(ws)
      .map((r) => r.map((c) => (c == null ? "" : String(c))).join(" | ").trim())
      .filter(Boolean)
      .join("\n");
    if (text.trim()) parts.push(`## ${name}\n${text}`);
  }
  return parts.join("\n\n").slice(0, 30000);
}

/** Minimal sheet → rows without needing the XLSX namespace at call sites. */
function sheetToRows(ws: XLSX.WorkSheet): (string | number | null)[][] {
  const ref = ws["!ref"];
  if (!ref) return [];
  const m = ref.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  if (!m) return [];
  const colToNum = (c: string) => c.split("").reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
  const c1 = colToNum(m[1]), r1 = Number(m[2]), c2 = colToNum(m[3]), r2 = Number(m[4]);
  const numToCol = (n: number) => { let s = ""; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
  const out: (string | number | null)[][] = [];
  const maxRows = Math.min(r2, r1 + 400);
  for (let r = r1; r <= maxRows; r++) {
    const row: (string | number | null)[] = [];
    for (let c = c1; c <= c2; c++) {
      const cell = ws[`${numToCol(c)}${r}`];
      row.push(cell ? (cell.v as any) ?? null : null);
    }
    out.push(row);
  }
  return out;
}

export type UploadInput = { filename: string; mimeType: string; buffer: Buffer };

export type EnrichInput = {
  userId: number;
  clientKey: string;
  startup: string;
  tSheetUrl?: string | null;
  docUrls?: string[];
  uploads?: UploadInput[];
  /** Existing doc-row ids to keep as-is (not re-read, not deleted). */
  keepDocIds?: number[];
};

export type EnrichResult = {
  tSheetUrl: string | null;
  tSheetSummary: string;
  docsSummary: string;
  enrichmentStatus: "ok" | "partial" | "error";
  enrichmentError: string | null;
  docs: { id: number; title: string; sourceType: string; url: string | null; status: string; error: string | null }[];
};

const MAX_DOCS = 12;
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export async function enrichFollowup(input: EnrichInput): Promise<EnrichResult> {
  const { userId, clientKey, startup } = input;
  const docUrls = (input.docUrls ?? []).map((u) => u.trim()).filter(Boolean);
  const uploads = (input.uploads ?? []);
  const keepIds = new Set(input.keepDocIds ?? []);

  // ── 1. Reconcile the existing doc set: keep some, drop the rest ────────────
  const existing = await db.select().from(salesFollowupDocsTable).where(eq(salesFollowupDocsTable.clientKey, clientKey));
  const kept: SalesFollowupDoc[] = existing.filter((d) => keepIds.has(d.id));
  const dropped: SalesFollowupDoc[] = existing.filter((d) => !keepIds.has(d.id));

  let drive: Awaited<ReturnType<typeof driveFor>> | null = null;
  const needDrive = uploads.length > 0 || docUrls.length > 0 || dropped.some((d) => d.sourceType === "upload" && d.driveFileId);
  if (needDrive) {
    try { drive = await driveFor(userId); } catch { drive = null; }
  }

  // Delete dropped uploads' Drive files so the folder stays clean, then remove
  // the dropped rows from the DB.
  if (drive) {
    for (const d of dropped) if (d.sourceType === "upload" && d.driveFileId) await deleteDriveFile(drive, d.driveFileId);
  }
  if (dropped.length) {
    await db.delete(salesFollowupDocsTable).where(inArray(salesFollowupDocsTable.id, dropped.map((d) => d.id)));
  }

  // ── 2. Read + store the newly-submitted docs ──────────────────────────────
  const newRows: { sourceType: string; url: string | null; driveFileId: string | null; title: string; extractedText: string; status: string; error: string | null }[] = [];
  const budget = Math.max(0, MAX_DOCS - kept.length);
  const submitted = [...docUrls.map((u) => ({ kind: "gdoc" as const, url: u })), ...uploads.map((u) => ({ kind: "upload" as const, up: u }))].slice(0, budget);

  let folderId: string | null = null;
  for (const item of submitted) {
    if (item.kind === "gdoc") {
      const fileId = extractDriveFileId(item.url);
      if (!fileId || !drive) {
        newRows.push({ sourceType: "gdoc", url: item.url, driveFileId: null, title: item.url, extractedText: "", status: "error", error: !fileId ? "Not a valid Google Doc link." : "Google Drive isn't connected." });
        continue;
      }
      try {
        const text = await readGoogleDocText(drive, fileId);
        newRows.push({ sourceType: "gdoc", url: item.url, driveFileId: fileId, title: deriveTitle(item.url), extractedText: text, status: "ok", error: null });
      } catch (err) {
        newRows.push({ sourceType: "gdoc", url: item.url, driveFileId: fileId, title: deriveTitle(item.url), extractedText: "", status: "error", error: err instanceof Error ? err.message : "Couldn't read this doc." });
      }
    } else {
      const up = item.up;
      if (up.buffer.byteLength > MAX_UPLOAD_BYTES) {
        newRows.push({ sourceType: "upload", url: null, driveFileId: null, title: up.filename, extractedText: "", status: "error", error: "File is too large (max 15 MB)." });
        continue;
      }
      let driveFileId: string | null = null, webViewLink: string | null = null;
      try {
        if (drive) {
          if (!folderId) folderId = await ensureSalesFolder(drive, startup);
          const ref = await uploadToDrive(drive, folderId, up.filename, up.mimeType, up.buffer);
          driveFileId = ref.fileId; webViewLink = ref.webViewLink;
        }
      } catch { /* Drive store failed — still try to extract text below */ }
      try {
        const text = await extractTextFromUpload(up.filename, up.buffer);
        newRows.push({ sourceType: "upload", url: webViewLink, driveFileId, title: up.filename, extractedText: text, status: "ok", error: null });
      } catch (err) {
        newRows.push({ sourceType: "upload", url: webViewLink, driveFileId, title: up.filename, extractedText: "", status: "error", error: err instanceof Error ? err.message : "Couldn't read this file." });
      }
    }
  }

  const inserted = newRows.length
    ? await db.insert(salesFollowupDocsTable).values(newRows.map((r) => ({ clientKey, ...r }))).returning()
    : [];

  // ── 3. Summarise ALL docs (kept + new) together ────────────────────────────
  const allDocs: SalesFollowupDoc[] = [...kept, ...inserted];
  const okDocs = allDocs.filter((d: SalesFollowupDoc) => d.status === "ok" && d.extractedText && d.extractedText.trim());
  let docsSummary = "";
  try {
    docsSummary = await summariseFollowupDocs(okDocs.map((d) => ({ title: d.title ?? "Untitled", text: d.extractedText ?? "" })));
  } catch { docsSummary = ""; }

  // ── 4. T-sheet: re-summarise when a URL is supplied, else keep existing ────
  const [prevCtx] = await db.select().from(salesFollowupContextTable).where(eq(salesFollowupContextTable.clientKey, clientKey)).limit(1);
  let tSheetUrl = input.tSheetUrl != null ? (input.tSheetUrl.trim() || null) : (prevCtx?.tSheetUrl ?? null);
  let tSheetSummary = prevCtx?.tSheetSummary ?? "";
  let tSheetError: string | null = null;
  if (input.tSheetUrl != null && input.tSheetUrl.trim()) {
    try {
      const wb = await fetchSheetAsWorkbook(userId, input.tSheetUrl.trim());
      const text = flattenWorkbookToText(wb);
      tSheetSummary = await summariseTSheet(text);
    } catch (err) {
      tSheetError = err instanceof Error ? err.message : "Couldn't read the T-sheet.";
      tSheetSummary = "";
    }
  }

  // ── 5. Status + persist ────────────────────────────────────────────────────
  const docErrors = allDocs.filter((d) => d.status === "error").length;
  const anyUsable = Boolean(tSheetSummary) || okDocs.length > 0;
  let status: "ok" | "partial" | "error";
  if (!anyUsable && (tSheetError || docErrors)) status = "error";
  else if (docErrors > 0 || tSheetError) status = "partial";
  else status = "ok";
  const enrichmentError = [tSheetError, docErrors ? `${docErrors} doc(s) couldn't be read` : ""].filter(Boolean).join(" · ") || null;

  const now = new Date();
  const values = {
    clientKey, tSheetUrl, tSheetSummary, docsSummary,
    enrichmentStatus: status, enrichmentError, enrichedAt: now, updatedAt: now,
  };
  if (prevCtx) {
    await db.update(salesFollowupContextTable).set(values).where(eq(salesFollowupContextTable.clientKey, clientKey));
  } else {
    await db.insert(salesFollowupContextTable).values(values);
  }

  return {
    tSheetUrl, tSheetSummary, docsSummary, enrichmentStatus: status, enrichmentError,
    docs: allDocs.map((d) => ({ id: d.id, title: d.title ?? "Untitled", sourceType: d.sourceType, url: d.url ?? null, status: d.status ?? "ok", error: d.error ?? null })),
  };
}

function deriveTitle(url: string): string {
  return "Google Doc";
}
