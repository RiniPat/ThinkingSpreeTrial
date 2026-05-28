/**
 * Routes that combine Gemini (AI drafting) + Gmail (sending) + Calendar (date lookup)
 * for the consultant's pre/post-sprint email workflow.
 *
 * Endpoints:
 *   POST /companies/:id/generate-email       — Gemini call, returns subject + body
 *   POST /companies/:id/send-email           — sends via Gmail, logs timeline event
 *   GET  /companies/:id/drafts               — list saved drafts for a company
 *   POST /companies/:id/drafts               — save a draft (no send)
 */
import { Router } from "express";
import { google } from "googleapis";
import { db, foundersTable, incubatorsTable, companyEventsTable, emailDraftsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { generateEmail, type EmailKind, type EmailContext, isGeminiConfigured, summariseVision } from "../lib/gemini";
import { getAuthedClient } from "../lib/google";

const router = Router();

async function requireUser(req: any, res: any): Promise<number | null> {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return null; }
  return userId;
}

/**
 * Fetches the next upcoming Google Calendar event that mentions the company
 * name. Used to auto-fill the Day / Date / Time placeholders in the pre-sprint
 * email — saves the consultant from typing them. Returns nulls if nothing
 * matches, in which case Gemini softens the closing paragraph.
 *
 * Searches a 60-day window forward to catch sessions scheduled ahead of time.
 */
async function findSprintCalendarEvent(userId: number, companyName: string): Promise<{
  day: string | null; date: string | null; time: string | null;
}> {
  try {
    const client = await getAuthedClient(userId);
    if (!client) return { day: null, date: null, time: null };

    const cal = google.calendar({ version: "v3", auth: client });
    const now = new Date();
    const future = new Date(); future.setDate(future.getDate() + 60);

    const r = await cal.events.list({
      calendarId: "primary",
      timeMin: now.toISOString(),
      timeMax: future.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 100,
      // q does substring matching across summary, description, attendees, etc.
      q: companyName,
    });

    const events = (r.data.items ?? []).filter(e => {
      const blob = `${e.summary ?? ""} ${e.description ?? ""}`.toLowerCase();
      return blob.includes(companyName.toLowerCase());
    });

    const match = events[0]; // earliest upcoming
    if (!match?.start?.dateTime) return { day: null, date: null, time: null };

    const start = new Date(match.start.dateTime);
    // Format in IST since that's the consultant base. Intl handles DST etc.
    const fmt = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const timeFmt = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    const parts = fmt.formatToParts(start);
    const day = parts.find(p => p.type === "weekday")?.value ?? null;
    const dateStr = `${parts.find(p => p.type === "day")?.value} ${parts.find(p => p.type === "month")?.value} ${parts.find(p => p.type === "year")?.value}`;
    const time = timeFmt.format(start) + " IST";
    return { day, date: dateStr, time };
  } catch {
    // Calendar might not be authed / token expired — fall back silently.
    return { day: null, date: null, time: null };
  }
}

/**
 * Builds the EmailContext for Gemini by pulling the company row + calendar
 * event in parallel. Centralized so generate and re-generate use the same code.
 */
