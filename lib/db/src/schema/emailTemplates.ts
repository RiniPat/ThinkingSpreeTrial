import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Consultant-authored email templates.
 *
 * Workspace-wide (all consultants share one library). `kind` scopes a template
 * to a composer:
 *   'pre' | 'post'   → Pre-Sprint / Post-Sprint composers (body only)
 *   'followup'       → Sales · Follow-ups (uses `subject` + `sortOrder` too)
 *
 * `subject` and `sortOrder` were added in migration 020. They are nullable /
 * defaulted so existing pre/post rows are unaffected.
 */
export const emailTemplatesTable = pgTable("email_templates", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),          // 'pre' | 'post' | 'followup'
  name: text("name").notNull(),
  subject: text("subject"),              // used by 'followup'
  sortOrder: integer("sort_order").notNull().default(0),
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
