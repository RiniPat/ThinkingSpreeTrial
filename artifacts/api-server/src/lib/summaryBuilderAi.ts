/**
 * Summary Builder AI (Builder tab · Phase B).
 *
 * Extracts the Wadhwani-format summary fields from a Fathom transcript (plus
 * any T-Sheet context). The consultant reviews/edits everything before it's
 * committed, so this is a best-effort first pass — never authoritative.
 *
 * Reuses the same Gemini setup style as growthReportAi.ts (gemini-2.5-flash,
 * JSON response, low temperature for extraction).
 */
import { GoogleGenerativeAI } from "@google/generative-ai";

const MODEL = "gemini-2.5-flash";

function getModel(temperature: number) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");
  const genai = new GoogleGenerativeAI(apiKey);
  return genai.getGenerativeModel({
    model: MODEL,
    generationConfig: { temperature, responseMimeType: "application/json" },
  });
}

export type SummaryAiFields = {
  /** Current revenue / ARR in the founder's own words (e.g. "₹40L ARR", "Pre-revenue"). */
  currentRevenueArr: string;
  /** A specific sentence or two describing what the venture actually does — the
   *  detail behind the high-level industry bucket. */
  industryDetail: string;
  /** Whether this is a "critical venture" and why (a short justification). */
  criticalVenture: string;
  /** Market access / introductions Thinking Spree made or should make. */
  tsConnects: string;
  /** Support Thinking Spree is providing beyond connects (advisory, mentorship,
   *  interventions). */
  tsSupport: string;
};

export function emptySummaryAiFields(): SummaryAiFields {
  return {
    currentRevenueArr: "",
    industryDetail: "",
    criticalVenture: "",
    tsConnects: "",
    tsSupport: "",
  };
}

/**
 * Run the extraction. `transcript` is required; `context` is optional T-Sheet
 * scaffolding (startup/founder/goal) that helps ground the model.
 */
export async function extractSummaryFields(opts: {
  startupName: string;
  transcript: string;
  context?: { founder?: string | null; goal?: string | null };
}): Promise<SummaryAiFields> {
  const { startupName, transcript, context } = opts;

  const prompt = `You are a Thinking Spree consultant filling in a venture Summary Sheet for the Wadhwani Foundation program, based on a sprint session transcript.

Startup: ${startupName}
${context?.founder ? `Founder: ${context.founder}` : ""}
${context?.goal ? `Stated goal: ${context.goal}` : ""}

From the transcript below, extract these fields. Use ONLY information present in the transcript — never invent specifics. If a field isn't addressed, return an empty string "" for it (do not guess).

Return STRICT JSON with exactly these keys and nothing else:
{
  "currentRevenueArr": "current revenue or ARR in the founder's own words, e.g. '₹40L ARR' or 'Pre-revenue'",
  "industryDetail": "1-2 sentences on what the venture actually does (the detail behind its industry)",
  "criticalVenture": "is this a high-priority / critical venture, and a short why; '' if not discussed",
  "tsConnects": "specific market-access introductions or connects Thinking Spree made or should make",
  "tsSupport": "support Thinking Spree is providing BEYOND connects (advisory, mentorship, interventions)"
}

Each value must be plain text, under ~60 words, no markdown.

TRANSCRIPT:
${transcript.slice(0, 24000)}`;

  const m = getModel(0.2);
  const result = await m.generateContent(prompt);
  const text = result.response.text();
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  let parsed: Partial<SummaryAiFields>;
  try {
    parsed = JSON.parse(cleaned) as Partial<SummaryAiFields>;
  } catch {
    throw new Error(`Gemini returned non-JSON. First 300 chars: ${cleaned.slice(0, 300)}`);
  }
  // Normalise: guarantee all keys exist as strings.
  const base = emptySummaryAiFields();
  for (const k of Object.keys(base) as (keyof SummaryAiFields)[]) {
    const v = parsed[k];
    base[k] = typeof v === "string" ? v.trim() : "";
  }
  return base;
}
