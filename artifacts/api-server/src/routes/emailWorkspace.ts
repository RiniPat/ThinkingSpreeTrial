/**
 * Emails tab — the sheet-link-first workflow (distinct from the company-level
 * composer in companyEmails.ts, which keys off an existing founder row).
 *
 * Flow:
 *   1. Consultant pastes a T-Sheet link → POST /email/extract-sheet
 *      → Gemini reads the sheet for company/founder/cohort, and Google
 *        Calendar supplies the invite attendees (candidate To/Cc recipients).
 *   2. Consultant picks a template (managed via /email/templates CRUD).
 *   3. POST /email/draft → Gemini drafts subject+body from the template + context.
 *   4. Consultant edits (bold / highlight / link markers) and sends via
 *      POST /email/send → Gmail.
 *
 * Templates are workspace-wide and persist until deleted.
 */
import { Router } from "express";
import * as XLSX from "xlsx";
import { google } from "googleapis";
import { db, emailTemplatesTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { getAuthedClient } from "../lib/google";
import { fetchSheetAsWorkbook } from "../lib/sheetsFetcher";
import {
  generateEmail, extractSheetProfile, isGeminiConfigured,
  type EmailKind, type EmailContext,
} from "../lib/gemini";

const router = Router();

function requireUser(req: any, res: any): number | null {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return null; }
  return userId;
}

function asKind(v: unknown): EmailKind | null {
  const k = String(v ?? "").toLowerCase();
  return k === "pre" || k === "post" ? k : null;
}

// ─── Templates CRUD ───────────────────────────────────────────────────────
router.get("/email/templates", async (req, res) => {
  const userId = requireUser(req, res); if (!userId) return;
  const kind = asKind(req.query.kind);
  try {
    const rows = kind
      ? await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.kind, kind)).orderBy(desc(emailTemplatesTable.updatedAt))
      : await db.select().from(emailTemplatesTable).orderBy(desc(emailTemplatesTable.updatedAt));
    res.json({ templates: rows });
  } catch (err) {
    req.log.error({ err }, "Failed to list templates");
    res.status(500).json({ error: "Failed to list templates" });
  }
});

router.post("/email/templates", async (req, res) => {
  const userId = requireUser(req, res); if (!userId) return;
  const kind = asKind(req.body?.kind);
  const name = String(req.body?.name ?? "").trim();
  const body = String(req.body?.body ?? "").trim();
  if (!kind) { res.status(400).json({ error: "kind must be 'pre' or 'post'" }); return; }
  if (!name || !body) { res.status(400).json({ error: "name and body are required" }); return; }
  try {
    const [row] = await db.insert(emailTemplatesTable).values({ kind, name, body, createdBy: userId }).returning();
    res.json({ template: row });
  } catch (err) {
    req.log.error({ err }, "Failed to create template");
    res.status(500).json({ error: "Failed to create template" });
  }
});

router.patch("/email/templates/:id", async (req, res) => {
  const userId = requireUser(req, res); if (!userId) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof req.body?.name === "string") patch.name = req.body.name.trim();
  if (typeof req.body?.body === "string") patch.body = req.body.body.trim();
  try {
    const [row] = await db.update(emailTemplatesTable).set(patch).where(eq(emailTemplatesTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Template not found" }); return; }
    res.json({ template: row });
  } catch (err) {
    req.log.error({ err }, "Failed to update template");
    res.status(500).json({ error: "Failed to update template" });
  }
});

router.delete("/email/templates/:id", async (req, res) => {
  const userId = requireUser(req, res); if (!userId) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(emailTemplatesTable).where(eq(emailTemplatesTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete template");
    res.status(500).json({ error: "Failed to delete template" });
  }
});

// ─── Sheet + calendar extraction ──────────────────────────────────────────
/** Flatten a workbook to a bounded plain-text dump for the extractor. */
function flattenWorkbook(wb: XLSX.WorkBook, maxChars = 8000): string {
  const parts: string[] = [];
  for (const name of wb.SheetNames.slice(0, 4)) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, blankrows: false });
    parts.push(`# Tab: ${name}`);
    for (const r of rows.slice(0, 60)) {
      const line = (r ?? []).map((c) => (c == null ? "" : String(c))).join(" | ").trim();
      if (line) parts.push(line);
    }
    if (parts.join("\n").length > maxChars) break;
  }
  return parts.join("\n").slice(0, maxChars);
}

type Attendee = { email: string; name: string | null; organizer: boolean; self: boolean; responseStatus: string | null };

