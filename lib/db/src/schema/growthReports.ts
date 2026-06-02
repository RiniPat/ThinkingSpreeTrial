import { pgTable, serial, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";

/**
 * Growth Report — multi-step state per the Builder workflow.
 *
 * Status values: 'drafting' | 'anchors_ready' | 'report_ready' | 'failed'
 *
 * Storage policy: we keep extracted TEXT from uploads, not the raw files.
 * Once extraction succeeds, the source PDFs/transcripts are discarded.
 * This keeps storage predictable while still allowing edit-and-regenerate.
 */
export const growthReportsTable = pgTable("growth_reports", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  startupName: text("startup_name").notNull(),
  cohort: text("cohort"),
  tsheetLink: text("tsheet_link").notNull(),
  status: text("status").notNull().default("drafting"),
  errorMessage: text("error_message"),
  strategicCanvasText: text("strategic_canvas_text"),
  fathom1Text: text("fathom_1_text"),
  fathom2Text: text("fathom_2_text"),
  /**
   * Dynamic Fathom transcripts (v5.5+). The old fathom_1_text /
   * fathom_2_text columns are kept for back-compat and mirror entries
   * 0 and 1 of this array — new code should always read fathomTexts.
   */
  fathomTexts: jsonb("fathom_texts").$type<string[]>(),
  checkinText: text("checkin_text"),
  numSprints: integer("num_sprints").notNull().default(1),
  anchors: jsonb("anchors"),
  report: jsonb("report"),
  docxB64: text("docx_b64"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GrowthReport = typeof growthReportsTable.$inferSelect;
export type InsertGrowthReport = typeof growthReportsTable.$inferInsert;
