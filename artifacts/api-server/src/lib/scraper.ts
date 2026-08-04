/**
 * scraper.ts — the real "Scrapling" worker for Competitive Mapping.
 *
 * The UI is branded "Scrapling · d4vinci" (a Python crawler). Because the suite
 * runs on Node/Express (Render) with no headless browser available, this module
 * does the same *job* — fetch → parse → extract → return structured data +
 * real product/logo images — using Node's global fetch and light HTML parsing.
 * No new dependencies, and every call fails soft so a slow/blocked site never
 * breaks a research run.
 *
 * What it surfaces per company:
 *   - readable page text (feeds Gemini's overview / fencing so nothing is empty)
 *   - a real image URL (og:image → Clearbit logo → Google favicon) so the
 *     Product Image column and the Google Sheet show actual imagery, not a stub.
 */

const UA = "Mozilla/5.0 (compatible; ThinkingSpreeBot/1.0; +https://thinkingspree.com)";
const TIMEOUT_MS = 12000;

export type ScrapedPage = {
  requestedUrl: string;
  finalUrl: string;
  domain: string;
  title: string;
  description: string;
  ogImage: string;
  favicon: string;
  images: string[]; // ranked, best-first product/content images scraped from the page
  richImages: { url: string; alt: string; score: number }[]; // same, with alt text for matching
  text: string;
  ok: boolean;
};

/** Normalise a user-typed URL or bare domain into an absolute https URL. */
export function normalizeUrl(raw: string): string {
  let u = (raw || "").trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u;
}

/** Pull the hostname (no protocol / path / www) from a URL or domain string. */
export function domainOf(raw: string): string {
  try {
    return new URL(normalizeUrl(raw)).hostname.replace(/^www\./i, "");
  } catch {
    return (raw || "").replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].trim();
  }
}

/** Best-effort domain guess for a company that only gave us a name. */
export function guessDomain(companyName: string, website?: string): string {
  if (website && website.trim()) return domainOf(website);
  const slug = (companyName || "")
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|labs|technologies|technology|systems|solutions|pvt|private|limited)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
  return slug ? `${slug}.com` : "";
}

function abs(base: string, maybeRelative: string): string {
  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return maybeRelative;
  }
}

function meta(html: string, ...names: string[]): string {
  for (const name of names) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']+)["']`,
      "i",
    );
    const m = html.match(re);
    if (m?.[1]) return m[1].trim();
    // attribute order can be reversed (content first)
    const re2 = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${name}["']`,
      "i",
    );
    const m2 = html.match(re2);
    if (m2?.[1]) return m2[1].trim();
  }
  return "";
}

function stripToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Junk we never want as a "product image": icons, sprites, tracking pixels, badges. */
const IMG_BLOCKLIST = /(sprite|icon|favicon|logo|avatar|pixel|spacer|blank|placeholder|1x1|badge|button|arrow|chevron|star|rating|flag|payment|visa|mastercard|amex|paypal|app-?store|google-?play|social|facebook|twitter|linkedin|instagram|youtube|tiktok|loading|spinner|cookie|gdpr)/i;
/** People/press shots (CEO holding an award, team photos, office): still usable
 *  but heavily DE-ranked so they never become the default "product" image. */
const IMG_PEOPLE = /(ceo|founder|team|leadership|management|board|portrait|headshot|people|staff|press|news|award|event|conference|speaker|profile|about-?us|office|building|campus|hero-banner|banner-hero)/i;
const IMG_EXT_OK = /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i;

/** Pull the first integer out of a width/height attribute value ("640", "640px", "50%"). */
function pxOf(v?: string): number {
  if (!v) return 0;
  const m = String(v).match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}

/**
 * Extract candidate product/content images from a page, ranked best-first.
 * Reads <img src|data-src|data-original|srcset> plus og/twitter images, makes
 * every URL absolute, drops icons/sprites/tracking pixels, and scores what's
 * left by size hints, position on the page, and product-y keywords.
 */
export type RichImage = { url: string; alt: string; score: number };

