import { pgTable, serial, integer, text, boolean, date, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Sales · Follow-ups state (see migration 019_sales_followups.sql).
 *
 * App-owned lifecycle layered on top of the read-only "Live Sprint Tracking"
 * sheet. One row per client, keyed by `clientKey` = normalise(name)|normalise(program).
 *
 * `status` is nullable on purpose: while NULL we DERIVE `not_due` / `due` at
 * read time from `lastSprintDate` (+ the 30-day rule). It becomes an explicit
 * value only once the consultant drafts/sends or a reply is detected.
 */
export const salesFollowupsTable = pgTable("sales_followups", {
  id: serial("id").primaryKey(),
  clientKey: text("client_key").notNull(),

  // Sheet-derived snapshot
  startup: text("startup").notNull(),
  contact: text("contact"),
  email: text("email"),
  program: text("program"),
  stage: text("stage"),
  host: text("host"),
  cohost: text("cohost"),
  sessions: integer("sessions"),
  lastSprintDate: date("last_sprint_date"),
  sprintCompleted: boolean("sprint_completed"),

  // Triage (migration 024). Drives the triage-first UX; independent of `skipped`
  // and `status`. Only `interested`/`maybe` can be drafted/sent and count in Ops
  // "should-have-sent". `not_now` = client not interested. NULL = untriaged.
  interest: text("interest"), // 'interested' | 'maybe' | 'not_now' | NULL
  interestSetAt: timestamp("interest_set_at", { withTimezone: true }),

  // App-owned lifecycle
  status: text("status"), // draft | sent | no_reply | replied_not_now | replied_interested | bounced (NULL ⇒ derive)

  // Saved rich-text draft
  templateKey: text("template_key"), // checkin | next_sprint | nudge
  draftSubject: text("draft_subject"),
  draftBodyHtml: text("draft_body_html"),

  // Send + threading
  ownerId: integer("owner_id"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  lastContactAt: timestamp("last_contact_at", { withTimezone: true }),
  gmailThreadId: text("gmail_thread_id"),
  gmailMessageId: text("gmail_message_id"),

  // Reply tracking
  replyState: text("reply_state"), // interested | not_now | no_reply
  replyDetectedAt: timestamp("reply_detected_at", { withTimezone: true }),
  replyIsManual: boolean("reply_is_manual").notNull().default(false),

  // Pipeline stage sends (migration 026). 1st outreach = `sentAt`. A client
  // response at any stage breaks the chain (see responseState).
  nudgeSentAt: timestamp("nudge_sent_at", { withTimezone: true }),
  toffeeSentAt: timestamp("toffee_sent_at", { withTimezone: true }),

  // Client-response tracking (migration 026). Richer than replyState; the
  // consultant sets it (AI-assisted later). `responseNote` = free-text remark.
  responseState: text("response_state"), // interested | quotation_sent | no_reply_after_quotation | other
  responseNote: text("response_note"),
  responseSetAt: timestamp("response_set_at", { withTimezone: true }),

  // "Willing to contact?" gate (migration 023). When true the consultant has
  // decided NOT to reach out; Operations tracking excludes it from the
  // "should have sent" count. Independent of `status`.
  skipped: boolean("skipped").notNull().default(false),
  skipReason: text("skip_reason"),
  skippedAt: timestamp("skipped_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** App-owned follow-up statuses (superset; `not_due`/`due` are derived, not stored). */
export const FOLLOWUP_STATUSES = [
  "not_due", "due", "draft", "sent",
  "no_reply", "replied_not_now", "replied_interested", "bounced",
] as const;
export type FollowupStatus = (typeof FOLLOWUP_STATUSES)[number];

export const REPLY_STATES = ["interested", "not_now", "no_reply"] as const;
export type ReplyState = (typeof REPLY_STATES)[number];

export const TEMPLATE_KEYS = ["checkin", "next_sprint", "nudge"] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

/** Shortlisting states (migration 024). Only interested/maybe are actionable.
 *  UI labels: interested→Shortlisted, maybe→Maybe, not_now→Not shortlisted.
 *  DB values kept stable to avoid a data migration. */
export const INTEREST_STATES = ["interested", "maybe", "not_now"] as const;
export type InterestState = (typeof INTEREST_STATES)[number];

/** Client-response states (migration 026). Pipeline stage progression. */
export const RESPONSE_STATES = ["interested", "quotation_sent", "no_reply_after_quotation", "other"] as const;
export type ResponseState = (typeof RESPONSE_STATES)[number];

/** Retargeting pipeline stages (7 days per step; consultant sends each). */
export const PIPELINE_STAGES = ["outreach", "nudge", "toffee"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const insertSalesFollowupSchema = createInsertSchema(salesFollowupsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertSalesFollowup = z.infer<typeof insertSalesFollowupSchema>;
export type SalesFollowup = typeof salesFollowupsTable.$inferSelect;

/** Stable key from sheet identity. Keep in sync with the server sync helper. */
export function makeClientKey(name: string, program: string | null | undefined): string {
  const norm = (s: string) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  return `${norm(name)}|${norm(program ?? "")}`;
}
