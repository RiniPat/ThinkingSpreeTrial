/**
 * Dashboard stats endpoint — derives the monthly sprint counts from the
 * signed-in consultant's Google Calendar.
 *
 * Rule: any calendar event whose title (summary) starts with or contains
 * "T-Sprint for" is treated as a scheduled sprint session. This matches the
 * naming convention the consultants use when they create sessions.
 *
 * Counts:
 *   - my_t_sprints       — all "T-Sprint for ..." events this calendar month
 *   - scheduled          — those events whose start is in the future
 *   - completed          — those events whose start is in the past
 *                          AND for which a post_email_sent event exists in
 *                          our DB (the spec: "post-sprint email sent ⇒ completed")
 *   - completion_rate    — completed / total (this month)
 *   - emails_sent_month  — count of email_drafts.sent_at this month for this user
 *   - upcoming_this_week — sprint events scheduled for the next 7 days
 */
import { Router } from "express";
import { db, foundersTable, companyEventsTable, emailDraftsTable, calendarSprintMarksTable } from "@workspace/db";
import { and, eq, gte, inArray, lt, ne } from "drizzle-orm";
import { google } from "googleapis";
import { getAuthedClient } from "../lib/google";

const router = Router();

const SPRINT_TITLE_RX = /\bt[- ]?sprint(?:\s+for\b)?/i;

type CalEvent = {
  id: string;
  title: string;
  startISO: string;
  endISO: string;
  isPast: boolean;
};

/**
 * Pulls EVERY event in this calendar month from the consultant's primary
 * calendar (not just title matches) so the caller can classify them as sprints
 * via the title rule and/or manual marks. Returns [] if Calendar isn't
 * connected, so the dashboard degrades gracefully.
 */
async function fetchMonthEvents(userId: number, now = new Date()): Promise<CalEvent[]> {
  try {
    const client = await getAuthedClient(userId);
    if (!client) return [];

    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end   = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    end.setMilliseconds(end.getMilliseconds() - 1);

    const cal = google.calendar({ version: "v3", auth: client });
    const r = await cal.events.list({
      calendarId: "primary",
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250,
    });

    const items = r.data.items ?? [];
    return items.map(e => {
      const startISO = e.start?.dateTime ?? e.start?.date ?? "";
      const endISO   = e.end?.dateTime   ?? e.end?.date   ?? "";
      const startMs = startISO ? new Date(startISO).getTime() : 0;
      return {
        id: e.id ?? "",
        title: e.summary ?? "",
        startISO,
        endISO,
        isPast: startMs > 0 && startMs < now.getTime(),
      };
    });
  } catch {
    // Calendar unauthed or token expired — fall back silently.
    return [];
  }
}

router.get("/stats/dashboard", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - now.getDay()); startOfWeek.setHours(0,0,0,0);
    const endOfWeek   = new Date(startOfWeek); endOfWeek.setDate(startOfWeek.getDate() + 7);

    // 1) Calendar-derived sprint counts (this month) — auto (title rule) plus
    //    manual marks the consultant has set.
    const allEvents = await fetchMonthEvents(userId, now);
    const markRows = await db
      .select()
      .from(calendarSprintMarksTable)
      .where(eq(calendarSprintMarksTable.userId, userId));
    const markByEvent = new Map(markRows.map(m => [m.googleEventId, m.marked]));

    // An event is a sprint if a manual mark says so; otherwise fall back to the
    // title rule. A manual mark of `false` overrides an auto title match.
    const isSprint = (e: CalEvent): boolean => {
      const mark = markByEvent.get(e.id);
      if (mark !== undefined) return mark;
      return SPRINT_TITLE_RX.test(e.title);
    };
    const isManual = (e: CalEvent): boolean => markByEvent.get(e.id) === true && !SPRINT_TITLE_RX.test(e.title);

    const sprintEvents = allEvents.filter(isSprint);
    const otherEvents  = allEvents.filter(e => !isSprint(e));
    const myTSprints = sprintEvents.length;
    const scheduled  = sprintEvents.filter(e => !e.isPast).length;

    // "Completed" requires that the consultant has sent the post-sprint email
    // for the company. We can't match calendar events to companies perfectly,
    // so we use a DB count: how many post_email_sent events happened this
    // month for companies this consultant owns.
    let completed = 0;
    const ownedCompanies = await db
      .select({ id: foundersTable.id })
      .from(foundersTable)
      .where(eq(foundersTable.ownerId, userId));
    const ownedIds = ownedCompanies.map(c => c.id);
    if (ownedIds.length > 0) {
      const completedRows = await db
        .select({ id: companyEventsTable.id })
        .from(companyEventsTable)
        .where(and(
          inArray(companyEventsTable.founderId, ownedIds),
          eq(companyEventsTable.kind, "post_email_sent"),
          gte(companyEventsTable.occurredAt, startOfMonth),
          lt(companyEventsTable.occurredAt, startOfNextMonth),
        ));
      completed = completedRows.length;
    }

    // Completion rate
    const completionRate = myTSprints > 0
      ? Math.round((completed / myTSprints) * 100)
      : 0;

    // Emails sent this month — all drafts (pre or post) whose sent_at is in this month
    let emailsSentMonth = 0;
    const sent = await db
      .select({ id: emailDraftsTable.id })
      .from(emailDraftsTable)
      .where(and(
        eq(emailDraftsTable.userId, userId),
        gte(emailDraftsTable.sentAt, startOfMonth),
        lt(emailDraftsTable.sentAt, startOfNextMonth),
      ));
    emailsSentMonth = sent.length;

    // Upcoming this week
    const upcomingThisWeek = sprintEvents.filter(e => {
      if (!e.startISO) return false;
      const d = new Date(e.startISO);
      return d >= now && d <= endOfWeek;
    }).length;

    res.json({
      myTSprints,
      scheduled,
      completed,
      completionRate,
      emailsSentMonth,
      upcomingThisWeek,
      // Echo what we found so the dashboard can also show a small list
      sprintEvents: sprintEvents.map(e => ({
        id: e.id, title: e.title, startISO: e.startISO, endISO: e.endISO, isPast: e.isPast,
        manual: isManual(e),
      })),
      // Non-sprint events this month, so the dashboard can offer "Mark as
      // T-Sprint" for sessions that aren't named "T-Sprint for ...".
      otherEvents: otherEvents.map(e => ({
        id: e.id, title: e.title, startISO: e.startISO, endISO: e.endISO, isPast: e.isPast,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to compute dashboard stats");
    res.status(500).json({ error: "Failed to compute dashboard stats" });
  }
});

export default router;
