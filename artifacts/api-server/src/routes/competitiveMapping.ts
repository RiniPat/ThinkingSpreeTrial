/**
 * Competitive Mapping v2 API — 5-stage flow, Google-Sheet-first.
 *
 *   Data Feed (human)   POST /competitive-maps                    scrape + overview + CREATE sheet
 *   Fencing   (AI)      POST /competitive-maps/:id/fence          async → industry landscape
 *   Prioritize(human)   POST /competitive-maps/:id/prioritize     save shortlist
 *   Breakdown (AI)      POST /competitive-maps/:id/breakdown      async → 46-col decode per company
 *   Inspiration(human+AI)POST /competitive-maps/:id/inspiration    build a journey timeline
 *
 *   GET  /competitive-maps/jobs/:jobId        progress for an async stage
 *   GET  /competitive-maps                    list saved runs (revisit)
 *   GET  /competitive-maps/:id                full saved run
 *   GET/POST /competitive-maps/:id/copilot    dashboard Research Copilot chat
 *   POST /competitive-maps/ingest-deck        extract text from a pitch PDF/DOCX
 *
 * The Google Sheet "Research for [Company]" is created at Data Feed and written
 * to progressively at every later stage, so the consultant watches it fill live.
 */
import { Router } from "express";
import multer from "multer";
import {
  db, competitiveMapsTable, mapProductsTable, mapInspirationTable, copilotMessagesTable,
} from "@workspace/db";
import { eq, and, asc, desc } from "drizzle-orm";
import XLSX from "xlsx";
import { getAuthedClient } from "../lib/google";
import { fetchWebsiteText } from "../lib/websiteText";
import { fetchSheetAsWorkbook } from "../lib/sheetsFetcher";
import { extractTextFromUpload } from "../lib/fileExtract";
import { fetchSubjectProfile, fetchEvidence, guessDomain, logoForDomain } from "../lib/scrapling";
import {
  generateOverview, generateLandscape, whatToScrape, generateBreakdownForCompany,
  suggestInspiration, generateInspirationFor, copilotAnswer,
  generateIndustryDemandMap, generateCompetitiveLandscape, suggestCopilotPrompts, type Landscape,
} from "../lib/competitiveMappingAi";
import {
  createResearchSheet, writeOverviewTab, writeFencingTab, writeBreakdownTab, writeInspirationTab,
  writeDemandMapTab, writeCompetitiveLandscapeTab,
} from "../lib/sheetWriter";
import { assignProductImages } from "../lib/productImages";
import { createJob, runInBackground, setProgress, getJob } from "../lib/mapJobs";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function uid(req: any, res: any): number | null {
  const id = req.session?.userId;
  if (!id) { res.status(401).json({ error: "Not authenticated" }); return null; }
  return id;
}

/** Flatten a fetched workbook to plain text so Gemini can read the T-Sheet. */
function workbookToText(wb: XLSX.WorkBook): string {
  const out: string[] = [];
  for (const name of wb.SheetNames.slice(0, 12)) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false }).trim();
    if (csv) out.push(`### ${name}\n${csv.slice(0, 4000)}`);
  }
  return out.join("\n\n").slice(0, 12000);
}

async function loadMap(me: number, id: number) {
  const [map] = await db.select().from(competitiveMapsTable)
    .where(and(eq(competitiveMapsTable.id, id), eq(competitiveMapsTable.consultantId, me))).limit(1);
  return map ?? null;
}

/* ── Stage 1 · DATA FEED (human) ─────────────────────────────────────────────
 * name + T-Sheet + website are required; deck text optional. Scrape → overview →
 * create the Google Sheet and write the Overview tab. */
