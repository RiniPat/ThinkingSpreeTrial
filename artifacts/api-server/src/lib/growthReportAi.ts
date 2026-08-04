/**
 * Growth Report AI generators — two distinct prompts run sequentially.
 *
 *   Prompt 1: extracts "Venture Baseline Anchors" from the uploaded
 *             documents (Strategic Canvas, Fathom transcripts, Check-In).
 *             Output is a structured JSON object the consultant can edit.
 *
 *   Prompt 2: takes the (possibly edited) anchors as fixed input and
 *             generates the full Journey Report — six sections + annexure.
 *
 * Why two prompts instead of one: separation gives the consultant a
 * checkpoint to fix hallucinated anchors before they propagate into the
 * report body. Also helps Gemini stay within token limits on dense inputs.
 */

import { getModel, MODEL_LITE, MODEL_STANDARD, stripJsonFences } from "./aiClient";

async function runJson<T>(prompt: string, temperature: number, tier: string): Promise<T> {
  const m = getModel({ model: tier, generationConfig: { temperature, responseMimeType: "application/json" } });
  const result = await m.generateContent(prompt);
  const cleaned = stripJsonFences(result.response.text());
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error(`Gemini returned non-JSON. First 300 chars: ${cleaned.slice(0, 300)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Anchor types — Section A-S per the Builder spec.
// ─────────────────────────────────────────────────────────────────────────

export type RAG = "RED" | "AMBER" | "GREEN" | "";   // "" = not yet rated
export type ExistingOrNew = "Existing" | "New" | "Not stated.";

export type StreamAnchor = {
  rag: RAG;
  supportNeed: string;                  // one line on the gap/support per spec
};

export type GrowthReportAnchors = {
  // Current State
  primaryProduct: string;               // A
  primaryCustomer: string;              // B
  primaryGeography: string;             // C
  currentScale: string;                 // D
  coreBusinessModel: string;            // E
  // Growth State
  growthProduct: string;                // F
  growthCustomer: string;               // G
  growthGeography: string;              // H
  growthProductIsNew: ExistingOrNew;    // I-F
  growthCustomerIsNew: ExistingOrNew;   // I-G
  growthGeographyIsNew: ExistingOrNew;  // I-H
  // Streams (6, fixed order)
  gtm: StreamAnchor;                    // J
  product: StreamAnchor;                // K
  operations: StreamAnchor;             // L
  supplyChain: StreamAnchor;            // M
  peopleHr: StreamAnchor;               // N
  finance: StreamAnchor;                // O
  // Sprint sequencing
  primarySprintStream: string;          // P — first sprint anchors here
  // Strategic Summary inputs
  risk: string;                         // Q
  bottleneck: string;                   // R
  scalability: string;                  // S
};

/** Default empty anchor object — used when a row's status is 'drafting' and
 *  Gemini has not yet been called. */
export function emptyAnchors(): GrowthReportAnchors {
  const blankStream: StreamAnchor = { rag: "", supportNeed: "" };
  return {
    primaryProduct: "", primaryCustomer: "", primaryGeography: "",
    currentScale: "", coreBusinessModel: "",
    growthProduct: "", growthCustomer: "", growthGeography: "",
    growthProductIsNew: "Not stated.", growthCustomerIsNew: "Not stated.", growthGeographyIsNew: "Not stated.",
    gtm: { ...blankStream }, product: { ...blankStream }, operations: { ...blankStream },
    supplyChain: { ...blankStream }, peopleHr: { ...blankStream }, finance: { ...blankStream },
    primarySprintStream: "",
    risk: "", bottleneck: "", scalability: "",
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Journey report types — what Prompt 2 returns.
// ─────────────────────────────────────────────────────────────────────────

export type Sprint = {
  number: 1 | 2 | 3;
  definition: string;
  outcomes: string[];                     // ≥ 3 specific outcomes
  expertProfile: string;
};

export type StreamRow = {
  stream: "GTM (Go-to-Market)" | "Product" | "Operations" | "Supply Chain" | "People / HR" | "Finance";
  rag: RAG;
  supportRequired: string;
  twelveMonthGoal: string;
  thirtySixMonthGoal: string;
};

export type AnnexureRow = {
  stream: StreamRow["stream"];
  thirtySixMonthGoal: string;
  subStream: string;
  rag: RAG;
  indicativeExecutionFocus: string;
};

export type JourneyReport = {
  section1: {
    pitch: string;                         // 2-minute investor pitch on current state
    table: { coreProducts: string; largestSegments: string; coreGeographies: string };
  };
  section2: {
    pitch: string;
    table: {
      product: { isNew: ExistingOrNew; description: string };
      market: { isNew: ExistingOrNew; description: string };
      geography: { isNew: ExistingOrNew; description: string };
    };
  };
  section3: { streams: StreamRow[] };       // exactly 6 in fixed order
  section4: { sprints: Sprint[] };          // exactly 3
  section5: {
    summary: string;                        // 3 sentences
    risks: string[];                        // 1-3 bullets
    bottlenecks: string[];
    scalability: string[];
  };
  annexure: AnnexureRow[];                  // 6 streams × 5 sub-streams = 30 rows
};

// ─────────────────────────────────────────────────────────────────────────
// Prompt 1 — anchor extraction
// ─────────────────────────────────────────────────────────────────────────

export async function extractAnchors(input: {
  startupName: string;
  strategicCanvasText: string;
  fathom1Text?: string;
  fathom2Text?: string;
  checkinText?: string;
}): Promise<GrowthReportAnchors> {
  const docs = [
    `=== STRATEGIC CANVAS (extracted text) ===\n${input.strategicCanvasText}`,
    input.fathom1Text ? `\n\n=== FATHOM TRANSCRIPT 1 (extracted text) ===\n${input.fathom1Text}` : "",
    input.fathom2Text ? `\n\n=== FATHOM TRANSCRIPT 2 (extracted text) ===\n${input.fathom2Text}` : "",
    input.checkinText ? `\n\n=== CHECK-IN CALL (extracted text) ===\n${input.checkinText}` : "",
  ].join("");

  const prompt = `From the uploaded documents only, extract and structure the following. Be precise.
No inference. No elaboration. If any item is not explicitly stated, write: "Not stated."

STARTUP: ${input.startupName}

DOCUMENTS:
${docs.slice(0, 80_000)}

────────────────────────────────────────
OUTPUT FORMAT: Return JSON ONLY. The exact shape is:

{
  "primaryProduct":         "...",         // [A] Primary Product / Service — the one generating most revenue or most frequently mentioned
  "primaryCustomer":        "...",         // [B] Primary Customer Segment — largest or most discussed
  "primaryGeography":       "...",         // [C] Primary Geography — current operational base
  "currentScale":           "...",         // [D] Current Scale — quote source figures exactly (revenue, team size, customers, locations)
  "coreBusinessModel":      "...",         // [E] How the company makes money, one line

  "growthProduct":          "...",         // [F] Growth Product / Service — most consistently cited across founder + consultant + panel
  "growthCustomer":         "...",         // [G] Growth Customer Segment
  "growthGeography":        "...",         // [H] Growth Geography

  "growthProductIsNew":     "Existing" | "New" | "Not stated.",   // [I-F]
  "growthCustomerIsNew":    "Existing" | "New" | "Not stated.",   // [I-G]
  "growthGeographyIsNew":   "Existing" | "New" | "Not stated.",   // [I-H]

  "gtm":         { "rag": "RED"|"AMBER"|"GREEN", "supportNeed": "one line specific need from the documents" }, // [J]
  "product":     { "rag": "...", "supportNeed": "..." },   // [K]
  "operations":  { "rag": "...", "supportNeed": "..." },   // [L]
  "supplyChain": { "rag": "...", "supportNeed": "..." },   // [M]
  "peopleHr":    { "rag": "...", "supportNeed": "..." },   // [N]
  "finance":     { "rag": "...", "supportNeed": "..." },   // [O]

  "primarySprintStream": "GTM (Go-to-Market)" | "Product" | "Operations" | "Supply Chain" | "People / HR" | "Finance",   // [P] — first RED stream

  "risk":        "...",   // [Q] Specific risk that could derail growth (one sentence)
  "bottleneck":  "...",   // [R] Visible operational constraint (one sentence)
  "scalability": "..."    // [S] Reason this venture is worth backing for scale (one sentence)
}

RAG RUBRIC:
- RED   = Explicitly flagged as a problem or gap in documents. No current solution stated.
- AMBER = Partial capability exists but incomplete or dependent on external support.
- GREEN = Confirmed functional. Not flagged as concern.

Output the JSON object ONLY. No commentary. No markdown fences.`;

  // Lower temperature — extraction must be faithful, not creative. Data-pulling
  // task → LITE tier.
  return runJson<GrowthReportAnchors>(prompt, 0.2, MODEL_LITE);
}

// ─────────────────────────────────────────────────────────────────────────
// Prompt 2 — journey report generation
// ─────────────────────────────────────────────────────────────────────────

export async function generateJourneyReport(input: {
  startupName: string;
  anchors: GrowthReportAnchors;
  strategicCanvasText: string;
  fathom1Text?: string;
  fathom2Text?: string;
  checkinText?: string;
}): Promise<JourneyReport> {
  const supportingDocs = [
    `=== STRATEGIC CANVAS ===\n${input.strategicCanvasText}`,
    input.fathom1Text ? `\n\n=== FATHOM 1 ===\n${input.fathom1Text}` : "",
    input.fathom2Text ? `\n\n=== FATHOM 2 ===\n${input.fathom2Text}` : "",
    input.checkinText ? `\n\n=== CHECK-IN ===\n${input.checkinText}` : "",
  ].join("");

  const prompt = `Using the anchors below as your FIXED INPUT, and the supporting documents as evidence, generate the Journey Report in the exact JSON structure specified.

STARTUP: ${input.startupName}

VENTURE BASELINE ANCHORS (fixed — do not re-derive or re-interpret):
${JSON.stringify(input.anchors, null, 2)}

SUPPORTING DOCUMENTS (evidence only, do not introduce new facts):
${supportingDocs.slice(0, 60_000)}

────────────────────────────────────────
HARD RULES:
- Use ONLY the anchors above as inputs. Do not re-derive.
- Do not invent facts, numbers, or timelines.
- No transcript language. No filler phrases.
- Banned words: "it is important to", "moving forward", "leverage", "synergies", "holistic".
- Every sentence must state a fact, gap, goal, or action.
- Complete all sections fully. No empty fields.
- Build sections in order 1→2→3→4→5→annexure.

────────────────────────────────────────
OUTPUT — return JSON ONLY in this exact shape:

{
  "section1": {
    "pitch": "2-minute investor elevator pitch on the venture today. Use anchors A, B, C, D, E only. Current state only. No mention of growth plans. 3-5 sentences.",
    "table": {
      "coreProducts": "from anchor A",
      "largestSegments": "from anchor B",
      "coreGeographies": "from anchor C"
    }
  },
  "section2": {
    "pitch": "30-45 second investor pitch on growth ambition. Use anchors F, G, H, I only. 3-4 sentences.",
    "table": {
      "product":   { "isNew": "from I-F", "description": "from F" },
      "market":    { "isNew": "from I-G", "description": "from G" },
      "geography": { "isNew": "from I-H", "description": "from H" }
    }
  },
  "section3": {
    "streams": [
      { "stream": "GTM (Go-to-Market)", "rag": "from J", "supportRequired": "2 sentences from J's support need", "twelveMonthGoal": "specific directional 12mo goal", "thirtySixMonthGoal": "specific directional 36mo goal" },
      { "stream": "Product",           "rag": "from K", "supportRequired": "2 sentences", "twelveMonthGoal": "...", "thirtySixMonthGoal": "..." },
      { "stream": "Operations",        "rag": "from L", "supportRequired": "2 sentences", "twelveMonthGoal": "...", "thirtySixMonthGoal": "..." },
      { "stream": "Supply Chain",      "rag": "from M", "supportRequired": "2 sentences", "twelveMonthGoal": "...", "thirtySixMonthGoal": "..." },
      { "stream": "People / HR",       "rag": "from N", "supportRequired": "2 sentences", "twelveMonthGoal": "...", "thirtySixMonthGoal": "..." },
      { "stream": "Finance",           "rag": "from O", "supportRequired": "2 sentences", "twelveMonthGoal": "...", "thirtySixMonthGoal": "..." }
    ]
  },
  "section4": {
    "sprints": [
      { "number": 1, "definition": "...", "outcomes": ["≥3 outcome lines"], "expertProfile": "very specific (e.g. 'B2B Sales Lead with SMB sector experience')" },
      { "number": 2, "definition": "...", "outcomes": ["≥3 lines"], "expertProfile": "..." },
      { "number": 3, "definition": "...", "outcomes": ["≥3 lines"], "expertProfile": "..." }
    ]
  },
  "section5": {
    "summary": "3-sentence venture summary",
    "risks":        ["1-3 bullets, each max 2 sentences — specific risks that could derail growth"],
    "bottlenecks":  ["1-3 bullets — visible operational constraints"],
    "scalability":  ["1-3 bullets — why the journey is scalable"]
  },
  "annexure": [
    // exactly 30 rows: 6 streams × 5 sub-streams each, in this stream order:
    // GTM, Product, Operations, Supply Chain, People / HR, Finance
    { "stream": "GTM (Go-to-Market)", "thirtySixMonthGoal": "matches Section 3 GTM 36mo", "subStream": "Sub-stream name 1", "rag": "matches Section 3 GTM rag", "indicativeExecutionFocus": "one outcome-led execution line" }
    // ... 29 more rows
  ]
}

SPRINT SELECTION:
- Sprint 1's primary stream = the value of anchor P (primarySprintStream).
- Sprints 2 and 3 must come from other RED or AMBER streams.
- Each sprint anchors to ONE primary stream; do not repeat primary streams.

ANNEXURE:
- Exactly 30 rows total: 6 streams × 5 sub-streams.
- Each sub-stream name is short (2-4 words).
- Each indicativeExecutionFocus is a single specific outcome-led line (one sentence).
- RAG of every annexure row MUST match the RAG of its parent stream in Section 3.

VERIFY before output:
- All anchors used as-is, not re-derived.
- Section 3 has exactly 6 streams in stated order.
- Section 4 has exactly 3 sprints.
- Annexure has exactly 30 rows.
- No empty string values anywhere.`;

  // Slightly higher temperature — narrative sections need some shaping. This is
  // a reasoning-heavy synthesis → STANDARD tier.
  return runJson<JourneyReport>(prompt, 0.35, MODEL_STANDARD);
}
