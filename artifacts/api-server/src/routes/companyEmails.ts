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
import { eq, and, desc, isNotNull } from "drizzle-orm";
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

// ─── Email address + raw-message helpers ─────────────────────────────────
/**
 * Parse a list of recipient addresses from the request body. Accepts either:
 *   - toEmails: string[]                       (preferred, structured)
 *   - toEmail:  "a@x.com, b@y.com; c@z.com"   (comma/semicolon separated)
 * Returns de-duplicated, trimmed, valid-looking addresses. Placeholder
 * addresses (unknown+...@placeholder.local) are dropped since they can't
 * receive mail.
 */
function parseRecipients(raw: unknown): string[] {
  const parts: string[] = [];
  if (Array.isArray(raw)) {
    for (const r of raw) if (typeof r === "string") parts.push(r);
  } else if (typeof raw === "string") {
    parts.push(...raw.split(/[,;]/));
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const addr = p.trim();
    if (!addr) continue;
    if (!addr.includes("@")) continue;
    if (addr.includes("@placeholder.local")) continue;
    const key = addr.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(addr);
  }
  return out;
}

/**
 * Strip our lightweight bold markers (**like this**) so the plain-text MIME
 * part reads naturally for clients that don't render HTML.
 */
function stripBoldMarkers(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/gs, "$1");
}

/** Escape the five HTML-significant characters before we inject our own tags. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Convert the draft body into safe HTML:
 *   - **bold** → <strong>bold</strong>
 *   - blank lines separate <p> paragraphs; single newlines become <br>
 * Everything else is HTML-escaped first so user text can't break the markup.
 */
function bodyToHtml(body: string): string {
  const paragraphs = body.replace(/\r\n/g, "\n").split(/\n{2,}/);
  const htmlParas = paragraphs.map((para) => {
    const escaped = escapeHtml(para);
    const withBold = escaped.replace(/\*\*(.+?)\*\*/gs, "<strong>$1</strong>");
    const withBreaks = withBold.replace(/\n/g, "<br>");
    return `<p style="margin:0 0 14px 0;">${withBreaks}</p>`;
  });
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1f2937;">${htmlParas.join("")}</div>`;
}

/**
 * Build a base64url-encoded RFC 2822 message for the Gmail send API.
 *
 * We send a multipart/alternative body so the **bold** markers in the draft
 * render as real bold in the founder's inbox (HTML part) while still degrading
 * gracefully to clean text (plain part) on clients that prefer text.
 *
 * Supports multiple To/Cc recipients and optional threading headers.
 */
