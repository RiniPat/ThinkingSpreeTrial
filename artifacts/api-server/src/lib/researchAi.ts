/**
 * AI generators for the Research & Sales workspace.
 *
 * Each tool has a dedicated prompt template + expected output shape. All
 * use gemini-2.5-flash via the existing GEMINI_API_KEY (same plumbing as
 * email generation in gemini.ts).
 *
 * Output is strict JSON so the frontend can render structured cards
 * without parsing markdown. Each function's return type tells the
 * frontend exactly what to expect.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

const MODEL = "gemini-2.5-flash";

// ──────────────────────── Shared helpers ──────────────────────────────────
function getModel() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured on the server.");
  }
  const genai = new GoogleGenerativeAI(apiKey);
  return genai.getGenerativeModel({
    model: MODEL,
    generationConfig: {
      temperature: 0.5,             // research → moderate creativity, faithful to facts
      responseMimeType: "application/json",
    },
  });
}

async function runJsonPrompt<T>(prompt: string): Promise<T> {
  const model = getModel();
  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error(`Gemini returned non-JSON. First 300 chars: ${cleaned.slice(0, 300)}`);
  }
}

// ──────────────────────── Tool 1: Customer Segmentation ──────────────────
export type CustomerSegmentationInput = {
  companyName: string;
  industry: string;
  productDescription: string;
  geography?: string;
};
export type CustomerSegmentationOutput = {
  segments: Array<{
    name: string;
    demographics: string;
    psychographics: string;
    painPoints: string[];
    willingnessToPay: string;
    sizeEstimate: string;
  }>;
  primarySegment: string;
  rationale: string;
};

export async function generateCustomerSegmentation(
  input: CustomerSegmentationInput,
): Promise<CustomerSegmentationOutput> {
  const prompt = `You are a senior consultant doing customer segmentation analysis for a startup.

COMPANY: ${input.companyName}
INDUSTRY: ${input.industry}
PRODUCT: ${input.productDescription}
GEOGRAPHY: ${input.geography ?? "India"}

Produce 3-5 distinct customer segments. For each segment, give:
- name (short, e.g. "Urban Millennials")
- demographics (age range, income, location, education)
- psychographics (values, behaviors, motivations)
- painPoints (array of 3-5 specific pain points this segment has)
- willingnessToPay (qualitative: e.g. "Low - prefers freemium", "Medium - up to ₹500/mo")
- sizeEstimate (qualitative or rough number: e.g. "12-15M in metros")

Also identify the PRIMARY segment (the one to target first) with a 2-3 sentence rationale.

Return JSON ONLY: {
  "segments": [{ name, demographics, psychographics, painPoints: [string], willingnessToPay, sizeEstimate }],
  "primarySegment": "Segment name",
  "rationale": "2-3 sentences"
}

Rules: be specific to the company. Use Indian market context unless geography says otherwise. Don't invent numbers — give qualitative ranges.`;

  return runJsonPrompt<CustomerSegmentationOutput>(prompt);
}

// ──────────────────────── Tool 2: ICP Mapping ─────────────────────────────
export type IcpMappingInput = {
  companyName: string;
  productDescription: string;
  currentCustomers?: string;
};
export type IcpMappingOutput = {
  ideal: {
    companyType: string;     // for B2B: e.g. "Series A SaaS, 20-50 employees"
    persona: string;          // primary buyer
    triggers: string[];       // what events make them ready to buy
    redFlags: string[];       // signals to disqualify
    channels: string[];       // where to find them
  };
  secondary: { companyType: string; rationale: string }[];
};

export async function generateIcpMapping(input: IcpMappingInput): Promise<IcpMappingOutput> {
  const prompt = `You are a sales / GTM strategist defining the Ideal Customer Profile.

COMPANY: ${input.companyName}
PRODUCT: ${input.productDescription}
CURRENT CUSTOMERS (if known): ${input.currentCustomers ?? "Not provided"}

Define the IDEAL customer profile in detail, plus 1-2 secondary ICPs.

For the ideal:
- companyType: firmographic snapshot (B2B) or demographic (B2C)
- persona: primary decision-maker / buyer
- triggers: 3-5 specific events that make this ICP ready to buy
- redFlags: 3-5 signals to deprioritize a prospect
- channels: where to find this ICP (e.g. LinkedIn searches, communities, events)

Return JSON ONLY: {
  "ideal": { "companyType": "...", "persona": "...", "triggers": [string], "redFlags": [string], "channels": [string] },
  "secondary": [{ "companyType": "...", "rationale": "..." }]
}

Be specific and actionable. The sales team should be able to build a prospecting list directly from this.`;

  return runJsonPrompt<IcpMappingOutput>(prompt);
}

// ──────────────────────── Tool 3: TAM / SAM / SOM ────────────────────────
export type TamSamSomInput = {
  companyName: string;
  productDescription: string;
  geography: string;          // e.g. "India", "Tier 1 Indian cities"
  pricingNotes?: string;      // optional pricing context
};
export type TamSamSomOutput = {
  tam: { value: string; reasoning: string };   // total addressable market
  sam: { value: string; reasoning: string };   // serviceable addressable
  som: { value: string; reasoning: string };   // serviceable obtainable (~3 yr realistic)
  assumptions: string[];
  sources: string[];          // qualitative source hints (e.g. "Bain India report 2023", not real URLs)
};

export async function generateTamSamSom(input: TamSamSomInput): Promise<TamSamSomOutput> {
  const prompt = `You are a market research analyst calculating TAM / SAM / SOM.

COMPANY: ${input.companyName}
PRODUCT: ${input.productDescription}
GEOGRAPHY: ${input.geography}
PRICING: ${input.pricingNotes ?? "Not specified"}

Compute:
- TAM (Total Addressable Market): the maximum possible revenue if everyone who could use this bought it
- SAM (Serviceable Addressable Market): the subset realistically reachable given geography, channels, language
- SOM (Serviceable Obtainable Market): what's realistic to capture in ~3 years

For each, give:
- value: in INR (e.g. "₹4,500 Cr / year", "USD 12B globally")
- reasoning: how you derived this (population × penetration × pricing)

Also list:
- 3-5 key assumptions (numbers you assumed)
- 2-4 reference sources (real reports/studies; if unsure, say "industry estimate")

Return JSON ONLY: {
  "tam": { "value": "...", "reasoning": "..." },
  "sam": { "value": "...", "reasoning": "..." },
  "som": { "value": "...", "reasoning": "..." },
  "assumptions": [string],
  "sources": [string]
}

Critical: never invent precise figures. Use ranges ("₹3-5K Cr") when uncertain. State assumptions clearly.`;

  return runJsonPrompt<TamSamSomOutput>(prompt);
}

// ──────────────────────── Tool 4: Industry Landscape ─────────────────────
export type IndustryLandscapeInput = {
  industry: string;
  geography?: string;
};
export type IndustryLandscapeOutput = {
  overview: string;                                                // 3-4 sentence summary
  marketSize: string;                                              // 1-2 sentences
  growthRate: string;                                              // CAGR or descriptive
  keyPlayers: { name: string; positioning: string }[];             // 5-8 players
  trends: string[];                                                // 4-6 trends
  challenges: string[];                                            // 3-5 challenges
  opportunities: string[];                                         // 3-5 opportunities
  regulatory: string;                                              // regulatory context
};

export async function generateIndustryLandscape(
  input: IndustryLandscapeInput,
): Promise<IndustryLandscapeOutput> {
  const prompt = `You are a market analyst producing an industry overview.

INDUSTRY: ${input.industry}
GEOGRAPHY: ${input.geography ?? "India"}

Produce a structured landscape analysis. Be concrete; use named companies and real trends.

Return JSON ONLY: {
  "overview":     "3-4 sentences on what the industry is and where it stands",
  "marketSize":   "1-2 sentences (with a qualitative number range)",
  "growthRate":   "CAGR % or descriptive growth",
  "keyPlayers":   [{ "name": "Company", "positioning": "what makes them distinct" }],   // 5-8 entries
  "trends":       [string],          // 4-6 current trends
  "challenges":   [string],          // 3-5 industry challenges
  "opportunities":[string],          // 3-5 emerging opportunities
  "regulatory":   "1-2 sentence summary of the regulatory environment"
}

Be honest about uncertainty. If you're not sure about a player, omit them rather than guess.`;

  return runJsonPrompt<IndustryLandscapeOutput>(prompt);
}

// ──────────────────────── Tool 5: Business Model Canvas ──────────────────
export type BusinessModelCanvasInput = {
  companyName: string;
  productDescription: string;
  currentRevenueModel?: string;
};
export type BusinessModelCanvasOutput = {
  customerSegments: string[];
  valuePropositions: string[];
  channels: string[];
  customerRelationships: string[];
  revenueStreams: string[];
  keyResources: string[];
  keyActivities: string[];
  keyPartners: string[];
  costStructure: string[];
};

export async function generateBusinessModelCanvas(
  input: BusinessModelCanvasInput,
): Promise<BusinessModelCanvasOutput> {
  const prompt = `You are filling out a Business Model Canvas (Osterwalder).

COMPANY: ${input.companyName}
PRODUCT: ${input.productDescription}
CURRENT REVENUE MODEL: ${input.currentRevenueModel ?? "Not specified"}

Fill all 9 BMC blocks. Each block is an array of 3-6 short bullet items
(phrases or one-line sentences, not paragraphs).

Return JSON ONLY: {
  "customerSegments":      [string],
  "valuePropositions":     [string],
  "channels":              [string],
  "customerRelationships": [string],
  "revenueStreams":        [string],
  "keyResources":          [string],
  "keyActivities":         [string],
  "keyPartners":           [string],
  "costStructure":         [string]
}

Keep each item under 12 words. Be specific to the company, not generic SaaS boilerplate.`;

  return runJsonPrompt<BusinessModelCanvasOutput>(prompt);
}

// ──────────────────────── Sales: LinkedIn Outreach ───────────────────────
export type LinkedInOutreachInput = {
  prospectName: string;
  prospectRole: string;
  prospectCompany: string;
  reasonForReach: string;
  mutualConnection?: string;
  tone?: "warm" | "formal" | "playful";
};
export type LinkedInOutreachOutput = {
  connectionRequest: string;     // <= 300 chars (LinkedIn limit)
  firstMessage: string;           // longer follow-up after they accept
  subjectLineIfEmail: string;
};

export async function generateLinkedInOutreach(
  input: LinkedInOutreachInput,
): Promise<LinkedInOutreachOutput> {
  const prompt = `You are a senior sales / partnerships professional crafting LinkedIn outreach.

PROSPECT: ${input.prospectName}, ${input.prospectRole} at ${input.prospectCompany}
REASON FOR REACH OUT: ${input.reasonForReach}
MUTUAL CONNECTION (if any): ${input.mutualConnection ?? "None"}
TONE: ${input.tone ?? "warm"}

Produce three things:
1. connectionRequest: <= 280 chars. Personal, references something specific, includes a soft ask. Mention the mutual connection naturally if provided.
2. firstMessage: the message to send AFTER they accept the request. 4-6 sentences. State value, ask for 15-min call, end with optionality.
3. subjectLineIfEmail: in case the salesperson emails instead — a single specific subject line.

Return JSON ONLY: { "connectionRequest": "...", "firstMessage": "...", "subjectLineIfEmail": "..." }

Rules:
- No "I hope this finds you well." Skip filler.
- Never be salesy. Lead with curiosity / value, not pitch.
- India professional context. No emoji.
- Reference the prospect's company / role specifically.`;

  return runJsonPrompt<LinkedInOutreachOutput>(prompt);
}

// ──────────────────────── Sales: Proposal Section Fill ───────────────────
/**
 * Fills a single proposal section. Called once per section the consultant
 * marked as "AI fill" — keeps token use predictable and lets the consultant
 * regenerate one section without paying for the rest.
 */
