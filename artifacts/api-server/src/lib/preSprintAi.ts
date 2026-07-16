/**
 * AI generators for the Pre-Sprint workspace.
 *
 * Design notes
 * ────────────
 * • Company-SPECIFIC facts (segments, pricing, product) come from the uploaded
 *   deck + website — authentic by construction. These run UNGROUNDED and are
 *   told to only use the supplied material and mark gaps as "Not stated".
 * • MARKET-facing claims (blue/red ocean, demand, sizing) run GROUNDED via
 *   Google Search so every claim carries a real, clickable source. Market
 *   SIZE is returned as a RANGE + method + a `verify:true` flag — LLMs are
 *   unreliable at precise TAM/SAM/SOM, so we never present false precision.
 * • Grounding can't be combined with responseMimeType:"application/json", so
 *   market generators use two passes: grounded gather → structure to JSON.
 *   Mirrors the existing researchAi.inspiration.ts pattern. Degrades to an
 *   ungrounded pass (sources:[]) if the grounding tool call throws.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

const MODEL = "gemini-2.5-flash";

// State/UT names MUST match the GeoJSON `NAME_1` property so the choropleth can
// join on them. This is the canonical list from india-states.geojson.
export const INDIA_STATES = [
  "Andaman and Nicobar", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar",
  "Chandigarh", "Chhattisgarh", "Dadra and Nagar Haveli", "Daman and Diu", "Delhi",
  "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand",
  "Karnataka", "Kerala", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur",
  "Meghalaya", "Mizoram", "Nagaland", "Orissa", "Puducherry", "Punjab", "Rajasthan",
  "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttaranchal",
  "West Bengal",
] as const;

// ──────────────────────── Shared types ────────────────────────────────────
export interface Source { id: number; title: string; url: string }

export interface CompanyProfile {
  companyName: string;
  industry: string;
  businessStage: string;
  specialization: string;
  productDescription: string;
  revenueStage: string;
  geography: string;
}

// ──────────────────────── Shared helpers ──────────────────────────────────
function client() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured on the server.");
  return new GoogleGenerativeAI(apiKey);
}

async function runJson<T>(prompt: string, temperature = 0.4): Promise<T> {
  const model = client().getGenerativeModel({
    model: MODEL,
    generationConfig: { temperature, responseMimeType: "application/json" },
  });
  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(cleaned) as T; }
  catch { throw new Error(`Gemini returned non-JSON. First 300 chars: ${cleaned.slice(0, 300)}`); }
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

/** Grounded gather with graceful fallback (mirrors researchAi.inspiration). */
async function gather(prompt: string, temperature = 0.5): Promise<{ text: string; sources: Source[] }> {
  try {
    const model = client().getGenerativeModel({
      model: MODEL,
      generationConfig: { temperature },
      tools: [{ googleSearch: {} } as any],
    } as any);
    const result = await model.generateContent(prompt);
    const resp = result.response;
    const text = resp.text();
    const chunks = (resp as any)?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const seen = new Set<string>();
    const sources: Source[] = [];
    for (const c of chunks) {
      const web = c?.web;
      if (!web?.uri || seen.has(web.uri)) continue;
      seen.add(web.uri);
      sources.push({ id: sources.length + 1, title: web.title || hostOf(web.uri), url: web.uri });
    }
    if (!text?.trim()) throw new Error("empty grounded response");
    return { text, sources };
  } catch {
    const model = client().getGenerativeModel({ model: MODEL, generationConfig: { temperature } });
    const result = await model.generateContent(
      prompt + '\n\n(Note: name the specific public source inline where you can; if a fact is not reliably known, say "Not publicly disclosed" — never invent figures.)',
    );
    return { text: result.response.text(), sources: [] };
  }
}

function profileBlock(p: CompanyProfile): string {
  return `COMPANY: ${p.companyName}
INDUSTRY: ${p.industry}
SPECIALIZATION: ${p.specialization}
BUSINESS STAGE: ${p.businessStage}
REVENUE STAGE: ${p.revenueStage}
GEOGRAPHY: ${p.geography || "India-first"}
PRODUCT: ${p.productDescription}`;
}

