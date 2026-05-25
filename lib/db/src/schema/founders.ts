import { pgTable, text, serial, timestamp, integer, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const foundersTable = pgTable("founders", {
  id: serial("id").primaryKey(),
  incubatorId: integer("incubator_id"),
  name: text("name").notNull(),
  email: text("email").notNull(),
  contact: text("contact"),
  // optional second founder
  founder2Name: text("founder_2_name"),
  founder2Email: text("founder_2_email"),
  founder2Contact: text("founder_2_contact"),
  companyName: text("company_name").notNull(),
  industry: text("industry"),
  sector: text("sector"),
  acceleratorProgram: text("accelerator_program"),
  partnerName: text("partner_name"),
  thinkingSheetUrl: text("thinking_sheet_url"),
  stage: text("stage"),
  description: text("description"),
  // Summary-sheet fields ---------------------------------------------------
  goalSetting: text("goal_setting"),
  revenueLast12Months: text("revenue_last_12m"),
  revenueLastMonthMrr: text("revenue_last_month_mrr"),
  teamSize: integer("team_size"),
  keyStrength: text("key_strength"),
  gap: text("gap"),
  conceptAndSessions: text("concept_and_sessions"),
  mentorRecommendation: text("mentor_recommendation"),
  marketAccess: text("market_access"),
  idealCustomerList: text("ideal_customer_list"),
  timelineForMarketAccess: text("timeline_for_market_access"),
  observationsTs: text("observations_ts"),
  recommendationForVc: text("recommendation_for_vc"),
  previousFundraiseInr: numeric("previous_fundraise_inr", { precision: 18, scale: 2 }),
  previousFundraiseOrgs: text("previous_fundraise_orgs"),
  currentBurn: text("current_burn"),
  fundAskCr: numeric("fund_ask_cr", { precision: 12, scale: 2 }),
  fundraiseCommitments: text("fundraise_commitments"),
  fundraiseNotes: text("fundraise_notes"),
  fathomLink: text("fathom_link"),
  currentProblem: text("current_problem"),
  suggestedNextStep: text("suggested_next_step"),
  nextFiveSprints: text("next_five_sprints"),
  caseStudyWorthy: boolean("case_study_worthy"),
  caseStudyTheme: text("case_study_theme"),
  trainingWorthy: boolean("training_worthy"),
  trainingTheme: text("training_theme"),
  level: text("level"),
  tSprintIntervention: text("t_sprint_intervention"),
  tasks: text("tasks"),
  // Tracks which import created this row. Filters the Summary page to only
  // the curated founders from ISB/JU summary sheets.
  source: text("source"),
  // -----------------------------------------------------------------------
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFounderSchema = createInsertSchema(foundersTable).omit({ id: true, createdAt: true });
export type InsertFounder = z.infer<typeof insertFounderSchema>;
export type Founder = typeof foundersTable.$inferSelect;