router.post("/competitive-maps", async (req, res) => {
  const me = uid(req, res); if (!me) return;
  const { companyName, website, tsheetUrl, deckText } = req.body ?? {};
  if (!companyName || !website || !tsheetUrl) {
    res.status(400).json({ error: "companyName, website and tsheetUrl are all required." });
    return;
  }
  try {
    // Scrapling: crawl the subject site for real grounding.
    const profile = await fetchSubjectProfile(companyName, website).catch(
      () => ({ text: "", image: "", images: [] as string[], domain: "", pages: [] as string[] }),
    );
    let websiteText = profile.text;
    if (!websiteText) websiteText = await fetchWebsiteText(website).catch(() => "");

    // T-Sheet ingest (Google connected). Fails soft.
    let sheetText = "";
    try { sheetText = workbookToText(await fetchSheetAsWorkbook(me, tsheetUrl)); }
    catch (e) { console.warn("tsheet ingest skipped:", (e as Error).message); }

    const overview: any = await generateOverview(companyName, website, {
      websiteText, sheetText, deckText: typeof deckText === "string" ? deckText : "",
    });
    if (profile.image && !overview.logo) overview.logo = profile.image;
    if (!overview.website || overview.website === "-") overview.website = website || profile.domain;

    // Create the Google Sheet now (if Google is connected).
    let sheetId: string | null = null, sheetUrl: string | null = null, needsGoogle = false;
    const auth = await getAuthedClient(me);
    if (auth) {
      try {
        const s = await createResearchSheet(auth, companyName);
        sheetId = s.spreadsheetId; sheetUrl = s.url;
        await writeOverviewTab(auth, sheetId, companyName, overview);
      } catch (e) { console.warn("sheet create failed:", (e as Error).message); }
    } else {
      needsGoogle = true;
    }

    const [row] = await db.insert(competitiveMapsTable).values({
      consultantId: me, companyName, website, tsheetUrl,
      status: "feed_ready", overview,
      generatedSheetId: sheetId, generatedSheetUrl: sheetUrl,
    }).returning();

    res.status(201).json({
      id: row.id, overview, sheetUrl, needsGoogle,
      scraped: { pages: profile.pages, image: profile.image },
    });
  } catch (e) {
    console.error("data feed failed", e);
    res.status(500).json({ error: "Data Feed failed" });
  }
});

/* extract text from an uploaded pitch deck (PDF/DOCX) so it can feed the overview */
router.post("/competitive-maps/ingest-deck", upload.single("file"), async (req, res) => {
  const me = uid(req, res); if (!me) return;
  const f = (req as any).file;
  if (!f) { res.status(400).json({ error: "file required" }); return; }
  try {
    const text = await extractTextFromUpload(f.originalname, f.buffer);
    res.json({ text: (text || "").slice(0, 24000), chars: text?.length ?? 0 });
  } catch (e) {
    console.warn("deck ingest failed", (e as Error).message);
    res.json({ text: "", chars: 0 });
  }
});

/* ── Stage 2 · FENCING (AI, async) ──────────────────────────────────────────
 * Industry landscape: quantified metrics + the exhaustive company list. */
router.post("/competitive-maps/:id/fence", async (req, res) => {
  const me = uid(req, res); if (!me) return;
  const id = Number(req.params.id);
  const map = await loadMap(me, id);
  if (!map) { res.status(404).json({ error: "not found" }); return; }

  // v3: consultant scopes the fence to a geography + industry/application.
  const geography = String(req.body?.geography || map.geography || "India").trim();
  const industry = String(req.body?.industry || map.industry || "").trim();
  const scope = { geography, industry };

  const jobId = await createJob(id, "fence");
  res.status(202).json({ jobId });

  runInBackground(jobId, async () => {
    await db.update(competitiveMapsTable)
      .set({ status: "fencing", geography, industry, updatedAt: new Date() })
      .where(eq(competitiveMapsTable.id, id));
    await setProgress(jobId, 8, `Scanning the ${industry || "industry"} in ${geography}…`);

    const profile = await fetchSubjectProfile(map.companyName, map.website || undefined).catch(() => null);
    await setProgress(jobId, 30, "Mapping every company in the industry…");

    const landscape = await generateLandscape(map.companyName, map.overview || {}, profile?.text || "", scope);
    // Enrich each company with a website + logo (no network — cheap URL fill).
    landscape.companies = (landscape.companies || []).map((c) => {
      const website = c.website || (guessDomain(c.name) ? `https://${guessDomain(c.name)}` : "");
      return { ...c, website };
    });

    // v3 artifacts, scoped to geography + industry.
    await setProgress(jobId, 55, `Building the ${geography} industry demand map…`);
    const demandMap = await generateIndustryDemandMap(map.companyName, map.overview || {}, scope, profile?.text || "")
      .catch((e) => { console.warn("demand map:", (e as Error).message); return null; });

    await setProgress(jobId, 72, "Building the competitive landscape…");
    const competitiveDoc = await generateCompetitiveLandscape(map.companyName, map.overview || {}, scope, profile?.text || "")
      .catch((e) => { console.warn("competitive doc:", (e as Error).message); return null; });
    await setProgress(jobId, 88, "Writing the landscape to your sheet…");

    await db.update(competitiveMapsTable)
      .set({
        landscape: landscape as any,
        demandMap: (demandMap as any) ?? null,
        competitiveDoc: (competitiveDoc as any) ?? null,
        status: "fenced", updatedAt: new Date(),
      })
      .where(eq(competitiveMapsTable.id, id));

    const auth = await getAuthedClient(me);
    if (auth && map.generatedSheetId) {
      await writeFencingTab(auth, map.generatedSheetId, landscape).catch((e) => console.warn("fencing tab:", (e as Error).message));
      if (demandMap) await writeDemandMapTab(auth, map.generatedSheetId, demandMap).catch((e) => console.warn("demand tab:", (e as Error).message));
      if (competitiveDoc) await writeCompetitiveLandscapeTab(auth, map.generatedSheetId, competitiveDoc).catch((e) => console.warn("landscape tab:", (e as Error).message));
    }
    await setProgress(jobId, 100, `Fenced ${landscape.companies.length} companies in ${geography}`);
  });
});

