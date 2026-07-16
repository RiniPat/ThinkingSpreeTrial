/**
 * Best-effort website → plain text. Fetches a URL and strips markup so the
 * profile extractor has readable content alongside the deck.
 *
 * Note: server-side fetch to arbitrary client domains must be allowed by the
 * host's egress policy (e.g. Render). Fails soft — returns "" on any error so
 * the deck alone can still drive extraction.
 */
export async function fetchWebsiteText(rawUrl: string): Promise<string> {
  try {
    let url = rawUrl.trim();
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": "Mozilla/5.0 (compatible; ThinkingSpreeBot/1.0)" },
    });
    clearTimeout(t);
    if (!res.ok) return "";
    const html = await res.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 16000);
  } catch {
    return "";
  }
}
