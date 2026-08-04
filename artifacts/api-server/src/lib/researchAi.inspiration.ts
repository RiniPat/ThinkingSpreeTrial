/**
 * Inspiration engine for the Research workspace (consultant-only).
 *
 * recommendSimilarCompanies() returns TWO segments of real companies:
 *   • peers      — same problem / target / revenue band, but one level up
 *                  (slightly ahead so there's a playbook to copy).
 *   • nextLevel  — same space, scaled 5–10× the client on all terms; the
 *                  aspirational journey to learn from.
 *   Each company carries QUANTIFIABLE metrics (revenue, team size, funding,
 *   growth) and a multi-parameter match breakdown (not a single number).
 *
 * generateInspirationRoadmap() returns a phased TIMELINE (growth-phase table):
 *   Timeline · Product & capability · Marketing & positioning ·
 *   Funding & investment · Quantified growth · Key customers / partners —
 *   plus a quantifiable snapshot and a multi-parameter match breakdown.
 *   Every value is sourced or explicitly "Not publicly disclosed".
 *
 * Grounding: uses Google Search (tools:[{ googleSearch: {} }]) on
 * gemini-2.5-flash when the SDK supports it, and DEGRADES GRACEFULLY to an
 * ungrounded generation (no live citations) if the tool call throws — so a
 * roadmap always generates. Two passes because grounding can't be combined
 * with responseMimeType:"application/json". No extra dependency.
 */

import { getModel, MODEL_STANDARD, stripJsonFences } from "./aiClient";

const MODEL = MODEL_STANDARD;

// ──────────────────────── Types (mirrored on the client) ──────────────────
export type Segment = "peer" | "next_level";

export interface InspirationSource { id: number; title: string; url: string }
export interface SourcedValue { value: string; disclosed: boolean; sourceId?: number }
export interface MatchParam { parameter: string; score: number } // 0-100

export interface CompanyMetric { label: string; value: string; disclosed: boolean }

export interface CompanyRecommendation {
  name: string;
  oneLiner: string;                 // <= 12 words
  hqCountry: string;
  foundedYear: string;
  segment: Segment;
  metrics: CompanyMetric[];         // Revenue, Team size, Funding, Growth …
  matchOverall: number;             // 0-100
  matchBreakdown: MatchParam[];     // per-parameter
}

export interface InspirationRecommendInput {
  companyName: string; industry: string; specialization: string;
  stage: string; revenueStage: string; geography?: string; sheetContext?: string;
}
export interface InspirationRecommendOutput {
  peers: CompanyRecommendation[];
  nextLevel: CompanyRecommendation[];
  sources: InspirationSource[];
}

export interface InspirationRoadmapInput {
  clientCompany: string; inspirationCompany: string; industry: string;
  specialization: string; stage: string; revenueStage: string;
  geography?: string; sheetContext?: string;
}
export interface RoadmapPhase {
  timeline: string;    // "1995–2000: Category entry"
  product: string;     // Product & capability evolution
  marketing: string;   // Marketing & positioning
  funding: string;     // Funding & investment
  growth: string;      // Quantified growth indicators
  customers: string;   // Key customers / partners
  sourceIds?: number[];
}
export interface InspirationRoadmapOutput {
  company: string;
  matchOverall: number;
  matchBreakdown: MatchParam[];
  snapshot: {
    foundedYear: SourcedValue;
    hq: SourcedValue;
    totalFunding: SourcedValue;
    latestRevenue: SourcedValue;
    teamSize: SourcedValue;
    growth: SourcedValue;
  };
  phases: RoadmapPhase[];
  sources: InspirationSource[];
}

