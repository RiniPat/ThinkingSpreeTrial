import { pgTable, serial, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * One row per AI-generated research artefact. Same shape for all 5 tools
 * (customer segmentation, ICP mapping, TAM/SAM/SOM, industry landscape,
 * business model canvas) — the `tool` column distinguishes them and the
 * `inputs` / `output` JSONB columns flex to each tool's specific shape.
 *
 * Why a single table instead of one per tool: these are all "AI generates
 * structured content; consultant edits; revisits later" — the row shape
 * is identical at the storage layer. Per-tool tables would just be 5x
 * the migrations for the same fields.
 */
export const researchOutputsTable = pgTable("research_outputs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  tool: text("tool").notNull(),         // see ResearchTool below
  founderId: integer("founder_id"),     // optional link to a Companies/founders row
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
