import { pgTable, serial, integer, text, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Manual calendar → sprint marks.
 *
 * The dashboard auto-detects sprint sessions by the calendar event title
 * ("T-Sprint for ..."). But consultants don't always name events that way, so
 * those sessions get missed. This table lets a consultant manually flag ANY
 * Google Calendar event as a T-Sprint (or un-flag a false positive), keyed by
 * the Google event id. We snapshot the title/time so the dashboard can show the
 * mark even if the event later changes or Calendar is briefly unreachable.
 *
 * `marked = true`  → treat this event as a sprint (manual add).
 * `marked = false` → explicitly NOT a sprint (overrides an auto title match).
 */
export const calendarSprintMarksTable = pgTable("calendar_sprint_marks", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  googleEventId: text("google_event_id").notNull(),
  title: text("title"),
  startIso: text("start_iso"),
  endIso: text("end_iso"),
  marked: boolean("marked").notNull().default(true),
  // Optional link to a company so "mark done" can update the right venture.
  founderId: integer("founder_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // One mark per (user, event).
  userEventUx: uniqueIndex("calendar_sprint_marks_user_event_ux").on(t.userId, t.googleEventId),
}));

export const insertCalendarSprintMarkSchema = createInsertSchema(calendarSprintMarksTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertCalendarSprintMark = z.infer<typeof insertCalendarSprintMarkSchema>;
export type CalendarSprintMark = typeof calendarSprintMarksTable.$inferSelect;