/* ── Stage 3 · PRIORITIZE (human) ────────────────────────────────────────── */
router.post("/competitive-maps/:id/prioritize", async (req, res) => {
  const me = uid(req, res); if (!me) return;
  const id = Number(req.params.id);
  const map = await loadMap(me, id);
  if (!map) { res.status(404).json({ error: "not found" }); return; }
  const selected = Array.isArray(req.body?.selected) ? req.body.selected : [];
  await db.update(competitiveMapsTable)
    .set({ selected: selected as any, status: "prioritized", updatedAt: new Date() })
    .where(eq(competitiveMapsTable.id, id));
  res.json({ ok: true, selected });
});

/* ── Stage 4 · BREAKDOWN (AI + Scrapling, async) ────────────────────────────
 * Per selected company: AI decides what to pull → Scrapling fetches site +
 * imagery → AI writes the 46-column decode → persist + write a company tab. */
router.post("/competitive-maps/:id/breakdown", async (req, res) => {
  const me = uid(req, res); if (!me) return;
  const id = Number(req.params.id);
  const map = await loadMap(me, id);
  if (!map) { res.status(404).json({ error: "not found" }); return; }

  const bodySel = Array.isArray(req.body?.selected) ? req.body.selected : null;
  const selected: any[] = bodySel ?? (Array.isArray(map.selected) ? (map.selected as any[]) : []);
  if (!selected.length) { res.status(400).json({ error: "No companies selected. Prioritize first." }); return; }

  const jobId = await createJob(id, "breakdown", selected.length);
  res.status(202).json({ jobId, total: selected.length });

  runInBackground(jobId, async () => {
    await db.update(competitiveMapsTable).set({ status: "breaking_down", updatedAt: new Date() }).where(eq(competitiveMapsTable.id, id));
    const auth = await getAuthedClient(me);

    for (let i = 0; i < selected.length; i++) {
      const c = selected[i] ?? {};
      const name = String(c.name || c.company || `Company ${i + 1}`);
      const website = c.website || (guessDomain(name) ? `https://${guessDomain(name)}` : undefined);
      await setProgress(jobId, i, `Breaking down ${name}…`);

      // AI tells Scrapling what to pull; Scrapling replies with evidence.
      const plan = await whatToScrape(name, website).catch(() => ({ paths: [], wants: [] }));
      const evidence = await fetchEvidence(name, website, { paths: plan.paths, wants: plan.wants }).catch(() => null);
      const evText = evidence?.text || "";
      const logo = evidence?.logo || (website ? logoForDomain(website) : "");

      const rows = await generateBreakdownForCompany(map.companyName, name, evidence?.website || website, evText);
      // Give EACH product its own, product-specific image (distinct, no repeats).
      const gallery = evidence?.gallery?.length
        ? evidence.gallery
        : (evidence?.images || []).map((url) => ({ url, alt: "" }));
      const enriched = assignProductImages(rows, gallery, { industry: map.industry || undefined, logo });

      // Persist (replace any prior rows for this company in this map).
      await db.delete(mapProductsTable)
        .where(and(eq(mapProductsTable.mapId, id), eq(mapProductsTable.company, name)));
      if (enriched.length) {
        await db.insert(mapProductsTable).values(enriched.map((r, k) => ({
          mapId: id, srNo: Number(r.sr) || k + 1, company: name,
          product: String(r.product || "?"), imageUrl: r.image || null,
          seg: r.seg ?? null, scaledBeyond: !!r.scaledBeyond, data: r, selected: true, rank: i + 1,
        })));
      }
      if (auth && map.generatedSheetId) {
        await writeBreakdownTab(auth, map.generatedSheetId, name, enriched)
          .catch((e) => console.warn(`breakdown tab ${name}:`, (e as Error).message));
      }
      await setProgress(jobId, i + 1, `Done ${name}`);
    }

    await db.update(competitiveMapsTable).set({ status: "broken_down", updatedAt: new Date() }).where(eq(competitiveMapsTable.id, id));
  });
});

