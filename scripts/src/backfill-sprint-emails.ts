// scripts/src/backfill-sprint-emails.ts
//
// ============================================================================
// Backfill historical pre-sprint emails from Gmail → sprint_emails table.
// ============================================================================
//
// Why we need it: prior to migration 010, your codebase sent pre-sprint
// emails via Gmail but didn't record the Message-ID. So existing sprints
// have no "thread anchor" — post-sprint emails for those sprints would
// send as fresh threads.
//
// This script recovers what it can by reading each consultant's Gmail
// Sent box and looking for messages addressed to founder emails we know
// about. Heuristic — not perfect — but recovers most threads in practice.
//
// Run it ONCE, after deploying migration 010, with:
//
//   pnpm tsx scripts/src/backfill-sprint-emails.ts --dry-run     # see what it would do
//   pnpm tsx scripts/src/backfill-sprint-emails.ts               # actually insert
//
// Idempotent — re-running won't create duplicates (sprint_emails has a
// UNIQUE (sprint_id, kind, sent_at) constraint and we use ON CONFLICT).
//
// Limitations:
//   • Only sees emails the consultant's Gmail OAuth tokens can read.
//   • Heuristic subject matching may miss off-template subjects. Edit
//     SUBJECT_PATTERNS below to widen the net.
//   • If an admin sent on behalf of another consultant, it'll get attributed
//     to whoever's tokens we use. Mostly fine — Thinking Spree is 10 people.
// ============================================================================

import { and, eq, gte, isNull, lte } from "drizzle-orm";

// ADAPT: import paths
import { db } from "../../artifacts/api-server/src/db.js";
import { sprints } from "@workspace/db/schema/sprints";
import { founders } from "@workspace/db/schema/founders";
import { users } from "@workspace/db/schema/users";
import { sprintEmails, latestSprintEmail } from "@workspace/db/schema/cohorts";

// ADAPT: your existing Gmail helper. We need a way to search Gmail with an
// arbitrary query and fetch headers. Most Gmail wrappers expose this.
import { searchGmailMessages, getGmailMessageHeaders } from "../../artifacts/api-server/src/lib/gmail.js";

// Tweak if your team uses different conventions for the pre-sprint subject.
const SUBJECT_PATTERNS = [
    /pre[- ]?sprint/i,
    /preparation/i,
    /sprint prep/i,
    /t[- ]?sprint/i,
];

const DRY_RUN = process.argv.includes("--dry-run");
const DAYS_BACK = Number(process.env.BACKFILL_DAYS_BACK ?? "365"); // default: last year

type SprintRow = {
    sprintId: number;
    sprintDate: Date;
    founderEmail: string | null;
    founder2Email: string | null;
    consultantUserId: number | null; // ADAPT: the user who owns/ran this sprint
};

