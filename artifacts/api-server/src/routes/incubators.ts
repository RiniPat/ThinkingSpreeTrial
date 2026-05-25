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
const ALLOWED_TYPES = ["isb", "ju"] as const;
type AllowedType = typeof ALLOWED_TYPES[number];
function normalizeType(t: string): AllowedType | null {
  const lower = t.toLowerCase().trim();
  if (lower === "isb") return "isb";
  if (lower === "ju") return "ju";
  return null;
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
 * The Summary page shows ONLY founders curated in the ISB/JU summary sheets.
 * Sheet Tracking creates ~700 additional founder rows that share an incubator_id
 * (because Program Name matches "ISB" / "JU"), but those weren't intentionally
 * added to the Summary view by a consultant — they're just session-tracking
 * rows. We filter them out here.
 */
function isSummarySourceForType(type: string): string | null {
  const t = type.toLowerCase();
  if (t === "isb") return "isb-summary";
  if (t === "ju")  return "ju-summary";
  return null;
}

router.get("/incubators", async (req, res) => {
  try {
    const incubators = await db.select().from(incubatorsTable).orderBy(incubatorsTable.createdAt);
    const filtered = incubators.filter(i => normalizeType(i.type) !== null);
    const result = await Promise.all(filtered.map(async (inc) => {
      const expectedSource = isSummarySourceForType(inc.type);
      // Only count founders that came from the matching Summary sheet import.
      // Founders created by the Sheet Tracking importer (`source = 'sheet-tracking'`)
      // are excluded even if their incubator_id matches.
      const founders = await db
        .select({ id: foundersTable.id })
        .from(foundersTable)
        .where(and(
          eq(foundersTable.incubatorId, inc.id),
          expectedSource ? eq(foundersTable.source, expectedSource) : undefined,
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
    res.status(400).json({ error: "type must be one of: isb, ju" });
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

    const expectedSource = isSummarySourceForType(inc.type);
    const founders = await db
      .select()
      .from(foundersTable)
      .where(and(
        eq(foundersTable.incubatorId, id),
        expectedSource ? eq(foundersTable.source, expectedSource) : undefined,
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
    res.status(400).json({ error: "type must be one of: isb, ju" });
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