// ──────────────────────── Shared helpers ──────────────────────────────────
async function runJsonPrompt<T>(prompt: string, temperature = 0.35): Promise<T> {
  const model = getModel({
    model: MODEL,
    generationConfig: { temperature, responseMimeType: "application/json" },
  });
  const result = await model.generateContent(prompt);
  const cleaned = stripJsonFences(result.response.text());
  try { return JSON.parse(cleaned) as T; }
  catch { throw new Error(`Gemini returned non-JSON. First 300 chars: ${cleaned.slice(0, 300)}`); }
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

/**
 * Grounded gather with graceful fallback. Tries Google Search grounding; if
 * the SDK/tool rejects it (or any error), falls back to an ungrounded text
 * generation with no citations. Always resolves — never throws — so callers
 * can rely on getting research text back.
 */
async function gather(prompt: string, temperature = 0.5): Promise<{ text: string; sources: InspirationSource[] }> {
  try {
    const model = getModel({
      model: MODEL,
      generationConfig: { temperature },
      tools: [{ googleSearch: {} } as any],
    } as any);
    const result = await model.generateContent(prompt);
    const resp = result.response;
    const text = resp.text();
    const chunks = (resp as any)?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const seen = new Set<string>();
    const sources: InspirationSource[] = [];
    for (const c of chunks) {
      const web = c?.web;
      if (!web?.uri || seen.has(web.uri)) continue;
      seen.add(web.uri);
      sources.push({ id: sources.length + 1, title: web.title || hostOf(web.uri), url: web.uri });
    }
    if (!text?.trim()) throw new Error("empty grounded response");
    return { text, sources };
  } catch {
    // Fallback: ungrounded generation, no live citations.
    const model = getModel({ model: MODEL, generationConfig: { temperature } });
    const result = await model.generateContent(
      prompt + "\n\n(Note: cite the specific public source by name inline where you can; if a fact isn't reliably known, say \"Not publicly disclosed\".)",
    );
    return { text: result.response.text(), sources: [] };
  }
}

// ──────────────────────── Recommendations (2 segments) ────────────────────
export async function recommendSimilarCompanies(
  input: InspirationRecommendInput,
): Promise<InspirationRecommendOutput> {
  const sheet = input.sheetContext
    ? `\nCLIENT THINKING-SHEET CONTEXT (verbatim extract, may be noisy):\n"""\n${input.sheetContext.slice(0, 6000)}\n"""\n`
    : "";

  const gatherPrompt = `You are a senior growth strategist. For the CLIENT below, find REAL, currently-operating companies in TWO buckets so a consultant can study proven playbooks.

CLIENT: ${input.companyName}
INDUSTRY: ${input.industry}
SPECIALIZATION: ${input.specialization}
BUSINESS STAGE: ${input.stage}
REVENUE STAGE: ${input.revenueStage}
GEOGRAPHY: ${input.geography ?? "India-first, then global"}
${sheet}
BUCKET 1 — PEERS (one level up): same problem statement, same target customer, similar revenue band, but slightly AHEAD of the client (a level the client can reach next). 3-4 companies.
BUCKET 2 — NEXT LEVEL (5-10x): the same space but scaled to roughly 5x-10x the client on revenue/team/reach — the aspirational journey. 3-4 companies.

For EACH company, gather QUANTIFIABLE, source-backed data: latest revenue (with year), team/headcount size, total funding raised, growth rate (e.g. YoY), founded year, HQ. Prefer credible sources (filings/MCA/Tofler for India, Crunchbase, reputable press). If a figure isn't public, say so — never invent numbers.
Also judge how well the CLIENT matches each company on: Revenue, Growth, Target market, Problem-solution fit, Business model — each 0-100, honestly.`;

  const { text: gathered, sources } = await gather(gatherPrompt, 0.55);

  const structurePrompt = `Convert the research into strict JSON. Do NOT invent companies not present in the research. Metrics must be quantifiable short strings (e.g. "₹120 Cr FY23", "~450", "$40M", "3x YoY"); if unknown set value "N/D" and disclosed:false. matchBreakdown scores are 0-100 and honest; matchOverall is the weighted overall (0-100).

RESEARCH:
"""
${gathered}
"""

Return JSON ONLY:
{
  "peers": [
    {
      "name": "Real company", "oneLiner": "<= 12 words", "hqCountry": "India", "foundedYear": "2016",
      "segment": "peer",
      "metrics": [
        { "label": "Revenue", "value": "₹120 Cr FY23", "disclosed": true },
        { "label": "Team size", "value": "~450", "disclosed": true },
        { "label": "Funding", "value": "$40M", "disclosed": true },
        { "label": "Growth", "value": "3x YoY", "disclosed": true }
      ],
      "matchOverall": 0-100,
      "matchBreakdown": [
        { "parameter": "Revenue", "score": 0-100 },
        { "parameter": "Growth", "score": 0-100 },
        { "parameter": "Target market", "score": 0-100 },
        { "parameter": "Problem-solution", "score": 0-100 },
        { "parameter": "Business model", "score": 0-100 }
      ]
    }
  ],
  "nextLevel": [ { "...": "same shape, segment: \\"next_level\\"" } ]
}

3-4 entries per bucket, each with the same 4 metric labels (Revenue, Team size, Funding, Growth) and the same 5 match parameters. Sort each bucket by matchOverall descending.`;

  const structured = await runJsonPrompt<{ peers: CompanyRecommendation[]; nextLevel: CompanyRecommendation[] }>(structurePrompt, 0.2);
  const sortByMatch = (a: CompanyRecommendation, b: CompanyRecommendation) => (b.matchOverall ?? 0) - (a.matchOverall ?? 0);
  return {
    peers: (structured.peers ?? []).map((p) => ({ ...p, segment: "peer" as const })).sort(sortByMatch),
    nextLevel: (structured.nextLevel ?? []).map((p) => ({ ...p, segment: "next_level" as const })).sort(sortByMatch),
    sources,
  };
}

// ──────────────────────── Roadmap (phased timeline) ───────────────────────
export async function generateInspirationRoadmap(
  input: InspirationRoadmapInput,
): Promise<InspirationRoadmapOutput> {
  const sheet = input.sheetContext
    ? `\nCLIENT CONTEXT (from their Thinking Sheet):\n"""\n${input.sheetContext.slice(0, 6000)}\n"""\n`
    : "";

  const gatherPrompt = `You are a McKinsey/BCG-grade analyst. Build a chronological GROWTH-PHASE HISTORY of the company below, so a consultant can extract a repeatable playbook for their client.

INSPIRATION COMPANY: ${input.inspirationCompany}
(Analogue for the client "${input.clientCompany}" in ${input.industry} / ${input.specialization}, stage ${input.stage}, revenue stage ${input.revenueStage}.)
${sheet}
Break the company's journey into 4-7 sequential PHASES. For each phase report, with specific public sources:
- Timeline & growth-phase name (e.g. "1995–2000: Category entry and validation")
- Product & capability development in that phase
- Marketing & market positioning in that phase
- Funding & investment in that phase
- Quantified growth indicators (revenue, headcount, units, geographies — real numbers)
- Key customers / partners documented in that phase

Also gather an overall snapshot: founded year, HQ, total funding raised, latest revenue (with year), current team size, and headline growth. And judge how transferable this company's playbook is to the client on: Revenue, Growth, Target market, Problem-solution, Business model (each 0-100).

CRITICAL: No vague approximation. Give the specific figure with its source, or state "Not publicly disclosed". Never guess a number.`;

  const { text: brief, sources } = await gather(gatherPrompt, 0.45);
  const sourceList = sources.length
    ? sources.map((s) => `[${s.id}] ${s.title} — ${s.url}`).join("\n")
    : "(No grounded sources; mark uncertain items as not disclosed and leave sourceIds empty.)";

  const structurePrompt = `Turn the growth-phase brief into strict JSON. Rules:
- Each phase field is a concise, information-dense sentence or two (this renders as a timeline table). Put real numbers in "growth".
- Snapshot values: give the figure + set disclosed:true + sourceId, OR disclosed:false with value "Not publicly disclosed". Never fabricate.
- matchBreakdown: 5 parameters, 0-100 each; matchOverall is the honest weighted overall.
- sourceIds on each phase point at the numbered sources that back it (may be empty).

NUMBERED SOURCES:
${sourceList}

BRIEF:
"""
${brief}
"""

Return JSON ONLY:
{
  "company": "${input.inspirationCompany}",
  "matchOverall": 0-100,
  "matchBreakdown": [
    { "parameter": "Revenue", "score": 0-100 },
    { "parameter": "Growth", "score": 0-100 },
    { "parameter": "Target market", "score": 0-100 },
    { "parameter": "Problem-solution", "score": 0-100 },
    { "parameter": "Business model", "score": 0-100 }
  ],
  "snapshot": {
    "foundedYear": { "value": "1995", "disclosed": true, "sourceId": 1 },
    "hq": { "value": "City, Country", "disclosed": true, "sourceId": 1 },
    "totalFunding": { "value": "$157M", "disclosed": true, "sourceId": 2 },
    "latestRevenue": { "value": "₹2,800 Cr FY24", "disclosed": true, "sourceId": 3 },
    "teamSize": { "value": "~1,200", "disclosed": true, "sourceId": 1 },
    "growth": { "value": "3x over FY22-24", "disclosed": true, "sourceId": 3 }
  },
  "phases": [
    { "timeline": "1995–2000: Category entry", "product": "...", "marketing": "...", "funding": "...", "growth": "real numbers", "customers": "...", "sourceIds": [1,2] }
  ],
  "sources": []
}

Leave "sources" as [] (added server-side). 4-7 phases in chronological order.`;

  const structured = await runJsonPrompt<Omit<InspirationRoadmapOutput, "sources">>(structurePrompt, 0.3);
  return { ...structured, sources };
}
