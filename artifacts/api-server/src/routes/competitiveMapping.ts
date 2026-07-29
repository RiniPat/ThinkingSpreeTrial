/**
 * Competitive Mapping API.
 *
 *   POST   /competitive-maps                 — create a run (returns id)
 *   GET    /competitive-maps/:id/copilot     — saved Research Copilot chat
 *   POST   /competitive-maps/:id/copilot     — ask (persists both turns) → {blocks}
 *   POST   /competitive-maps/generate        — build the Google Sheet in Drive → {url}
 *
 * Scrape / fence / breakdown run client-side on seeded data today; when the
 * Scrapling sidecar + job runner are added they slot in as background jobs that
 * flip competitive_maps.status (the front-end already polls on status).
 */
import { Router } from "express";
import { db, competitiveMapsTable, copilotMessagesTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { google } from "googleapis";
import { getAuthedClient } from "../lib/google";
import { copilotAnswer } from "../lib/competitiveMappingAi";

const router = Router();

function uid(req: any, res: any): number | null {
  const id = req.session?.userId;
  if (!id) { res.status(401).json({ error: "Not authenticated" }); return null; }
  return id;
}

/* ── create a run ──────────────────────────────────────────────────────── */
router.post("/competitive-maps", async (req, res) => {
  const me = uid(req, res); if (!me) return;
  const { companyName, website, tsheetUrl } = req.body ?? {};
  if (!companyName) { res.status(400).json({ error: "companyName required" }); return; }
  const [row] = await db.insert(competitiveMapsTable)
    .values({ consultantId: me, companyName, website: website ?? null, tsheetUrl: tsheetUrl ?? null, status: "overview_ready" })
    .returning();
  res.status(201).json(row);
});

/* ── Research Copilot (saved chat) ─────────────────────────────────────── */
router.get("/competitive-maps/:id/copilot", async (req, res) => {
  const me = uid(req, res); if (!me) return;
  const mapId = Number(req.params.id);
  const rows = await db.select().from(copilotMessagesTable)
    .where(eq(copilotMessagesTable.mapId, mapId)).orderBy(asc(copilotMessagesTable.createdAt));
  // shape into what the dock expects: user → {role,text}, ai → {role,blocks}
  res.json(rows.map((m) => m.role === "user"
    ? { role: "user", text: m.content }
    : { role: "ai", blocks: m.content }));
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

/* ── Generate the research workbook in the consultant's Google Drive ───── */
router.post("/competitive-maps/generate", async (req, res) => {
  const me = uid(req, res); if (!me) return;
  const authClient = await getAuthedClient(me);
  if (!authClient) { res.status(400).json({ error: "Connect Google in Settings first." }); return; }

  const p = req.body ?? {};
  const sanitize = (t: string) => t.replace(/[\\/?*\[\]:]/g, " ").slice(0, 95);
  const selected = Array.isArray(p.selected) ? p.selected : [];
  const inspiration = Array.isArray(p.inspiration) ? p.inspiration : [];
  const columns = Array.isArray(p.columns) ? p.columns : [];

  const tabNames = [
    "Company Overview", "Industry Decoding (Fencing)", "Competitive Mapping (PODPOS)",
    ...selected.map((s: any) => sanitize(`BMC — ${s.company} · ${s.product}`)),
    ...inspiration.map((i: any) => sanitize(`Inspiration — ${i.who}`)),
  ];

  const sheets = google.sheets({ version: "v4", auth: authClient });
  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: `TS Research for ${p.companyName ?? "Company"}` },
      sheets: tabNames.map((title) => ({ properties: { title } })),
    },
  });
  const spreadsheetId = created.data.spreadsheetId!;

  // assemble each tab's 2-D values
  const data: { range: string; values: any[][] }[] = [];
  const push = (title: string, values: any[][]) => data.push({ range: `'${title}'!A1`, values });

  const o = p.overview ?? {};
  push("Company Overview", [
    ["Company Overview", p.companyName ?? ""],
    ["Tagline", o.tagline ?? ""], ["Website", o.website ?? ""], ["Founded", o.founded ?? ""],
    ["HQ", o.hq ?? ""], ["Stage", o.stage ?? ""], [],
    ["Metric", "Value"],
    ...(o.metrics ?? []).map((m: any) => [m.label, `${m.value} (${m.note ?? ""})`]), [],
    ["Product", "Revenue · Segment · Problem"],
    ...(o.products ?? []).map((pr: any) => [pr.name, `${pr.rev} · ${pr.seg} · ${pr.problem}`]),
  ]);

  push("Industry Decoding (Fencing)", [
    columns.map((c: any) => c.label),
    ...(p.fencing ?? []).map((r: any) => columns.map((c: any) => (c.key === "image" ? "[capture]" : (r[c.key] ?? "NA")))),
  ]);

  push("Competitive Mapping (PODPOS)", [
    ["Point of similarity / difference", ...selected.map((s: any) => `${s.company} · ${s.product}`)],
    ["Your company", ...selected.map(() => p.companyName ?? "")],
  ]);

  const blocks: [string, string][] = [
    ["Key Partners", "kp"], ["Key Activities", "ka"], ["Key Resources", "kr"], ["Value Propositions", "vp"],
    ["Customer Relationships", "cr"], ["Channels", "ch"], ["Customer Segments", "cs"],
    ["Cost Structure", "cost"], ["Revenue Streams", "rev"],
  ];
  selected.forEach((s: any) => {
    const title = sanitize(`BMC — ${s.company} · ${s.product}`);
    push(title, [
      [`${s.company} · ${s.product}`, "Business Model Canvas"],
      ...blocks.map(([label, key]) => [label, ((s.bmc && s.bmc[key]) || []).map((x: any) => x.t ?? x).join("\n") || "AI drafting…"]),
    ]);
  });

  inspiration.forEach((ins: any) => {
    const title = sanitize(`Inspiration — ${ins.who}`);
    push(title, [
      ["Timeline", "Product & Capability", "Marketing & Positioning", "Funding & Investment", "Quantified Growth", "Key Customers / Partners"],
      ...(ins.phases ?? []).map((ph: any) => [ph.era, ph.product, ph.market, ph.funding, ph.growth, ph.customers]),
    ]);
  });

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "RAW", data },
  });

  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
  if (p.mapId) {
    await db.update(competitiveMapsTable)
      .set({ generatedSheetId: spreadsheetId, generatedSheetUrl: url, status: "generated", updatedAt: new Date() })
      .where(eq(competitiveMapsTable.id, Number(p.mapId)));
  }
  // TODO (loop closers): upsert overview into the Summary tab + append the
  // company to Sprint Tracking, mirroring admin-import's writers.
  res.json({ spreadsheetId, url });
});

export default router;