// ═══════════════════ 1) Extract profile from deck + website ════════════════
// Ungrounded — reads ONLY the supplied material so the auto-fill is faithful.
export interface ExtractInput { deckText: string; websiteText?: string }
export async function extractCompanyProfile(input: ExtractInput): Promise<CompanyProfile> {
  const deck = (input.deckText || "").slice(0, 24000);
  const site = (input.websiteText || "").slice(0, 12000);
  const prompt = `You are reading a startup's pitch deck (and website, if present) to pre-fill an intake form. Use ONLY what is stated or clearly implied by the material below. Do NOT invent facts. If something is not stated, return an empty string for that field.

=== PITCH DECK (extracted text) ===
"""${deck}"""

${site ? `=== WEBSITE (extracted text) ===\n"""${site}"""\n` : ""}
Return JSON ONLY:
{
  "companyName": "",
  "industry": "",
  "businessStage": "e.g. Idea / MVP / Early revenue / Growth",
  "specialization": "one line — the specific niche",
  "productDescription": "2-3 sentences, plain language",
  "revenueStage": "e.g. Pre-revenue / <₹50L ARR / ₹1-5Cr ARR (only if stated)",
  "geography": "primary markets if stated"
}`;
  return runJson<CompanyProfile>(prompt, 0.2);
}

// ═══════════════════ 2) Company Overview (snapshot) ════════════════════════
// Ungrounded — a scannable read of the company from its own material.
export interface AudienceLevel {
  level: string;   // e.g. "Total market", "Segment", "ICP", "Beachhead"
  who: string;     // short label of who this is
  detail: string;  // <= 12 words
  size?: string;   // optional rough size, e.g. "~2.4M firms"
}
export interface SocialStat { platform: string; metric: string }
export interface OverviewOutput {
  snapshot: string;               // <= 2 short sentences
  offerings: string[];            // <= 5 short phrases
  audienceFunnel: AudienceLevel[];// top-down: broadest → narrowest (4-5 levels)
  customerSegments: string[];
  pricing: string;                // short
  geography: string[];
  revenue: string;                // short
  traction: {
    customers?: string;           // e.g. "120 paying · 40 logos"
    growth?: string;              // e.g. "8% MoM"
    social?: SocialStat[];        // platform + metric
    partnerships?: string[];
    highlights?: string[];        // other notable proof points
  };
  edge: string;                   // one line
  gaps: string[];                 // what the deck did NOT make clear
}
export async function generateCompanyOverview(p: CompanyProfile, deckText: string): Promise<OverviewOutput> {
  const prompt = `You are a consultant writing a pre-sprint brief. Output must be SCANNABLE, not wordy — short phrases, no paragraphs. Every string stays under ~14 words. Use the profile + deck; if the material is silent on something, use "Not stated" (for traction) or add it to "gaps" — never invent.

${profileBlock(p)}

=== DECK TEXT (may be noisy) ===
"""${(deckText || "").slice(0, 20000)}"""

Build a TOP-DOWN AUDIENCE FUNNEL (4-5 levels) from the broadest possible market down to the narrowest beachhead the company should win first — so a founder can SEE how the total market narrows to their ICP. Each level: a short "who", a <=12-word "detail", and a rough "size" if inferable.

Pull TRACTION signals from the deck: customers/logos onboarded, growth rate, social-media following/engagement, partnerships, other proof points. Use "Not stated" for any that aren't in the material.

Return JSON ONLY:
{
  "snapshot": "<= 2 short sentences",
  "offerings": ["<= 5 short phrases"],
  "audienceFunnel": [
    { "level": "Total market", "who": "", "detail": "", "size": "" },
    { "level": "Segment", "who": "", "detail": "", "size": "" },
    { "level": "ICP", "who": "", "detail": "", "size": "" },
    { "level": "Beachhead", "who": "", "detail": "", "size": "" }
  ],
  "customerSegments": ["distinct segments"],
  "pricing": "short, or 'Not stated'",
  "geography": ["markets"],
  "revenue": "short signal, or 'Not stated'",
  "traction": {
    "customers": "e.g. '120 paying · 40 logos' or 'Not stated'",
    "growth": "e.g. '8% MoM' or 'Not stated'",
    "social": [ { "platform": "LinkedIn", "metric": "12k followers" } ],
    "partnerships": ["names"],
    "highlights": ["short proof points"]
  },
  "edge": "one line",
  "gaps": ["short items to confirm with the founder"]
}`;
  return runJson<OverviewOutput>(prompt, 0.3);
}

