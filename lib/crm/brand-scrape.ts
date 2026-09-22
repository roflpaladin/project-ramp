import { parseMeta } from "@/lib/meta-scrape";
import { fetchPublicHtml } from "@/lib/ssrf/fetch-public-html";

// Pillar 2 — Branding (Sprint 3, Ticket 15). Pipes the CRM account domain
// through the same SSRF guard + size/timeout caps as /api/scrape-meta to pull
// the company's page <title>/og:title for the workspace name. Never throws:
// any failure (private-range domain, timeout, non-HTML) degrades to null and
// the provisioner falls back to generic branding — a scrape hiccup must not
// fail provisioning. Favicon/logo needs no scraping or storage: the portal
// header derives it from target_domain at render (lib/branding.ts).
//
// Sprint 12, Ticket 62: "the same guard as /api/scrape-meta" is now literally
// the same code path (lib/ssrf/fetch-public-html.ts) rather than a
// hand-copied timeout/byte-cap read loop beside a shared validator — the two
// copies had already drifted apart from each other in their error handling,
// and both inherited assertPublicHttpUrl's follow-any-redirect hole. This
// module's own contract (never throws, null on any failure) is unchanged;
// note that this is the one caller where a `null` is genuinely fine, which
// is why swallowing the error is acceptable HERE and nowhere else.
export async function scrapeBrandTitle(domain: string): Promise<string | null> {
  try {
    const { html, finalUrl } = await fetchPublicHtml(`https://${domain}`);
    // finalUrl, not the requested URL: an apex -> www redirect is the norm
    // for company sites, and parseMeta resolves relative hrefs against it.
    return parseMeta(html, finalUrl).title;
  } catch {
    return null;
  }
}
