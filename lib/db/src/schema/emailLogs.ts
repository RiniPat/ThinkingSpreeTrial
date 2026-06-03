import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const emailLogsTable = pgTable("email_logs", {
  id: serial("id").primaryKey(),
  sprintId: integer("sprint_id").notNull(),
  emailType: text("email_type").notNull(),
  toEmail: text("to_email").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  messageId: text("message_id"),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEmailLogSchema = createInsertSchema(emailLogsTable).omit({ id: true, sentAt: true });
export type InsertEmailLog = z.infer<typeof insertEmailLogSchema>;
export type EmailLog = typeof emailLogsTable.$inferSelect;
