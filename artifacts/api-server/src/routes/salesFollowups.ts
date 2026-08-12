/**
 * Sales · Follow-ups API.
 *
 *   GET    /api/sales/followups            → sync sheet + list + stats
 *   POST   /api/sales/followups/refresh    → force re-read of the sheet, then list
 *   POST   /api/sales/followups/:key/send  → send the (rich-text) follow-up via Gmail
 *   POST   /api/sales/followups/:key/mark   → manual reply override (interested|not_now|no_reply)
 *   POST   /api/sales/followups/scan-replies → poll the consultant's Gmail for inbound replies
 *
 * Data model (see migration 019 + schema salesFollowups.ts):
 *   The "Live Sprint Tracking" Google Sheet is the source of truth for client
 *   identity + sprint facts. It is per-SESSION, so we group by client. This
 *   table holds only app-owned lifecycle (draft/sent/reply/thread).
 *
 * Eligibility gate: a client is DUE when `Sprint Completed = Yes` in the sheet
 * AND the latest Sprint Date is >= 30 days ago. Until the sheet gains a
 * "Sprint Completed" column, `sprintCompleted` is NULL and the list surfaces a
 * "column not found" flag (the UI shows a banner); nothing is marked Due.
 */
import { Router } from "express";
import multer from "multer";
import {
  db, salesFollowupsTable, emailTemplatesTable, usersTable, makeClientKey,
  canViewSalesOps, isConsultantScoped,
  salesFollowupContextTable, salesFollowupDocsTable, INTEREST_STATES,
  RESPONSE_STATES, PIPELINE_STAGES,
} from "@workspace/db";
import { eq, inArray, and, asc } from "drizzle-orm";
import { google } from "googleapis";
import sanitizeHtmlLib from "sanitize-html";
import { getAuthedClient } from "../lib/google";
import { extractSheetId } from "../lib/sheetsFetcher";
import { enrichFollowup, type UploadInput } from "../lib/followupEnrich";
import { generateEmail, generateGrowthProspectsBrief } from "../lib/gemini";
import { renderGrowthProspectsDocx } from "../lib/growthProspectsDocx";
import { renderGrowthProspectsPdf } from "../lib/growthProspectsPdf";
import { growthProspectsFileStem, type GrowthProspectsBrief } from "../lib/growthProspectsLayout";
import { driveFor, ensureSalesFolder, uploadToDrive, downloadDriveFile, deleteDriveFile } from "../lib/salesDrive";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024, files: 12 } });

// Only companies with a sprint on/after this date surface in the follow-up UX.
// Compared as calendar dates (YYYY-MM-DD), which is timezone-independent.
const SALES_ENGAGEMENT_CUTOFF = (process.env.SALES_ENGAGEMENT_CUTOFF?.trim() || "2026-04-01").slice(0, 10);

/** True when the row's last sprint is on/after the engagement cutoff. */
function withinEngagementCutoff(lastSprintDate: string | null): boolean {
  if (!lastSprintDate) return false;
  return String(lastSprintDate).slice(0, 10) >= SALES_ENGAGEMENT_CUTOFF;
}

/** Only interested/maybe are actionable (draft / generate / enrich / send). */
const ACTIONABLE_INTEREST = new Set(["interested", "maybe"]);

const router = Router();

// The single shared tracking sheet. Override per-env if the URL ever changes.
const LIVE_TRACKING_SHEET_URL =
  process.env.LIVE_TRACKING_SHEET_URL ??
  "https://docs.google.com/spreadsheets/d/1fOt_wi7JAqacmviiq4sMlsgWS7ucbhHzk0dCnuQ754c/edit";

const DUE_AFTER_DAYS = 30;
const NUDGE_AFTER_DAYS = 7;
const DAY_MS = 86_400_000;

// Sales tab is visible to consultant | sales | ops | admin. Enforce server-side
// too (the sidebar gate is UX only). One cheap identity read per request — we
// also pull `name` + `sprintHostNames` so consultant-scoping can match the
// caller against the sheet's free-text Host / Co-Host columns.
const SALES_ROLES = new Set(["consultant", "sales", "ops", "admin"]);
type SalesAuth = { userId: number; role: string; name: string; sprintHostNames: string | null };
async function requireSales(req: any, res: any): Promise<SalesAuth | null> {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return null; }
  const [u] = await db
    .select({ role: usersTable.role, name: usersTable.name, sprintHostNames: usersTable.sprintHostNames })
    .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!u || !SALES_ROLES.has(u.role)) { res.status(403).json({ error: "Not authorized for Sales" }); return null; }
  return { userId, role: u.role, name: u.name, sprintHostNames: u.sprintHostNames ?? null };
}

/**
 * The set of normalised name aliases that identify a consultant in the sheet's
 * free-text Host / Co-Host columns: their account name plus any explicit
 * `sprint_host_names` aliases (comma / newline / semicolon separated).
 */
function aliasesForUser(u: { name: string; sprintHostNames: string | null }): Set<string> {
  const parts = [u.name, ...String(u.sprintHostNames ?? "").split(/[,;\n]/)];
  return new Set(parts.map(norm).filter(Boolean));
}

/** True when a row's host or co-host matches one of the caller's aliases. */
function rowMatchesAliases(row: { host: string | null; cohost: string | null }, aliases: Set<string>): boolean {
  return aliases.has(norm(row.host)) || aliases.has(norm(row.cohost));
}

// ─── Consultant follow-up profile (sign-off merge fields) ───────────────────
// Fills [Title], [Phone], [Calendar link] in templates. [Name] comes from the
// user's name. Stored on the users row (columns added in migration 021).

router.get("/me/followup-profile", async (req, res) => {
  const auth = await requireSales(req, res); if (!auth) return;
  try {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, auth.userId)).limit(1);
    res.json({
      name: u?.name ?? null,
      title: (u as any)?.title ?? null,
      phone: (u as any)?.phone ?? null,
      calendarLink: (u as any)?.calendarLink ?? null,
      sprintHostNames: (u as any)?.sprintHostNames ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load profile" });
  }
});

router.put("/me/followup-profile", async (req, res) => {
  const auth = await requireSales(req, res); if (!auth) return;
  const patch: any = {};
  if (req.body?.title != null) patch.title = String(req.body.title).trim() || null;
  if (req.body?.phone != null) patch.phone = String(req.body.phone).trim() || null;
  if (req.body?.calendarLink != null) patch.calendarLink = String(req.body.calendarLink).trim() || null;
  if (req.body?.sprintHostNames != null) patch.sprintHostNames = String(req.body.sprintHostNames).trim() || null;
  try {
    await db.update(usersTable).set(patch).where(eq(usersTable.id, auth.userId));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to save profile" });
  }
});

// ─── Sheet reading ──────────────────────────────────────────────────────────
// We read UNFORMATTED values with SERIAL_NUMBER dates so Sprint Date arrives as
// an Excel serial we can convert deterministically (locale-independent).

function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  // Excel epoch is 1899-12-30 (accounts for the 1900 leap-year bug).
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * DAY_MS);
}

