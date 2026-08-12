import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Sales · Follow-up enrichment context (see migration 025).
 *
 * One row per follow-up, keyed by the same `clientKey` used by every `:key`
 * route. Holds the summarised T-sheet + submitted-docs context that feeds the
 * AI draft prompt, plus the Growth Prospects document (§11) so it can be
 * re-rendered without another LLM call.
 */
export const salesFollowupContextTable = pgTable("sales_followup_context", {
  clientKey: text("client_key").primaryKey(),

  tSheetUrl: text("t_sheet_url"),
  tSheetSummary: text("t_sheet_summary"),
  docsSummary: text("docs_summary"),

  enrichmentStatus: text("enrichment_status"), // idle | running | ok | partial | error
  enrichmentError: text("enrichment_error"),
  enrichedAt: timestamp("enriched_at", { withTimezone: true }),

  // Growth Prospects document (§11).
  growthBrief: jsonb("growth_brief"),
  growthDocxUrl: text("growth_docx_url"),
  growthDocxFileId: text("growth_docx_file_id"),
  growthPdfUrl: text("growth_pdf_url"),
  growthPdfFileId: text("growth_pdf_file_id"),
  growthGeneratedAt: timestamp("growth_generated_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ENRICHMENT_STATUSES = ["idle", "running", "ok", "partial", "error"] as const;
export type EnrichmentStatus = (typeof ENRICHMENT_STATUSES)[number];

export const insertSalesFollowupContextSchema = createInsertSchema(salesFollowupContextTable).omit({
  createdAt: true, updatedAt: true,
});
export type InsertSalesFollowupContext = z.infer<typeof insertSalesFollowupContextSchema>;
export type SalesFollowupContext = typeof salesFollowupContextTable.$inferSelect;
