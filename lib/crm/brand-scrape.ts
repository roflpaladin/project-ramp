import { assertPublicHttpUrl } from "@/lib/ssrf-guard";
import { parseMeta } from "@/lib/meta-scrape";

const FETCH_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 500_000;

// Pillar 2 — Branding (Sprint 3, Ticket 15). Pipes the CRM account domain
// through the same SSRF guard + size/timeout caps as /api/scrape-meta to pull
// the company's page <title>/og:title for the workspace name. Never throws:
// any failure (private-range domain, timeout, non-HTML) degrades to null and
// the provisioner falls back to generic branding — a scrape hiccup must not
// fail provisioning. Favicon/logo needs no scraping or storage: the portal
// header derives it from target_domain at render (lib/branding.ts).
export async function scrapeBrandTitle(domain: string): Promise<string | null> {
  try {
    const pageUrl = await assertPublicHttpUrl(`https://${domain}`);
    const response = await fetch(pageUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
    if (!response.ok || !response.body) return null;

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (received < MAX_RESPONSE_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
    }
    reader.cancel().catch(() => {});
    const html = Buffer.concat(chunks).toString("utf-8");

    const { title } = parseMeta(html, pageUrl);
    return title;
  } catch {
    return null;
  }
}
