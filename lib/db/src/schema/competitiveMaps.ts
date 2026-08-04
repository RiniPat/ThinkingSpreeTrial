import { pgTable, serial, integer, text, jsonb, timestamp, boolean, index } from "drizzle-orm/pg-core";

/**
 * Competitive Mapping v2 — a consultant runs one company through a 5-stage flow:
 *   Data Feed (human) → Fencing (AI) → Prioritize (human) → Breakdown (AI) →
 *   Inspiration (human pick + AI build).
 *
 * The Google Sheet "Research for [Company]" is the durable, progressively-written
 * output; the tables below persist each stage so a run can be revisited and so
 * the dashboard Research Copilot can answer from real data.
 *
 * Plain integer user/foreign columns (no hard FK constraints) to avoid schema
 * import cycles — same convention as researchOutputs.
 */
export const MAP_STATUS = [
  "feed_ready",      // Data Feed done: overview + sheet created
  "fencing",         // Fencing job running
  "fenced",          // industry landscape ready
  "prioritized",     // consultant shortlisted companies
  "breaking_down",   // Breakdown job running
  "broken_down",     // per-company breakdowns ready
  "inspiration",     // inspiration timelines being built
  "done",
] as const;

export const competitiveMapsTable = pgTable("competitive_maps", {
  id: serial("id").primaryKey(),
  consultantId: integer("consultant_id"),
  companyName: text("company_name").notNull(),
  website: text("website"),
  tsheetUrl: text("tsheet_url"),
  deckFileId: text("deck_file_id"),
  status: text("status").notNull().default("feed_ready"),
  direction: text("direction"),
  overview: jsonb("overview"),
  /** Fencing scope chosen by the consultant (v3): geography + industry focus. */
  geography: text("geography"),
  industry: text("industry"),
  /** Fencing output: { metrics:[{label,value,note}], companies:[{name,website,type,size,hq,note}], summary } */
  landscape: jsonb("landscape"),
  /** Industry Mapping (v3): demand/application map — rows + market snapshot. */
  demandMap: jsonb("demand_map"),
  /** Competitive Landscape doc (v3): selection logic + business canvas + benchmarks. */
  competitiveDoc: jsonb("competitive_doc"),
  /** Prioritize output: [{name,website,rank}] — the shortlist sent to Breakdown. */
  selected: jsonb("selected"),
  generatedSheetId: text("generated_sheet_id"),
  generatedSheetUrl: text("generated_sheet_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Breakdown rows — PRODUCT-LEVEL (a company can have several) 46-column decode. */
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

/** One BMC per selected product (kept for compatibility; optional in v2). */
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

/** Async job progress for the two heavy AI stages (Fencing, Breakdown, Inspiration). */
export const MAP_JOB_KIND = ["fence", "breakdown", "inspiration"] as const;
export const MAP_JOB_STATUS = ["queued", "running", "done", "error"] as const;

export const mapJobsTable = pgTable("map_jobs", {
  id: serial("id").primaryKey(),
  mapId: integer("map_id").notNull(),
  kind: text("kind").notNull(),                 // fence | breakdown | inspiration
  status: text("status").notNull().default("queued"),
  progress: integer("progress").notNull().default(0),
  total: integer("total").notNull().default(0),
  message: text("message"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ byMap: index("map_jobs_map_idx").on(t.mapId) }));

/** Persistent Research Copilot chat — saved across the whole session. */
export const copilotMessagesTable = pgTable("copilot_messages", {
  id: serial("id").primaryKey(),
  mapId: integer("map_id").notNull(),
  role: text("role").notNull(),                 // "user" | "ai"
  focusCompany: text("focus_company"),
  content: jsonb("content").notNull(),          // string (user) or [{h,b}] (ai)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ byMap: index("copilot_messages_map_idx").on(t.mapId) }));
