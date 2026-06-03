import { Router } from "express";
import { db, sprintsTable, foundersTable, emailLogsTable, usersTable } from "@workspace/db";
import { and, eq, or, count, gte, desc, inArray } from "drizzle-orm";
import OpenAI from "openai";

const router = Router();

// ─── OpenAI helpers (unchanged behavior) ──────────────────────────────────
let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openaiClient) {
    if (!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || !process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
      throw new Error("OpenAI AI integration not provisioned");
    }
    openaiClient = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
  }
  return openaiClient;
}

function toneInstruction(tone: string): string {
  switch (tone) {
    case "friendly": return "Write in a warm, encouraging, and friendly tone. Use casual but professional language.";
    case "formal": return "Write in a formal, corporate tone. Be structured and precise.";
    case "concise": return "Write concisely. Keep the email short and to the point. Avoid fluff.";
    default: return "Write in a professional, clear, and supportive tone.";
  }
}

async function enrichSprint(sprint: typeof sprintsTable.$inferSelect) {
  const [founder] = await db.select().from(foundersTable).where(eq(foundersTable.id, sprint.founderId)).limit(1);
  return {
    id: sprint.id,
    founderId: sprint.founderId,
    founderName: founder?.name ?? "",
    companyName: founder?.companyName ?? "",
    industry: founder?.industry ?? null,
    stage: founder?.stage ?? null,
    programName: founder?.acceleratorProgram ?? null,
    partnerName: founder?.partnerName ?? null,
    scheduledDate: sprint.scheduledDate,
    scheduledTime: sprint.scheduledTime ?? null,
    endTime: sprint.endTime ?? null,
    totalDuration: sprint.totalDuration ?? null,
    consultantName: sprint.consultantName,
    sprintHost: sprint.sprintHost ?? null,
    coHost: sprint.coHost ?? null,
    status: sprint.status,
    tsheetUrl: sprint.tsheetUrl ?? null,
    fathomUrl: sprint.fathomUrl ?? null,
    sprintNumber: sprint.sprintNumber ?? null,
    sessionType: sprint.sessionType ?? null,
    paymentStatus: sprint.paymentStatus ?? null,
    billedTo: sprint.billedTo ?? null,
    billNumber: sprint.billNumber ?? null,
    price: sprint.price ?? null,
    week: sprint.week ?? null,
    month: sprint.month ?? null,
    cyYear: sprint.cyYear ?? null,
    fyYear: sprint.fyYear ?? null,
    quarter: sprint.quarter ?? null,
    strengths: sprint.strengths ?? null,
    gaps: sprint.gaps ?? null,
    swotAnalysis: sprint.swotAnalysis ?? null,
    nextGoal: sprint.nextGoal ?? null,
    actionableSteps: sprint.actionableSteps ?? null,
    mentorshipRecommendation: sprint.mentorshipRecommendation ?? null,
    marketConnections: sprint.marketConnections ?? null,
    meetLink: sprint.meetLink ?? null,
    preEmailSentAt: sprint.preEmailSentAt?.toISOString() ?? null,
    postEmailSentAt: sprint.postEmailSentAt?.toISOString() ?? null,
    createdAt: sprint.createdAt?.toISOString(),
  };
}

/**
 * Builds the scope predicate so a consultant only sees sprints aligned to them.
 * "Aligned" = current user appears as consultant, host, or co-host.
 *
 * If ?all=true is passed, returns no predicate (admins can opt-in).
 * Right now policy = "everyone sees only their own" — no role-based override.
 */
async function buildUserScope(userId: number) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) return null;
  return or(
    eq(sprintsTable.consultantName, user.name),
    eq(sprintsTable.sprintHost, user.name),
    eq(sprintsTable.coHost, user.name),
  );
}

