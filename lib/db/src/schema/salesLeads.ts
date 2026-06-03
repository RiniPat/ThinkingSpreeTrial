import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Sales pipeline lead. Owned by a single user (the SDR / salesperson).
 * Stage is unconstrained TEXT so we can add new pipeline stages without
 * a DB migration — the frontend enforces the canonical set.
 */
export const salesLeadsTable = pgTable("sales_leads", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id"),
  companyName: text("company_name").notNull(),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactRole: text("contact_role"),
  linkedinUrl: text("linkedin_url"),
  stage: text("stage").notNull().default("cold"),
  source: text("source"),
  notes: text("notes"),
  lastTouchAt: timestamp("last_touch_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const SALES_LEAD_STAGES = [
  "cold", "contacted", "meeting_booked", "proposal_sent", "won", "lost",
] as const;
export type SalesLeadStage = (typeof SALES_LEAD_STAGES)[number];

export function isSalesLeadStage(s: unknown): s is SalesLeadStage {
  return typeof s === "string" && (SALES_LEAD_STAGES as readonly string[]).includes(s);
}

export const insertSalesLeadSchema = createInsertSchema(salesLeadsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertSalesLead = z.infer<typeof insertSalesLeadSchema>;
export type SalesLead = typeof salesLeadsTable.$inferSelect;
