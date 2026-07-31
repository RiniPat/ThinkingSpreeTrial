/**
 * Competitive Mapping AI helpers — generates real research for ANY company.
 *
 * Model routing (v5.22 fix):
 *   light tasks  -> gemini-2.5-flash-lite   (directions)
 *   heavy tasks  -> gemini-2.5-flash        (overview, fencing, BMC, inspiration, copilot)
 *
 * IMPORTANT: earlier builds pointed at "gemini-3.5-flash" / "gemini-3.6-flash",
 * which DO NOT EXIST — so every call threw and silently fell back to a stub,
 * which is why the UI kept showing the seeded Quintinno EV demo. We now use the
 * same models the rest of the suite uses, allow an env override, and if a model
 * name is ever rejected we retry once on a known-good model before falling back.
 *
 * Every generator returns strict JSON in the exact shape the front-end renders.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";

// Override via env if you want to upgrade later (e.g. CM_MODEL_HEAVY=gemini-2.5-pro)
export const MODEL_HEAVY = process.env.CM_MODEL_HEAVY?.trim() || "gemini-2.5-flash";
export const MODEL_LITE = process.env.CM_MODEL_LITE?.trim() || "gemini-2.5-flash-lite";
const MODEL_SAFE = "gemini-2.5-flash"; // known-good retry target

export function isConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

function getModel(name: string) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");
  return new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: name,
    generationConfig: { responseMimeType: "application/json" },
  });
}

function parseJson<T>(text: string, fallback: T): T {
  try {
    const cleaned = text.replace(/^```json\s*|\s*```$/g, "").trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return fallback;
  }
}

function looksLikeBadModel(msg: string): boolean {
  const m = msg.toLowerCase();
  return m.includes("not found") || m.includes("404") || m.includes("unsupported") ||
    m.includes("permission") || m.includes("does not exist") || m.includes("invalid model");
}

async function callOnce(model: string, text: string): Promise<string> {
  const m = getModel(model);
  const res = await m.generateContent(text);
  return res.response.text();
}

async function gen<T>(opts: { model: string; system: string; prompt: string; fallback: T }): Promise<T> {
  if (!isConfigured()) return opts.fallback;
  const payload = `${opts.system}\n\n${opts.prompt}`;
  try {
    const out = parseJson<T | null>(await callOnce(opts.model, payload), null as any);
    return (out ?? opts.fallback) as T;
  } catch (e) {
    const msg = (e as Error).message || "";
    // Retry once on a known-good model if the configured one was rejected.
    if (opts.model !== MODEL_SAFE && looksLikeBadModel(msg)) {
      try {
        const out = parseJson<T | null>(await callOnce(MODEL_SAFE, payload), null as any);
        return (out ?? opts.fallback) as T;
      } catch (e2) {
        console.warn("[competitiveMappingAi] retry failed, using fallback:", (e2 as Error).message);
        return opts.fallback;
      }
    }
    console.warn("[competitiveMappingAi] generation failed, using fallback:", msg);
    return opts.fallback;
  }
}

/* 1 - Company Overview
 * `context` carries everything Scrapling + the sheet + the deck pulled in, so
 * the model writes from real evidence instead of guessing from the name alone.
 */
export async function generateOverview(
  companyName: string,
  website?: string,
  context?: { websiteText?: string; sheetText?: string; deckText?: string },
) {
  const fallback = {
    name: companyName, tagline: `Research profile for ${companyName}.`,
    website: website || "", founded: "-", hq: "-", stage: "-",
    growth: [] as any[], metrics: [] as any[], products: [] as any[],
  };

  const evidence = [
    context?.websiteText ? `WEBSITE / SCRAPED CONTENT:\n${context.websiteText.slice(0, 9000)}` : "",
    context?.sheetText ? `T-SHEET (research sheet) CONTENT:\n${context.sheetText.slice(0, 7000)}` : "",
    context?.deckText ? `PITCH DECK CONTENT:\n${context.deckText.slice(0, 6000)}` : "",
  ].filter(Boolean).join("\n\n---\n\n");

  const grounding = evidence
    ? "Base every field on the EVIDENCE below; prefer figures found there over anything you recall. "
    : "";

  return gen({
    model: MODEL_HEAVY,
    system:
      "You are a startup research analyst. Produce a factual company overview as STRICT JSON with keys: " +
      "name, tagline, website, founded, hq, stage, " +
      "growth (array of {y, rev} - 4-6 points, y is a period label, rev is a NUMBER for revenue/ARR), " +
      "metrics (array of {label, value, note} - 4 key traction metrics), " +
      "products (array of {name, rev, seg, problem, uses[]} - seg is 'B2B' or 'B2C', uses is 2-3 short strings). " +
      grounding +
      "Where a figure is genuinely unknown use '-' (or an empty array). Do NOT invent a different company. Output ONLY the JSON object.",
    prompt: `Company: ${companyName}${website ? `\nWebsite: ${website}` : ""}${evidence ? `\n\nEVIDENCE:\n${evidence}` : ""}`,
    fallback,
  });
}

