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

import {
  getModel, isGeminiConfigured as isConfigured, MODEL_LITE, MODEL_STANDARD,
  stripJsonFences, parseJsonLoose, memoAsync, hashKey, TTL,
} from "./aiClient";
import type { GrowthProspectsBrief } from "./growthProspectsLayout";

export type EmailKind = "pre" | "post" | "followup";

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
  /** Post-Sprint only: 'single' one-off engagement, or 'multi' where another
   *  sprint is already booked. Shapes the closing paragraph. */
  engagementType?: "single" | "multi" | null;
  /** Post-Sprint + multi only: the number/label of the NEXT sprint (e.g. "2"),
   *  and the consultant-picked date/time for it. */
  nextSprintNumber?: string | null;
  nextSprintDate?: string | null;
  nextSprintTime?: string | null;

  // ── Sales follow-up ("followup" kind) ─────────────────────────────────────
  /** Triage state — 'interested' or 'maybe' (only these get drafted). */
  interest?: string | null;
  /** Short label of the chosen template's intent (e.g. "Catch-up"). */
  templateIntent?: string | null;
  /** Summary of the consultant's T-sheet (from enrichment). */
  tSheetSummary?: string | null;
  /** Combined summary across all submitted meeting docs (from enrichment). */
  docsSummary?: string | null;
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

