/**
 * Research & Sales Workspace API.
 *
 * Endpoints:
 *   GET    /research/outputs                  — list user's research outputs (filterable)
 *   POST   /research/generate                 — generate via Gemini, save row
 *   GET    /research/outputs/:id              — fetch one
 *   PATCH  /research/outputs/:id              — edit title / notes
 *   DELETE /research/outputs/:id              — remove
 *
 *   POST   /research/inspiration/recommend    — closest real comparables (grounded) + saves session
 *   POST   /research/inspiration/roadmap      — grounded, sourced deep-dive + save + link to session
 *   GET    /research/inspiration/sessions     — resumable workbench sessions
 *
 *   GET    /sales/leads                       — list sales leads
 *   POST   /sales/leads                       — create
 *   PATCH  /sales/leads/:id                   — update fields / stage
 *   DELETE /sales/leads/:id                   — remove
 *
 *   POST   /sales/linkedin-outreach           — Gemini call (no DB persistence — ephemeral)
 *
 *   GET    /sales/proposals                   — list proposals
 *   POST   /sales/proposals                   — create blank proposal with sections
 *   GET    /sales/proposals/:id               — fetch one
 *   PATCH  /sales/proposals/:id               — update meta / sections
 *   POST   /sales/proposals/:id/fill-section  — Gemini fills one section
 *   DELETE /sales/proposals/:id               — remove
 *
 *   GET    /admin/users                       — admin: list users
 *   PATCH  /admin/users/:id/role              — admin: change a user's role
 */
import { Router } from "express";
import {
  db, usersTable, foundersTable,
  researchOutputsTable, isResearchTool, RESEARCH_TOOLS,
  salesLeadsTable, isSalesLeadStage,
  proposalsTable, type ProposalSection,
  isRole, canAccessResearch, canAccessSales, canManageRoles,
} from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import {
  generateCustomerSegmentation, generateIcpMapping, generateTamSamSom,
  generateIndustryLandscape, generateBusinessModelCanvas,
  generateLinkedInOutreach, fillProposalSection,
} from "../lib/researchAi";
import XLSX from "xlsx";
import { fetchSheetAsWorkbook } from "../lib/sheetsFetcher";
import {
  recommendSimilarCompanies, generateInspirationRoadmap,
} from "../lib/researchAi.inspiration";

const router = Router();

async function getMe(req: any, res: any) {
  const uid = req.session?.userId;
  if (!uid) { res.status(401).json({ error: "Not authenticated" }); return null; }
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, uid)).limit(1);
  if (!u) { res.status(401).json({ error: "User not found" }); return null; }
  return u;
}

// ═══════════════════════ RESEARCH OUTPUTS ════════════════════════════════

router.get("/research/outputs", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessResearch(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }

  try {
    const tool = req.query.tool ? String(req.query.tool) : null;
    const founderId = req.query.founderId ? Number(req.query.founderId) : null;

    // Research outputs are visible to all research/consultant/admin users.
    // Sales role doesn't see this list.
    let rows = await db.select().from(researchOutputsTable)
      .where(and(
        tool ? eq(researchOutputsTable.tool, tool) : undefined,
        founderId && Number.isFinite(founderId) ? eq(researchOutputsTable.founderId, founderId) : undefined,
      ))
      .orderBy(desc(researchOutputsTable.createdAt));

    res.json({ outputs: rows });
  } catch (err) {
    req.log.error({ err }, "List research outputs failed");
    res.status(500).json({ error: "Failed to list research outputs" });
  }
});

/**
 * Body: { tool, title, inputs, founderId? }
 * Generates and saves in one shot. Returns the full row including the AI
 * output JSON.
 */