// ─── List ─────────────────────────────────────────────────────────────────
// `?scope=all` returns every sprint in the system (used by the Sprint Tracking
// "live list" page, which is the team-wide register).
// Default `?scope=mine` returns only sprints aligned to the requesting user
// (used by Dashboard + the user-facing T-Sprints list).
router.get("/sprints", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    const scopeAll = String(req.query.scope ?? "mine") === "all";
    const scope = scopeAll ? null : await buildUserScope(userId);
    const sprints = await db
      .select()
      .from(sprintsTable)
      .where(scope ?? undefined)
      .orderBy(desc(sprintsTable.scheduledDate), desc(sprintsTable.createdAt));
    const enriched = await Promise.all(sprints.map(enrichSprint));
    res.json(enriched);
  } catch (err) {
    req.log.error({ err }, "Error listing sprints");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Create ───────────────────────────────────────────────────────────────
router.post("/sprints", async (req, res) => {
  const {
    founderId, scheduledDate, scheduledTime, endTime, consultantName,
    sprintHost, coHost, meetLink, tsheetUrl, fathomUrl, sprintNumber, sessionType,
    paymentStatus, billedTo, billNumber, price,
  } = req.body;
  if (!founderId || !scheduledDate || !consultantName) {
    res.status(400).json({ error: "founderId, scheduledDate and consultantName are required" });
    return;
  }
  try {
    // derive period fields from scheduledDate
    const d = new Date(scheduledDate);
    const cyYear = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const quarter = `Q${Math.floor((month - 1) / 3) + 1}`;
    // ISO-ish week (good enough for filtering)
    const oneJan = new Date(Date.UTC(cyYear, 0, 1));
    const week = Math.ceil((((+d - +oneJan) / 86400000) + oneJan.getUTCDay() + 1) / 7);
    const fyYear = month >= 4 ? cyYear : cyYear - 1; // Indian FY: Apr–Mar

    const [sprint] = await db.insert(sprintsTable).values({
      founderId, scheduledDate, scheduledTime, endTime, consultantName,
      sprintHost: sprintHost ?? consultantName,
      coHost: coHost ?? null,
      meetLink,
      tsheetUrl: tsheetUrl ?? null,
      fathomUrl: fathomUrl ?? null,
      sprintNumber: sprintNumber ?? null,
      sessionType: sessionType ?? null,
      paymentStatus: paymentStatus ?? null,
      billedTo: billedTo ?? null,
      billNumber: billNumber ?? null,
      price: price ?? null,
      week, month, cyYear, fyYear, quarter,
    }).returning();
    res.status(201).json(await enrichSprint(sprint));
  } catch (err) {
    req.log.error({ err }, "Error creating sprint");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Read one ─────────────────────────────────────────────────────────────
router.get("/sprints/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [sprint] = await db.select().from(sprintsTable).where(eq(sprintsTable.id, id)).limit(1);
    if (!sprint) { res.status(404).json({ error: "Not found" }); return; }
    res.json(await enrichSprint(sprint));
  } catch (err) {
    req.log.error({ err }, "Error fetching sprint");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Update ───────────────────────────────────────────────────────────────
router.patch("/sprints/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = req.body as Partial<typeof sprintsTable.$inferInsert>;
  try {
    const updateData: Partial<typeof sprintsTable.$inferInsert> = {};
    const fields: Array<keyof typeof sprintsTable.$inferInsert> = [
      "scheduledDate", "scheduledTime", "endTime", "totalDuration", "consultantName",
      "sprintHost", "coHost", "status", "tsheetUrl", "fathomUrl", "sprintNumber", "sessionType",
      "paymentStatus", "billedTo", "billNumber", "price",
      "week", "month", "cyYear", "fyYear", "quarter",
      "strengths", "gaps", "swotAnalysis", "nextGoal", "actionableSteps",
      "mentorshipRecommendation", "marketConnections", "meetLink",
    ];
    for (const f of fields) if (body[f] !== undefined) (updateData as any)[f] = body[f];

    const [sprint] = await db.update(sprintsTable).set(updateData).where(eq(sprintsTable.id, id)).returning();
    if (!sprint) { res.status(404).json({ error: "Not found" }); return; }
    res.json(await enrichSprint(sprint));
  } catch (err) {
    req.log.error({ err }, "Error updating sprint");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Delete ───────────────────────────────────────────────────────────────
router.delete("/sprints/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(sprintsTable).where(eq(sprintsTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Error deleting sprint");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Pre-sprint email (AI-powered with template fallback) ────────────────────
router.post("/sprints/:id/pre-email", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const tone: string = req.body?.tone ?? "professional";
  try {
    const [sprint] = await db.select().from(sprintsTable).where(eq(sprintsTable.id, id)).limit(1);
    if (!sprint) { res.status(404).json({ error: "Sprint not found" }); return; }
    const [founder] = await db.select().from(foundersTable).where(eq(foundersTable.id, sprint.founderId)).limit(1);
    if (!founder) { res.status(404).json({ error: "Founder not found" }); return; }

    const dayName = sprint.scheduledDate ? new Date(sprint.scheduledDate).toLocaleDateString("en-US", { weekday: "long" }) : "[Day]";
    const dateFormatted = sprint.scheduledDate ? new Date(sprint.scheduledDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "[Date]";
    const time = sprint.scheduledTime ?? "[Time]";
    let body: string;
    const subject = `T-Sprint Session with Thinking Spree — ${founder.companyName}`;

    try {
      const ai = getOpenAI();
      const contextLines = [
        `Startup: ${founder.companyName}`,
        `Founder name: ${founder.name}`,
        founder.stage ? `Stage: ${founder.stage}` : "",
        founder.sector ? `Sector: ${founder.sector}` : "",
        founder.description ? `About: ${founder.description.slice(0, 300)}` : "",
        `Consultant: ${sprint.consultantName}`,
        sprint.sprintHost ? `Host: ${sprint.sprintHost}` : "",
        sprint.coHost ? `Co-host: ${sprint.coHost}` : "",
        `Session date: ${dayName}, ${dateFormatted} at ${time}`,
        sprint.meetLink ? `Meeting link: ${sprint.meetLink}` : "",
        sprint.tsheetUrl ? `T-Sheet link: ${sprint.tsheetUrl}` : "",
        founder.acceleratorProgram ? `Program: ${founder.acceleratorProgram}` : "",
      ].filter(Boolean).join("\n");

      const systemPrompt = `You are a consultant at Thinking Spree, a startup consulting firm that runs T-Sprint sessions — focused, outcome-driven 1:1 startup advisory sessions. ${toneInstruction(tone)}

Write a pre-sprint invitation email to a founder. The email must:
1. Open with "Hi [first name],"
2. Briefly introduce the T-Sprint format
3. Explain what to expect in the first session
4. Give 3 concrete preparation tips
5. Mention the session date/time and consultant name warmly
6. Include the meeting link if provided
7. Close with: "Regards,\\n\\nTeam Thinking Spree"

Keep under 320 words. Output only the email body text.`;

      const completion = await ai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Context:\n${contextLines}` },
        ],
        temperature: 0.7,
        max_tokens: 550,
      });
      body = completion.choices[0]?.message?.content?.trim() ?? "";
    } catch (aiErr) {
      req.log.warn({ aiErr }, "AI unavailable, using template");
      body = `Hi ${founder.name},\n\nHope you are doing well. We are excited to initiate your T-Sprints journey for your company ${founder.companyName} with a 1:1 Need Assessment session.\n\nYour consultant, ${sprint.consultantName} at Thinking Spree, is eagerly looking forward to meeting with you on ${dayName}, ${dateFormatted}, ${time}.${sprint.meetLink ? `\n\nJoin the session here: ${sprint.meetLink}` : ""}\n\nRegards,\n\nTeam Thinking Spree`;
    }

    res.json({ subject, body, to: founder.email, toName: founder.name, sprintId: id, emailType: "pre_sprint" });
  } catch (err) {
    req.log.error({ err }, "Error generating pre-sprint email");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Post-sprint email (AI-powered with template fallback) ──────────────────
router.post("/sprints/:id/post-email", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const tone: string = req.body?.tone ?? "professional";
  try {
    const [sprint] = await db.select().from(sprintsTable).where(eq(sprintsTable.id, id)).limit(1);
    if (!sprint) { res.status(404).json({ error: "Sprint not found" }); return; }
    const [founder] = await db.select().from(foundersTable).where(eq(foundersTable.id, sprint.founderId)).limit(1);
    if (!founder) { res.status(404).json({ error: "Founder not found" }); return; }

    const subject = `T-Sprint Recap — ${founder.companyName}`;
    let body: string;

    try {
      const ai = getOpenAI();
      const contextLines = [
        `Startup: ${founder.companyName}`,
        `Founder name: ${founder.name}`,
        founder.stage ? `Stage: ${founder.stage}` : "",
        founder.sector ? `Sector: ${founder.sector}` : "",
        `Consultant: ${sprint.consultantName}`,
        sprint.sprintHost ? `Host: ${sprint.sprintHost}` : "",
        sprint.coHost ? `Co-host: ${sprint.coHost}` : "",
        sprint.sprintNumber != null ? `Sprint number: ${sprint.sprintNumber}` : "",
        sprint.strengths     ? `Strengths discussed: ${sprint.strengths}` : "",
        sprint.gaps          ? `Gaps identified: ${sprint.gaps}` : "",
        sprint.swotAnalysis  ? `SWOT notes: ${sprint.swotAnalysis}` : "",
        sprint.nextGoal      ? `Next goal: ${sprint.nextGoal}` : "",
        sprint.actionableSteps        ? `Actionable steps: ${sprint.actionableSteps}` : "",
        sprint.mentorshipRecommendation ? `Mentorship recommendation: ${sprint.mentorshipRecommendation}` : "",
        sprint.marketConnections      ? `Market connections: ${sprint.marketConnections}` : "",
      ].filter(Boolean).join("\n");

      const systemPrompt = `You are a consultant at Thinking Spree writing a follow-up email after a T-Sprint advisory session with a founder. ${toneInstruction(tone)}

The email must:
1. Open with "Hi [first name],"
2. Thank them briefly for the session
3. Summarize the key strengths discussed (use the provided notes — do not invent)
4. Call out the gaps to address
5. State the agreed next goal
6. List 3-5 concrete actionable next steps as a short bulleted list
7. Mention any mentorship recommendation or market connection where provided
8. Close with: "Best Regards,\\nTeam Thinking Spree"

If a section has no notes provided, omit it entirely rather than writing a placeholder. Keep under 350 words. Output only the email body text.`;

      const completion = await ai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Context:\n${contextLines}` },
        ],
        temperature: 0.6,
        max_tokens: 700,
      });
      body = completion.choices[0]?.message?.content?.trim() ?? "";
      if (!body) throw new Error("AI returned empty body");
    } catch (aiErr) {
      req.log.warn({ aiErr }, "AI unavailable for post-sprint, using template");
      body = `Hi ${founder.name},\n\nThank you for the T-Sprint session.\n\nKey strengths we discussed:\n${sprint.strengths ?? "—"}\n\nGaps to address:\n${sprint.gaps ?? "—"}\n\nNext goal:\n${sprint.nextGoal ?? "—"}\n\nActionable steps:\n${sprint.actionableSteps ?? "—"}\n\nBest Regards,\nTeam Thinking Spree`;
    }

    res.json({ subject, body, to: founder.email, toName: founder.name, sprintId: id, emailType: "post_sprint" });
  } catch (err) {
    req.log.error({ err }, "Error generating post-sprint email");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Stats overview — scoped to current user ──────────────────────────────
router.get("/stats/overview", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    const scope = await buildUserScope(userId);
    const allSprints = await db.select().from(sprintsTable).where(scope ?? undefined);

    // Founder counts: founders touched by sprints in this user's scope
    const founderIds = [...new Set(allSprints.map(s => s.founderId))];
    const totalFounders = founderIds.length;

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 7);

    // Scope email logs by the user's sprint IDs
    let emailsSentThisMonth = 0;
    if (allSprints.length > 0) {
      const [row] = await db.select({ count: count() }).from(emailLogsTable).where(
        and(gte(emailLogsTable.sentAt, startOfMonth), inArray(emailLogsTable.sprintId, allSprints.map(s => s.id)))
      );
      emailsSentThisMonth = Number(row?.count ?? 0);
    }

    const totalSprints     = allSprints.length;
    const scheduledSprints = allSprints.filter(s => s.status === "scheduled").length;
    const completedSprints = allSprints.filter(s => s.status === "completed").length;
    const upcomingThisWeek = allSprints.filter(s => {
      const d = new Date(s.scheduledDate);
      return d >= startOfWeek && d <= endOfWeek && s.status === "scheduled";
    }).length;

    res.json({
      totalSprints, scheduledSprints, completedSprints, totalFounders,
      emailsSentThisMonth, upcomingThisWeek,
    });
  } catch (err) {
    req.log.error({ err }, "Error getting stats");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
