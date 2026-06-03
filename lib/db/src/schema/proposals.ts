import { pgTable, serial, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Hybrid proposal: the consultant supplies the section structure (headings),
 * AI fills each section's body. The `sections` JSONB is shaped:
 *   [{ heading: string, body: string, aiGenerated: boolean }]
 *
 * Editing happens section-by-section — the consultant can keep some AI
 * output, rewrite others, or add their own sections without AI involvement.
 */
export const proposalsTable = pgTable("proposals", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  leadId: integer("lead_id"),                         // optional link to sales_leads
  prospectName: text("prospect_name").notNull(),
  prospectCompany: text("prospect_company").notNull(),
  brief: text("brief"),                               // high-level brief shared across sections
  sections: jsonb("sections").notNull().default([]),  // ProposalSection[]
  status: text("status").notNull().default("draft"),  // 'draft' | 'final'
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProposalSection = {
  heading: string;
  body: string;
  aiGenerated: boolean;
};

export const insertProposalSchema = createInsertSchema(proposalsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertProposal = z.infer<typeof insertProposalSchema>;
export type Proposal = typeof proposalsTable.$inferSelect;
