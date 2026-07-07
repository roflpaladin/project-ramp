import { normalizeDomain } from "@/lib/domain";

// Favicon/logo comes from a third-party favicon service rather than us
// fetching + parsing the domain's HTML for a <link rel="icon"> — no
// scraping dependency needed, and the service already guarantees a
// non-broken image response (a generic default icon) even when the domain
// has no discoverable favicon, which covers the "graceful fallback"
// requirement without extra error-handling on our side.
export function getFaviconUrl(targetDomain: string, size = 128): string {
  const domain = normalizeDomain(targetDomain);
  return `https://www.google.com/s2/favicons?sz=${size}&domain=${encodeURIComponent(domain)}`;
}

export function buildPortalHeaderTitle(targetCompanyName: string): string {
  return `${targetCompanyName} x Seller Success Plan`;
}
