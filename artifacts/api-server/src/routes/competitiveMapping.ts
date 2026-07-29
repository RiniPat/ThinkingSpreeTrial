/**
 * Competitive Mapping API — generates real research for any company via Gemini,
 * grounded by a real Scrapling crawl of the website (+ optional T-Sheet & deck),
 * persists every stage so a run can be revisited, and writes a Google Sheet.
 *
 *   POST   /competitive-maps                     create run: scrape + overview + directions
 *   POST   /competitive-maps/ingest-deck         extract text from an uploaded pitch PDF
 *   POST   /competitive-maps/fence               generate Fencing grid (+ real images), persist rows
 *   POST   /competitive-maps/bmc                 generate + persist a BMC for one product
 *   POST   /competitive-maps/inspiration/suggest suggest aspirational-giant timelines
 *   POST   /competitive-maps/inspiration         generate + persist a timeline for one company
 *   GET    /competitive-maps                     list this consultant's saved runs   (revisit)
 *   GET    /competitive-maps/:id                 full saved run (overview+products+inspiration)
 *   GET/POST /competitive-maps/:id/copilot       saved Research Copilot chat
 *   POST   /competitive-maps/generate            write the Google Sheet to Drive
 */
import { Router } from "express";
import multer from "multer";
import {
  db, competitiveMapsTable, copilotMessagesTable,
  mapProductsTable, mapBmcTable, mapInspirationTable,
} from "@workspace/db";
import { eq, and, asc, desc } from "drizzle-orm";
import { google } from "googleapis";
import XLSX from "xlsx";
import { getAuthedClient } from "../lib/google";
import { fetchWebsiteText } from "../lib/websiteText";
import { fetchSheetAsWorkbook } from "../lib/sheetsFetcher";
import { extractTextFromUpload } from "../lib/fileExtract";
import { scrapeCompanyProfile, resolveCompanyImage, resolveProductImages, logoForDomain } from "../lib/scraper";
import {
  generateOverview, suggestDirections, generateFencing, generateBmc,
  suggestInspiration, generateInspirationFor, copilotAnswer,
} from "../lib/competitiveMappingAi";

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

