import { Router } from "express";
import { db, incubatorsTable, foundersTable, sprintsTable } from "@workspace/db";
import { eq, count, inArray, and, or } from "drizzle-orm";

const router = Router();

/**
 * Allow-list: per product decision, the Summary surface only shows
 * the two real program types: ISB and JU. The "demo" type still exists in
 * the schema (and incubators table) for the seed scaffolding, but it's
 * hidden from the Summary page so consultants only see real ventures.
 */
/**
 * Type filtering — historically restricted to ISB / JU only. In v4.8 we
 * open this up so consultants can use any cohort name (Wadhwani, Ashoka,
 * ISB_IVI4.0, etc.) and have it appear on the Summary page automatically.
 * The function still exists to filter out reserved internal types (none
 * currently), and to centralize the canonical-case mapping.
 */
const RESERVED_INTERNAL_TYPES = new Set<string>(["__system"]);
type AllowedType = string;
function normalizeType(t: string): AllowedType | null {
  const lower = t.toLowerCase().trim();
  if (!lower) return null;
  if (RESERVED_INTERNAL_TYPES.has(lower)) return null;
  return lower;
}

async function getSprintCountForFounders(founderIds: number[]): Promise<number> {
  if (founderIds.length === 0) return 0;
  const [row] = await db
    .select({ cnt: count() })
    .from(sprintsTable)
    .where(inArray(sprintsTable.founderId, founderIds));
  return Number(row?.cnt ?? 0);
}

/**
 * Source values that count as "real" Summary founders. Includes:
 *   isb-summary / ju-summary  → CSV-imported curated founders (legacy)
 *   sprint_template_upload    → file upload via Sprint Template
 *   google_sheets_sync        → Google Sheets link ingestion (current path)
 *
 * Excludes the bulk Sheet Tracking imports (`source = 'sheet-tracking'`)
 * which are auto-created from session logs and shouldn't pollute the
 * Summary view.
 */
function isSummarySourceForType(type: string): string[] | null {
  const t = type.toLowerCase();
  const legacy: string[] = [];
  if (t === "isb") legacy.push("isb-summary");
  if (t === "ju")  legacy.push("ju-summary");
  // Sprint Template sources count for every cohort type (they're explicit
  // consultant actions, not bulk imports).
  return [...legacy, "sprint_template_upload", "google_sheets_sync"];
}