router.post("/research/generate", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessResearch(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }

  const tool = String(req.body?.tool ?? "");
  const title = String(req.body?.title ?? "").trim();
  const inputs = req.body?.inputs ?? {};
  const founderId = req.body?.founderId ? Number(req.body.founderId) : null;

  if (!isResearchTool(tool)) { res.status(400).json({ error: `tool must be one of: ${RESEARCH_TOOLS.join(", ")}` }); return; }
  if (!title) { res.status(400).json({ error: "title required" }); return; }

  try {
    // Dispatch to the right generator based on the tool. Each generator
    // throws on its own validation failures (missing required inputs).
    let output: unknown;
    switch (tool) {
      case "customer_segmentation":
        output = await generateCustomerSegmentation(inputs); break;
      case "icp_mapping":
        output = await generateIcpMapping(inputs); break;
      case "tam_sam_som":
        output = await generateTamSamSom(inputs); break;
      case "industry_landscape":
        output = await generateIndustryLandscape(inputs); break;
      case "business_model_canvas":
        output = await generateBusinessModelCanvas(inputs); break;
    }

    const [saved] = await db.insert(researchOutputsTable).values({
      userId: me.id,
      tool,
      founderId,
      title,
      inputs,
      output: output as any,
    }).returning();

    res.json({ output: saved });
  } catch (err) {
    req.log.error({ err }, "Research generation failed");
    const msg = err instanceof Error ? err.message : "Generation failed";
    res.status(500).json({ error: msg });
  }
});

router.get("/research/outputs/:id", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessResearch(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [row] = await db.select().from(researchOutputsTable).where(eq(researchOutputsTable.id, id)).limit(1);
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ output: row });
  } catch (err) {
    req.log.error({ err }, "Get research output failed");
    res.status(500).json({ error: "Failed to load" });
  }
});

router.patch("/research/outputs/:id", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessResearch(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof req.body?.title === "string") patch.title = req.body.title.trim();
  if (typeof req.body?.notes === "string") patch.notes = req.body.notes;
  if (req.body?.output) patch.output = req.body.output;

  try {
    await db.update(researchOutputsTable).set(patch).where(eq(researchOutputsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Patch research output failed");
    res.status(500).json({ error: "Failed to update" });
  }
});

router.delete("/research/outputs/:id", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessResearch(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(researchOutputsTable).where(eq(researchOutputsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Delete research output failed");
    res.status(500).json({ error: "Failed to delete" });
  }
});

// ═══════════════════════ SALES LEADS ══════════════════════════════════════

router.get("/sales/leads", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessSales(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }
  try {
    const rows = await db.select().from(salesLeadsTable).orderBy(desc(salesLeadsTable.updatedAt));
    res.json({ leads: rows });
  } catch (err) {
    req.log.error({ err }, "List sales leads failed");
    res.status(500).json({ error: "Failed to list" });
  }
});

router.post("/sales/leads", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessSales(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }
  const companyName = String(req.body?.companyName ?? "").trim();
  if (!companyName) { res.status(400).json({ error: "companyName required" }); return; }
  try {
    const [created] = await db.insert(salesLeadsTable).values({
      ownerId: me.id,
      companyName,
      contactName: req.body?.contactName ?? null,
      contactEmail: req.body?.contactEmail ?? null,
      contactRole: req.body?.contactRole ?? null,
      linkedinUrl: req.body?.linkedinUrl ?? null,
      stage: isSalesLeadStage(req.body?.stage) ? req.body.stage : "cold",
      source: req.body?.source ?? null,
      notes: req.body?.notes ?? null,
    }).returning();
    res.json({ lead: created });
  } catch (err) {
    req.log.error({ err }, "Create sales lead failed");
    res.status(500).json({ error: "Failed to create" });
  }
});

