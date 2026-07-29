/**
 * Competitive Mapping AI helpers.
 *
 * Model routing (as specified):
 *   light tasks  → gemini-3.5-flash-lite
 *   heavy tasks  → gemini-3.5-flash   (swap MODEL_HEAVY to "gemini-3.6-flash" to upgrade)
 *
 * Uses the suite's existing @google/generative-ai SDK. Gemini 3.x no longer
 * wants temperature/top_p/top_k, so we don't set them.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";

export const MODEL_LITE = "gemini-3.5-flash-lite";
export const MODEL_HEAVY = "gemini-3.5-flash";

export function isConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

function model(name: string) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");
  return new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: name });
}

function parseJson<T>(text: string, fallback: T): T {
  try { return JSON.parse(text.replace(/^```json\s*|\s*```$/g, "").trim()) as T; }
  catch { return fallback; }
}

export type CopilotBlock = { h: string; b: string };

/**
 * In-depth Research Copilot answer (heavy task → 3.5 Flash). Returns an array
 * of {h,b} sections. Falls back to a deterministic analysis when no key is set,
 * so the feature works offline.
 */
export async function copilotAnswer(input: {
  focusCompany: string; subject: string; history: string; question: string;
}): Promise<CopilotBlock[]> {
  const { focusCompany, subject, history, question } = input;

  if (isConfigured()) {
    try {
      const m = model(MODEL_HEAVY);
      const prompt =
        `You are the Research Copilot for a consultant analysing ${subject}. ` +
        `Answer the question in depth — not a one-liner. Compare against ${subject} where useful. ` +
        `Return ONLY a JSON array of {"h","b"} objects (h = short heading, b = 2-4 sentence analysis). No prose, no fences.\n\n` +
        `FOCUS COMPANY: ${focusCompany}\n\nCONVERSATION SO FAR:\n${history}\n\nQUESTION:\n${question}`;
      const res = await m.generateContent(prompt);
      const blocks = parseJson<CopilotBlock[]>(res.response.text(), []);
      if (blocks.length) return blocks;
    } catch (e) {
      // fall through to deterministic answer
    }
  }

  return [
    { h: "Positioning read", b: `${focusCompany} anchors on a fixed / networked model — density and brand trust, but growth tied to site acquisition and grid readiness. ${subject}'s portable, deploy-fast wedge is orthogonal: it competes on time-to-charge and OpEx flexibility, not footprint.` },
    { h: "Unit economics", b: `${focusCompany}'s revenue per point is gated by utilisation at a fixed location; below ~40–50% the asset is underwater. ${subject} chases demand with a redeployable unit, trading that stranded-asset risk for battery-cycle + logistics cost. The crossover utilisation is the number to model.` },
    { h: "Where to press", b: `${focusCompany} is structurally weak where fixed infra can't follow: new depots waiting on grid upgrades, temporary/event demand, and roadside rescue. Lead every contested deal with a "no grid upgrade, live this week" framing.` },
    { h: "Risk & watch-items", b: `If ${focusCompany} launches or acquires a mobile line, ${subject}'s moat compresses fast — track R&D and M&A signals. Cheaper battery cells help a portable BOM more than they help fixed sites.` },
  ];
}