router.get("/incubators", async (req, res) => {
  try {
    const incubators = await db.select().from(incubatorsTable).orderBy(incubatorsTable.createdAt);
    const filtered = incubators.filter(i => normalizeType(i.type) !== null);
    const result = await Promise.all(filtered.map(async (inc) => {
      const acceptedSources = isSummarySourceForType(inc.type);
      // Only count founders whose source is one of the accepted-summary
      // sources. This keeps bulk session-tracking imports out of the count
      // while still showing Sprint Template additions.
      const founders = await db
        .select({ id: foundersTable.id })
        .from(foundersTable)
        .where(and(
          eq(foundersTable.incubatorId, inc.id),
          acceptedSources && acceptedSources.length > 0
            ? inArray(foundersTable.source, acceptedSources)
            : undefined,
        ));
      const founderIds = founders.map(f => f.id);
      const sprintCnt = await getSprintCountForFounders(founderIds);
      return {
        id: inc.id,
        name: inc.name,
        type: inc.type,
        sheetUrl: inc.sheetUrl,
        description: inc.description,
        ventureCount: founders.length,
        sprintCount: sprintCnt,
        createdAt: inc.createdAt.toISOString(),
      };
    }));
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Error listing incubators");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/incubators", async (req, res) => {
  const { name, type, sheetUrl, description } = req.body;
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  const normalized = normalizeType(String(type ?? "isb"));
  if (!normalized) {
    res.status(400).json({ error: "type cannot be empty" });
    return;
  }
  try {
    const [inc] = await db
      .insert(incubatorsTable)
      .values({ name, type: normalized, sheetUrl, description })
      .returning();
    res.status(201).json({
      id: inc.id, name: inc.name, type: inc.type,
      sheetUrl: inc.sheetUrl, description: inc.description,
      ventureCount: 0, sprintCount: 0,
      createdAt: inc.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Error creating incubator");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/incubators/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [inc] = await db
      .select()
      .from(incubatorsTable)
      .where(eq(incubatorsTable.id, id))
      .limit(1);
    if (!inc) { res.status(404).json({ error: "Not found" }); return; }
    if (!normalizeType(inc.type)) { res.status(404).json({ error: "Not found" }); return; }

    const acceptedSources = isSummarySourceForType(inc.type);
    const founders = await db
      .select()
      .from(foundersTable)
      .where(and(
        eq(foundersTable.incubatorId, id),
        acceptedSources && acceptedSources.length > 0
          ? inArray(foundersTable.source, acceptedSources)
          : undefined,
      ));

    const ventures = await Promise.all(founders.map(async (f) => {
      const sprints = await db
        .select()
        .from(sprintsTable)
        .where(eq(sprintsTable.founderId, f.id))
        .orderBy(sprintsTable.scheduledDate);

      const lastSprint = sprints[sprints.length - 1];
      const completed = sprints.filter(s => s.status === "completed").length;

      return {
        id: f.id,
        name: f.name,
        companyName: f.companyName,
        email: f.email,
        contact: f.contact,
        sector: f.sector,
        industry: f.industry,
        stage: f.stage,
        description: f.description,
        partnerName: f.partnerName,
        // Rich summary fields
        goalSetting: f.goalSetting,
        revenueLast12Months: f.revenueLast12Months,
        revenueLastMonthMrr: f.revenueLastMonthMrr,
        teamSize: f.teamSize,
        keyStrength: f.keyStrength,
        gap: f.gap,
        conceptAndSessions: f.conceptAndSessions,
        mentorRecommendation: f.mentorRecommendation,
        marketAccess: f.marketAccess,
        idealCustomerList: f.idealCustomerList,
        observationsTs: f.observationsTs,
        recommendationForVc: f.recommendationForVc,
        previousFundraiseInr: f.previousFundraiseInr,
        previousFundraiseOrgs: f.previousFundraiseOrgs,
        currentBurn: f.currentBurn,
        fundAskCr: f.fundAskCr,
        fundraiseCommitments: f.fundraiseCommitments,
        fundraiseNotes: f.fundraiseNotes,
        fathomLink: f.fathomLink,
        currentProblem: f.currentProblem,
        suggestedNextStep: f.suggestedNextStep,
        nextFiveSprints: f.nextFiveSprints,
        caseStudyWorthy: f.caseStudyWorthy,
        caseStudyTheme: f.caseStudyTheme,
        trainingWorthy: f.trainingWorthy,
        trainingTheme: f.trainingTheme,
        level: f.level,
        tSprintIntervention: f.tSprintIntervention,
        tasks: f.tasks,
        // Sprint counts
        sprintCount: sprints.length,
        lastSprintDate: lastSprint?.scheduledDate ?? null,
        lastSprintStatus: lastSprint?.status ?? null,
        completedSprints: completed,
        sprints: sprints.map(s => ({
          id: s.id,
          scheduledDate: s.scheduledDate,
          scheduledTime: s.scheduledTime,
          status: s.status,
          consultantName: s.consultantName,
          sprintHost: s.sprintHost,
          coHost: s.coHost,
          strengths: s.strengths,
          gaps: s.gaps,
          nextGoal: s.nextGoal,
          actionableSteps: s.actionableSteps,
          preEmailSentAt: s.preEmailSentAt?.toISOString() ?? null,
          postEmailSentAt: s.postEmailSentAt?.toISOString() ?? null,
        })),
      };
    }));

    res.json({
      id: inc.id,
      name: inc.name,
      type: inc.type,
      sheetUrl: inc.sheetUrl,
      description: inc.description,
      ventures,
      createdAt: inc.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching incubator");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/incubators/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { name, type, sheetUrl, description } = req.body;
  if (type !== undefined && !normalizeType(String(type))) {
    res.status(400).json({ error: "type cannot be empty" });
    return;
  }
  try {
    const [inc] = await db
      .update(incubatorsTable)
      .set({ name, type: type ? normalizeType(String(type))! : undefined, sheetUrl, description })
      .where(eq(incubatorsTable.id, id))
      .returning();
    if (!inc) { res.status(404).json({ error: "Not found" }); return; }
    res.json({
      id: inc.id, name: inc.name, type: inc.type,
      sheetUrl: inc.sheetUrl, description: inc.description,
      ventureCount: 0, sprintCount: 0,
      createdAt: inc.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Error updating incubator");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/incubators/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(incubatorsTable).where(eq(incubatorsTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Error deleting incubator");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