/* 2 - Research directions (light) */
export async function suggestDirections(overview: any) {
  const fallback = [
    { title: "Direct competitors at similar scale", reasoning: "Companies solving the same core problem for the same buyer." },
    { title: "Players who out-scaled us", reasoning: "Larger comparables reveal the path and unit economics at scale." },
    { title: "Adjacent / converging models", reasoning: "Where the roadmap may collide with neighbouring categories." },
  ];
  const out = await gen<any[]>({
    model: MODEL_LITE,
    system:
      "Suggest exactly 3 sharp competitive-research directions for this company. " +
      "Return STRICT JSON: an array of {title, reasoning}. reasoning <= 22 words. Output ONLY the array.",
    prompt: JSON.stringify(overview).slice(0, 4000),
    fallback,
  });
  return (Array.isArray(out) ? out : fallback).map((d: any) => ({ t: d.title ?? d.t, r: d.reasoning ?? d.r }));
}

/* 3 - Fencing grid (heavy) */
const FENCE_KEYS =
  "sr, company, product, seg, scaledBeyond, useCase, audience, segD, detailsD, problemD, vpD, " +
  "supplyTG, segS, detailsS, problemS, vpS, prodDesc, prodFeat, tgJourney, supplyJourney, relTG, " +
  "mktg, sales, people, activities, resources, pricing, partners, estRev, segPct, revenue, revHw, " +
  "ppu, qtySold, revSw, earnStation, quantity, totalCost, varCost, varCostU, fixedCost, pl, " +
  "fundStage, raised, valuation, valMult, investors, website";

export async function generateFencing(subject: string, direction: string, overview: any) {
  const rows = await gen<any[]>({
    model: MODEL_HEAVY,
    system:
      `Build a competitive "Fencing" research grid for ${subject}. Surface EVERY notable company solving the ` +
      `same problem, especially those that have SCALED BEYOND ${subject}. Work at the PRODUCT level - a company ` +
      `with multiple products gets multiple rows. Return AT LEAST 15 rows across at least 10 companies as STRICT ` +
      `JSON: an array of objects with these keys: ${FENCE_KEYS}. ` +
      `Rules: 'company' = the company display name; 'product' = the specific product; 'website' = the company's ` +
      `primary domain (e.g. "statiq.in") so we can fetch its real logo/product image; 'seg' and 'segD'/'segS' = ` +
      `'B2B' or 'B2C'; 'scaledBeyond' = true when that company revenue/valuation clearly exceeds ${subject}; ` +
      `'sr' = a string row number starting at "1". Fill financial/funding fields with best-known values or "NA". ` +
      `Keep each text field concise (1-2 sentences). Output ONLY the JSON array.`,
    prompt: `SUBJECT: ${subject}\n\nRESEARCH DIRECTION: ${direction || "all direct and scaled competitors"}\n\nSUBJECT OVERVIEW:\n${JSON.stringify(overview).slice(0, 6000)}`,
    fallback: [] as any[],
  });
  return (Array.isArray(rows) ? rows : []).map((r, i) => ({
    ...r,
    sr: String(r.sr ?? i + 1),
    seg: r.seg ?? r.segD ?? "B2B",
    scaledBeyond: !!r.scaledBeyond,
  }));
}

