/**
 * Sprint Outcomes Report.
 *
 * GET /reports/outcomes?from=YYYY-MM-DD&to=YYYY-MM-DD&cohort=ISB_IVI4.0
 *
 * Aggregates Sprint Template companies in the given date+cohort window
 * and returns:
 *   - totals (companies, completed sprints, emails sent, etc.)
 *   - stage breakdown
 *   - per-cohort breakdown
 *   - top observations themes (extracted naively by keyword frequency)
 *
 * Read-only; no writes. Available to consultant / research / admin roles.
 */
import { Router } from "express";
import {
  db, foundersTable, incubatorsTable, companyEventsTable, emailDraftsTable, usersTable,
  canAccessResearch,
} from "@workspace/db";
import { and, eq, gte, lte, sql, inArray, isNotNull } from "drizzle-orm";

const router = Router();

async function getMe(req: any, res: any) {
  const uid = req.session?.userId;
  if (!uid) { res.status(401).json({ error: "Not authenticated" }); return null; }
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, uid)).limit(1);
  if (!u) { res.status(401).json({ error: "User not found" }); return null; }
  return u;
}

router.get("/reports/outcomes", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  // Outcomes report is consultant-grade insight — same gate as research.
  if (!canAccessResearch(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }

  // Parse filters. Defaults: last 30 days, all cohorts.
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const from = req.query.from ? new Date(String(req.query.from)) : defaultFrom;
  const to = req.query.to ? new Date(String(req.query.to)) : now;
  const cohort = req.query.cohort ? String(req.query.cohort).trim() : null;

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    res.status(400).json({ error: "Invalid date range" }); return;
  }
  // End of day for `to` so the picker behaves intuitively (inclusive).
  to.setHours(23, 59, 59, 999);

  try {
    // Resolve cohort name to incubator_id if filter is set.
    let incubatorIds: number[] | null = null;
    if (cohort) {
      const matches = await db.select({ id: incubatorsTable.id, name: incubatorsTable.name })
        .from(incubatorsTable)
        .where(sql`LOWER(${incubatorsTable.name}) = LOWER(${cohort})`);
      incubatorIds = matches.map(m => m.id);
      if (incubatorIds.length === 0) {
        res.json({
          range: { from: from.toISOString(), to: to.toISOString() },
          cohort,
          totals: zeroTotals(),
          byStage: [], byCohort: [], topObservationWords: [], topCompanies: [],
        });
        return;
      }
    }

    // ─── Base company set in window ───────────────────────────────────
    // Companies created OR last-updated within the date window.
    const companyWhere = and(
      gte(foundersTable.createdAt, from),
      lte(foundersTable.createdAt, to),
      incubatorIds ? inArray(foundersTable.incubatorId, incubatorIds) : undefined,
      inArray(foundersTable.source, ["sprint_template_upload", "google_sheets_sync"]),
    );

    const companies = await db.select({
      id: foundersTable.id,
      companyName: foundersTable.companyName,
      incubatorId: foundersTable.incubatorId,
      stageWorkflow: foundersTable.stageWorkflow,
      observations: foundersTable.observationsTsDashboard,
      createdAt: foundersTable.createdAt,
    }).from(foundersTable).where(companyWhere);

    const totalCompanies = companies.length;
    const founderIds = companies.map(c => c.id);

    // ─── Email totals in window ───────────────────────────────────────
    let preEmailSent = 0, postEmailSent = 0;
    if (founderIds.length > 0) {
      const drafts = await db.select({
        kind: emailDraftsTable.kind,
      })
        .from(emailDraftsTable)
        .where(and(
          inArray(emailDraftsTable.founderId, founderIds),
          isNotNull(emailDraftsTable.sentAt),
          gte(emailDraftsTable.sentAt, from),
          lte(emailDraftsTable.sentAt, to),
        ));
      for (const d of drafts) {
        if (d.kind === "pre") preEmailSent++;
        if (d.kind === "post") postEmailSent++;
      }
    }

    // ─── Stage breakdown ──────────────────────────────────────────────
    const byStageMap: Record<string, number> = {};
    for (const c of companies) {
      const k = c.stageWorkflow ?? "pre_sprint";
      byStageMap[k] = (byStageMap[k] ?? 0) + 1;
    }
    const byStage = Object.entries(byStageMap)
      .map(([stage, count]) => ({ stage, count }))
      .sort((a, b) => b.count - a.count);

    const completedCount = (byStageMap["sprint_done"] ?? 0) + (byStageMap["post_email_sent"] ?? 0);
    const completionRate = totalCompanies > 0 ? Math.round((completedCount / totalCompanies) * 100) : 0;

    // ─── Cohort breakdown ─────────────────────────────────────────────
    const allIncubators = await db.select({ id: incubatorsTable.id, name: incubatorsTable.name }).from(incubatorsTable);
    const incNameById = new Map(allIncubators.map(i => [i.id, i.name]));
    const byCohortMap: Record<string, number> = {};
    for (const c of companies) {
      const name = c.incubatorId ? (incNameById.get(c.incubatorId) ?? "Unknown") : "No cohort";
      byCohortMap[name] = (byCohortMap[name] ?? 0) + 1;
    }
    const byCohort = Object.entries(byCohortMap)
      .map(([cohortName, count]) => ({ cohort: cohortName, count }))
      .sort((a, b) => b.count - a.count);

    // ─── Top observation themes (naive word frequency) ────────────────
    // Skips stopwords, requires word ≥ 4 chars. Top 15.
    const STOPWORDS = new Set([
      "the","and","that","with","this","they","have","from","will","would","there",
      "should","could","because","what","when","into","their","them","also","very",
      "than","then","just","like","much","many","more","most","some","such","still",
      "founder","company","startup","sprint","need","needs","needed","want","wants",
      "going","going","really","quite","being","been","were","while","without",
      "founders","companies","startups","through","across","around","sprints",
    ]);
    const wordCounts: Record<string, number> = {};
    for (const c of companies) {
      if (!c.observations) continue;
      const words = c.observations.toLowerCase().match(/[a-z]{4,}/g) ?? [];
      const seenInThisDoc = new Set<string>();
      for (const w of words) {
        if (STOPWORDS.has(w)) continue;
        if (seenInThisDoc.has(w)) continue;   // count once per company so a verbose note doesn't dominate
        seenInThisDoc.add(w);
        wordCounts[w] = (wordCounts[w] ?? 0) + 1;
      }
    }
    const topObservationWords = Object.entries(wordCounts)
      .map(([word, count]) => ({ word, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    // ─── Top companies (most recent N completed sprints) ──────────────
    const topCompanies = companies
      .filter(c => c.stageWorkflow === "sprint_done" || c.stageWorkflow === "post_email_sent")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 10)
      .map(c => ({
        id: c.id,
        companyName: c.companyName,
        cohort: c.incubatorId ? incNameById.get(c.incubatorId) ?? null : null,
        stage: c.stageWorkflow,
        createdAt: c.createdAt.toISOString(),
      }));

    res.json({
      range: { from: from.toISOString(), to: to.toISOString() },
      cohort,
      totals: {
        companies: totalCompanies,
        completedSprints: completedCount,
        completionRate,
        preEmailSent,
        postEmailSent,
        observationsRecorded: companies.filter(c => c.observations?.trim()).length,
      },
      byStage,
      byCohort,
      topObservationWords,
      topCompanies,
    });
  } catch (err) {
    req.log.error({ err }, "Outcomes report failed");
    res.status(500).json({ error: "Failed to generate report" });
  }
});

function zeroTotals() {
  return { companies: 0, completedSprints: 0, completionRate: 0, preEmailSent: 0, postEmailSent: 0, observationsRecorded: 0 };
}

export default router;