async function main() {
    console.log(`▶ Backfill starting ${DRY_RUN ? "(DRY RUN)" : ""}`);
    console.log(`  Window: last ${DAYS_BACK} days`);

    const cutoff = new Date(Date.now() - DAYS_BACK * 86_400_000);

    // 1. Pull candidate sprints: anything that DOESN'T already have a
    //    pre-sprint email record in sprint_emails.
    //
    // ADAPT: the JOIN to founders / users below depends on your column names.
    // If sprints.consultantId or sprints.hostUserId is the right column for
    // "the user who sent the pre-sprint email", swap it in.
    const candidates = (await db
        .select({
            sprintId: sprints.id,
            sprintDate: sprints.sprintDate, // ADAPT: column name
            founderEmail: founders.email,
            founder2Email: founders.email2, // optional secondary contact
            consultantUserId: sprints.hostUserId, // ADAPT
        })
        .from(sprints)
        .innerJoin(founders, eq(founders.id, sprints.founderId))
        .leftJoin(
            latestSprintEmail,
            and(
                eq(latestSprintEmail.sprintId, sprints.id),
                eq(latestSprintEmail.kind, "pre-sprint"),
            ),
        )
        .where(
            and(
                gte(sprints.sprintDate, cutoff),
                lte(sprints.sprintDate, new Date()),
                isNull(latestSprintEmail.emailId), // not already backfilled
            ),
        )) as unknown as SprintRow[];

    console.log(`  Candidates: ${candidates.length} sprints with no pre-sprint email recorded`);

    if (candidates.length === 0) {
        console.log("✓ Nothing to backfill. All sprints already have pre-sprint email records.");
        return;
    }

    // Group by consultant so we open one Gmail session per person, not per sprint.
    const byConsultant = new Map<number, SprintRow[]>();
    for (const s of candidates) {
        if (!s.consultantUserId) continue;
        const arr = byConsultant.get(s.consultantUserId) ?? [];
        arr.push(s);
        byConsultant.set(s.consultantUserId, arr);
    }

    let matched = 0;
    let inserted = 0;
    let skipped = 0;

    for (const [consultantUserId, sprintList] of byConsultant) {
        // Confirm we have OAuth tokens for this consultant.
        const [consultant] = await db.select().from(users).where(eq(users.id, consultantUserId)).limit(1);
        if (!consultant) {
            console.warn(`  ⚠ Consultant user ${consultantUserId} not found, skipping ${sprintList.length} sprints`);
            skipped += sprintList.length;
            continue;
        }

        console.log(`\n  Consultant: ${consultant.email} (${sprintList.length} sprints)`);

        for (const s of sprintList) {
            const founderEmails = [s.founderEmail, s.founder2Email].filter(Boolean) as string[];
            if (founderEmails.length === 0) {
                skipped++;
                continue;
            }

            // Gmail search: messages sent TO any founder email, in a window
            // around the sprint date (-30 to -1 days — pre-sprint emails go
            // out before the sprint).
            const windowAfter = new Date(s.sprintDate.getTime() - 30 * 86_400_000);
            const windowBefore = new Date(s.sprintDate.getTime() - 1 * 86_400_000);
            const query = [
                "in:sent",
                `after:${ymd(windowAfter)}`,
                `before:${ymd(windowBefore)}`,
                `(${founderEmails.map((e) => `to:${e}`).join(" OR ")})`,
            ].join(" ");

            const hits = await searchGmailMessages({ userId: consultantUserId, query, maxResults: 5 });
            if (!hits || hits.length === 0) continue;

            // Filter to ones whose subject matches the pre-sprint patterns.
            let bestMatch: { messageId: string; threadId: string; subject: string; sentAt: Date } | null = null;
            for (const h of hits) {
                const headers = await getGmailMessageHeaders({ userId: consultantUserId, messageId: h.id });
                const subject = headers.subject ?? "";
                if (!SUBJECT_PATTERNS.some((re) => re.test(subject))) continue;
                bestMatch = {
                    messageId: headers.messageId ?? "",
                    threadId: h.threadId,
                    subject,
                    sentAt: headers.date ?? s.sprintDate,
                };
                break; // first match wins (most recent — Gmail returns newest first)
            }

            if (!bestMatch || !bestMatch.messageId) continue;
            matched++;

            if (DRY_RUN) {
                console.log(`    [would insert] sprint ${s.sprintId} ← "${bestMatch.subject}"`);
                continue;
            }

            await db
                .insert(sprintEmails)
                .values({
                    sprintId: s.sprintId,
                    kind: "pre-sprint",
                    recipientsTo: founderEmails,
                    recipientsCc: [],
                    recipientsBcc: [],
                    subject: bestMatch.subject,
                    bodyHtml: "<!-- backfilled from Gmail; original body not recovered -->",
                    bodyText: null,
                    messageId: bestMatch.messageId,
                    inReplyTo: null,
                    referencesIds: [],
                    gmailThreadId: bestMatch.threadId,
                    sentBy: consultantUserId,
                    sentAt: bestMatch.sentAt,
                })
                .onConflictDoNothing();

            inserted++;
        }
    }

    console.log(`\n────────────────────────────────────────────`);
    console.log(`  Matched: ${matched}`);
    console.log(`  Inserted: ${inserted}${DRY_RUN ? " (dry-run, nothing actually written)" : ""}`);
    console.log(`  Skipped (no consultant / no founder email): ${skipped}`);
    console.log(`  Unmatched candidates: ${candidates.length - matched - skipped}`);
    console.log(`✓ Done`);
}

function ymd(d: Date): string {
    // Gmail search wants YYYY/MM/DD
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

main().catch((err) => {
    console.error("✗ Backfill failed:", err);
    process.exit(1);
});