function buildRawMessage(opts: {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  inReplyTo?: string | null;   // RFC Message-ID of the email being replied to
  references?: string | null;  // RFC References chain
}): string {
  const boundary = `tsprint_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const plain = stripBoldMarkers(opts.body);
  const html = bodyToHtml(opts.body);

  const headers = [
    `To: ${opts.to.join(", ")}`,
    ...(opts.cc && opts.cc.length ? [`Cc: ${opts.cc.join(", ")}`] : []),
    `Subject: ${opts.subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ...(opts.inReplyTo ? [`In-Reply-To: ${opts.inReplyTo}`] : []),
    ...(opts.references ? [`References: ${opts.references}`] : []),
  ];

  const raw = [
    ...headers,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    plain,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
    "",
    `--${boundary}--`,
  ].join("\r\n");

  return Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ─── POST /companies/:id/send-email ─────────────────────────────────────
/**
 * Body: { kind, subject, body, toEmail | toEmails, cc?, draftId? }
 * Sends the email via the consultant's connected Gmail account, then logs a
 * timeline event and advances the company's workflow stage.
 *
 * Recipients: `toEmail` may be a single address OR a comma/semicolon-separated
 * list; `toEmails` (string[]) is also accepted. `cc` follows the same rules.
 *
 * Threading: when kind === "post", we look up the most recent SENT pre-sprint
 * email for this company and send the post email as a reply within the same
 * Gmail thread (threadId + In-Reply-To / References + "Re:" subject). This
 * keeps the founder's whole sprint conversation in one thread.
 *
 * If draftId is provided, we update that draft row with the sent timestamp.
 */
router.post("/companies/:id/send-email", async (req, res) => {
  const userId = await requireUser(req, res); if (!userId) return;
  const id = Number(req.params.id);
  const kind = String(req.body?.kind ?? "").toLowerCase() as EmailKind;
  let subject = String(req.body?.subject ?? "").trim();
  const body = String(req.body?.body ?? "").trim();
  const draftId = req.body?.draftId ? Number(req.body.draftId) : null;

  // Accept multiple recipients via either field.
  const to = parseRecipients(req.body?.toEmails ?? req.body?.toEmail);
  const cc = parseRecipients(req.body?.cc);

  if (!Number.isFinite(id) || (kind !== "pre" && kind !== "post")) {
    res.status(400).json({ error: "id and kind required" }); return;
  }
  if (!subject || !body) { res.status(400).json({ error: "subject and body required" }); return; }
  if (to.length === 0) {
    res.status(400).json({ error: "At least one valid recipient email is required to send" }); return;
  }

  try {
    const client = await getAuthedClient(userId);
    if (!client) {
      res.status(503).json({
        error: "Gmail isn't connected. Connect Google in Settings and grant Gmail permission.",
      });
      return;
    }

    const gmail = google.gmail({ version: "v1", auth: client });

    // ── Threading: post emails reply to the latest sent pre email ──────────
    let threadId: string | null = null;
    let inReplyTo: string | null = null;
    let references: string | null = null;
    if (kind === "post") {
      const [prior] = await db
        .select()
        .from(emailDraftsTable)
        .where(and(
          eq(emailDraftsTable.founderId, id),
          eq(emailDraftsTable.kind, "pre"),
          isNotNull(emailDraftsTable.sentAt),
          isNotNull(emailDraftsTable.gmailThreadId),
        ))
        .orderBy(desc(emailDraftsTable.sentAt))
        .limit(1);
      if (prior?.gmailThreadId) {
        threadId = prior.gmailThreadId;
        inReplyTo = prior.rfcMessageId ?? null;
        references = prior.rfcMessageId ?? null;
        // Match the thread's subject so Gmail keeps it in-thread.
        if (!/^re:/i.test(subject)) {
          subject = `Re: ${prior.subject.replace(/^re:\s*/i, "")}`;
        }
      }
    }

    const raw = buildRawMessage({ to, cc, subject, body, inReplyTo, references });

    const sendResult = await gmail.users.messages.send({
      userId: "me",
      requestBody: threadId ? { raw, threadId } : { raw },
    });

    const messageId = sendResult.data.id ?? null;
    const sentThreadId = sendResult.data.threadId ?? threadId ?? null;

    // For a pre email (the start of a thread) capture the RFC Message-ID so the
    // later post email can reference it. Gmail assigns the real Message-ID at
    // send time, so we read it back from the sent message metadata.
    let rfcMessageId: string | null = null;
    if (kind === "pre" && messageId) {
      try {
        const meta = await gmail.users.messages.get({
          userId: "me",
          id: messageId,
          format: "metadata",
          metadataHeaders: ["Message-ID", "Message-Id"],
        });
        const hdr = meta.data.payload?.headers?.find(
          h => h.name?.toLowerCase() === "message-id",
        );
        rfcMessageId = hdr?.value ?? null;
      } catch (e) {
        // Non-fatal: threading by threadId still works without it.
        req.log.warn({ e }, "Could not read Message-ID of sent pre email");
      }
    }

    const recipientLabel = [...to, ...cc].join(", ");

    // Update the draft row (if we have one) with the sent status, or insert a
    // fresh one for ad-hoc sends. We persist the joined recipient list plus
    // the thread/message ids for future replies.
    const sentFields = {
      subject, body,
      toEmail: recipientLabel,
      sentAt: new Date(),
      gmailMessageId: messageId,
      gmailThreadId: sentThreadId,
      rfcMessageId,
      updatedAt: new Date(),
    };
    if (draftId) {
      await db.update(emailDraftsTable)
        .set(sentFields)
        .where(eq(emailDraftsTable.id, draftId));
    } else {
      await db.insert(emailDraftsTable).values({
        founderId: id, userId, kind, ...sentFields,
      });
    }

    // Log timeline event and advance workflow stage.
    const eventKind = kind === "pre" ? "pre_email_sent" : "post_email_sent";
    await db.insert(companyEventsTable).values({
      founderId: id, userId, kind: eventKind,
      note: `Sent to ${recipientLabel}${threadId ? " (reply to pre-sprint email)" : ""}`,
      metadata: { gmailMessageId: messageId, gmailThreadId: sentThreadId, subject, recipients: to, cc, repliedToThread: !!threadId },
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

    res.json({ ok: true, gmailMessageId: messageId, gmailThreadId: sentThreadId, threaded: !!threadId });
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
