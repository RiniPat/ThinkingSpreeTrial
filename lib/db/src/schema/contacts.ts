import { pgTable, serial, integer, text, timestamp, real, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Inbox CRM contact. One row per (owner, email address): the Gmail analyser
 * collapses every message a Sales/Admin user has sent or received into these
 * deduped contact records. Contacts are PER USER (scoped by ownerId) — each
 * person analyses their own connected inbox.
 *
 * The table is the read model for the UI: the grid/analytics query THIS table
 * (fast, paginated, indexed), never Gmail directly. Gmail is only touched
 * during a background sync/refresh, so the platform never blocks on the API.
 */
export const contactsTable = pgTable("contacts", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id").notNull(),
  email: text("email").notNull(),
  name: text("name"),
  company: text("company"),
  domain: text("domain"),
  // Coarse bucket ∈ founder | investor | partner | mentor | customer | vendor | media | talent | other
  role: text("role").notNull().default("other"),
  roleLabel: text("role_label"),        // specific sub-type: AI-suggested (e.g. "Accelerator") or user-typed
  roleSource: text("role_source").notNull().default("ai"), // 'ai' | 'user' — 'user' locks it from re-sync overwrite
  confidence: real("confidence"),        // 0..1 for AI-assigned roles
  emailsTotal: integer("emails_total").notNull().default(0),
  sentCount: integer("sent_count").notNull().default(0),
  receivedCount: integer("received_count").notNull().default(0),
  firstSeen: timestamp("first_seen", { withTimezone: true }),
  lastContactAt: timestamp("last_contact_at", { withTimezone: true }),
  lastDirection: text("last_direction"), // 'sent' | 'received'
  replyStatus: text("reply_status").notNull().default("none"), // replied | awaiting | none
  linkedinUrl: text("linkedin_url"),
  notes: text("notes"),
  promotedLeadId: integer("promoted_lead_id"), // set when promoted into sales_leads
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  ownerEmailUq: uniqueIndex("contacts_owner_email_uq").on(t.ownerId, t.email),
  ownerRoleIdx: index("contacts_owner_role_idx").on(t.ownerId, t.role),
  ownerLastIdx: index("contacts_owner_last_idx").on(t.ownerId, t.lastContactAt),
}));

/**
 * Per-user sync state: drives the "Sync / Refresh" button, the progress bar,
 * and incremental refresh (only pull messages newer than lastSyncedAt).
 */
export const contactSyncStateTable = pgTable("contact_sync_state", {
  ownerId: integer("owner_id").primaryKey(),
  status: text("status").notNull().default("idle"), // idle | running | error
  phase: text("phase"),                              // e.g. 'scanning' | 'classifying'
  windowMonths: integer("window_months"),            // chosen analysis window (null = all)
  processed: integer("processed").notNull().default(0),
  total: integer("total").notNull().default(0),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  message: text("message"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const CONTACT_ROLES = ["founder", "investor", "partner", "mentor", "customer", "vendor", "media", "talent", "other"] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];

export const insertContactSchema = createInsertSchema(contactsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type Contact = typeof contactsTable.$inferSelect;
export type ContactSyncState = typeof contactSyncStateTable.$inferSelect;