/* 4 - Business Model Canvas (heavy) */
export async function generateBmc(companyName: string, product: string, data: any) {
  const empty = { kp: [], ka: [], kr: [], vp: [], cr: [], ch: [], cs: [], cost: [], rev: [] };
  return gen({
    model: MODEL_HEAVY,
    system:
      "Build a Business Model Canvas as STRICT JSON with keys kp, ka, kr, vp, cr, ch, cs, cost, rev. " +
      "Each value is an array of {t, src} where t is a concise point and src is a plausible source URL " +
      "(a real company/news/search URL). 2-4 items per block. Output ONLY the JSON object.",
    prompt: `Company: ${companyName}\nProduct: ${product}\nKnown data:\n${JSON.stringify(data).slice(0, 4000)}`,
    fallback: empty,
  });
}

/* 5 - Inspiration timelines (heavy) */
const PHASE_KEYS = "era, product, market, funding, growth, customers";

export async function suggestInspiration(subject: string, overview: any) {
  const out = await gen<any[]>({
    model: MODEL_HEAVY,
    system:
      `Name 2 large, admired companies in ${subject}'s industry that ${subject} could aspire to become - ` +
      `players who ran a comparable 4-5 year journey. For each, return a phased growth timeline. Return STRICT ` +
      `JSON: an array of {who, phases} where phases is an array of {${PHASE_KEYS}} (4 phases, era is a date range). ` +
      `Ground every phase in real, dated facts. Output ONLY the JSON array.`,
    prompt: `SUBJECT: ${subject}\nOVERVIEW: ${JSON.stringify(overview).slice(0, 3000)}`,
    fallback: [] as any[],
  });
  const map: Record<string, any> = {};
  (Array.isArray(out) ? out : []).forEach((c: any) => {
    const slug = String(c.who || "co").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16) || `co${Object.keys(map).length}`;
    map[slug] = { who: c.who, phases: c.phases || [], generated: true };
  });
  return map;
}

export async function generateInspirationFor(companyName: string, subject: string) {
  const fallback = {
    who: companyName, generated: true,
    phases: [
      { era: "Year 1-2", product: `${companyName} launched a focused core product.`, market: "Narrow positioning against one pain.", funding: "Early seed.", growth: "First customers.", customers: "Early adopters." },
      { era: "Year 2-3", product: "Moved up to a service/platform.", market: "Outcome-led positioning.", funding: "First institutional round.", growth: "Multi-market.", customers: "First enterprise accounts." },
      { era: "Year 3-4", product: "Scaled ops + adjacencies.", market: "Category leader.", funding: "Growth round.", growth: "Volume is the metric.", customers: "National operators." },
      { era: "Year 4-5", product: "Became a platform.", market: "Ecosystem play.", funding: "Late-stage.", growth: "Market-defining scale.", customers: "OEM / platform partners." },
    ],
  };
  return gen({
    model: MODEL_HEAVY,
    system:
      `Build a phased growth timeline for ${companyName} as a company ${subject} could take inspiration from. ` +
      `Return STRICT JSON: {who, phases} where phases is an array of {${PHASE_KEYS}} (4 phases). Ground in real, ` +
      `dated facts. Output ONLY the JSON object.`,
    prompt: `Company: ${companyName}\nSubject taking inspiration: ${subject}`,
    fallback,
  });
}

/* 6 - Research Copilot (heavy) */
export type CopilotBlock = { h: string; b: string };

