import { Router } from "express";
import { db, sprintsTable, foundersTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { google } from "googleapis";
import { getAuthedClient } from "../lib/google";

const router = Router();

type Event = {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  location: string | null;
  description: string;
  meetLink: string | null;
  attendees: string[];
  isAllDay: boolean;
  source: "google" | "sprints";
};

router.get("/calendar/events", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  // `?days=7` extends the window to a full week so the Dashboard can show
  // upcoming sessions, not just today. Default = 1 (today) for back compat.
  const days = Math.max(1, Math.min(30, parseInt(String(req.query.days ?? "1"), 10) || 1));
  const today = new Date().toISOString().split("T")[0];
  const dayStart = new Date(today + "T00:00:00.000Z");
  const dayEnd   = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + days);
  // For "1 day" mode, restrict end to end-of-today; for multi-day, give the full window
  if (days === 1) {
    dayEnd.setUTCHours(23, 59, 59, 999);
    dayEnd.setUTCDate(dayStart.getUTCDate());
  }

  // 1) Try Google Calendar
  try {
    const client = await getAuthedClient(userId);
    if (client) {
      const cal = google.calendar({ version: "v3", auth: client });
      const r = await cal.events.list({
        calendarId: "primary",
        timeMin: dayStart.toISOString(),
        timeMax: dayEnd.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
        maxResults: Math.min(250, days * 30),
      });
      const events: Event[] = (r.data.items ?? []).map(e => ({
        id: e.id ?? `g-${Math.random()}`,
        title: e.summary ?? "(no title)",
        startTime: e.start?.dateTime ?? e.start?.date ?? "",
        endTime:   e.end?.dateTime   ?? e.end?.date   ?? "",
        location: e.location ?? null,
        description: e.description ?? "",
        meetLink: e.hangoutLink ?? e.conferenceData?.entryPoints?.find(ep => ep.entryPointType === "video")?.uri ?? null,
        attendees: (e.attendees ?? []).map(a => a.email ?? "").filter(Boolean),
        isAllDay: Boolean(e.start?.date && !e.start?.dateTime),
        source: "google",
      }));
      res.json(events);
      return;
    }
  } catch (err) {
    req.log.warn({ err }, "Google Calendar fetch failed — falling back to sprints");
  }

  // 2) Fallback — sprints in the requested window for this consultant
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    const consultantName = user?.name ?? null;
    const windowStart = dayStart.toISOString().slice(0, 10);
    const windowEnd   = dayEnd.toISOString().slice(0, 10);

    // We pull a slightly bigger set and filter by date string in JS — sprintsTable
    // has scheduledDate as text, so SQL-side range filtering on text needs ISO
    // YYYY-MM-DD which it already uses.
    const allSprints = await db.select().from(sprintsTable).where(
      consultantName ? eq(sprintsTable.consultantName, consultantName) : undefined
    );
    const sprints = allSprints.filter(s =>
      s.scheduledDate >= windowStart && s.scheduledDate <= windowEnd
    );
    const events: Event[] = await Promise.all(sprints.map(async (sprint) => {
      const [founder] = await db.select().from(foundersTable).where(eq(foundersTable.id, sprint.founderId)).limit(1);
      const startTime = sprint.scheduledTime
        ? `${sprint.scheduledDate}T${sprint.scheduledTime}:00`
        : `${sprint.scheduledDate}T09:00:00`;
      const hourPart = sprint.scheduledTime
        ? String(parseInt(sprint.scheduledTime.split(":")[0]) + 2).padStart(2, "0")
        : "11";
      const minutePart = sprint.scheduledTime ? sprint.scheduledTime.split(":")[1] : "00";
      const endTime = sprint.endTime
        ? `${sprint.scheduledDate}T${sprint.endTime}:00`
        : `${sprint.scheduledDate}T${hourPart}:${minutePart}:00`;
      return {
        id: `sprint-${sprint.id}`,
        title: `T-Sprint: ${founder?.companyName ?? "Unknown"} — ${founder?.name ?? ""}`,
        startTime, endTime,
        location: sprint.meetLink ?? null,
        description: `T-Sprint session with ${founder?.name ?? "founder"} from ${founder?.companyName ?? ""}. Consultant: ${sprint.consultantName}`,
        meetLink: sprint.meetLink ?? null,
        attendees: [founder?.email ?? ""].filter(Boolean),
        isAllDay: false,
        source: "sprints",
      };
    }));
    res.json(events);
  } catch (err) {
    req.log.error({ err }, "Error fetching calendar events");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
