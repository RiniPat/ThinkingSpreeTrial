import { Router } from "express";
import { db, sprintsTable, foundersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/summary", async (req, res) => {
  try {
    const sprints = await db.select().from(sprintsTable).orderBy(sprintsTable.scheduledDate);
    const records = await Promise.all(sprints.map(async (sprint) => {
      const [founder] = await db.select().from(foundersTable).where(eq(foundersTable.id, sprint.founderId)).limit(1);
      return {
        id: sprint.id,
        sprintId: sprint.id,
        founderName: founder?.name ?? "",
        companyName: founder?.companyName ?? "",
        sprintDate: sprint.scheduledDate,
        consultantName: sprint.consultantName,
        strengths: sprint.strengths,
        gaps: sprint.gaps,
        nextGoal: sprint.nextGoal,
        preEmailSentAt: sprint.preEmailSentAt?.toISOString() ?? null,
        postEmailSentAt: sprint.postEmailSentAt?.toISOString() ?? null,
      };
    }));
    res.json(records);
  } catch (err) {
    req.log.error({ err }, "Error fetching summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
