import { Router } from "express";
import { db, foundersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

function mapFounder(f: typeof foundersTable.$inferSelect) {
  return {
    id: f.id,
    incubatorId: f.incubatorId,
    name: f.name,
    email: f.email,
    companyName: f.companyName,
    sector: f.sector,
    stage: f.stage,
    description: f.description,
    acceleratorProgram: f.acceleratorProgram,
    thinkingSheetUrl: f.thinkingSheetUrl,
    createdAt: f.createdAt?.toISOString(),
  };
}

router.get("/founders", async (req, res) => {
  try {
    const founders = await db.select().from(foundersTable).orderBy(foundersTable.createdAt);
    res.json(founders.map(mapFounder));
  } catch (err) {
    req.log.error({ err }, "Error listing founders");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/founders", async (req, res) => {
  const { name, email, companyName, sector, stage, description, acceleratorProgram, thinkingSheetUrl, incubatorId } = req.body;
  if (!name || !email || !companyName) {
    res.status(400).json({ error: "name, email and companyName are required" });
    return;
  }
  try {
    const [founder] = await db.insert(foundersTable).values({ name, email, companyName, sector, stage, description, acceleratorProgram, thinkingSheetUrl, incubatorId: incubatorId ? parseInt(incubatorId) : null }).returning();
    res.status(201).json(mapFounder(founder));
  } catch (err) {
    req.log.error({ err }, "Error creating founder");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/founders/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [founder] = await db.select().from(foundersTable).where(eq(foundersTable.id, id)).limit(1);
    if (!founder) { res.status(404).json({ error: "Not found" }); return; }
    res.json(mapFounder(founder));
  } catch (err) {
    req.log.error({ err }, "Error fetching founder");
    res.status(500).json({ error: "Internal server error" });
  }
});

// List of fields that consultants (or AI-assisted updates) can modify
// post-creation. Keeps the route lean while still accepting the full
// summary-sheet shape produced by `/ai/sprints/:id/summary-update`.
const PATCHABLE_FIELDS = [
  // identity / basics
  "name", "email", "companyName", "contact",
  "founder2Name", "founder2Email", "founder2Contact",
  "sector", "industry", "stage", "description",
  "acceleratorProgram", "partnerName", "thinkingSheetUrl",
  // rich summary fields
  "goalSetting", "revenueLast12Months", "revenueLastMonthMrr", "teamSize",
  "keyStrength", "gap", "conceptAndSessions", "mentorRecommendation",
  "marketAccess", "idealCustomerList", "timelineForMarketAccess",
  "observationsTs", "recommendationForVc",
  "previousFundraiseInr", "previousFundraiseOrgs", "currentBurn", "fundAskCr",
  "fundraiseCommitments", "fundraiseNotes", "fathomLink",
  "currentProblem", "suggestedNextStep", "nextFiveSprints",
  "caseStudyWorthy", "caseStudyTheme", "trainingWorthy", "trainingTheme",
  "level", "tSprintIntervention", "tasks",
] as const;

router.patch("/founders/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    // Build the update payload from only the keys present in the request body
    // AND in our patchable allow-list. This way the AI summary-update route can
    // send a partial patch with any subset of summary fields.
    const update: Record<string, any> = {};
    for (const k of PATCHABLE_FIELDS) {
      if (k in req.body && req.body[k] !== undefined) {
        update[k] = req.body[k];
      }
    }
    if ("incubatorId" in req.body) {
      update.incubatorId = req.body.incubatorId ? parseInt(req.body.incubatorId) : null;
    }
    if (Object.keys(update).length === 0) {
      res.status(400).json({ error: "No updatable fields in request" });
      return;
    }
    const [founder] = await db.update(foundersTable).set(update).where(eq(foundersTable.id, id)).returning();
    if (!founder) { res.status(404).json({ error: "Not found" }); return; }
    res.json(mapFounder(founder));
  } catch (err) {
    req.log.error({ err }, "Error updating founder");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/founders/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(foundersTable).where(eq(foundersTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Error deleting founder");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
