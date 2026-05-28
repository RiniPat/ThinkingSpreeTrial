import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * AI-generated email drafts. One row per generation; the consultant may edit
 * the subject/body before sending. When sent via Gmail, we stamp `sentAt` and
 * `gmailMessageId` and log a corresponding row to `company_events`.
 *
 * Kind is constrained at the DB level to 'pre' or 'post' so we can't
 * accidentally store other email types here.
 */
export const emailDraftsTable = pgTable("email_drafts", {
  id: serial("id").primaryKey(),
  founderId: integer("founder_id").notNull(),
  // Optional link to a sprint_session. NULL for legacy pre-v5.2 drafts or
  // for companies that have never had a session snapshot.
  sessionId: integer("session_id"),
  userId: integer("user_id"),
  kind: text("kind").notNull(),   // 'pre' | 'post'
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  toEmail: text("to_email"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  gmailMessageId: text("gmail_message_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEmailDraftSchema = createInsertSchema(emailDraftsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertEmailDraft = z.infer<typeof insertEmailDraftSchema>;
export type EmailDraft = typeof emailDraftsTable.$inferSelect;
