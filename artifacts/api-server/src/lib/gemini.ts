/**
 * Gemini wrapper for AI-drafted T-Sprint emails.
 *
 * We keep the API key server-side and never expose it to the browser.
 * The templates themselves (pre & post) are hard-coded below — these are
 * the exact templates the client provided. The model's job is to:
 *   1. Fill placeholder fields with real values from the company record.
 *   2. Rewrite each merge-field paragraph in fluent prose (no "[Bracketed
 *      Variables]" left in the output).
 *   3. Return strict JSON: { subject, body }.
 *
 * We request JSON mime type so the response is parseable without regex
 * cleanup. If Gemini ever wraps in fences anyway, we strip them defensively.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

export type EmailKind = "pre" | "post";

export type EmailContext = {
  /** Company name (e.g. "Lumen Diagnostics"). */
  companyName: string;
  /** Founder name (e.g. "Asha Patel"). Used directly in the salutation. */
  founderName: string;
  /** Cohort label, e.g. "ISB i-Venture". Pre-email mentions this loosely. */
  cohort: string | null;
  /** Vision from "About Startup" sheet — used in the post-sprint email's
   *  "your vision" paragraph. */
  vision: string | null;
  /** Sprint host (senior consultant). */
  sprintHost: string | null;
  /** Co-host (Business Research Analyst). */
  coHost: string | null;
  /** Sprint day (e.g. "Monday"). Looked up from Google Calendar. */
  sprintDay: string | null;
  /** Sprint date (e.g. "12 June 2026"). Looked up from Google Calendar. */
  sprintDate: string | null;
  /** Sprint time (e.g. "2:00 PM IST"). Looked up from Google Calendar. */
  sprintTime: string | null;
  /** SWOT outputs — only relevant for the post-sprint email. */
  keyStrengths: string | null;
  gaps: string | null;
  direction: string | null;
  actionableSteps: string | null;
  mentorRecommendation: string | null;
  marketAccess: string | null;
  /** Optional Thinking Sheet / deck URL — included in the post-sprint email
   *  as the "Thinking Sheet for [company] link". */
  thinkingSheetUrl: string | null;
  /** Extra freeform context the consultant typed in the composer dialog. */
  extraNotes?: string | null;
};

export type GeneratedEmail = { subject: string; body: string };

// ──────────────────────── Templates ────────────────────────────────────────
// These are pasted verbatim from the client. The model uses them as the
// scaffolding it must fill in.

const PRE_SPRINT_TEMPLATE = `Hi [ Founder's Name],

Hope you are doing well.
We are excited to initiate your T-Sprints journey for your company [Name of the company] with a 1:1 Need Assessment session.

Let me introduce T-Sprints to you -
**T-Sprints** is a new-age consulting format created especially to help startups become successful businesses. We use several principles and frameworks, tailor-made for every problem statement that a startup faces such as traction, revenue generation, scaling up, and financial sustainability.

In a typical T-Sprint session, which can last for up to 2 hours, our consultants assist founders to chart out the best route forward for their venture.

In our inaugural T-Sprint session, our focus will be on decoding your current business model, identifying key focus areas, and defining goals to work towards.

**To make the most out of this session, we recommend the following:**
- Keep your broad-level financial numbers readily available.
- Familiarize yourself with any customer-related data points you may have.
- Come prepared to discuss, contribute and challenge ideas.
- Feel free to invite your co-founders to join you.

Your consultants for these sessions, [Name of the Host] - Senior Consultant & [Name of the Co-Host] - Business Research Analyst at Thinking Spree, holding a combined experience of 12+ years in sectors across Strategy, Emerging technologies & Consumer driven sectors are eagerly looking forward to meeting with you on **[Day]**, **[Date of Sprint]**, **[Time of Sprint]**.

We are excited to embark on this journey together and actively contribute to shaping the future of your startup.

Regards,
Team Thinking Spree.`;

