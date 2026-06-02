// lib/db/schema/cohorts.ts
//
// Drizzle schema for the cohorts + sprint_emails tables introduced in
// migration 010. Drop this file into `lib/db/schema/` and re-export from
// your schema barrel (the same place `founders.ts`, `sprints.ts` etc. live).
//
// ADAPT: import paths for `founders` and `users` — match whatever your
// existing schema files export.

import {
    bigint,
    bigserial,
    pgTable,
    pgView,
    primaryKey,
    text,
    timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ADAPT: relative paths to your existing tables
import { founders } from "./founders.js";
import { sprints } from "./sprints.js";
import { users } from "./users.js";

export const cohorts = pgTable("cohorts", {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    description: text("description"),
    sourceSheetUrl: text("source_sheet_url"),
    sourceSheetTab: text("source_sheet_tab"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastSyncError: text("last_sync_error"),
    createdBy: bigint("created_by", { mode: "number" }).references(() => users.id, {
        onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
});

export const cohortCompanies = pgTable(
    "cohort_companies",
    {
        cohortId: bigint("cohort_id", { mode: "number" })
            .notNull()
            .references(() => cohorts.id, { onDelete: "cascade" }),
        founderId: bigint("founder_id", { mode: "number" })
            .notNull()
            .references(() => founders.id, { onDelete: "cascade" }),
        addedAt: timestamp("added_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
        source: text("source").notNull().default("manual"), // 'manual' | 'sheet-sync'
    },
    (t) => ({
        pk: primaryKey({ columns: [t.cohortId, t.founderId] }),
    }),
);

export const sprintEmails = pgTable("sprint_emails", {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    sprintId: bigint("sprint_id", { mode: "number" })
        .notNull()
        .references(() => sprints.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // 'pre-sprint' | 'post-sprint' | 'check-in' | 'other'
    recipientsTo: text("recipients_to")
        .array()
        .notNull()
        .default(sql`'{}'::text[]`),
    recipientsCc: text("recipients_cc")
        .array()
        .notNull()
        .default(sql`'{}'::text[]`),
    recipientsBcc: text("recipients_bcc")
        .array()
        .notNull()
        .default(sql`'{}'::text[]`),
    subject: text("subject").notNull(),
    bodyHtml: text("body_html").notNull(),
    bodyText: text("body_text"),
    messageId: text("message_id"),
    inReplyTo: text("in_reply_to"),
    referencesIds: text("references_ids")
        .array()
        .notNull()
        .default(sql`'{}'::text[]`),
    gmailThreadId: text("gmail_thread_id"),
    sentBy: bigint("sent_by", { mode: "number" }).references(() => users.id, {
        onDelete: "set null",
    }),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});

// View — latest email of each kind per sprint. Read-only; defined in
// migration 010 SQL. Drizzle just types it.
export const latestSprintEmail = pgView("v_latest_sprint_email", {
    sprintId: bigint("sprint_id", { mode: "number" }).notNull(),
    kind: text("kind").notNull(),
    emailId: bigint("email_id", { mode: "number" }).notNull(),
    messageId: text("message_id"),
    gmailThreadId: text("gmail_thread_id"),
    subject: text("subject").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
}).existing();

export type Cohort = typeof cohorts.$inferSelect;
export type CohortInsert = typeof cohorts.$inferInsert;
export type SprintEmail = typeof sprintEmails.$inferSelect;
export type SprintEmailInsert = typeof sprintEmails.$inferInsert;
