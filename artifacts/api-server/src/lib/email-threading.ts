// artifacts/api-server/src/lib/email-threading.ts
//
// ============================================================================
// Email threading helpers — RFC 5322 + Gmail API.
// ============================================================================
//
// Email threading is NOT about the subject line. Inboxes thread on three
// headers:
//
//   Message-ID:   <unique-id@your-domain>            (set by sender, sticks forever)
//   In-Reply-To:  <message-id-of-thing-being-replied-to>
//   References:   <oldest>...<newest>                (chain of ancestors)
//
// To make the post-sprint email show up under the pre-sprint email's
// existing conversation in Gmail / Outlook / Apple Mail, we need:
//
//   1. To have stored the pre-sprint email's Message-ID when WE sent it
//      → done by sprint_emails.message_id in migration 010
//   2. To put that Message-ID in In-Reply-To and References on the new email
//   3. Subject prefixed with "Re:" — cosmetic, not what does the threading
//
// On Gmail specifically we have a shortcut: pass `threadId` to
// gmail.users.messages.send and it bypasses header inspection entirely. We
// store gmail_thread_id and prefer it when available; we set the RFC headers
// too as a belt-and-braces fallback for non-Gmail recipients.
// ============================================================================

import { randomBytes } from "node:crypto";

export type ThreadAnchor = {
    messageId: string | null;
    gmailThreadId: string | null;
    references: string[];
    subject: string;
};

/**
 * Build a new RFC 5322 Message-ID. Stable across sends — use this when
 * the upstream provider doesn't return one.
 */
export function generateMessageId(domain = "thinkingspree.com"): string {
    const rand = randomBytes(12).toString("hex");
    return `<${Date.now()}.${rand}@${domain}>`;
}

/**
 * Given the anchor email we want to reply to, produce the threading
 * headers (and subject) for the new email.
 */
export function buildReplyHeaders(anchor: ThreadAnchor | null, newSubject: string) {
    if (!anchor || !anchor.messageId) {
        // No anchor or we never recorded its Message-ID — send as a fresh
        // conversation. The caller can still add "Re:" to the subject if
        // they want, but threading won't happen, so don't.
        return {
            subject: newSubject,
            headers: {} as Record<string, string>,
            gmailThreadId: null as string | null,
        };
    }

    // Build References chain: existing references + the parent's message-id.
    const refs = [...anchor.references, anchor.messageId];

    // Subject: prepend "Re: " if it isn't already there.
    const subject =
        /^re:\s/i.test(newSubject) ? newSubject : `Re: ${newSubject.replace(/^(re:\s*)+/i, "")}`;

    return {
        subject,
        headers: {
            "In-Reply-To": anchor.messageId,
            References: refs.join(" "),
        },
        gmailThreadId: anchor.gmailThreadId,
    };
}

/**
 * Build a complete RFC 5322 MIME message ready to be base64url-encoded
 * for `gmail.users.messages.send`. Multi-recipient aware (To/Cc/Bcc as
 * arrays).
 *
 * If you use nodemailer / SendGrid / Postmark instead, you don't need this
 * function — pass the headers from buildReplyHeaders() into your SDK's
 * `headers` option.
 */
export function buildRawMime(args: {
    from: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    bodyHtml: string;
    bodyText?: string;
    messageId: string;
    extraHeaders?: Record<string, string>;
}): string {
    const { from, to, cc = [], bcc = [], subject, bodyHtml, bodyText, messageId, extraHeaders = {} } = args;

    const boundary = `tsp-${randomBytes(8).toString("hex")}`;

    const headers: Record<string, string> = {
        From: from,
        To: to.join(", "),
        Subject: encodeMimeWord(subject),
        "Message-ID": messageId,
        "MIME-Version": "1.0",
        "Content-Type": `multipart/alternative; boundary="${boundary}"`,
        ...extraHeaders,
    };
    if (cc.length) headers.Cc = cc.join(", ");
    if (bcc.length) headers.Bcc = bcc.join(", ");

    const headerBlock = Object.entries(headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\r\n");

    const plain = bodyText ?? htmlToPlain(bodyHtml);

    const body = [
        `--${boundary}`,
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: 7bit",
        "",
        plain,
        "",
        `--${boundary}`,
        "Content-Type: text/html; charset=UTF-8",
        "Content-Transfer-Encoding: 7bit",
        "",
        bodyHtml,
        "",
        `--${boundary}--`,
    ].join("\r\n");

    return `${headerBlock}\r\n\r\n${body}`;
}

/** Encode subject line for non-ASCII characters per RFC 2047. */
function encodeMimeWord(s: string): string {
    // ASCII fast path — most subjects.
    // eslint-disable-next-line no-control-regex
    if (/^[\x00-\x7F]*$/.test(s)) return s;
    const encoded = Buffer.from(s, "utf-8").toString("base64");
    return `=?UTF-8?B?${encoded}?=`;
}

/** Cheap HTML→text for the plain-text MIME part. */
function htmlToPlain(html: string): string {
    return html
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

/**
 * Validate + normalise a list of email addresses from a UI chip field.
 * Trims, lowercases, dedupes, and rejects obviously-bad entries.
 *
 * Throws on invalid input so the route handler can return 400 with the
 * exact offending string.
 */
export function normalizeRecipients(input: string[] | undefined | null): string[] {
    if (!input || !Array.isArray(input)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of input) {
        const e = String(raw ?? "").trim().toLowerCase();
        if (!e) continue;
        // Permissive but catches the obvious typos. Full RFC validation
        // would reject legal-but-weird emails, which is worse than letting
        // SMTP bounce the rare bad one.
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
            throw new Error(`Invalid email address: ${raw}`);
        }
        if (seen.has(e)) continue;
        seen.add(e);
        out.push(e);
    }
    return out;
}