Please find the Thinking Sheet for [Company's Name] [here]({{SHEET_URL}}) for your reference.

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
/**
 * Sales follow-up prompt. Distinct from pre/post: the scaffold is an HTML
 * template from the follow-up playbook and the output is HTML (not plain text
 * with **bold**). Grounds the personalisation in the T-sheet + docs summaries
 * and the sprint facts; preserves the price + unknown [Square Bracket]
 * placeholders verbatim.
 */
function buildFollowupPrompt(ctx: EmailContext, templateOverride?: string | null): string {
  const template = (templateOverride && templateOverride.trim()) ? templateOverride.trim() : "";

  const fields: Record<string, string | null> = {
    "Founder / First name": ctx.founderName,
    "Company Name":         ctx.companyName,
    "Cohort / Program":     ctx.cohort,
    "Sprint Host":          ctx.sprintHost,
    "Co-Host":              ctx.coHost,
    "Last sprint date":     ctx.sprintDate,
    "Interest (triage)":    ctx.interest ?? null,
    "Template intent":      ctx.templateIntent ?? null,
  };
  const ctxLines = Object.entries(fields)
    .map(([k, v]) => `- ${k}: ${v ?? "(not provided)"}`)
    .join("\n");

  const tSheet = ctx.tSheetSummary?.trim();
  const docs = ctx.docsSummary?.trim();
  const groundingBlock = [
    tSheet ? `T-SHEET SUMMARY (the consultant's sprint workbook — real facts about the company):\n"""\n${tSheet.slice(0, 4000)}\n"""` : "",
    docs ? `MEETING DOCS SUMMARY (what was discussed in sessions — decisions, blockers, next steps):\n"""\n${docs.slice(0, 4000)}\n"""` : "",
  ].filter(Boolean).join("\n\n");
  const grounding = groundingBlock
    ? `\nGROUNDING CONTEXT — use these to make the email specific and warm. Reference the ACTUAL work; do NOT fabricate details beyond what is here:\n${groundingBlock}\n`
    : "\nGROUNDING CONTEXT: none beyond the sprint facts above. Do NOT invent meeting specifics — keep the email grounded in the template intent and the sprint facts only.\n";

  // "AI Email" template → fully AI-written (no fixed scaffold). Warm, human,
  // grounded in the T-sheet + transcript, engineered to NOT read like AI.
  const isAiEmail = (ctx.templateIntent ?? "").trim().toLowerCase() === "ai email";
  if (isAiEmail) {
    return `You are a senior consultant at Thinking Spree, a venture-focused strategy firm in India, writing a personal SALES FOLLOW-UP email to a founder you have already run T-Sprint sessions with. Write the WHOLE email yourself — there is no template. The single goal is to make this founder want to write back.

CONTEXT — fields from the company's record:
${ctxLines}
${grounding}
WRITE LIKE A REAL PERSON, NOT AN AI. This is the most important instruction.
- Open with something specific and genuine from the grounding context — a decision, a blocker, a number, a moment from the sessions. Never open with "I hope this email finds you well", "I hope you're doing well", or any generic pleasantry.
- Vary sentence length. Use a short sentence now and then. Contractions are good (we're, you've, I'd). Warm, direct, first person.
- Sound like one human writing to another they respect — not a firm broadcasting. Reference the real work; show you remember them.
- Make ONE clear, low-friction ask (a short catch-up / a reply on how things are going). No hard sell, no menu of options, no pricing.
- Keep it genuinely short: 90–160 words, 3–4 short paragraphs. A founder should read it in well under a minute.

BANNED — never use these AI tells or clichés: "I hope this email finds you well", "I wanted to reach out", "leverage", "synergy", "circle back", "touch base", "excited to", "in today's fast-paced world", "delve", "unlock", "game-changing", "at the end of the day", em-dash-stuffed cadence, or any emoji.

STRICT RULES
1. Output JSON ONLY — no markdown fences, no preamble. Shape: { "subject": "...", "body": "..." }
2. "body" is HTML using ONLY these tags: <p>, <br>, <strong>, <em>, <u>, <ul>, <ol>, <li>, <a>. No headings, no inline styles, no other tags. Prefer plain <p> paragraphs; avoid lists unless they truly help.
3. Ground every specific claim in the CONTEXT above. Never invent a metric, event, date, price, or fact. If you have little to work with, stay warm and general rather than fabricating.
4. Do NOT include any price, fee, or ₹ amount — the consultant handles commercials separately.
5. Address the founder by first name in the greeting (their first name is in the context). End with EXACTLY this sign-off block so the app can fill it: <p>Warm regards,<br>[Name]<br>[Title], Thinking Spree<br>[Phone] | [Calendar link]</p> — keep those four [square-bracket] tokens exactly as written; do not replace or delete them.
6. Subject line: short, specific, human, and mentions the company by name. Not "Following up" or "Checking in".

Return only the JSON object.`;
  }

  return `You are a senior consultant at Thinking Spree, a venture-focused strategy firm in India. You are drafting a warm SALES FOLLOW-UP email to a founder we have already run T-Sprint sessions with. The goal is to earn a reply.

CONTEXT — fields from the company's record:
${ctxLines}
${grounding}
TEMPLATE — use this HTML as the structural scaffold and voice. It uses [Square Bracket] merge-field placeholders. Personalise the prose so it references this specific company's actual work (from the grounding context), but keep the template's structure, paragraphs and lists.

${template || "(no template supplied — write a short, warm 4–6 sentence catch-up email in the same voice.)"}

STRICT RULES
1. Output JSON ONLY — no markdown fences, no preamble. Shape: { "subject": "...", "body": "..." }
2. "body" is HTML using ONLY these tags: <p>, <br>, <strong>, <em>, <u>, <ul>, <ol>, <li>, <a>. No headings, no inline styles, no other tags. Preserve the template's paragraph/list structure.
3. NEVER invent a price, fee, or amount. The literal placeholder "₹[amount] plus GST" MUST appear verbatim, unchanged, wherever the template has it — the consultant fills it. Do not add a price where the template has none.
4. Auto-fill ONLY these merge fields from the CONTEXT: [First Name] → the founder/first name, [Company] → the company name. Leave EVERY other [Square Bracket] placeholder (e.g. [Name], [Title], [Phone], [Calendar link], [Option 1], [previous growth priority], [specific challenge], [amount]) EXACTLY as written — the app fills the sign-off fields and the consultant fills the judgement calls. Do NOT delete or guess them.
5. Where the template has a judgement-call placeholder like [previous growth priority] or [specific challenge], you MAY replace it with a specific, TRUE detail drawn from the grounding context if one clearly applies; otherwise leave the placeholder untouched. Never fabricate.
6. Tone: warm, specific, professional, Indian English. No emoji. No hype. Reference the real work when the grounding context supports it.
7. Subject line: specific, mentions the company name. If the template has a subject-like first line, adapt it.
8. Keep it concise — a founder should be able to read it in under a minute.

Return only the JSON object.`;
}

function buildPrompt(kind: EmailKind, ctx: EmailContext, templateOverride?: string | null): string {
  if (kind === "followup") return buildFollowupPrompt(ctx, templateOverride);
  // When the consultant picks a template from the Emails tab library we use
  // that verbatim as the scaffold; otherwise we fall back to the two built-in
  // templates so the existing company-level composer keeps working unchanged.
  const template = (templateOverride && templateOverride.trim())
    ? templateOverride.trim()
    : (kind === "pre" ? PRE_SPRINT_TEMPLATE : POST_SPRINT_TEMPLATE);

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

  const engagementLines: string[] = [];
  if (kind === "post" && ctx.engagementType) {
    if (ctx.engagementType === "multi") {
      engagementLines.push(
        "ENGAGEMENT: This is a MULTI-SPRINT engagement — another sprint is already booked.",
        `Next sprint number: ${ctx.nextSprintNumber ?? "(not provided)"}`,
        `Next sprint date: ${ctx.nextSprintDate ?? "(not provided)"}`,
        `Next sprint time: ${ctx.nextSprintTime ?? "(not provided)"}`,
        "In the closing, warmly confirm the next session with these details instead of the generic \"partner with us for extra T-Sprints\" paragraph. If a next date/time is provided, state it clearly.",
      );
    } else {
      engagementLines.push(
        "ENGAGEMENT: This is a SINGLE (one-off) engagement — no further sprint is booked.",
        "Keep the standard closing that invites them to partner for additional T-Sprints; do NOT invent a next-session date.",
      );
    }
  }
  const engagementBlock = engagementLines.length ? `\n${engagementLines.join("\n")}\n` : "";

  const extraBlock = (ctx.extraNotes?.trim()
    ? `\nAdditional notes from the consultant (incorporate naturally if relevant):\n${ctx.extraNotes.trim()}\n`
    : "") + engagementBlock;

  return `You are a senior consultant at Thinking Spree, a venture-focused strategy firm in India. You are drafting a ${kind === "pre" ? "PRE-SPRINT" : "POST-SPRINT"} email to a startup founder.

CONTEXT — fields available from the company's record:
${ctxLines}
${extraBlock}
TEMPLATE — use this as the structural skeleton. Each "[bracketed]" placeholder is a merge field; replace it with the matching value from the CONTEXT above. Rewrite each paragraph in fluent prose so no brackets remain in the output.

${template}

STRICT RULES
1. Output JSON ONLY — no markdown fences, no preamble. Shape: { "subject": "...", "body": "..." }
2. Body must be text with paragraph breaks (use \\n\\n between paragraphs). The ONLY markup allowed is bold (a span wrapped in double asterisks, like **this**) and, for the POST-SPRINT email ONLY, a SINGLE link on the word "here" written EXACTLY as [here]({{SHEET_URL}}). Use NO other markdown (no headings, no italics, no other links).
2c. LINK RULE (post-sprint only): write the Thinking Sheet reference as "...for [Company's Name] [here]({{SHEET_URL}}) for your reference." Keep the literal token {{SHEET_URL}} as the link target — do NOT write or guess an actual URL. If the "Thinking Sheet URL" context field is "(not provided)", omit the entire "Please find the Thinking Sheet..." sentence and do not emit the link.
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
  return isConfigured();
}

export async function generateEmail(kind: EmailKind, ctx: EmailContext, templateOverride?: string | null): Promise<GeneratedEmail> {
  if (!isConfigured()) {
    throw new Error("GEMINI_API_KEY is not configured on the server. Add it in the Render env vars.");
  }

  // Email drafting is quality-sensitive → STANDARD tier.
  const model = getModel({
    model: MODEL_STANDARD,
    generationConfig: {
      temperature: 0.7,
      responseMimeType: "application/json",
    },
  });

  const result = await model.generateContent(buildPrompt(kind, ctx, templateOverride));
  const text = result.response.text();

  // Defensive cleanup — strip code fences if Gemini ignored responseMimeType
  // (it sometimes does on edge inputs).
  const cleaned = stripJsonFences(text);

  let parsed: { subject?: string; body?: string };
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Gemini returned non-JSON output. Raw: ${text.slice(0, 400)}…`);
  }
  if (!parsed.subject || !parsed.body) {
    throw new Error(`Gemini response missing subject or body. Got: ${JSON.stringify(parsed).slice(0, 300)}`);
  }

  let body = parsed.body.trim();
  // Issue 4: the model emits the literal {{SHEET_URL}} token so it can never
  // hallucinate the link. Substitute the real Thinking Sheet URL here. If we
  // don't have one, unlink gracefully (keep the word "here" as plain text).
  if (kind === "post") {
    const url = ctx.thinkingSheetUrl?.trim();
    if (url) {
      body = body.replace(/\{\{\s*SHEET_URL\s*\}\}/g, url);
    } else {
      body = body
        .replace(/\[here\]\(\s*\{\{\s*SHEET_URL\s*\}\}\s*\)/gi, "here")
        .replace(/\{\{\s*SHEET_URL\s*\}\}/g, "");
    }
  }

  return { subject: parsed.subject.trim(), body };
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
  if (!isConfigured()) {
    throw new Error("GEMINI_API_KEY is not configured on the server.");
  }
  if (!input.rawAbout?.trim()) {
    throw new Error("Nothing to summarise — the About Startup tab appears to be empty.");
  }

  const about = input.rawAbout.slice(0, 4000);
  // Faithful summary of stable input → cache so repeated Vision-card renders for
  // the same company don't re-hit the API.
  return memoAsync(hashKey("vision", input.companyName, about), TTL.long, async () => {

  // Data-pulling / summarisation → LITE tier, low temperature for a faithful
  // (not creative) summary.
  const model = getModel({
    model: MODEL_LITE,
    generationConfig: {
      temperature: 0.3,
      responseMimeType: "application/json",
    },
  });

  const prompt = `You are summarising a startup's "About the Startup" content into a crisp 2-3 sentence Vision statement.

COMPANY: ${input.companyName}
FOUNDER: ${input.founderName}

RAW ABOUT-THE-STARTUP CONTENT (from the consultant's sheet):
"""
${about}
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

  let parsed: { vision?: string };
  try {
    parsed = JSON.parse(stripJsonFences(text));
  } catch {
    // Best-effort fallback — if Gemini ignored JSON mode and returned plain
    // text, use the text directly (trimmed and bounded to 500 chars).
    return text.slice(0, 500).trim();
  }
  if (!parsed.vision) {
    throw new Error(`Gemini returned no vision field. Raw: ${text.slice(0, 200)}`);
  }
  return parsed.vision.trim();
  });
}

/**
 * Extract the four fields the Emails tab needs from a T-Sheet: company name,
 * founder name, and cohort. (The founder's EMAIL is deliberately NOT taken
 * from the sheet — per the team workflow it comes from the Google Calendar
 * invite attendees, which the route layer resolves separately.)
 *
 * We pass a flattened, bounded dump of the sheet's cells and ask Gemini to
 * pick out the fields. Returns nulls for anything it can't find rather than
 * guessing.
 */
export async function extractSheetProfile(sheetText: string): Promise<{
  companyName: string | null;
  founderName: string | null;
  cohort: string | null;
}> {
  if (!isConfigured()) {
    throw new Error("GEMINI_API_KEY is not configured on the server.");
  }
  const content = sheetText.slice(0, 8000);
  const empty = { companyName: null, founderName: null, cohort: null };

  // Pure field extraction over stable sheet text → LITE tier + cache.
  return memoAsync(hashKey("sheetProfile", content), TTL.long, async () => {
    const model = getModel({
      model: MODEL_LITE,
      generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
    });

    const prompt = `You are reading a startup's "T-Sheet" (a Google Sheet used by Thinking Spree consultants). Extract these fields.

SHEET CONTENT (flattened cells, may be noisy):
"""
${content}
"""

Return JSON ONLY, no fences: { "companyName": string|null, "founderName": string|null, "cohort": string|null }

RULES
1. companyName = the startup / company name.
2. founderName = the primary founder's full name (first founder listed if several).
3. cohort = the incubator / programme / cohort name (e.g. "ISB i-Venture", "JU cohort 3"). Null if none.
4. If a field genuinely isn't present, use null. Do NOT invent values.
5. Trim whitespace. No commentary.`;

    const result = await model.generateContent(prompt);
    const parsed = parseJsonLoose<Record<string, string | null>>(result.response.text(), empty);
    const clean = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    return {
      companyName: clean(parsed.companyName),
      founderName: clean(parsed.founderName),
      cohort: clean(parsed.cohort),
    };
  });
}

// ──────────────────────── Sales follow-up enrichment ───────────────────────

/**
 * Summarise a consultant's T-sheet (flattened to plain text) into a compact,
 * email-useful profile: what the company does, stage, key figures (revenue,
 * users, team, milestones), strengths, gaps and goals. Faithful, not creative.
 * Low temperature + cached (the same sheet text recurs across Generate/Re-draft).
 */
export async function summariseTSheet(sheetText: string): Promise<string> {
  if (!isConfigured()) throw new Error("GEMINI_API_KEY is not configured on the server.");
  const content = (sheetText ?? "").trim();
  if (!content) return "";
  const bounded = content.slice(0, 12000);

  return memoAsync(hashKey("tSheetSummary", bounded), TTL.long, async () => {
    const model = getModel({
      model: MODEL_LITE,
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
    });
    const prompt = `You are reading a startup's T-Sprint workbook ("T-sheet"), flattened to text. Summarise it into a compact, factual profile a consultant can use to write a follow-up email.

T-SHEET CONTENT (flattened cells, may be noisy):
"""
${bounded}
"""

Return JSON ONLY, no fences: { "summary": "..." }

RULES
1. 120–200 words. Plain prose or short labelled lines; no markdown fences.
2. Capture: what the company does, stage, and any REAL figures present (revenue, users, team size, sessions run, before/after counts, milestones), plus key strengths, the main gap/constraint, and stated goals.
3. Use ONLY facts present in the sheet. Do NOT invent numbers or details. If a figure isn't there, don't state one.
4. Keep numbers exactly as written (currency, units).
5. No commentary about the sheet itself.`;
    const parsed = parseJsonLoose<{ summary?: string }>((await model.generateContent(prompt)).response.text(), { summary: "" });
    return (parsed.summary ?? "").trim();
  });
}

/**
 * Summarise ALL submitted meeting docs together into one factual, email-useful
 * summary: what was discussed, decisions, blockers, next steps, objections,
 * commitments. Returns "" when no docs were submitted.
 */
export async function summariseFollowupDocs(docs: { title: string; text: string }[]): Promise<string> {
  if (!isConfigured()) throw new Error("GEMINI_API_KEY is not configured on the server.");
  const usable = (docs ?? []).filter((d) => d.text && d.text.trim());
  if (usable.length === 0) return "";

  // Bound each doc so a single huge transcript can't blow the context window.
  const PER_DOC = Math.max(1500, Math.floor(24000 / usable.length));
  const joined = usable
    .map((d, i) => `--- DOC ${i + 1}: ${d.title || "Untitled"} ---\n${d.text.trim().slice(0, PER_DOC)}`)
    .join("\n\n");

  return memoAsync(hashKey("followupDocsSummary", joined), TTL.long, async () => {
    const model = getModel({
      model: MODEL_STANDARD,
      generationConfig: { temperature: 0.3, responseMimeType: "application/json" },
    });
    const prompt = `You are summarising the meeting material a startup consultant submitted (session transcripts / notes) so it can inform a warm follow-up email.

DOCUMENTS:
"""
${joined}
"""

Return JSON ONLY, no fences: { "summary": "..." }

RULES
1. 120–220 words. Factual and specific.
2. Capture: what was discussed, decisions made, blockers/constraints raised, agreed next steps, objections, and any commitments.
3. Use ONLY what is in the documents. Do NOT invent details. If the docs are thin, produce a short summary rather than padding.
4. No markdown fences, no meta-commentary.`;
    const parsed = parseJsonLoose<{ summary?: string }>((await model.generateContent(prompt)).response.text(), { summary: "" });
    return (parsed.summary ?? "").trim();
  });
}

// ──────────────────────── Growth Prospects brief (§11) ─────────────────────

/**
 * Generate the strict JSON brief-model (§11.2) for the one-page, client-facing
 * "Growth Prospects" document. The model returns JSON ONLY; the code draws the
 * DOCX/PDF from it. Numbers must come from the T-sheet or be clearly-labelled
 * projections — never fabricated. Not cached (regenerable on demand).
 */
export async function generateGrowthProspectsBrief(input: {
  companyName: string;
  founderName: string;
  cohort: string | null;
  sprintHost: string | null;
  tSheetSummary: string | null;
  docsSummary: string | null;
}): Promise<GrowthProspectsBrief> {
  if (!isConfigured()) throw new Error("GEMINI_API_KEY is not configured on the server.");

  const model = getModel({
    model: MODEL_STANDARD,
    generationConfig: { temperature: 0.5, responseMimeType: "application/json" },
  });

  const system = `You are a senior growth strategist at Thinking Spree, a startup-consulting firm in India. You are writing the content for a ONE-PAGE, client-facing "Growth Prospects" document that will be attached to a follow-up email to a founder we have already run T-Sprint sessions with. The goal of this document is to earn a reply and make the founder WANT to work with us again: remind them of the value we created, show real momentum from their sprint sheet, spell out concretely how we'd help next, and make the next 3-6 months feel exciting, credible, and worth a conversation. It should feel like it was written for them personally — engaging enough that they can't help but reply.

You will be given: (1) the company's T-sheet extract (sprint sheet: goals, strengths, gaps, milestones, financials), and (2) summaries/transcripts of the sessions. Base EVERYTHING you write only on these inputs plus the sprint facts provided. Do not use outside knowledge about the company.

Write the content as a structured JSON object matching the schema you are given. Output ONLY valid JSON - no commentary, no markdown code fences.

Voice and style:
- Speak to the founder in warm, direct second person ("you", "your team", "your growth").
- Engaging and momentum-building: make them feel understood and eager to keep going. The "howWeHelp" bullets and the headline should give a genuine pull to re-engage — concrete benefit, not sales fluff.
- Data-led and specific. Prefer numbers, deltas, and concrete outcomes over adjectives.
- Realistic and credible, never hype. No superlatives, no vague "unlock/synergy/game-changing" language. Earn excitement with specifics, don't manufacture it with adjectives.
- Concise to the point of discipline - every field has a word cap; respect it. This must fit on a single page, so shorter is better.
- Indian context: currency in INR (₹), Indian English.

Hard rules:
- NEVER invent a number, metric, date, or fact. Take figures from the T-sheet. If the T-sheet has no number for a point, do NOT guess or estimate one - express that point QUALITATIVELY instead (a short factual descriptor, kind: "qualitative"). Only put a figure you genuinely cannot source but that would strengthen the doc into needsValidation for the consultant to confirm.
- Anything forward-looking (the plan, projectedImpact) must be framed as a target/projection, grounded in the current baseline from the inputs and a realistic improvement - not a promise. Keep targets defensible (modest multiples, not moonshots).
- Do NOT include any price, fee, or ₹ amount for our services - the email carries the commercial offer, not this sheet.
- The plan must trace back to the actual gap/constraint identified in the T-sheet, and each phase must have a concrete, checkable outcome.
- If the inputs are thin, produce fewer tiles/phases rather than padding. A short, honest brief beats a padded one.

SCHEMA (respect every word cap and array-length cap - these keep it to one page):
{
  "companyName": string,
  "founderName": string,
  "oneLiner": string,            // what the company does, <= 14 words
  "headline": string,            // catchy transformation promise, <= 10 words
  "sessionRecap": string[],      // 2-3 bullets, what we worked on, <= 12 words each
  "statTiles": [                 // 2-4 tiles
    { "label": string,           // <= 4 words
      "value": string,           // number from T-sheet OR short qualitative descriptor
      "kind": "number" | "qualitative",
      "sub": string }            // optional, <= 6 words
  ],
  "beforeAfter": [               // 0-3 rows, grounded
    { "dimension": string, "before": string, "after": string }  // before/after <= 8 words
  ],
  "keyStrength": string,         // 1 line, grounded, <= 16 words
  "keyGap": string,              // 1 line, the constraint we'd tackle, <= 16 words
  "plan": [                      // 2-4 phases, 3-6 month path
    { "phase": string,           // e.g. "Weeks 1-4"
      "focus": string,           // <= 10 words
      "expectedOutcome": string, // <= 12 words, concrete
      "metric": string }         // optional target if grounded
  ],
  "projectedImpact": [           // 0-2, MUST be labelled projections/targets
    { "metric": string, "from": string, "to": string, "timeframe": string }
  ],
  "howWeHelp": string[],         // 3-4 concrete, benefit-led ways WE help THIS founder tackle their gap, <= 16 words each. Start with an action verb. Specific to their situation, never generic.
  "whyThinkingSpree": string,    // 1 punchy credibility line, <= 18 words
  "cta": string,                 // 1 soft line aligned with the email, <= 16 words
  "needsValidation": string[]    // fields the consultant must confirm before sending
}`;

  const user = `INPUTS

Company: ${input.companyName}
Founder: ${input.founderName}
Cohort / Program: ${input.cohort ?? "(not provided)"}
Sprint host: ${input.sprintHost ?? "(not provided)"}

T-SHEET EXTRACT:
"""
${(input.tSheetSummary ?? "(none provided)").slice(0, 6000)}
"""

SESSION SUMMARIES / TRANSCRIPTS:
"""
${(input.docsSummary ?? "(none provided)").slice(0, 6000)}
"""

Produce the Growth Prospects brief JSON now.`;

  const result = await model.generateContent(`${system}\n\n${user}`);
  const raw = result.response.text();
  let parsed: any;
  try {
    parsed = JSON.parse(stripJsonFences(raw));
  } catch {
    throw new Error(`Gemini returned non-JSON for the Growth Prospects brief. Raw: ${raw.slice(0, 300)}…`);
  }
  return normaliseGrowthBrief(parsed, input.companyName, input.founderName);
}

/** Defensive shaping so a slightly-off model response can't crash a renderer. */
function normaliseGrowthBrief(x: any, companyName: string, founderName: string): GrowthProspectsBrief {
  const str = (v: unknown, cap = 400) => (typeof v === "string" ? v.trim().slice(0, cap) : "");
  const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
  const strList = (v: unknown, max: number, cap = 200) =>
    arr(v).map((s) => str(s, cap)).filter(Boolean).slice(0, max);
  return {
    companyName: str(x?.companyName) || companyName,
    founderName: str(x?.founderName) || founderName,
    oneLiner: str(x?.oneLiner),
    headline: str(x?.headline),
    sessionRecap: strList(x?.sessionRecap, 3),
    statTiles: arr(x?.statTiles).slice(0, 4).map((t) => ({
      label: str(t?.label, 60),
      value: str(t?.value, 60),
      kind: (t?.kind === "number" ? "number" : "qualitative") as "number" | "qualitative",
      sub: str(t?.sub, 80) || undefined,
    })).filter((t) => t.label && t.value),
    beforeAfter: arr(x?.beforeAfter).slice(0, 3).map((b) => ({
      dimension: str(b?.dimension, 80),
      before: str(b?.before, 120),
      after: str(b?.after, 120),
    })).filter((b) => b.dimension),
    keyStrength: str(x?.keyStrength),
    keyGap: str(x?.keyGap),
    plan: arr(x?.plan).slice(0, 4).map((p) => ({
      phase: str(p?.phase, 40),
      focus: str(p?.focus, 120),
      expectedOutcome: str(p?.expectedOutcome, 160),
      metric: str(p?.metric, 80) || undefined,
    })).filter((p) => p.phase && p.focus),
    projectedImpact: arr(x?.projectedImpact).slice(0, 2).map((p) => ({
      metric: str(p?.metric, 80),
      from: str(p?.from, 80),
      to: str(p?.to, 80),
      timeframe: str(p?.timeframe, 60),
    })).filter((p) => p.metric),
    howWeHelp: strList(x?.howWeHelp, 4),
    whyThinkingSpree: str(x?.whyThinkingSpree),
    cta: str(x?.cta),
    needsValidation: strList(x?.needsValidation, 8),
  };
}
