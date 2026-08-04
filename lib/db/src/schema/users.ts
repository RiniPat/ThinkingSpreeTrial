import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  // Nullable now — Google-only users have no password
  passwordHash: text("password_hash"),
  role: text("role").notNull().default("consultant"),
  avatarUrl: text("avatar_url"),
  // Google's stable subject ID (the "sub" claim) — links a user to a Google account
  googleSub: text("google_sub").unique(),
  // Follow-up sign-off fields (migration 021). Fill [Title]/[Phone]/[Calendar link].
  title: text("title"),
  phone: text("phone"),
  calendarLink: text("calendar_link"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