async function buildContext(userId: number, companyId: number, extraNotes?: string): Promise<EmailContext | null> {
  const [c] = await db
    .select({
      companyName: foundersTable.companyName,
      founderName: foundersTable.name,
      vision: foundersTable.vision,
      sprintHost: foundersTable.sprintHost,
      coHost: foundersTable.coHost,
      keyStrengths: foundersTable.keyStrength,
      gaps: foundersTable.gap,
      direction: foundersTable.suggestedNextStep,    // closest existing column
      actionableSteps: foundersTable.tasks,           // closest existing column
      mentorRecommendation: foundersTable.mentorRecommendation,
      marketAccess: foundersTable.marketAccess,
      thinkingSheetUrl: foundersTable.thinkingSheetUrl,
      sourceSheetUrl: foundersTable.sourceSheetUrl,
      observationsTsDashboard: foundersTable.observationsTsDashboard,
      cohortName: incubatorsTable.name,
      excelData: foundersTable.excelData,
    })
    .from(foundersTable)
    .leftJoin(incubatorsTable, eq(foundersTable.incubatorId, incubatorsTable.id))
    .where(eq(foundersTable.id, companyId))
    .limit(1);

  if (!c) return null;

  // If excel_data has richer values (typically from the most recent upload)
  // prefer those — the column copies are eventually-consistent snapshots.
  const xd = (c.excelData ?? {}) as any;
  const direction = c.direction ?? xd?.milestones?.direction ?? null;
  const actionableSteps = c.actionableSteps ?? xd?.smart?.actionableSteps ?? null;

  const { day, date, time } = await findSprintCalendarEvent(userId, c.companyName);

  // Merge TS team observations into the freeform notes the consultant can
  // optionally pass in. The observations are internal; we phrase them as
  // "context to consider" so Gemini doesn't paste them verbatim into the
  // email — they should influence tone, not appear word-for-word.
  const mergedNotes = [
    c.observationsTsDashboard?.trim()
      ? `Internal Thinking Spree team observations (DO NOT quote or include verbatim — use only to shape tone and emphasis):\n${c.observationsTsDashboard.trim()}`
      : null,
    extraNotes?.trim() ? `Additional notes from the consultant for this email:\n${extraNotes.trim()}` : null,
  ].filter(Boolean).join("\n\n");

  return {
    companyName: c.companyName,
    founderName: c.founderName,
    cohort: c.cohortName,
    vision: c.vision,
    sprintHost: c.sprintHost,
    coHost: c.coHost,
    sprintDay: day,
    sprintDate: date,
    sprintTime: time,
    keyStrengths: c.keyStrengths,
    gaps: c.gaps,
    direction,
    actionableSteps,
    mentorRecommendation: c.mentorRecommendation,
    marketAccess: c.marketAccess,
    // Thinking Sheet IS the source sheet URL — per team workflow.
    thinkingSheetUrl: c.thinkingSheetUrl ?? c.sourceSheetUrl,
    extraNotes: mergedNotes || undefined,
  };
}

// ─── POST /companies/:id/generate-email ──────────────────────────────────
/**
 * Body: { kind: 'pre' | 'post', extraNotes?: string }
 * Returns: { subject, body, draftId, context } — saves a draft row so the
 * consultant can come back to it without re-spending Gemini quota.
 */
router.post("/companies/:id/generate-email", async (req, res) => {
  const userId = await requireUser(req, res); if (!userId) return;
  const id = Number(req.params.id);
  const kind = (req.body?.kind ?? "").toLowerCase() as EmailKind;
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (kind !== "pre" && kind !== "post") { res.status(400).json({ error: "kind must be 'pre' or 'post'" }); return; }

  if (!await isGeminiConfigured()) {
    res.status(503).json({ error: "AI is not configured. The server admin must set GEMINI_API_KEY." });
    return;
  }

  try {
    const ctx = await buildContext(userId, id, req.body?.extraNotes);
    if (!ctx) { res.status(404).json({ error: "Company not found" }); return; }

    const draft = await generateEmail(kind, ctx);

    // Save a draft row so the consultant doesn't lose it on refresh.
    const [c] = await db.select().from(foundersTable).where(eq(foundersTable.id, id)).limit(1);
    const toEmail = c?.email && !c.email.includes("@placeholder.local") ? c.email : null;

    const [saved] = await db.insert(emailDraftsTable).values({
      founderId: id,
      userId,
      kind,
      subject: draft.subject,
      body: draft.body,
      toEmail,
    }).returning();

    await db.insert(companyEventsTable).values({
      founderId: id,
      userId,
      kind: kind === "pre" ? "pre_email_drafted" : "post_email_drafted",
      note: `AI draft generated (${draft.subject.slice(0, 60)})`,
      metadata: { draftId: saved.id },
    });

    res.json({
      subject: draft.subject,
      body: draft.body,
      draftId: saved.id,
      context: {
        toEmail,
        founderName: ctx.founderName,
        companyName: ctx.companyName,
        sprintDate: ctx.sprintDate,
        sprintTime: ctx.sprintTime,
      },
    });
  } catch (err) {
    req.log.error({ err }, "AI email generation failed");
    const msg = err instanceof Error ? err.message : "Generation failed";
    res.status(500).json({ error: msg });
  }
});