router.patch("/sales/leads/:id", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessSales(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  const ALLOWED = ["companyName", "contactName", "contactEmail", "contactRole",
                   "linkedinUrl", "source", "notes"] as const;
  for (const k of ALLOWED) {
    if (req.body?.[k] !== undefined) {
      patch[k] = typeof req.body[k] === "string" ? req.body[k].trim() : req.body[k];
    }
  }
  if (req.body?.stage !== undefined) {
    if (!isSalesLeadStage(req.body.stage)) { res.status(400).json({ error: "Invalid stage" }); return; }
    patch.stage = req.body.stage;
  }
  if (req.body?.lastTouchAt !== undefined) {
    patch.lastTouchAt = req.body.lastTouchAt ? new Date(req.body.lastTouchAt) : null;
  }

  try {
    await db.update(salesLeadsTable).set(patch).where(eq(salesLeadsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Patch sales lead failed");
    res.status(500).json({ error: "Failed to update" });
  }
});

router.delete("/sales/leads/:id", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessSales(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(salesLeadsTable).where(eq(salesLeadsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Delete sales lead failed");
    res.status(500).json({ error: "Failed to delete" });
  }
});

// ═══════════════════════ SALES — LINKEDIN OUTREACH ═══════════════════════
/**
 * Stateless Gemini call — no persistence. Sales person types prospect info
 * + reason, gets connection request + first message + email subject.
 */
router.post("/sales/linkedin-outreach", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessSales(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }

  const { prospectName, prospectRole, prospectCompany, reasonForReach } = req.body ?? {};
  if (!prospectName || !prospectRole || !prospectCompany || !reasonForReach) {
    res.status(400).json({ error: "prospectName, prospectRole, prospectCompany, reasonForReach required" });
    return;
  }
  try {
    const result = await generateLinkedInOutreach({
      prospectName, prospectRole, prospectCompany, reasonForReach,
      mutualConnection: req.body?.mutualConnection,
      tone: req.body?.tone,
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "LinkedIn outreach generation failed");
    const msg = err instanceof Error ? err.message : "Generation failed";
    res.status(500).json({ error: msg });
  }
});

// ═══════════════════════ SALES — PROPOSALS ═══════════════════════════════

router.get("/sales/proposals", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessSales(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }
  try {
    const rows = await db.select().from(proposalsTable).orderBy(desc(proposalsTable.updatedAt));
    res.json({ proposals: rows });
  } catch (err) {
    req.log.error({ err }, "List proposals failed");
    res.status(500).json({ error: "Failed to list" });
  }
});

router.post("/sales/proposals", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessSales(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }

  const prospectName = String(req.body?.prospectName ?? "").trim();
  const prospectCompany = String(req.body?.prospectCompany ?? "").trim();
  if (!prospectName || !prospectCompany) {
    res.status(400).json({ error: "prospectName and prospectCompany required" }); return;
  }
  // Accept a section structure on create (consultant supplies headings).
  // Default sections if none given — standard proposal flow.
  const defaultSections: ProposalSection[] = [
    { heading: "Executive Summary",       body: "", aiGenerated: false },
    { heading: "Understanding Your Needs", body: "", aiGenerated: false },
    { heading: "Proposed Approach",       body: "", aiGenerated: false },
    { heading: "Deliverables & Timeline", body: "", aiGenerated: false },
    { heading: "Investment",              body: "", aiGenerated: false },
    { heading: "Next Steps",              body: "", aiGenerated: false },
  ];
  const sections: ProposalSection[] = Array.isArray(req.body?.sections) && req.body.sections.length > 0
    ? req.body.sections
    : defaultSections;

  try {
    const [created] = await db.insert(proposalsTable).values({
      userId: me.id,
      leadId: req.body?.leadId ?? null,
      prospectName, prospectCompany,
      brief: req.body?.brief ?? null,
      sections: sections as any,
    }).returning();
    res.json({ proposal: created });
  } catch (err) {
    req.log.error({ err }, "Create proposal failed");
    res.status(500).json({ error: "Failed to create" });
  }
});

router.get("/sales/proposals/:id", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessSales(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [row] = await db.select().from(proposalsTable).where(eq(proposalsTable.id, id)).limit(1);
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ proposal: row });
  } catch (err) {
    req.log.error({ err }, "Get proposal failed");
    res.status(500).json({ error: "Failed to load" });
  }
});