// ═══════════════════ 2b) ICP personas + real target accounts (GROUNDED) ════
export interface IcpPersona {
  title: string;          // buyer/user job title
  seniority: string;      // e.g. "Head / Director"
  segment: string;        // which segment they sit in
  painPoints: string[];   // <= 3 short
  goals: string[];        // <= 3 short
  channels: string[];     // where to reach them
}
export interface TargetAccount {
  company: string;
  whyFit: string;         // one line
  website?: string;
  linkedinUrl?: string;   // ONLY if found in a real source (never fabricated)
  sourceId?: number;
}
export interface IcpPersonasOutput {
  personas: IcpPersona[];
  targetAccounts: TargetAccount[];
  sources: Source[];
}
export async function generateIcpPersonas(p: CompanyProfile): Promise<IcpPersonasOutput> {
  const gatherPrompt = `You are building an Ideal Customer Profile for the client below and finding REAL example target accounts a sales team could actually approach. Use web search.

${profileBlock(p)}

1) Define 2-3 concise BUYER PERSONAS (job titles) — for each: seniority, which segment, up to 3 pains, up to 3 goals, and the best channels to reach them.
2) Find 5-6 REAL, currently-operating example TARGET-ACCOUNT companies that fit this ICP (right segment, geography, size). For each, note in ONE line why it fits, its website, and its public LinkedIn COMPANY page URL IF you can find the real one.

CRITICAL: Only state a LinkedIn or website URL if it is a real, publicly verifiable page you actually found. If unsure, omit the URL — never guess or fabricate a URL.`;
  const { text, sources } = await gather(gatherPrompt, 0.5);

  const srcList = sources.map(s => `[${s.id}] ${s.title} — ${s.url}`).join("\n") || "(no live sources)";
  const structure = `Convert to strict JSON. Keep every string short. Do NOT invent companies or URLs not present in the research; if a URL wasn't found, omit that field. Reference sources by id.

RESEARCH:
"""${text}"""

SOURCES:
${srcList}

Return JSON ONLY:
{
  "personas": [
    { "title": "", "seniority": "", "segment": "", "painPoints": ["","",""], "goals": ["",""], "channels": ["",""] }
  ],
  "targetAccounts": [
    { "company": "", "whyFit": "one line", "website": "", "linkedinUrl": "", "sourceId": 1 }
  ]
}`;
  const parsed = await runJson<Omit<IcpPersonasOutput, "sources">>(structure, 0.3);
  // Strip obviously-fabricated linkedin urls (must look like a real linkedin link).
  parsed.targetAccounts = (parsed.targetAccounts || []).map(a => ({
    ...a,
    linkedinUrl: a.linkedinUrl && /linkedin\.com/i.test(a.linkedinUrl) ? a.linkedinUrl : undefined,
  }));
  return { ...parsed, sources };
}