const POST_SPRINT_TEMPLATE = `Hi [Founder's Name],

We had a great 1:1 need assessment T-Sprint session with you on [Day of the Sprint]. It was great to learn about your entrepreneurial journey and your vision [Vision of the Company from the About the Company sheet].

The key strengths identified for [Company's Name] include [In paragraph format of the Strength from the SWOT].

The next goal for [Company's Name] is to [Direction of the company]. Towards the same, your actionable steps are: [Actionable Steps].

As part of the [Cohort] program, we recommend pursuing mentorship in [in paragraph format from Expert 1:1 (Mentor Connect)/Office hour Support recommendation]. Additionally, explore market connections with [In paragraph format from Market Access on SWOT Tab].

Please find the Thinking Sheet for [Company's Name hyperlinked with the google sheet link] for your reference.

Should you need additional hands-on support for building your venture, you can partner with us for extra T-Sprints. For a detailed discussion, please schedule a meeting by clicking this link.

We wish you success in your endeavours.

Best Regards,
Team Thinking Spree.`;

// ──────────────────────── Prompt builder ───────────────────────────────────
/**
 * We pass Gemini the template + a structured context object + crisp rules.
 * Asking it to be conservative about fabricated content is important — the
 * model otherwise loves inventing details about the SWOT or vision when
 * a field is null. The rules below tell it to omit, not invent.
 */
function buildPrompt(kind: EmailKind, ctx: EmailContext): string {
  const template = kind === "pre" ? PRE_SPRINT_TEMPLATE : POST_SPRINT_TEMPLATE;

  const fields: Record<string, string | null> = {
    "Founder's Name": ctx.founderName,
    "Company Name":   ctx.companyName,
    "Cohort":         ctx.cohort,
    "Host":           ctx.sprintHost,
    "Co-Host":        ctx.coHost,
    "Sprint Day":     ctx.sprintDay,
    "Sprint Date":    ctx.sprintDate,
    "Sprint Time":    ctx.sprintTime,
    "Vision":         ctx.vision,
    "Key Strengths":  ctx.keyStrengths,
    "Gaps":           ctx.gaps,
    "Direction (Next Goal)": ctx.direction,
    "Actionable Steps":      ctx.actionableSteps,
    "Mentor Connect Recommendation": ctx.mentorRecommendation,
    "Market Access":  ctx.marketAccess,
    "Thinking Sheet URL":    ctx.thinkingSheetUrl,
  };
  const ctxLines = Object.entries(fields)
    .map(([k, v]) => `- ${k}: ${v ?? "(not provided)"}`)
    .join("\n");

  const extraBlock = ctx.extraNotes?.trim()
    ? `\nAdditional notes from the consultant (incorporate naturally if relevant):\n${ctx.extraNotes.trim()}\n`
    : "";

  return `You are a senior consultant at Thinking Spree, a venture-focused strategy firm in India. You are drafting a ${kind === "pre" ? "PRE-SPRINT" : "POST-SPRINT"} email to a startup founder.

CONTEXT — fields available from the company's record:
${ctxLines}
${extraBlock}
TEMPLATE — use this as the structural skeleton. Each "[bracketed]" placeholder is a merge field; replace it with the matching value from the CONTEXT above. Rewrite each paragraph in fluent prose so no brackets remain in the output.

${template}

STRICT RULES
1. Output JSON ONLY — no markdown fences, no preamble. Shape: { "subject": "...", "body": "..." }
2. Body must be text with paragraph breaks (use \\n\\n between paragraphs). The ONLY markup allowed is bold: a span wrapped in double asterisks, like **this**. Use NO other markdown (no headings, no italics, no links syntax).
2a. BOLD PRESERVATION — wherever the TEMPLATE wraps text in **double asterisks**, your output MUST keep that exact span bold with **double asterisks** around the SAME words (after you fill in any merge field). Specifically, in the pre-sprint email these must stay bold: the word **T-Sprints** in the introduction sentence, the line **To make the most out of this session, we recommend the following:**, and the sprint **[Day]**, **[Date of Sprint]**, **[Time of Sprint]** values. Do NOT add bold to any text the template did not mark bold. Do NOT leave a stray or unmatched asterisk.
2b. If a bold merge field (Day/Date/Time) is "(not provided)" and you soften that sentence per rule 9, drop the asterisks for that omitted value rather than emitting empty **.
3. If a CONTEXT field is "(not provided)", DO NOT invent a value. Either:
   (a) omit the sentence/clause that referenced it, OR
   (b) keep the surrounding paragraph but rephrase so the missing field isn't needed.
4. NEVER leave a literal "[...]" placeholder in the output.
5. For the post-sprint email:
   (a) Rewrite SWOT strengths, gaps, mentor recommendations, and market access in PARAGRAPH form, not bullet lists.
   (b) BUT render "Actionable Steps" as a NUMBERED LIST. Preserve each step on its own line with the format "1. <step>", "2. <step>", etc. Split the source text on common separators (newlines, semicolons, commas at clause boundaries) into discrete numbered items. Lead the list with a short framing sentence like "Towards the same, your actionable steps are:" and follow with the list on subsequent lines (one item per line, separated by \\n).
6. Keep tone warm, professional, India-context appropriate. No emoji.
7. Subject line should be specific (mentions the company name).
8. Sign off exactly as in the template: "Regards,\\nTeam Thinking Spree." (pre) or "Best Regards,\\nTeam Thinking Spree." (post).
9. If sprint Day/Date/Time are all "(not provided)" in the PRE email, soften the closing paragraph to "We will share the session details shortly" rather than inventing a date.

Return only the JSON object.`;
}

