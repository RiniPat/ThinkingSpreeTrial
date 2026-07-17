import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Stores per-user Google OAuth refresh tokens & granted scopes.
 * One row per user — when re-authorizing, we UPDATE in place.
 */
export const googleTokensTable = pgTable("google_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  scope: text("scope"), // space-separated list of granted scopes
  tokenType: text("token_type"),
  expiryDate: timestamp("expiry_date", { withTimezone: true }),
  // Per-service connection flags (computed from scope at write time for fast UI lookups)
  hasCalendar: text("has_calendar"), // "yes" | null
  hasGmail: text("has_gmail"),
  hasDrive: text("has_drive"),
  hasSheets: text("has_sheets"),
  // Google profile info captured at connect time
  googleEmail: text("google_email"),
  googleProfile: jsonb("google_profile"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertGoogleTokenSchema = createInsertSchema(googleTokensTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertGoogleToken = z.infer<typeof insertGoogleTokenSchema>;
export type GoogleToken = typeof googleTokensTable.$inferSelect;