/* create a run: scrape → overview + directions for the entered company */
router.post("/competitive-maps", async (req, res) => {
  const me = uid(req, res); if (!me) return;
  const { companyName, website, tsheetUrl, deckText } = req.body ?? {};
  if (!companyName) { res.status(400).json({ error: "companyName required" }); return; }
  try {
    // 1) Scrapling: crawl the website (+ high-signal sub-pages) for real content + image.
    const profile = await scrapeCompanyProfile({ name: companyName, website }).catch(
      () => ({ text: "", image: "", domain: "", pages: [] as string[] }),
    );
    let websiteText = profile.text;
    if (!websiteText && website) websiteText = await fetchWebsiteText(website).catch(() => "");

    // 2) Optional T-Sheet ingest (needs Google connected).
    let sheetText = "";
    if (tsheetUrl) {
      try { sheetText = workbookToText(await fetchSheetAsWorkbook(me, tsheetUrl)); }
      catch (e) { console.warn("tsheet ingest skipped:", (e as Error).message); }
    }

    // 3) Overview + directions, grounded in the scraped evidence.
    const overview = await generateOverview(companyName, website, {
      websiteText, sheetText, deckText: typeof deckText === "string" ? deckText : "",
    });
    if (profile.image && overview && !overview.logo) (overview as any).logo = profile.image;
    if (profile.domain && overview && (!overview.website || overview.website === "-")) {
      (overview as any).website = website || profile.domain;
    }
    const directions = await suggestDirections(overview);

    const [row] = await db.insert(competitiveMapsTable)
      .values({
        consultantId: me, companyName, website: website ?? profile.domain ?? null,
        tsheetUrl: tsheetUrl ?? null, status: "overview_ready", overview,
      })
      .returning();

    res.status(201).json({
      id: row.id, overview, directions,
      scraped: { pages: profile.pages, image: profile.image },
    });
  } catch (e) {
    console.error("create map failed", e);
    res.status(500).json({ error: "generation failed" });
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

/* Fencing grid — generate rows, resolve a real image per company, persist. */
router.post("/competitive-maps/fence", async (req, res) => {
  const me = uid(req, res); if (!me) return;
  const { mapId, subject, direction, overview } = req.body ?? {};
  try {
    const rows = await generateFencing(subject || "the company", direction || "", overview || {});

    // Scrape a ranked image list per DISTINCT company (dedupe fetches), then map back.
    const byCompany = new Map<string, string[]>();
    await Promise.all(
      [...new Set(rows.map((r) => (r.company || "").toLowerCase()))].filter(Boolean).map(async (key) => {
        const sample = rows.find((r) => (r.company || "").toLowerCase() === key)!;
        const imgs = await resolveProductImages({ company: sample.company, website: sample.website }).catch(() => []);
        const list = imgs.length ? imgs : (sample.website ? [logoForDomain(sample.website)] : []);
        byCompany.set(key, list.filter(Boolean));
      }),
    );
    const enriched = rows.map((r) => {
      const list = byCompany.get((r.company || "").toLowerCase()) || [];
      return { ...r, image: list[0] || "", images: list };
    });

    if (mapId) {
      const id = Number(mapId);
      await db.update(competitiveMapsTable)
        .set({ direction: direction ?? null, status: "fenced", updatedAt: new Date() })
        .where(eq(competitiveMapsTable.id, id));
      // Replace any prior rows for this map (idempotent re-fence).
      await db.delete(mapProductsTable).where(eq(mapProductsTable.mapId, id));
      if (enriched.length) {
        await db.insert(mapProductsTable).values(enriched.map((r, i) => ({
          mapId: id, srNo: Number(r.sr) || i + 1, company: String(r.company || "?"),
          product: String(r.product || "?"), imageUrl: r.image || null,
          seg: r.seg ?? null, scaledBeyond: !!r.scaledBeyond, data: r, selected: false, rank: null,
        })));
      }
    }
    res.json({ rows: enriched });
  } catch (e) { console.error("fence failed", e); res.json({ rows: [] }); }
});

/* BMC for one product (persisted when mapId + productId supplied) */
router.post("/competitive-maps/bmc", async (req, res) => {
  const me = uid(req, res); if (!me) return;
  const { companyName, product, data, mapId, productId } = req.body ?? {};
  try {
    const blocks = await generateBmc(companyName || "Company", product || "", data || {});
    if (mapId && productId) {
      await db.insert(mapBmcTable).values({ mapId: Number(mapId), productId: Number(productId), blocks });
    }
    res.json({ blocks });
  } catch (e) { console.error("bmc failed", e); res.status(500).json({ error: "bmc failed" }); }
});

/* Inspiration suggestions (2 giants) */
router.post("/competitive-maps/inspiration/suggest", async (req, res) => {
  const me = uid(req, res); if (!me) return;
  const { subject, overview } = req.body ?? {};
  try { res.json({ items: await suggestInspiration(subject || "the company", overview || {}) }); }
  catch (e) { console.error("insp suggest failed", e); res.json({ items: {} }); }
});

/* Inspiration for one company (persisted when mapId supplied) */
router.post("/competitive-maps/inspiration", async (req, res) => {
  const me = uid(req, res); if (!me) return;
  const { companyName, subject, mapId } = req.body ?? {};
  if (!companyName) { res.status(400).json({ error: "companyName required" }); return; }
  try {
    const out = await generateInspirationFor(companyName, subject || "the company");
    if (mapId && out?.phases) {
      await db.insert(mapInspirationTable).values({
        mapId: Number(mapId), companyName: out.who || companyName, phases: out.phases, aiGenerated: true,
      });
    }
    res.json(out);
  } catch (e) { console.error("insp failed", e); res.status(500).json({ error: "insp failed" }); }
});

/* ── Saved runs — list + detail so consultants can revisit a company ─────── */
router.get("/competitive-maps", async (req, res) => {
  const me = uid(req, res); if (!me) return;
  const rows = await db.select({
    id: competitiveMapsTable.id, companyName: competitiveMapsTable.companyName,
    website: competitiveMapsTable.website, status: competitiveMapsTable.status,
    direction: competitiveMapsTable.direction, overview: competitiveMapsTable.overview,
    generatedSheetUrl: competitiveMapsTable.generatedSheetUrl,
    createdAt: competitiveMapsTable.createdAt, updatedAt: competitiveMapsTable.updatedAt,
  }).from(competitiveMapsTable)
    .where(eq(competitiveMapsTable.consultantId, me))
    .orderBy(desc(competitiveMapsTable.updatedAt));
  res.json({
    maps: rows.map((r) => ({
      id: r.id, companyName: r.companyName, website: r.website, status: r.status,
      direction: r.direction, logo: (r.overview as any)?.logo ?? null,
      tagline: (r.overview as any)?.tagline ?? "", sheetUrl: r.generatedSheetUrl,
      createdAt: r.createdAt, updatedAt: r.updatedAt,
    })),
  });
});

router.get("/competitive-maps/:id", async (req, res) => {
  const me = uid(req, res); if (!me) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const [map] = await db.select().from(competitiveMapsTable)
    .where(and(eq(competitiveMapsTable.id, id), eq(competitiveMapsTable.consultantId, me))).limit(1);
  if (!map) { res.status(404).json({ error: "not found" }); return; }
  const products = await db.select().from(mapProductsTable)
    .where(eq(mapProductsTable.mapId, id)).orderBy(asc(mapProductsTable.srNo));
  const inspiration = await db.select().from(mapInspirationTable)
    .where(eq(mapInspirationTable.mapId, id)).orderBy(asc(mapInspirationTable.createdAt));

  // Rebuild the shapes the front-end context expects.
  const rows = products.map((p) => ({ ...(p.data as any), image: p.imageUrl || (p.data as any)?.image || "" }));
  const inspMap: Record<string, any> = {};
  inspiration.forEach((i) => {
    const slug = i.companyName.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16) || `co${i.id}`;
    inspMap[slug] = { who: i.companyName, phases: i.phases, generated: !!i.aiGenerated };
  });
  res.json({
    id: map.id, companyName: map.companyName, website: map.website, status: map.status,
    direction: map.direction, overview: map.overview, rows, inspiration: inspMap,
    generatedSheetUrl: map.generatedSheetUrl,
  });
});

/* Research Copilot (saved chat) */
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
  const history = await db.select().from(copilotMessagesTable)
    .where(eq(copilotMessagesTable.mapId, mapId)).orderBy(asc(copilotMessagesTable.createdAt));
  await db.insert(copilotMessagesTable).values({ mapId, role: "user", focusCompany: focusCompany ?? null, content: question });
  const blocks = await copilotAnswer({
    focusCompany: focusCompany ?? "the market", subject,
    history: history.map((m) => `${m.role}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`).join("\n"),
    question,
  });
  await db.insert(copilotMessagesTable).values({ mapId, role: "ai", focusCompany: focusCompany ?? null, content: blocks });
  res.json({ blocks });
});