// ═══════════════════ 3) Blue / Red Ocean (GROUNDED) ════════════════════════
export interface OceanSegment {
  name: string;
  saturation: number;        // 0-100 (competitors / crowding)
  growthPotential: number;   // 0-100
  ocean: "blue" | "red";
  rationale: string;
  sourceIds: number[];
}
export interface BlueRedOceanOutput {
  segments: OceanSegment[];
  blueOcean: string[];       // 2-3 "go here" takeaways
  redOcean: string[];        // 2-3 "avoid / differentiate" takeaways
  sources: Source[];
}
export async function generateBlueRedOcean(p: CompanyProfile): Promise<BlueRedOceanOutput> {
  const gatherPrompt = `You are a market strategist running an industry-concentration analysis based on the client's MAIN offering. Use web search for current, real evidence (players, funding, market growth).

${profileBlock(p)}

Identify 5-6 adjacent MARKET SPACES (industry × geography × customer/demography) the client could occupy. For each, judge:
- SATURATION 0-100 (how crowded with credible competitors — cite who),
- GROWTH POTENTIAL 0-100 (headroom / tailwinds — cite evidence),
- classify BLUE ocean (low saturation + high growth = open water, great future prospects) or RED ocean (crowded, low future scope, differentiate or avoid).
Cite specific companies, reports, or data for each judgement.`;
  const { text, sources } = await gather(gatherPrompt, 0.5);

  const srcList = sources.map(s => `[${s.id}] ${s.title} — ${s.url}`).join("\n") || "(no live sources; use inline evidence only)";
  const structure = `Convert the research into strict JSON. Do NOT invent players not in the research. saturation/growthPotential are 0-100. Reference sources by their id.

RESEARCH:
"""${text}"""

SOURCES:
${srcList}

Return JSON ONLY:
{
  "segments": [
    { "name": "", "saturation": 0, "growthPotential": 0, "ocean": "blue|red", "rationale": "<= 12 words, the key evidence", "sourceIds": [1] }
  ],
  "blueOcean": ["2-3 short 'go here' takeaways"],
  "redOcean": ["2-3 short 'avoid / differentiate' takeaways"]
}`;
  const parsed = await runJson<Omit<BlueRedOceanOutput, "sources">>(structure, 0.3);
  return { ...parsed, sources };
}

// ═══════════════════ 4) Demand Landscape (GROUNDED) ════════════════════════
export interface StateDemand { state: string; demand: number; note: string; sourceIds: number[] }
export interface RegionDemand { region: string; demand: number; note: string; sourceIds: number[] }
export interface DemandLandscapeOutput {
  summary: string;
  india: StateDemand[];      // state names ∈ INDIA_STATES
  global: RegionDemand[];    // countries / regions for overseas expansion
  sources: Source[];
}
export async function generateDemandLandscape(p: CompanyProfile): Promise<DemandLandscapeOutput> {
  const gatherPrompt = `You are mapping WHERE demand concentrates for the client's offering. Use web search for real signals: customer/industry density, hiring, GCC / manufacturing presence, income, sector clusters, relevant infrastructure.

${profileBlock(p)}

1) Rank Indian STATES by demand potential for this offering (0-100), with a short evidence-based note each. Only score states you have a basis for; others can be omitted (they'll default to low).
2) If the company has (or plans) overseas presence, rank 4-6 countries/regions by demand (0-100) with a note.
Cite specific evidence for the notable ones.`;
  const { text, sources } = await gather(gatherPrompt, 0.5);

  const srcList = sources.map(s => `[${s.id}] ${s.title} — ${s.url}`).join("\n") || "(no live sources; use inline evidence only)";
  const structure = `Convert the research into strict JSON. India state names MUST be chosen EXACTLY from this allowed list (spelling matters for map join):
${INDIA_STATES.join(", ")}

demand is 0-100. Every "note" is a SHORT reason (<= 12 words) explaining WHY that state ranks where it does (the driver: clusters, GCCs, income, hiring, etc.). Reference sources by id. Omit states with no basis rather than guessing.

RESEARCH:
"""${text}"""

SOURCES:
${srcList}

Return JSON ONLY:
{
  "summary": "2-3 sentences: where demand concentrates and why",
  "india": [ { "state": "Maharashtra", "demand": 0, "note": "", "sourceIds": [1] } ],
  "global": [ { "region": "United Arab Emirates", "demand": 0, "note": "", "sourceIds": [] } ]
}`;
  const parsed = await runJson<Omit<DemandLandscapeOutput, "sources">>(structure, 0.3);
  // Drop any state the model invented that isn't joinable to the map.
  const allowed = new Set<string>(INDIA_STATES as readonly string[]);
  parsed.india = (parsed.india || []).filter(s => allowed.has(s.state));
  return { ...parsed, sources };
}