function extractRich(html: string, baseUrl: string): RichImage[] {
  const best = new Map<string, { alt: string; score: number }>(); // url -> best
  const add = (rawSrc: string, score: number, altText = "") => {
    if (!rawSrc) return;
    let src = rawSrc.trim().replace(/&amp;/gi, "&");
    if (!src || src.startsWith("data:") || /\.svg(\?|#|$)/i.test(src)) return; // svg usually = logo/icon
    src = abs(baseUrl, src);
    if (!/^https?:\/\//i.test(src)) return;
    if (IMG_BLOCKLIST.test(src)) return;
    // Require a real raster extension OR a query-string image endpoint (CDNs often hide ext).
    if (!IMG_EXT_OK.test(src) && !/\/(image|images|img|media|photo|asset|cdn|uploads?)\//i.test(src)) return;
    // De-rank people/press shots (url or alt) so a CEO-with-award never wins.
    if (IMG_PEOPLE.test(src) || IMG_PEOPLE.test(altText)) score -= 70;
    const prev = best.get(src);
    if (!prev || score > prev.score) best.set(src, { alt: altText.trim().slice(0, 160), score });
  };

  // Social/preview image: often a hero/press shot, so rank it modestly (NOT top)
  // and tag it so downstream matching knows it's generic.
  const og = meta(html, "og:image:secure_url", "og:image", "twitter:image", "twitter:image:src");
  if (og) add(og, 55, "og preview");

  const imgRe = /<img\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  let order = 0;
  while ((m = imgRe.exec(html)) && order < 240) {
    const tag = m[0];
    order++;
    const positionBonus = Math.max(0, 40 - order);
    const attr = (name: string) =>
      tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1] || "";

    const altRaw = attr("alt");
    const alt = (altRaw + " " + attr("title") + " " + attr("class") + " " + attr("id")).toLowerCase();

    const srcset = attr("srcset") || attr("data-srcset");
    if (srcset) {
      const wide = srcset.split(",")
        .map((s) => { const [u, w] = s.trim().split(/\s+/); return { u, w: pxOf(w) }; })
        .sort((a, b) => b.w - a.w)[0];
      if (wide?.u) add(wide.u, 45 + positionBonus + Math.min(30, wide.w / 60), altRaw || alt);
    }

    const src = attr("src") || attr("data-src") || attr("data-original") || attr("data-lazy-src");
    const w = pxOf(attr("width")), h = pxOf(attr("height"));
    if (w && h && (w < 64 || h < 64)) continue;
    const sizeBonus = Math.min(40, Math.max(w, h) / 25);
    const keywordBonus = /(product|screenshot|hero|feature|dashboard|app|device|mockup|gallery|catalog|collection|shop|card|pack|deck|box|kit)/.test(alt) ? 25 : 0;
    add(src, 40 + positionBonus + sizeBonus + keywordBonus, altRaw || alt);
  }

  return [...best.entries()]
    .map(([url, v]) => ({ url, alt: v.alt, score: v.score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 16);
}

/** Back-compat: ranked URL list (people shots demoted, best-first). */
function extractImages(html: string, baseUrl: string): string[] {
  return extractRich(html, baseUrl).map((i) => i.url).slice(0, 8);
}

/**
 * Optional real-screenshot hook. If SCREENSHOT_API_TEMPLATE is set (a URL with a
 * literal `{url}` placeholder, e.g. a thum.io / screenshotone / urlbox endpoint),
 * we return a rendered screenshot URL of the page. Unset → "" (no dependency,
 * no cost). This is the seam to plug in a true headless-browser service later.
 */
export function screenshotFor(pageUrl: string): string {
  const tpl = process.env.SCREENSHOT_API_TEMPLATE;
  const u = normalizeUrl(pageUrl);
  if (!tpl || !u) return "";
  return tpl.includes("{url}")
    ? tpl.replace("{url}", encodeURIComponent(u))
    : tpl.replace(/\/?$/, "/") + encodeURIComponent(u);
}

/** Fetch one page and extract text + imagery. Never throws. */
export async function scrapePage(rawUrl: string): Promise<ScrapedPage> {
  const requestedUrl = normalizeUrl(rawUrl);
  const empty: ScrapedPage = {
    requestedUrl, finalUrl: requestedUrl, domain: domainOf(requestedUrl),
    title: "", description: "", ogImage: "", favicon: "", images: [], richImages: [], text: "", ok: false,
  };
  if (!requestedUrl) return empty;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(requestedUrl, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
    });
    clearTimeout(timer);
    if (!res.ok) return empty;
    const finalUrl = res.url || requestedUrl;
    const html = await res.text();

    const title =
      meta(html, "og:title", "twitter:title") ||
      (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || "").trim();
    const description = meta(html, "og:description", "twitter:description", "description");
    let ogImage = meta(html, "og:image:secure_url", "og:image", "twitter:image", "twitter:image:src");
    if (ogImage) ogImage = abs(finalUrl, ogImage);

    // favicon (link rel icon) or /favicon.ico fallback
    let favicon = "";
    const iconMatch = html.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*href=["']([^"']+)["']/i);
    if (iconMatch?.[1]) favicon = abs(finalUrl, iconMatch[1]);
    if (!favicon) favicon = abs(finalUrl, "/favicon.ico");

    const richImages = extractRich(html, finalUrl);
    const images = richImages.map((i) => i.url).slice(0, 8);

    return {
      requestedUrl, finalUrl, domain: domainOf(finalUrl),
      title, description, ogImage, favicon, images, richImages,
      text: stripToText(html).slice(0, 16000),
      ok: true,
    };
  } catch {
    clearTimeout(timer);
    return empty;
  }
}

/** Logo services keyed on a domain — reliable, real image URLs. */
export function logoForDomain(domain: string): string {
  const d = domainOf(domain);
  return d ? `https://logo.clearbit.com/${d}` : "";
}
export function faviconForDomain(domain: string): string {
  const d = domainOf(domain);
  return d ? `https://www.google.com/s2/favicons?domain=${d}&sz=128` : "";
}

/**
 * Resolve a ranked, best-first list of real images for a company/product by
 * actually visiting its site and scraping the page imagery.
 *
 * Order of preference:
 *   1. optional rendered screenshot (if SCREENSHOT_API_TEMPLATE is configured)
 *   2. scraped product/content images from the page (og:image + best <img>s)
 *   3. Clearbit logo for the domain
 *   4. Google favicon
 *
 * `hint` lets callers reuse a page they already fetched (avoids a second hit).
 */
export async function resolveProductImages(opts: {
  company: string;
  website?: string;
  hint?: ScrapedPage | null;
}): Promise<string[]> {
  const { company, website, hint } = opts;
  const domain = guessDomain(company, website);
  const out: string[] = [];
  const push = (u?: string) => { if (u && !out.includes(u)) out.push(u); };

  const page =
    hint ??
    (website || domain ? await scrapePage(website || `https://${domain}`).catch(() => null) : null);

  if (page?.finalUrl) push(screenshotFor(page.finalUrl));
  else if (website) push(screenshotFor(website));

  if (page?.ogImage) push(page.ogImage);
  for (const img of page?.images ?? []) push(img);

  if (domain) push(logoForDomain(domain));
  if (page?.favicon) push(page.favicon);
  else if (domain) push(faviconForDomain(domain));

  return out.filter(Boolean);
}

/** Convenience: the single best image (first of resolveProductImages). */
export async function resolveCompanyImage(opts: {
  company: string;
  website?: string;
  hint?: ScrapedPage | null;
}): Promise<string> {
  const list = await resolveProductImages(opts);
  return list[0] || "";
}

/**
 * Build a rich scraped profile for the SUBJECT company: crawl the homepage and
 * a couple of high-signal sub-pages (about / products / pricing) and merge the
 * text. This is what feeds generateOverview so the Company Overview is real.
 */
export async function scrapeCompanyProfile(opts: {
  name: string;
  website?: string;
}): Promise<{ text: string; image: string; images: string[]; domain: string; pages: string[] }> {
  const { name, website } = opts;
  const domain = guessDomain(name, website);
  const start = website ? normalizeUrl(website) : domain ? `https://${domain}` : "";
  if (!start) return { text: "", image: "", images: [], domain, pages: [] };

  const home = await scrapePage(start);
  const parts: string[] = [];
  const visited: string[] = [];
  const gallery: string[] = [];
  if (home.ok) {
    visited.push(home.finalUrl);
    parts.push(`# ${home.title}\n${home.description}\n${home.text}`);
    for (const im of home.images) if (!gallery.includes(im)) gallery.push(im);
  }

  // Try a few common high-signal paths (fail soft, in parallel, capped).
  const base = home.ok ? home.finalUrl : start;
  const candidates = ["about", "about-us", "products", "product", "solutions", "pricing"]
    .map((p) => abs(base, "/" + p));
  const extra = await Promise.all(
    candidates.slice(0, 4).map((u) => scrapePage(u).catch(() => null)),
  );
  for (const p of extra) {
    if (p?.ok && p.text && !visited.includes(p.finalUrl)) {
      visited.push(p.finalUrl);
      parts.push(`## ${p.title}\n${p.text.slice(0, 4000)}`);
      for (const im of p.images) if (!gallery.includes(im)) gallery.push(im);
    }
  }

  // Best-first images for this company: optional screenshot → og:image →
  // scraped page images → logo fallback.
  const images: string[] = [];
  const shot = screenshotFor(home.finalUrl || start);
  if (shot) images.push(shot);
  if (home.ogImage && !images.includes(home.ogImage)) images.push(home.ogImage);
  for (const im of gallery) if (!images.includes(im)) images.push(im);
  if (domain) { const lg = logoForDomain(domain); if (!images.includes(lg)) images.push(lg); }

  return {
    text: parts.join("\n\n").slice(0, 24000),
    image: images[0] || "",
    images: images.slice(0, 8),
    domain,
    pages: visited,
  };
}
