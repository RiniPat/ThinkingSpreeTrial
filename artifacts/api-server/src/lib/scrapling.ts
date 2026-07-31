/**
 * scrapling.ts — the Scrapling worker for Competitive Mapping v2.
 *
 * Contract (matches the product model "the AI tells Scrapling what to pull, and
 * Scrapling searches & replies"):
 *
 *   1. Gemini does DISCOVERY (names the companies + best-guess domains) and,
 *      per company, returns a small "scrape plan" (which sub-pages / signals to
 *      look for) via competitiveMappingAi.whatToScrape().
 *   2. Scrapling EXECUTES that plan against the real web — fetching the homepage
 *      and the requested sub-pages, extracting readable text + ranked product
 *      images (+ an optional rendered screenshot) — and REPLIES with structured
 *      evidence that Gemini then grounds its output on.
 *
 * There is no SERP key and no Python service by default, so discovery leans on
 * Gemini and Scrapling's job is to VERIFY + ENRICH (confirm the site is real,
 * pull fresh copy, grab imagery/logo). If you later stand up the real Python
 * Scrapling package as a sidecar, set SCRAPLING_SERVICE_URL and this module will
 * POST the plan to it instead — the rest of the pipeline is unchanged.
 */

import {
  scrapePage, scrapeCompanyProfile, resolveProductImages,
  logoForDomain, faviconForDomain, guessDomain, domainOf, normalizeUrl, screenshotFor,
  type ScrapedPage,
} from "./scraper";

/** What Scrapling returns for one company after executing a scrape plan. */
export type ScrapedEvidence = {
  company: string;
  domain: string;
  website: string;
  ok: boolean;            // did we actually reach a live site?
  title: string;
  description: string;
  text: string;          // merged readable copy across the requested pages
  images: string[];      // ranked, best-first product/content images
  logo: string;          // reliable logo url (Clearbit → favicon)
  pages: string[];       // urls actually visited
};

/** The plan Gemini hands Scrapling for a single company. */
export type ScrapePlan = {
  /** relative paths worth visiting, e.g. ["about","products","pricing"] */
  paths?: string[];
  /** freeform signals the consultant/AI wants surfaced (kept for the sidecar). */
  wants?: string[];
};

const SIDECAR = process.env.SCRAPLING_SERVICE_URL?.trim() || "";
const SIDECAR_TIMEOUT_MS = 25000;

/** If a real Scrapling sidecar is configured, delegate to it; else null. */
async function viaSidecar(
  company: string, website: string, plan: ScrapePlan,
): Promise<ScrapedEvidence | null> {
  if (!SIDECAR) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SIDECAR_TIMEOUT_MS);
  try {
    const res = await fetch(`${SIDECAR.replace(/\/$/, "")}/scrape`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ company, website, plan }),
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const j = (await res.json()) as Partial<ScrapedEvidence>;
    const domain = j.domain || guessDomain(company, website);
    return {
      company,
      domain,
      website: j.website || website || (domain ? `https://${domain}` : ""),
      ok: !!j.ok,
      title: j.title || "",
      description: j.description || "",
      text: (j.text || "").slice(0, 24000),
      images: (j.images || []).filter(Boolean),
      logo: j.logo || logoForDomain(domain),
      pages: j.pages || [],
    };
  } catch {
    clearTimeout(timer);
    return null;
  }
}

/**
 * Execute a scrape plan for ONE company and reply with structured evidence.
 * Never throws — a blocked or slow site yields an ok:false record with the
 * reliable logo still filled so the grid/sheet never renders an empty cell.
 */
export async function fetchEvidence(
  company: string, website: string | undefined, plan: ScrapePlan = {},
): Promise<ScrapedEvidence> {
  const domain = guessDomain(company, website);
  const start = website ? normalizeUrl(website) : domain ? `https://${domain}` : "";

  const sidecar = await viaSidecar(company, website || start, plan).catch(() => null);
  if (sidecar) return sidecar;

  const emptyLogo = domain ? (logoForDomain(domain) || faviconForDomain(domain)) : "";
  if (!start) {
    return {
      company, domain, website: start, ok: false, title: "", description: "",
      text: "", images: emptyLogo ? [emptyLogo] : [], logo: emptyLogo, pages: [],
    };
  }

  const home = await scrapePage(start).catch(() => null);
  const parts: string[] = [];
  const gallery: string[] = [];
  const visited: string[] = [];
  if (home?.ok) {
    visited.push(home.finalUrl);
    parts.push(`# ${home.title}\n${home.description}\n${home.text}`);
    for (const im of home.images) if (!gallery.includes(im)) gallery.push(im);
  }

  // Visit the pages the AI asked for (fail soft, in parallel, capped).
  const base = home?.ok ? home.finalUrl : start;
  const wantPaths = (plan.paths?.length ? plan.paths : ["about", "products", "pricing", "solutions"])
    .map((p) => absJoin(base, p))
    .slice(0, 5);
  const extra = await Promise.all(wantPaths.map((u) => scrapePage(u).catch(() => null)));
  for (const p of extra) {
    if (p?.ok && p.text && !visited.includes(p.finalUrl)) {
      visited.push(p.finalUrl);
      parts.push(`## ${p.title}\n${p.text.slice(0, 4000)}`);
      for (const im of p.images) if (!gallery.includes(im)) gallery.push(im);
    }
  }

  // Best-first imagery: optional screenshot → og/page images → logo fallback.
  const images: string[] = [];
  const shot = screenshotFor(home?.finalUrl || start);
  if (shot) images.push(shot);
  if (home?.ogImage && !images.includes(home.ogImage)) images.push(home.ogImage);
  for (const im of gallery) if (!images.includes(im)) images.push(im);
  const logo = domain ? logoForDomain(domain) : "";
  if (logo && !images.includes(logo)) images.push(logo);

  return {
    company,
    domain,
    website: home?.finalUrl || start,
    ok: !!home?.ok,
    title: home?.title || "",
    description: home?.description || "",
    text: parts.join("\n\n").slice(0, 24000),
    images: images.filter(Boolean).slice(0, 10),
    logo: logo || emptyLogo,
    pages: visited,
  };
}

/** Build the rich profile for the SUBJECT company (Data Feed grounding). */
export async function fetchSubjectProfile(company: string, website?: string) {
  return scrapeCompanyProfile({ name: company, website });
}

/** Resolve a ranked image list for a company (used to enrich fencing rows). */
export async function fetchImages(company: string, website?: string): Promise<string[]> {
  const list = await resolveProductImages({ company, website }).catch(() => []);
  if (list.length) return list;
  const d = guessDomain(company, website);
  return d ? [logoForDomain(d)] : [];
}

export { logoForDomain, faviconForDomain, guessDomain, domainOf };
export type { ScrapedPage };

function absJoin(base: string, path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  try { return new URL(clean, base).toString(); } catch { return base + clean; }
}