export type ProposalSectionFillInput = {
  prospectName: string;
  prospectCompany: string;
  brief: string;                         // shared brief — what we're proposing
  sectionHeading: string;                // the heading the consultant wrote
  sectionContextNotes?: string;          // optional consultant guidance
  previousSections?: { heading: string; body: string }[]; // earlier sections for continuity
};
export type ProposalSectionFillOutput = {
  body: string;                          // formatted plain text (paragraphs separated by \n\n)
};

export async function fillProposalSection(
  input: ProposalSectionFillInput,
): Promise<ProposalSectionFillOutput> {
  const prevBlock = (input.previousSections ?? []).length > 0
    ? `EARLIER SECTIONS (for continuity, don't repeat):\n${input.previousSections!.map(s => `- ${s.heading}: ${s.body.slice(0,200)}…`).join("\n")}\n\n`
    : "";

  const prompt = `You are a business consultant writing one section of a client proposal.

PROSPECT: ${input.prospectName} at ${input.prospectCompany}
PROPOSAL BRIEF: ${input.brief}

SECTION TO WRITE: "${input.sectionHeading}"
${input.sectionContextNotes ? `GUIDANCE: ${input.sectionContextNotes}` : ""}

${prevBlock}Write the body of this section in 2-5 short paragraphs. Plain text only — no markdown headers (the heading is rendered separately). Separate paragraphs with \\n\\n.

Return JSON ONLY: { "body": "..." }

Rules:
- Concrete and specific. Avoid consulting-speak ("synergies", "leverage").
- Address the prospect directly.
- Keep paragraphs short (2-4 sentences each).
- If the section needs facts you don't have, say "we'll confirm the exact figure with you" instead of inventing.`;

  return runJsonPrompt<ProposalSectionFillOutput>(prompt);
}
