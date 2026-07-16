/**
 * Pre-Sprint API.
 *
 *   GET    /pre-sprint/companies            — list this workspace's Pre-Sprint companies
 *   POST   /pre-sprint/companies            — create (appears in Companies/Tracking immediately)
 *   GET    /pre-sprint/companies/:id        — company + all cached analyses
 *   PATCH  /pre-sprint/companies/:id        — autosave draft fields (called on blur / tab-switch)
 *   DELETE /pre-sprint/companies/:id        — delete company + its cached analyses
 *   POST   /pre-sprint/extract              — deck (multipart) + websiteUrl → extracted profile
 *   POST   /pre-sprint/companies/:id/generate — run ONE analysis, cache it (regenerate replaces)
 *
 * A Pre-Sprint company is just a `founders` row with source='pre_sprint' and
 * stage_workflow='pre_sprint', so it's the same entity used everywhere else.
 * Cached analyses live in research_outputs, one row per (founder_id, tool).
 */
import { Router } from "express";
import multer from "multer";
import {
  db, foundersTable, usersTable,
  researchOutputsTable, isResearchTool,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { extractTextFromUpload } from "../lib/fileExtract";
import { fetchWebsiteText } from "../lib/websiteText";
import {
  extractCompanyProfile, generateCompanyOverview,
  generateBlueRedOcean, generateDemandLandscape, generateIcpPersonas,
  type CompanyProfile,
} from "../lib/preSprintAi";
import {
  generateTamSamSom,
  generateIndustryLandscape, generateBusinessModelCanvas,
  generateCustomerSegmentation,
} from "../lib/researchAi";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

async function getMe(req: any, res: any) {
  const uid = req.session?.userId;
  if (!uid) { res.status(401).json({ error: "Not authenticated" }); return null; }
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, uid)).limit(1);
  if (!u) { res.status(401).json({ error: "User not found" }); return null; }
  return u;
}

/** Build a CompanyProfile from a founders row (used to seed every generator). */
function profileFromRow(row: any): CompanyProfile {
  const p = (row.preSprintProfile ?? {}) as Partial<CompanyProfile>;
  return {
    companyName: row.companyName ?? p.companyName ?? "",
    industry: row.industry ?? p.industry ?? "",
    businessStage: row.stage ?? p.businessStage ?? "",
    specialization: row.specialization ?? p.specialization ?? "",
    productDescription: row.description ?? p.productDescription ?? "",
    revenueStage: row.revenueStage ?? p.revenueStage ?? "",
    geography: p.geography ?? "India-first",
  };
}

// ─────────────────────────── list ─────────────────────────────────────────
router.get("/pre-sprint/companies", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  try {
    const rows = await db.select().from(foundersTable)
      .where(eq(foundersTable.source, "pre_sprint"))
      .orderBy(desc(foundersTable.createdAt));
    res.json({ companies: rows });
  } catch (err) {
    req.log.error({ err }, "List pre-sprint companies failed");
    res.status(500).json({ error: "Failed to list companies" });
  }
});

// ─────────────────────────── create ───────────────────────────────────────
router.post("/pre-sprint/companies", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  const name = String(req.body?.companyName ?? "").trim();
  if (!name) { res.status(400).json({ error: "companyName is required" }); return; }
  try {
    const [row] = await db.insert(foundersTable).values({
      companyName: name,
      // founders.name/email are NOT NULL — placeholders until the founder is known.
      name: req.body?.founderName ?? "—",
      email: req.body?.founderEmail ?? "pending@pre-sprint.local",
      industry: req.body?.industry ?? null,
      stage: req.body?.businessStage ?? null,
      specialization: req.body?.specialization ?? null,
      revenueStage: req.body?.revenueStage ?? null,
      description: req.body?.productDescription ?? null,
      websiteUrl: req.body?.websiteUrl ?? null,
      source: "pre_sprint",
      stageWorkflow: "pre_sprint",
      ownerId: me.id,
    }).returning();
    res.json({ company: row });
  } catch (err) {
    req.log.error({ err }, "Create pre-sprint company failed");
    res.status(500).json({ error: "Failed to create company" });
  }
});

// ─────────────────────────── read (+ cached analyses) ─────────────────────
router.get("/pre-sprint/companies/:id", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [company] = await db.select().from(foundersTable).where(eq(foundersTable.id, id)).limit(1);
    if (!company) { res.status(404).json({ error: "Not found" }); return; }
    const outputs = await db.select().from(researchOutputsTable)
      .where(eq(researchOutputsTable.founderId, id))
      .orderBy(desc(researchOutputsTable.updatedAt));
    // Map tool → cached output so the UI can show "generated" state instantly.
    const analyses: Record<string, any> = {};
    for (const o of outputs) analyses[o.tool] = o;
    res.json({ company, analyses });
  } catch (err) {
    req.log.error({ err }, "Get pre-sprint company failed");
    res.status(500).json({ error: "Failed to load company" });
  }
});

