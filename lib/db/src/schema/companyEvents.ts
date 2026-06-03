import { pgTable, serial, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Append-only timeline of "things that happened" to a company.
 *
 * Each upload, email draft, email send, sprint completion, etc. logs a row
 * here. The Company detail page renders these as a vertical tracker so the
 * consultant can see "pre-email sent on 10 Jun, sprint completed on 12 Jun,
 * post-email sent on 13 Jun" at a glance.
 *
 * We never UPDATE rows — only INSERT — so the tracker is a true audit log.
 */
export const companyEventsTable = pgTable("company_events", {
  id: serial("id").primaryKey(),
  founderId: integer("founder_id").notNull(),
  userId: integer("user_id"),
  // Optional link to a sprint_session (v5.2). NULL for company-level
  // events not tied to a specific session.
  sessionId: integer("session_id"),
  /**
   * Kind values:
   *   'template_uploaded'   — consultant uploaded a Sprint Template xlsx
   *   'pre_email_drafted'   — AI generated a pre-sprint email (not yet sent)
   *   'pre_email_sent'      — pre-sprint email sent via Gmail
   *   'sprint_scheduled'    — sprint added to Google Calendar
   *   'sprint_completed'    — consultant marked the sprint complete
   *   'post_email_drafted'  — AI generated a post-sprint email
   *   'post_email_sent'     — post-sprint email sent via Gmail
   */
  kind: text("kind").notNull(),
  note: text("note"),
  metadata: jsonb("metadata"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCompanyEventSchema = createInsertSchema(companyEventsTable).omit({
  id: true, createdAt: true,
});
export type InsertCompanyEvent = z.infer<typeof insertCompanyEventSchema>;
export type CompanyEvent = typeof companyEventsTable.$inferSelect;
