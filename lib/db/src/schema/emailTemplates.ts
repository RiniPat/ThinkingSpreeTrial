import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Consultant-authored email templates for the Emails tab.
 *
 * These are workspace-wide (all 10 consultants share one library) so a
 * template one person adds is immediately usable by the rest of the team.
 * There are no baked-in seed rows — the library starts empty and a template
 * lives until someone explicitly deletes it.
 *
 * `kind` is 'pre' or 'post' so the Pre-Sprint and Post-Sprint composers each
 * show only their relevant templates. `body` is the raw scaffold (with
 * [merge fields] the AI fills in from the sheet + calendar context).
 */
export const emailTemplatesTable = pgTable("email_templates", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),          // 'pre' | 'post'
  name: text("name").notNull(),
  body: text("body").notNull(),
  createdBy: integer("created_by"),      // user id, for attribution only
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEmailTemplateSchema = createInsertSchema(emailTemplatesTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertEmailTemplate = z.infer<typeof insertEmailTemplateSchema>;
export type EmailTemplate = typeof emailTemplatesTable.$inferSelect;
