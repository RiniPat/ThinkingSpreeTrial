import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * Coarse role buckets. Kept as a small, stable set so the distribution bar,
 * colour legend and filter chips stay legible — but the AI ALSO returns a
 * free-form `roleLabel` (e.g. "Accelerator", "Angel", "Design agency",
 * "Journalist") so contacts can be segregated far more finely than these
 * buckets alone. The UI shows the label under the bucket.
 */
export type ContactRole =
  | "founder"
  | "investor"
  | "partner"
  | "mentor"
  | "customer"
  | "vendor"
  | "media"
  | "talent"
  | "other";

export const AI_ROLES: ContactRole[] = [
  "founder", "investor", "partner", "mentor", "customer", "vendor", "media", "talent", "other",
];

export interface ContactInput {
  email: string;
  name?: string | null;
  domain?: string | null;
  sampleSubjects?: string[];
}
export interface Classification {
  role: ContactRole;
  roleLabel?: string | null; // specific sub-type the AI picks, e.g. "Accelerator"
  confidence: number;
  reason?: string;
}

const PERSONAL = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "yahoo.co.in", "icloud.com", "proton.me", "protonmail.com", "live.com", "rediffmail.com"]);
const SERVICE = ["no-reply", "noreply", "notifications", "mailer", "donotreply", "do-not-reply", "automated", "bounce"];
const SERVICE_DOMAINS = ["zoom.us", "calendly.com", "stripe.com", "docusign", "amazonaws", "sendgrid", "mailchimp", "notion.so", "atlassian.net", "intercom", "hubspot", "salesforce"];
const MEDIA_DOMAINS = ["techcrunch", "yourstory", "inc42", "economictimes", "livemint", "forbes", "entrackr", "moneycontrol", "business-standard", "thehindu", "hindustantimes"];

/**
 * Cheap, deterministic first pass — no AI. Returns a confident role where the
 * domain/address makes it obvious, or null to defer to the model. This keeps
 * the majority of contacts off the AI path entirely (fast + near-free).
 */
export function heuristicRole(email: string, domain?: string | null): Classification | null {
  const e = email.toLowerCase();
  const d = (domain || e.split("@")[1] || "").toLowerCase();
  if (!d) return null;
  if (SERVICE.some(s => e.includes(s)) || SERVICE_DOMAINS.some(s => d.includes(s)))
    return { role: "other", roleLabel: "Automated / service", confidence: 0.9, reason: "Service / automated address" };
  if (MEDIA_DOMAINS.some(s => d.includes(s)))
    return { role: "media", roleLabel: "Press / publication", confidence: 0.82, reason: "Known media domain" };
  if (/\.vc$|ventures?|capital|\bvc\b|equity|\bfund\b|angels?|partners\.[a-z]+$/.test(d))
    return { role: "investor", roleLabel: "VC / fund", confidence: 0.8, reason: "Investment-firm domain" };
  if (/accelerat|incubat|ycombinator|techstars/.test(d))
    return { role: "partner", roleLabel: "Accelerator / incubator", confidence: 0.78, reason: "Accelerator domain" };
  if (/nasscom|startupindia|foundation|\.gov|\.edu|\.ac\.|chamber|council|association/.test(d))
    return { role: "partner", roleLabel: "Institution / ecosystem", confidence: 0.72, reason: "Institution / programme domain" };
  if (PERSONAL.has(d)) return null; // personal inbox — could be founder, mentor, investor; let AI decide
  return null;                       // company domain — defer to AI
}

let genai: GoogleGenerativeAI | null = null;
function model() {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("GEMINI_API_KEY is not configured on the server.");
  genai = genai || new GoogleGenerativeAI(key);
  return genai.getGenerativeModel({ model: "gemini-2.5-flash", generationConfig: { temperature: 0.1, responseMimeType: "application/json" } });
}

/**
 * Classify a BATCH of contacts in one call (default caller sends ~40 at a time)
 * so the whole inbox costs tens of calls, not thousands. Each result carries a
 * coarse `role` (bucket) PLUS a specific `roleLabel` sub-type.
 */
export async function classifyContactsBatch(contacts: ContactInput[]): Promise<Classification[]> {
  if (contacts.length === 0) return [];
  const list = contacts.map((c, i) => {
    const subj = (c.sampleSubjects || []).slice(0, 3).map(s => s.slice(0, 80)).join(" | ");
    return `${i}. ${c.name || "(no name)"} <${c.email}>${subj ? ` — subjects: ${subj}` : ""}`;
  }).join("\n");

  const prompt = `You classify business contacts from a startup consultancy's email inbox. For each contact pick ONE coarse role bucket AND a short specific label.

COARSE ROLES:
- founder   = startup founder / operator / company being advised or sold to.
- investor  = VC, angel, PE, family office — anyone who invests.
- partner   = incubators, accelerators, associations, government, universities, ecosystem partners.
- mentor    = advisors, domain experts, coaches who guide founders (not investing, not selling).
- customer  = a client or prospect buying the consultancy's services.
- vendor    = service providers, tools, agencies the consultancy pays or uses.
- media     = press, journalists, publications, PR.
- talent    = job candidates, recruiters, interns, hiring-related.
- other     = automated senders, personal contacts, anything not above.

roleLabel = a 1-3 word specific sub-type, e.g. "Angel investor", "Accelerator", "SaaS vendor", "Journalist", "Design agency", "Recruiter". Keep it human and specific.

Use the email domain as the strongest signal, then the name and subject lines.

CONTACTS:
${list}

Return a JSON array, one object per contact IN THE SAME ORDER, no prose:
[ { "i": 0, "role": "founder|investor|partner|mentor|customer|vendor|media|talent|other", "roleLabel": "<1-3 words>", "confidence": 0.0, "reason": "<= 8 words" } ]
confidence is 0-1. Be honest — prefer "other" with low confidence over guessing.`;

  try {
    const res = await model().generateContent(prompt);
    const txt = res.response.text().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const arr = JSON.parse(txt) as any[];
    const out: Classification[] = contacts.map(() => ({ role: "other", confidence: 0.3 }));
    for (const item of arr) {
      const i = Number(item?.i);
      const role: ContactRole = AI_ROLES.includes(item?.role) ? item.role : "other";
      if (Number.isInteger(i) && i >= 0 && i < out.length) {
        out[i] = {
          role,
          roleLabel: typeof item?.roleLabel === "string" && item.roleLabel.trim() ? item.roleLabel.trim().slice(0, 40) : null,
          confidence: Math.max(0, Math.min(1, Number(item?.confidence) || 0.3)),
          reason: typeof item?.reason === "string" ? item.reason.slice(0, 60) : undefined,
        };
      }
    }
    return out;
  } catch {
    // On failure, default everything to a low-confidence 'other' so the sync
    // still completes; the user can re-classify or re-run.
    return contacts.map(() => ({ role: "other", confidence: 0.2, reason: "Unclassified" }));
  }
}