/* ── Stage 5 · INSPIRATION (human pick + AI build) ──────────────────────────*/
router.post("/competitive-maps/:id/inspiration/suggest", async (req, res) => {
  const me = uid(req, res); if (!me) return;
  const id = Number(req.params.id);
  const map = await loadMap(me, id);
  if (!map) { res.status(404).json({ error: "not found" }); return; }
  try { res.json({ items: await suggestInspiration(map.companyName, map.overview || {}) }); }
  catch (e) { console.error("insp suggest failed", e); res.json({ items: {} }); }
});

router.post("/competitive-maps/:id/inspiration", async (req, res) => {
  const me = uid(req, res); if (!me) return;
  const id = Number(req.params.id);
  const map = await loadMap(me, id);
  if (!map) { res.status(404).json({ error: "not found" }); return; }
  const companyName = req.body?.companyName;
  if (!companyName) { res.status(400).json({ error: "companyName required" }); return; }
  try {
    const out: any = await generateInspirationFor(companyName, map.companyName);
    if (out?.phases) {
      await db.insert(mapInspirationTable).values({
        mapId: id, companyName: out.who || companyName, phases: out.phases, aiGenerated: true,
      });
      await db.update(competitiveMapsTable).set({ status: "inspiration", updatedAt: new Date() }).where(eq(competitiveMapsTable.id, id));
      const auth = await getAuthedClient(me);
      if (auth && map.generatedSheetId) {
        await writeInspirationTab(auth, map.generatedSheetId, out.who || companyName, out.phases)
          .catch((e) => console.warn("insp tab:", (e as Error).message));
      }
    }
    res.json(out);
  } catch (e) { console.error("insp failed", e); res.status(500).json({ error: "insp failed" }); }
});

/* ── Async job progress ─────────────────────────────────────────────────────*/
router.get("/competitive-maps/jobs/:jobId", async (req, res) => {
  const me = uid(req, res); if (!me) return;
  const job = await getJob(Number(req.params.jobId));
  if (!job) { res.status(404).json({ error: "not found" }); return; }
  res.json(job);
});

/* ── Saved runs — list + detail (revisit) ───────────────────────────────────*/
router.get("/competitive-maps", async (req, res) => {
  const me = uid(req, res); if (!me) return;
  const rows = await db.select().from(competitiveMapsTable)
    .where(eq(competitiveMapsTable.consultantId, me))
    .orderBy(desc(competitiveMapsTable.updatedAt));
  res.json({
    maps: rows.map((r) => ({
      id: r.id, companyName: r.companyName, website: r.website, status: r.status,
      logo: (r.overview as any)?.logo ?? null, tagline: (r.overview as any)?.tagline ?? "",
      sheetUrl: r.generatedSheetUrl, createdAt: r.createdAt, updatedAt: r.updatedAt,
    })),
  });
});