router.patch("/sales/proposals/:id", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessSales(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof req.body?.prospectName === "string") patch.prospectName = req.body.prospectName.trim();
  if (typeof req.body?.prospectCompany === "string") patch.prospectCompany = req.body.prospectCompany.trim();
  if (typeof req.body?.brief === "string") patch.brief = req.body.brief;
  if (req.body?.status === "draft" || req.body?.status === "final") patch.status = req.body.status;
  if (Array.isArray(req.body?.sections)) patch.sections = req.body.sections as any;

  try {
    await db.update(proposalsTable).set(patch).where(eq(proposalsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Patch proposal failed");
    res.status(500).json({ error: "Failed to update" });
  }
});

/**
 * Body: { sectionIndex, contextNotes? }
 * AI fills the body of one section (idempotent — overwrites existing body
 * and flips `aiGenerated` to true).
 */
router.post("/sales/proposals/:id/fill-section", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessSales(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }
  const id = Number(req.params.id);
  const sectionIndex = Number(req.body?.sectionIndex);
  if (!Number.isFinite(id) || !Number.isFinite(sectionIndex)) {
    res.status(400).json({ error: "id and sectionIndex required" }); return;
  }

  try {
    const [p] = await db.select().from(proposalsTable).where(eq(proposalsTable.id, id)).limit(1);
    if (!p) { res.status(404).json({ error: "Proposal not found" }); return; }
    const sections = (p.sections as ProposalSection[]) ?? [];
    if (sectionIndex < 0 || sectionIndex >= sections.length) {
      res.status(400).json({ error: "Invalid sectionIndex" }); return;
    }
    const targetSection = sections[sectionIndex];

    const filled = await fillProposalSection({
      prospectName: p.prospectName,
      prospectCompany: p.prospectCompany,
      brief: p.brief ?? "",
      sectionHeading: targetSection.heading,
      sectionContextNotes: req.body?.contextNotes,
      previousSections: sections.slice(0, sectionIndex).filter(s => s.body),
    });

    sections[sectionIndex] = { ...targetSection, body: filled.body, aiGenerated: true };
    await db.update(proposalsTable)
      .set({ sections: sections as any, updatedAt: new Date() })
      .where(eq(proposalsTable.id, id));
    res.json({ body: filled.body });
  } catch (err) {
    req.log.error({ err }, "Fill proposal section failed");
    const msg = err instanceof Error ? err.message : "Fill failed";
    res.status(500).json({ error: msg });
  }
});

router.delete("/sales/proposals/:id", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessSales(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(proposalsTable).where(eq(proposalsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Delete proposal failed");
    res.status(500).json({ error: "Failed to delete" });
  }
});

// ═══════════════════════ ADMIN — USER ROLES ══════════════════════════════

router.get("/admin/users", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canManageRoles(me.role)) { res.status(403).json({ error: "Admins only" }); return; }
  try {
    const users = await db
      .select({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        role: usersTable.role,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .orderBy(usersTable.name);
    res.json({ users });
  } catch (err) {
    req.log.error({ err }, "List users failed");
    res.status(500).json({ error: "Failed to list" });
  }
});

router.patch("/admin/users/:id/role", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canManageRoles(me.role)) { res.status(403).json({ error: "Admins only" }); return; }
  const id = Number(req.params.id);
  const role = String(req.body?.role ?? "");
  if (!Number.isFinite(id) || !isRole(role)) {
    res.status(400).json({ error: "Valid id and role required" }); return;
  }
  // Safety: don't let an admin demote themselves (would lock them out of role management)
  if (id === me.id && role !== "admin") {
    res.status(400).json({ error: "Cannot remove your own admin role. Ask another admin to do it." });
    return;
  }
  try {
    await db.update(usersTable).set({ role }).where(eq(usersTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Patch user role failed");
    res.status(500).json({ error: "Failed to update role" });
  }
});

// ═══════════════════════ ROLES BOOTSTRAP ═════════════════════════════════
/**
 * Lightweight endpoint the frontend uses to know what tabs to show. We
 * mirror the role-derived booleans here so the UI doesn't have to
 * re-implement the canAccess* logic.
 */
router.get("/me/permissions", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  res.json({
    role: me.role,
    canAccessResearch: canAccessResearch(me.role),
    canAccessSales: canAccessSales(me.role),
    canManageRoles: canManageRoles(me.role),
  });
});

