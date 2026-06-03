import { pgTable, serial, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Summary Builder (Builder tab · Phase B) workflow state.
 *
 * One row per Wadhwani-format summary being built. Mirrors the growth_reports
 * pattern: a resumable, server-persisted multi-step flow so progress survives
 * tab switches / refreshes.
 *
 * Steps:
 *   drafting   → row created, T-Sheet pulled (and Fathom extracted if uploaded)
 *   ready      → consultant has reviewed/edited; ready to commit
 *   committed  → written to the Summary Sheet tab as a venture row (founderId set)
 *   failed     → pull or extract errored (errorMessage set)
 *
 * `pulled`   — fields read straight from the T-Sheet (startup/founder/host/etc.)
 * `aiFields` — fields the AI extracted from the Fathom transcript.
 * `fields`   — the consolidated, consultant-editable record that gets committed
 *              (includes the Industry / TG / Funding dropdown selections and the
 *              VP1 / VP2 dates looked up from Sprint Tracking).
 */
export const summaryBuildsTable = pgTable("summary_builds", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  startupName: text("startup_name").notNull(),
  cohort: text("cohort"),                          // defaults to the Wadhwani cohort
  tsheetLink: text("tsheet_link"),
  status: text("status").notNull().default("drafting"),
  errorMessage: text("error_message"),
  // Raw transcript text (Fathom), kept text-only — uploads are discarded.
  fathomText: text("fathom_text"),
  // Structured stages.
  pulled: jsonb("pulled"),
  aiFields: jsonb("ai_fields"),
  fields: jsonb("fields"),
  // Set once committed — the founders row this build produced.
  founderId: integer("founder_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSummaryBuildSchema = createInsertSchema(summaryBuildsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertSummaryBuild = z.infer<typeof insertSummaryBuildSchema>;
export type SummaryBuild = typeof summaryBuildsTable.$inferSelect;
