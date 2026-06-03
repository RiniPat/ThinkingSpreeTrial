import { Router } from "express";
import { db, sprintsTable, emailLogsTable, usersTable, foundersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { google } from "googleapis";
import { getAuthedClient } from "../lib/google";

const router = Router();

/**
 * Builds an RFC 5322 message and base64url-encodes it for the Gmail API.
 * Used by /emails/send when the consultant has Gmail connected.
 *
 * Gmail expects `raw` as base64url, NOT plain base64 — so trailing `=` are
 * stripped and `+/` are replaced with `-_`.
 */
function buildRawMessage(opts: { from: string; to: string; subject: string; body: string }): string {
  const lines = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    opts.body,
  ];
  const raw = lines.join("\r\n");
  return Buffer.from(raw, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

router.post("/emails/send", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const { to, subject, body, sprintId, emailType } = req.body;
  if (!to || !subject || !body || !sprintId || !emailType) {
    res.status(400).json({ error: "to, subject, body, sprintId and emailType are required" });
    return;
  }
  try {
    // Try Gmail first. If it fails (not connected, scope missing, etc.) we
    // fall back to logging-only so the workflow doesn't fully break.
    let messageId = `local_${Date.now()}`;
    let sentVia: "gmail" | "simulated" = "simulated";
    let sendError: string | null = null;
    try {
      const client = await getAuthedClient(userId);
      if (client) {
        const gmail = google.gmail({ version: "v1", auth: client });
        // Use the consultant's own Gmail address as the From: header
        const profile = await gmail.users.getProfile({ userId: "me" });
        const from = profile.data.emailAddress ?? "me";
        const raw = buildRawMessage({ from, to, subject, body });
        const send = await gmail.users.messages.send({
          userId: "me",
          requestBody: { raw },
        });
        messageId = send.data.id ?? messageId;
        sentVia = "gmail";
      }
    } catch (err: any) {
      sendError = err?.errors?.[0]?.message ?? err?.message ?? "Gmail send failed";
      req.log.warn({ err, sprintId, emailType }, "Gmail send failed — falling back to log-only");
    }

    // Always record the email — even if Gmail send failed, we log the attempt
    // so the consultant can see what was attempted.
    await db.insert(emailLogsTable).values({
      sprintId,
      emailType,
      toEmail: to,
      subject,
      body,
      messageId,
    });

    // Stamp the sprint so the UI can show "Sent" badges
    const now = new Date();
    if (emailType === "pre_sprint") {
      await db.update(sprintsTable).set({ preEmailSentAt: now }).where(eq(sprintsTable.id, sprintId));
    } else if (emailType === "post_sprint") {
      // Post-sprint send implies the session is complete
      await db.update(sprintsTable).set({ postEmailSentAt: now, status: "completed" }).where(eq(sprintsTable.id, sprintId));
    }

    req.log.info({ sprintId, emailType, to, sentVia }, "Email send recorded");

    res.json({
      success: sentVia === "gmail",
      simulated: sentVia === "simulated",
      messageId,
      sentAt: now.toISOString(),
      ...(sendError ? { warning: `Logged only — Gmail send failed: ${sendError}` } : {}),
    });
  } catch (err) {
    req.log.error({ err }, "Error sending email");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
