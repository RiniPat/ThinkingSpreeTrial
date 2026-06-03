import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const sprintsTable = pgTable("sprints", {
  id: serial("id").primaryKey(),
  founderId: integer("founder_id").notNull(),
  scheduledDate: text("scheduled_date").notNull(),
  scheduledTime: text("scheduled_time"),
  endTime: text("end_time"),
  totalDuration: text("total_duration"),
  consultantName: text("consultant_name").notNull(),
  // NEW: host / co-host (separate from consultantName which is the "primary owner")
  sprintHost: text("sprint_host"),
  coHost: text("co_host"),
  status: text("status").notNull().default("scheduled"),
  tsheetUrl: text("tsheet_url"),
  fathomUrl: text("fathom_url"),
  sessionType: text("session_type"),
  sprintNumber: integer("sprint_number"),
  // NEW: payment/billing
  paymentStatus: text("payment_status"),
  billedTo: text("billed_to"),
  billNumber: text("bill_number"),
  price: numeric("price", { precision: 12, scale: 2 }),
  // Period flags useful for the Sheet-Tracking style filters
  week: integer("week"),
  month: integer("month"),
  cyYear: integer("cy_year"),
  fyYear: integer("fy_year"),
  quarter: text("quarter"),
  // Analysis fields
  strengths: text("strengths"),
  gaps: text("gaps"),
  swotAnalysis: text("swot_analysis"),
  nextGoal: text("next_goal"),
  actionableSteps: text("actionable_steps"),
  mentorshipRecommendation: text("mentorship_recommendation"),
  marketConnections: text("market_connections"),
  meetLink: text("meet_link"),
  preEmailSentAt: timestamp("pre_email_sent_at", { withTimezone: true }),
  postEmailSentAt: timestamp("post_email_sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSprintSchema = createInsertSchema(sprintsTable).omit({ id: true, createdAt: true });
export type InsertSprint = z.infer<typeof insertSprintSchema>;
export type Sprint = typeof sprintsTable.$inferSelect;