// ═══════════════════════ RESEARCH — INSPIRATION ══════════════════════════
/**
 * Flatten a Thinking-Sheet workbook into compact, LLM-friendly text. Caps
 * length so the prompt stays small; skips empty cells.
 */
function flattenWorkbook(wb: XLSX.WorkBook, maxChars = 6000): string {
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
      header: 1, blankrows: false, defval: "",
    });
    if (!rows.length) continue;
    parts.push(`# ${name}`);
    for (const row of rows) {
      const cells = (row as unknown[]).map((c) => String(c ?? "").trim()).filter(Boolean);
      if (cells.length) parts.push(cells.join(" | "));
      if (parts.join("\n").length > maxChars) break;
    }
    if (parts.join("\n").length > maxChars) break;
  }
  return parts.join("\n").slice(0, maxChars);
}

/** Resolve a pasted sheet link into flattened text. Never hard-fails the
 *  request — if the sheet can't be read, proceed without context. */
async function resolveSheetContext(
  userId: number, sheetUrl: unknown, log: any,
): Promise<{ context?: string; warning?: string }> {
  const url = typeof sheetUrl === "string" ? sheetUrl.trim() : "";
  if (!url) return {};
  try {
    const wb = await fetchSheetAsWorkbook(userId, url);
    return { context: flattenWorkbook(wb) };
  } catch (err) {
    log?.warn?.({ err }, "Inspiration: could not read Thinking Sheet");
    return { warning: err instanceof Error ? err.message : "Could not read the sheet." };
  }
}

// GET /research/inspiration/sessions — resumable workbench sessions (newest first)
router.get("/research/inspiration/sessions", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessResearch(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }
  try {
    const rows = await db.select().from(researchOutputsTable)
      .where(and(eq(researchOutputsTable.userId, me.id), eq(researchOutputsTable.tool, "inspiration_session")))
      .orderBy(desc(researchOutputsTable.updatedAt));
    res.json({ sessions: rows });
  } catch (err) {
    req.log.error({ err }, "Inspiration sessions list failed");
    res.status(500).json({ error: "Could not load sessions" });
  }
});

