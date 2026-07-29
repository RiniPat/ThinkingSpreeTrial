import { pgTable, serial, integer, text, jsonb, timestamp, boolean, index } from "drizzle-orm/pg-core";

/**
 * Competitive Mapping — a consultant runs one company through the 7-stage
 * research pipeline (Data Feed → Overview → Fencing → Prioritize → Breakdown →
 * Inspiration → Generate). The `status` column mirrors the front-end ribbon so
 * a run can be left and resumed.
 *
 * Follows the same convention as researchOutputs: plain integer user/foreign
 * columns (no hard FK constraints) to avoid schema import cycles.
 */
export const MAP_STATUS = [
  "scraping", "overview_ready", "fencing", "fenced",
  "prioritized", "broken_down", "inspiration", "generated",
] as const;

export const competitiveMapsTable = pgTable("competitive_maps", {
  id: serial("id").primaryKey(),
  consultantId: integer("consultant_id"),
  companyName: text("company_name").notNull(),
  website: text("website"),
  tsheetUrl: text("tsheet_url"),
  deckFileId: text("deck_file_id"),
  status: text("status").notNull().default("scraping"),
  direction: text("direction"),
  overview: jsonb("overview"),
  generatedSheetId: text("generated_sheet_id"),
  generatedSheetUrl: text("generated_sheet_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Fencing research-grid rows — PRODUCT-LEVEL (a company can have several). */
export const mapProductsTable = pgTable("map_products", {
  id: serial("id").primaryKey(),
  mapId: integer("map_id").notNull(),
  srNo: integer("sr_no").notNull(),
  company: text("company").notNull(),
  product: text("product").notNull(),
  imageUrl: text("image_url"),
  seg: text("seg"),
  scaledBeyond: boolean("scaled_beyond").notNull().default(false),
  data: jsonb("data").notNull(),
  selected: boolean("selected").notNull().default(false),
  rank: integer("rank"),
}, (t) => ({ byMap: index("map_products_map_idx").on(t.mapId) }));

/** One BMC per selected product (9-block canvas with source links). */
export const mapBmcTable = pgTable("map_bmc", {
  id: serial("id").primaryKey(),
  mapId: integer("map_id").notNull(),
  productId: integer("product_id").notNull(),
  blocks: jsonb("blocks").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Aspirational-giant timelines for the Inspiration stage. */
export const mapInspirationTable = pgTable("map_inspiration", {
  id: serial("id").primaryKey(),
  mapId: integer("map_id").notNull(),
  companyName: text("company_name").notNull(),
  phases: jsonb("phases").notNull(),
  aiGenerated: boolean("ai_generated").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Persistent Research Copilot chat — saved across the whole session. */
export const copilotMessagesTable = pgTable("copilot_messages", {
  id: serial("id").primaryKey(),
  mapId: integer("map_id").notNull(),
  role: text("role").notNull(),                 // "user" | "ai"
  focusCompany: text("focus_company"),
  content: jsonb("content").notNull(),          // string (user) or [{h,b}] (ai)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ byMap: index("copilot_messages_map_idx").on(t.mapId) }));
