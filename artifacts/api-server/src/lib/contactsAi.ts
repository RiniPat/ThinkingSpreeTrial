import { GoogleGenerativeAI } from "@google/generative-ai";

export type ContactRole = "founder" | "investor" | "partner" | "other";

export interface ContactInput {
  email: string;
  name?: string | null;
  domain?: string | null;
  sampleSubjects?: string[];
}
export interface Classification { role: ContactRole; confidence: number; reason?: string }

const PERSONAL = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "yahoo.co.in", "icloud.com", "proton.me", "protonmail.com", "live.com", "rediffmail.com"]);
const SERVICE = ["no-reply", "noreply", "notifications", "mailer", "support", "billing", "info@", "hello@", "team@"];
const SERVICE_DOMAINS = ["zoom.us", "google.com", "calendly.com", "stripe.com", "docusign", "amazonaws", "sendgrid", "mailchimp", "hubspot", "notion.so", "slack.com", "linkedin.com", "atlassian"];

/**
 * Cheap, deterministic first pass — no AI. Returns a confident role where the
 * domain/address makes it obvious, or null to defer to the model. This keeps
 * the majority of contacts off the AI path entirely (fast + near-free).
 */
export function heuristicRole(email: string, domain?: string | null): Classification | null {
  const e = email.toLowerCase();
  const d = (domain || e.split("@")[1] || "").toLowerCase();
  if (!d) return null;
  if (SERVICE.some(s => e.includes(s)) || SERVICE_DOMAINS.some(s => d.includes(s))) return { role: "other", confidence: 0.9, reason: "Service / automated address" };
  if (/\.vc$|ventures?|capital|\bvc\b|equity|\bfund\b|angels?/.test(d)) return { role: "investor", confidence: 0.8, reason: "Investment-firm domain" };
  if (/nasscom|startupindia|ycombinator|techstars|accelerator|incubat|foundation|\.gov|\.edu|\.ac\.|chamber|council/.test(d)) return { role: "partner", confidence: 0.72, reason: "Institution / programme domain" };
  if (PERSONAL.has(d)) return null; // personal inbox — could be founder or investor; let AI decide
  return null;                       // company domain — defer to AI for founder/partner/other
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
 * so the whole inbox costs tens of calls, not thousands. Returns a role +
 * confidence + short reason per input index.
 */
export async function classifyContactsBatch(contacts: ContactInput[]): Promise<Classification[]> {
  if (contacts.length === 0) return [];
  const list = contacts.map((c, i) => {
    const subj = (c.sampleSubjects || []).slice(0, 3).map(s => s.slice(0, 80)).join(" | ");
    return `${i}. ${c.name || "(no name)"} <${c.email}>${subj ? ` — subjects: ${subj}` : ""}`;
  }).join("\n");

  const prompt = `You classify business contacts from someone's email inbox into one role each.

ROLES:
- founder = a startup founder / operator / company employee (the people being advised or sold to).
- investor = venture capital, angel, PE, family office — anyone who invests.
- partner = institutions, incubators, accelerators, associations, government, universities, ecosystem partners.
- other = vendors, service providers, automated senders, personal contacts, anything not above.

Use the email domain as the strongest signal, then the name and the subject lines.

CONTACTS:
${list}

Return a JSON array, one object per contact IN THE SAME ORDER, no prose:
[ { "i": 0, "role": "founder|investor|partner|other", "confidence": 0.0, "reason": "<= 8 words" } ]
confidence is 0-1. Be honest — use "other" and low confidence when unsure rather than guessing.`;

  try {
    const res = await model().generateContent(prompt);
    const txt = res.response.text().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const arr = JSON.parse(txt) as any[];
    const out: Classification[] = contacts.map(() => ({ role: "other", confidence: 0.3 }));
    for (const item of arr) {
      const i = Number(item?.i);
      const role = ["founder", "investor", "partner", "other"].includes(item?.role) ? item.role : "other";
      if (Number.isInteger(i) && i >= 0 && i < out.length) {
        out[i] = { role, confidence: Math.max(0, Math.min(1, Number(item?.confidence) || 0.3)), reason: typeof item?.reason === "string" ? item.reason.slice(0, 60) : undefined };
      }
    }
    return out;
  } catch {
    // On failure, default everything to a low-confidence 'other' so the sync
    // still completes; the user can re-classify or re-run.
    return contacts.map(() => ({ role: "other", confidence: 0.2, reason: "Unclassified" }));
  }
}
