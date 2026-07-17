import { pgTable, serial, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * One row per AI-generated research artefact. The `tool` column distinguishes
 * them and the `inputs` / `output` JSONB columns flex to each tool's shape.
 *
 * Pre-Sprint caching contract: for rows linked to a company (founderId set),
 * there is AT MOST ONE row per (founderId, tool) — enforced by the partial
 * unique index in migration 013. Generating replaces that row, so an analysis
 * is generated once and shown permanently until the consultant regenerates.
 */
export const researchOutputsTable = pgTable("research_outputs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  tool: text("tool").notNull(),         // see ResearchTool below
  founderId: integer("founder_id"),     // link to a Companies/founders row
  title: text("title").notNull(),
  inputs: jsonb("inputs").notNull().default({}),
  output: jsonb("output"),              // null until first generation succeeds
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const RESEARCH_TOOLS = [
  "customer_segmentation",
  "icp_mapping",
  "tam_sam_som",
  "industry_landscape",
  "business_model_canvas",
  "inspiration_roadmap",   // Research → Inspiration: grounded, sourced deep-dive
  "inspiration_session",   // Research → Inspiration: saved workbench session
  // ─── Pre-Sprint (migration 013) ─────────────────────────────────────────
  "company_overview",      // Overview snapshot from deck + website
  "blue_red_ocean",        // Market Potential: concentration / ocean analysis
  "demand_landscape",      // Demand Landscape: per-state + global heat data
] as const;
export type ResearchTool = (typeof RESEARCH_TOOLS)[number];

export function isResearchTool(s: unknown): s is ResearchTool {
  return typeof s === "string" && (RESEARCH_TOOLS as readonly string[]).includes(s);
}

export const insertResearchOutputSchema = createInsertSchema(researchOutputsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertResearchOutput = z.infer<typeof insertResearchOutputSchema>;
export type ResearchOutput = typeof researchOutputsTable.$inferSelect;
