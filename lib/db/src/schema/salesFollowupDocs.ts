import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Sales · Follow-up submitted docs (see migration 025).
 *
 * Zero-to-many meeting-context docs the consultant submits per follow-up:
 * Google Doc links (read via the Drive API) and/or uploaded files (stored in
 * Google Drive, text extracted via lib/fileExtract). A follow-up may have none.
 */
export const salesFollowupDocsTable = pgTable("sales_followup_docs", {
  id: serial("id").primaryKey(),
  clientKey: text("client_key").notNull(),
  sourceType: text("source_type").notNull(), // 'gdoc' | 'upload'
  url: text("url"),                           // Google Doc URL or Drive webViewLink of the stored upload
  driveFileId: text("drive_file_id"),         // Drive fileId (uploads persisted in Drive)
  title: text("title"),
  extractedText: text("extracted_text"),
  status: text("status"),                     // 'ok' | 'error'
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const DOC_SOURCE_TYPES = ["gdoc", "upload"] as const;
export type DocSourceType = (typeof DOC_SOURCE_TYPES)[number];

export const insertSalesFollowupDocSchema = createInsertSchema(salesFollowupDocsTable).omit({
  id: true, createdAt: true,
});
export type InsertSalesFollowupDoc = z.infer<typeof insertSalesFollowupDocSchema>;
export type SalesFollowupDoc = typeof salesFollowupDocsTable.$inferSelect;
