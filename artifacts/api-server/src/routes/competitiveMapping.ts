/**
 * Competitive Mapping API — generates real research for any company via Gemini.
 *
 *   POST /competitive-maps                    create run + generate overview + directions
 *   POST /competitive-maps/fence              generate the Fencing competitor grid
 *   POST /competitive-maps/bmc                generate a BMC for one product
 *   POST /competitive-maps/inspiration/suggest suggest aspirational-giant timelines
 *   POST /competitive-maps/inspiration        generate a timeline for one company
 *   GET/POST /competitive-maps/:id/copilot    saved Research Copilot chat
 *   POST /competitive-maps/generate           write the Google Sheet to Drive
 */
import { Router } from "express";
import { db, competitiveMapsTable, copilotMessagesTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { google } from "googleapis";
import { getAuthedClient } from "../lib/google";
import {
  generateOverview, suggestDirections, generateFencing, generateBmc,
  suggestInspiration, generateInspirationFor, copilotAnswer,
} from "../lib/competitiveMappingAi";

const router = Router();

function uid(req: any, res: any): number | null {
  const id = req.session?.userId;
  if (!id) { res.status(401).json({ error: "Not authenticated" }); return null; }
  return id;
}

/* create a run: generate overview + directions for the entered company */
router.post("/competitive-maps", async (req, res) => {
  const me = uid(req, res); if (!me) return;
  const { companyName, website, tsheetUrl } = req.body ?? {};
  if (!companyName) { res.status(400).json({ error: "companyName required" }); return; }
  try {
    const overview = await generateOverview(companyName, website);
    const directions = await suggestDirections(overview);
    const [row] = await db.insert(competitiveMapsTable)
      .values({ consultantId: me, companyName, website: website ?? null, tsheetUrl: tsheetUrl ?? null, status: "overview_ready", overview })
      .returning();
    res.status(201).json({ id: row.id, overview, directions });
  } catch (e) {
    console.error("create map failed", e);
    res.status(500).json({ error: "generation failed" });
  }
});

/* Fencing grid */
router.post("/competitive-maps/fence", async (req, res) => {
  const me = uid(req, res); if (!me) return;
  const { mapId, subject, direction, overview } = req.body ?? {};
  try {
    const rows = await generateFencing(subject || "the company", direction || "", overview || {});
    if (mapId) await db.update(competitiveMapsTable).set({ direction: direction ?? null, status: "fenced", updatedAt: new Date() }).where(eq(competitiveMapsTable.id, Number(mapId)));
    res.json({ rows });
  } catch (e) { console.error("fence failed", e); res.json({ rows: [] }); }
});

/* BMC for one product */
router.post("/competitive-maps/bmc", async (req, res) => {
  const me = uid(req, res); if (!me) return;
  const { companyName, product, data } = req.body ?? {};
  try { res.json({ blocks: await generateBmc(companyName || "Company", product || "", data || {}) }); }
  catch (e) { console.error("bmc failed", e); res.status(500).json({ error: "bmc failed" }); }
});

/* Inspiration suggestions (2 giants) */
router.post("/competitive-maps/inspiration/suggest", async (req, res) => {
  const me = uid(req, res); if (!me) return;
  const { subject, overview } = req.body ?? {};
  try { res.json({ items: await suggestInspiration(subject || "the company", overview || {}) }); }
  catch (e) { console.error("insp suggest failed", e); res.json({ items: {} }); }
});

/* Inspiration for one company */
router.post("/competitive-maps/inspiration", async (req, res) => {
  const me = uid(req, res); if (!me) return;
  const { companyName, subject } = req.body ?? {};
  if (!companyName) { res.status(400).json({ error: "companyName required" }); return; }
  try { res.json(await generateInspirationFor(companyName, subject || "the company")); }
  catch (e) { console.error("insp failed", e); res.status(500).json({ error: "insp failed" }); }
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
    requestBody: { properties: { title: `TS Research for ${p.companyName ?? "Company"}` }, sheets: tabNames.map((title) => ({ properties: { title } })) },
  });
  const spreadsheetId = created.data.spreadsheetId!;
  const data: { range: string; values: any[][] }[] = [];
  const push = (title: string, values: any[][]) => data.push({ range: `'${title}'!A1`, values });
  const o = p.overview ?? {};
  push("Company Overview", [
    ["Company Overview", p.companyName ?? ""],
    ["Tagline", o.tagline ?? ""], ["Website", o.website ?? ""], ["Founded", o.founded ?? ""], ["HQ", o.hq ?? ""], ["Stage", o.stage ?? ""], [],
    ["Metric", "Value"], ...(o.metrics ?? []).map((m: any) => [m.label, `${m.value} (${m.note ?? ""})`]), [],
    ["Product", "Revenue - Segment - Problem"], ...(o.products ?? []).map((pr: any) => [pr.name, `${pr.rev} - ${pr.seg} - ${pr.problem}`]),
  ]);
  push("Industry Decoding (Fencing)", [
    columns.map((c: any) => c.label),
    ...(p.fencing ?? []).map((r: any) => columns.map((c: any) => (c.key === "image" ? "[capture]" : (r[c.key] ?? "NA")))),
  ]);
  push("Competitive Mapping (PODPOS)", [
    ["Point of similarity / difference", ...selected.map((s: any) => `${s.company} - ${s.product}`)],
    ["Your company", ...selected.map(() => p.companyName ?? "")],
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
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data } });
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
  if (p.mapId) await db.update(competitiveMapsTable).set({ generatedSheetId: spreadsheetId, generatedSheetUrl: url, status: "generated", updatedAt: new Date() }).where(eq(competitiveMapsTable.id, Number(p.mapId)));
  res.json({ spreadsheetId, url });
});

export default router;
