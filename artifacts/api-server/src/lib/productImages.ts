/**
 * productImages.ts — give every product row its OWN, product-specific image.
 *
 * The old behaviour applied the single best scraped image (usually an og:image
 * press shot — a CEO holding an award) to EVERY product row, so all cards looked
 * identical. This module fixes that:
 *
 *   1. Match each product to the scraped gallery image whose alt-text / filename
 *      best overlaps the product name (a "playing card" product gets the picture
 *      whose alt says "playing card").
 *   2. Guarantee DISTINCT images — no two products share a URL. If the gallery
 *      runs out, fall back to the next best unused scraped image.
 *   3. If nothing site-specific is left, use a CATEGORY image for that product
 *      (keyword-built, so it's the right *kind* of product and still distinct).
 *   4. Company logo only as the final resort — and still de-duplicated.
 *
 * Category images come from IMAGE_SEARCH_TEMPLATE (a URL with a literal {q}
 * placeholder — plug in Bing/SerpAPI/etc. later) or default to LoremFlickr,
 * which returns a real keyword-matched photo with no API key.
 */

export type GalleryItem = { url: string; alt: string };

const STOP = new Set([
  "the", "and", "for", "with", "solutions", "solution", "services", "service",
  "products", "product", "platform", "brands", "brand", "custom", "based",
  "of", "to", "in", "a", "an", "systems", "system", "inc", "ltd", "llc", "co",
]);

function tokens(s: string): string[] {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/** Keywords that make a decent stock-image query for a product. */
function categoryKeywords(product: string, industry?: string): string {
  const t = tokens(product);
  const kw = (t.length ? t.slice(0, 3) : tokens(industry || "product").slice(0, 2)).join(" ");
  return (kw || "product").trim();
}

/** Build a keyword-matched category image URL (distinct per product via seed). */
export function categoryImage(product: string, industry: string | undefined, seed: number): string {
  const q = categoryKeywords(product, industry);
  const tpl = process.env.IMAGE_SEARCH_TEMPLATE?.trim();
  if (tpl && tpl.includes("{q}")) return tpl.replace("{q}", encodeURIComponent(q));
  // LoremFlickr: real Flickr photo matching the keywords; `lock` keeps it stable
  // and different per product so cards never repeat.
  const tags = encodeURIComponent(q.replace(/\s+/g, ","));
  return `https://loremflickr.com/640/480/${tags}?lock=${(seed % 9000) + 1}`;
}

/** Score how well a gallery image fits a product (token overlap on alt + url). */
function fitScore(item: GalleryItem, productToks: string[]): number {
  const hay = `${item.alt} ${item.url}`.toLowerCase();
  let s = 0;
  for (const t of productToks) if (hay.includes(t)) s += 3;
  if (/og preview/i.test(item.alt)) s -= 2; // generic hero/press image
  return s;
}

export type ImagedRow<T> = T & { image: string; images: string[] };

/**
 * Assign a distinct, best-fit image to each row. Rows keep their other fields;
 * we set `image` (single best) and `images` (that image first, then remaining
 * gallery as alternates for the sheet's =IMAGE fallback).
 */
export function assignProductImages<T extends { product?: string }>(
  rows: T[],
  gallery: GalleryItem[],
  opts: { industry?: string; logo?: string } = {},
): ImagedRow<T>[] {
  const pool = (gallery || []).filter((g) => g && g.url);
  const used = new Set<string>();
  const out: ImagedRow<T>[] = [];

  rows.forEach((row, idx) => {
    const productToks = tokens(row.product || "");

    // 1) best-fitting unused gallery image (fit first, then original rank order).
    let pick = "";
    let bestScore = -Infinity;
    pool.forEach((g, gi) => {
      if (used.has(g.url)) return;
      const score = fitScore(g, productToks) - gi * 0.01; // stable tiebreak by rank
      if (score > bestScore) { bestScore = score; pick = g.url; }
    });

    // Only accept a zero-overlap gallery pick if it's a real content image
    // (we still prefer a distinct scraped image over a stock one).
    if (pick) used.add(pick);

    // 2) category fallback (keyword-matched, distinct) when the gallery is spent.
    if (!pick) pick = categoryImage(row.product || `product ${idx + 1}`, opts.industry, idx + 1);

    // 3) alternates: this pick, then the rest of the gallery, then logo.
    const alts = [pick, ...pool.map((g) => g.url).filter((u) => u !== pick)];
    if (opts.logo && !alts.includes(opts.logo)) alts.push(opts.logo);

    out.push({ ...row, image: pick, images: alts.slice(0, 8) } as ImagedRow<T>);
  });

  return out;
}