/* Generate the workbook in the consultant's Google Drive */
router.post("/competitive-maps/generate", async (req, res) => {
  const me = uid(req, res); if (!me) return;
  const authClient = await getAuthedClient(me);
  if (!authClient) { res.status(400).json({ error: "Connect Google in Settings first." }); return; }
  const p = req.body ?? {};
  const subjectName = p.companyName || p.overview?.name || "Company";
  const sanitize = (t: string) => String(t).replace(/[\\/?*\[\]:]/g, " ").slice(0, 95);
  const selected = Array.isArray(p.selected) ? p.selected : [];
  const inspiration = Array.isArray(p.inspiration) ? p.inspiration : [];
  const columns = Array.isArray(p.columns) ? p.columns : [];
  const tabNames = [
    "Company Overview", "Industry Decoding (Fencing)", "Competitive Mapping (PODPOS)",
    ...selected.map((s: any) => sanitize(`BMC - ${s.company} - ${s.product}`)),
    ...inspiration.map((i: any) => sanitize(`Inspiration - ${i.who}`)),
  ];
  const sheets = google.sheets({ version: "v4", auth: authClient });
  const created = await sheets.spreadsheets.create({
    requestBody: { properties: { title: `TS Research for ${subjectName}` }, sheets: tabNames.map((title) => ({ properties: { title } })) },
  });
  const spreadsheetId = created.data.spreadsheetId!;
  const data: { range: string; values: any[][] }[] = [];
  const push = (title: string, values: any[][]) => data.push({ range: `'${title}'!A1`, values });
  const o = p.overview ?? {};
  push("Company Overview", [
    ["Company Overview", subjectName],
    ["Tagline", o.tagline ?? ""], ["Website", o.website ?? ""], ["Founded", o.founded ?? ""], ["HQ", o.hq ?? ""], ["Stage", o.stage ?? ""], [],
    ["Metric", "Value"], ...(o.metrics ?? []).map((m: any) => [m.label, `${m.value} (${m.note ?? ""})`]), [],
    ["Product", "Revenue - Segment - Problem"], ...(o.products ?? []).map((pr: any) => [pr.name, `${pr.rev} - ${pr.seg} - ${pr.problem}`]),
  ]);
  // Fencing — use =IMAGE(url) so the Product Image column shows a real picture.
  push("Industry Decoding (Fencing)", [
    columns.map((c: any) => c.label),
    ...(p.fencing ?? []).map((r: any) => columns.map((c: any) =>
      c.key === "image"
        ? (r.image || r.imageUrl ? `=IMAGE("${String(r.image || r.imageUrl).replace(/"/g, "")}")` : "NA")
        : (r[c.key] ?? "NA"))),
  ]);
  push("Competitive Mapping (PODPOS)", [
    ["Point of similarity / difference", ...selected.map((s: any) => `${s.company} - ${s.product}`)],
    ["Your company", ...selected.map(() => subjectName)],
  ]);
  const blocks: [string, string][] = [
    ["Key Partners", "kp"], ["Key Activities", "ka"], ["Key Resources", "kr"], ["Value Propositions", "vp"],
    ["Customer Relationships", "cr"], ["Channels", "ch"], ["Customer Segments", "cs"], ["Cost Structure", "cost"], ["Revenue Streams", "rev"],
  ];
  selected.forEach((s: any) => push(sanitize(`BMC - ${s.company} - ${s.product}`), [
    [`${s.company} - ${s.product}`, "Business Model Canvas"],
    ...blocks.map(([label, key]) => [label, ((s.bmc && s.bmc[key]) || []).map((x: any) => x.t ?? x).join("\n") || "AI drafting..."]),
  ]));
  inspiration.forEach((ins: any) => push(sanitize(`Inspiration - ${ins.who}`), [
    ["Timeline", "Product & Capability", "Marketing & Positioning", "Funding & Investment", "Quantified Growth", "Key Customers / Partners"],
    ...(ins.phases ?? []).map((ph: any) => [ph.era, ph.product, ph.market, ph.funding, ph.growth, ph.customers]),
  ]));
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "USER_ENTERED", data } });
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
  if (p.mapId) await db.update(competitiveMapsTable).set({ generatedSheetId: spreadsheetId, generatedSheetUrl: url, status: "generated", updatedAt: new Date() }).where(eq(competitiveMapsTable.id, Number(p.mapId)));
  res.json({ spreadsheetId, url, companyName: subjectName });
});

export default router;