// ──────────────────────── Public API ───────────────────────────────────────
export async function isGeminiConfigured(): Promise<boolean> {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

export async function generateEmail(kind: EmailKind, ctx: EmailContext): Promise<GeneratedEmail> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured on the server. Add it in the Render env vars.");
  }

  const genai = new GoogleGenerativeAI(apiKey);
  const model = genai.getGenerativeModel({
    // gemini-2.5-flash is fast (~2s) and free-tier eligible. Switch to
    // gemini-2.5-pro for higher quality if quota allows.
    model: "gemini-2.5-flash",
    generationConfig: {
      temperature: 0.7,
      responseMimeType: "application/json",
    },
  });

  const result = await model.generateContent(buildPrompt(kind, ctx));
  const text = result.response.text();

  // Defensive cleanup — strip code fences if Gemini ignored responseMimeType
  // (it sometimes does on edge inputs).
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

  let parsed: { subject?: string; body?: string };
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Gemini returned non-JSON output. Raw: ${text.slice(0, 400)}…`);
  }
  if (!parsed.subject || !parsed.body) {
    throw new Error(`Gemini response missing subject or body. Got: ${JSON.stringify(parsed).slice(0, 300)}`);
  }

  return { subject: parsed.subject.trim(), body: parsed.body.trim() };
}

/**
 * Lazily summarise the raw "About the Startup" text into a 2-3 line vision
 * statement. Used by the Sprint Data tab's Vision card.
 *
 * Why a separate prompt: emails are creative + 200 words long; vision is
 * crisp + 2-3 sentences. Different temperature, different rules. Keeping
 * them as separate functions also means quota usage stays predictable —
 * one Vision call per company, not per email send.
 */
export async function summariseVision(input: {
  companyName: string;
  founderName: string;
  rawAbout: string;
}): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured on the server.");
  }
  if (!input.rawAbout?.trim()) {
    throw new Error("Nothing to summarise — the About Startup tab appears to be empty.");
  }

  const genai = new GoogleGenerativeAI(apiKey);
  const model = genai.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      // Lower temperature than email drafting — we want a faithful summary,
      // not creative writing.
      temperature: 0.3,
      responseMimeType: "application/json",
    },
  });

  const prompt = `You are summarising a startup's "About the Startup" content into a crisp 2-3 sentence Vision statement.

COMPANY: ${input.companyName}
FOUNDER: ${input.founderName}

RAW ABOUT-THE-STARTUP CONTENT (from the consultant's sheet):
"""
${input.rawAbout.slice(0, 4000)}
"""

RULES
1. Output JSON only, no fences: { "vision": "..." }
2. 2-3 sentences. Maximum 60 words.
3. Lead with what the company DOES, not buzzwords. Active voice.
4. Capture: who they serve, what problem they solve, how they solve it.
5. Do NOT invent facts not present in the source.
6. If the raw content is too thin to make a meaningful statement, return:
   { "vision": "Insufficient information to summarise. Add more detail to the About the Startup tab." }
7. Don't quote the source — paraphrase.
8. No bullet points, no headers, no markdown.`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

  let parsed: { vision?: string };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Best-effort fallback — if Gemini ignored JSON mode and returned plain
    // text, use the text directly (trimmed and bounded to 500 chars).
    return text.slice(0, 500).trim();
  }
  if (!parsed.vision) {
    throw new Error(`Gemini returned no vision field. Raw: ${text.slice(0, 200)}`);
  }
  return parsed.vision.trim();
}