/**
 * Find the Google Calendar event that best matches the company and return its
 * attendee list — these become the candidate To/Cc recipients. We search a
 * window from 30 days back to 120 days ahead and prefer the event whose title
 * or description mentions the company.
 */
async function getCalendarAttendees(userId: number, query: string): Promise<{
  attendees: Attendee[]; eventDate: string | null; eventTime: string | null; eventSummary: string | null;
}> {
  const empty = { attendees: [] as Attendee[], eventDate: null, eventTime: null, eventSummary: null };
  try {
    const client = await getAuthedClient(userId);
    if (!client || !query.trim()) return empty;
    const cal = google.calendar({ version: "v3", auth: client });
    const past = new Date(); past.setDate(past.getDate() - 30);
    const future = new Date(); future.setDate(future.getDate() + 120);
    const r = await cal.events.list({
      calendarId: "primary",
      timeMin: past.toISOString(),
      timeMax: future.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 100,
      q: query,
    });
    const q = query.toLowerCase();
    const matches = (r.data.items ?? []).filter((e) => {
      const blob = `${e.summary ?? ""} ${e.description ?? ""}`.toLowerCase();
      return blob.includes(q);
    });
    const best = matches.find((e) => new Date(e.start?.dateTime ?? e.start?.date ?? 0) >= new Date()) ?? matches[0];
    if (!best) return empty;

    const attendees: Attendee[] = (best.attendees ?? [])
      .filter((a) => a.email && !a.resource)
      .map((a) => ({
        email: a.email!,
        name: a.displayName ?? null,
        organizer: !!a.organizer,
        self: !!a.self,
        responseStatus: a.responseStatus ?? null,
      }));

    let eventDate: string | null = null;
    let eventTime: string | null = null;
    if (best.start?.dateTime) {
      const start = new Date(best.start.dateTime);
      eventDate = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(start);
      eventTime = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(start) + " IST";
    }
    return { attendees, eventDate, eventTime, eventSummary: best.summary ?? null };
  } catch {
    return empty;
  }
}

router.post("/email/extract-sheet", async (req, res) => {
  const userId = requireUser(req, res); if (!userId) return;
  const sheetUrl = String(req.body?.sheetUrl ?? "").trim();
  if (!sheetUrl) { res.status(400).json({ error: "sheetUrl is required" }); return; }
  if (!await isGeminiConfigured()) {
    res.status(503).json({ error: "AI is not configured. The server admin must set GEMINI_API_KEY." });
    return;
  }
  try {
    const wb = await fetchSheetAsWorkbook(userId, sheetUrl);
    const text = flattenWorkbook(wb);
    const profile = await extractSheetProfile(text);

    // Attendees come from the calendar invite matching the company (or founder).
    const cal = profile.companyName
      ? await getCalendarAttendees(userId, profile.companyName)
      : (profile.founderName ? await getCalendarAttendees(userId, profile.founderName) : { attendees: [], eventDate: null, eventTime: null, eventSummary: null });

    res.json({
      companyName: profile.companyName,
      founderName: profile.founderName,
      cohort: profile.cohort,
      sheetUrl,
      attendees: cal.attendees,
      calendarEvent: cal.eventSummary ? { summary: cal.eventSummary, date: cal.eventDate, time: cal.eventTime } : null,
    });
  } catch (err) {
    req.log.error({ err }, "Sheet extraction failed");
    const msg = err instanceof Error ? err.message : "Extraction failed";
    res.status(500).json({ error: msg });
  }
});

// ─── Draft ─────────────────────────────────────────────────────────────────
router.post("/email/draft", async (req, res) => {
  const userId = requireUser(req, res); if (!userId) return;
  const kind = asKind(req.body?.kind);
  if (!kind) { res.status(400).json({ error: "kind must be 'pre' or 'post'" }); return; }
  if (!await isGeminiConfigured()) {
    res.status(503).json({ error: "AI is not configured. The server admin must set GEMINI_API_KEY." });
    return;
  }

  let templateBody: string | null = null;
  const templateId = req.body?.templateId ? Number(req.body.templateId) : null;
  if (templateId) {
    const [t] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.id, templateId)).limit(1);
    if (t) templateBody = t.body;
  }
  if (typeof req.body?.templateBody === "string" && req.body.templateBody.trim()) {
    templateBody = req.body.templateBody;
  }

  const c = req.body?.context ?? {};
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const ctx: EmailContext = {
    companyName: s(c.companyName) ?? "the company",
    founderName: s(c.founderName) ?? "there",
    cohort: s(c.cohort),
    vision: s(c.vision),
    sprintHost: s(c.sprintHost),
    coHost: s(c.coHost),
    sprintDay: s(c.sprintDay),
    sprintDate: s(c.sprintDate),
    sprintTime: s(c.sprintTime),
    keyStrengths: s(c.keyStrengths),
    gaps: s(c.gaps),
    direction: s(c.direction),
    actionableSteps: s(c.actionableSteps),
    mentorRecommendation: s(c.mentorRecommendation),
    marketAccess: s(c.marketAccess),
    thinkingSheetUrl: s(c.thinkingSheetUrl) ?? s(c.sheetUrl),
    extraNotes: s(c.extraNotes),
    engagementType: c.engagementType === "multi" ? "multi" : (c.engagementType === "single" ? "single" : null),
    nextSprintNumber: s(c.nextSprintNumber),
    nextSprintDate: s(c.nextSprintDate),
    nextSprintTime: s(c.nextSprintTime),
  };

  try {
    const draft = await generateEmail(kind, ctx, templateBody);
    res.json({ subject: draft.subject, body: draft.body });
  } catch (err) {
    req.log.error({ err }, "Draft generation failed");
    const msg = err instanceof Error ? err.message : "Draft generation failed";
    res.status(500).json({ error: msg });
  }
});