// ─── POST /companies/:id/send-email ─────────────────────────────────────
/**
 * Body: { kind, subject, body, toEmail, draftId? }
 * Sends the email via the consultant's connected Gmail account, then logs a
 * timeline event and advances the company's workflow stage.
 *
 * If draftId is provided, we update that draft row with the sent timestamp.
 */
router.post("/companies/:id/send-email", async (req, res) => {
  const userId = await requireUser(req, res); if (!userId) return;
  const id = Number(req.params.id);
  const kind = String(req.body?.kind ?? "").toLowerCase() as EmailKind;
  const subject = String(req.body?.subject ?? "").trim();
  const body = String(req.body?.body ?? "").trim();
  const toEmail = String(req.body?.toEmail ?? "").trim();
  const draftId = req.body?.draftId ? Number(req.body.draftId) : null;

  if (!Number.isFinite(id) || (kind !== "pre" && kind !== "post")) {
    res.status(400).json({ error: "id and kind required" }); return;
  }
  if (!subject || !body) { res.status(400).json({ error: "subject and body required" }); return; }
  if (!toEmail || !toEmail.includes("@") || toEmail.includes("@placeholder.local")) {
    res.status(400).json({ error: "Valid founder email required to send" }); return;
  }

  try {
    const client = await getAuthedClient(userId);
    if (!client) {
      res.status(503).json({
        error: "Gmail isn't connected. Connect Google in Settings and grant Gmail permission.",
      });
      return;
    }

    // Build raw RFC 2822 message. Gmail's send API wants a base64url-encoded
    // multipart-or-text payload as the `raw` field.
    const messageLines = [
      `To: ${toEmail}`,
      `Subject: ${subject}`,
      "Content-Type: text/plain; charset=utf-8",
      "MIME-Version: 1.0",
      "",
      body,
    ];
    const raw = Buffer.from(messageLines.join("\r\n"))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const gmail = google.gmail({ version: "v1", auth: client });
    const sendResult = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });

    const messageId = sendResult.data.id ?? null;

    // Update the draft row (if we have one) with the sent status, or insert a
    // fresh one for ad-hoc sends.
    if (draftId) {
      await db.update(emailDraftsTable)
        .set({ subject, body, toEmail, sentAt: new Date(), gmailMessageId: messageId, updatedAt: new Date() })
        .where(eq(emailDraftsTable.id, draftId));
    } else {
      await db.insert(emailDraftsTable).values({
        founderId: id, userId, kind, subject, body, toEmail,
        sentAt: new Date(), gmailMessageId: messageId,
      });
    }

    // Log timeline event and advance workflow stage.
    const eventKind = kind === "pre" ? "pre_email_sent" : "post_email_sent";
    await db.insert(companyEventsTable).values({
      founderId: id, userId, kind: eventKind,
      note: `Sent to ${toEmail}`,
      metadata: { gmailMessageId: messageId, subject },
    });

    // Stage advances. Order matters — never regress.
    //  pre  → pre_email_sent  (only from pre_sprint)
    //  post → post_email_sent (terminal)
    const [c] = await db.select().from(foundersTable).where(eq(foundersTable.id, id)).limit(1);
    if (c) {
      const next = kind === "pre"
        ? (c.stageWorkflow === "pre_sprint" ? "pre_email_sent" : c.stageWorkflow)
        : "post_email_sent";
      if (next !== c.stageWorkflow) {
        await db.update(foundersTable).set({ stageWorkflow: next }).where(eq(foundersTable.id, id));
      }
    }

    res.json({ ok: true, gmailMessageId: messageId });
  } catch (err: any) {
    req.log.error({ err }, "Failed to send email");
    const msg = err?.errors?.[0]?.message ?? err?.message ?? "Send failed";
    res.status(500).json({ error: msg });
  }
});

