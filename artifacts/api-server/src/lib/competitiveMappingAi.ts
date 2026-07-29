/**
 * Competitive Mapping AI helpers — generates real research for ANY company.
 *
 * Model routing:
 *   light tasks  -> gemini-3.5-flash-lite   (directions)
 *   heavy tasks  -> gemini-3.5-flash        (overview, fencing, BMC, inspiration, copilot)
 *   (swap MODEL_HEAVY to "gemini-3.6-flash" to upgrade quality + cost)
 *
 * Uses the suite's existing @google/generative-ai SDK. Every generator returns
 * strict JSON in the exact shape the front-end renders, and falls back to a
 * safe stub if the key is missing or the model misbehaves, so the UI never
 * hard-fails.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";

export const MODEL_LITE = "gemini-3.5-flash-lite";
export const MODEL_HEAVY = "gemini-3.5-flash";

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

async function gen<T>(opts: { model: string; system: string; prompt: string; fallback: T }): Promise<T> {
  if (!isConfigured()) return opts.fallback;
  try {
    const m = getModel(opts.model);
    const res = await m.generateContent(`${opts.system}\n\n${opts.prompt}`);
    const out = parseJson<T | null>(res.response.text(), null as any);
    return (out ?? opts.fallback) as T;
  } catch (e) {
    console.warn("[competitiveMappingAi] generation failed, using fallback:", (e as Error).message);
    return opts.fallback;
  }
}

/* 1 - Company Overview */
export async function generateOverview(companyName: string, website?: string) {
  const fallback = {
    name: companyName, tagline: `Research profile for ${companyName}.`,
    website: website || "", founded: "-", hq: "-", stage: "-",
    growth: [] as any[], metrics: [] as any[], products: [] as any[],
  };
  return gen({
    model: MODEL_HEAVY,
    system:
      "You are a startup research analyst. Produce a factual company overview as STRICT JSON with keys: " +
      "name, tagline, website, founded, hq, stage, " +
      "growth (array of {y, rev} - 4-6 points, y is a period label, rev is a NUMBER for revenue/ARR), " +
      "metrics (array of {label, value, note} - 4 key traction metrics), " +
      "products (array of {name, rev, seg, problem, uses[]} - seg is 'B2B' or 'B2C', uses is 2-3 short strings). " +
      "Use real, known facts; where a figure is unknown use a reasonable placeholder like '-'. Output ONLY the JSON object.",
    prompt: `Company: ${companyName}${website ? `\nWebsite: ${website}` : ""}`,
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
  "fundStage, raised, valuation, valMult, investors";

export async function generateFencing(subject: string, direction: string, overview: any) {
  const rows = await gen<any[]>({
    model: MODEL_HEAVY,
    system:
      `Build a competitive "Fencing" research grid for ${subject}. Surface EVERY notable company solving the ` +
      `same problem, especially those that have SCALED BEYOND ${subject}. Work at the PRODUCT level - a company ` +
      `with multiple products gets multiple rows. Return AT LEAST 15 rows across at least 10 companies as STRICT ` +
      `JSON: an array of objects with these keys: ${FENCE_KEYS}. ` +
      `Rules: 'company' = the company display name; 'product' = the specific product; 'seg' and 'segD'/'segS' = ` +
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
