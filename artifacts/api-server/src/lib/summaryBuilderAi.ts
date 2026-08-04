/**
 * Summary Builder AI (Builder tab · Phase B).
 *
 * Extracts the Wadhwani-format summary fields from a Fathom transcript (plus
 * any T-Sheet context). The consultant reviews/edits everything before it's
 * committed, so this is a best-effort first pass — never authoritative.
 *
 * This is a pure extraction task ("data pulling"), so it runs on the LITE
 * model tier (see aiClient.ts) — JSON response, low temperature.
 */
import { getModel, MODEL_LITE, stripJsonFences } from "./aiClient";

function model(temperature: number) {
  // Transcript field extraction is data-pulling → LITE tier.
  return getModel({
    model: MODEL_LITE,
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

  const prompt = `You are a Thinking Spree consultant filling in a venture Summary Sheet for the Wadhwani Foundation program, based on one or more sprint session (Fathom) transcripts.

Startup: ${startupName}
${context?.founder ? `Founder: ${context.founder}` : ""}
${context?.goal ? `Stated goal: ${context.goal}` : ""}

Answer each question using ONLY information present in the transcript(s). Do not invent specifics. If a question isn't addressed, return an empty string "" for it.

Questions:
1. currentRevenueArr — "What is the Current Revenue (ARR) for the company?" Give the figure in the founder's own words (e.g. "₹40L ARR", "Pre-revenue").
2. industryDetail — "What is the Industry Detail, in one short phrase?" e.g. "Electrical Equipment Manufacturing".
3. criticalVenture — "What is the Critical Venture for the company, in one short phrase?" e.g. "Scaling of Automated Panels".
4. tsConnects — "What are the Thinking Spree Connects for the company?" e.g. "Plant and Factory consultants".
5. tsSupport — "What is the Thinking Spree Support apart from connects?" e.g. "Value-stream mapping, ongoing advisory".

Return STRICT JSON with exactly these keys and string values, nothing else:
{"currentRevenueArr":"","industryDetail":"","criticalVenture":"","tsConnects":"","tsSupport":""}

industryDetail and criticalVenture must each be a single short phrase (no sentences). All values plain text, no markdown.

TRANSCRIPT(S):
${transcript.slice(0, 28000)}`;

  const m = model(0.2);
  const result = await m.generateContent(prompt);
  const cleaned = stripJsonFences(result.response.text());
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