// ─── POST /companies/:id/drafts (save without sending) ──────────────────
router.post("/companies/:id/drafts", async (req, res) => {
  const userId = await requireUser(req, res); if (!userId) return;
  const id = Number(req.params.id);
  const kind = String(req.body?.kind ?? "").toLowerCase() as EmailKind;
  const subject = String(req.body?.subject ?? "").trim();
  const body = String(req.body?.body ?? "").trim();
  const toEmail = String(req.body?.toEmail ?? "").trim() || null;
  const draftId = req.body?.draftId ? Number(req.body.draftId) : null;

  if (!Number.isFinite(id) || (kind !== "pre" && kind !== "post")) {
    res.status(400).json({ error: "id and kind required" }); return;
  }
  if (!subject || !body) { res.status(400).json({ error: "subject and body required" }); return; }

  try {
    if (draftId) {
      const [u] = await db.update(emailDraftsTable)
        .set({ subject, body, toEmail, updatedAt: new Date() })
        .where(eq(emailDraftsTable.id, draftId))
        .returning();
      res.json({ ok: true, draftId: u.id });
    } else {
      const [created] = await db.insert(emailDraftsTable).values({
        founderId: id, userId, kind, subject, body, toEmail,
      }).returning();
      res.json({ ok: true, draftId: created.id });
    }
  } catch (err) {
    req.log.error({ err }, "Failed to save draft");
    res.status(500).json({ error: "Failed to save draft" });
  }
});

// ─── GET /companies/:id/drafts ───────────────────────────────────────────
router.get("/companies/:id/drafts", async (req, res) => {
  const userId = await requireUser(req, res); if (!userId) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const drafts = await db
      .select()
      .from(emailDraftsTable)
      .where(eq(emailDraftsTable.founderId, id))
      .orderBy(desc(emailDraftsTable.createdAt));
    res.json({ drafts });
  } catch (err) {
    req.log.error({ err }, "Failed to load drafts");
    res.status(500).json({ error: "Failed to load drafts" });
  }
});

// ─── GET /ai/status — quick gate to know if Gemini is wired ─────────────
router.get("/ai/status", async (_req, res) => {
  res.json({ geminiConfigured: await isGeminiConfigured() });
});

// ─── POST /companies/:id/summarise-vision ────────────────────────────────
/**
 * Lazily AI-summarise the raw "About Startup" text into a 2-3 line vision.
 *
 * Called by the Sprint Data tab when it sees `vision` is null but
 * `visionRaw` is present. The result is cached on `founders.vision` so
 * subsequent opens don't re-spend Gemini quota.
 *
 * Body: {} (no input needed — pulls data from the company row)
 * Returns: { vision: string }
 *
 * Errors:
 *   400 — no visionRaw to summarise
 *   503 — Gemini not configured
 *   500 — Gemini call failed
 */
router.post("/companies/:id/summarise-vision", async (req, res) => {
  const userId = await requireUser(req, res); if (!userId) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  if (!await isGeminiConfigured()) {
    res.status(503).json({ error: "AI is not configured. The server admin must set GEMINI_API_KEY." });
    return;
  }

  try {
    const [c] = await db.select().from(foundersTable).where(eq(foundersTable.id, id)).limit(1);
    if (!c) { res.status(404).json({ error: "Company not found" }); return; }
    if (c.ownerId && c.ownerId !== userId) { res.status(403).json({ error: "Not authorized" }); return; }
    if (!c.visionRaw?.trim()) {
      res.status(400).json({ error: "No 'About the Startup' content found. Fill that tab in your sheet and re-sync." });
      return;
    }

    // If we already have a cached summary AND the raw hasn't changed,
    // short-circuit. (The frontend should also gate on this — defensive.)
    if (c.vision?.trim()) {
      res.json({ vision: c.vision, cached: true });
      return;
    }

    const vision = await summariseVision({
      companyName: c.companyName,
      founderName: c.name,
      rawAbout: c.visionRaw,
    });

    await db.update(foundersTable).set({ vision }).where(eq(foundersTable.id, id));
    res.json({ vision, cached: false });
  } catch (err) {
    req.log.error({ err }, "Vision summarise failed");
    const msg = err instanceof Error ? err.message : "Vision summarise failed";
    res.status(500).json({ error: msg });
  }
});

export default router;