function norm(s: unknown): string {
  return String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function asBool(v: unknown): boolean | null {
  if (v == null || v === "") return null;
  const t = norm(v);
  if (["yes", "y", "true", "1", "done", "completed"].includes(t)) return true;
  if (["no", "n", "false", "0", "pending", "ongoing"].includes(t)) return false;
  return null;
}

type ClientAgg = {
  clientKey: string;
  startup: string;
  contact: string | null;
  email: string | null;
  program: string | null;
  stage: string | null;
  host: string | null;
  cohost: string | null;
  sessions: number;
  lastSprintDate: Date | null;
  sprintCompleted: boolean | null;
};

type ParsedSheet = { clients: ClientAgg[]; hasCompletedColumn: boolean };

async function readTrackingSheet(userId: number): Promise<ParsedSheet> {
  const id = extractSheetId(LIVE_TRACKING_SHEET_URL);
  if (!id) throw new Error("LIVE_TRACKING_SHEET_URL is not a valid Google Sheets URL.");

  const client = await getAuthedClient(userId);
  if (!client) {
    throw new Error("Google isn't connected for this account. Open Settings → Google Connections and connect Sheets access.");
  }
  const sheets = google.sheets({ version: "v4", auth: client });

  // 1) Tab titles → pick the tracking tab by header signature.
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: "sheets.properties.title" });
  const titles = (meta.data.sheets ?? [])
    .map((s) => s.properties?.title)
    .filter((t): t is string => Boolean(t));
  if (titles.length === 0) throw new Error("The tracking sheet appears to be empty (no tabs).");

  // Read each candidate tab's header row cheaply, choose the one that looks
  // like the tracking table. Prefer an explicit "DO NOT EDIT" tab if present.
  const preferred = titles.find((t) => /do not edit|detailed tracking|sheet tracking/i.test(t));
  const orderedTitles = preferred ? [preferred, ...titles.filter((t) => t !== preferred)] : titles;

  let chosenTab: string | null = null;
  for (const t of orderedTitles) {
    const head = await sheets.spreadsheets.values.get({
      spreadsheetId: id,
      range: `'${t.replace(/'/g, "''")}'!A1:AZ1`,
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    const headers = (head.data.values?.[0] ?? []).map(norm);
    const looksRight =
      headers.includes("name") &&
      headers.some((h) => h.includes("program")) &&
      headers.some((h) => h.includes("sprint date"));
    if (looksRight) { chosenTab = t; break; }
  }
  if (!chosenTab) {
    throw new Error("Couldn't find the tracking table. Expected a tab with columns Name, Program Name, Sprint Date.");
  }

  // 2) Pull the whole table, unformatted, dates as serials.
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `'${chosenTab.replace(/'/g, "''")}'!A1:AZ5000`,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "SERIAL_NUMBER",
  });
  const rows = (resp.data.values ?? []) as unknown[][];
  if (rows.length < 2) return { clients: [], hasCompletedColumn: false };

  const headers = rows[0].map(norm);
  const col = (needle: string) => headers.findIndex((h) => h.includes(needle));
  const iName = col("name") === -1 ? 0 : headers.indexOf("name");
  const iFirst = col("first name");
  const iIndustry = col("industry");
  const iStage = col("stage");
  const iProgram = col("program");
  const iHost = headers.indexOf("sprint host") !== -1 ? headers.indexOf("sprint host") : col("host");
  const iCoHost = col("co-host") !== -1 ? col("co-host") : col("cohost");
  const iSessionNum = col("sprint session number");
  const iSprintDate = col("sprint date");
  const iEmail = headers.indexOf("email"); // first "Email" column (founder)
  // The eligibility column — only present once the team adds it to the sheet.
  const iCompleted = headers.findIndex((h) => /sprint completed|(^|\W)completed(\W|$)/.test(h));
  const hasCompletedColumn = iCompleted !== -1;

  const get = (row: unknown[], i: number) => (i >= 0 ? row[i] : undefined);
  const str = (v: unknown) => { const t = String(v ?? "").trim(); return t.length ? t : null; };

  const byKey = new Map<string, ClientAgg>();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const name = str(get(row, iName));
    if (!name) continue;
    const program = str(get(row, iProgram));
    const key = makeClientKey(name, program);

    const sprintSerial = Number(get(row, iSprintDate));
    const sprintDate = excelSerialToDate(sprintSerial);
    const completedCell = hasCompletedColumn ? asBool(get(row, iCompleted)) : null;

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        clientKey: key,
        startup: name,
        contact: str(get(row, iFirst)),
        email: str(get(row, iEmail)),
        program,
        stage: str(get(row, iStage)),
        host: str(get(row, iHost)),
        cohost: str(get(row, iCoHost)),
        sessions: 1,
        lastSprintDate: sprintDate,
        sprintCompleted: completedCell,
      });
    } else {
      existing.sessions += 1;
      if (sprintDate && (!existing.lastSprintDate || sprintDate > existing.lastSprintDate)) {
        existing.lastSprintDate = sprintDate;
      }
      // "completed" is true if ANY of the client's rows says Yes.
      if (completedCell === true) existing.sprintCompleted = true;
      else if (existing.sprintCompleted == null && completedCell === false) existing.sprintCompleted = false;
      // backfill contact/email if a later row has them
      if (!existing.email) existing.email = str(get(row, iEmail));
      if (!existing.contact) existing.contact = str(get(row, iFirst));
    }
  }

  return { clients: [...byKey.values()], hasCompletedColumn };
}

// ─── Sync: merge sheet snapshot into app-owned rows ─────────────────────────

async function syncFromSheet(userId: number) {
  const { clients, hasCompletedColumn } = await readTrackingSheet(userId);
  if (clients.length === 0) return { synced: 0, hasCompletedColumn };

  const keys = clients.map((c) => c.clientKey);
  const existingRows = keys.length
    ? await db.select().from(salesFollowupsTable).where(inArray(salesFollowupsTable.clientKey, keys))
    : [];
  const existing = new Map(existingRows.map((r) => [r.clientKey, r]));

  for (const c of clients) {
    const snapshot = {
      startup: c.startup,
      contact: c.contact,
      email: c.email,
      program: c.program,
      stage: c.stage,
      host: c.host,
      cohost: c.cohost,
      sessions: c.sessions,
      lastSprintDate: c.lastSprintDate ? c.lastSprintDate.toISOString().slice(0, 10) : null,
      sprintCompleted: c.sprintCompleted,
      updatedAt: new Date(),
    };
    const row = existing.get(c.clientKey);
    if (row) {
      await db.update(salesFollowupsTable).set(snapshot).where(eq(salesFollowupsTable.id, row.id));
    } else {
      await db.insert(salesFollowupsTable).values({ clientKey: c.clientKey, ...snapshot });
    }
  }
  return { synced: clients.length, hasCompletedColumn };
}

// ─── Effective status + stats ───────────────────────────────────────────────

function daysSince(d: string | Date | null): number | null {
  if (!d) return null;
  const t = typeof d === "string" ? new Date(d).getTime() : d.getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / DAY_MS);
}

/** Derive the chip the UI shows from stored state + sheet facts. */
function effectiveStatus(row: typeof salesFollowupsTable.$inferSelect): string {
  if (row.status === "bounced") return "bounced";
  if (row.replyState === "interested" || row.status === "replied_interested") return "replied_interested";
  if (row.replyState === "not_now" || row.status === "replied_not_now") return "replied_not_now";
  if (row.replyDetectedAt && !row.replyState) return "replied"; // needs classify
  if (row.status === "sent" || row.replyState === "no_reply" || row.status === "no_reply") {
    const since = daysSince(row.sentAt);
    return since != null && since >= NUDGE_AFTER_DAYS ? "no_reply" : "sent";
  }
  if (row.status === "draft") return "draft";
  const dueBySheet = row.sprintCompleted === true;
  const elapsed = daysSince(row.lastSprintDate);
  if (dueBySheet && elapsed != null && elapsed >= DUE_AFTER_DAYS) return "due";
  return "not_due";
}

// Sent / awaiting / nudge signals — computed server-side, never stored (§3.5).
const SENT_LIKE = new Set(["sent", "no_reply", "replied", "replied_interested", "replied_not_now"]);
const REPLIED_LIKE = new Set(["replied", "replied_interested", "replied_not_now"]);
function hasReplied(r: typeof salesFollowupsTable.$inferSelect): boolean {
  return Boolean(r.replyDetectedAt) || r.replyState === "interested" || r.replyState === "not_now"
    || r.status === "replied_interested" || r.status === "replied_not_now";
}
function rowHasSent(r: typeof salesFollowupsTable.$inferSelect): boolean {
  return SENT_LIKE.has(effectiveStatus(r));
}
function rowNudgeDue(r: typeof salesFollowupsTable.$inferSelect): boolean {
  const since = daysSince(r.sentAt);
  return rowHasSent(r) && !hasReplied(r) && since != null && since >= NUDGE_AFTER_DAYS;
}

/** True once the consultant has logged a client response (breaks the chain). */
function hasResponse(r: typeof salesFollowupsTable.$inferSelect): boolean {
  return Boolean(r.responseState) || hasReplied(r);
}

/**
 * Retargeting pipeline stage for a SENT row (§ pipeline). 7 days per step; a
 * client response at any stage breaks the chain into `replied`.
 *   outreach_sent → (7d) nudge_due → nudge_sent → (7d) toffee_due
 *   → toffee_sent → (7d) dead ;  replied at any point.
 */
function pipelineStageOf(r: typeof salesFollowupsTable.$inferSelect): {
  stage: string; label: string; dueNext: boolean;
} {
  if (hasResponse(r)) return { stage: "replied", label: "Replied", dueNext: false };
  const d = (t: any) => daysSince(t);
  if (r.toffeeSentAt) {
    const since = d(r.toffeeSentAt);
    return since != null && since >= NUDGE_AFTER_DAYS
      ? { stage: "dead", label: "Dead lead", dueNext: false }
      : { stage: "toffee_sent", label: "Reminder (Toffee) sent", dueNext: false };
  }
  if (r.nudgeSentAt) {
    const since = d(r.nudgeSentAt);
    return since != null && since >= NUDGE_AFTER_DAYS
      ? { stage: "toffee_due", label: "Toffee reminder due", dueNext: true }
      : { stage: "nudge_sent", label: "Nudge sent", dueNext: false };
  }
  if (r.sentAt) {
    const since = d(r.sentAt);
    return since != null && since >= NUDGE_AFTER_DAYS
      ? { stage: "nudge_due", label: "Nudge due", dueNext: true }
      : { stage: "outreach_sent", label: "1st outreach done", dueNext: false };
  }
  return { stage: "not_sent", label: "Not sent", dueNext: false };
}

