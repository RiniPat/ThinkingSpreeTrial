// artifacts/api-server/src/lib/cohort-sync.ts
//
// ============================================================================
// Cohort sync — read a Google Sheet, reconcile cohort membership.
// ============================================================================
//
// Strategy:
//   1. Read the sheet via the Google Sheets API using the user's OAuth tokens
//      (you already have this — CHANGES.md mentions Sheets scope).
//   2. Extract company names from column A (or whichever header matches
//      "Company" / "Startup" / "Name").
//   3. Match against existing founders by name (case-insensitive, trimmed).
//      Unmatched names get logged as "unresolved" — they don't break sync.
//   4. INSERT into cohort_companies for new matches (source = 'sheet-sync').
//      Existing rows are left alone. We do NOT remove sheet-sync rows on
//      this pass — sheet deletions are intentional manual actions; the
//      admin can hit DELETE /companies/:founderId if they want one out.
//
// Wire-up: the route calls syncCohortFromSheet(); you can also call this
// from a Render Cron Job for scheduled sync.
// ============================================================================

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db.js";
import { cohortCompanies } from "@workspace/db/schema/cohorts";
import { founders } from "@workspace/db/schema/founders";

// ADAPT: import path to whatever helper already wraps the Google Sheets API
// in your codebase. Per GOOGLE_INTEGRATION_SETUP.md you have Sheets scope set
// up; you almost certainly have a `readSheet()` helper somewhere already.
import { readSheetRows } from "./google-sheets.js";

export type SyncResult = {
    added: number;
    skipped: number;
    unresolved: string[]; // names in the sheet we couldn't match to a founder
};

export async function syncCohortFromSheet(args: {
    cohortId: number;
    sheetUrl: string;
    sheetTab: string | null;
    userId: number;
}): Promise<SyncResult> {
    const { cohortId, sheetUrl, sheetTab, userId } = args;

    // 1. Pull rows from the sheet (as 2-D array, first row = headers).
    const rows = await readSheetRows({ sheetUrl, sheetTab, userId });
    if (!rows || rows.length < 2) {
        return { added: 0, skipped: 0, unresolved: [] };
    }

    const header = rows[0]!.map((c) => String(c ?? "").trim().toLowerCase());
    const nameIdx = pickNameColumn(header);
    if (nameIdx < 0) {
        throw new Error(
            `Could not find a company-name column in the sheet. Expected one of: "company", "startup", "name", "venture". Got: ${header.join(", ")}`,
        );
    }

    const sheetNames = new Set<string>();
    for (const r of rows.slice(1)) {
        const v = String(r[nameIdx] ?? "").trim();
        if (v) sheetNames.add(v.toLowerCase());
    }

    if (sheetNames.size === 0) return { added: 0, skipped: 0, unresolved: [] };

    // 2. Resolve names → founder IDs in one query.
    const allFounders = await db
        .select({ id: founders.id, name: founders.name })
        .from(founders);

    const lookup = new Map<string, number>();
    for (const f of allFounders) {
        lookup.set(f.name.trim().toLowerCase(), f.id);
    }

    const matchedFounderIds: number[] = [];
    const unresolved: string[] = [];
    for (const name of sheetNames) {
        const id = lookup.get(name);
        if (id) matchedFounderIds.push(id);
        else unresolved.push(name);
    }

    if (matchedFounderIds.length === 0) {
        return { added: 0, skipped: 0, unresolved };
    }

    // 3. Find which of those founders are NOT already in this cohort.
    const existing = await db
        .select({ founderId: cohortCompanies.founderId })
        .from(cohortCompanies)
        .where(
            and(
                eq(cohortCompanies.cohortId, cohortId),
                inArray(cohortCompanies.founderId, matchedFounderIds),
            ),
        );

    const existingSet = new Set(existing.map((r) => r.founderId));
    const toInsert = matchedFounderIds.filter((id) => !existingSet.has(id));

    if (toInsert.length === 0) {
        return { added: 0, skipped: matchedFounderIds.length, unresolved };
    }

    // 4. Insert new memberships in one shot.
    await db
        .insert(cohortCompanies)
        .values(toInsert.map((fid) => ({ cohortId, founderId: fid, source: "sheet-sync" })))
        .onConflictDoNothing();

    return { added: toInsert.length, skipped: matchedFounderIds.length - toInsert.length, unresolved };
}

/** Find the column index that most likely holds the company name. */
function pickNameColumn(header: string[]): number {
    const candidates = ["company", "startup", "venture", "name", "founder"];
    for (const c of candidates) {
        const i = header.indexOf(c);
        if (i >= 0) return i;
    }
    // Fallback to the first column.
    return header.length > 0 ? 0 : -1;
}