router.get("/competitive-maps/:id", async (req, res) => {
  const me = uid(req, res); if (!me) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const map = await loadMap(me, id);
  if (!map) { res.status(404).json({ error: "not found" }); return; }
  const products = await db.select().from(mapProductsTable)
    .where(eq(mapProductsTable.mapId, id)).orderBy(asc(mapProductsTable.srNo));
  const inspiration = await db.select().from(mapInspirationTable)
    .where(eq(mapInspirationTable.mapId, id)).orderBy(asc(mapInspirationTable.createdAt));

  // Group breakdown rows by company.
  const byCompany: Record<string, any[]> = {};
  for (const p of products) {
    const row = { ...(p.data as any), image: p.imageUrl || (p.data as any)?.image || "" };
    (byCompany[p.company] ||= []).push(row);
  }
  const inspMap: Record<string, any> = {};
  inspiration.forEach((i) => {
    const slug = i.companyName.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16) || `co${i.id}`;
    inspMap[slug] = { who: i.companyName, phases: i.phases, generated: !!i.aiGenerated };
  });

  res.json({
    id: map.id, companyName: map.companyName, website: map.website, status: map.status,
    overview: map.overview, landscape: map.landscape ?? null, selected: map.selected ?? [],
    geography: map.geography ?? "", industry: map.industry ?? "",
    demandMap: map.demandMap ?? null, competitiveDoc: map.competitiveDoc ?? null,
    breakdown: byCompany, inspiration: inspMap, sheetUrl: map.generatedSheetUrl,
  });
});

/* ── Research Copilot (saved chat) — surfaced on the dashboard ───────────────*/
router.get("/competitive-maps/:id/copilot", async (req, res) => {
  const me = uid(req, res); if (!me) return;
  const mapId = Number(req.params.id);
  const rows = await db.select().from(copilotMessagesTable)
    .where(eq(copilotMessagesTable.mapId, mapId)).orderBy(asc(copilotMessagesTable.createdAt));
  res.json(rows.map((m) => m.role === "user" ? { role: "user", text: m.content } : { role: "ai", blocks: m.content }));
});

router.post("/competitive-maps/:id/copilot", async (req, res) => {
  const me = uid(req, res); if (!me) return;
  const mapId = Number(req.params.id);
  const { question, focusCompany } = req.body ?? {};
  if (!question) { res.status(400).json({ error: "question required" }); return; }
  const [map] = await db.select().from(competitiveMapsTable).where(eq(competitiveMapsTable.id, mapId)).limit(1);
  const subject = map?.companyName ?? "the subject company";
  // Ground the assistant in this company's own research so it's specialised.
  const context = [
    map?.overview ? `OVERVIEW:\n${JSON.stringify(map.overview).slice(0, 3000)}` : "",
    (map?.geography || map?.industry) ? `SCOPE: ${map?.industry || "industry"} in ${map?.geography || "market"}` : "",
    map?.landscape ? `INDUSTRY LANDSCAPE:\n${JSON.stringify(map.landscape).slice(0, 3000)}` : "",
  ].filter(Boolean).join("\n\n");
  const history = await db.select().from(copilotMessagesTable)
    .where(eq(copilotMessagesTable.mapId, mapId)).orderBy(asc(copilotMessagesTable.createdAt));
  await db.insert(copilotMessagesTable).values({ mapId, role: "user", focusCompany: focusCompany ?? null, content: question });
  const blocks = await copilotAnswer({
    focusCompany: focusCompany ?? "the market", subject, context,
    history: history.map((m) => `${m.role}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`).join("\n"),
    question,
  });
  await db.insert(copilotMessagesTable).values({ mapId, role: "ai", focusCompany: focusCompany ?? null, content: blocks });
  res.json({ blocks });
});

/* Suggested starter prompts for the always-on Research Assistant — tailored to
 * the subject, its problems and (once fenced) its industry. */
router.get("/competitive-maps/:id/copilot/suggest", async (req, res) => {
  const me = uid(req, res); if (!me) return;
  const mapId = Number(req.params.id);
  const [map] = await db.select().from(competitiveMapsTable).where(eq(competitiveMapsTable.id, mapId)).limit(1);
  if (!map) { res.status(404).json({ error: "not found" }); return; }
  try {
    const prompts = await suggestCopilotPrompts(map.companyName, map.overview || {}, map.landscape || {}, map.status);
    res.json({ prompts });
  } catch (e) { console.warn("copilot suggest failed", (e as Error).message); res.json({ prompts: [] }); }
});

export default router;