type ContextLite = {
  enrichmentStatus: string | null;
  tSheetUrl: string | null;
  hasTSheetSummary: boolean;
  hasDocsSummary: boolean;
  hasGrowthDoc: boolean;
  docCount: number;
};

function buildListPayload(
  rows: (typeof salesFollowupsTable.$inferSelect)[],
  hasCompletedColumn: boolean,
  ctxByKey: Map<string, ContextLite> = new Map(),
) {
  const items = rows
    // Only surface companies engaged on/after the April-2026 cutoff (§3.1).
    .filter((r) => withinEngagementCutoff(r.lastSprintDate))
    .map((r) => {
      const status = effectiveStatus(r);
      const sent = SENT_LIKE.has(status);
      const replied = hasReplied(r);
      const awaitingReply = sent && !replied;
      const sinceSent = daysSince(r.sentAt);
      const nudgeDue = awaitingReply && sinceSent != null && sinceSent >= NUDGE_AFTER_DAYS;
      const ctx = ctxByKey.get(r.clientKey);
      return {
        key: r.clientKey,
        startup: r.startup,
        contact: r.contact,
        email: r.email,
        program: r.program,
        stage: r.stage,
        host: r.host,
        cohost: r.cohost,
        sessions: r.sessions,
        sprintCompleted: r.sprintCompleted,
        lastSprintDate: r.lastSprintDate,
        daysSinceSprint: daysSince(r.lastSprintDate),
        status,
        interest: r.interest,
        interestSetAt: r.interestSetAt,
        replyState: r.replyState,
        sentAt: r.sentAt,
        lastContactAt: r.lastContactAt,
        draftSubject: r.draftSubject,
        draftBodyHtml: r.draftBodyHtml,
        templateKey: r.templateKey,
        skipped: r.skipped,
        skipReason: r.skipReason,
        hasSent: sent,
        awaitingReply,
        nudgeDue,
        // Pipeline + response tracking.
        responseState: r.responseState,
        responseNote: r.responseNote,
        nudgeSentAt: r.nudgeSentAt,
        toffeeSentAt: r.toffeeSentAt,
        pipelineStage: pipelineStageOf(r).stage,
        pipelineStageLabel: pipelineStageOf(r).label,
        // Enrichment / doc context (lightweight — full detail via /:key/context).
        enrichmentStatus: ctx?.enrichmentStatus ?? null,
        tSheetUrl: ctx?.tSheetUrl ?? null,
        hasTSheetSummary: ctx?.hasTSheetSummary ?? false,
        hasDocsSummary: ctx?.hasDocsSummary ?? false,
        hasGrowthDoc: ctx?.hasGrowthDoc ?? false,
        docCount: ctx?.docCount ?? 0,
      };
    });

  const now = items;
  const sentThisMonth = now.filter((r) => {
    if (!r.sentAt) return false;
    const d = new Date(r.sentAt);
    const n = new Date();
    return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
  }).length;
  const sentTotal = now.filter((r) => r.hasSent).length;
  const replied = now.filter((r) => REPLIED_LIKE.has(r.status)).length;
  // Actionable = triaged interested/maybe (the new "should follow up" set).
  const actionable = now.filter((r) => ACTIONABLE_INTEREST.has(r.interest ?? ""));

  const stats = {
    due: now.filter((r) => r.status === "due" && !r.skipped).length,
    completedSprints: now.filter((r) => r.sprintCompleted === true).length,
    sentThisMonth,
    replyRate: sentTotal ? Math.round((replied / sentTotal) * 100) : 0,
    awaitingReply: now.filter((r) => r.awaitingReply).length,
    needsNudge: now.filter((r) => r.nudgeDue).length,
    skipped: now.filter((r) => r.skipped).length,
    // Triage tallies for the new UX.
    interested: now.filter((r) => r.interest === "interested").length,
    maybe: now.filter((r) => r.interest === "maybe").length,
    notNow: now.filter((r) => r.interest === "not_now").length,
    untriaged: now.filter((r) => !r.interest).length,
    actionable: actionable.length,
  };

  // Distinct cohorts (programs) present in the visible set, for the filter UI.
  const cohorts = [...new Set(now.map((r) => (r.program ?? "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));

  return { items, stats, hasCompletedColumn, cohorts };
}

/** Load a lightweight enrichment-context map for the given client keys. */
async function contextLiteFor(keys: string[]): Promise<Map<string, ContextLite>> {
  const map = new Map<string, ContextLite>();
  if (keys.length === 0) return map;
  const [ctxRows, docRows] = await Promise.all([
    db.select().from(salesFollowupContextTable).where(inArray(salesFollowupContextTable.clientKey, keys)),
    db.select({ clientKey: salesFollowupDocsTable.clientKey }).from(salesFollowupDocsTable).where(inArray(salesFollowupDocsTable.clientKey, keys)),
  ]);
  const docCounts = new Map<string, number>();
  for (const d of docRows) docCounts.set(d.clientKey, (docCounts.get(d.clientKey) ?? 0) + 1);
  for (const c of ctxRows) {
    map.set(c.clientKey, {
      enrichmentStatus: c.enrichmentStatus ?? null,
      tSheetUrl: c.tSheetUrl ?? null,
      hasTSheetSummary: Boolean(c.tSheetSummary && c.tSheetSummary.trim()),
      hasDocsSummary: Boolean(c.docsSummary && c.docsSummary.trim()),
      hasGrowthDoc: Boolean(c.growthDocxFileId || c.growthBrief),
      docCount: docCounts.get(c.clientKey) ?? 0,
    });
  }
  // Keys with docs but no context row yet.
  for (const [k, n] of docCounts) if (!map.has(k)) map.set(k, { enrichmentStatus: null, tSheetUrl: null, hasTSheetSummary: false, hasDocsSummary: false, hasGrowthDoc: false, docCount: n });
  return map;
}

// ─── Read-time scoping ──────────────────────────────────────────────────────
// The sheet sync rewrites the WHOLE shared table, so we scope at read time.
//   • consultant  → only rows they hosted or co-hosted (alias match).
//   • sales/ops/admin → all rows, with an optional ?scope=mine self-filter.
// An optional ?cohort=<program> narrows to one cohort.
function viewerInfo(auth: SalesAuth) {
  return { name: auth.name, role: auth.role, canViewOps: canViewSalesOps(auth.role) };
}

type ScopeResult = { rows: (typeof salesFollowupsTable.$inferSelect)[]; scoped: boolean };
function scopeRows(rows: (typeof salesFollowupsTable.$inferSelect)[], auth: SalesAuth, query: any): ScopeResult {
  const wantMine = String(query?.scope ?? "") === "mine";
  const forceScope = isConsultantScoped(auth.role);
  const scoped = forceScope || (wantMine && !forceScope);
  let out = rows;
  if (scoped) {
    const aliases = aliasesForUser(auth);
    out = out.filter((r) => rowMatchesAliases(r, aliases));
  }
  const cohort = String(query?.cohort ?? "").trim().toLowerCase();
  if (cohort) out = out.filter((r) => (r.program ?? "").trim().toLowerCase() === cohort);
  return { rows: out, scoped };
}

// ─── Sheet-sync safety net ───────────────────────────────────────────────────
// Reading the Google Sheet + upserting every client is slow (many sequential
// Sheets + Neon round-trips). Doing it *synchronously* on every page load made
// the request outrun Render's gateway timeout → HTTP 502. So: never block a
// page load on it. The list GET serves cached DB rows immediately and refreshes
// the sheet in the background; only a genuinely-cold first load waits, and even
// then only for a bounded window.

/** Reject a promise if it hasn't settled within `ms` (the original keeps running). */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

// Simple in-process throttle so rapid navigation doesn't fire overlapping syncs.
let lastBgSyncAt = 0;
let bgSyncInFlight = false;
function maybeBackgroundSync(userId: number, log?: any) {
  const now = Date.now();
  if (bgSyncInFlight || now - lastBgSyncAt < 60_000) return;
  bgSyncInFlight = true;
  withTimeout(syncFromSheet(userId), 25_000, "background sheet sync")
    .then(() => { lastBgSyncAt = Date.now(); })
    .catch((err) => { log?.warn?.({ err }, "background sheet sync failed"); })
    .finally(() => { bgSyncInFlight = false; });
}

// ─── Routes ─────────────────────────────────────────────────────────────────

router.get("/sales/followups", async (req, res) => {
  const auth = await requireSales(req, res); if (!auth) return; const userId = auth.userId;
  try {
    let rows = await db.select().from(salesFollowupsTable);

    if (rows.length === 0) {
      // Cold start: nothing cached yet, so wait for the sheet — but only for a
      // bounded window so we can never 502. If it overruns, serve what we have.
      try {
        const syncP = syncFromSheet(userId);
        syncP.catch(() => {}); // swallow late rejection if it loses the race
        await withTimeout(syncP, 15_000, "initial sheet sync");
        rows = await db.select().from(salesFollowupsTable);
        lastBgSyncAt = Date.now();
      } catch (err) {
        req.log?.warn?.({ err }, "initial followups sync slow/failed; serving cached rows");
      }
    } else {
      // Warm path: refresh the sheet in the background (response sent below).
      maybeBackgroundSync(userId, req.log);
    }

    // Scope to the caller (consultant → own hosted/co-hosted; oversight → all,
    // with an optional ?scope=mine), then apply any ?cohort= filter.
    const { rows: visible, scoped } = scopeRows(rows, auth, req.query);
    const inScope = visible.filter((r) => withinEngagementCutoff(r.lastSprintDate));
    const ctx = await contextLiteFor(inScope.map((r) => r.clientKey));
    res.json({ ...buildListPayload(visible, true, ctx), scoped, viewer: viewerInfo(auth), cutoff: SALES_ENGAGEMENT_CUTOFF });
  } catch (err) {
    req.log?.error?.({ err }, "GET followups failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load follow-ups" });
  }
});

router.post("/sales/followups/refresh", async (req, res) => {
  const auth = await requireSales(req, res); if (!auth) return; const userId = auth.userId;
  try {
    // User explicitly asked to sync — still bound it so a slow sheet returns a
    // clean message instead of a gateway 502.
    const syncP = syncFromSheet(userId);
    syncP.catch(() => {});
    const { synced, hasCompletedColumn } = await withTimeout(syncP, 25_000, "sheet refresh");
    lastBgSyncAt = Date.now();
    const all = await db.select().from(salesFollowupsTable);
    const { rows, scoped } = scopeRows(all, auth, req.query);
    const ctx = await contextLiteFor(rows.filter((r) => withinEngagementCutoff(r.lastSprintDate)).map((r) => r.clientKey));
    res.json({
      ...buildListPayload(rows, hasCompletedColumn, ctx), scoped, viewer: viewerInfo(auth),
      synced, syncedAt: new Date().toISOString(), cutoff: SALES_ENGAGEMENT_CUTOFF,
    });
  } catch (err) {
    req.log?.error?.({ err }, "refresh followups failed");
    // Fall back to cached rows so the tab still populates even if the sync stalls.
    try {
      const all = await db.select().from(salesFollowupsTable);
      const { rows, scoped } = scopeRows(all, auth, req.query);
      const ctx = await contextLiteFor(rows.filter((r) => withinEngagementCutoff(r.lastSprintDate)).map((r) => r.clientKey));
      res.status(200).json({
        ...buildListPayload(rows, true, ctx),
        scoped, viewer: viewerInfo(auth),
        synced: 0,
        syncedAt: new Date().toISOString(),
        cutoff: SALES_ENGAGEMENT_CUTOFF,
        warning: err instanceof Error ? err.message : "Sheet sync was slow; showing cached data.",
      });
    } catch {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to refresh from the sheet" });
    }
  }
});

// ─── Operations tracking: per-consultant follow-up progress ─────────────────
// Ops/admin only. Groups the WHOLE table by consultant (each company counts
// under BOTH its host and its co-host), so Ops can see whether every consultant
// has reached out to their companies. Optional ?cohort=<program> narrows it.

router.get("/sales/followups/ops-progress", async (req, res) => {
  const auth = await requireSales(req, res); if (!auth) return;
  if (!canViewSalesOps(auth.role)) { res.status(403).json({ error: "Operations tracking is available to Ops and Admin only." }); return; }
  try {
    const cohort = String(req.query?.cohort ?? "").trim().toLowerCase();
    const all = (await db.select().from(salesFollowupsTable))
      .filter((r) => withinEngagementCutoff(r.lastSprintDate))
      .filter((r) => !cohort || (r.program ?? "").trim().toLowerCase() === cohort);

    // Reconcile each consultant name to a known user (by alias) for display.
    const users = await db
      .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, sprintHostNames: usersTable.sprintHostNames })
      .from(usersTable);
    const userByAlias = new Map<string, { id: number; name: string; email: string }>();
    for (const u of users) {
      for (const a of aliasesForUser(u)) if (!userByAlias.has(a)) userByAlias.set(a, { id: u.id, name: u.name, email: u.email });
    }

    // "Expected to follow up" (the denominator) = companies triaged
    // interested/maybe. `not_now` and untriaged are excluded (§3.6).
    type Grp = {
      host: string; matchedUser: { id: number; name: string; email: string } | null;
      cohorts: Set<string>; companies: number;
      interestedOrMaybe: number; sent: number; pending: number; nudgesDue: number;
      replied: number; repliedInterested: number; repliedNotNow: number;
      drafted: number; notNow: number; skipped: number; lastSentAt: Date | null;
    };
    const groups = new Map<string, Grp>();
    const bump = (name: string | null, r: typeof salesFollowupsTable.$inferSelect) => {
      const clean = (name ?? "").trim();
      if (!clean) return;
      const k = norm(clean);
      let g = groups.get(k);
      if (!g) {
        g = {
          host: clean, matchedUser: userByAlias.get(k) ?? null, cohorts: new Set(),
          companies: 0, interestedOrMaybe: 0, sent: 0, pending: 0, nudgesDue: 0,
          replied: 0, repliedInterested: 0, repliedNotNow: 0, drafted: 0, notNow: 0, skipped: 0, lastSentAt: null,
        };
        groups.set(k, g);
      }
      const st = effectiveStatus(r);
      const actionable = ACTIONABLE_INTEREST.has(r.interest ?? "");
      const sent = rowHasSent(r);
      g.companies += 1;
      if (r.program) g.cohorts.add(r.program.trim());
      if (r.skipped) g.skipped += 1;
      if (r.interest === "not_now") g.notNow += 1;
      // Only interested/maybe count toward "should have sent".
      if (actionable) {
        g.interestedOrMaybe += 1;
        if (sent) g.sent += 1; else g.pending += 1;
        if (rowNudgeDue(r)) g.nudgesDue += 1;
      }
      if (sent && r.sentAt) { const t = new Date(r.sentAt); if (!g.lastSentAt || t > g.lastSentAt) g.lastSentAt = t; }
      if (REPLIED_LIKE.has(st)) g.replied += 1;
      if (st === "replied_interested" || r.replyState === "interested") g.repliedInterested += 1;
      if (st === "replied_not_now" || r.replyState === "not_now") g.repliedNotNow += 1;
      if (st === "draft") g.drafted += 1;
    };
    for (const r of all) { bump(r.host, r); bump(r.cohost, r); }

    const consultants = [...groups.values()]
      .map((g) => {
        const replyRate = g.sent ? Math.round((g.replied / g.sent) * 100) : 0;
        return {
          host: g.host,
          matchedUser: g.matchedUser,
          cohorts: [...g.cohorts].sort((a, b) => a.localeCompare(b)),
          companies: g.companies,
          assigned: g.companies,
          interestedOrMaybe: g.interestedOrMaybe,
          // legacy aliases kept so the existing UI keeps rendering
          reached: g.sent,
          pending: g.pending,
          due: g.pending,
          sent: g.sent,
          nudgesDue: g.nudgesDue,
          replied: g.replied,
          repliedInterested: g.repliedInterested,
          repliedNotNow: g.repliedNotNow,
          drafted: g.drafted,
          notNow: g.notNow,
          skipped: g.skipped,
          lastSentAt: g.lastSentAt ? g.lastSentAt.toISOString() : null,
          replyRate,
          behind: replyRate < 30,
          completionPct: g.interestedOrMaybe ? Math.round((g.sent / g.interestedOrMaybe) * 100) : 100,
        };
      })
      .sort((a, b) => b.pending - a.pending || a.completionPct - b.completionPct || a.host.localeCompare(b.host));

    const cohorts = [...new Set(all.map((r) => (r.program ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    res.json({ consultants, cohorts });
  } catch (err) {
    req.log?.error?.({ err }, "ops-progress failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load Operations progress" });
  }
});

// Manual reply override.
router.post("/sales/followups/:key/mark", async (req, res) => {
  const auth = await requireSales(req, res); if (!auth) return; const userId = auth.userId;
  const key = decodeURIComponent(req.params.key);
  const mark = String(req.body?.mark ?? "");
  const map: Record<string, { status: string; replyState: string }> = {
    interested: { status: "replied_interested", replyState: "interested" },
    not_now: { status: "replied_not_now", replyState: "not_now" },
    no_reply: { status: "no_reply", replyState: "no_reply" },
  };
  if (!map[mark]) { res.status(400).json({ error: "mark must be interested | not_now | no_reply" }); return; }
  try {
    await db.update(salesFollowupsTable)
      .set({ ...map[mark], replyIsManual: true, replyDetectedAt: new Date(), updatedAt: new Date() })
      .where(eq(salesFollowupsTable.clientKey, key));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update" });
  }
});

// ─── Triage: interest (interested | maybe | not_now) ────────────────────────
// The triage-first decision that gates Generate/Enrich/Send. Independent of the
// legacy `skipped` gate. Allowed for the hosting consultant or any ops/admin.
router.put("/sales/followups/:key/interest", async (req, res) => {
  const auth = await requireSales(req, res); if (!auth) return;
  const key = decodeURIComponent(req.params.key);
  const raw = req.body?.interest;
  const interest = raw == null || raw === "" || raw === "none" ? null : String(raw);
  if (interest != null && !INTEREST_STATES.includes(interest as any)) {
    res.status(400).json({ error: "interest must be interested | maybe | not_now (or empty to clear)" }); return;
  }
  try {
    const row = await loadRowForKey(key);
    if (!row) { res.status(404).json({ error: "Client not found. Refresh the sheet and try again." }); return; }
    if (!canActOnRow(row, auth)) { res.status(403).json({ error: "You can only triage companies you hosted or co-hosted." }); return; }
    await db.update(salesFollowupsTable)
      .set({ interest, interestSetAt: interest ? new Date() : null, updatedAt: new Date() })
      .where(eq(salesFollowupsTable.id, row.id));
    res.json({ ok: true, interest });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update triage" });
  }
});

// Full enrichment context + docs + growth brief for the drawer.
router.get("/sales/followups/:key/context", async (req, res) => {
  const auth = await requireSales(req, res); if (!auth) return;
  const key = decodeURIComponent(req.params.key);
  try {
    const row = await loadRowForKey(key);
    if (!row) { res.status(404).json({ error: "Client not found." }); return; }
    if (!canActOnRow(row, auth)) { res.status(403).json({ error: "Not your company." }); return; }
    const [ctx] = await db.select().from(salesFollowupContextTable).where(eq(salesFollowupContextTable.clientKey, key)).limit(1);
    const docs = await db.select().from(salesFollowupDocsTable).where(eq(salesFollowupDocsTable.clientKey, key)).orderBy(asc(salesFollowupDocsTable.id));
    res.json({
      interest: row.interest ?? null,
      tSheetUrl: ctx?.tSheetUrl ?? null,
      tSheetSummary: ctx?.tSheetSummary ?? null,
      docsSummary: ctx?.docsSummary ?? null,
      enrichmentStatus: ctx?.enrichmentStatus ?? "idle",
      enrichmentError: ctx?.enrichmentError ?? null,
      enrichedAt: ctx?.enrichedAt ?? null,
      docs: docs.map((d) => ({ id: d.id, title: d.title, sourceType: d.sourceType, url: d.url, status: d.status, error: d.error })),
      growth: ctx?.growthBrief
        ? { brief: ctx.growthBrief, docxUrl: ctx.growthDocxUrl, pdfUrl: ctx.growthPdfUrl, generatedAt: ctx.growthGeneratedAt }
        : null,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load context" });
  }
});

// Enrichment: read the T-sheet + any submitted docs, summarise, persist (§3.3).
// Multipart: `files` (uploads) + fields `tSheetUrl`, `docUrls` (JSON), `keepDocIds` (JSON).
router.post("/sales/followups/:key/enrich", upload.array("files"), async (req, res) => {
  const auth = await requireSales(req, res); if (!auth) return;
  const key = decodeURIComponent(String(req.params.key));
  try {
    const row = await loadRowForKey(key);
    if (!row) { res.status(404).json({ error: "Client not found. Refresh the sheet and try again." }); return; }
    if (!canActOnRow(row, auth)) { res.status(403).json({ error: "You can only analyse companies you hosted or co-hosted." }); return; }
    if (!ACTIONABLE_INTEREST.has(row.interest ?? "")) {
      res.status(400).json({ error: "Mark this company Interested or Maybe before analysing." }); return;
    }
    const parseArr = (v: unknown): string[] => {
      if (Array.isArray(v)) return v.map(String);
      if (typeof v !== "string" || !v.trim()) return [];
      try { const a = JSON.parse(v); return Array.isArray(a) ? a.map(String) : [v]; } catch { return [v]; }
    };
    const docUrls = parseArr(req.body?.docUrls);
    const keepDocIds = parseArr(req.body?.keepDocIds).map(Number).filter((n) => Number.isFinite(n));
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const uploads: UploadInput[] = files.map((f) => ({ filename: f.originalname, mimeType: f.mimetype, buffer: f.buffer }));
    const tSheetUrl = req.body?.tSheetUrl != null ? String(req.body.tSheetUrl) : null;

    const result = await enrichFollowup({
      userId: auth.userId, clientKey: key, startup: row.startup,
      tSheetUrl, docUrls, uploads, keepDocIds,
    });
    res.json(result);
  } catch (err) {
    req.log?.error?.({ err }, "enrich failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Enrichment failed" });
  }
});

// AI draft generation (§3.4). Does NOT send and does NOT persist — the client
// shows the result in the editable drawer.
router.post("/sales/followups/:key/generate", async (req, res) => {
  const auth = await requireSales(req, res); if (!auth) return;
  const key = decodeURIComponent(req.params.key);
  try {
    const row = await loadRowForKey(key);
    if (!row) { res.status(404).json({ error: "Client not found. Refresh the sheet and try again." }); return; }
    if (!canActOnRow(row, auth)) { res.status(403).json({ error: "You can only draft for companies you hosted or co-hosted." }); return; }
    if (!ACTIONABLE_INTEREST.has(row.interest ?? "")) {
      res.status(400).json({ error: "Mark this company Interested or Maybe before generating a draft." }); return;
    }
    const templateBody = String(req.body?.templateBody ?? "");
    const templateIntent = String(req.body?.templateIntent ?? req.body?.templateKey ?? "").trim() || null;

    const [ctx] = await db.select().from(salesFollowupContextTable).where(eq(salesFollowupContextTable.clientKey, key)).limit(1);
    const email = await generateEmail("followup", {
      companyName: row.startup,
      founderName: row.contact ?? row.startup,
      cohort: row.program,
      vision: null, sprintHost: row.host, coHost: row.cohost,
      sprintDay: null, sprintDate: row.lastSprintDate, sprintTime: null,
      keyStrengths: null, gaps: null, direction: null, actionableSteps: null,
      mentorRecommendation: null, marketAccess: null, thinkingSheetUrl: null,
      interest: row.interest,
      templateIntent,
      tSheetSummary: ctx?.tSheetSummary ?? null,
      docsSummary: ctx?.docsSummary ?? null,
    }, templateBody);
    res.json({ subject: email.subject, bodyHtml: sanitizeHtml(email.body) });
  } catch (err) {
    req.log?.error?.({ err }, "generate draft failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Draft generation failed" });
  }
});

// Growth Prospects document (§11). Generate the brief (LLM) OR re-render from an
// edited brief (no LLM), render DOCX (guaranteed) + PDF (best-effort), store in
// Drive, persist. Guard: interest ∈ {interested, maybe} and T-sheet enriched.
router.post("/sales/followups/:key/growth-prospects", async (req, res) => {
  const auth = await requireSales(req, res); if (!auth) return;
  const key = decodeURIComponent(req.params.key);
  try {
    const row = await loadRowForKey(key);
    if (!row) { res.status(404).json({ error: "Client not found. Refresh the sheet and try again." }); return; }
    if (!canActOnRow(row, auth)) { res.status(403).json({ error: "You can only generate documents for companies you hosted or co-hosted." }); return; }
    if (!ACTIONABLE_INTEREST.has(row.interest ?? "")) {
      res.status(400).json({ error: "Mark this company Interested or Maybe first." }); return;
    }
    const [ctx] = await db.select().from(salesFollowupContextTable).where(eq(salesFollowupContextTable.clientKey, key)).limit(1);
    const editedBrief = req.body?.brief && typeof req.body.brief === "object" ? (req.body.brief as GrowthProspectsBrief) : null;
    if (!editedBrief && !(ctx?.tSheetSummary && ctx.tSheetSummary.trim())) {
      res.status(400).json({ error: "Analyse the T-sheet first — the Growth Prospects document is built from it." }); return;
    }

    const brief: GrowthProspectsBrief = editedBrief ?? await generateGrowthProspectsBrief({
      companyName: row.startup,
      founderName: row.contact ?? row.startup,
      cohort: row.program,
      sprintHost: row.host,
      tSheetSummary: ctx?.tSheetSummary ?? null,
      docsSummary: ctx?.docsSummary ?? null,
    });

    // DOCX is the guaranteed deliverable — render it first.
    const docxBuf = await renderGrowthProspectsDocx(brief);
    const stem = growthProspectsFileStem(brief.companyName || row.startup);

    const drive = await driveFor(auth.userId).catch(() => null);
    if (!drive) { res.status(400).json({ error: "Connect Google Drive in Settings → Google Connections to store the document." }); return; }
    const folderId = await ensureSalesFolder(drive, row.startup);
    if (ctx?.growthDocxFileId) await deleteDriveFile(drive, ctx.growthDocxFileId);
    if (ctx?.growthPdfFileId) await deleteDriveFile(drive, ctx.growthPdfFileId);

    const docxRef = await uploadToDrive(drive, folderId, `${stem}.docx`, DOCX_MIME, docxBuf);

    // PDF is best-effort — never let a PDF failure block the DOCX or the email.
    let pdfUrl: string | null = null, pdfFileId: string | null = null, pdfError: string | null = null;
    try {
      const pdfBuf = await renderGrowthProspectsPdf(brief);
      const pdfRef = await uploadToDrive(drive, folderId, `${stem}.pdf`, "application/pdf", pdfBuf);
      pdfUrl = pdfRef.webViewLink; pdfFileId = pdfRef.fileId;
    } catch (e) {
      pdfError = e instanceof Error ? e.message : "PDF rendering unavailable";
      req.log?.warn?.({ err: e }, "growth prospects PDF failed (non-fatal)");
    }

    const now = new Date();
    const vals = {
      clientKey: key, growthBrief: brief,
      growthDocxUrl: docxRef.webViewLink, growthDocxFileId: docxRef.fileId,
      growthPdfUrl: pdfUrl, growthPdfFileId: pdfFileId, growthGeneratedAt: now, updatedAt: now,
    };
    if (ctx) await db.update(salesFollowupContextTable).set(vals).where(eq(salesFollowupContextTable.clientKey, key));
    else await db.insert(salesFollowupContextTable).values(vals);

    res.json({ brief, docxUrl: docxRef.webViewLink, pdfUrl, pdfError, needsValidation: brief.needsValidation });
  } catch (err) {
    req.log?.error?.({ err }, "growth-prospects failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to build the Growth Prospects document" });
  }
});

// ─── Client-response tracking (pipeline) ────────────────────────────────────
// Richer than the reply mark: interested | quotation_sent |
// no_reply_after_quotation | other, plus a free-text remark. Logging a response
// breaks the pipeline chain. Consultant-set now (AI-assisted later).
router.put("/sales/followups/:key/response", async (req, res) => {
  const auth = await requireSales(req, res); if (!auth) return;
  const key = decodeURIComponent(req.params.key);
  const raw = req.body?.state;
  const state = raw == null || raw === "" || raw === "none" ? null : String(raw);
  if (state != null && !(RESPONSE_STATES as readonly string[]).includes(state)) {
    res.status(400).json({ error: "state must be interested | quotation_sent | no_reply_after_quotation | other (or empty)" }); return;
  }
  const note = req.body?.note != null ? (String(req.body.note).trim().slice(0, 2000) || null) : undefined;
  try {
    const row = await loadRowForKey(key);
    if (!row) { res.status(404).json({ error: "Client not found." }); return; }
    if (!canActOnRow(row, auth)) { res.status(403).json({ error: "You can only update companies you hosted or co-hosted." }); return; }
    const patch: any = { responseState: state, responseSetAt: state ? new Date() : null, updatedAt: new Date() };
    if (note !== undefined) patch.responseNote = note;
    if (state) {
      // A logged response = the chain is broken. Mark it detected so reply-scan
      // and the reply-rate insights count it, and mirror to the legacy state.
      patch.replyDetectedAt = row.replyDetectedAt ?? new Date();
      patch.replyIsManual = true;
      if (state === "interested") patch.replyState = "interested";
      else if (state === "no_reply_after_quotation") patch.replyState = "no_reply";
    }
    await db.update(salesFollowupsTable).set(patch).where(eq(salesFollowupsTable.id, row.id));
    res.json({ ok: true, state, note: note ?? row.responseNote ?? null });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update response" });
  }
});

// ─── Pipeline: this consultant's sent companies, by stage ───────────────────
// Shows ONLY companies the caller reached out to from their own email account
// (ownerId == caller). Optional ?cohort= narrows it.
router.get("/sales/followups/pipeline", async (req, res) => {
  const auth = await requireSales(req, res); if (!auth) return;
  try {
    const cohort = String(req.query?.cohort ?? "").trim().toLowerCase();
    const all = await db.select().from(salesFollowupsTable);
    const ownSent = all.filter((r) => r.ownerId === auth.userId && r.sentAt && withinEngagementCutoff(r.lastSprintDate));
    const rows = cohort ? ownSent.filter((r) => (r.program ?? "").trim().toLowerCase() === cohort) : ownSent;
    const items = rows.map((r) => {
      const st = pipelineStageOf(r);
      const last = r.toffeeSentAt ?? r.nudgeSentAt ?? r.sentAt;
      return {
        key: r.clientKey, startup: r.startup, contact: r.contact, email: r.email, program: r.program,
        stage: st.stage, stageLabel: st.label, dueNext: st.dueNext,
        sentAt: r.sentAt, nudgeSentAt: r.nudgeSentAt, toffeeSentAt: r.toffeeSentAt,
        responseState: r.responseState, responseNote: r.responseNote,
        lastActivityAt: last, daysSinceLast: daysSince(last),
      };
    });
    const cohorts = [...new Set(ownSent.map((r) => (r.program ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    res.json({ items, cohorts });
  } catch (err) {
    req.log?.error?.({ err }, "pipeline failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load pipeline" });
  }
});

// ─── "Not targeting" gate (the PRD willing-to decision) ─────────────────────
// A consultant decides they won't reach out to a company; Ops tracking then
// excludes it from the "should have sent" count. Allowed for the hosting
// consultant (alias match) or any ops/admin.
async function loadRowForKey(key: string) {
  const [row] = await db.select().from(salesFollowupsTable).where(eq(salesFollowupsTable.clientKey, key)).limit(1);
  return row ?? null;
}
function canActOnRow(row: { host: string | null; cohost: string | null }, auth: SalesAuth): boolean {
  if (canViewSalesOps(auth.role)) return true;
  return rowMatchesAliases(row, aliasesForUser(auth));
}

router.post("/sales/followups/:key/skip", async (req, res) => {
  const auth = await requireSales(req, res); if (!auth) return;
  const key = decodeURIComponent(req.params.key);
  const reason = String(req.body?.reason ?? "").trim() || null;
  try {
    const row = await loadRowForKey(key);
    if (!row) { res.status(404).json({ error: "Client not found. Refresh the sheet and try again." }); return; }
    if (!canActOnRow(row, auth)) { res.status(403).json({ error: "You can only change companies you hosted or co-hosted." }); return; }
    await db.update(salesFollowupsTable)
      .set({ skipped: true, skipReason: reason, skippedAt: new Date(), updatedAt: new Date() })
      .where(eq(salesFollowupsTable.id, row.id));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update" });
  }
});

router.post("/sales/followups/:key/unskip", async (req, res) => {
  const auth = await requireSales(req, res); if (!auth) return;
  const key = decodeURIComponent(req.params.key);
  try {
    const row = await loadRowForKey(key);
    if (!row) { res.status(404).json({ error: "Client not found." }); return; }
    if (!canActOnRow(row, auth)) { res.status(403).json({ error: "You can only change companies you hosted or co-hosted." }); return; }
    await db.update(salesFollowupsTable)
      .set({ skipped: false, skipReason: null, skippedAt: null, updatedAt: new Date() })
      .where(eq(salesFollowupsTable.id, row.id));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update" });
  }
});

// Save draft (rich text).
router.post("/sales/followups/:key/draft", async (req, res) => {
  const auth = await requireSales(req, res); if (!auth) return; const userId = auth.userId;
  const key = decodeURIComponent(req.params.key);
  const subject = String(req.body?.subject ?? "").trim();
  const bodyHtml = sanitizeHtml(String(req.body?.bodyHtml ?? ""));
  const templateKey = String(req.body?.templateKey ?? "") || null;
  try {
    await db.update(salesFollowupsTable)
      .set({ draftSubject: subject, draftBodyHtml: bodyHtml, templateKey, status: "draft", updatedAt: new Date() })
      .where(eq(salesFollowupsTable.clientKey, key));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to save draft" });
  }
});

// Send the follow-up via the consultant's Gmail.
router.post("/sales/followups/:key/send", async (req, res) => {
  const auth = await requireSales(req, res); if (!auth) return; const userId = auth.userId;
  const key = decodeURIComponent(req.params.key);
  const subject = String(req.body?.subject ?? "").trim();
  const bodyHtml = sanitizeHtml(String(req.body?.bodyHtml ?? ""));
  const toOverride = String(req.body?.to ?? "").trim();
  // Which template this send used, so we can measure template performance
  // (replies per template). Falls back to whatever was stored at draft time.
  const templateKey = String(req.body?.templateKey ?? "").trim() || null;
  // Which pipeline stage this send is (outreach | nudge | toffee).
  const stageRaw = String(req.body?.stage ?? "outreach").trim();
  const stage = (PIPELINE_STAGES as readonly string[]).includes(stageRaw) ? stageRaw : "outreach";

  if (!subject) { res.status(400).json({ error: "Subject is required." }); return; }
  if (!bodyHtml) { res.status(400).json({ error: "The email body is empty." }); return; }

  try {
    const [row] = await db.select().from(salesFollowupsTable).where(eq(salesFollowupsTable.clientKey, key)).limit(1);
    if (!row) { res.status(404).json({ error: "Client not found. Refresh the sheet and try again." }); return; }
    // Only interested/maybe companies are ever sent to (§3.2). `not_now` never.
    if (row.interest === "not_now") {
      res.status(400).json({ error: "This company is marked Not now — it won't be contacted. Change the triage to send." }); return;
    }
    if (!ACTIONABLE_INTEREST.has(row.interest ?? "")) {
      res.status(400).json({ error: "Mark this company Interested or Maybe before sending." }); return;
    }
    const to = toOverride || row.email;
    if (!to || !/.+@.+\..+/.test(to)) {
      res.status(400).json({ error: "No valid email on file for this client. Add one in the sheet (Email column) and refresh." });
      return;
    }

    const client = await getAuthedClient(userId);
    if (!client) { res.status(400).json({ error: "Connect Gmail in Settings → Google Connections first." }); return; }
    const gmail = google.gmail({ version: "v1", auth: client });

    // Optionally attach the Growth Prospects document (DOCX always, PDF if it
    // was produced). A missing/failed PDF never blocks the send.
    const attachments: MailAttachment[] = [];
    if (req.body?.attachGrowthProspects) {
      try {
        const [ctx] = await db.select().from(salesFollowupContextTable).where(eq(salesFollowupContextTable.clientKey, key)).limit(1);
        if (ctx?.growthDocxFileId || ctx?.growthPdfFileId) {
          const drive = await driveFor(userId).catch(() => null);
          const stem = growthProspectsFileStem(row.startup);
          if (drive && ctx.growthDocxFileId) {
            const buf = await downloadDriveFile(drive, ctx.growthDocxFileId);
            attachments.push({ filename: `${stem}.docx`, mimeType: DOCX_MIME, content: buf });
          }
          if (drive && ctx.growthPdfFileId) {
            try {
              const buf = await downloadDriveFile(drive, ctx.growthPdfFileId);
              attachments.push({ filename: `${stem}.pdf`, mimeType: "application/pdf", content: buf });
            } catch (e) { req.log?.warn?.({ err: e }, "growth prospects PDF attach skipped (non-fatal)"); }
          }
        }
      } catch (e) { req.log?.warn?.({ err: e }, "growth prospects attachment skipped (non-fatal)"); }
    }

    const raw = buildRawHtmlMessage({ to: [to], subject, html: bodyHtml, attachments });
    const sendResult = await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
    const messageId = sendResult.data.id ?? null;
    const threadId = sendResult.data.threadId ?? null;

    await db.update(salesFollowupsTable).set({
      status: "sent",
      ownerId: userId,
      sentAt: new Date(),
      lastContactAt: new Date(),
      gmailMessageId: messageId,
      gmailThreadId: threadId,
      draftSubject: subject,
      draftBodyHtml: bodyHtml,
      // Record the template used (keep any existing one if none supplied).
      ...(templateKey ? { templateKey } : {}),
      // Stamp the pipeline stage sent (1st outreach uses sentAt above).
      ...(stage === "nudge" ? { nudgeSentAt: new Date() } : {}),
      ...(stage === "toffee" ? { toffeeSentAt: new Date() } : {}),
      // A fresh outreach restarts the chain — clear later-stage stamps.
      ...(stage === "outreach" ? { nudgeSentAt: null, toffeeSentAt: null } : {}),
      // clear any stale reply state from a previous cycle
      replyState: null,
      replyDetectedAt: null,
      replyIsManual: false,
      updatedAt: new Date(),
    }).where(eq(salesFollowupsTable.id, row.id));

    res.json({ ok: true, gmailMessageId: messageId, gmailThreadId: threadId });
  } catch (err) {
    req.log?.error?.({ err }, "send follow-up failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to send the follow-up" });
  }
});

/**
 * Scan ONE consultant's Gmail for inbound replies on their tracked threads.
 * Reusable so both the manual button and the cron scheduler can call it with a
 * bare userId (no request/session). Returns counts; never throws on a single
 * bad thread — it logs-and-skips so one failure can't stall the batch.
 */
export async function scanRepliesForUser(userId: number): Promise<{ scanned: number; detected: number }> {
  const client = await getAuthedClient(userId);
  if (!client) return { scanned: 0, detected: 0 };
  const gmail = google.gmail({ version: "v1", auth: client });
  const me = (await gmail.users.getProfile({ userId: "me" })).data.emailAddress?.toLowerCase() ?? "";

  const rows = (await db.select().from(salesFollowupsTable))
    .filter((r) => r.ownerId === userId && r.gmailThreadId && !r.replyDetectedAt && !r.replyIsManual);

  let detected = 0;
  for (const r of rows) {
    try {
      const thread = await gmail.users.threads.get({
        userId: "me", id: r.gmailThreadId!, format: "metadata",
        metadataHeaders: ["From", "Date"],
      });
      const msgs = thread.data.messages ?? [];
      const sentAt = r.sentAt ? new Date(r.sentAt).getTime() : 0;
      const inbound = msgs.some((m) => {
        const from = (m.payload?.headers ?? []).find((h) => h.name === "From")?.value?.toLowerCase() ?? "";
        const internal = Number(m.internalDate ?? 0);
        return from && !from.includes(me) && internal > sentAt;
      });
      if (inbound) {
        await db.update(salesFollowupsTable)
          .set({ replyDetectedAt: new Date(), updatedAt: new Date() })
          .where(eq(salesFollowupsTable.id, r.id));
        detected++;
      }
    } catch { /* skip this thread, keep scanning */ }
  }
  return { scanned: rows.length, detected };
}

/** Scan every owner that has at least one pending tracked thread. Used by cron. */
export async function scanAllPendingReplies(): Promise<{ owners: number; scanned: number; detected: number }> {
  const rows = await db.select().from(salesFollowupsTable);
  const owners = [...new Set(
    rows.filter((r) => r.ownerId && r.gmailThreadId && !r.replyDetectedAt && !r.replyIsManual)
        .map((r) => r.ownerId as number),
  )];
  let scanned = 0, detected = 0;
  for (const ownerId of owners) {
    try {
      const r = await scanRepliesForUser(ownerId);
      scanned += r.scanned; detected += r.detected;
    } catch { /* one owner's token may be revoked — skip */ }
  }
  return { owners: owners.length, scanned, detected };
}

// Manual button: scan the signed-in consultant's own inbox.
router.post("/sales/followups/scan-replies", async (req, res) => {
  const auth = await requireSales(req, res); if (!auth) return; const userId = auth.userId;
  try {
    const client = await getAuthedClient(userId);
    if (!client) { res.status(400).json({ error: "Connect Gmail first." }); return; }
    const out = await scanRepliesForUser(userId);
    res.json({ ok: true, ...out });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Reply scan failed" });
  }
});

// Cron entry point — NO session. Guarded by a shared secret so an external
// scheduler (e.g. Render Cron Job) can trigger a full sweep across all owners.
// Set CRON_SECRET in the environment and send it as `x-cron-secret`.
router.post("/sales/followups/cron-scan", async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.get("x-cron-secret") !== secret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const out = await scanAllPendingReplies();
    res.json({ ok: true, ...out, ranAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Cron scan failed" });
  }
});

// ─── Follow-up templates (stored in email_templates, kind = 'followup') ─────
// Workspace-wide library. Any signed-in user may read; editing is open to the
// sales-capable team (attribution via created_by). Subject + sortOrder live in
// columns added by migration 020.

const FOLLOWUP_KIND = "followup";

router.get("/sales/followup-templates", async (req, res) => {
  const auth = await requireSales(req, res); if (!auth) return; const userId = auth.userId;
  try {
    const rows = await db.select().from(emailTemplatesTable)
      .where(eq(emailTemplatesTable.kind, FOLLOWUP_KIND))
      .orderBy(asc((emailTemplatesTable as any).sortOrder), asc(emailTemplatesTable.id));
    res.json({ items: rows });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load templates" });
  }
});

// Shared templates are edited by Ops/Admin only (everyone edits their own
// sign-off/signature via /me/followup-profile).
function requireTemplateEditor(auth: SalesAuth, res: any): boolean {
  if (!canViewSalesOps(auth.role)) {
    res.status(403).json({ error: "Only Operations and Admin can edit shared templates." });
    return false;
  }
  return true;
}
const FOLLOWUP_STAGES = new Set(["outreach", "nudge", "toffee"]);

router.post("/sales/followup-templates", async (req, res) => {
  const auth = await requireSales(req, res); if (!auth) return; const userId = auth.userId;
  if (!requireTemplateEditor(auth, res)) return;
  const name = String(req.body?.name ?? "").trim();
  const subject = String(req.body?.subject ?? "").trim();
  const body = sanitizeHtml(String(req.body?.body ?? ""));
  const sortOrder = Number.isFinite(Number(req.body?.sortOrder)) ? Number(req.body?.sortOrder) : 0;
  const pipelineStage = FOLLOWUP_STAGES.has(String(req.body?.pipelineStage)) ? String(req.body.pipelineStage) : null;
  if (!name) { res.status(400).json({ error: "Name is required." }); return; }
  if (!body) { res.status(400).json({ error: "Body is required." }); return; }
  try {
    const [row] = await db.insert(emailTemplatesTable).values({
      kind: FOLLOWUP_KIND, name, body, createdBy: userId,
      ...( { subject, sortOrder, pipelineStage } as any ),
    }).returning();
    res.json({ ok: true, template: row });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create template" });
  }
});

router.put("/sales/followup-templates/:id", async (req, res) => {
  const auth = await requireSales(req, res); if (!auth) return;
  if (!requireTemplateEditor(auth, res)) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const patch: any = { updatedAt: new Date() };
  if (req.body?.name != null) patch.name = String(req.body.name).trim();
  if (req.body?.subject != null) patch.subject = String(req.body.subject).trim();
  if (req.body?.body != null) patch.body = sanitizeHtml(String(req.body.body));
  if (req.body?.pipelineStage != null) patch.pipelineStage = FOLLOWUP_STAGES.has(String(req.body.pipelineStage)) ? String(req.body.pipelineStage) : null;
  if (req.body?.sortOrder != null && Number.isFinite(Number(req.body.sortOrder))) patch.sortOrder = Number(req.body.sortOrder);
  try {
    await db.update(emailTemplatesTable).set(patch)
      .where(and(eq(emailTemplatesTable.id, id), eq(emailTemplatesTable.kind, FOLLOWUP_KIND)));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update template" });
  }
});

router.delete("/sales/followup-templates/:id", async (req, res) => {
  const auth = await requireSales(req, res); if (!auth) return;
  if (!requireTemplateEditor(auth, res)) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(emailTemplatesTable)
      .where(and(eq(emailTemplatesTable.id, id), eq(emailTemplatesTable.kind, FOLLOWUP_KIND)));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to delete template" });
  }
});

// ─── Manual client (the "Log client" form) ──────────────────────────────────
// For clients not in the sheet, or to seed a follow-up before the next sync.
// Upserts by client_key so re-logging the same name+program edits in place.
// A later sheet sync will refresh snapshot fields if the client also appears
// there; purely-manual clients are left untouched by sync.

router.post("/sales/followups", async (req, res) => {
  const auth = await requireSales(req, res); if (!auth) return; const userId = auth.userId;
  const b = req.body ?? {};
  const startup = String(b.startup ?? "").trim();
  if (!startup) { res.status(400).json({ error: "Client name is required." }); return; }
  const email = String(b.email ?? "").trim() || null;
  if (email && !/.+@.+\..+/.test(email)) { res.status(400).json({ error: "That email doesn't look valid." }); return; }
  const program = String(b.program ?? "").trim() || null;
  const lastSprintDate = String(b.lastSprintDate ?? "").trim() || null; // YYYY-MM-DD
  if (!lastSprintDate) { res.status(400).json({ error: "A last sprint date is required (it drives the 30-day timer)." }); return; }

  const key = makeClientKey(startup, program);
  const values = {
    clientKey: key,
    startup,
    contact: String(b.contact ?? "").trim() || null,
    email,
    program,
    stage: String(b.stage ?? "").trim() || null,
    host: String(b.host ?? "").trim() || null,
    cohost: String(b.cohost ?? "").trim() || null,
    sessions: Number.isFinite(Number(b.sessions)) ? Number(b.sessions) : null,
    lastSprintDate,
    sprintCompleted: b.sprintCompleted === false ? false : true, // default eligible
    updatedAt: new Date(),
  };
  try {
    const [existing] = await db.select().from(salesFollowupsTable)
      .where(eq(salesFollowupsTable.clientKey, key)).limit(1);
    if (existing) {
      await db.update(salesFollowupsTable).set(values).where(eq(salesFollowupsTable.id, existing.id));
    } else {
      await db.insert(salesFollowupsTable).values(values);
    }
    res.json({ ok: true, key });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to log client" });
  }
});

// ─── Gmail message builder (HTML-first) ─────────────────────────────────────

function htmlToPlain(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type MailAttachment = { filename: string; mimeType: string; content: Buffer };

/** Base64-encode attachment bytes into 76-char MIME lines. */
function base64Lines(buf: Buffer): string {
  return buf.toString("base64").replace(/(.{76})/g, "$1\r\n");
}

function buildRawHtmlMessage(opts: { to: string[]; subject: string; html: string; attachments?: MailAttachment[] }): string {
  const stamp = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const altBoundary = `tsfu_alt_${stamp}`;
  const plain = htmlToPlain(opts.html);
  const wrapped = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1f2937;">${opts.html}</div>`;

  const altPart = [
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    "",
    `--${altBoundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    plain,
    "",
    `--${altBoundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    wrapped,
    "",
    `--${altBoundary}--`,
  ].join("\r\n");

  const attachments = opts.attachments ?? [];
  let raw: string;
  if (attachments.length === 0) {
    raw = [`To: ${opts.to.join(", ")}`, `Subject: ${opts.subject}`, "MIME-Version: 1.0", altPart].join("\r\n");
  } else {
    const mixed = `tsfu_mix_${stamp}`;
    const parts: string[] = [
      `To: ${opts.to.join(", ")}`,
      `Subject: ${opts.subject}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${mixed}"`,
      "",
      `--${mixed}`,
      altPart,
      "",
    ];
    for (const a of attachments) {
      const safeName = a.filename.replace(/[\r\n"]/g, "");
      parts.push(
        `--${mixed}`,
        `Content-Type: ${a.mimeType}; name="${safeName}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${safeName}"`,
        "",
        base64Lines(a.content),
        "",
      );
    }
    parts.push(`--${mixed}--`);
    raw = parts.join("\r\n");
  }
  return Buffer.from(raw).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ─── HTML sanitizer ─────────────────────────────────────────────────────────
// Production-grade via the `sanitize-html` package. The follow-up editor only
// emits a fixed toolbar's worth of tags; we allowlist exactly those. Saved
// drafts are re-rendered in-app, so sanitising on store is a hard requirement.
// Install: pnpm add sanitize-html @types/sanitize-html

function sanitizeHtml(input: string): string {
  if (!input) return "";
  return sanitizeHtmlLib(input, {
    allowedTags: ["b", "strong", "i", "em", "u", "mark", "span", "p", "br", "div", "ul", "ol", "li", "a"],
    allowedAttributes: {
      a: ["href", "target", "rel"],
      span: ["style"],
      mark: ["style"],
    },
    allowedStyles: {
      "*": {
        color: [/^#(0x)?[0-9a-f]+$/i, /^rgb\(/i, /^[a-z]+$/i],
        "background-color": [/^#(0x)?[0-9a-f]+$/i, /^rgb\(/i, /^[a-z]+$/i],
      },
    },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: (tagName, attribs) => ({
        tagName: "a",
        attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer" },
      }),
    },
  }).trim();
}

export default router;
