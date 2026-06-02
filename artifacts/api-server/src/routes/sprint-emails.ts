// artifacts/api-server/src/routes/sprint-emails.ts
//
// ============================================================================
// Sprint email send — multi-recipient + threading
// ============================================================================
//
// Endpoints (all gated by requireAuth):
//
//   GET    /api/sprints/:id/emails             — list of emails sent for this sprint
//   GET    /api/sprints/:id/emails/thread-anchor?kind=pre-sprint
//          → returns the threading anchor a post-sprint reply should use
//   POST   /api/sprints/:id/emails             — send an email
//          body: {
//            kind: 'pre-sprint' | 'post-sprint' | 'check-in' | 'other',
//            to: string[], cc?: string[], bcc?: string[],
//            subject: string, bodyHtml: string,
//            threadReplyTo?: 'pre-sprint' | null   // when set, look up that
//                                                  // sprint email and thread on it.
//          }
//
// ADAPT note: this assumes you have an existing sendViaGmail() helper that
// uses the caller's OAuth tokens (per CHANGES.md). If yours is named
// differently, only the line marked // ADAPT: send needs to change.
// ============================================================================

import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { sprintEmails } from "@workspace/db/schema/cohorts";
import { sprints } from "@workspace/db/schema/sprints";
import {
    buildRawMime,
    buildReplyHeaders,
    generateMessageId,
    normalizeRecipients,
    type ThreadAnchor,
} from "../lib/email-threading.js";

// ADAPT: your existing Gmail helper
import { sendViaGmail } from "../lib/gmail.js";

export const sprintEmailsRouter = Router({ mergeParams: true });

// ─── List ────────────────────────────────────────────────────────────────
sprintEmailsRouter.get("/", requireAuth, async (req, res) => {
    const sprintId = Number(req.params.id);
    const rows = await db
        .select()
        .from(sprintEmails)
        .where(eq(sprintEmails.sprintId, sprintId))
        .orderBy(desc(sprintEmails.sentAt));
    res.json({ emails: rows });
});

// ─── Thread anchor (used by the composer to render "Replying to ...") ────
sprintEmailsRouter.get("/thread-anchor", requireAuth, async (req, res) => {
    const sprintId = Number(req.params.id);
    const kind = String(req.query.kind ?? "pre-sprint");

    const [anchor] = await db
        .select()
        .from(sprintEmails)
        .where(and(eq(sprintEmails.sprintId, sprintId), eq(sprintEmails.kind, kind)))
        .orderBy(desc(sprintEmails.sentAt))
        .limit(1);

    if (!anchor) return res.json({ anchor: null });

    res.json({
        anchor: {
            id: anchor.id,
            messageId: anchor.messageId,
            gmailThreadId: anchor.gmailThreadId,
            references: anchor.referencesIds,
            subject: anchor.subject,
            sentAt: anchor.sentAt,
            recipientsTo: anchor.recipientsTo,
            recipientsCc: anchor.recipientsCc,
        },
    });
});

// ─── Send ────────────────────────────────────────────────────────────────
const SendBody = z.object({
    kind: z.enum(["pre-sprint", "post-sprint", "check-in", "other"]),
    to: z.array(z.string()).min(1, "At least one To recipient is required").max(50),
    cc: z.array(z.string()).max(50).optional(),
    bcc: z.array(z.string()).max(50).optional(),
    subject: z.string().min(1).max(998),
    bodyHtml: z.string().min(1),
    bodyText: z.string().optional(),
    /** If set, fetch that email and thread the new one on its Message-ID. */
    threadReplyTo: z.enum(["pre-sprint", "post-sprint", "check-in", "other"]).nullable().optional(),
});

sprintEmailsRouter.post("/", requireAuth, async (req, res) => {
    const sprintId = Number(req.params.id);
    const parsed = SendBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    let to: string[], cc: string[], bcc: string[];
    try {
        to = normalizeRecipients(parsed.data.to);
        cc = normalizeRecipients(parsed.data.cc);
        bcc = normalizeRecipients(parsed.data.bcc);
    } catch (err) {
        return res.status(400).json({ error: err instanceof Error ? err.message : "Bad recipient" });
    }
    if (to.length === 0) return res.status(400).json({ error: "At least one valid To recipient is required" });

    // Confirm the sprint exists (and the caller is allowed to act on it —
    // your existing requireAuth+row policy decides; we just 404 on missing).
    const [sprint] = await db.select().from(sprints).where(eq(sprints.id, sprintId)).limit(1);
    if (!sprint) return res.status(404).json({ error: "Sprint not found" });

    // Look up the threading anchor, if requested.
    let anchor: ThreadAnchor | null = null;
    if (parsed.data.threadReplyTo) {
        const [a] = await db
            .select()
            .from(sprintEmails)
            .where(and(eq(sprintEmails.sprintId, sprintId), eq(sprintEmails.kind, parsed.data.threadReplyTo)))
            .orderBy(desc(sprintEmails.sentAt))
            .limit(1);
        if (a) {
            anchor = {
                messageId: a.messageId,
                gmailThreadId: a.gmailThreadId,
                references: a.referencesIds,
                subject: a.subject,
            };
        }
    }

    // Compute threading headers + subject.
    const { subject, headers, gmailThreadId } = buildReplyHeaders(anchor, parsed.data.subject);

    // Generate our own Message-ID so we can record it. Gmail will accept it
    // and use it; we also keep it locally so the next post-sprint email can
    // thread on it.
    const messageId = generateMessageId();

    // Build the MIME payload.
    const raw = buildRawMime({
        from: req.user!.email,
        to,
        cc,
        bcc,
        subject,
        bodyHtml: parsed.data.bodyHtml,
        bodyText: parsed.data.bodyText,
        messageId,
        extraHeaders: headers,
    });

    // ADAPT: send. Replace this with whatever your existing Gmail helper takes.
    // Most send helpers accept the threadId as a separate arg — pass it
    // through so Gmail forces threading even if the recipient strips headers.
    const sendResult = await sendViaGmail({
        userId: req.user!.id,
        rawMime: raw,
        threadId: gmailThreadId ?? undefined,
    });

    // Persist.
    const [saved] = await db
        .insert(sprintEmails)
        .values({
            sprintId,
            kind: parsed.data.kind,
            recipientsTo: to,
            recipientsCc: cc,
            recipientsBcc: bcc,
            subject,
            bodyHtml: parsed.data.bodyHtml,
            bodyText: parsed.data.bodyText ?? null,
            messageId,
            inReplyTo: anchor?.messageId ?? null,
            referencesIds: anchor ? [...anchor.references, anchor.messageId].filter(Boolean) as string[] : [],
            gmailThreadId: sendResult.threadId ?? gmailThreadId ?? null,
            sentBy: req.user!.id,
        })
        .returning();

    res.status(201).json({ email: saved });
});