// POST /research/inspiration/recommend — closest real comparables (+ saves session)
router.post("/research/inspiration/recommend", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessResearch(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }

  const b = req.body ?? {};
  const companyName = String(b.companyName ?? "").trim();
  const industry = String(b.industry ?? "").trim();
  const stage = String(b.stage ?? "").trim();
  const revenueStage = String(b.revenueStage ?? "").trim();
  if (!companyName || !industry || !stage || !revenueStage) {
    res.status(400).json({ error: "companyName, industry, stage and revenueStage are required." });
    return;
  }

  try {
    const setup = {
      companyName, industry,
      specialization: String(b.specialization ?? ""),
      stage, revenueStage,
      geography: b.geography ?? "",
      sheetUrl: String(b.sheetUrl ?? ""),
    };
    const { context, warning } = await resolveSheetContext(me.id, b.sheetUrl, req.log);
    const out = await recommendSimilarCompanies({
      ...setup, stage: stage as any, revenueStage: revenueStage as any, sheetContext: context,
    });

    // Persist (or update) the session so the consultant can resume it later.
    const sessionOutput = { peers: out.peers, nextLevel: out.nextLevel, sources: out.sources, researchedCompanies: [] as any[] };
    let sessionId = b.sessionId ? Number(b.sessionId) : null;
    if (sessionId) {
      // preserve any companies already researched under this session
      const [existing] = await db.select().from(researchOutputsTable)
        .where(and(eq(researchOutputsTable.id, sessionId), eq(researchOutputsTable.userId, me.id))).limit(1);
      const prevResearched = (existing?.output as any)?.researchedCompanies ?? [];
      await db.update(researchOutputsTable).set({
        title: `Inspiration session · ${companyName}`,
        inputs: setup,
        output: { ...sessionOutput, researchedCompanies: prevResearched },
        updatedAt: new Date(),
      }).where(and(eq(researchOutputsTable.id, sessionId), eq(researchOutputsTable.userId, me.id)));
    } else {
      const [row] = await db.insert(researchOutputsTable).values({
        userId: me.id, tool: "inspiration_session", founderId: b.founderId ? Number(b.founderId) : null,
        title: `Inspiration session · ${companyName}`, inputs: setup, output: sessionOutput,
      }).returning();
      sessionId = row.id;
    }

    res.json({ ...out, sessionId, sheetWarning: warning ?? null });
  } catch (err) {
    req.log.error({ err }, "Inspiration recommend failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Recommendation failed" });
  }
});

// POST /research/inspiration/roadmap — grounded deep dive + persist (+ link to session)
router.post("/research/inspiration/roadmap", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  if (!canAccessResearch(me.role)) { res.status(403).json({ error: "Not authorized" }); return; }

  const b = req.body ?? {};
  const clientCompany = String(b.clientCompany ?? b.companyName ?? "").trim();
  const inspirationCompany = String(b.inspirationCompany ?? "").trim();
  const industry = String(b.industry ?? "").trim();
  const sessionId = b.sessionId ? Number(b.sessionId) : null;
  if (!clientCompany || !inspirationCompany) {
    res.status(400).json({ error: "clientCompany and inspirationCompany are required." });
    return;
  }

  try {
    const { context } = await resolveSheetContext(me.id, b.sheetUrl, req.log);
    const inputs = {
      clientCompany, inspirationCompany, industry,
      specialization: String(b.specialization ?? ""),
      stage: String(b.stage ?? ""),
      revenueStage: String(b.revenueStage ?? ""),
      geography: b.geography, sessionId,
    };
    const output = await generateInspirationRoadmap({ ...inputs, sheetContext: context } as any);

    // Persist the roadmap under the shared research_outputs table (tool tag).
    const [saved] = await db.insert(researchOutputsTable).values({
      userId: me.id,
      tool: "inspiration_roadmap",
      founderId: b.founderId ? Number(b.founderId) : null,
      title: `Inspiration · ${clientCompany} ← ${inspirationCompany}`,
      inputs,
      output: output as any,
    }).returning();

    // Link into the session so the comparison view + resume stay in sync.
    if (sessionId) {
      const [session] = await db.select().from(researchOutputsTable)
        .where(and(eq(researchOutputsTable.id, sessionId), eq(researchOutputsTable.userId, me.id))).limit(1);
      if (session) {
        const out = (session.output as any) ?? {};
        const researched = Array.isArray(out.researchedCompanies) ? out.researchedCompanies : [];
        const next = researched.filter((r: any) => r.company !== inspirationCompany);
        next.push({ company: inspirationCompany, roadmapId: saved.id, matchScore: (output as any).matchScore ?? null, at: new Date().toISOString() });
        await db.update(researchOutputsTable)
          .set({ output: { ...out, researchedCompanies: next }, updatedAt: new Date() })
          .where(and(eq(researchOutputsTable.id, sessionId), eq(researchOutputsTable.userId, me.id)));
      }
    }

    res.json({ output: saved });
  } catch (err) {
    req.log.error({ err }, "Inspiration roadmap failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Roadmap generation failed" });
  }
});

export default router;