// ─── Send (Gmail) ────────────────────────────────────────────────────────
function parseRecipients(raw: unknown): string[] {
  const parts: string[] = [];
  if (Array.isArray(raw)) { for (const r of raw) if (typeof r === "string") parts.push(r); }
  else if (typeof raw === "string") parts.push(...raw.split(/[,;]/));
  const seen = new Set<string>(); const out: string[] = [];
  for (const p of parts) {
    const addr = p.trim();
    if (!addr || !addr.includes("@") || addr.includes("@placeholder.local")) continue;
    const key = addr.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key); out.push(addr);
  }
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Draft markup → HTML. Supports [text](url) links, **bold**, and ==highlight==. */
function bodyToHtml(body: string): string {
  const paras = body.replace(/\r\n/g, "\n").split(/\n{2,}/);
  const html = paras.map((para) => {
    let x = escapeHtml(para);
    x = x.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer" style="color:#1d4ed8;text-decoration:underline;">$1</a>');
    x = x.replace(/==(.+?)==/gs, '<mark style="background:#fde68a;padding:0 2px;">$1</mark>');
    x = x.replace(/\*\*(.+?)\*\*/gs, "<strong>$1</strong>");
    x = x.replace(/\n/g, "<br>");
    return `<p style="margin:0 0 14px 0;">${x}</p>`;
  });
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1f2937;">${html.join("")}</div>`;
}

/** Draft markup → clean plain text for the text/plain MIME part. */
function toPlain(body: string): string {
  return body
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)")
    .replace(/==(.+?)==/gs, "$1")
    .replace(/\*\*(.+?)\*\*/gs, "$1");
}

function buildRawMessage(opts: { to: string[]; cc?: string[]; subject: string; body: string }): string {
  const boundary = `tsprint_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const headers = [
    `To: ${opts.to.join(", ")}`,
    ...(opts.cc && opts.cc.length ? [`Cc: ${opts.cc.join(", ")}`] : []),
    `Subject: ${opts.subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const raw = [
    ...headers, "",
    `--${boundary}`, "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: 8bit", "", toPlain(opts.body), "",
    `--${boundary}`, "Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: 8bit", "", bodyToHtml(opts.body), "",
    `--${boundary}--`,
  ].join("\r\n");
  return Buffer.from(raw).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

router.post("/email/send", async (req, res) => {
  const userId = requireUser(req, res); if (!userId) return;
  const to = parseRecipients(req.body?.to);
  const cc = parseRecipients(req.body?.cc);
  const subject = String(req.body?.subject ?? "").trim();
  const body = String(req.body?.body ?? "").trim();
  if (!subject || !body) { res.status(400).json({ error: "subject and body are required" }); return; }
  if (to.length === 0) { res.status(400).json({ error: "At least one valid To recipient is required" }); return; }
  try {
    const client = await getAuthedClient(userId);
    if (!client) {
      res.status(503).json({ error: "Gmail isn't connected. Connect Google in Settings and grant Gmail permission." });
      return;
    }
    const gmail = google.gmail({ version: "v1", auth: client });
    const raw = buildRawMessage({ to, cc, subject, body });
    const send = await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
    res.json({ ok: true, gmailMessageId: send.data.id ?? null, to, cc });
  } catch (err: any) {
    req.log.error({ err }, "Email send failed");
    const msg = err?.errors?.[0]?.message ?? err?.message ?? "Send failed";
    res.status(500).json({ error: msg });
  }
});

export default router;
