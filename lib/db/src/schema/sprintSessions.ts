import { pgTable, serial, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Point-in-time snapshot of a company's Sprint Data. Created when the
 * consultant clicks "New Sprint Session" on the company detail page.
 *
 * Snapshots are immutable history — once created, only the label can be
 * edited. The "live" data on the founders row is what's displayed by
 * default; sessions are the archived history.
 */
export const sprintSessionsTable = pgTable("sprint_sessions", {
  id: serial("id").primaryKey(),
  founderId: integer("founder_id").notNull(),
  label: text("label").notNull(),
  sessionNumber: integer("session_number").notNull(),
  stageWorkflow: text("stage_workflow"),
  // Snapshot fields — mirror the founders columns at snapshot time.
  vision: text("vision"),
  visionRaw: text("vision_raw"),
  keyStrength: text("key_strength"),
  gap: text("gap"),
  mentorRecommendation: text("mentor_recommendation"),
  marketAccess: text("market_access"),
  tasks: text("tasks"),
  smartGoal3Months: text("smart_goal_3_months"),
  previousFundraiseCr: text("previous_fundraise_cr"),
  previousFundraiseOrgs: text("previous_fundraise_orgs"),
  currentBurn: text("current_burn"),
  runway: text("runway"),
  nextStageGoal: text("next_stage_goal"),
  nextStageRunway: text("next_stage_runway"),
  fundsFor: text("funds_for"),
  observationsTsDashboard: text("observations_ts_dashboard"),
  excelData: jsonb("excel_data"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSprintSessionSchema = createInsertSchema(sprintSessionsTable).omit({
  id: true, createdAt: true,
});
export type InsertSprintSession = z.infer<typeof insertSprintSessionSchema>;
export type SprintSession = typeof sprintSessionsTable.$inferSelect;