export async function copilotAnswer(input: {
  focusCompany: string; subject: string; history: string; question: string;
}): Promise<CopilotBlock[]> {
  const { focusCompany, subject, history, question } = input;
  const fallback: CopilotBlock[] = [
    { h: "Positioning read", b: `${focusCompany} and ${subject} differ most in where they place their bet. Map each on capital intensity and go-to-market motion to see the real contrast.` },
    { h: "Unit economics", b: `Model the utilisation / cost crossover between the two models - that number decides which wins a given segment.` },
    { h: "Where to press", b: `${subject} should attack the segments ${focusCompany} is structurally slow to serve and lead with that framing.` },
    { h: "Risk & watch-items", b: `Track ${focusCompany}'s R&D and M&A for moves into ${subject}'s wedge; that is the fastest way the advantage erodes.` },
  ];
  return gen<CopilotBlock[]>({
    model: MODEL_HEAVY,
    system:
      `You are the Research Copilot for a consultant analysing ${subject}. Answer the question in depth - not a ` +
      `one-liner - comparing against ${subject} where useful. Return STRICT JSON: an array of {h, b} where h is a ` +
      `short heading and b is 2-4 sentences. Output ONLY the array.`,
    prompt: `FOCUS COMPANY: ${focusCompany}\n\nCONVERSATION SO FAR:\n${history}\n\nQUESTION:\n${question}`,
    fallback,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * v2 additions — Fencing (industry landscape), Scrapling plan, Breakdown.
 * ════════════════════════════════════════════════════════════════════════ */

/** The 46-column decode grid, as [key,label] — single source of truth shared
 *  by the routes, the sheet writer and the front-end. Order matters. */
export const BREAKDOWN_COLUMNS: { key: string; label: string }[] = [
  { key: "sr", label: "Sr. No" },
  { key: "company", label: "Company" },
  { key: "product", label: "Product" },
  { key: "image", label: "Product Image" },
  { key: "useCase", label: "Use Case" },
  { key: "audience", label: "Target Audience (from whom monetisation happens)" },
  { key: "segD", label: "B2C / B2B" },
  { key: "detailsD", label: "Details — demand-side profile" },
  { key: "problemD", label: "Problem Statement" },
  { key: "vpD", label: "Value Proposition" },
  { key: "supplyTG", label: "User / Supply Target Group" },
  { key: "segS", label: "B2C / B2B" },
  { key: "detailsS", label: "Details — supply-side profile" },
  { key: "problemS", label: "Problem Statement" },
  { key: "vpS", label: "Value Proposition" },
  { key: "prodDesc", label: "Product Description" },
  { key: "prodFeat", label: "Product Features" },
  { key: "tgJourney", label: "Target Group Journey (Post Purchase)" },
  { key: "supplyJourney", label: "Supply Target Group Journey" },
  { key: "relTG", label: "Relationship with TG" },
  { key: "mktg", label: "Marketing Channels" },
  { key: "sales", label: "Sales Channels" },
  { key: "people", label: "Key People (Founders / CXOs)" },
  { key: "activities", label: "Key Activities" },
  { key: "resources", label: "Key Resources" },
  { key: "pricing", label: "Pricing" },
  { key: "partners", label: "Key Partners (Outsourced)" },
  { key: "estRev", label: "Est. Company Revenue" },
  { key: "segPct", label: "Segment %" },
  { key: "revenue", label: "Revenue" },
  { key: "revHw", label: "Revenue — Hardware" },
  { key: "ppu", label: "Price / unit" },
  { key: "qtySold", label: "Quantity Sold" },
  { key: "revSw", label: "Revenue — Software" },
  { key: "earnStation", label: "Earnings / Station" },
  { key: "quantity", label: "Quantity" },
  { key: "totalCost", label: "Total Cost" },
  { key: "varCost", label: "Variable Costs" },
  { key: "varCostU", label: "Var. Cost / unit" },
  { key: "fixedCost", label: "Fixed Cost" },
  { key: "pl", label: "Profit / Loss" },
  { key: "fundStage", label: "Funding Stage" },
  { key: "raised", label: "Amount Raised (Cr)" },
  { key: "valuation", label: "Valuation (Cr)" },
  { key: "valMult", label: "Last Val / Revenue" },
  { key: "investors", label: "Investors" },
];

export type LandscapeMetric = { label: string; value: string; note?: string };
export type LandscapeCompany = {
  name: string; website?: string; type?: string; size?: string; hq?: string; note?: string;
};
export type Landscape = {
  summary: string;
  metrics: LandscapeMetric[];
  companies: LandscapeCompany[];
};

/**
 * FENCING (v2) — the industry LANDSCAPE, not the per-company grid.
 * Dynamic, quantified market map + the EXHAUSTIVE list of companies in the
 * space (this is what Prioritize then filters). Fields are not fixed: the
 * metrics returned depend on the industry.
 */
export async function generateLandscape(
  subject: string,
  overview: any,
  evidence?: string,
): Promise<Landscape> {
  const fallback: Landscape = { summary: "", metrics: [], companies: [] };
  const out = await gen<Landscape>({
    model: MODEL_HEAVY,
    system:
      `You are fencing an industry for a strategy consultant researching "${subject}". Produce an INDUSTRY ` +
      `LANDSCAPE as STRICT JSON: { summary, metrics, companies }.\n` +
      `- summary: 2-3 sentences framing the market for a consultant who must become an expert fast.\n` +
      `- metrics: 6-12 QUANTIFIED, industry-appropriate data points as {label, value, note}. Choose the ` +
      `metrics that actually matter for THIS industry (they are NOT fixed) — e.g. number of brands, count of ` +
      `global vs local players, market size, typical price bands, unit volumes, funding concentration. Put ` +
      `numbers in 'value'; 'note' gives basis/qualifier. Use "NA" when genuinely unknown.\n` +
      `- companies: list EVERY notable company in the industry you can (aim for 15-40), as ` +
      `{name, website (primary domain like "statiq.in"), type ("Global" | "Local" | "Regional"), size ` +
      `(e.g. "Large / >100Cr", "Mid", "Early"), hq, note (one line on what they do / why they matter)}. ` +
      `Be exhaustive — do the complete per-company breakdown LATER, here just map the field. ` +
      `Output ONLY the JSON object.`,
    prompt:
      `SUBJECT: ${subject}\n\nSUBJECT OVERVIEW:\n${JSON.stringify(overview).slice(0, 5000)}` +
      (evidence ? `\n\nSCRAPED EVIDENCE:\n${evidence.slice(0, 6000)}` : ""),
    fallback,
  });
  return {
    summary: typeof out?.summary === "string" ? out.summary : "",
    metrics: Array.isArray(out?.metrics) ? out.metrics : [],
    companies: Array.isArray(out?.companies) ? out.companies : [],
  };
}

/**
 * The AI tells Scrapling WHAT TO PULL for a company before the crawl runs.
 * Lightweight, quick model. Returns sub-paths + freeform signals.
 */
export async function whatToScrape(
  company: string, website?: string,
): Promise<{ paths: string[]; wants: string[] }> {
  const fallback = {
    paths: ["about", "products", "product", "solutions", "pricing"],
    wants: ["products & features", "pricing", "target customers", "founders", "traction / funding"],
  };
  const out = await gen<{ paths?: string[]; wants?: string[] }>({
    model: MODEL_LITE,
    system:
      "For the company below, list the website sub-paths and the specific signals a competitor-research " +
      "crawler should pull. Return STRICT JSON: { paths: string[] (relative, e.g. \"pricing\"), " +
      "wants: string[] (signals, e.g. \"unit pricing\") }. Max 6 each. Output ONLY the JSON object.",
    prompt: `Company: ${company}${website ? `\nWebsite: ${website}` : ""}`,
    fallback,
  });
  return {
    paths: Array.isArray(out?.paths) && out.paths.length ? out.paths.slice(0, 6) : fallback.paths,
    wants: Array.isArray(out?.wants) && out.wants.length ? out.wants.slice(0, 6) : fallback.wants,
  };
}

/**
 * BREAKDOWN (v2) — the deep 46-column decode for ONE company, grounded by that
 * company's scraped evidence. A company with several products yields several
 * rows. This is the intensive AI+Scrapling task in the pipeline.
 */
export async function generateBreakdownForCompany(
  subject: string,
  company: string,
  website: string | undefined,
  evidence: string,
): Promise<any[]> {
  const rows = await gen<any[]>({
    model: MODEL_HEAVY,
    system:
      `Build the deep competitive breakdown ("Industry Decoding") for "${company}" — one row PER PRODUCT — as ` +
      `part of research on "${subject}". Return STRICT JSON: an array of objects with these keys: ${FENCE_KEYS}. ` +
      `Ground every field in the SCRAPED EVIDENCE below; prefer figures found there. Rules: 'company' = "${company}"; ` +
      `'product' = the specific product; 'website' = "${website || ""}"; 'seg'/'segD'/'segS' = 'B2B' or 'B2C'; ` +
      `'scaledBeyond' = true if this company clearly out-scales ${subject}; 'sr' = a string row number starting "1". ` +
      `Financial/funding fields = best-known value or "NA" (never invent precision). Keep text fields to 1-2 ` +
      `sentences. Output ONLY the JSON array.`,
    prompt:
      `SUBJECT: ${subject}\nCOMPANY: ${company}\nWEBSITE: ${website || "unknown"}\n\nSCRAPED EVIDENCE:\n` +
      `${(evidence || "(no live evidence — use best public knowledge)").slice(0, 9000)}`,
    fallback: [] as any[],
  });
  return (Array.isArray(rows) ? rows : []).map((r, i) => ({
    ...r,
    sr: String(r.sr ?? i + 1),
    company: r.company || company,
    seg: r.seg ?? r.segD ?? "B2B",
    scaledBeyond: !!r.scaledBeyond,
  }));
}
