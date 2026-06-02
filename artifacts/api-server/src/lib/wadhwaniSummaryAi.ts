/**
 * Wadhwani Foundation Summary AI extractor.
 *
 * Pulls 5 fields from Fathom transcripts (the founder describes their
 * business during venture-platform calls; we extract concise summaries).
 *
 * Low temperature (0.2) — we want consistent, factual extraction, not
 * creative summarization.
 *
 *   - currentRevenue   "INR 1.2 Cr ARR" or "Pre-revenue"
 *   - industryDetail   "Electrical Equipment Manufacturing"
 *   - criticalVenture  "Scaling of Automated Panels"
 *   - tsConnects       "Plant and Factory consultants"
 *   - tsSupport        Anything Thinking Spree did beyond connects
 *
 * Returns empty strings for any field not stated in the transcripts — we
 * NEVER fabricate. Consultant edits in the UI before writing to sheet.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

const MODEL = "gemini-2.5-flash";

export type WadhwaniExtraction = {
  currentRevenue: string;
  industryDetail: string;
  criticalVenture: string;
  tsConnects: string;
  tsSupport: string;
};

const EMPTY: WadhwaniExtraction = {
  currentRevenue: "",
  industryDetail: "",
  criticalVenture: "",
  tsConnects: "",
  tsSupport: "",
};

export async function extractWadhwaniFields(input: {
  startupName: string;
  fathomTexts: string[];
}): Promise<WadhwaniExtraction> {
  // No transcripts → nothing to extract. Return empty (consultant fills
  // manually in the UI). Don't burn a Gemini call on empty inputs.
  const nonEmpty = (input.fathomTexts ?? []).filter(t => t && t.trim().length > 0);
  if (nonEmpty.length === 0) return EMPTY;

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");

  const docs = nonEmpty
    .map((t, i) => `=== FATHOM TRANSCRIPT ${i + 1} ===\n${t}`)
    .join("\n\n")
    .slice(0, 80_000); // cap to keep tokens predictable

  const prompt = `You are extracting structured information from Fathom call transcripts to fill a Wadhwani Foundation summary sheet.

STARTUP: ${input.startupName}

TRANSCRIPTS:
${docs}

Extract these 5 fields. Be concise (≤ 15 words each). Use the founder's own phrasing where possible. If a field is NOT explicitly discussed, return an empty string for that field — do not infer or guess.

1. currentRevenue — current revenue or ARR figure as stated by the founder. E.g. "INR 1.2 Cr ARR", "Pre-revenue", "USD 50k MRR". Include the unit/currency.
2. industryDetail — specific industry sub-segment (NOT a top-level label). E.g. "Electrical Equipment Manufacturing", "B2B SaaS for HR", "D2C Skincare". One short phrase.
3. criticalVenture — the single most critical venture initiative the founder is currently focused on. E.g. "Scaling of Automated Panels", "Launching enterprise tier", "First export contract". One short phrase.
4. tsConnects — the kind of expert/operator connects the founder needs from Thinking Spree. E.g. "Plant and Factory consultants", "Series A VCs in fintech", "Enterprise CRM buyers". Concise.
5. tsSupport — any support Thinking Spree provided OR was asked to provide BEYOND connects (templates, frameworks, intros, coaching). Empty if only connects were discussed.

Return ONLY valid JSON with exactly these 5 string keys, no extra fields, no preamble:
{"currentRevenue":"...","industryDetail":"...","criticalVenture":"...","tsConnects":"...","tsSupport":"..."}`;

  const genai = new GoogleGenerativeAI(apiKey);
  const model = genai.getGenerativeModel({
    model: MODEL,
    generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
  });

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Wadhwani extraction returned non-JSON. First 300 chars: ${cleaned.slice(0, 300)}`);
  }

  // Defensive: coerce every field to string, default to "". Caller can edit.
  return {
    currentRevenue: String(parsed.currentRevenue ?? "").trim(),
    industryDetail: String(parsed.industryDetail ?? "").trim(),
    criticalVenture: String(parsed.criticalVenture ?? "").trim(),
    tsConnects: String(parsed.tsConnects ?? "").trim(),
    tsSupport: String(parsed.tsSupport ?? "").trim(),
  };
}
