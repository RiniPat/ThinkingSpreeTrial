/**
 * Inspiration engine for the Research workspace (consultant-only).
 *
 * Two operations:
 *   1. recommendSimilarCompanies() — closest REAL, currently-operating
 *      comparables for a client, based on stage / revenue / industry /
 *      specialization (+ optional Thinking-Sheet context). Grounded so the
 *      names are real, not invented.
 *   2. generateInspirationRoadmap() — McKinsey-grade deep dive on ONE chosen
 *      company across Product, Marketing, Sales Channels, Funding Raised,
 *      Revenue Generated, Market research & potential. Every data point
 *      carries a public source OR is explicitly "Not publicly disclosed".
 *      Plus a phased roadmap the consultant translates to the client.
 *
 * Grounding note: Gemini won't allow the googleSearch tool together with
 * responseMimeType:"application/json". So the roadmap runs in two passes —
 * pass 1 grounded (free text + real citation URLs), pass 2 strict JSON that
 * structures pass 1. Same plumbing as researchAi.ts (GEMINI_API_KEY,
 * gemini-2.5-flash). No extra dependency: @google/generative-ai is already
 * installed.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

const MODEL = "gemini-2.5-flash";

// ──────────────────────── Types (also imported by the client mirror) ──────
export type BusinessStage =
  | "Ideation" | "MVP" | "MVP → PMF" | "PMF" | "PMF → GTM" | "Scaling";
export type RevenueStage =
  | "Pre-revenue" | "First revenue" | "< ₹1 Cr ARR"
  | "₹1–10 Cr ARR" | "₹10–50 Cr ARR" | "₹50 Cr+ ARR";

export interface InspirationSource { id: number; title: string; url: string }
export interface SourcedValue { value: string; disclosed: boolean; sourceId?: number }

export interface InspirationRecommendInput {
  companyName: string;
  industry: string;
  specialization: string;
  stage: BusinessStage;
  revenueStage: RevenueStage;
  geography?: string;
  sheetContext?: string;
}
export interface CompanyRecommendation {
  name: string; oneLiner: string; whySimilar: string; matchScore: number;
  industry: string; specialization: string; stage: string; hqCountry: string;
}
export interface InspirationRecommendOutput {
  recommendations: CompanyRecommendation[];
  sources: InspirationSource[];
}

export interface InspirationRoadmapInput {
  clientCompany: string;
  inspirationCompany: string;
  industry: string;
  specialization: string;
  stage: BusinessStage;
  revenueStage: RevenueStage;
  geography?: string;
  sheetContext?: string;
}
export type DimensionKey =
  | "product" | "marketing" | "sales" | "funding" | "revenue" | "market";
export interface InspirationDimension {
  key: DimensionKey;
  label: string;
  summary: string;
  dataPoints: Array<{ label: string; value: string; disclosed: boolean; sourceId?: number }>;
}
export interface RoadmapPhase { phase: string; title: string; body: string }
export interface InspirationRoadmapOutput {
  company: string;
  matchScore: number;
  snapshot: {
    foundedYear: SourcedValue; hq: SourcedValue;
    totalFunding: SourcedValue; revenue: SourcedValue;
  };
  roadmap: RoadmapPhase[];
  dimensions: InspirationDimension[];
  sources: InspirationSource[];
}

// ──────────────────────── Shared helpers ──────────────────────────────────
function client() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured on the server.");
  return new GoogleGenerativeAI(apiKey);
}

/** Strict-JSON pass (no tools). Mirrors runJsonPrompt in researchAi.ts. */
async function runJsonPrompt<T>(prompt: string, temperature = 0.4): Promise<T> {
  const model = client().getGenerativeModel({
    model: MODEL,
    generationConfig: { temperature, responseMimeType: "application/json" },
  });
  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error(`Gemini returned non-JSON. First 300 chars: ${cleaned.slice(0, 300)}`);
  }
}

