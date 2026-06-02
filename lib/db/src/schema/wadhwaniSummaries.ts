import { pgTable, serial, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";

/**
 * Wadhwani Foundation Summary Builder — Phase B of the Builder workflow.
 *
 * Pulls from three sources:
 *   1. T-Sheet (Google Sheets URL): Startup Name (overview), Founder, Host
 *      (T-Sprint Consultants Assigned), Co-Host (cell right of Host), Goal
 *      (SMART tab), and dates of VP1/VP2 calls (Sprint Tracking — first
 *      and second occurrence of the company name).
 *   2. Fathom transcript(s) — AI extracts:
 *        - current_revenue  (e.g. "INR 1.2 Cr ARR")
 *        - industry_detail  (e.g. "Electrical Equipment Manufacturing")
 *        - critical_venture (e.g. "Scaling of Automated Panels")
 *        - ts_connects      (e.g. "Plant and Factory consultants")
 *        - ts_support       (anything Thinking Spree did beyond connects)
 *   3. User-chosen dropdowns: industry, tg, funding.
 *
 * Status values: 'drafting' | 'extracted' | 'written_to_sheet' | 'failed'
 *
 * Final action writes a row into the existing "Summary Sheet" tab of the
 * cohort's master Google Sheet via the Sheets connector.
 */
export const wadhwaniSummariesTable = pgTable("wadhwani_summaries", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  startupName: text("startup_name").notNull(),
  cohort: text("cohort"),
  tsheetLink: text("tsheet_link").notNull(),
  status: text("status").notNull().default("drafting"),
  errorMessage: text("error_message"),

  // Pulled from T-Sheet verbatim
  founderName: text("founder_name"),
  host: text("host"),
  coHost: text("co_host"),
  goal: text("goal"),
  vp1Date: text("vp1_date"),
  vp2Date: text("vp2_date"),

  // AI-extracted from Fathom transcripts
  fathomTexts: jsonb("fathom_texts").$type<string[]>(),
  currentRevenue: text("current_revenue"),
  industryDetail: text("industry_detail"),
  criticalVenture: text("critical_venture"),
  tsConnects: text("ts_connects"),
  tsSupport: text("ts_support"),

  // User dropdowns
  industry: text("industry"),
  tg: text("tg"),
  funding: text("funding"),

  // Filled when status = 'written_to_sheet'
  sheetRowIndex: integer("sheet_row_index"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WadhwaniSummary = typeof wadhwaniSummariesTable.$inferSelect;
export type InsertWadhwaniSummary = typeof wadhwaniSummariesTable.$inferInsert;