// ─────────────────────────── autosave (draft) ─────────────────────────────
router.patch("/pre-sprint/companies/:id", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const b = req.body ?? {};
  const patch: Record<string, unknown> = {};
  if (typeof b.companyName === "string") patch.companyName = b.companyName.trim();
  if (typeof b.industry === "string") patch.industry = b.industry;
  if (typeof b.businessStage === "string") patch.stage = b.businessStage;
  if (typeof b.specialization === "string") patch.specialization = b.specialization;
  if (typeof b.revenueStage === "string") patch.revenueStage = b.revenueStage;
  if (typeof b.productDescription === "string") patch.description = b.productDescription;
  if (typeof b.websiteUrl === "string") patch.websiteUrl = b.websiteUrl;
  if (b.preSprintProfile && typeof b.preSprintProfile === "object") patch.preSprintProfile = b.preSprintProfile;

  if (Object.keys(patch).length === 0) { res.json({ ok: true, noop: true }); return; }
  try {
    await db.update(foundersTable).set(patch).where(eq(foundersTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Autosave pre-sprint company failed");
    res.status(500).json({ error: "Failed to save" });
  }
});

// ─────────────────────────── delete (+ cascade analyses) ──────────────────
router.delete("/pre-sprint/companies/:id", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(researchOutputsTable).where(eq(researchOutputsTable.founderId, id));
    await db.delete(foundersTable).where(eq(foundersTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Delete pre-sprint company failed");
    res.status(500).json({ error: "Failed to delete" });
  }
});

// ─────────────────────────── extract (deck + website) ─────────────────────
// multipart: file (deck) required, websiteUrl optional, companyId optional
// (if given, caches deck_text on the row). Returns the extracted profile so
// the client can pre-fill the intake fields.
router.post("/pre-sprint/extract", upload.single("file"), async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  try {
    const file = (req as any).file;
    if (!file) { res.status(400).json({ error: "A pitch deck file is required" }); return; }
    const deckText = await extractTextFromUpload(file.originalname, file.buffer);
    if (!deckText || deckText.length < 20) {
      res.status(422).json({ error: "Could not read text from that deck. Try a text-based PDF." });
      return;
    }
    const websiteUrl = String(req.body?.websiteUrl ?? "").trim();
    const websiteText = websiteUrl ? await fetchWebsiteText(websiteUrl) : "";

    const profile = await extractCompanyProfile({ deckText, websiteText });

    const companyId = req.body?.companyId ? Number(req.body.companyId) : null;
    if (companyId && Number.isFinite(companyId)) {
      await db.update(foundersTable)
        .set({ deckText, websiteUrl: websiteUrl || undefined, preSprintProfile: profile as any })
        .where(eq(foundersTable.id, companyId));
    }
    res.json({ profile, deckChars: deckText.length, websiteChars: websiteText.length });
  } catch (err: any) {
    req.log.error({ err }, "Pre-sprint extract failed");
    res.status(500).json({ error: err?.message ?? "Extraction failed" });
  }
});

// ─────────────────────────── generate (cached) ────────────────────────────
// body: { tool }. Runs the generator seeded from the company's stored profile,
// then UPSERTS the row for (founderId, tool). Regenerating replaces it, so an
// analysis is generated once and persists until explicitly regenerated.
const TITLES: Record<string, string> = {
  company_overview: "Overview", icp_mapping: "ICP Mapping", tam_sam_som: "TAM / SAM / SOM",
  industry_landscape: "Industry Landscape", business_model_canvas: "Business Model Canvas",
  customer_segmentation: "Customer Segmentation", blue_red_ocean: "Blue / Red Ocean",
  demand_landscape: "Demand Landscape",
};

router.post("/pre-sprint/companies/:id/generate", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  const id = Number(req.params.id);
  const tool = String(req.body?.tool ?? "");
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!isResearchTool(tool)) { res.status(400).json({ error: "Unknown tool" }); return; }

  try {
    const [company] = await db.select().from(foundersTable).where(eq(foundersTable.id, id)).limit(1);
    if (!company) { res.status(404).json({ error: "Company not found" }); return; }
    const p = profileFromRow(company);
    if (!p.companyName) { res.status(400).json({ error: "Fill the company profile first" }); return; }

    let output: unknown;
    switch (tool) {
      case "company_overview":
        output = await generateCompanyOverview(p, (company as any).deckText ?? ""); break;
      case "blue_red_ocean":
        output = await generateBlueRedOcean(p); break;
      case "demand_landscape":
        output = await generateDemandLandscape(p); break;
      case "icp_mapping":
        output = await generateIcpPersonas(p); break;
      case "tam_sam_som":
        output = await generateTamSamSom({ companyName: p.companyName, productDescription: p.productDescription, geography: p.geography } as any); break;
      case "industry_landscape":
        output = await generateIndustryLandscape({ industry: p.industry, geography: p.geography } as any); break;
      case "business_model_canvas":
        output = await generateBusinessModelCanvas({ companyName: p.companyName, productDescription: p.productDescription } as any); break;
      case "customer_segmentation":
        output = await generateCustomerSegmentation({ companyName: p.companyName, industry: p.industry, productDescription: p.productDescription, geography: p.geography } as any); break;
      default:
        res.status(400).json({ error: "Tool not available in Pre-Sprint" }); return;
    }

    // Upsert one row per (founderId, tool).
    const [existing] = await db.select().from(researchOutputsTable)
      .where(and(eq(researchOutputsTable.founderId, id), eq(researchOutputsTable.tool, tool)))
      .limit(1);

    let saved;
    if (existing) {
      [saved] = await db.update(researchOutputsTable)
        .set({ output: output as any, inputs: p as any, updatedAt: new Date() })
        .where(eq(researchOutputsTable.id, existing.id))
        .returning();
    } else {
      [saved] = await db.insert(researchOutputsTable).values({
        userId: me.id, founderId: id, tool,
        title: `${TITLES[tool] ?? tool} — ${p.companyName}`,
        inputs: p as any, output: output as any,
      }).returning();
    }
    res.json({ output: saved });
  } catch (err: any) {
    req.log.error({ err }, "Pre-sprint generate failed");
    res.status(500).json({ error: err?.message ?? "Generation failed" });
  }
});

export default router;