/**
 * Grounded pass — Google Search enabled. Returns prose + the real web sources
 * grounded on (deduped by URL). Tool shape follows the 2.5 grounding API:
 * tools:[{ googleSearch: {} }]. Cast to any because the 0.21.x type defs
 * predate the googleSearch tool. If a future SDK rejects this, swap to
 * @google/genai — the calling code is unchanged.
 */
async function runGroundedPrompt(
  prompt: string,
  temperature = 0.5,
): Promise<{ text: string; sources: InspirationSource[] }> {
  const model = client().getGenerativeModel({
    model: MODEL,
    generationConfig: { temperature },
    tools: [{ googleSearch: {} } as any],
  } as any);

  const result = await model.generateContent(prompt);
  const resp = result.response;
  const text = resp.text();

  const chunks =
    (resp as any)?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const seen = new Set<string>();
  const sources: InspirationSource[] = [];
  for (const c of chunks) {
    const web = c?.web;
    if (!web?.uri || seen.has(web.uri)) continue;
    seen.add(web.uri);
    sources.push({ id: sources.length + 1, title: web.title || hostOf(web.uri), url: web.uri });
  }
  return { text, sources };
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

// ──────────────────────── Recommendations ─────────────────────────────────
export async function recommendSimilarCompanies(
  input: InspirationRecommendInput,
): Promise<InspirationRecommendOutput> {
  const sheet = input.sheetContext
    ? `\nCLIENT THINKING-SHEET CONTEXT (verbatim extract, may be noisy):\n"""\n${input.sheetContext.slice(0, 6000)}\n"""\n`
    : "";

  const gatherPrompt = `You are a senior growth strategist at a boutique consulting firm. A CLIENT startup needs "inspiration" companies — real, currently-operating businesses whose journey is as CLOSE as possible to the client's, so the consultant can study a proven playbook.

CLIENT: ${input.companyName}
INDUSTRY: ${input.industry}
SPECIALIZATION: ${input.specialization}
BUSINESS STAGE: ${input.stage}
REVENUE STAGE: ${input.revenueStage}
GEOGRAPHY FOCUS: ${input.geography ?? "India-first, then global"}
${sheet}
Find 4-6 REAL comparable companies. Prioritise closeness on: business model, specialization, customer type, and stage — not just broad industry. Prefer companies with public information (funding, press, filings) so a deep dive is possible later. Indian / India-relevant companies first where a good match exists, then global analogues.

For each, note the real company name, a one-line description, why it is a close analogue to THIS client, its rough stage, and HQ country. Cite where you found each. Be honest — if a match is only loose, say so and score it lower.`;

  const { text: gathered, sources } = await runGroundedPrompt(gatherPrompt, 0.55);

  const structurePrompt = `Convert the research below into strict JSON. Do NOT invent companies that are not in the research. Keep matchScore honest (0-100): 90+ = near-identical model & stage, 70-89 = strong analogue, <70 = directional only.

RESEARCH:
"""
${gathered}
"""

Return JSON ONLY:
{
  "recommendations": [
    { "name": "Real company", "oneLiner": "<= 14 words", "whySimilar": "1-2 sentences tying it to the client's model/stage", "matchScore": 0-100, "industry": "...", "specialization": "...", "stage": "e.g. Series B, bootstrapped, PMF→GTM", "hqCountry": "e.g. India" }
  ]
}

Sort by matchScore descending. 4-6 entries.`;

  const structured = await runJsonPrompt<{ recommendations: CompanyRecommendation[] }>(structurePrompt, 0.2);

  return {
    recommendations: (structured.recommendations ?? []).sort((a, b) => b.matchScore - a.matchScore),
    sources,
  };
}

// ──────────────────────── Roadmap (deep dive) ─────────────────────────────
export async function generateInspirationRoadmap(
  input: InspirationRoadmapInput,
): Promise<InspirationRoadmapOutput> {
  const sheet = input.sheetContext
    ? `\nCLIENT CONTEXT (from their Thinking Sheet — tailor the roadmap to this):\n"""\n${input.sheetContext.slice(0, 6000)}\n"""\n`
    : "";

  // ── Pass 1: grounded research brief ──────────────────────────────────────
  const gatherPrompt = `You are a McKinsey/BCG-grade analyst. Produce a rigorous, source-backed research brief on the company below, so a consultant can extract a repeatable playbook for their client.

INSPIRATION COMPANY: ${input.inspirationCompany}
(Studied as an analogue for the client "${input.clientCompany}" in ${input.industry} / ${input.specialization}, at stage ${input.stage}, revenue stage ${input.revenueStage}.)
${sheet}
Research and report, with a specific public source for every factual claim, on:
1. PRODUCT — what they actually sell, how it evolved, the key wedge.
2. MARKETING — channels, positioning, brand motion that worked.
3. SALES CHANNELS — how they distribute and close (D2C, partnerships, field, marketplace).
4. FUNDING RAISED — total, rounds, notable investors, latest valuation if public.
5. REVENUE GENERATED — latest reported/estimated revenue and growth; cite filings (MCA/Tofler for India) or credible press.
6. MARKET RESEARCH & POTENTIAL — TAM/segment size, tailwinds, headwinds, whitespace.
Also: founded year, HQ.

CRITICAL RULES:
- No vague approximation. Give the specific figure with its source, OR state plainly "Not publicly disclosed". Never guess a number.
- Prefer primary/credible sources: company site, regulatory filings, Crunchbase, reputable press.
- Cite inline (mention the source name) as you go.`;

  const { text: brief, sources } = await runGroundedPrompt(gatherPrompt, 0.45);

  const sourceList = sources.length
    ? sources.map((s) => `[${s.id}] ${s.title} — ${s.url}`).join("\n")
    : "(No grounded sources returned; mark uncertain items as not disclosed.)";

  // ── Pass 2: structure into typed JSON ────────────────────────────────────
  const structurePrompt = `Turn the research brief into the strict JSON shape below. Rules:
- For every dataPoint, either give the concrete value with "disclosed": true and a "sourceId" pointing at the numbered sources, OR set "disclosed": false and value "Not publicly disclosed".
- Never fabricate a figure. If the brief doesn't support it, mark it not disclosed.
- The roadmap must translate the company's moves into 3-4 sequenced phases the CLIENT ("${input.clientCompany}") can act on.
- matchScore (0-100): how transferable this company's playbook is to the client.

NUMBERED SOURCES:
${sourceList}

RESEARCH BRIEF:
"""
${brief}
"""

Return JSON ONLY:
{
  "company": "${input.inspirationCompany}",
  "matchScore": 0-100,
  "snapshot": {
    "foundedYear": { "value": "e.g. 2012", "disclosed": true, "sourceId": 1 },
    "hq": { "value": "City, Country", "disclosed": true, "sourceId": 1 },
    "totalFunding": { "value": "e.g. $157M", "disclosed": true, "sourceId": 2 },
    "revenue": { "value": "e.g. ₹2,800 Cr FY24", "disclosed": true, "sourceId": 3 }
  },
  "roadmap": [ { "phase": "Phase 1", "title": "<= 8 words", "body": "2-3 sentences, tailored to the client" } ],
  "dimensions": [
    { "key": "product|marketing|sales|funding|revenue|market", "label": "Product",
      "summary": "1-2 sentence takeaway",
      "dataPoints": [ { "label": "e.g. Core product", "value": "...", "disclosed": true, "sourceId": 1 } ] }
  ]
}

Include all six dimensions in that order. Each dimension: 2-4 dataPoints.`;

  const structured = await runJsonPrompt<Omit<InspirationRoadmapOutput, "sources">>(structurePrompt, 0.3);

  return { ...structured, sources };
}
