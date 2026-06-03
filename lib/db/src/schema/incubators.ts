import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
// unique() added to name below
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const incubatorsTable = pgTable("incubators", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull().default("incubator"),
  sheetUrl: text("sheet_url"),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertIncubatorSchema = createInsertSchema(incubatorsTable).omit({ id: true, createdAt: true });
export type InsertIncubator = z.infer<typeof insertIncubatorSchema>;
export type Incubator = typeof incubatorsTable.$inferSelect;
